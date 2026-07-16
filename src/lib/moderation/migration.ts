import type { WarnLevel, WarnPunishment } from "./types.js";

const MAX_LEVEL_MESSAGE = 1000;

type LegacyAction = {
  warnCount: number;
  actionType: "none" | "mute" | "kick" | "ban" | "role" | "message";
  duration?: number;
  roleId?: string;
  autoConfirm: boolean;
};

const isLegacy = (entry: unknown): entry is LegacyAction => {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.warnCount === "number" &&
    typeof e.actionType === "string" &&
    typeof e.autoConfirm === "boolean"
  );
};

const isNewLevel = (entry: unknown): entry is WarnLevel => {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return typeof e.warnCount === "number" && Array.isArray(e.punishments);
};

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
    if (isNewLevel(entry)) {
      const existing = byCount.get(entry.warnCount);
      if (existing) {
        existing.punishments.push(...entry.punishments);
        if (entry.message && !existing.message)
          existing.message = entry.message;
      } else {
        byCount.set(entry.warnCount, {
          warnCount: entry.warnCount,
          punishments: [...entry.punishments],
          message: entry.message,
          autoConfirm: entry.autoConfirm,
        });
      }
      continue;
    }
    if (isLegacy(entry)) {
      const punishment = legacyToPunishment(entry);
      const existing = byCount.get(entry.warnCount);
      if (existing) {
        if (punishment) existing.punishments.push(punishment);
      } else {
        byCount.set(entry.warnCount, {
          warnCount: entry.warnCount,
          punishments: punishment ? [punishment] : [],
          autoConfirm: entry.autoConfirm,
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
