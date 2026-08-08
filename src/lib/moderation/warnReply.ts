import { Command } from "@sapphire/framework";
import { fetchT, type TFunction } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  GuildMember,
  Message,
  MessageFlags,
  TextDisplayBuilder,
  type InteractionReplyOptions,
  type MessageReplyOptions,
} from "discord.js";
import { nanoid } from "nanoid";
import { LanguageKeys } from "../i18n/languageKeys.js";
import { Colors } from "../colors.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import {
  PomeloReplyType,
  type PomeloReplyOptions,
} from "../../utilities/commandUtils.js";
import { userMention } from "../helpers/stringUtils.js";
import { modActionService } from "./actions.js";
import {
  punishmentLabel,
  warnCountDescKey,
  warnHistoryFieldValue,
} from "./actionEmbed.js";
import { buildQuickActionRow } from "./quickActionRow.js";
import type { WarnActionResult, WarnLevel } from "./types.js";
import {
  createComponentId,
  deleteComponentSession,
  saveComponentSession,
} from "../helpers/componentSessions.js";
import {
  WARN_LEVEL_FEATURE,
  WARN_LEVEL_SESSION_TTL_SECONDS,
  type WarnLevelSessionData,
} from "./levelConfirm.js";

/**
 * Minimal surface of PomeloCommand/PomeloSubcommand that the shared warn
 * reply helpers need. Both base classes delegate to the same utility, so
 * either command flavor can host these helpers.
 */
export interface WarnReplyHost {
  reply(
    interaction: Command.ChatInputCommandInteraction | Message,
    options: InteractionReplyOptions | MessageReplyOptions,
    pomeloOptions: PomeloReplyOptions,
  ): Promise<unknown>;
}

/**
 * Replies to a warn / warn-level action with the outcome, including any
 * threshold punishments that ran (or still need manual confirmation).
 */
export async function handleWarnResult(
  host: WarnReplyHost,
  target: Command.ChatInputCommandInteraction | Message,
  result: WarnActionResult,
  member: GuildMember,
) {
  const t = await fetchT(target);
  if (!result.success) {
    const errorKey =
      result.error === "botHierarchyTooLow"
        ? LanguageKeys.Commands.Moderation.Errors.botHierarchyTooLow
        : LanguageKeys.Commands.Moderation.Errors.hierarchyTooLow;
    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Error)
      .setDescription(t(errorKey));
    await host.reply(
      target,
      { embeds: [embed] },
      { type: PomeloReplyType.Error },
    );
    return;
  }

  const user = userMention(member.user);
  const desc = t(warnCountDescKey(result.warnCount), {
    user,
    count: result.warnCount,
  });

  const fields: Array<{
    name: string;
    value: string;
    inline: boolean;
  }> = [];

  if (result.case?.reason) {
    fields.push({
      name: t(LanguageKeys.Commands.Moderation.Fields.reason),
      value: result.case.reason,
      inline: false,
    });
  }

  let punishmentCount = 0;
  if (result.thresholdActions?.length) {
    for (const ta of result.thresholdActions) {
      const levelNote = ` (${t(
        LanguageKeys.Commands.Moderation.Warn.punishmentAtLevel,
        { level: ta.level.warnCount },
      )})`;
      if (ta.autoExecuted && ta.results) {
        for (const pr of ta.results) {
          punishmentCount++;
          const label = punishmentLabel(pr.punishment, t);
          fields.push({
            name:
              punishmentCount === 1
                ? t(LanguageKeys.Commands.Moderation.Warn.punishment)
                : t(LanguageKeys.Commands.Moderation.Warn.punishmentN, {
                    n: punishmentCount,
                  }),
            value: pr.success
              ? `${label} ✅${levelNote}`
              : `${label} ❌${levelNote}`,
            inline: false,
          });
        }
      } else if (ta.error) {
        for (const p of ta.level.punishments) {
          punishmentCount++;
          fields.push({
            name:
              punishmentCount === 1
                ? t(LanguageKeys.Commands.Moderation.Warn.punishment)
                : t(LanguageKeys.Commands.Moderation.Warn.punishmentN, {
                    n: punishmentCount,
                  }),
            value: `${punishmentLabel(p, t)} ❌${levelNote}`,
            inline: false,
          });
        }
      } else {
        const requested = await requestLevelConfirmation(
          target,
          ta.level,
          member,
          t,
        );
        punishmentCount++;
        fields.push({
          name:
            punishmentCount === 1
              ? t(LanguageKeys.Commands.Moderation.Warn.punishment)
              : t(LanguageKeys.Commands.Moderation.Warn.punishmentN, {
                  n: punishmentCount,
                }),
          value: requested
            ? `${ta.level.punishments
                .map((p) => punishmentLabel(p, t))
                .join(", ")} ⏳ ${t(
                LanguageKeys.Commands.Moderation.Warn.punishmentWaiting,
              )}${levelNote}`
            : `${ta.level.punishments
                .map((p) => punishmentLabel(p, t))
                .join(", ")} ❌${levelNote}`,
          inline: false,
        });
      }
    }
  }

  fields.push({
    name: t(LanguageKeys.Commands.Moderation.Fields.dm),
    value: result.dmSent
      ? t(LanguageKeys.Commands.Moderation.Kick.dmSent)
      : t(LanguageKeys.Commands.Moderation.Kick.dmNotSent),
    inline: true,
  });

  const historyGuildId = target.guildId ?? target.guild?.id;
  if (historyGuildId) {
    const history = await modActionService.getWarnHistory(
      historyGuildId,
      member.id,
    );
    fields.push({
      name: t(LanguageKeys.Commands.Moderation.Warn.historyField),
      value: warnHistoryFieldValue(history, t),
      inline: false,
    });
  }

  const embed = new EmbedUtils.EmbedConstructor()
    .setColor(Colors.Success)
    .setTitle(t(LanguageKeys.Commands.Moderation.Warn.title))
    .setDescription(desc)
    .addFields(fields);

  const guildId = target.guildId ?? target.guild?.id;
  const moderatorId =
    target instanceof Message ? target.author.id : target.user.id;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- pre-existing conditional on partially-typed target union
  const channelId = target.channelId ?? target.channel?.id;
  const quickActions =
    guildId && channelId
      ? await buildQuickActionRow({
          guildId,
          moderatorId,
          targetId: member.id,
          channelId,
          executedAction: "warn",
          t,
        })
      : { row: null };

  await host.reply(
    target,
    {
      embeds: [embed],
      ...(quickActions.row ? { components: [quickActions.row] } : {}),
    },
    { type: PomeloReplyType.Success },
  );
}

