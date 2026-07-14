import type { WarnActionConfig } from "./types.js";

export const PRESETS: Record<string, { name: string; levels: WarnActionConfig[] }> = {
  lemomeme: {
    name: "Lemomeme",
    levels: [
      { warnCount: 1, actionType: "role", roleId: "", autoConfirm: true },
      { warnCount: 2, actionType: "role", roleId: "", autoConfirm: true },
      { warnCount: 3, actionType: "ban", autoConfirm: true },
    ],
  },
  recommended: {
    name: "Recommended",
    levels: [
      { warnCount: 2, actionType: "mute", duration: 3600000, autoConfirm: true },
      { warnCount: 3, actionType: "mute", duration: 43200000, autoConfirm: true },
      { warnCount: 4, actionType: "mute", duration: 259200000, autoConfirm: true },
      { warnCount: 5, actionType: "mute", duration: 604800000, autoConfirm: true },
      { warnCount: 6, actionType: "ban", duration: 604800000, autoConfirm: true },
      { warnCount: 7, actionType: "ban", autoConfirm: true },
    ],
  },
  progressive: {
    name: "Progressive",
    levels: [
      { warnCount: 2, actionType: "mute", duration: 86400000, autoConfirm: true },
      { warnCount: 3, actionType: "mute", duration: 604800000, autoConfirm: true },
      { warnCount: 4, actionType: "kick", autoConfirm: true },
      { warnCount: 5, actionType: "ban", autoConfirm: true },
    ],
  },
  strictStrike: {
    name: "Strict Strike",
    levels: [
      { warnCount: 2, actionType: "mute", duration: 259200000, autoConfirm: true },
      { warnCount: 3, actionType: "mute", duration: 604800000, autoConfirm: true },
      { warnCount: 4, actionType: "ban", duration: 1209600000, autoConfirm: true },
      { warnCount: 5, actionType: "ban", autoConfirm: true },
    ],
  },
};
