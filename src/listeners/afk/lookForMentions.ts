import { container, Events, Listener } from "@sapphire/framework";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ComponentType,
  Message,
  MessageFlags,
} from "discord.js";
import type { Afk } from "../../db/redis/schema.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { fetchT, type TFunction } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import ComponentUtils from "../../utilities/componentUtils.js";
import {
  MessageBuilder,
  type AnyInteractableInteraction,
} from "@sapphire/discord.js-utilities";
import { DEFAULT_EPHEMERAL_DELETION_TIMEOUT } from "../../lib/helpers/constants.js";
import { convertToDiscordTimestamp } from "../../lib/helpers/timestamp.js";

export class LookForMentionsListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options
  ) {
    super(context, {
      ...options,
      event: Events.MessageCreate,
    });
  }

  public async run(message: Message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const mentions = [
      ...message.mentions.parsedUsers.values(),
      message.mentions.repliedUser,
    ]
      .filter((user) => user && user.id !== message.author.id)
      .filter((user) => user !== null)
      .map((user) => user.id);

    if (mentions.length === 0) return;

    const afks = new Map<string, Afk>();
    for (const mention of mentions) {
      const afk = await this.container.redis.jsonGet(mention, "Afk");
      if (!afk) continue;
      if (new Date(afk.endsAt ?? 0) < new Date()) continue;
      afks.set(mention, afk);
    }

    if (afks.size === 0) return;

    return sendAFKEmbed(afks, message);
  }
}

export async function sendAFKEmbed(
  afks: Map<string, Afk>,
  message: Message | AnyInteractableInteraction,
  withButton = true,
  deleteMsg = true
) {
  if (!(message instanceof Message)) {
    if (!message.inGuild()) return;
  }
  const guildSettings = message.guildId
    ? await container.redis.jsonGet(message.guildId, "GuildSettings")
    : null;

  const ephemeralBtn = new ComponentUtils.EphemeralButton();
  const ephemeralRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ephemeralBtn
  );

  const t = await fetchT(message);

  const users = Array.from(afks.keys());

  const description =
    users.length > 1
      ? t(LanguageKeys.Commands.Utility.Afk.activeDescription_multiple, {
          users: users
            .slice(0, -1)
            .map((user) => `<@${user}>`)
            .join(", "),
          last_user: `<@${users[users.length - 1]}>`,
        })
      : t(LanguageKeys.Commands.Utility.Afk.activeDescription, {
          user: `<@${users[0]}>`,
        });

  const summary = new EmbedUtils.EmbedConstructor()
    .setTitle(t(LanguageKeys.Commands.Utility.Afk.activeTitle))
    .setDescription(description);

  let messageAttachment;
  if (afks.size === 1) {
    const afk = Array.from(afks.values())[0];
    if (afk.text)
      summary.addField(
        t(LanguageKeys.Commands.Utility.Afk.activeReason),
        afk.text
      );
    if (afk.attachment) {
      messageAttachment = afk.attachment;
      summary.setThumbnail(afk.attachment);
    }
    if (afk.endsAt) {
      summary.addField(
        t(LanguageKeys.Commands.Utility.Afk.activeUntil),
        convertToDiscordTimestamp(new Date(afk.endsAt).getTime(), "f")
      );
    }
  }

  const args = {
    embeds: [summary],
    components: withButton ? [ephemeralRow] : [],
    files: messageAttachment ? [messageAttachment] : undefined,
  };
  const response =
    message instanceof Message
      ? await message.reply(args)
      : message.deferred || message.replied
      ? await message.editReply(args)
      : await (await message.reply(args)).fetch();

  const timeToDelete =
    (guildSettings?.ephemeralDeletionTimeout ??
      DEFAULT_EPHEMERAL_DELETION_TIMEOUT) * 1000;

  if (withButton) {
    const interacted = new Map<
      string,
      InstanceType<typeof ComponentUtils.MenuPaginatedMessage>
    >();
    response.channel
      .createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (interaction) =>
          interaction.isButton() &&
          interaction.customId === ephemeralBtn.customId,
        time: timeToDelete,
      })
      .on("collect", (btn) => {
        void handleButton(btn, afks, interacted);
      });
  }

  if (deleteMsg) {
    setTimeout(() => {
      void response.delete().catch();
    }, timeToDelete);
  }

  return response;
}

export async function handleButton(
  btn: ButtonInteraction,
  afks: Map<string, Afk>,
  interacted: Map<
    string,
    InstanceType<typeof ComponentUtils.MenuPaginatedMessage>
  >
) {
  const oldPage = interacted.get(btn.user.id);
  if (oldPage) {
    oldPage.collector?.stop("messageDelete");
    if (oldPage.response) {
      if (oldPage.response instanceof Message) {
        void oldPage.response.delete().catch();
      } else {
        void oldPage.response.deleteReply().catch();
      }
    }
  }

  await btn.deferReply({ flags: MessageFlags.Ephemeral });
  const t = await fetchT(btn);

  const pages = await createPages(t, afks);
  if (pages.length === 1) {
    await btn.editReply(pages[0]);
    return;
  }

  const paginate = new ComponentUtils.MenuPaginatedMessage();
  pages.forEach((page) => paginate.addPageBuilder(page));

  const pageInteraction = await paginate.run(btn).catch(() => null);
  if (pageInteraction) interacted.set(btn.user.id, pageInteraction);
  return pageInteraction;
}

export async function createPages(
  t: TFunction,
  afks: Map<string, Afk>
): Promise<MessageBuilder[]> {
  const pages = [];
  for (const afk of afks) {
    const user = await container.client.users.fetch(afk[0]).catch(() => null);
    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(
        `${t(LanguageKeys.Commands.Utility.Afk.activeTitle)} | ${
          user?.username ?? afk[0]
        }`
      )
      .setDescription(
        t(LanguageKeys.Commands.Utility.Afk.activeDescription, {
          user: `<@${afk[0]}>`,
        })
      );
    if (afk[1].text)
      embed.addField(
        t(LanguageKeys.Commands.Utility.Afk.activeReason),
        afk[1].text
      );
    if (afk[1].endsAt)
      embed.addField(
        t(LanguageKeys.Commands.Utility.Afk.activeUntil),
        convertToDiscordTimestamp(new Date(afk[1].endsAt).getTime(), "f")
      );

    const message = new MessageBuilder();

    const attachment = afk[1].attachment;
    if (attachment) {
      embed.setImage(attachment);
    }

    message.setEmbeds([embed]);

    pages.push(message);
  }

  return pages;
}
