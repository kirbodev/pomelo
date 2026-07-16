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
  .strict();

const workflowStateSchema = z
  .object({
    id: z.string().trim().min(1),
    revision: z.number().int().positive(),
    ownerId: z.string().trim().min(1),
    guildId: z.string().trim().min(1),
    messageId: z.string().trim().min(1),
    status: z.enum(["active", "completed", "cancelled", "expired"]),
    expiresAt: z.number().int().positive(),
    step: z.number().int().min(1).max(6),
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

  const byCount = new Map<number, WarnLevel>();
  for (const entry of parsed) {
    const newLevel = validateWarnLevel(entry);
    if (newLevel) {
      const existing = byCount.get(newLevel.warnCount);
      if (existing) {
        existing.punishments.push(...newLevel.punishments);
        if (newLevel.message && !existing.message)
          existing.message = newLevel.message;
      } else {
        byCount.set(newLevel.warnCount, {
          warnCount: newLevel.warnCount,
          punishments: [...newLevel.punishments],
          message: newLevel.message,
          autoConfirm: newLevel.autoConfirm,
        });
      }
      continue;
    }
    const legacy = legacyActionSchema.safeParse(entry);
    if (legacy.success) {
      const punishment = legacyToPunishment(legacy.data);
      const validPunishment = punishmentSchema.safeParse(punishment);
      const existing = byCount.get(legacy.data.warnCount);
      if (existing) {
        if (validPunishment.success)
          existing.punishments.push(validPunishment.data);
      } else {
        byCount.set(legacy.data.warnCount, {
          warnCount: legacy.data.warnCount,
          punishments: validPunishment.success ? [validPunishment.data] : [],
          autoConfirm: legacy.data.autoConfirm,
        });
      }
    }
  }

  return [...byCount.values()].sort((a, b) => a.warnCount - b.warnCount);
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
