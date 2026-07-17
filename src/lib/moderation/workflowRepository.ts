import { nanoid } from "nanoid";
import { validateWorkflowState } from "./migration.js";
import type { PunishmentItemState, WarnWorkflowState } from "./types.js";

const WorkflowTtlSeconds = 600;
const SelectionTtlSeconds = 300;

const ApprovalActions = [
  "apply",
  "select",
  "apply-selected",
  "apply-all",
  "dismiss",
] as const;
const QuickstartActions = [
  "preset",
  "scratch",
  "select-preset",
  "continue",
  "expiry",
  "toggle-dm",
  "log-channel",
  "back",
  "levels",
  "select-level",
  "add-level",
  "review",
  "save",
  "cancel",
] as const;

export type ApprovalAction = (typeof ApprovalActions)[number];
export type QuickstartAction = (typeof QuickstartActions)[number];

export type WorkflowRedis = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export type ApprovalCustomId = {
  batchPublicId: string;
  revision: number;
  action: ApprovalAction;
};

export type QuickstartCustomId = {
  sessionId: string;
  revision: number;
  action: QuickstartAction;
  entityId?: string;
};

const opaquePart = /^[A-Za-z0-9_-]{1,48}$/;

const validRevision = (value: string): number | null => {
  if (!/^\d+$/.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
};

export function parseApprovalCustomId(value: string): ApprovalCustomId | null {
  const parts = value.split(":");
  if (
    parts.length !== 6 ||
    parts[0] !== "pm" ||
    parts[1] !== "wa" ||
    parts[2] !== "1"
  )
    return null;
  const [batchPublicId, revisionPart, action] = parts.slice(3);
  if (
    !batchPublicId ||
    !revisionPart ||
    !action ||
    !opaquePart.test(batchPublicId)
  )
    return null;
  const revision = validRevision(revisionPart);
  if (revision === null || !ApprovalActions.includes(action as ApprovalAction))
    return null;
  return { batchPublicId, revision, action: action as ApprovalAction };
}

export function parseQuickstartCustomId(
  value: string,
): QuickstartCustomId | null {
  const parts = value.split(":");
  if (
    parts.length < 6 ||
    parts.length > 7 ||
    parts[0] !== "pm" ||
    parts[1] !== "wq" ||
    parts[2] !== "1"
  )
    return null;
  const sessionId = parts[3];
  const revisionPart = parts[4];
  const action = parts[5];
  if (!sessionId || !revisionPart || !action || !opaquePart.test(sessionId))
    return null;
  const revision = validRevision(revisionPart);
  if (
    revision === null ||
    !QuickstartActions.includes(action as QuickstartAction)
  )
    return null;
  if (parts.length === 7) {
    const entityId = parts[6];
    if (!opaquePart.test(entityId)) return null;
    return {
      sessionId,
      revision,
      action: action as QuickstartAction,
      entityId,
    };
  }
  return {
    sessionId,
    revision,
    action: action as QuickstartAction,
  };
}

export function createApprovalCustomId(
  batchPublicId: string,
  revision: number,
  action: ApprovalAction,
): string {
  return `pm:wa:1:${batchPublicId}:${String(revision)}:${action}`;
}

export function createQuickstartCustomId(
  sessionId: string,
  revision: number,
  action: QuickstartAction,
  entityId?: string,
): string {
  return ["pm", "wq", "1", sessionId, String(revision), action, entityId]
    .filter((part): part is string => part !== undefined)
    .join(":");
}

export function createApprovalSelectionKey(
  guildId: string,
  batchPublicId: string,
  userId: string,
  revision: number,
): string {
  return `warn-punishment-selection:${guildId}:${batchPublicId}:${userId}:${String(revision)}`;
}

export function authorizePendingSelection(
  selectedItemIds: readonly string[],
  items: readonly { id: number; state: PunishmentItemState }[],
): number[] {
  const pendingIds = new Set(
    items
      .filter(
        (item) => item.state === "pending" || item.state === "retryable_failed",
      )
      .map((item) => item.id),
  );
  return [...new Set(selectedItemIds)]
    .map((value) => Number(value))
    .filter(
      (itemId) =>
        Number.isSafeInteger(itemId) && itemId > 0 && pendingIds.has(itemId),
    );
}

export class WarnWorkflowRepository {
  public constructor(
    private readonly redis: WorkflowRedis,
    private readonly now: () => number = Date.now,
  ) {}

  public static createId(): string {
    return nanoid();
  }

  public async save(state: WarnWorkflowState): Promise<void> {
    const validated = validateWorkflowState(state);
    if (!validated) throw new Error("invalidWarnWorkflow");
    await this.redis.set(
      this.workflowKey(validated.id),
      JSON.stringify(validated),
      "EX",
      WorkflowTtlSeconds,
    );
  }

  public async get(id: string): Promise<WarnWorkflowState | null> {
    const raw = await this.redis.get(this.workflowKey(id));
    if (!raw) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      await this.redis.del(this.workflowKey(id));
      return null;
    }
    const state = validateWorkflowState(decoded);
    if (!state || state.expiresAt <= this.now()) {
      await this.redis.del(this.workflowKey(id));
      return null;
    }
    await this.redis.set(
      this.workflowKey(id),
      JSON.stringify(state),
      "EX",
      WorkflowTtlSeconds,
    );
    return state;
  }

  public async loadForInteraction(input: {
    sessionId: string;
    guildId: string;
    ownerId: string;
    messageId: string;
    revision: number;
  }): Promise<WarnWorkflowState | null> {
    const state = await this.get(input.sessionId);
    if (
      !state ||
      state.status !== "active" ||
      state.guildId !== input.guildId ||
      state.ownerId !== input.ownerId ||
      state.messageId !== input.messageId ||
      state.revision !== input.revision
    )
      return null;
    return state;
  }

  public async advance(
    state: WarnWorkflowState,
  ): Promise<WarnWorkflowState | null> {
    const current = await this.get(state.id);
    if (!current || current.revision !== state.revision) return null;
    const next = { ...state, revision: state.revision + 1 };
    await this.save(next);
    return next;
  }

  public async delete(id: string): Promise<void> {
    await this.redis.del(this.workflowKey(id));
  }

  public async saveSelection(input: {
    guildId: string;
    batchPublicId: string;
    userId: string;
    revision: number;
    itemIds: readonly string[];
  }): Promise<void> {
    const key = createApprovalSelectionKey(
      input.guildId,
      input.batchPublicId,
      input.userId,
      input.revision,
    );
    await this.redis.set(
      key,
      JSON.stringify([...new Set(input.itemIds)]),
      "EX",
      SelectionTtlSeconds,
    );
  }

  public async getSelection(input: {
    guildId: string;
    batchPublicId: string;
    userId: string;
    revision: number;
  }): Promise<string[]> {
    const key = createApprovalSelectionKey(
      input.guildId,
      input.batchPublicId,
      input.userId,
      input.revision,
    );
    const raw = await this.redis.get(key);
    if (!raw) return [];
    try {
      const decoded: unknown = JSON.parse(raw);
      if (
        !Array.isArray(decoded) ||
        decoded.some((value) => typeof value !== "string")
      )
        return [];
      await this.redis.set(
        key,
        JSON.stringify(decoded),
        "EX",
        SelectionTtlSeconds,
      );
      return decoded as string[];
    } catch {
      await this.redis.del(key);
      return [];
    }
  }

  private workflowKey(id: string): string {
    return `warn-workflow:${id}`;
  }
}
