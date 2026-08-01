import { container, Events, Listener } from "@sapphire/framework";
import { Message } from "discord.js";
import type { Afk } from "../../db/redis/schema.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { type TFunction } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import { MessageBuilder } from "@sapphire/discord.js-utilities";
import { convertToDiscordTimestamp } from "../../lib/helpers/timestamp.js";
import { getAFKData, sendAFKEmbed } from "../../lib/helpers/afk.js";

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
      const afk = await getAFKData(mention);
      if (!afk) continue;
      afks.set(mention, afk);
    }

    if (afks.size === 0) return;

    return sendAFKEmbed(afks, message);
  }
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
