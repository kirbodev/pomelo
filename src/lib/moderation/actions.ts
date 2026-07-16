import { container } from "@sapphire/framework";
import { eq, and, sql, desc, count } from "drizzle-orm";
import { Guild, GuildMember, User, PermissionFlagsBits } from "discord.js";
import { db } from "../../db/index.js";
import {
  modCases,
  warns,
  warnSettings,
  caseNotes,
  type ModCase,
  type WarnSettings,
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

export class ModActionService {
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
        lines.push(`**Reason:** ${reason} (warn level: ${amount.toString()})`);
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
    if (days > 0) return `${days.toString()}d ${hours.toString()}h`;
    return `${hours.toString()}h`;
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
    const expiryDays = customExpiryDays ?? settings?.defaultExpiryDays ?? 3;
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

    const levels = normalizeActions(settings?.actions);
    const postCount = preCount + amount;
    const crossed = levels.filter(
      (l) => l.warnCount > preCount && l.warnCount <= postCount,
    );
    const levelMessages = crossed
      .map((l) => {
        const msg = l.message ? sanitizeLevelMessage(l.message) : "";
        return msg ? `⚠️ Level ${l.warnCount.toString()}: ${msg}` : "";
      })
      .filter(Boolean);

    const dmSent =
      settings?.dmOnWarn !== false
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

  async setWarnLevel(
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
      reason || `Warn level set to ${level.toString()}`,
      false,
    );

    const settings = await this.getWarnSettings(guild.id);
    const expiryDays = settings?.defaultExpiryDays ?? 3;
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

    const thresholdActions: WarnActionResult["thresholdActions"] = [];
    if (settings?.actions) {
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
    const existingCase = (
      await db.select().from(modCases).where(eq(modCases.id, caseId)).limit(1)
    ).at(0);

    if (!existingCase)
      return {
        success: false,
        case: null,
        dmSent: false,
        error: "caseNotFound",
      };

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
    const existing = (
      await db.select().from(modCases).where(eq(modCases.id, caseId)).limit(1)
    ).at(0);
    if (!existing) return false;

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
    const existing = (
      await db.select().from(modCases).where(eq(modCases.id, caseId)).limit(1)
    ).at(0);
    if (!existing) return false;

    await db.insert(caseNotes).values({ caseId, moderatorId, note });
    return true;
  }

  async getWarnSettings(guildId: string): Promise<WarnSettings | null> {
    const rows = await db
      .select()
      .from(warnSettings)
      .where(eq(warnSettings.guildId, guildId))
      .limit(1);
    return rows.at(0) ?? null;
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
