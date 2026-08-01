# Moderation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the full moderation system: Kick, Ban/Unban, Mute/Unmute, Warn system (threshold actions, staggered expiry, advanced mode, multi-warn, warn level set, heavywarn), Caselogs, and Mod Notes.

**Architecture:** All mod actions abstracted behind `ModActionService` that validates, executes Discord API, DMs target, logs to libSQL, and fires threshold actions. Commands are thin wrappers.

**Tech Stack:** Sapphire 5 + discord.js v14.22+, libSQL/Turso + Drizzle ORM, BullMQ, i18next

## Global Constraints

- New files use Components v2 (`ContainerBuilder` + `TextDisplayBuilder`/`SectionBuilder`/`SeparatorBuilder`) with `MessageFlags.IsComponentsV2` — except caselogs.
- Caselogs use `EmbedUtils.EmbedConstructor` + `ComponentUtils.PomeloPaginatedMessage`.
- i18n: three locales (`en-US`, `it`, `es-ES`), keys via `src/lib/i18n/commands/moderation.ts`.
- Commands extend `CommandUtils.ModCommand`.
- Guild-only — NO `UserInstall` integration type.
- Ephemeral-by-default replies.
- Colors from `src/lib/colors.ts`; Emojis from `src/lib/emojis.ts`.
- Action types: `ban`, `unban`, `kick`, `mute`, `unmute`, `warn`, `unwarn`, `note`.
- Warn expiry staggered: count N expires at `now + N x defaultExpiryDays`. Warn level set expires all at once.
- Run `bun run db:generate && bun run db:migrate` after schema changes.

---

## File Structure

src/
├── commands/mod/
│   ├── kick.ts            # /kick
│   ├── ban.ts             # /ban + /unban
│   ├── mute.ts            # /mute + /unmute
│   ├── warn.ts            # /warn, /heavywarn, subcommands
│   ├── warnSettings.ts    # /warn settings subcommand tree
│   ├── case.ts            # /case (caselogs)
│   └── note.ts            # /note
├── db/schema.ts           # + mod_cases, warns, warn_settings, case_notes tables
├── lib/
│   ├── moderation/
│   │   ├── types.ts       # Shared types
│   │   ├── actions.ts     # ModActionService
│   │   └── errors.ts      # Moderation-specific error helpers
│   ├── i18n/commands/
│   │   ├── index.ts       # + Moderation import
│   │   └── moderation.ts  # Language keys
├── languages/
│   ├── en-US/commands/moderation.json
│   ├── it/commands/moderation.json
│   └── es-ES/commands/moderation.json
└── scheduled-tasks/
    └── autoUnban.ts       # Temp ban auto-unban

---

### Task 1: Database Schema + Migration

**Files:**
- Modify: `src/db/schema.ts`
- Run: `bun run db:generate && bun run db:migrate`

- [ ] **Step 1: Add moderation tables after `syncedEvents`**

