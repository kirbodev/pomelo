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
  type ModCase,
  type WarnPunishmentBatch,
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
} from "./types.js";
import { normalizeActions, sanitizeLevelMessage } from "./migration.js";
import { ModerationError } from "./errors.js";

type ModerationDatabase = typeof db;
type ModerationTransaction = Parameters<
  Parameters<ModerationDatabase["transaction"]>[0]
>[0];
type ModerationReader = Pick<ModerationDatabase, "select">;

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

  public constructor(
    private readonly database: ModerationDatabase = db,
    private readonly getNow: () => number = Date.now,
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
