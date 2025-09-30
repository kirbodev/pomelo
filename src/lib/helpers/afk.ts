import { container } from "@sapphire/framework";
import ComponentUtils from "../../utilities/componentUtils.js";
import {
  DEFAULT_EPHEMERAL_DELETION_TIMEOUT,
  URGENT_PING,
} from "./constants.js";
import {
  ActionRowBuilder,
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  ButtonBuilder,
  ComponentType,
  Message,
  TimestampStyles,
} from "discord.js";
import { convertToDiscordTimestamp } from "./timestamp.js";
import { LanguageKeys } from "../i18n/languageKeys.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { fetchT, type TFunction } from "@sapphire/plugin-i18next";
import {
  GuildMemberLimits,
  type AnyInteractableInteraction,
} from "@sapphire/discord.js-utilities";
import { Afk } from "../../db/redis/schema.js";
import { handleButton } from "../../listeners/afk/lookForMentions.js";
import { Emojis } from "../emojis.js";
import { recentReversions } from "../../listeners/afk/preventAutomodRuleEdit.js";
import { Colors } from "../colors.js";

export async function getAFKData(userId: string) {
  let afkData = await container.redis.jsonGet(userId, "Afk");
  if (!afkData) afkData = await container.redis.jsonGet(`${userId}AUTO`, "Afk");
  return afkData;
}

export async function deleteAFKData(userId: string) {
  const pathsDeleted = await container.redis.jsonDel(userId, "Afk");
  if (pathsDeleted === 0) {
    return await container.redis.jsonDel(`${userId}AUTO`, "Afk");
  }
}

export async function removeAutomod(userId: string) {
  const guilds = await container.client.guilds.fetch();
  for (const oauthGuild of guilds.values()) {
    const guild = await oauthGuild.fetch().catch(() => null);
    if (!guild) continue;
    const autoModRules = await guild.autoModerationRules
      .fetch()
      .catch(() => null);
    if (!autoModRules) continue;
    const afkRule = autoModRules.find(
      (r) => r.creatorId === container.client.id && r.name.includes("AFK"),
    );
    if (!afkRule) continue;
    const blockedAfks = [...afkRule.triggerMetadata.keywordFilter];
    const blockedIndex = blockedAfks.indexOf(userId);
    if (blockedIndex > -1) blockedAfks.splice(blockedIndex, 1);

    const allowList = [...afkRule.triggerMetadata.allowList];
    const allowListIndex = allowList.indexOf(userId);
    if (allowListIndex > -1) allowList.splice(allowListIndex, 1);

    recentReversions.set(afkRule.id, Date.now());
    setTimeout(() => {
      recentReversions.delete(afkRule.id);
    }, 5000).unref();

    console.log(blockedAfks, allowList);

    if (blockedAfks.length === 0) {
      await afkRule.edit({
        triggerMetadata: {
          // you cannot have an empty list of keywords - * doesn't do anything
          keywordFilter: ["*"],
          allowList: ["*"],
        },
      });
    } else {
      await afkRule.edit({
        triggerMetadata: {
          keywordFilter: blockedAfks,
          allowList,
        },
      });
    }
  }
}

export function createAutoAFKMessage(newStartTime: Date, newEndTime: Date) {
  const startTime = newStartTime.getTime();
  const endTime = newEndTime.getTime();
  const timeOverflow = endTime - startTime;
  let longTime = false;
  if (timeOverflow > 24 * 60 * 60 * 1000) {
    longTime = true;
  }

  return `${Emojis.Automatic} ${convertToDiscordTimestamp(
    startTime,
    longTime ? "f" : "t",
  )} - ${convertToDiscordTimestamp(endTime, longTime ? "f" : "t")}`;
}