```ts
//SECTION - Moderation Database

export const modCases = sqliteTable("mod_cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  moderatorId: text("moderator_id").notNull(),
  actionType: text("action_type", {
    enum: ["ban", "unban", "kick", "mute", "unmute", "warn", "unwarn", "note"],
  }).notNull(),
  reason: text("reason").notNull().default(""),
  duration: integer("duration"),
  dmSent: integer("dm_sent", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const warns = sqliteTable("warns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  caseId: integer("case_id").notNull().references(() => modCases.id),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  moderatorId: text("moderator_id").notNull(),
  warnCount: integer("warn_count").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  revokedBy: text("revoked_by"),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

export const warnSettings = sqliteTable("warn_settings", {
  guildId: text("guild_id").primaryKey(),
  maxWarns: integer("max_warns").notNull().default(10),
  defaultExpiryDays: integer("default_expiry_days").notNull().default(3),
  dmOnWarn: integer("dm_on_warn", { mode: "boolean" }).notNull().default(true),
  logChannelId: text("log_channel_id"),
  actions: text("actions").notNull().default("[]"),
  roleApply: text("role_apply"),
});

export const caseNotes = sqliteTable("case_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  caseId: integer("case_id").notNull().references(() => modCases.id),
  moderatorId: text("moderator_id").notNull(),
  note: text("note").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type ModCase = typeof modCases.$inferSelect;
export type ModCaseInsert = typeof modCases.$inferInsert;
export type Warn = typeof warns.$inferSelect;
export type WarnInsert = typeof warns.$inferInsert;
export type WarnSettings = typeof warnSettings.$inferSelect;
export type WarnSettingsInsert = typeof warnSettings.$inferInsert;
export type CaseNote = typeof caseNotes.$inferSelect;
export type CaseNoteInsert = typeof caseNotes.$inferInsert;
//!SECTION

- [ ] Step 2: Run migration

bun run db:generate
bun run db:migrate

Verify the four new tables exist in Turso.

---
Task 2: Shared Types (src/lib/moderation/types.ts)

Files:
- Create: src/lib/moderation/types.ts
- [ ] Step 1: Create types file

import type { Guild, GuildMember, User } from "discord.js";
import type { ModCase } from "../../db/schema.js";

export type ActionType = "ban" | "unban" | "kick" | "mute" | "unmute" | "warn" | "unwarn" | "note";

export type WarnActionConfig = {
  warnCount: number;
  actionType: "mute" | "kick" | "ban" | "role" | "message";
  duration?: number;
  roleId?: string;
  message?: string;
  messageTarget?: "dm" | "channel";
  channelId?: string;
  autoConfirm: boolean;
};

export type RoleApplyConfig = Record<string, string> & { all?: string };

export type ModActionResult = {
  success: boolean;
  case: ModCase | null;
  dmSent: boolean;
  error?: string;
};

export type WarnActionResult = ModActionResult & {
  warnCount: number;
  thresholdActions?: Array<{
    action: WarnActionConfig;
    autoExecuted: boolean;
    error?: string;
  }>;
};

export type ModActionOptions = {
  reason?: string;
  duration?: number;
  deleteMessageDays?: 0 | 86400 | 259200 | 604800;
};

---
Task 3: ModActionService (src/lib/moderation/actions.ts)

Files:
- Create: src/lib/moderation/actions.ts

Interfaces:
- Consumes: ModActionResult, WarnActionResult, ActionType, WarnActionConfig, RoleApplyConfig from types.ts
- Consumes: modCases, warns, warnSettings, caseNotes + db from src/db/
- Produces: ModActionService class used by all commands
- [ ] Step 1: Create the service file

import { container } from "@sapphire/framework";
import { eq, and, sql, lt, desc, count } from "drizzle-orm";
import {
  Guild,
  GuildMember,
  User,
  PermissionFlagsBits,
} from "discord.js";
import { db } from "../../db/index.js";
import {
  modCases,
  warns,
  warnSettings,
  caseNotes,
  type ModCase,
  type Warn,
} from "../../db/schema.js";
import {
  type ModActionResult,
  type WarnActionResult,
  type ActionType,
  type WarnActionConfig,
  type ModActionOptions,
} from "./types.js";

export class ModActionService {
  private async validateHierarchy(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember
  ): Promise<string | null> {
    if (target.user.id === moderator.user.id)
      return "You can't action yourself.";
    if (target.id === guild.client.user.id)
      return "I can't action myself.";
    if (target.permissions.has(PermissionFlagsBits.Administrator))
      return "I can't action a server admin.";
    if (moderator.roles.highest.position <= target.roles.highest.position && guild.ownerId !== moderator.id)
      return "You can't action that user — they're above you in the role hierarchy.";
    const botMember = await guild.members.fetchMe();
    if (botMember.roles.highest.position <= target.roles.highest.position)
      return "I can't action that user — I need a higher role.";
    return null;
  }

  private async tryDm(
    target: User,
    action: string,
    guildName: string,
    reason?: string,
    duration?: number
  ): Promise<boolean> {
    try {
      const parts = [`You've been **${action}** in **${guildName}**.`];
      if (reason) parts.push(`**Reason:** ${reason}`);
      if (duration) parts.push(`**Duration:** ${this.formatDuration(duration)}`);
      await target.send(parts.join("\n"));
      return true;
    } catch {
      return false;
    }
  }

  private formatDuration(ms: number): string {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  }

  private async logCase(
    guildId: string,
    userId: string,
    moderatorId: string,
    actionType: ActionType,
    reason: string,
    dmSent: boolean,
    duration?: number
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
    reason?: string
  ): Promise<ModActionResult> {
    const validationError = await this.validateHierarchy(guild, moderator, target);
    if (validationError) return { success: false, case: null, dmSent: false, error: validationError };

    const dmSent = await this.tryDm(target.user, "kicked", guild.name, reason);
    await target.kick(reason);

    const caseEntry = await this.logCase(
      guild.id, target.id, moderator.id, "kick", reason || "", dmSent
    );

    return { success: true, case: caseEntry, dmSent };
  }

  async ban(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember | User,
    reason?: string,
    options?: ModActionOptions
  ): Promise<ModActionResult> {
    if (target instanceof GuildMember) {
      const validationError = await this.validateHierarchy(guild, moderator, target);
      if (validationError) return { success: false, case: null, dmSent: false, error: validationError };
    }

    const dmSent = target instanceof GuildMember
      ? await this.tryDm(target.user, "banned", guild.name, reason, options?.duration)
      : false;

    await guild.bans.create(target.id, {
      reason,
      deleteMessageSeconds: options?.deleteMessageDays,
    });

    const caseEntry = await this.logCase(
      guild.id, target.id, moderator.id, "ban", reason || "", dmSent, options?.duration
    );

    if (options?.duration) {
      await container.tasks.create("autoUnban", {
        guildId: guild.id,
        userId: target.id,
        moderatorId: moderator.id,
        caseId: caseEntry.id,
        reason: "Temp ban expired",
      }, { delay: options.duration });
    }

    return { success: true, case: caseEntry, dmSent };
  }

  async unban(
    guild: Guild,
    moderator: GuildMember,
    targetId: string,
    reason?: string
  ): Promise<ModActionResult> {
    await guild.bans.remove(targetId, reason);

    const caseEntry = await this.logCase(
      guild.id, targetId, moderator.id, "unban", reason || "", false
    );

    return { success: true, case: caseEntry, dmSent: false };
  }

  async mute(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    duration: number,
    reason?: string
  ): Promise<ModActionResult> {
    const validationError = await this.validateHierarchy(guild, moderator, target);
    if (validationError) return { success: false, case: null, dmSent: false, error: validationError };

    if (duration > 2419200000) // 28 days
      return { success: false, case: null, dmSent: false, error: "Timeouts can't be longer than 28 days." };

    const dmSent = await this.tryDm(target.user, "muted", guild.name, reason, duration);
    await target.timeout(duration, reason);

    const caseEntry = await this.logCase(
      guild.id, target.id, moderator.id, "mute", reason || "", dmSent, duration
    );

    return { success: true, case: caseEntry, dmSent };
  }

  async unmute(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    reason?: string
  ): Promise<ModActionResult> {
    const validationError = await this.validateHierarchy(guild, moderator, target);
    if (validationError) return { success: false, case: null, dmSent: false, error: validationError };

    await target.timeout(null, reason);

    const caseEntry = await this.logCase(
      guild.id, target.id, moderator.id, "unmute", reason || "", false
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
          sql`(warns.expires_at IS NULL OR warns.expires_at > ${Date.now()})`
        )
      );
    return result[0]?.count ?? 0;
  }

  async warn(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    reason?: string,
    amount: number = 1,
    customExpiryDays?: number
  ): Promise<WarnActionResult> {
    const validationError = await this.validateHierarchy(guild, moderator, target);
    if (validationError) return { success: false, case: null, dmSent: false, error: validationError };

    const settings = await this.getWarnSettings(guild.id);
    const expiryDays = customExpiryDays ?? settings?.defaultExpiryDays ?? 3;
    const expiryMs = expiryDays * 86400000;

    const caseEntry = await this.logCase(
      guild.id, target.id, moderator.id, "warn", reason || "", false
    );

    // Create N staggered warn entries
    for (let i = 0; i < amount; i++) {
      const expiresAt = settings?.defaultExpiryDays
        ? Date.now() + (i + 1) * expiryMs
        : null;
      await db.insert(warns).values({
        caseId: caseEntry.id,
        guildId: guild.id,
        userId: target.id,
        moderatorId: moderator.id,
        warnCount: i + 1,
        expiresAt: expiresAt ?? undefined,
      });
    }

    // Attempt DM
    const dmSent = await this.tryDm(
      target.user, "warned", guild.name,
      `${reason || ""} (warn level: ${amount})`
    );

    // Check threshold actions
    const currentCount = await this.getActiveWarnCount(guild.id

  Thought for 4s

Continuing the plan raw text from where it cut off:

    // Check threshold actions
    const currentCount = await this.getActiveWarnCount(guild.id, target.id);

    return { success: true, case: caseEntry, dmSent, warnCount: amount };
  }

  async setWarnLevel(
    guild: Guild,
    moderator: GuildMember,
    target: GuildMember,
    level: number,
    reason?: string
  ): Promise<WarnActionResult> {
    // Validation
    const validationError = await this.validateHierarchy(guild, moderator, target);
    if (validationError) return { success: false, case: null, dmSent: false, error: validationError };

    // Log a single case
    const caseEntry = await this.logCase(
      guild.id, target.id, moderator.id, "warn", reason || `Warn level set to ${level}`, false
    );

    // All counts expire at the same time (single duration)
    const settings = await this.getWarnSettings(guild.id);
    const expiryDays = settings?.defaultExpiryDays ?? 3;
    const expiresAt = Date.now() + expiryDays * 86400000;

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

    return { success: true, case: caseEntry, dmSent: false, warnCount: level };
  }

  async unwarn(caseId: number, moderatorId: string): Promise<ModActionResult> {
    const [existingCase] = await db
      .select()
      .from(modCases)
      .where(eq(modCases.id, caseId))
      .limit(1);

    if (!existingCase) return { success: false, case: null, dmSent: false, error: "Case not found." };

    const activeWarns = await db
      .update(warns)
      .set({ revoked: true, revokedBy: moderatorId, revokedAt: Date.now() })
      .where(and(eq(warns.caseId, caseId), eq(warns.revoked, false)))
      .returning();

    return {
      success: activeWarns.length > 0,
      case: existingCase,
      dmSent: false,
      error: activeWarns.length === 0 ? "That warn has already been removed." : undefined,
    };
  }

  async editDuration(caseId: number, newDurationMs: number): Promise<boolean> {
    const [existing] = await db
      .select()
      .from(modCases)
      .where(eq(modCases.id, caseId))
      .limit(1);
    if (!existing) return false;

    await db
      .update(modCases)
      .set({ duration: newDurationMs, updatedAt: Date.now() })
      .where(eq(modCases.id, caseId));

    // Update warn expires_at if it's a warn
    if (existing.actionType === "warn") {
      const relatedWarns = await db
        .select()
        .from(warns)
        .where(and(eq(warns.caseId, caseId), eq(warns.revoked, false)));

      for (const w of relatedWarns) {
        await db
          .update(warns)
          .set({ expiresAt: Date.now() + newDurationMs * w.warnCount })
          .where(eq(warns.id, w.id));
      }
    }

    return true;
  }

  async addNote(caseId: number, moderatorId: string, note: string): Promise<boolean> {
    const [existing] = await db
      .select()
      .from(modCases)
      .where(eq(modCases.id, caseId))
      .limit(1);
    if (!existing) return false;

    await db.insert(caseNotes).values({ caseId, moderatorId, note });
    return true;
  }

  async getWarnSettings(guildId: string) {
    const [settings] = await db
      .select()
      .from(warnSettings)
      .where(eq(warnSettings.guildId, guildId))
      .limit(1);
    return settings ?? null;
  }

  async getCasesForUser(
    guildId: string,
    userId: string,
    actionType?: ActionType,
    limit: number = 5,
    offset: number = 0
  ) {
    const conditions = [
      eq(modCases.guildId, guildId),
      eq(modCases.userId, userId),
    ];
    if (actionType && actionType !== "all") conditions.push(eq(modCases.actionType, actionType));

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
}

export const modActionService = new ModActionService();

---
Task 4: i18n — Language Keys for Moderation

- [ ] Step 1: Create src/languages/en-US/commands/moderation.json

{
  "kick": {
    "commandName": "kick",
    "commandDescription": "Kick a user from the server.",
    "userFieldName": "user",
    "userFieldDescription": "The user to kick.",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the kick.",
    "title": "Kicked",
    "desc": "**{{user}}** has been kicked.",
    "descWithReason": "**{{user}}** has been kicked for **{{reason}}**.",
    "dmSent": "DM sent to the user.",
    "dmNotSent": "Couldn't DM the user."
  },
  "ban": {
    "commandName": "ban",
    "commandDescription": "Ban a user from the server.",
    "userFieldName": "user",
    "userFieldDescription": "The user to ban.",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the ban.",
    "durationFieldName": "duration",
    "durationFieldDescription": "How long the ban should last (e.g. 7d).",
    "deleteMessagesFieldName": "delete-messages",
    "deleteMessagesFieldDescription": "Delete recent messages from the user.",
    "title": "Banned",
    "desc": "**{{user}}** has been banned.",
    "descWithReason": "**{{user}}** has been banned for **{{reason}}**.",
    "descTemp": "**{{user}}** has been banned for **{{duration}}**.",
    "dmSent": "DM sent to the user.",
    "dmNotSent": "Couldn't DM the user.",
    "deleteMessagesNone": "Don't delete any",
    "deleteMessages1h": "Last hour",
    "deleteMessages6h": "Last 6 hours",
    "deleteMessages24h": "Last 24 hours",
    "deleteMessages3d": "Last 3 days",
    "deleteMessages7d": "Last 7 days"
  },
  "unban": {
    "commandName": "unban",
    "commandDescription": "Unban a user from the server.",
    "userIdFieldName": "user-id",
    "userIdFieldDescription": "The ID of the user to unban.",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the unban.",
    "title": "Unbanned",
    "desc": "**{{user}}** has been unbanned.",
    "descWithReason": "**{{user}}** has been unbanned: **{{reason}}**."
  },
  "mute": {
    "commandName": "mute",
    "commandDescription": "Mute a user in the server.",
    "userFieldName": "user",
    "userFieldDescription": "The user to mute.",
    "durationFieldName": "duration",
    "durationFieldDescription": "How long the mute should last (e.g. 1h, 7d).",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the mute.",
    "title": "Muted",
    "desc": "**{{user}}** has been muted for **{{duration}}**.",
    "descWithReason": "**{{user}}** has been muted for **{{duration}}**: **{{reason}}**.",
    "dmSent": "DM sent to the user.",
    "dmNotSent": "Couldn't DM the user.",
    "durationTooLong": "Timeouts can't be longer than 28 days."
  },
  "unmute": {
    "commandName": "unmute",
    "commandDescription": "Unmute a user in the server.",
    "userFieldName": "user",
    "userFieldDescription": "The user to unmute.",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the unmute.",
    "title": "Unmuted",
    "desc": "**{{user}}** has been unmuted.",
    "descWithReason": "**{{user}}** has been unmuted: **{{reason}}**."
  },
  "warn": {
    "commandName": "warn",
    "commandDescription": "Warn a user.",
    "userFieldName": "user",
    "userFieldDescription": "The user to warn.",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the warn.",
    "amountFieldName": "amount",
    "amountFieldDescription": "How many warn counts to add (default 1).",
    "advancedFieldName": "advanced",
    "advancedFieldDescription": "Open the advanced warn editor.",
    "subcommandListName": "list",
    "subcommandListDescription": "List active warns for a user.",
    "subcommandRemoveName": "remove",
    "subcommandRemoveDescription": "Remove a warn by case ID.",
    "subcommandLevelName": "level",
    "subcommandLevelDescription": "Set a user's warn level directly.",
    "subcommandSetName": "set",
    "subcommandSetDescription": "Set a warn level on a user.",
    "subcommandMultiName": "multi",
    "subcommandMultiDescription": "Warn multiple users at once.",
    "usersFieldName": "users",
    "usersFieldDescription": "The users to warn (comma-separated mentions/IDs).",
    "levelFieldName": "level",
    "levelFieldDescription": "The warn level to set (1-10).",
    "caseIdFieldName": "case-id",
    "caseIdFieldDescription": "The case ID of the warn to remove.",
    "userFieldName": "user",
    "userFieldDescription": "The user to check.",
    "title": "Warned",
    "desc": "**{{user}}** has been warned (count: {{amount}}).",
    "descWithReason": "**{{user}}** has been warned: **{{reason}}** (count: {{amount}}).",
    "warnedCount": "User now has **{{count}}** active warn(s).",
    "heavywarnCommandName": "heavywarn",
    "heavywarnCommandDescription": "Issue a heavy warn (2 warn counts).",
    "listTitle": "Warns for {{user}}",
    "listEmpty": "No active warns for this user.",
    "listEntry": "#{{id}} — {{reason}} (expires {{expiry}})"
  },
  "warnSettings": {
    "commandName": "settings",
    "commandDescription": "Manage warn system settings.",
    "subcommandActionsName": "actions",
    "subcommandActionsDescription": "Configure threshold actions.",
    "subcommandRolesName": "roles",
    "subcommandRolesDescription": "Configure role-per-warn-level.",
    "subcommandPresetName": "preset",
    "subcommandPresetDescription": "Apply a preset configuration.",
    "quickstartCommandName": "quickstart",
    "quickstartCommandDescription": "Interactive warn system setup wizard.",
    "viewTitle": "Warn System Settings",
    "maxWarns": "Max Warns",
    "expiry": "Expiry",
    "dmOnWarn": "DM on Warn",
    "actions": "Threshold Actions",
    "noActions": "No threshold actions configured."
  },
  "case": {
    "commandName": "case",
    "commandDescription": "View moderation history for a user.",
    "userFieldName": "user",
    "userFieldDescription": "The user to check.",
    "actionTypeFieldName": "action-type",
    "actionTypeFieldDescription": "Filter by action type.",
    "actionTypeAll": "All",
    "title": "Cases for {{user}}",
    "noCases": "No cases found for this user.",
    "page": "Page {{page}}/{{total}}",
    "empty": "This user has no moderation history.",
    "fields": {
      "action": "Action",
      "moderator": "Moderator",
      "reason": "Reason",
      "dmStatus": "DM",
      "date": "Date",
      "notes": "Notes"
    }
  },
  "note": {
    "commandName": "note",
    "commandDescription": "Manage mod notes on users.",
    "subcommandAddName": "add",
    "subcommandAddDescription": "Add a note to a user.",
    "subcommandListName": "list",
    "subcommandListDescription": "List notes for a user.",
    "subcommandRemoveName": "remove",
    "subcommandRemoveDescription": "Remove a note by case ID.",
    "userFieldName": "user",
    "userFieldDescription": "The user to note.",
    "noteFieldName": "note",
    "noteFieldDescription": "The note content.",
    "caseIdFieldName": "case-id",
    "caseIdFieldDescription": "The case ID of the note to remove.",
    "addedTitle": "Note Added",
    "addedDesc": "Note added to {{user}}.",
    "listTitle": "Notes for {{user}}",
    "listEntry": "#{{id}} — {{mod}}: {{note}}",
    "listEmpty": "No notes for this user.",
    "removedTitle": "Note Removed",
    "removedDesc": "Note #{{id}} has been removed."
  },
  "errors": {
    "targetNotInGuild": "I couldn't find that user in this server.",
    "hierarchyTooLow": "You can't action that user — they're above you in the role hierarchy.",
    "botHierarchyTooLow": "I can't action that user — I need a higher role.",
    "durationTooLong": "That duration is too long. The maximum is 28 days.",
    "warnSettingsNotConfigured": "Warn settings haven't been configured yet. Run `/warn quickstart` or `/warn settings` to set up the warn system.",
    "caseNotFound": "I couldn't find that case.",
    "warnAlreadyRevoked": "That warn has already been removed.",
    "cannotActionSelf": "You can't action yourself.",
    "cannotActionBot": "I can't action myself.",
    "cannotActionAdmin": "I can't action a server admin.",
    "invalidUserId": "That doesn't look like a valid user ID.",
    "invalidAmount": "The amount must be between 1 and 10.",
    "invalidLevel": "The level must be between 1 and {{max}}.",
    "multiWarnParseError": "I couldn't parse the users list. Use comma-separated mentions or IDs."
  }
}

- [ ] Step 2: Create Italian (it) and Spanish (es-ES) versions (same structure, translated)
- [ ] Step 3: Create src/lib/i18n/commands/moderation.ts

import { FT, T, type CapitalizedObjectKeys } from "../../types/utils.js";
import moderation from "../../../languages/en-US/commands/moderation.json" with { type: "json" };

export default {
  Kick: {
    commandName: T("commands/moderation:kick.commandName"),
    commandDescription: T("commands/moderation:kick.commandDescription"),
    // ... one entry per JSON key following the pattern in utility.ts
    title: T("commands/moderation:kick.title"),
    desc: FT<{ user: string }>("commands/moderation:kick.desc"),
    descWithReason: FT<{ user: string; reason: string }>("commands/moderation:kick.descWithReason"),
    dmSent: T("commands/moderation:kick.dmSent"),
    dmNotSent: T("commands/moderation:kick.dmNotSent"),
  },
  // ... same for ban, unban, mute, unmute, warn, warnSettings, case, note, errors
} as CapitalizedObjectKeys<typeof moderation>;

- [ ] Step 4: Update src/lib/i18n/commands/index.ts

import Utility from "./utility.js";
import Moderation from "./moderation.js";

export default {
  Utility,
  Moderation,
} as const;

---
Task 5: Kick Command (src/commands/mod/kick.ts)

Files:
- Create: src/commands/mod/kick.ts

Pattern: extends CommandUtils.ModCommand, guild-only, KickMembers permission, calls modActionService.kick(), renders v2 confirmation.

---
Task 6: Ban + Unban Commands (src/commands/mod/ban.ts)

Files:
- Create: src/commands/mod/ban.ts

Both /ban and /unban in one file. /ban has duration option for temp bans. /unban takes a user ID.

Subcommand tree:
- ban —

  Thought for 3s

Continuing the plan — remaining tasks in compact form:

---
Task 6: Ban + Unban (src/commands/mod/ban.ts)

/ban subcommand: user (required), reason (optional), duration (optional string), delete-messages (choice: none/1h/6h/24h/3d/7d)

/unban subcommand: user-id (required string), reason (optional)

Pattern: PomeloSubcommand (subcommand tree), guild-only, BanMembers permission, calls modActionService.ban() / .unban(), v2 response.

---
Task 7: Mute + Unmute (src/commands/mod/mute.ts)

/mute subcommand: user (required), duration (required string), reason (optional)

/unmute subcommand: user (required), reason (optional)

Pattern: PomeloSubcommand, guild-only, ModerateMembers permission, uses member.timeout() through the service. Validate duration ≤ 28 days. v2 response.

---
Task 8: Warn Command (src/commands/mod/warn.ts)

/warn is a PomeloSubcommand with these subcommands:

┌────────────┬───────────────────────────────────┬────────────────────────────────────────────────────────────────┐
│ Subcommand │              Options              │                            Behavior                            │
├────────────┼───────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ (default)  │ user, reason?, amount?, advanced? │ Issues warn via service. If advanced → modal → preview →       │
│            │                                   │ confirm                                                        │
├────────────┼───────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ list       │ user                              │ Shows active warns in v2 container                             │
├────────────┼───────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ remove     │ case-id                           │ Revokes warn via service.unwarn()                              │
├────────────┼───────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ level set  │ user, level, reason?              │ Sets warn level via service.setWarnLevel()                     │
├────────────┼───────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ multi      │ users, reason?, amount?,          │ Parses comma-separated users, warns each                       │
│            │ advanced?                         │                                                                │
└────────────┴───────────────────────────────────┴────────────────────────────────────────────────────────────────┘

Advanced mode flow (amount + advanced):
1. Open modal with: reason, amount, custom-expiry, custom-punishments
2. On submit → show v2 preview with full breakdown
3. Confirm/cancel buttons → only warn on confirm

Heavywarn: Register a separate command (heavywarn) that aliases to warn with amount=2.

Guild-only, ModerateMembers, v2 responses.

---
Task 9: Warn Settings (src/commands/mod/warnSettings.ts)

/warn settings is a PomeloSubcommand:

┌─────────────┬───────────────────────────────────────────────────────────────────┐
│ Subcommand  │                              Details                              │
├─────────────┼───────────────────────────────────────────────────────────────────┤
│ (default)   │ View current config as v2 container                               │
├─────────────┼───────────────────────────────────────────────────────────────────┤
│ max-warns   │ Integer 1-20                                                      │
├─────────────┼───────────────────────────────────────────────────────────────────┤
│ expiry      │ Days (1-365)                                                      │
├─────────────┼───────────────────────────────────────────────────────────────────┤
│ dm          │ Boolean                                                           │
├─────────────┼───────────────────────────────────────────────────────────────────┤
│ log-channel │ Channel select                                                    │
├─────────────┼───────────────────────────────────────────────────────────────────┤
│ actions     │ Interactive: select warn count → modal for action config          │
├─────────────┼───────────────────────────────────────────────────────────────────┤
│ roles       │ Modal: JSON config for role-per-level                             │
├─────────────┼───────────────────────────────────────────────────────────────────┤
│ preset      │ String select: mute>kick>ban / mute>mute>ban / mute>mute>kick>ban │
├─────────────┼───────────────────────────────────────────────────────────────────┤
│ quickstart  │ Multi-step wizard (buttons → selects → modal → confirm)           │
└─────────────┴───────────────────────────────────────────────────────────────────┘

Guild-only, requires ManageGuild or Administrator.

Store/update via db directly on warnSettings table. Actions are JSON-stringified in the actions column.

---
Task 10: Caselogs (src/commands/mod/case.ts)

/case <user> [action_type]

- Guild-only, ModerateMembers
- Uses embeds (EmbedUtils.EmbedConstructor) + ComponentUtils.PomeloPaginatedMessage
- Fetches from mod_cases via service.getCasesForUser()
- 5 cases per page
- Filter by action_type (StringSelectMenu)
- Each page shows: case ID, action type badge, moderator, reason, DM status (emoji), timestamp, notes count indicator

---
Task 11: Mod Notes (src/commands/mod/note.ts)

Subcommand tree:

┌────────────┬────────────────────────────────────────────────────┐
│ Subcommand │                      Options                       │
├────────────┼────────────────────────────────────────────────────┤
│ add        │ user (required), note (required string)            │
├────────────┼────────────────────────────────────────────────────┤
│ list       │ user (required) — renders via caselogs-style embed │
├────────────┼────────────────────────────────────────────────────┤
│ remove     │ case-id (required)                                 │
└────────────┴────────────────────────────────────────────────────┘

- Uses service.addNote() / queries caseNotes directly
- Notes are type "note" in mod_cases
- List view reuses caselog formatting

---
Task 12: Auto-Unban Scheduled Task (src/scheduled-tasks/autoUnban.ts)

import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import { db } from "../db/index.js";
import { modCases } from "../db/schema.js";
import { eq } from "drizzle-orm";

export class AutoUnban extends ScheduledTask {
  public async run(payload: { guildId: string; userId: string; moderatorId: string; caseId: number; reason: string }) {
    const guild = this.container.client.guilds.cache.get(payload.guildId);
    if (!guild) return;

    try {
      await guild.bans.remove(payload.userId, payload.reason);
      await db
        .update(modCases)
        .set({ updatedAt: Date.now() })
        .where(eq(modCases.id, payload.caseId));
    } catch {
      // Already unbanned or guild issue — log silently
    }
  }
}

declare module "@sapphire/plugin-scheduled-tasks" {
  interface ScheduledTasks {
    autoUnban: {
      guildId: string;
      userId: string;
      moderatorId: string;
      caseId: number;
      reason: string;
    };
  }
}

---
Task 13: Error Helper (src/lib/moderation/errors.ts)

export class ModerationError extends Error {
  constructor(public key: string, public context?: Record<string, unknown>) {
    super(key);
  }
}

export const ModErrors = {
  TargetNotInGuild: "targetNotInGuild",
  HierarchyTooLow: "hierarchyTooLow",
  BotHierarchyTooLow: "botHierarchyTooLow",
  DurationTooLong: "durationTooLong",
  CaseNotFound: "caseNotFound",
  WarnAlreadyRevoked: "warnAlreadyRevoked",
} as const;

---
Execution order

┌───────┬───────────────────────┬────────────┐
│ Order │         Task          │ Depends on │
├───────┼───────────────────────┼────────────┤
│ 1     │ DB schema + migration │ —          │
├───────┼───────────────────────┼────────────┤
│ 2     │ Shared types          │ —          │
├───────┼───────────────────────┼────────────┤
│ 3     │ ModActionService      │ 1, 2       │
├───────┼───────────────────────┼────────────┤
│ 4     │ i18n keys             │ —          │
├───────┼───────────────────────┼────────────┤
│ 5     │ Kick command          │ 3, 4       │
├───────┼───────────────────────┼────────────┤
│ 6     │ Ban + Unban           │ 3, 4       │
├───────┼───────────────────────┼────────────┤
│ 7     │ Mute + Unmute         │ 3, 4       │
├───────┼───────────────────────┼────────────┤
│ 8     │ Warn command          │ 3, 4       │
├───────┼───────────────────────┼────────────┤
│ 9     │ Warn settings         │ 3, 4       │
├───────┼───────────────────────┼────────────┤
│ 10    │ Caselogs              │ 1, 4       │
├───────┼───────────────────────┼────────────┤
│ 11    │ Mod notes             │ 3, 4, 10   │
├───────┼───────────────────────┼────────────┤
│ 12    │ Auto-unban task       │ 3          │
└───────┴───────────────────────┴────────────┘

Tasks 5-11 are independent of each other once Task 3 is done — they can be parallelized.

Each command file follows the exact same structure as afk.ts: registerApplicationCommands() with setIntegrationTypes([GuildInstall]) (no UserInstall), chatInputRun() with deferReply({ flags: MessageFlags.Ephemeral }), and a private execute() method that calls the service and renders a v2 ContainerBuilder response.
