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

export type PunishmentItemState =
  | "pending"
  | "executing"
  | "applied"
  | "cancelled"
  | "superseded"
  | "inapplicable"
  | "retryable_failed"
  | "terminal_failed"
  | "manual_review";

export type WarnWorkflowStatus =
  | "active"
  | "completed"
  | "cancelled"
  | "expired";

export type WarnWorkflowConfig = {
  defaultExpiryDays: number;
  dmOnWarn: boolean;
  logChannelId?: string | null;
  levels: WarnLevel[];
};

export type WarnWorkflowState = {
  id: string;
  revision: number;
  ownerId: string;
  guildId: string;
  messageId: string;
  status: WarnWorkflowStatus;
  expiresAt: number;
  step: number;
  config: WarnWorkflowConfig;
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
