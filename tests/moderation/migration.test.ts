import { test, expect } from "bun:test";
import { normalizeActions, sanitizeLevelMessage } from "../../src/lib/moderation/migration.js";

test("normalizeActions returns [] for null/undefined/empty", () => {
  expect(normalizeActions(null)).toEqual([]);
  expect(normalizeActions(undefined)).toEqual([]);
  expect(normalizeActions("")).toEqual([]);
  expect(normalizeActions("[]")).toEqual([]);
});

test("normalizeActions returns [] for malformed JSON", () => {
  expect(normalizeActions("{not json")).toEqual([]);
  expect(normalizeActions("'a'")).toEqual([]);
});

test("normalizeActions passes through new WarnLevel[] shape", () => {
  const input = JSON.stringify([
    { warnCount: 2, punishments: [{ type: "mute", duration: 3600000 }], autoConfirm: true },
  ]);
  expect(normalizeActions(input)).toEqual([
    { warnCount: 2, punishments: [{ type: "mute", duration: 3600000 }], autoConfirm: true },
  ]);
});

test("normalizeActions converts a legacy flat mute action", () => {
  const legacy = JSON.stringify([
    { warnCount: 3, actionType: "mute", duration: 3600000, autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 3, punishments: [{ type: "mute", duration: 3600000 }], autoConfirm: true },
  ]);
});

test("normalizeActions converts a legacy flat ban action (temp)", () => {
  const legacy = JSON.stringify([
    { warnCount: 6, actionType: "ban", duration: 604800000, autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 6, punishments: [{ type: "ban", duration: 604800000 }], autoConfirm: true },
  ]);
});

test("normalizeActions converts a legacy permanent ban (no duration)", () => {
  const legacy = JSON.stringify([
    { warnCount: 7, actionType: "ban", autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 7, punishments: [{ type: "ban" }], autoConfirm: true },
  ]);
});

test("normalizeActions converts actionType none to empty punishments", () => {
  const legacy = JSON.stringify([
    { warnCount: 1, actionType: "none", autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 1, punishments: [], autoConfirm: true },
  ]);
});

test("normalizeActions converts a role action carrying roleId", () => {
  const legacy = JSON.stringify([
    { warnCount: 2, actionType: "role", roleId: "123", autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 2, punishments: [{ type: "role", roleId: "123" }], autoConfirm: true },
  ]);
});

test("normalizeActions drops the message actionType entirely", () => {
  const legacy = JSON.stringify([
    { warnCount: 3, actionType: "message", message: "hi", autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 3, punishments: [], autoConfirm: true },
  ]);
});

test("normalizeActions merges flat entries sharing a warnCount", () => {
  const legacy = JSON.stringify([
    { warnCount: 3, actionType: "mute", duration: 3600000, autoConfirm: true },
    { warnCount: 3, actionType: "role", roleId: "9", autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    {
      warnCount: 3,
      punishments: [
        { type: "mute", duration: 3600000 },
        { type: "role", roleId: "9" },
      ],
      autoConfirm: true,
    },
  ]);
});

test("normalizeActions sorts levels ascending by warnCount and dedupes", () => {
  const legacy = JSON.stringify([
    { warnCount: 5, actionType: "kick", autoConfirm: true },
    { warnCount: 2, actionType: "mute", duration: 1000, autoConfirm: true },
  ]);
  const out = normalizeActions(legacy);
  expect(out.map((l) => l.warnCount)).toEqual([2, 5]);
});

test("sanitizeLevelMessage strips @everyone and @here", () => {
  expect(sanitizeLevelMessage("hey @everyone @here yo")).toBe("hey everyone here yo");
});

test("sanitizeLevelMessage strips role mentions", () => {
  expect(sanitizeLevelMessage("warn <@&123> please")).toBe("warn please");
});

test("sanitizeLevelMessage keeps user mentions", () => {
  expect(sanitizeLevelMessage("hi <@123> and <@!456>")).toBe("hi <@123> and <@!456>");
});

test("sanitizeLevelMessage caps at 1000 chars", () => {
  const long = "x".repeat(2000);
  expect(sanitizeLevelMessage(long).length).toBe(1000);
});

test("sanitizeLevelMessage trims and returns empty for whitespace", () => {
  expect(sanitizeLevelMessage("   ")).toBe("");
});
