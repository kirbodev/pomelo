import type { TFunction } from "@sapphire/plugin-i18next";
import { z } from "zod";
import { LanguageKeys } from "../i18n/languageKeys.js";
import type { PunishResult } from "./types.js";

/** Feature prefix for the persistent warn-level confirmation buttons. */
export const WARN_LEVEL_FEATURE = "wl";

/** Matches the warn workflow TTL (7 days). */
export const WARN_LEVEL_SESSION_TTL_SECONDS = 604_800;

export const WarnLevelSession = z.object({
  guildId: z.string(),
  channelId: z.string(),
  messageId: z.string(),
  moderatorId: z.string(),
  targetId: z.string(),
  reason: z.string().optional(),
  level: z.object({
    warnCount: z.number(),
    punishments: z.array(
      z.object({
        type: z.enum(["mute", "kick", "ban", "role"]),
        duration: z.number().optional(),
        roleId: z.string().optional(),
        deleteMessageDays: z
          .union([
            z.literal(0),
            z.literal(86400),
            z.literal(259200),
            z.literal(604800),
          ])
          .optional(),
      }),
    ),
    message: z.string().optional(),
    autoConfirm: z.boolean(),
  }),
});

export type WarnLevelSessionData = z.infer<typeof WarnLevelSession>;

export function punishmentResultLine(p: PunishResult, t: TFunction): string {
  const key =
    p.punishment.type === "mute"
      ? LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentMute
      : p.punishment.type === "kick"
        ? LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
            .punishmentKick
        : p.punishment.type === "ban"
          ? p.punishment.duration
            ? LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
                .punishmentBan
            : LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
                .punishmentBanPerm
          : LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
              .punishmentRole;
  const status = p.success ? "✅" : "❌";
  return status + " " + t(key) + (p.error ? " (" + p.error + ")" : "");
}
