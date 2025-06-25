import { Events, Listener } from "@sapphire/framework";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  Message,
} from "discord.js";
import type { Afk } from "../../db/redis/schema.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { fetchT, type TFunction } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import ComponentUtils from "../../utilities/componentUtils.js";
import { MessageBuilder } from "@sapphire/discord.js-utilities";

export class ReadyListener extends Listener {
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
      .filter((user) => user !== null && user.id !== message.author.id)
      .map((user) => user!.id);

    if (mentions.length === 0) return;

    const afks = new Map<string, Afk>();
    for (const mention of mentions) {
      const afk = await this.container.redis.jsonGet(mention, "Afk");
      if (afk) afks.set(mention, afk);
    }

    if (afks.size === 0) return;

    const guildSettings = await this.container.redis.jsonGet(
      message.guild.id,
      "GuildSettings"
    );

    const ephemeralBtn = new ComponentUtils.EphemeralButton();
    const ephemeralRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ephemeralBtn
    );

    const t = await fetchT(message);

    const users = Array.from(afks.keys());
    // if (afks.size === 1) {
    //   const userId = users[0];
    //   const afk = afks.get(userId)!;

    //   const embed = new EmbedUtils.EmbedConstructor()
    //     .setTitle(t(LanguageKeys.Commands.Utility.Afk.activeTitle))
    //     .setDescription(
    //       t(LanguageKeys.Commands.Utility.Afk.activeDescription, {
    //         user: `<@${userId}>`,
    //       })
    //     );
    //   if (afk.text)
    //     embed.addField(
    //       t(LanguageKeys.Commands.Utility.Afk.activeReason),
    //       afk.text
    //     );

    //   const msg = await message.reply({
    //     embeds: [embed],
    //     components: [ephemeralRow],
    //   });
    //   ephemeralBtn.waitForResponse(msg, 10000);
    //   setTimeout(() => {
    //     msg.delete().catch();
    //   }, (guildSettings?.ephemeralDeletionTimeout ?? 10) * 1000);
    //   return;
    // }

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
        summary.setThumbnail(afk.attachment);
      }
    }

    const response = await message.reply({
      embeds: [summary],
      components: [ephemeralRow],
      files: messageAttachment ? [messageAttachment] : undefined,
    });

    const timeToDelete = (guildSettings?.ephemeralDeletionTimeout ?? 10) * 1000;

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
      .on("collect", async (btn) => {
        const oldPage = interacted.get(btn.user.id);
        if (oldPage) {
          oldPage.collector?.stop("messageDelete");
          if (oldPage.response) {
            if (oldPage.response instanceof Message) {
              oldPage.response.delete().catch();
            } else {
              oldPage.response.deleteReply().catch();
            }
          }
        }
        const pageInteraction = await this.handleButton(btn, afks);
        if (!pageInteraction) return;
        interacted.set(btn.user.id, pageInteraction);
      });

    setTimeout(() => {
      response.delete().catch();
    }, timeToDelete);
  }

  private async handleButton(btn: ButtonInteraction, afks: Map<string, Afk>) {
    await btn.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await fetchT(btn);

    const pages = await this.createPages(t, afks);
    if (pages.length === 1) {
      await btn.editReply(pages[0]);
      return;
    }

    const paginate = new ComponentUtils.MenuPaginatedMessage();
    pages.forEach((page) => paginate.addPageBuilder(page));

    return await paginate.run(btn);
  }

  private async createPages(
    t: TFunction,
    afks: Map<string, Afk>
  ): Promise<MessageBuilder[]> {
    const pages = [];
    for (const afk of afks) {
      const user = await this.container.client.users
        .fetch(afk[0])
        .catch(() => null);
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(
          `${t(LanguageKeys.Commands.Utility.Afk.activeTitle)} | ${user?.username ?? afk[0]
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
}
