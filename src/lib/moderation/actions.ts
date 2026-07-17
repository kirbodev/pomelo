import { container } from "@sapphire/framework";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  ne,
  or,
  sql,
  count,
} from "drizzle-orm";
import { Guild, GuildMember, User, PermissionFlagsBits } from "discord.js";
import { db } from "../../db/index.js";
import {
  modCases,
  warns,
  warnSettings,
  caseNotes,
  caseCounters,
  warnPunishmentBatches,
  warnPunishmentItems,
  warnPunishmentAttempts,
  temporaryBanTokens,
  type ModCase,
  type WarnPunishmentBatch,
  type WarnPunishmentItem,
} from "../../db/schema.js";
import {
  type ModActionResult,
  type WarnActionResult,
  type ActionType,
  type WarnLevel,
  type WarnPunishment,
  type PunishResult,
  type LevelExecResult,
  type ModActionOptions,
  type PunishmentItemState,
} from "./types.js";
import { normalizeActions, sanitizeLevelMessage } from "./migration.js";
import { ModerationError } from "./errors.js";

type ModerationDatabase = typeof db;
type ModerationTransaction = Parameters<
  Parameters<ModerationDatabase["transaction"]>[0]
>[0];
type ModerationReader = Pick<ModerationDatabase, "select">;

type PunishmentPermission = "ban" | "kick" | "mute" | "role";

export type PunishmentCapabilityContext = {
  actorId: string;
  targetId: string;
  actorPosition: number;
  targetPosition: number;
  botPosition: number;
  actorPermissions: ReadonlySet<PunishmentPermission>;
  botPermissions: ReadonlySet<PunishmentPermission>;
  actorIsOwner?: boolean;
  targetIsAdministrator?: boolean;
  rolePosition?: number;
};

export type PunishmentCapabilityAdapter = {
  resolve(input: {
    guildId: string;
    actorId: string;
    targetId: string;
    roleId?: string | null;
  }): Promise<PunishmentCapabilityContext>;
  apply(input: {
    guildId: string;
    actorId: string;
    targetId: string;
    punishmentType: PunishmentPermission;
    duration: number | null;
    roleId: string | null;
    reason: string;
  }): Promise<{
    success: boolean;
    failureCode?: string;
    retryable?: boolean;
  }>;
  scheduleAutoUnban(input: {
    id: string;
    delay: number;
    payload: {
      guildId: string;
      userId: string;
      internalCaseId: number;
      token: string;
    };
  }): Promise<void>;
  unban(input: { guildId: string; userId: string; reason: string }): Promise<{
    success: boolean;
    failureCode?: string;
    retryable?: boolean;
  }>;
};

export type PunishmentExecutionResult = {
  itemId: number;
  state: PunishmentItemState;
  caseNumber?: number;
};

export type ClaimPunishmentItemInput = {
  guildId: string;
  itemId: number;
  actorId: string;
  expectedVersion?: number;
};

export type ApplyPunishmentItemInput = ClaimPunishmentItemInput & {
  reason?: string;
  bypassActorPermissions?: boolean;
};

export type ApplyEligibleItemsInput = {
  guildId: string;
  batchId: number;
  actorId: string;
  automatic: boolean;
  reason?: string;
};

export type CreateWarnInput = {
  guildId: string;
  actorId: string;
  targetId: string;
  operationKey: string;
  amount: number;
  reason?: string;
};

export type SetWarnLevelInput = Omit<CreateWarnInput, "amount"> & {
  level: number;
};

export type RevokeWarnInput = Omit<CreateWarnInput, "amount"> & {
  sourceCaseId: number;
};

export type WarnLedgerResult = {
  case: ModCase | null;
  finalWarnCount: number;
  batches: WarnPunishmentBatch[];
};

export class ModActionService {
  private readonly pendingLedgerOperations = new Map<
    string,
    Promise<WarnLedgerResult>
  >();
  private readonly pendingPunishmentExecutions = new Map<
    string,
    Promise<PunishmentExecutionResult>
  >();

  public constructor(
    private readonly database: ModerationDatabase = db,
    private readonly getNow: () => number = Date.now,
    private readonly punishmentAdapter?: PunishmentCapabilityAdapter,
  ) {}

  private runLedgerOperation(
    input: Pick<CreateWarnInput, "guildId" | "operationKey">,
    operation: () => Promise<WarnLedgerResult>,
  ): Promise<WarnLedgerResult> {
    const key = `${input.guildId}:${input.operationKey}`;
    const pending = this.pendingLedgerOperations.get(key);
    if (pending) return pending;

    const result = operation()
      .catch(async (error: unknown) => {
        if (!this.isRecoverableOperationContention(error)) throw error;
        return this.recoverLedgerOperation(input, error);
      })
      .finally(() => {
        this.pendingLedgerOperations.delete(key);
      });
    this.pendingLedgerOperations.set(key, result);
    return result;
  }

