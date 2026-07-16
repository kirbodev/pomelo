import type { ModCase } from "../../db/schema.js";

export type ActionType =
  | "ban"
  | "unban"
  | "kick"
  | "mute"
  | "unmute"
  | "warn"
  | "unwarn"
  | "note";

export type WarnPunishmentType = "mute" | "kick" | "ban" | "role";

export type WarnPunishment = {
  type: WarnPunishmentType;
  duration?: number;
  roleId?: string;
  deleteMessageDays?: 0 | 86400 | 259200 | 604800;
};

export type WarnLevel = {
  warnCount: number;
  punishments: WarnPunishment[];
  message?: string;
  autoConfirm: boolean;
};

export type RoleApplyConfig = Record<string, string>;

export type ModActionResult = {
  success: boolean;
  case: ModCase | null;
  dmSent: boolean;
  error?: string;
};

export type PunishResult = {
  punishment: WarnPunishment;
  success: boolean;
  error?: string;
};

export type LevelExecResult = {
  level: WarnLevel;
  results: PunishResult[];
};

export type WarnActionResult = ModActionResult & {
  warnCount: number;
  thresholdActions?: Array<{
    level: WarnLevel;
    autoExecuted: boolean;
    results?: PunishResult[];
    error?: string;
  }>;
};

export type ModActionOptions = {
  reason?: string;
  duration?: number;
  deleteMessageDays?: 0 | 86400 | 259200 | 604800;
};
