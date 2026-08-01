import { expect, test } from "bun:test";
import {
  WarnWorkflowRepository,
  authorizePendingSelection,
  createApprovalSelectionKey,
  isQuickstartActionAllowed,
  parseApprovalCustomId,
  parseQuickstartCustomId,
  type WorkflowRedis,
} from "../../src/lib/moderation/workflowRepository.js";
import { renderWarnQuickstart } from "../../src/interaction-handlers/warnQuickstart.js";

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

  eval(
    _script: string,
    numberOfKeys: number,
    ...args: string[]
  ): Promise<number> {
    if (numberOfKeys !== 1) throw new Error("Expected one workflow key");
    const [key, expectedRevision, now, serializedNext, ttl] = args;
    if (!key || !expectedRevision || !now || !serializedNext || !ttl)
      throw new Error("Missing compare-and-swap arguments");
    const raw = this.values.get(key);
    if (!raw) return Promise.resolve(0);
    const current = JSON.parse(raw) as typeof state;
    if (
      current.status !== "active" ||
      current.revision !== Number(expectedRevision) ||
      current.expiresAt <= Number(now)
    )
      return Promise.resolve(0);
    this.values.set(key, serializedNext);
    this.ttl.set(key, Number(ttl));
    return Promise.resolve(1);
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

test("quickstart rejects a forged action that does not belong to its current step", () => {
  expect(isQuickstartActionAllowed(1, "save")).toBe(false);
  expect(isQuickstartActionAllowed(1, "preset")).toBe(true);
  expect(isQuickstartActionAllowed(3, "review")).toBe(false);
  expect(isQuickstartActionAllowed(4, "review")).toBe(true);
});

test("quickstart rejects controls from another owner or message", async () => {
  const redis = new MemoryRedis();
  const repository = new WarnWorkflowRepository(redis);
  await repository.save(state);

  expect(
    await repository.loadForInteraction({
      sessionId: state.id,
      guildId: state.guildId,
      ownerId: "another-moderator",
      messageId: state.messageId,
      revision: state.revision,
    }),
  ).toBeNull();
  expect(
    await repository.loadForInteraction({
      sessionId: state.id,
      guildId: state.guildId,
      ownerId: state.ownerId,
      messageId: "another-message",
      revision: state.revision,
    }),
  ).toBeNull();
});

test("only one concurrent transition for the same workflow revision wins", async () => {
  const redis = new MemoryRedis();
  const repository = new WarnWorkflowRepository(redis);
  await repository.save(state);

  const [first, second] = await Promise.all([
    repository.advance({ ...state, step: 2 }),
    repository.advance({ ...state, step: 2 }),
  ]);

  expect([first, second].filter(Boolean)).toHaveLength(1);
  expect((await repository.get(state.id))?.revision).toBe(2);
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

test("quickstart renders a serializable Components v2 payload", () => {
  const payload = renderWarnQuickstart(state, ((key: string) => key) as never).map(
    (component) => component.toJSON(),
  );

  expect(payload).toHaveLength(2);
  expect(payload[0]?.type).toBe(17);
  expect(payload[1]?.type).toBe(1);
  const control = payload[1]?.components[0];
  expect(
    "custom_id" in control ? control.custom_id : undefined,
  ).toMatch(/^pm:wq:1:/);
});