  private isOperationKeyConflict(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes("mod_cases.guild_id, mod_cases.operation_key")
    );
  }

  private isRecoverableOperationContention(error: unknown): boolean {
    return (
      this.isOperationKeyConflict(error) ||
      (error instanceof Error &&
        (error.message.includes("SQLITE_BUSY") ||
          error.message.includes("database is locked")))
    );
  }

  private async recoverLedgerOperation(
    input: Pick<CreateWarnInput, "guildId" | "operationKey">,
    originalError: unknown,
  ): Promise<WarnLedgerResult> {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      try {
        const recovered = await this.getExistingLedgerResult(
          this.database,
          input,
        );
        if (recovered) return recovered;
      } catch (error) {
        if (!this.isRecoverableOperationContention(error)) throw error;
      }
    }
    throw originalError;
  }

  public async createWarn(input: CreateWarnInput): Promise<WarnLedgerResult> {
    if (!Number.isInteger(input.amount) || input.amount < 1)
      throw new ModerationError("invalidWarnAmount");

    return this.runLedgerOperation(input, () =>
      this.database.transaction(async (transaction) => {
        const now = this.getNow();
        const settings = await this.getRequiredWarnSettings(
          transaction,
          input.guildId,
        );
        const existing = await this.getExistingLedgerResult(transaction, input);
        if (existing) return existing;

        const activeWarns = await this.getActiveWarns(
          transaction,
          input.guildId,
          input.targetId,
          now,
        );
        const finalWarnCount = activeWarns.length + input.amount;
        if (finalWarnCount > settings.maxWarns)
          throw new ModerationError("warnLimitExceeded", {
            maxWarns: settings.maxWarns,
          });

        const caseEntry = await this.createLedgerCase(transaction, {
          ...input,
          actionType: "warn",
          resultingWarnCount: finalWarnCount,
          now,
        });
        await this.insertWarningUnits(
          transaction,
          input,
          caseEntry.id,
          activeWarns.length,
          input.amount,
          settings.defaultExpiryDays,
          now,
        );
        const batches = await this.createCrossedBatches(
          transaction,
          input,
          caseEntry,
          activeWarns.length,
          finalWarnCount,
          settings.actions,
          now,
        );

        return { case: caseEntry, finalWarnCount, batches };
      }),
    );
  }

  private async setWarnLevelLedger(
    input: SetWarnLevelInput,
  ): Promise<WarnLedgerResult> {
    if (!Number.isInteger(input.level) || input.level < 0)
      throw new ModerationError("invalidWarnLevel");

    return this.runLedgerOperation(input, () =>
      this.database.transaction(async (transaction) => {
        const now = this.getNow();
        const settings = await this.getRequiredWarnSettings(
          transaction,
          input.guildId,
        );
        const existing = await this.getExistingLedgerResult(transaction, input);
        if (existing) return existing;

        const activeWarns = await this.getActiveWarns(
          transaction,
          input.guildId,
          input.targetId,
          now,
        );
        if (input.level === activeWarns.length)
          return { case: null, finalWarnCount: input.level, batches: [] };
        if (input.level > settings.maxWarns)
          throw new ModerationError("warnLimitExceeded", {
            maxWarns: settings.maxWarns,
          });

        if (input.level > activeWarns.length) {
          const amount = input.level - activeWarns.length;
          const caseEntry = await this.createLedgerCase(transaction, {
            ...input,
            actionType: "warn",
            resultingWarnCount: input.level,
            now,
          });
          await this.insertWarningUnits(
            transaction,
            input,
            caseEntry.id,
            activeWarns.length,
            amount,
            settings.defaultExpiryDays,
            now,
          );
          const batches = await this.createCrossedBatches(
            transaction,
            input,
            caseEntry,
            activeWarns.length,
            input.level,
            settings.actions,
            now,
          );

          return { case: caseEntry, finalWarnCount: input.level, batches };
        }

        const caseEntry = await this.createLedgerCase(transaction, {
          ...input,
          actionType: "unwarn",
          resultingWarnCount: input.level,
          now,
        });
        await this.revokeWarningUnits(
          transaction,
          input,
          caseEntry.id,
          activeWarns.slice(input.level),
          now,
        );
        await this.cancelInapplicableBatches(
          transaction,
          input.guildId,
          input.targetId,
          input.level,
          now,
        );

        return { case: caseEntry, finalWarnCount: input.level, batches: [] };
      }),
    );
  }

  public async revokeWarn(input: RevokeWarnInput): Promise<WarnLedgerResult> {
    return this.runLedgerOperation(input, () =>
      this.database.transaction(async (transaction) => {
        const now = this.getNow();
        await this.getRequiredWarnSettings(transaction, input.guildId);
        const existing = await this.getExistingLedgerResult(transaction, input);
        if (existing) return existing;

        const activeWarns = await this.getActiveWarns(
          transaction,
          input.guildId,
          input.targetId,
          now,
        );
        const toRevoke = activeWarns.filter(
          (warning) => warning.caseId === input.sourceCaseId,
        );
        if (toRevoke.length === 0)
          return {
            case: null,
            finalWarnCount: activeWarns.length,
            batches: [],
          };

        const finalWarnCount = activeWarns.length - toRevoke.length;
        const caseEntry = await this.createLedgerCase(transaction, {
          ...input,
          actionType: "unwarn",
          sourceCaseId: input.sourceCaseId,
          resultingWarnCount: finalWarnCount,
          now,
        });
        await this.revokeWarningUnits(
          transaction,
          input,
          caseEntry.id,
          toRevoke,
          now,
        );
        await this.cancelInapplicableBatches(
          transaction,
          input.guildId,
          input.targetId,
          finalWarnCount,
          now,
        );

        return { case: caseEntry, finalWarnCount, batches: [] };
      }),
    );
  }

  private async getRequiredWarnSettings(
    transaction: ModerationReader,
    guildId: string,
  ) {
    const settings = await transaction
      .select()
      .from(warnSettings)
      .where(eq(warnSettings.guildId, guildId))
      .limit(1);
    if (!settings[0]) throw new ModerationError("warnSettingsNotConfigured");
    return settings[0];
  }

  private async getExistingLedgerResult(
    transaction: ModerationReader,
    input: Pick<CreateWarnInput, "guildId" | "operationKey">,
  ): Promise<WarnLedgerResult | null> {
    const cases = await transaction
      .select()
      .from(modCases)
      .where(
        and(
          eq(modCases.guildId, input.guildId),
          eq(modCases.operationKey, input.operationKey),
        ),
      )
      .limit(1);
    const caseEntry = cases.at(0);
    if (!caseEntry) return null;

    const batches = await transaction
      .select()
      .from(warnPunishmentBatches)
      .where(
        and(
          eq(warnPunishmentBatches.guildId, input.guildId),
          eq(warnPunishmentBatches.warnCaseId, caseEntry.id),
        ),
      )
      .orderBy(asc(warnPunishmentBatches.id));
    if (caseEntry.resultingWarnCount === null)
      throw new Error("missingWarnLedgerResult");

    return {
      case: caseEntry,
      finalWarnCount: caseEntry.resultingWarnCount,
      batches,
    };
  }

  private async getActiveWarns(
    transaction: ModerationTransaction,
    guildId: string,
    targetId: string,
    now: number,
  ) {
    return transaction
      .select()
      .from(warns)
      .where(
        and(
          eq(warns.guildId, guildId),
          eq(warns.userId, targetId),
          eq(warns.revoked, false),
          or(sql`${warns.expiresAt} IS NULL`, gt(warns.expiresAt, now)),
        ),
      )
      .orderBy(asc(warns.createdAt), asc(warns.id));
  }

  private async createLedgerCase(
    transaction: ModerationTransaction,
    input: Pick<
      CreateWarnInput,
      "guildId" | "actorId" | "targetId" | "operationKey" | "reason"
    > & {
      actionType: "warn" | "unwarn";
      sourceCaseId?: number;
      resultingWarnCount: number;
      now: number;
    },
  ): Promise<ModCase> {
    const [counter] = await transaction
      .insert(caseCounters)
      .values({
        guildId: input.guildId,
        nextCaseNumber: 2,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: caseCounters.guildId,
        set: {
          nextCaseNumber: sql`${caseCounters.nextCaseNumber} + 1`,
          updatedAt: input.now,
        },
      })
      .returning({
        caseNumber: sql<number>`${caseCounters.nextCaseNumber} - 1`,
      });

    const [caseEntry] = await transaction
      .insert(modCases)
      .values({
        guildId: input.guildId,
        caseNumber: counter.caseNumber,
        operationKey: input.operationKey,
        sourceCaseId: input.sourceCaseId,
        userId: input.targetId,
        moderatorId: input.actorId,
        actionType: input.actionType,
        reason: input.reason ?? "",
        resultingWarnCount: input.resultingWarnCount,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    return caseEntry;
  }

  private async insertWarningUnits(
    transaction: ModerationTransaction,
    input: Pick<CreateWarnInput, "guildId" | "actorId" | "targetId">,
    caseId: number,
    activeWarnCount: number,
    amount: number,
    expiryDays: number,
    now: number,
  ): Promise<void> {
    const expiresAt = expiryDays === 0 ? null : now + expiryDays * 86_400_000;
    await transaction.insert(warns).values(
      Array.from({ length: amount }, (_, index) => ({
        caseId,
        guildId: input.guildId,
        userId: input.targetId,
        moderatorId: input.actorId,
        warnCount: activeWarnCount + index + 1,
        expiresAt,
        createdAt: now,
      })),
    );
  }

  private async createCrossedBatches(
    transaction: ModerationTransaction,
    input: Pick<CreateWarnInput, "guildId" | "targetId" | "operationKey">,
    caseEntry: ModCase,
    previousWarnCount: number,
    finalWarnCount: number,
    actions: string,
    now: number,
  ): Promise<WarnPunishmentBatch[]> {
    const crossedLevels = normalizeActions(actions).filter(
      (level) =>
        level.warnCount > previousWarnCount &&
        level.warnCount <= finalWarnCount &&
        level.punishments.length > 0,
    );
    const batches: WarnPunishmentBatch[] = [];

    for (const level of crossedLevels) {
      const [batch] = await transaction
        .insert(warnPunishmentBatches)
        .values({
          publicId: crypto.randomUUID(),
          guildId: input.guildId,
          warnCaseId: caseEntry.id,
          targetUserId: input.targetId,
          threshold: level.warnCount,
          operationKey: `${input.operationKey}:threshold:${String(level.warnCount)}`,
          configJson: JSON.stringify(level),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await transaction.insert(warnPunishmentItems).values(
        level.punishments.map((punishment, index) => ({
          guildId: input.guildId,
          batchId: batch.id,
          ordinal: index + 1,
          punishmentType: punishment.type,
          duration: punishment.duration,
          roleId: punishment.roleId,
          createdAt: now,
          updatedAt: now,
        })),
      );
      batches.push(batch);
    }

    return batches;
  }

  private async revokeWarningUnits(
    transaction: ModerationTransaction,
    input: Pick<CreateWarnInput, "guildId" | "actorId" | "targetId">,
    revokeCaseId: number,
    warningUnits: Awaited<ReturnType<ModActionService["getActiveWarns"]>>,
    now: number,
  ): Promise<void> {
    if (warningUnits.length === 0) return;
    await transaction
      .update(warns)
      .set({
        revoked: true,
        revokedBy: input.actorId,
        revokedAt: now,
        revokedByCaseId: revokeCaseId,
      })
      .where(
        and(
          eq(warns.guildId, input.guildId),
          eq(warns.userId, input.targetId),
          eq(warns.revoked, false),
          inArray(
            warns.id,
            warningUnits.map((warning) => warning.id),
          ),
        ),
      );
  }

  private async cancelInapplicableBatches(
    transaction: ModerationTransaction,
    guildId: string,
    targetId: string,
    finalWarnCount: number,
    now: number,
  ): Promise<void> {
    const batches = await transaction
      .select()
      .from(warnPunishmentBatches)
      .where(
        and(
          eq(warnPunishmentBatches.guildId, guildId),
          eq(warnPunishmentBatches.targetUserId, targetId),
          gt(warnPunishmentBatches.threshold, finalWarnCount),
          ne(warnPunishmentBatches.state, "completed"),
          ne(warnPunishmentBatches.state, "cancelled"),
        ),
      );
    if (batches.length === 0) return;

    await transaction
      .update(warnPunishmentBatches)
      .set({
        state: "cancelled",
        revision: sql`${warnPunishmentBatches.revision} + 1`,
        updatedAt: now,
      })
      .where(
        inArray(
          warnPunishmentBatches.id,
          batches.map((batch) => batch.id),
        ),
      );
    await transaction
      .update(warnPunishmentItems)
      .set({ state: "inapplicable", updatedAt: now })
      .where(
        and(
          eq(warnPunishmentItems.guildId, guildId),
          inArray(
            warnPunishmentItems.batchId,
            batches.map((batch) => batch.id),
          ),
          ne(warnPunishmentItems.state, "applied"),
        ),
      );
  }

  public async claimPunishmentItem(input: ClaimPunishmentItemInput) {
    return this.database.transaction(async (transaction) => {
      const record = await this.getPunishmentRecord(
        transaction,
        input.guildId,
        input.itemId,
      );
      if (!record) return null;
      const expectedVersion = input.expectedVersion ?? record.item.version;
      if (
        record.item.version !== expectedVersion ||
        !["pending", "retryable_failed"].includes(record.item.state)
      )
        return null;

      const leaseToken = crypto.randomUUID();
      const now = this.getNow();
      const items = await transaction
        .update(warnPunishmentItems)
        .set({
          state: "executing",
          version: sql`${warnPunishmentItems.version} + 1`,
          leaseToken,
          leaseExpiresAt: now + 300_000,
          attemptCount: sql`${warnPunishmentItems.attemptCount} + 1`,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(warnPunishmentItems.guildId, input.guildId),
            eq(warnPunishmentItems.id, input.itemId),
            eq(warnPunishmentItems.version, expectedVersion),
            inArray(warnPunishmentItems.state, ["pending", "retryable_failed"]),
          ),
        )
        .returning();
      if (items.length !== 1) return null;
      const item = items[0];
      await transaction.insert(warnPunishmentAttempts).values({
        guildId: input.guildId,
        itemId: item.id,
        attemptNumber: item.attemptCount,
        actorId: input.actorId,
        state: "claimed",
        detail: "Punishment item claimed for execution.",
        createdAt: now,
      });
      return { item, batch: record.batch, leaseToken };
    });
  }

  public applyPunishmentItem(
    input: ApplyPunishmentItemInput,
  ): Promise<PunishmentExecutionResult> {
    const key = `${input.guildId}:${String(input.itemId)}`;
    const existing = this.pendingPunishmentExecutions.get(key);
    if (existing) return existing;
    const execution = this.applyPunishmentItemInternal(input).finally(() => {
      this.pendingPunishmentExecutions.delete(key);
    });
    this.pendingPunishmentExecutions.set(key, execution);
    return execution;
  }

  private async applyPunishmentItemInternal(
    input: ApplyPunishmentItemInput,
  ): Promise<PunishmentExecutionResult> {
    const adapter = this.requirePunishmentAdapter();
    const record = await this.getPunishmentRecord(
      this.database,
      input.guildId,
      input.itemId,
    );
    if (!record) throw new Error("punishmentItemNotFound");

    if (
      record.item.punishmentType === "kick" &&
      (await this.hasBlockingBan(input.guildId, record.item.batchId))
    )
      return this.recordUnclaimedOutcome(
        record,
        input.actorId,
        "superseded",
        "banPrecedesKick",
      );

    const context = await adapter.resolve({
      guildId: input.guildId,
      actorId: input.actorId,
      targetId: record.batch.targetUserId,
      roleId: record.item.roleId,
    });
    const validation = this.validatePunishmentContext(
      record.item,
      context,
      input.bypassActorPermissions ?? false,
    );
    if (validation)
      return this.recordUnclaimedOutcome(
        record,
        input.actorId,
        "pending",
        validation,
      );

    let claim: Awaited<ReturnType<ModActionService["claimPunishmentItem"]>>;
    try {
      claim = await this.claimPunishmentItem(input);
    } catch (error) {
      if (!this.isDatabaseContention(error)) throw error;
      return this.recoverPunishmentContention(input.guildId, input.itemId);
    }
    if (!claim)
      return this.getActualPunishmentResult(input.guildId, input.itemId);

    try {
      const outcome = await adapter.apply({
        guildId: input.guildId,
        actorId: input.actorId,
        targetId: claim.batch.targetUserId,
        punishmentType: this.asPunishmentPermission(claim.item.punishmentType),
        duration: claim.item.duration,
        roleId: claim.item.roleId,
        reason:
          input.reason ??
          `Warn level ${String(claim.batch.threshold)} punishment`,
      });
      if (!outcome.success) {
        return this.completeClaim({
          claim,
          actorId: input.actorId,
          reason: input.reason,
          state: outcome.retryable ? "retryable_failed" : "manual_review",
          failureCode: outcome.failureCode ?? "discordActionUnconfirmed",
        });
      }
      return this.completeClaim({
        claim,
        actorId: input.actorId,
        reason: input.reason,
        state: "applied",
      });
    } catch (error) {
      return this.completeClaim({
        claim,
        actorId: input.actorId,
        reason: input.reason,
        state: "manual_review",
        failureCode:
          error instanceof Error ? error.message : "discordActionUnknown",
      });
    }
  }

  public async applyEligibleItems(
    input: ApplyEligibleItemsInput,
  ): Promise<PunishmentExecutionResult[]> {
    const batch = await this.database
      .select()
      .from(warnPunishmentBatches)
      .where(
        and(
          eq(warnPunishmentBatches.guildId, input.guildId),
          eq(warnPunishmentBatches.id, input.batchId),
        ),
      )
      .limit(1);
    const selectedBatch = batch.at(0);
    if (
      !selectedBatch ||
      ["cancelled", "completed"].includes(selectedBatch.state)
    )
      return [];

    const items = await this.database
      .select()
      .from(warnPunishmentItems)
      .where(
        and(
          eq(warnPunishmentItems.guildId, input.guildId),
          eq(warnPunishmentItems.batchId, input.batchId),
          inArray(warnPunishmentItems.state, ["pending", "retryable_failed"]),
        ),
      )
      .orderBy(asc(warnPunishmentItems.ordinal));
    if (items.length === 0) return [];

    let bypassActorPermissions = false;
    if (input.automatic) {
      const settings = await this.getRequiredWarnSettings(
        this.database,
        input.guildId,
      );
      const level = this.readBatchLevel(selectedBatch.configJson);
      if (!settings.autoApplyWarnPunishments || !level?.autoConfirm) return [];
      bypassActorPermissions = settings.dangerouslyBypassWarnPermissions;

      const adapter = this.requirePunishmentAdapter();
      const checks = await Promise.all(
        items.map(async (item) => {
          const context = await adapter.resolve({
            guildId: input.guildId,
            actorId: input.actorId,
            targetId: selectedBatch.targetUserId,
            roleId: item.roleId,
          });
          return this.validatePunishmentContext(
            item,
            context,
            bypassActorPermissions,
          );
        }),
      );
      if (checks.some((check) => check !== null)) return [];
    }

    const ordered = [...items].sort((left, right) => {
      if (left.punishmentType === "ban") return -1;
      if (right.punishmentType === "ban") return 1;
      return left.ordinal - right.ordinal;
    });
    const results: PunishmentExecutionResult[] = [];
    for (const item of ordered) {
      results.push(
        await this.applyPunishmentItem({
          guildId: input.guildId,
          itemId: item.id,
          actorId: input.actorId,
          reason: input.reason,
          bypassActorPermissions,
        }),
      );
    }
    return results;
  }

  public async dismissBatch(input: {
    guildId: string;
    batchId: number;
    actorId: string;
    expectedRevision: number;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const now = this.getNow();
      const batches = await transaction
        .update(warnPunishmentBatches)
        .set({
          dismissedBy: input.actorId,
          dismissedAt: now,
          revision: sql`${warnPunishmentBatches.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(warnPunishmentBatches.guildId, input.guildId),
            eq(warnPunishmentBatches.id, input.batchId),
            eq(warnPunishmentBatches.revision, input.expectedRevision),
          ),
        )
        .returning();
      if (batches.length !== 1) return false;
      const batch = batches[0];
      await transaction.insert(caseNotes).values({
        guildId: input.guildId,
        caseId: batch.warnCaseId,
        operationKey: `warn-batch-dismiss:${String(batch.id)}:${String(batch.revision)}`,
        moderatorId: input.actorId,
        note: "Warning punishment approval display dismissed.",
        createdAt: now,
      });
      return true;
    });
  }

  public async recoverExpiredClaims(): Promise<number> {
    const expired = await this.database
      .select({
        id: warnPunishmentItems.id,
        guildId: warnPunishmentItems.guildId,
      })
      .from(warnPunishmentItems)
      .where(
        and(
          eq(warnPunishmentItems.state, "executing"),
          sql`${warnPunishmentItems.leaseExpiresAt} < ${this.getNow()}`,
        ),
      );
    for (const item of expired) {
      await this.database.transaction(async (transaction) => {
        const record = await this.getPunishmentRecord(
          transaction,
          item.guildId,
          item.id,
        );
        if (
          !record ||
          record.item.state !== "executing" ||
          record.item.leaseExpiresAt === null ||
          record.item.leaseExpiresAt >= this.getNow()
        )
          return;
        await this.completeUncertainExecution(
          transaction,
          record,
          record.item.leaseToken,
          "executionLeaseExpired",
        );
      });
    }
    return expired.length;
  }

  public async runAutoUnban(input: {
    guildId: string;
    userId: string;
    internalCaseId: number;
    token: string;
  }): Promise<boolean> {
    const adapter = this.requirePunishmentAdapter();
    const claim = await this.claimAutoUnbanToken(input);
    if (!claim) return false;

    const outcome = await adapter.unban({
      guildId: input.guildId,
      userId: input.userId,
      reason: "Temporary ban expired.",
    });
    if (!outcome.success) {
      if (outcome.retryable) {
        await this.releaseAutoUnbanToken(input.guildId, claim);
        throw new Error(outcome.failureCode ?? "autoUnbanRetryableFailure");
      }
      await this.database
        .update(modCases)
        .set({
          status: "manual_review",
          failureCode: outcome.failureCode ?? "autoUnbanUnconfirmed",
          updatedAt: this.getNow(),
        })
        .where(
          and(
            eq(modCases.guildId, input.guildId),
            eq(modCases.id, input.internalCaseId),
          ),
        );
      return false;
    }

    return true;
  }

  private async claimAutoUnbanToken(input: {
    guildId: string;
    userId: string;
    internalCaseId: number;
    token: string;
  }): Promise<{ id: number; claimedAt: number } | null> {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        return await this.database.transaction(async (transaction) => {
          const caseRows = await transaction
            .select({ userId: modCases.userId })
            .from(modCases)
            .where(
              and(
                eq(modCases.guildId, input.guildId),
                eq(modCases.id, input.internalCaseId),
                eq(modCases.userId, input.userId),
              ),
            )
            .limit(1);
          if (!caseRows.at(0)) return null;

          const claimedAt = this.getNow();
          const consumed = await transaction
            .update(temporaryBanTokens)
            .set({ consumedAt: claimedAt })
            .where(
              and(
                eq(temporaryBanTokens.guildId, input.guildId),
                eq(temporaryBanTokens.caseId, input.internalCaseId),
                eq(temporaryBanTokens.token, input.token),
                sql`${temporaryBanTokens.expiresAt} <= ${claimedAt}`,
                sql`${temporaryBanTokens.consumedAt} IS NULL`,
              ),
            )
            .returning({ id: temporaryBanTokens.id });
          if (consumed.length !== 1) return null;
          return { id: consumed[0].id, claimedAt };
        });
      } catch (error) {
        if (!this.isDatabaseContention(error)) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }

    return null;
  }

  private async releaseAutoUnbanToken(
    guildId: string,
    claim: { id: number; claimedAt: number },
  ): Promise<void> {
    await this.database
      .update(temporaryBanTokens)
      .set({ consumedAt: null })
      .where(
        and(
          eq(temporaryBanTokens.guildId, guildId),
          eq(temporaryBanTokens.id, claim.id),
          eq(temporaryBanTokens.consumedAt, claim.claimedAt),
        ),
      );
  }

  private requirePunishmentAdapter(): PunishmentCapabilityAdapter {
    if (!this.punishmentAdapter)
      throw new Error("punishmentCapabilityAdapterRequired");
    return this.punishmentAdapter;
  }

  private isDatabaseContention(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes("SQLITE_BUSY") ||
        error.message.includes("database is locked"))
    );
  }

  private async recoverPunishmentContention(
    guildId: string,
    itemId: number,
  ): Promise<PunishmentExecutionResult> {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      try {
        const result = await this.getActualPunishmentResult(guildId, itemId);
        if (result.state !== "pending" && result.state !== "executing")
          return result;
      } catch (error) {
        if (!this.isDatabaseContention(error)) throw error;
      }
    }
    return this.getActualPunishmentResult(guildId, itemId);
  }

  private async getPunishmentRecord(
    reader: ModerationReader,
    guildId: string,
    itemId: number,
  ) {
    const records = await reader
      .select({ item: warnPunishmentItems, batch: warnPunishmentBatches })
      .from(warnPunishmentItems)
      .innerJoin(
        warnPunishmentBatches,
        and(
          eq(warnPunishmentBatches.guildId, warnPunishmentItems.guildId),
          eq(warnPunishmentBatches.id, warnPunishmentItems.batchId),
        ),
      )
      .where(
        and(
          eq(warnPunishmentItems.guildId, guildId),
          eq(warnPunishmentItems.id, itemId),
        ),
      )
      .limit(1);
    return records.at(0) ?? null;
  }

  private readBatchLevel(configJson: string): WarnLevel | null {
    try {
      const parsed: unknown = JSON.parse(configJson);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("autoConfirm" in parsed) ||
        typeof parsed.autoConfirm !== "boolean"
      )
        return null;
      return parsed as WarnLevel;
    } catch {
      return null;
    }
  }

  private asPunishmentPermission(value: string): PunishmentPermission {
    if (["ban", "kick", "mute", "role"].includes(value))
      return value as PunishmentPermission;
    throw new Error("unsupportedPunishmentType");
  }

  private validatePunishmentContext(
    item: WarnPunishmentItem,
    context: PunishmentCapabilityContext,
    bypassActorPermissions: boolean,
  ): string | null {
    let permission: PunishmentPermission;
    try {
      permission = this.asPunishmentPermission(item.punishmentType);
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "unsupportedPunishmentType";
    }
    if (context.actorId === context.targetId) return "cannotActionSelf";
    if (context.targetIsAdministrator) return "cannotActionAdmin";
    if (
      !context.actorIsOwner &&
      context.actorPosition <= context.targetPosition
    )
      return "actorHierarchyTooLow";
    if (context.botPosition <= context.targetPosition)
      return "botHierarchyTooLow";
    if (!bypassActorPermissions && !context.actorPermissions.has(permission))
      return "actorMissingActionPermission";
    if (!context.botPermissions.has(permission))
      return "botMissingActionPermission";
    if (permission === "role") {
      if (!item.roleId || context.rolePosition === undefined)
        return "roleNotFound";
      if (
        !context.actorIsOwner &&
        context.actorPosition <= context.rolePosition
      )
        return "actorRoleHierarchyTooLow";
      if (context.botPosition <= context.rolePosition)
        return "botRoleHierarchyTooLow";
    }
    if (
      permission === "mute" &&
      (!item.duration || item.duration > 2_419_200_000)
    )
      return "invalidMuteDuration";
    return null;
  }

  private async hasBlockingBan(
    guildId: string,
    batchId: number,
  ): Promise<boolean> {
    const rows = await this.database
      .select({ id: warnPunishmentItems.id })
      .from(warnPunishmentItems)
      .where(
        and(
          eq(warnPunishmentItems.guildId, guildId),
          eq(warnPunishmentItems.batchId, batchId),
          eq(warnPunishmentItems.punishmentType, "ban"),
          inArray(warnPunishmentItems.state, [
            "pending",
            "executing",
            "applied",
          ]),
        ),
      )
      .limit(1);
    return rows.length === 1;
  }

  private async recordUnclaimedOutcome(
    record: { item: WarnPunishmentItem; batch: WarnPunishmentBatch },
    actorId: string,
    state: "pending" | "superseded",
    failureCode: string,
  ): Promise<PunishmentExecutionResult> {
    return this.database.transaction(async (transaction) => {
      const current = await this.getPunishmentRecord(
        transaction,
        record.item.guildId,
        record.item.id,
      );
      if (!current) throw new Error("punishmentItemNotFound");
      if (!["pending", "retryable_failed"].includes(current.item.state))
        return this.resultFromItem(current.item);
      const now = this.getNow();
      const [item] = await transaction
        .update(warnPunishmentItems)
        .set({
          state,
          version: sql`${warnPunishmentItems.version} + 1`,
          attemptCount: sql`${warnPunishmentItems.attemptCount} + 1`,
          lastAttemptAt: now,
          failureCode,
          updatedAt: now,
        })
        .where(
          and(
            eq(warnPunishmentItems.guildId, current.item.guildId),
            eq(warnPunishmentItems.id, current.item.id),
            eq(warnPunishmentItems.version, current.item.version),
          ),
        )
        .returning();
      const caseEntry = await this.createExecutionCase(transaction, {
        guildId: current.item.guildId,
        actorId,
        targetId: current.batch.targetUserId,
        parentCaseId: current.batch.warnCaseId,
        actionType: this.asPunishmentPermission(current.item.punishmentType),
        operationKey: `punishment:${String(item.id)}:attempt:${String(item.attemptCount)}:${failureCode}`,
        reason: `Warning punishment was not applied: ${failureCode}`,
        status: state === "superseded" ? "cancelled" : "manual_review",
        failureCode,
        now,
      });
      await transaction.insert(warnPunishmentAttempts).values({
        guildId: item.guildId,
        itemId: item.id,
        attemptNumber: item.attemptCount,
        actorId,
        state: "denied",
        failureCode,
        detail: "Punishment was not claimed for Discord execution.",
        createdAt: now,
      });
      await this.refreshBatchState(
        transaction,
        item.guildId,
        item.batchId,
        now,
      );
      return { ...this.resultFromItem(item), caseNumber: caseEntry.caseNumber };
    });
  }

  private async completeClaim(input: {
    claim: {
      item: WarnPunishmentItem;
      batch: WarnPunishmentBatch;
      leaseToken: string;
    };
    actorId: string;
    reason?: string;
    state: "applied" | "retryable_failed" | "manual_review";
    failureCode?: string;
  }): Promise<PunishmentExecutionResult> {
    let scheduledUnban:
      | {
          id: string;
          delay: number;
          payload: {
            guildId: string;
            userId: string;
            internalCaseId: number;
            token: string;
          };
          itemId: number;
          caseId: number;
        }
      | undefined;
    const result = await this.database.transaction(async (transaction) => {
      const now = this.getNow();
      const [item] = await transaction
        .update(warnPunishmentItems)
        .set({
          state: input.state,
          version: sql`${warnPunishmentItems.version} + 1`,
          leaseToken: null,
          leaseExpiresAt: null,
          failureCode: input.failureCode ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(warnPunishmentItems.guildId, input.claim.item.guildId),
            eq(warnPunishmentItems.id, input.claim.item.id),
            eq(warnPunishmentItems.state, "executing"),
            eq(warnPunishmentItems.leaseToken, input.claim.leaseToken),
          ),
        )
        .returning();
      const caseEntry = await this.createExecutionCase(transaction, {
        guildId: item.guildId,
        actorId: input.actorId,
        targetId: input.claim.batch.targetUserId,
        parentCaseId: input.claim.batch.warnCaseId,
        actionType: this.asPunishmentPermission(item.punishmentType),
        operationKey: `punishment:${String(item.id)}:attempt:${String(item.attemptCount)}:result`,
        reason:
          input.reason ??
          `Warn level ${String(input.claim.batch.threshold)} punishment`,
        status:
          input.state === "applied"
            ? "completed"
            : input.state === "retryable_failed"
              ? "failed"
              : "manual_review",
        failureCode: input.failureCode,
        duration: item.duration,
        now,
      });
      await transaction
        .update(warnPunishmentAttempts)
        .set({
          state: input.state === "applied" ? "applied" : "failed",
          failureCode: input.failureCode,
          detail:
            input.state === "applied"
              ? "Punishment applied."
              : "Discord outcome was not confirmed.",
        })
        .where(
          and(
            eq(warnPunishmentAttempts.guildId, item.guildId),
            eq(warnPunishmentAttempts.itemId, item.id),
            eq(warnPunishmentAttempts.attemptNumber, item.attemptCount),
          ),
        );
      await transaction
        .update(warnPunishmentItems)
        .set({ resultCaseId: caseEntry.id, updatedAt: now })
        .where(
          and(
            eq(warnPunishmentItems.guildId, item.guildId),
            eq(warnPunishmentItems.id, item.id),
          ),
        );
      if (
        input.state === "applied" &&
        item.punishmentType === "ban" &&
        item.duration
      ) {
        const token = crypto.randomUUID();
        await transaction.insert(temporaryBanTokens).values({
          guildId: item.guildId,
          caseId: caseEntry.id,
          token,
          expiresAt: now + item.duration,
          createdAt: now,
        });
        scheduledUnban = {
          id: `auto-unban:${item.guildId}:${String(caseEntry.id)}`,
          delay: item.duration,
          payload: {
            guildId: item.guildId,
            userId: input.claim.batch.targetUserId,
            internalCaseId: caseEntry.id,
            token,
          },
          itemId: item.id,
          caseId: caseEntry.id,
        };
      }
      await this.refreshBatchState(
        transaction,
        item.guildId,
        item.batchId,
        now,
      );
      return { ...this.resultFromItem(item), caseNumber: caseEntry.caseNumber };
    });
    if (!scheduledUnban) return result;
    try {
      await this.requirePunishmentAdapter().scheduleAutoUnban(scheduledUnban);
      return result;
    } catch (error) {
      return this.markUnscheduledTemporaryBan(
        input.claim.item.guildId,
        scheduledUnban.itemId,
        scheduledUnban.caseId,
        error instanceof Error ? error.message : "autoUnbanSchedulingFailed",
      );
    }
  }

  private async markUnscheduledTemporaryBan(
    guildId: string,
    itemId: number,
    caseId: number,
    failureCode: string,
  ): Promise<PunishmentExecutionResult> {
    const now = this.getNow();
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(warnPunishmentItems)
        .set({ state: "manual_review", failureCode, updatedAt: now })
        .where(
          and(
            eq(warnPunishmentItems.guildId, guildId),
            eq(warnPunishmentItems.id, itemId),
            eq(warnPunishmentItems.resultCaseId, caseId),
          ),
        );
      await transaction
        .update(modCases)
        .set({ status: "manual_review", failureCode, updatedAt: now })
        .where(and(eq(modCases.guildId, guildId), eq(modCases.id, caseId)));
      const record = await this.getPunishmentRecord(
        transaction,
        guildId,
        itemId,
      );
      if (record)
        await this.refreshBatchState(
          transaction,
          guildId,
          record.item.batchId,
          now,
        );
    });
    return this.getActualPunishmentResult(guildId, itemId);
  }

  private async completeUncertainExecution(
    transaction: ModerationTransaction,
    record: { item: WarnPunishmentItem; batch: WarnPunishmentBatch },
    leaseToken: string | null,
    failureCode: string,
  ): Promise<void> {
    if (!leaseToken) return;
    const now = this.getNow();
    const [item] = await transaction
      .update(warnPunishmentItems)
      .set({
        state: "manual_review",
        leaseToken: null,
        leaseExpiresAt: null,
        failureCode,
        version: sql`${warnPunishmentItems.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(warnPunishmentItems.guildId, record.item.guildId),
          eq(warnPunishmentItems.id, record.item.id),
          eq(warnPunishmentItems.state, "executing"),
          eq(warnPunishmentItems.leaseToken, leaseToken),
        ),
      )
      .returning();
    const caseEntry = await this.createExecutionCase(transaction, {
      guildId: item.guildId,
      actorId: "system",
      targetId: record.batch.targetUserId,
      parentCaseId: record.batch.warnCaseId,
      actionType: this.asPunishmentPermission(item.punishmentType),
      operationKey: `punishment:${String(item.id)}:attempt:${String(item.attemptCount)}:lease-expired`,
      reason:
        "Punishment execution lease expired before Discord outcome could be verified.",
      status: "manual_review",
      failureCode,
      now,
    });
    await transaction
      .update(warnPunishmentAttempts)
      .set({
        state: "recovered",
        failureCode,
        detail: "Execution requires manual review.",
      })
      .where(
        and(
          eq(warnPunishmentAttempts.guildId, item.guildId),
          eq(warnPunishmentAttempts.itemId, item.id),
          eq(warnPunishmentAttempts.attemptNumber, item.attemptCount),
        ),
      );
    await transaction
      .update(warnPunishmentItems)
      .set({ resultCaseId: caseEntry.id, updatedAt: now })
      .where(
        and(
          eq(warnPunishmentItems.guildId, item.guildId),
          eq(warnPunishmentItems.id, item.id),
        ),
      );
    await this.refreshBatchState(transaction, item.guildId, item.batchId, now);
  }

  private async createExecutionCase(
    transaction: ModerationTransaction,
    input: {
      guildId: string;
      actorId: string;
      targetId: string;
      parentCaseId: number;
      actionType: PunishmentPermission;
      operationKey: string;
      reason: string;
      status: "completed" | "cancelled" | "failed" | "manual_review";
      failureCode?: string;
      duration?: number | null;
      now: number;
    },
  ): Promise<ModCase> {
    const [counter] = await transaction
      .insert(caseCounters)
      .values({
        guildId: input.guildId,
        nextCaseNumber: 2,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: caseCounters.guildId,
        set: {
          nextCaseNumber: sql`${caseCounters.nextCaseNumber} + 1`,
          updatedAt: input.now,
        },
      })
      .returning({
        caseNumber: sql<number>`${caseCounters.nextCaseNumber} - 1`,
      });
    const [caseEntry] = await transaction
      .insert(modCases)
      .values({
        guildId: input.guildId,
        caseNumber: counter.caseNumber,
        operationKey: input.operationKey,
        parentCaseId: input.parentCaseId,
        userId: input.targetId,
        moderatorId: input.actorId,
        actionType: input.actionType,
        reason: input.reason,
        status: input.status,
        failureCode: input.failureCode,
        duration: input.duration,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    return caseEntry;
  }

  private async refreshBatchState(
    transaction: ModerationTransaction,
    guildId: string,
    batchId: number,
    now: number,
  ): Promise<void> {
    const items = await transaction
      .select({ state: warnPunishmentItems.state })
      .from(warnPunishmentItems)
      .where(
        and(
          eq(warnPunishmentItems.guildId, guildId),
          eq(warnPunishmentItems.batchId, batchId),
        ),
      );
    const states = items.map((item) => item.state);
    const state = states.every((item) =>
      ["applied", "cancelled", "superseded", "inapplicable"].includes(item),
    )
      ? "completed"
      : states.some((item) => item === "applied")
        ? "partially_applied"
        : states.some((item) =>
              ["manual_review", "terminal_failed"].includes(item),
            )
          ? "failed"
          : "pending";
    await transaction
      .update(warnPunishmentBatches)
      .set({
        state,
        revision: sql`${warnPunishmentBatches.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(warnPunishmentBatches.guildId, guildId),
          eq(warnPunishmentBatches.id, batchId),
        ),
      );
  }

  private async getActualPunishmentResult(
    guildId: string,
    itemId: number,
  ): Promise<PunishmentExecutionResult> {
    const rows = await this.database
      .select({
        id: warnPunishmentItems.id,
        state: warnPunishmentItems.state,
        resultCaseId: warnPunishmentItems.resultCaseId,
      })
      .from(warnPunishmentItems)
      .where(
        and(
          eq(warnPunishmentItems.guildId, guildId),
          eq(warnPunishmentItems.id, itemId),
        ),
      )
      .limit(1);
    const item = rows.at(0);
    if (!item) throw new Error("punishmentItemNotFound");
    if (item.resultCaseId === null)
      return { itemId: item.id, state: item.state };
    const cases = await this.database
      .select({ caseNumber: modCases.caseNumber })
      .from(modCases)
      .where(
        and(eq(modCases.guildId, guildId), eq(modCases.id, item.resultCaseId)),
      )
      .limit(1);
    return {
      itemId: item.id,
      state: item.state,
      caseNumber: cases.at(0)?.caseNumber,
    };
  }

  private resultFromItem(
    item: Pick<WarnPunishmentItem, "id" | "state">,
  ): PunishmentExecutionResult {
    return { itemId: item.id, state: item.state };
  }

  private async validateHierarchy(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
  ): Promise<string | null> {
    if (target.id === moderator.user.id) return "cannotActionSelf";
    if (target.id === guild.client.user.id) return "cannotActionBot";
    if (target.permissions.has(PermissionFlagsBits.Administrator))
      return "cannotActionAdmin";
    if (
      moderator.roles.highest.position <= target.roles.highest.position &&
      guild.ownerId !== moderator.id
    )
      return "hierarchyTooLow";
    const botMember = await guild.members.fetchMe();
    if (botMember.roles.highest.position <= target.roles.highest.position)
      return "botHierarchyTooLow";
    return null;
  }

  private async tryDm(
    target: User,
    action: string,
    guildName: string,
    reason?: string,
    duration?: number,
  ): Promise<boolean> {
    try {
      const parts: string[] = [];
      parts.push(`You've been **${action}** in **${guildName}**.`);
      if (reason) parts.push(`**Reason:** ${reason}`);
      if (duration)
        parts.push(`**Duration:** ${this.formatDuration(duration)}`);
      await target.send(parts.join("\n"));
      return true;
    } catch {
      return false;
    }
  }

  private async tryWarnDm(
    target: User,
    guildName: string,
    reason: string | undefined,
    amount: number,
    levelMessages: string[],
  ): Promise<boolean> {
    try {
      const lines: string[] = [`You've been **warned** in **${guildName}**.`];
      if (reason)
        lines.push(`**Reason:** ${reason} (warn level: ${String(amount)})`);
      if (levelMessages.length > 0) lines.push("", ...levelMessages);
      const base = lines.join("\n");
      if (base.length <= 2000) {
        await target.send(base);
        return true;
      }
      await target.send(base.slice(0, 2000));
      const overflow = levelMessages
        .join("\n")
        .slice(Math.max(0, 2000 - base.length));
      if (overflow.trim()) await target.send(overflow.slice(0, 2000));
      return true;
    } catch {
      return false;
    }
  }

  private formatDuration(ms: number): string {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    if (days > 0) return `${String(days)}d ${String(hours)}h`;
    return `${String(hours)}h`;
  }

  /**
   * Parse a duration string like "7d", "3h", "30m" into milliseconds.
   * Returns null if the string can't be parsed.
   */
  parseDuration(input: string): number | null {
    const match = input.match(/^(\d+)\s*(d|h|m|s)$/i);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    switch (unit) {
      case "d":
        return value * 86400000;
      case "h":
        return value * 3600000;
      case "m":
        return value * 60000;
      case "s":
        return value * 1000;
      default:
        return null;
    }
  }

  private async logCase(
    guildId: string,
    userId: string,
    moderatorId: string,
    actionType: ActionType,
    reason: string,
    dmSent: boolean,
    duration?: number,
  ): Promise<ModCase> {
    const [caseEntry] = await db
      .insert(modCases)
      .values({
        guildId,
        userId,
        moderatorId,
        actionType,
        reason: reason || "",
        duration,
        dmSent,
      })
      .returning();
    return caseEntry;
  }

  async kick(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    reason?: string,
  ): Promise<ModActionResult> {
    const validationError = await this.validateHierarchy(
      guild,
      moderator,
      target,
    );
    if (validationError)
      return {
        success: false,
        case: null,
        dmSent: false,
        error: validationError,
      };

    const dmSent = await this.tryDm(target.user, "kicked", guild.name, reason);
    await target.kick(reason);

    const caseEntry = await this.logCase(
      guild.id,
      target.id,
      moderator.id,
      "kick",
      reason || "",
      dmSent,
    );
    return { success: true, case: caseEntry, dmSent };
  }

  async ban(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember | User,
    reason?: string,
    options?: ModActionOptions,
  ): Promise<ModActionResult> {
    if (target instanceof GuildMember) {
      const validationError = await this.validateHierarchy(
        guild,
        moderator,
        target,
      );
      if (validationError)
        return {
          success: false,
          case: null,
          dmSent: false,
          error: validationError,
        };
    }

    const dmSent =
      target instanceof GuildMember
        ? await this.tryDm(
            target.user,
            "banned",
            guild.name,
            reason,
            options?.duration,
          )
        : false;

    await guild.bans.create(target.id, {
      reason,
      deleteMessageSeconds: options?.deleteMessageDays,
    });

    const caseEntry = await this.logCase(
      guild.id,
      target.id,
      moderator.id,
      "ban",
      reason || "",
      dmSent,
      options?.duration,
    );

    if (options?.duration) {
      await container.tasks.create({
        name: "autoUnban",
        payload: {
          guildId: guild.id,
          userId: target.id,
          moderatorId: moderator.id,
          caseId: caseEntry.id,
          reason: "Temp ban expired",
        },
        options: { delay: options.duration },
      });
    }

    return { success: true, case: caseEntry, dmSent };
  }

  async unban(
    guild: Guild,
    moderator: GuildMember,
    targetId: string,
    reason?: string,
  ): Promise<ModActionResult> {
    await guild.bans.remove(targetId, reason);

    const caseEntry = await this.logCase(
      guild.id,
      targetId,
      moderator.id,
      "unban",
      reason || "",
      false,
    );
    return { success: true, case: caseEntry, dmSent: false };
  }

  async mute(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    duration: number,
    reason?: string,
  ): Promise<ModActionResult> {
    const validationError = await this.validateHierarchy(
      guild,
      moderator,
      target,
    );
    if (validationError)
      return {
        success: false,
        case: null,
        dmSent: false,
        error: validationError,
      };

    if (duration > 2419200000)
      return {
        success: false,
        case: null,
        dmSent: false,
        error: "durationTooLong",
      };

    const dmSent = await this.tryDm(
      target.user,
      "muted",
      guild.name,
      reason,
      duration,
    );
    await target.timeout(duration, reason);

    const caseEntry = await this.logCase(
      guild.id,
      target.id,
      moderator.id,
      "mute",
      reason || "",
      dmSent,
      duration,
    );
    return { success: true, case: caseEntry, dmSent };
  }

  async unmute(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    reason?: string,
  ): Promise<ModActionResult> {
    const validationError = await this.validateHierarchy(
      guild,
      moderator,
      target,
    );
    if (validationError)
      return {
        success: false,
        case: null,
        dmSent: false,
        error: validationError,
      };

    await target.timeout(null, reason);

    const caseEntry = await this.logCase(
      guild.id,
      target.id,
      moderator.id,
      "unmute",
      reason || "",
      false,
    );
    return { success: true, case: caseEntry, dmSent: false };
  }

  async getActiveWarnCount(guildId: string, userId: string): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(warns)
      .where(
        and(
          eq(warns.guildId, guildId),
          eq(warns.userId, userId),
          eq(warns.revoked, false),
          sql`(warns.expires_at IS NULL OR warns.expires_at > ${Date.now()})`,
        ),
      );
    return result[0]?.count ?? 0;
  }

  async warn(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    reason?: string,
    amount: number = 1,
    customExpiryDays?: number,
  ): Promise<WarnActionResult> {
    const validationError = await this.validateHierarchy(
      guild,
      moderator,
      target,
    );
    if (validationError)
      return {
        success: false,
        case: null,
        dmSent: false,
        error: validationError,
        warnCount: 0,
      };

    // Get warn count before this action to calculate which thresholds are newly crossed
    const preCount = await this.getActiveWarnCount(guild.id, target.id);

    const settings = await this.getWarnSettings(guild.id);
    const expiryDays = customExpiryDays ?? settings.defaultExpiryDays;
    const expiryMs = expiryDays * 86400000;

    const caseEntry = await this.logCase(
      guild.id,
      target.id,
      moderator.id,
      "warn",
      reason || "",
      false,
    );

    for (let i = 0; i < amount; i++) {
      const expiresAt = expiryDays
        ? new Date(Date.now() + (i + 1) * expiryMs)
        : null;
      await db.insert(warns).values({
        caseId: caseEntry.id,
        guildId: guild.id,
        userId: target.id,
        moderatorId: moderator.id,
        warnCount: i + 1,
        expiresAt: expiresAt,
      });
    }

    const levels = normalizeActions(settings.actions);
    const postCount = preCount + amount;
    const crossed = levels.filter(
      (l) => l.warnCount > preCount && l.warnCount <= postCount,
    );
    const levelMessages = crossed
      .map((l) => {
        const msg = l.message ? sanitizeLevelMessage(l.message) : "";
        return msg ? `⚠️ Level ${String(l.warnCount)}: ${msg}` : "";
      })
      .filter(Boolean);

    const dmSent = settings.dmOnWarn
      ? await this.tryWarnDm(
          target.user,
          guild.name,
          reason,
          amount,
          levelMessages,
        )
      : false;

    const thresholdActions: WarnActionResult["thresholdActions"] = [];
    for (const level of crossed) {
      if (level.punishments.length === 0) continue;
      if (level.autoConfirm) {
        try {
          const result = await this.executeLevel(
            guild,
            moderator,
            target,
            level,
            reason,
          );
          thresholdActions.push({
            level,
            autoExecuted: true,
            results: result.results,
          });
        } catch (err) {
          thresholdActions.push({
            level,
            autoExecuted: false,
            error: String(err),
          });
        }
      } else {
        thresholdActions.push({ level, autoExecuted: false });
      }
    }

    return {
      success: true,
      case: caseEntry,
      dmSent,
      warnCount: amount,
      thresholdActions:
        thresholdActions.length > 0 ? thresholdActions : undefined,
    };
  }

  public async setWarnLevel(
    input: SetWarnLevelInput,
  ): Promise<WarnLedgerResult>;
  public async setWarnLevel(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    level: number,
    reason?: string,
  ): Promise<WarnActionResult>;
  public async setWarnLevel(
    inputOrGuild: SetWarnLevelInput | Guild,
    moderator?: GuildMember,
    target?: GuildMember,
    level?: number,
    reason?: string,
  ): Promise<WarnLedgerResult | WarnActionResult> {
    if ("guildId" in inputOrGuild) return this.setWarnLevelLedger(inputOrGuild);
    if (!moderator || !target || level === undefined)
      throw new Error("invalidLegacyWarnLevelInput");
    return this.setWarnLevelLegacy(
      inputOrGuild,
      moderator,
      target,
      level,
      reason,
    );
  }

  private async setWarnLevelLegacy(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    level: number,
    reason?: string,
  ): Promise<WarnActionResult> {
    const validationError = await this.validateHierarchy(
      guild,
      moderator,
      target,
    );
    if (validationError)
      return {
        success: false,
        case: null,
        dmSent: false,
        error: validationError,
        warnCount: 0,
      };

    const preCount = await this.getActiveWarnCount(guild.id, target.id);

    const caseEntry = await this.logCase(
      guild.id,
      target.id,
      moderator.id,
      "warn",
      reason || `Warn level set to ${String(level)}`,
      false,
    );

    const settings = await this.getWarnSettings(guild.id);
    const expiryDays = settings.defaultExpiryDays;
    const expiresAt = new Date(Date.now() + expiryDays * 86400000);

    for (let i = 0; i < level; i++) {
      await db.insert(warns).values({
        caseId: caseEntry.id,
        guildId: guild.id,
        userId: target.id,
        moderatorId: moderator.id,
        warnCount: i + 1,
        expiresAt,
      });
    }

    // Check threshold actions — only fire for newly crossed thresholds
    const thresholdActions: WarnActionResult["thresholdActions"] = [];
    if (settings.actions) {
      const levels = normalizeActions(settings.actions);
      const postCount = preCount + level;
      const crossed = levels.filter(
        (l) => l.warnCount > preCount && l.warnCount <= postCount,
      );
      for (const lvl of crossed) {
        if (lvl.punishments.length === 0) continue;
        if (lvl.autoConfirm) {
          const result = await this.executeLevel(
            guild,
            moderator,
            target,
            lvl,
            reason,
          );
          thresholdActions.push({
            level: lvl,
            autoExecuted: true,
            results: result.results,
          });
        } else {
          thresholdActions.push({ level: lvl, autoExecuted: false });
        }
      }
    }

    return {
      success: true,
      case: caseEntry,
      dmSent: false,
      warnCount: level,
      thresholdActions:
        thresholdActions.length > 0 ? thresholdActions : undefined,
    };
  }

  async unwarn(caseId: number, moderatorId: string): Promise<ModActionResult> {
    const rows = await db
      .select()
      .from(modCases)
      .where(eq(modCases.id, caseId))
      .limit(1);

    if (rows.length === 0)
      return {
        success: false,
        case: null,
        dmSent: false,
        error: "caseNotFound",
      };
    const existingCase = rows[0];

    const activeWarns = await db
      .update(warns)
      .set({ revoked: true, revokedBy: moderatorId, revokedAt: new Date() })
      .where(and(eq(warns.caseId, caseId), eq(warns.revoked, false)))
      .returning();

    return {
      success: activeWarns.length > 0,
      case: existingCase,
      dmSent: false,
      error: activeWarns.length === 0 ? "warnAlreadyRevoked" : undefined,
    };
  }

  async executeLevel(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    level: WarnLevel,
    reason?: string,
  ): Promise<LevelExecResult> {
    const results: PunishResult[] = [];
    for (const punishment of level.punishments) {
      try {
        await this.executePunishment(
          guild,
          moderator,
          target,
          punishment,
          reason,
        );
        results.push({ punishment, success: true });
      } catch (err) {
        results.push({ punishment, success: false, error: String(err) });
      }
    }
    return { level, results };
  }

  private async executePunishment(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    punishment: WarnPunishment,
    reason?: string,
  ): Promise<void> {
    switch (punishment.type) {
      case "ban":
        await this.ban(guild, moderator, target, reason, {
          duration: punishment.duration,
          deleteMessageDays: punishment.deleteMessageDays,
        });
        break;
      case "kick":
        await this.kick(guild, moderator, target, reason);
        break;
      case "mute":
        if (!punishment.duration) throw new Error("durationTooLong");
        await this.mute(guild, moderator, target, punishment.duration, reason);
        break;
      case "role":
        if (punishment.roleId) {
          const role = guild.roles.cache.get(punishment.roleId);
          if (role) await target.roles.add(role, reason);
        }
        break;
    }
  }

  async editDuration(caseId: number, newDurationMs: number): Promise<boolean> {
    const rows = await db
      .select()
      .from(modCases)
      .where(eq(modCases.id, caseId))
      .limit(1);
    if (rows.length === 0) return false;
    const existing = rows[0];

    await db
      .update(modCases)
      .set({ duration: newDurationMs, updatedAt: new Date() })
      .where(eq(modCases.id, caseId));

    if (existing.actionType === "warn") {
      const relatedWarns = await db
        .select()
        .from(warns)
        .where(and(eq(warns.caseId, caseId), eq(warns.revoked, false)));

      for (const w of relatedWarns) {
        await db
          .update(warns)
          .set({
            expiresAt: new Date(Date.now() + newDurationMs * w.warnCount),
          })
          .where(eq(warns.id, w.id));
      }
    }

    return true;
  }

  async addNote(
    caseId: number,
    moderatorId: string,
    note: string,
  ): Promise<boolean> {
    const rows = await db
      .select()
      .from(modCases)
      .where(eq(modCases.id, caseId))
      .limit(1);
    if (rows.length === 0) return false;

    await db.insert(caseNotes).values({ caseId, moderatorId, note });
    return true;
  }

  async getWarnSettings(guildId: string) {
    const rows = await db
      .select()
      .from(warnSettings)
      .where(eq(warnSettings.guildId, guildId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getCasesForUser(
    guildId: string,
    userId: string,
    actionType?: ActionType,
    limit: number = 5,
    offset: number = 0,
  ) {
    const conditions = [
      eq(modCases.guildId, guildId),
      eq(modCases.userId, userId),
    ];

    if (actionType && (actionType as string) !== "all")
      conditions.push(eq(modCases.actionType, actionType));

    const rows = await db
      .select()
      .from(modCases)
      .where(and(...conditions))
      .orderBy(desc(modCases.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(modCases)
      .where(and(...conditions));

    return { cases: rows, total };
  }

  async getNotesForUser(guildId: string, userId: string) {
    const userCases = db
      .select({ id: modCases.id })
      .from(modCases)
      .where(and(eq(modCases.guildId, guildId), eq(modCases.userId, userId)));

    const notes = await db
      .select({
        id: caseNotes.id,
        caseId: caseNotes.caseId,
        moderatorId: caseNotes.moderatorId,
        note: caseNotes.note,
        createdAt: caseNotes.createdAt,
      })
      .from(caseNotes)
      .where(sql`${caseNotes.caseId} IN (${userCases})`)
      .orderBy(desc(caseNotes.createdAt));

    return notes;
  }
}

export const modActionService = new ModActionService();