export async function sendAFKEmbed(
  afks: Map<string, Afk>,
  message: Message | AnyInteractableInteraction,
  withButton = true,
  deleteMsg = true,
) {
  if (!(message instanceof Message)) {
    if (!message.inGuild()) return;
  }
  const guildSettings = message.guildId
    ? await container.redis.jsonGet(message.guildId, "GuildSettings")
    : null;

  const ephemeralBtn = new ComponentUtils.EphemeralButton();
  const ephemeralRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ephemeralBtn,
  );

  const t = await fetchT(message);

  const users = Array.from(afks.keys());

  const description =
    users.length > 1
      ? `${t(LanguageKeys.Commands.Utility.Afk.activeDescription_multiple, {
          users: users
            .slice(0, -1)
            .map((user) => `<@${user}>`)
            .join(", "),
          last_user: `<@${users[users.length - 1]}>`,
        })}\n${t(LanguageKeys.Commands.Utility.Afk.activeSeeMore)}`
      : t(LanguageKeys.Commands.Utility.Afk.activeDescription, {
          user: `<@${users[0]}>`,
        });

  const summary = new EmbedUtils.EmbedConstructor()
    .setTitle(t(LanguageKeys.Commands.Utility.Afk.activeTitle))
    .setDescription(description);

  if (afks.size === 1) {
    const afk = Array.from(afks.values())[0];
    if (afk.text)
      summary.addField(
        t(LanguageKeys.Commands.Utility.Afk.activeReason),
        afk.text,
      );
    if (afk.attachment) {
      summary.setImage(afk.attachment);
    }
    if (afk.endsAt) {
      summary.addField(
        t(LanguageKeys.Commands.Utility.Afk.activeUntil),
        convertToDiscordTimestamp(new Date(afk.endsAt).getTime(), "f"),
      );
    }
  }

  const args = {
    embeds: [summary],
    components: withButton ? [ephemeralRow] : [],
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

export function getAFKSetEmbed(
  t: TFunction,
  message?: string,
  duration?: number,
  attachment?: string,
  afkExists = false,
) {
  const durationAsTimestamp = duration
    ? convertToDiscordTimestamp(
        Date.now() + duration,
        TimestampStyles.ShortDateTime,
      )
    : null;
  let description: string;
  if (message && duration) {
    description = t(
      LanguageKeys.Commands.Utility.Afk.desc_with_message_and_duration,
      {
        message,
        time: durationAsTimestamp,
      },
    );
  } else if (message) {
    description = t(LanguageKeys.Commands.Utility.Afk.desc_with_message, {
      message,
    });
  } else if (duration) {
    description = t(LanguageKeys.Commands.Utility.Afk.desc_with_duration, {
      time: durationAsTimestamp,
    });
  } else {
    description = t(LanguageKeys.Commands.Utility.Afk.desc);
  }

  //NOTE - Might want to change; overwrite note is shown even if data is identical

  if (afkExists)
    description += `\n${t(LanguageKeys.Commands.Utility.Afk.overwriteNote)}`;

  const embed = new EmbedUtils.EmbedConstructor()
    .setTitle(t(LanguageKeys.Commands.Utility.Afk.title))
    .setDescription(description)
    .setColor(Colors.Success);

  if (attachment) embed.setImage(attachment);

  return embed;
}

export async function setAfk(userId: string, afkData: Afk, alreadyAfk = false) {
  // parse with zod
  const data = Afk.safeParse(afkData);
  if (!data.success) return false;

  const success = await container.redis.jsonSet(userId, "Afk", data.data);
  if (!success) return false;
  const expire = data.data.endsAt
    ? await container.redis.expireat(
        `Afk:${userId}`,
        Math.round(new Date(data.data.endsAt).getTime() / 1000) + 5000,
      )
    : true;
  if (!expire) return false;

  if (data.data.endsAt)
    await container.tasks.create(
      {
        name: "guaranteeAFKRemoval",
        payload: {
          userId,
        },
      },
      new Date(data.data.endsAt).getTime() - Date.now(),
    );

  if (alreadyAfk) return true;

  const user = await container.client.users.fetch(userId).catch(() => null);
  if (!user) return false;

  const fetchedGuilds = await container.client.guilds.fetch().catch(() => null);
  if (!fetchedGuilds) return false;

  const guilds = (
    await Promise.all(
      Array.from(fetchedGuilds.values()).map(
        async (g) => await g.fetch().catch(() => null),
      ),
    ).catch(() => null)
  )?.filter((g) => g !== null);

  if (!guilds) return false;

  const pastUsernames: { guildId: string; username: string }[] = [];
  for (const guild of guilds) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const settings = await container.redis.jsonGet(guild.id, "GuildSettings");
    if (!settings) continue;
    const userSettings = await container.redis.jsonGet(userId, "UserSettings");

    if (settings.afkEnabled) {
      const memberName = member.nickname ?? member.displayName;
      if (!memberName.startsWith("[AFK]")) {
        const shouldTrim =
          `[AFK] ${memberName}`.length >
          GuildMemberLimits.MaximumDisplayNameLength;
        const trimmedName = shouldTrim
          ? `[AFK] ${memberName}`.slice(
              0,
              GuildMemberLimits.MaximumDisplayNameLength,
            )
          : `[AFK] ${memberName}`;
        const nick = await member.setNickname(trimmedName).catch(() => null);
        if (nick && shouldTrim)
          pastUsernames.push({ guildId: guild.id, username: memberName });
      }

      if (settings.blockAfkMentions) {
        const autoModRules = await guild.autoModerationRules
          .fetch()
          .catch(() => null);
        if (!autoModRules) continue;

        const afkRule = autoModRules.find(
          (r) => r.creatorId === container.client.id && r.name.includes("AFK"),
        );

        const blockedAfks = [...(afkRule?.triggerMetadata.keywordFilter ?? [])];
        if (blockedAfks.includes(`<@${member.id}>`)) continue;
        blockedAfks.push(`<@${member.id}>`);

        const allowList = [...(afkRule?.triggerMetadata.allowList ?? [])];
        if (!userSettings || userSettings.allowUrgentPings)
          allowList.push(`${URGENT_PING}<@${member.id}>`);

        if (afkRule) {
          const action = afkRule.actions[0];
          const guildT = await fetchT(guild);
          const customMessage = guildT(
            LanguageKeys.Commands.Utility.Afk.blockedAfk,
          );
          action.metadata.customMessage = customMessage;

          recentReversions.set(afkRule.id, Date.now());
          setTimeout(() => {
            recentReversions.delete(afkRule.id);
          }, 5000).unref();

          await afkRule
            .edit({
              triggerMetadata: {
                allowList,
                keywordFilter: blockedAfks,
              },
              actions: [action],
            })
            .catch(() => null);
        } else {
          const guildT = await fetchT(guild);
          const customMessage = guildT(
            LanguageKeys.Commands.Utility.Afk.blockedAfk,
          );

          await guild.autoModerationRules
            .create({
              enabled: true,
              actions: [
                {
                  type: AutoModerationActionType.BlockMessage,
                  metadata: {
                    customMessage,
                  },
                },
              ],
              name: "AFK - Pomelo",
              eventType: AutoModerationRuleEventType.MessageSend,
              triggerType: AutoModerationRuleTriggerType.Keyword,
              triggerMetadata: {
                keywordFilter: blockedAfks,
                allowList,
              },
            })
            .catch(() => null);
        }
      }
    }
  }

  if (pastUsernames.length > 0) {
    await container.redis.jsonSet(userId, "Afk", {
      ...afkData,
      pastUsername: pastUsernames,
    });
  }

  return true;
}
