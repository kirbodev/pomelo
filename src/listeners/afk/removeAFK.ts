import { Listener } from "@sapphire/framework";
import { Events } from "@sapphire/framework";
import type { Message } from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { fetchT } from "@sapphire/plugin-i18next";
import { Colors } from "../../lib/colors.js";
import { PomeloReplyType } from "../../utilities/commandUtils.js";
import { DEFAULT_EPHEMERAL_DELETION_TIMEOUT } from "../../lib/helpers/constants.js";
import ms from "ms";
import { recentReversions } from "./preventAutomodRuleEdit.js";

const NO_REMOVE_AFK_PREFIXES = [
  "--afk",
  "-afk",
  "——afk",
  "—afk",
  "––afk",
  "–afk",
];

export class RemoveAFKListener extends Listener {
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

    const guildSettings = await this.container.redis.jsonGet(
      message.guild.id,
      "GuildSettings"
    );
    if (message.content.startsWith(guildSettings?.prefix ?? ",")) return;

    const t = await fetchT(message);
    const afkData = await this.container.redis.jsonGet(
      message.author.id,
      "Afk"
    );
    if (!afkData) return;
    if (afkData.endsAt && new Date(afkData.endsAt) < new Date()) {
      await this.container.redis.jsonDel(message.author.id, "Afk");
    }
    if (afkData.eventId) return;
    if (
      NO_REMOVE_AFK_PREFIXES.some((prefix) =>
        message.content.toLowerCase().trim().endsWith(prefix)
      )
    )
      return;

    await this.container.redis.jsonDel(message.author.id, "Afk");

    if (message.member?.nickname && message.member.nickname.startsWith("[AFK]"))
      await message.member
        .setNickname(message.member.nickname.replace("[AFK] ", ""))
        .catch(() => null);

    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(t(LanguageKeys.Commands.Utility.Afk.removeTitle))
      .setDescription(
        t(LanguageKeys.Commands.Utility.Afk.removeDescription, {
          time: ms(Date.now() - new Date(afkData.startedAt).getTime(), {
            long: true,
          }),
        })
      )
      .setFooter({
        text: t(LanguageKeys.Commands.Utility.Afk.removeTip),
      })
      .setColor(Colors.Success);

    const autoModRules = await message.guild.autoModerationRules
      .fetch()
      .catch(() => null);
    if (autoModRules) {
      const afkRule = autoModRules.find(
        (r) => r.creatorId === message.client.id && r.name.includes("AFK")
      );
      if (afkRule) {
        const blockedAfks = [...afkRule.triggerMetadata.keywordFilter];
        const blockedIndex = blockedAfks.indexOf(message.author.id);
        if (blockedIndex > -1) blockedAfks.splice(blockedIndex, 1);

        const allowList = [...afkRule.triggerMetadata.allowList];
        const allowListIndex = allowList.indexOf(message.author.id);
        if (allowListIndex > -1) allowList.splice(allowListIndex, 1);

        recentReversions.set(afkRule.id, Date.now());
        setTimeout(() => {
          recentReversions.delete(afkRule.id);
        }, 5000).unref();

        await afkRule.edit({
          triggerMetadata: {
            keywordFilter: blockedAfks,
            allowList,
          },
        });
      }
    }

    await this.container.utilities.commandUtils
      .reply(
        message,
        {
          embeds: [embed],
        },
        {
          type: PomeloReplyType.Success,
        }
      )
      .then((m) => {
        setTimeout(() => {
          void m.delete();
        }, (guildSettings?.ephemeralDeletionTimeout ?? DEFAULT_EPHEMERAL_DELETION_TIMEOUT) * 1000);
      });
  }
}
