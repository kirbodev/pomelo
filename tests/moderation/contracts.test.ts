import { expect, test } from "bun:test";
import {
  normalizeActions,
  validateWarnLevel,
  validateWorkflowState,
} from "../../src/lib/moderation/migration.js";

const validLevel = {
  warnCount: 1,
  punishments: [{ type: "mute", duration: 3_600_000 }],
  autoConfirm: false,
};

const validWorkflow = {
  id: "workflow",
  revision: 1,
  ownerId: "owner",
  guildId: "guild",
  messageId: "message",
  status: "active",
  expiresAt: Date.now() + 60_000,
  step: 1,
  config: {
    defaultExpiryDays: 3,
    dmOnWarn: true,
    levels: [validLevel],
  },
};

test("validateWarnLevel rejects a new level with kick and ban", () => {
  expect(
    validateWarnLevel({
      ...validLevel,
      punishments: [{ type: "kick" }, { type: "ban" }],
    }),
  ).toBeNull();
});

test("validateWarnLevel rejects malformed punishment data", () => {
  expect(
    validateWarnLevel({
      ...validLevel,
      punishments: [{ type: "role" }],
    }),
  ).toBeNull();
});

test("normalizeActions keeps legacy kick and ban combinations readable", () => {
  expect(
    normalizeActions(
      JSON.stringify([
        { warnCount: 5, actionType: "kick", autoConfirm: true },
        { warnCount: 5, actionType: "ban", autoConfirm: true },
      ]),
    ),
  ).toEqual([
    {
      warnCount: 5,
      punishments: [{ type: "kick" }, { type: "ban" }],
      autoConfirm: true,
    },
  ]);
});

test("validateWorkflowState rejects expired workflows", () => {
  expect(
    validateWorkflowState({ ...validWorkflow, expiresAt: Date.now() - 1 }),
  ).toBeNull();
});

test("validateWorkflowState rejects malformed workflow configuration", () => {
  expect(
    validateWorkflowState({
      ...validWorkflow,
      config: { ...validWorkflow.config, levels: [{ ...validLevel, warnCount: 0 }] },
    }),
  ).toBeNull();
});
