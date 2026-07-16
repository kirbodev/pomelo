import type { WarnLevel } from "./types.js";

export type WarnPreset = {
  name: string;
  defaultExpiryDays: number;
  levels: WarnLevel[];
};

export const PRESETS: Record<string, WarnPreset> = {
  lemomeme: {
    name: "Lemomeme",
    defaultExpiryDays: 7,
    levels: [
      {
        warnCount: 1,
        punishments: [{ type: "role", roleId: "" }],
        autoConfirm: true,
      },
      {
        warnCount: 2,
        punishments: [{ type: "role", roleId: "" }],
        autoConfirm: true,
      },
      { warnCount: 3, punishments: [{ type: "ban" }], autoConfirm: true },
    ],
  },
  recommended: {
    name: "Recommended",
    defaultExpiryDays: 30,
    levels: [
      {
        warnCount: 2,
        punishments: [{ type: "mute", duration: 3600000 }],
        autoConfirm: true,
      },
      {
        warnCount: 3,
        punishments: [{ type: "mute", duration: 43200000 }],
        autoConfirm: true,
      },
      {
        warnCount: 4,
        punishments: [{ type: "mute", duration: 259200000 }],
        autoConfirm: true,
      },
      {
        warnCount: 5,
        punishments: [{ type: "mute", duration: 604800000 }],
        autoConfirm: true,
      },
      {
        warnCount: 6,
        punishments: [{ type: "ban", duration: 604800000 }],
        autoConfirm: true,
      },
      { warnCount: 7, punishments: [{ type: "ban" }], autoConfirm: true },
    ],
  },
  progressive: {
    name: "Progressive",
    defaultExpiryDays: 14,
    levels: [
      {
        warnCount: 2,
        punishments: [{ type: "mute", duration: 86400000 }],
        autoConfirm: true,
      },
      {
        warnCount: 3,
        punishments: [{ type: "mute", duration: 604800000 }],
        autoConfirm: true,
      },
      { warnCount: 4, punishments: [{ type: "kick" }], autoConfirm: true },
      { warnCount: 5, punishments: [{ type: "ban" }], autoConfirm: true },
    ],
  },
  strictStrike: {
    name: "Strict Strike",
    defaultExpiryDays: 90,
    levels: [
      {
        warnCount: 2,
        punishments: [{ type: "mute", duration: 259200000 }],
        autoConfirm: true,
      },
      {
        warnCount: 3,
        punishments: [{ type: "mute", duration: 604800000 }],
        autoConfirm: true,
      },
      {
        warnCount: 4,
        punishments: [{ type: "ban", duration: 1209600000 }],
        autoConfirm: true,
      },
      { warnCount: 5, punishments: [{ type: "ban" }], autoConfirm: true },
    ],
  },
};
