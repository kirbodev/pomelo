import { expect, test } from "bun:test";
import {
  WarnWorkflowRepository,
  authorizePendingSelection,
  createApprovalSelectionKey,
  parseApprovalCustomId,
  parseQuickstartCustomId,
  type WorkflowRedis,
} from "../../src/lib/moderation/workflowRepository.js";

class MemoryRedis implements WorkflowRedis {
  public readonly values = new Map<string, string>();
  public readonly ttl = new Map<string, number>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ): Promise<"OK"> {
    this.values.set(key, value);
    this.ttl.set(key, seconds);
    return Promise.resolve("OK");
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.values.delete(key) ? 1 : 0);
  }
}

const state = {
  id: "workflow_123",
  revision: 1,
  ownerId: "moderator",
  guildId: "guild",
  messageId: "message",
  status: "active" as const,
  expiresAt: Date.now() + 60_000,
  step: 1,
  config: { defaultExpiryDays: 7, dmOnWarn: true, levels: [] },
};

test("routing rejects malformed approval and quickstart IDs", () => {
  expect(parseApprovalCustomId("pm:wa:1:batch:0:apply")).toBeNull();
  expect(parseApprovalCustomId("pm:wa:2:batch:1:apply")).toBeNull();
  expect(parseApprovalCustomId("pm:wa:1:batch:1:delete")).toBeNull();
  expect(parseQuickstartCustomId("pm:wq:1:workflow:0:next")).toBeNull();
  expect(parseQuickstartCustomId("pm:wq:1:workflow:1:arbitrary:extra:part")).toBeNull();
});

test("workflow lookup rejects expired, cross-guild, stale, and replayed controls", async () => {
  const redis = new MemoryRedis();
  const repository = new WarnWorkflowRepository(redis);
  await repository.save(state);

  expect(
    await repository.loadForInteraction({
      sessionId: state.id,
      guildId: "other-guild",
      ownerId: state.ownerId,
      messageId: state.messageId,
      revision: state.revision,
    }),
  ).toBeNull();
  expect(
    await repository.loadForInteraction({
      sessionId: state.id,
      guildId: state.guildId,
      ownerId: state.ownerId,
      messageId: state.messageId,
      revision: state.revision + 1,
    }),
  ).toBeNull();

  const next = await repository.advance({
    ...state,
    step: 2,
  });
  expect(next?.revision).toBe(2);
  expect(
    await repository.loadForInteraction({
      sessionId: state.id,
      guildId: state.guildId,
      ownerId: state.ownerId,
      messageId: state.messageId,
      revision: state.revision,
    }),
  ).toBeNull();

  redis.values.set(
    "warn-workflow:expired",
    JSON.stringify({ ...state, id: "expired", expiresAt: Date.now() - 1 }),
  );
  expect(await repository.get("expired")).toBeNull();
});

test("selection keys are scoped and no longer-pending items are never authorized", () => {
  expect(createApprovalSelectionKey("guild", "batch", "moderator", 4)).toBe(
    "warn-punishment-selection:guild:batch:moderator:4",
  );
  expect(
    authorizePendingSelection(["1", "2", "not-an-id"], [
      { id: 1, state: "pending" },
      { id: 2, state: "applied" },
    ]),
  ).toEqual([1]);
});
