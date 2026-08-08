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
  editingLevelIndex?: number;
  editingGeneralSetting?: "expiry" | "dm" | "logChannel";
  editingLevelSetting?: "menu" | "message" | "autoConfirm";
  selectedPunishmentIndex?: number;
  addPunishmentStep?: "type" | "duration" | "role" | "confirm";
  addPunishmentType?: WarnPunishmentType;
  addPunishmentDraft?: Partial<WarnPunishment>;
  hadExistingSettings?: boolean;
  backupAvailable?: boolean;
  resetStage?: "confirm" | "done" | "restored";
  restoreExpiresAt?: number;
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
  deleteMessageDays?: 0 | 3600 | 21600 | 86400 | 259200 | 604800;
};

// Quick Actions (POM-57)
export type QuickActionBuiltin = "mute" | "kick" | "ban" | "warn";
export type QuickActionTrigger = "mute" | "warn";
export type SubActionType =
  | "warn"
  | "mute"
  | "addRole"
  | "sendDm"
  | "kick"
  | "ban";

export interface SubAction {
  type: SubActionType;
  warnAmount?: number;
  warnReason?: string;
  muteDuration?: number;
  roleId?: string;
  dmMessage?: string;
  kickReason?: string;
  banReason?: string;
  banDuration?: number;
  banDeleteMessageDays?: number;
}

export interface QuickActionDefinition {
  id: string;
  label: string;
  triggers: QuickActionTrigger[];
  subactions: SubAction[];
}

export type QuickActionSession = {
  guildId: string;
  moderatorId: string;
  targetId: string;
  channelId: string;
} & (
  | { kind: "builtin"; action: QuickActionBuiltin }
  | { kind: "custom"; label: string; subactions: SubAction[] }
);

export type WarnHistoryEntry = {
  id: number;
  reason: string | null;
  expiresAt: number | null;
};

export type WarnHistory = {
  active: number;
  expired: number;
  total: number;
  recent: WarnHistoryEntry[];
};
