import { z } from "zod";
import type { WarnLevel, WarnPunishment, WarnWorkflowState } from "./types.js";

const MAX_LEVEL_MESSAGE = 1000;
const MAX_TIMEOUT_DURATION = 2_419_200_000;
const deleteMessageDaysSchema = z.union([
  z.literal(0),
  z.literal(86_400),
  z.literal(259_200),
  z.literal(604_800),
]);

const punishmentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("mute"),
      duration: z.number().int().positive().max(MAX_TIMEOUT_DURATION),
    })
    .strict(),
  z.object({ type: z.literal("kick") }).strict(),
  z
    .object({
      type: z.literal("ban"),
      duration: z.number().int().positive().optional(),
      deleteMessageDays: deleteMessageDaysSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("role"),
      roleId: z.string().trim().min(1),
    })
    .strict(),
]);

const warnLevelSchema = z
  .object({
    warnCount: z.number().int().positive(),
    punishments: z.array(punishmentSchema).max(25),
    message: z.string().max(MAX_LEVEL_MESSAGE).optional(),
    autoConfirm: z.boolean(),
  })
  .strict()
  .superRefine((level, context) => {
    if (
      level.punishments.filter(
        (punishment) => punishment.type === "kick" || punishment.type === "ban",
      ).length > 1
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom });
    }
  });

const workflowConfigSchema = z
  .object({
    defaultExpiryDays: z.number().int().min(0).max(365),
    dmOnWarn: z.boolean(),
    logChannelId: z.string().trim().min(1).nullable().optional(),
    levels: z.array(warnLevelSchema).max(25),
  })
  .strict()
  .superRefine((config, context) => {
    const thresholds = new Set<number>();
    for (const level of config.levels) {
      if (thresholds.has(level.warnCount)) {
        context.addIssue({ code: z.ZodIssueCode.custom });
        return;
      }
      thresholds.add(level.warnCount);
    }
  });

const workflowStateSchema = z
  .object({
    id: z.string().trim().min(1),
    revision: z.number().int().positive(),
    ownerId: z.string().trim().min(1),
    guildId: z.string().trim().min(1),
    messageId: z.string().trim().min(1),
    status: z.enum(["active", "completed", "cancelled", "expired"]),
    expiresAt: z.number().int().positive(),
    step: z.number().int().min(1).max(7),
    editingLevelIndex: z.number().int().min(0).optional(),
    editingGeneralSetting: z.enum(["expiry", "dm", "logChannel"]).optional(),
    editingLevelSetting: z.enum(["menu", "message", "autoConfirm"]).optional(),
    selectedPunishmentIndex: z.number().int().min(0).optional(),
    addPunishmentStep: z.enum(["type", "duration", "role", "confirm"]).optional(),
    addPunishmentType: z.enum(["mute", "kick", "ban", "role"]).optional(),
    addPunishmentDraft: z
      .object({
        type: z.enum(["mute", "kick", "ban", "role"]).optional(),
        duration: z.number().int().positive().optional(),
        roleId: z.string().trim().min(1).optional(),
      })
      .optional(),
    hadExistingSettings: z.boolean().optional(),
    backupAvailable: z.boolean().optional(),
    resetStage: z.enum(["confirm", "done", "restored"]).optional(),
    restoreExpiresAt: z.number().int().positive().optional(),
    config: workflowConfigSchema,
  })
  .strict();

type LegacyAction = {
  warnCount: number;
  actionType: "none" | "mute" | "kick" | "ban" | "role" | "message";
  duration?: number;
  roleId?: string;
  autoConfirm: boolean;
};

const legacyActionSchema = z
  .object({
    warnCount: z.number().int().positive(),
    actionType: z.enum(["none", "mute", "kick", "ban", "role", "message"]),
    duration: z.number().int().positive().optional(),
    roleId: z.string().trim().min(1).optional(),
    autoConfirm: z.boolean(),
  })
  .passthrough();

const legacyToPunishment = (a: LegacyAction): WarnPunishment | null => {
  switch (a.actionType) {
    case "mute":
      return { type: "mute", duration: a.duration };
    case "kick":
      return { type: "kick" };
    case "ban":
      return { type: "ban", duration: a.duration };
    case "role":
      return { type: "role", roleId: a.roleId };
    case "none":
    case "message":
    default:
      return null;
  }
};

export function normalizeActions(raw: string | null | undefined): WarnLevel[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const byCount = new Map<
    number,
    { level: WarnLevel; source: "legacy" | "new" }
  >();
  const rejectedThresholds = new Set<number>();
  for (const entry of parsed) {
    const newLevel = validateWarnLevel(entry);
    if (newLevel) {
      if (rejectedThresholds.has(newLevel.warnCount)) continue;
      const existing = byCount.get(newLevel.warnCount);
      if (existing) {
        byCount.delete(newLevel.warnCount);
        rejectedThresholds.add(newLevel.warnCount);
      } else {
        byCount.set(newLevel.warnCount, {
          level: newLevel,
          source: "new",
        });
      }
      continue;
    }
    const legacy = legacyActionSchema.safeParse(entry);
    if (legacy.success) {
      if (rejectedThresholds.has(legacy.data.warnCount)) continue;
      const punishment = legacyToPunishment(legacy.data);
      const validPunishment = punishmentSchema.safeParse(punishment);
      const existing = byCount.get(legacy.data.warnCount);
      if (existing) {
        if (existing.source === "new") {
          byCount.delete(legacy.data.warnCount);
          rejectedThresholds.add(legacy.data.warnCount);
        } else if (validPunishment.success) {
          existing.level.punishments.push(validPunishment.data);
        }
      } else {
        byCount.set(legacy.data.warnCount, {
          level: {
            warnCount: legacy.data.warnCount,
            punishments: validPunishment.success ? [validPunishment.data] : [],
            autoConfirm: legacy.data.autoConfirm,
          },
          source: "legacy",
        });
      }
    }
  }

  return [...byCount.values()]
    .map((entry) => entry.level)
    .sort((a, b) => a.warnCount - b.warnCount);
}

export function sanitizeLevelMessage(text: string): string {
  const stripped = text
    .replace(/@everyone/gi, "everyone")
    .replace(/@here/gi, "here")
    .replace(/<@&\d+>/g, "")
    .replace(/  +/g, " ")
    .trim();
  return stripped.slice(0, MAX_LEVEL_MESSAGE);
}

export function validateWarnLevel(level: unknown): WarnLevel | null {
  const result = warnLevelSchema.safeParse(level);
  if (!result.success) return null;

  return result.data.message === undefined
    ? result.data
    : { ...result.data, message: sanitizeLevelMessage(result.data.message) };
}

export function validateWorkflowState(raw: unknown): WarnWorkflowState | null {
  const result = workflowStateSchema.safeParse(raw);
  if (!result.success || result.data.expiresAt <= Date.now()) return null;
  return result.data;
}
