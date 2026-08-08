import type { TFunction } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../i18n/languageKeys.js";
import type { WarnHistory, WarnPunishment } from "./types.js";
import ms from "../helpers/ms.js";
import { convertToDiscordTimestamp } from "../helpers/timestamp.js";

export type WarnCountDescKey =
  | typeof LanguageKeys.Commands.Moderation.Warn.desc
  | typeof LanguageKeys.Commands.Moderation.Warn.descTwice
  | typeof LanguageKeys.Commands.Moderation.Warn.descThrice
  | typeof LanguageKeys.Commands.Moderation.Warn.descTimes;

/**
 * Picks the description key for a warn count: once (plain), twice, thrice,
 * or N times.
 */
export function warnCountDescKey(amount: number): WarnCountDescKey {
  if (amount === 1) return LanguageKeys.Commands.Moderation.Warn.desc;
  if (amount === 2) return LanguageKeys.Commands.Moderation.Warn.descTwice;
  if (amount === 3) return LanguageKeys.Commands.Moderation.Warn.descThrice;
  return LanguageKeys.Commands.Moderation.Warn.descTimes;
}

/**
 * Localized label for a threshold punishment, e.g. "Mute for 1h",
 * "Kick", "Ban for 7d", "Permanent ban", "Role".
 */
export function punishmentLabel(p: WarnPunishment, t: TFunction): string {
  if (p.type === "mute" && p.duration)
    return t(LanguageKeys.Commands.Moderation.Warn.punishmentMuteFor, {
      duration: ms(p.duration),
    });
  if (p.type === "mute")
    return t(
      LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentMute,
    );
  if (p.type === "kick")
    return t(
      LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentKick,
    );
  if (p.type === "ban" && p.duration)
    return t(LanguageKeys.Commands.Moderation.Warn.punishmentBanFor, {
      duration: ms(p.duration),
    });
  if (p.type === "ban")
    return t(
      LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
        .punishmentBanPerm,
    );
  return t(
    LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole,
  );
}

/**
 * Renders the "Warn history" field: a counts line plus up to three recent
 * active warns.
 */
export function warnHistoryFieldValue(
  history: WarnHistory,
  t: TFunction,
): string {
  const lines = [
    t(LanguageKeys.Commands.Moderation.Warn.historyCounts, {
      active: history.active,
      expired: history.expired,
      total: history.total,
    }),
  ];
  for (const entry of history.recent.slice(0, 3)) {
    const reason =
      entry.reason || t(LanguageKeys.Commands.Moderation.Fields.noReason);
    lines.push(
      entry.expiresAt
        ? t(LanguageKeys.Commands.Moderation.Warn.historyEntry, {
            id: String(entry.id),
            reason,
            expiry: convertToDiscordTimestamp(entry.expiresAt, "R"),
          })
        : t(LanguageKeys.Commands.Moderation.Warn.historyEntryNoExpiry, {
            id: String(entry.id),
            reason,
          }),
    );
  }
  return lines.join("\n");
}