/**
 * Sends a persistent confirmation dialog for a manually-confirmed warn
 * level. The buttons are routed through the warnLevelConfirm interaction
 * handler with the pending punishment stored in Redis, so the confirmation
 * survives restarts and doesn't rely on an in-memory collector.
 */
async function requestLevelConfirmation(
  target: Command.ChatInputCommandInteraction | Message,
  level: WarnLevel,
  member: GuildMember,
  t: TFunction,
): Promise<boolean> {
  const channel = target.channel;
  const guild = target.guild;
  if (!channel || !guild || !("send" in channel)) return false;

  const moderatorId =
    target instanceof Message ? target.author.id : target.user.id;

  const punishmentsSummary = level.punishments
    .map((p) => {
      if (p.type === "mute")
        return t(
          LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
            .punishmentMute,
        );
      if (p.type === "ban")
        return p.duration
          ? t(
              LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
                .punishmentBan,
            )
          : t(
              LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
                .punishmentBanPerm,
            );
      if (p.type === "kick")
        return t(
          LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
            .punishmentKick,
        );
      return t(
        LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole,
      );
    })
    .join(", ");

  const sessionId = nanoid();
  const session: WarnLevelSessionData = {
    guildId: guild.id,
    channelId: channel.id,
    messageId: "pending",
    moderatorId,
    targetId: member.id,
    level,
  };
  await saveComponentSession(
    WARN_LEVEL_FEATURE,
    sessionId,
    session,
    WARN_LEVEL_SESSION_TTL_SECONDS,
  );

  const dialogContainer = new ContainerBuilder()
    .setAccentColor(Colors.Warning)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### " +
          t(
            LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
              .confirmLevelTitle,
            { level: level.warnCount },
          ) +
          "\n" +
          t(
            LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
              .confirmLevelDesc,
            { punishments: punishmentsSummary },
          ),
      ),
    );
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(createComponentId(WARN_LEVEL_FEATURE, sessionId, "confirm"))
      .setLabel(
        t(
          LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
            .confirmLevelConfirm,
        ),
      )
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(createComponentId(WARN_LEVEL_FEATURE, sessionId, "cancel"))
      .setLabel(
        t(
          LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
            .confirmLevelCancel,
        ),
      )
      .setStyle(ButtonStyle.Secondary),
  );

  const sent = await channel
    .send({
      components: [dialogContainer, buttons],
      flags: MessageFlags.IsComponentsV2,
    })
    .catch(() => null);
  if (!sent) {
    await deleteComponentSession(WARN_LEVEL_FEATURE, sessionId);
    return false;
  }

  // Bind the session to the sent message so the handler can reject clicks
  // from anywhere else.
  await saveComponentSession(
    WARN_LEVEL_FEATURE,
    sessionId,
    { ...session, messageId: sent.id },
    WARN_LEVEL_SESSION_TTL_SECONDS,
  );
  return true;
}
