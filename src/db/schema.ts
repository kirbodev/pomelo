import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sqliteTable } from "drizzle-orm/sqlite-core";

export const devs = sqliteTable("devs", {
  userId: text("user_id").primaryKey(),
  secret: text("secret").notNull(),
  lastVerified: integer("last_verified", {
    mode: "timestamp",
  }).default(sql`(CURRENT_TIMESTAMP)`),
  timestamp: integer("timestamp", {
    mode: "timestamp",
  }).default(sql`(CURRENT_TIMESTAMP)`),
});

export type Dev = typeof devs.$inferSelect;
export type DevInsert = typeof devs.$inferInsert;

//SECTION - Calendar Database

//NOTE - This is the schema for the calendar database; it should be synced with the schema in the web/src/schema.ts file

export type AdapterAccountType = "email" | "oidc" | "oauth" | "webauthn";

export const users = sqliteTable("calendarUser", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
});

export const accounts = sqliteTable(
  "calendarAccount",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  }),
);

export const sessions = sqliteTable("calendarSession", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "calendarVerificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (verificationToken) => ({
    compositePk: primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  }),
);

export const authenticators = sqliteTable(
  "calendarAuthenticator",
  {
    credentialID: text("credentialID").notNull().unique(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("providerAccountId").notNull(),
    credentialPublicKey: text("credentialPublicKey").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credentialDeviceType").notNull(),
    credentialBackedUp: integer("credentialBackedUp", {
      mode: "boolean",
    }).notNull(),
    transports: text("transports"),
  },
  (authenticator) => ({
    compositePK: primaryKey({
      columns: [authenticator.userId, authenticator.credentialID],
    }),
  }),
);

export const linkedAccounts = sqliteTable("calendarLinkedAccount", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId").notNull(),
  linkCode: text("linkCode").notNull().unique(),
});

export const afkCalendars = sqliteTable("afkCalendar", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId").notNull(),
  calendarId: text("calendarId").notNull(),
  calendars: text("calendars").notNull(),
});

export const syncedEvents = sqliteTable("syncedEvents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId").notNull(),
  eventId: text("eventId").notNull(),
  taskId: text("taskId"),
  startTime: integer("startTime", { mode: "timestamp_ms" }).notNull(),
  endTime: integer("endTime", { mode: "timestamp_ms" }).notNull(),
  afkActive: integer("afkActive", { mode: "boolean" }).notNull().default(false),
  lastModified: integer("lastModified", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).default(
    sql`CURRENT_TIMESTAMP`,
  ),
});

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type VerificationToken = typeof verificationTokens.$inferSelect;
export type Authenticator = typeof authenticators.$inferSelect;
export type LinkedAccount = typeof linkedAccounts.$inferSelect;
export type LinkedAccountInsert = typeof linkedAccounts.$inferInsert;
export type AfkCalendar = typeof afkCalendars.$inferSelect;
export type AfkCalendarInsert = typeof afkCalendars.$inferInsert;
export type SyncedEvent = typeof syncedEvents.$inferSelect;
export type SyncedEventInsert = typeof syncedEvents.$inferInsert;
//!SECTION

//SECTION - Moderation Database

const nowMilliseconds = sql`(unixepoch() * 1000)`;

export const modCases = sqliteTable(
  "mod_cases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    caseNumber: integer("case_number").notNull(),
    operationKey: text("operation_key").notNull(),
    parentCaseId: integer("parent_case_id"),
    sourceCaseId: integer("source_case_id"),
    userId: text("user_id").notNull(),
    moderatorId: text("moderator_id").notNull(),
    actionType: text("action_type", {
      enum: [
        "ban",
        "unban",
        "kick",
        "mute",
        "unmute",
        "warn",
        "unwarn",
        "note",
        "role",
      ],
    }).notNull(),
    reason: text("reason").notNull().default(""),
    resultingWarnCount: integer("resulting_warn_count"),
    duration: integer("duration"),
    dmSent: integer("dm_sent", { mode: "boolean" }).notNull().default(false),
    status: text("status", {
      enum: ["pending", "completed", "cancelled", "failed", "manual_review"],
    })
      .notNull()
      .default("completed"),
    failureCode: text("failure_code"),
    temporaryBanToken: text("temporary_ban_token"),
    createdAt: integer("created_at").notNull().default(nowMilliseconds),
    updatedAt: integer("updated_at").notNull().default(nowMilliseconds),
  },
  (table) => ({
    guildCaseNumberUnique: uniqueIndex("mod_cases_guild_case_number_unique").on(
      table.guildId,
      table.caseNumber,
    ),
    guildOperationKeyUnique: uniqueIndex(
      "mod_cases_guild_operation_key_unique",
    ).on(table.guildId, table.operationKey),
    guildIdIdUnique: uniqueIndex("mod_cases_guild_id_id_unique").on(
      table.guildId,
      table.id,
    ),
    parentCaseForeignKey: foreignKey({
      columns: [table.guildId, table.parentCaseId],
      foreignColumns: [table.guildId, table.id],
      name: "mod_cases_parent_case_guild_fk",
    }),
    sourceCaseForeignKey: foreignKey({
      columns: [table.guildId, table.sourceCaseId],
      foreignColumns: [table.guildId, table.id],
      name: "mod_cases_source_case_guild_fk",
    }),
  }),
);

export const caseCounters = sqliteTable("case_counters", {
  guildId: text("guild_id").primaryKey(),
  nextCaseNumber: integer("next_case_number").notNull().default(1),
  updatedAt: integer("updated_at").notNull().default(nowMilliseconds),
});

export const warns = sqliteTable(
  "warns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    caseId: integer("case_id").notNull(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    moderatorId: text("moderator_id").notNull(),
    warnCount: integer("warn_count").notNull(),
    expiresAt: integer("expires_at"),
    revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
    revokedBy: text("revoked_by"),
    revokedAt: integer("revoked_at"),
    revokedByCaseId: integer("revoked_by_case_id"),
    createdAt: integer("created_at").notNull().default(nowMilliseconds),
  },
  (table) => ({
    guildCaseForeignKey: foreignKey({
      columns: [table.guildId, table.caseId],
      foreignColumns: [modCases.guildId, modCases.id],
      name: "warns_guild_case_fk",
    }),
    guildRevocationCaseForeignKey: foreignKey({
      columns: [table.guildId, table.revokedByCaseId],
      foreignColumns: [modCases.guildId, modCases.id],
      name: "warns_guild_revocation_case_fk",
    }),
    activeWarningsIndex: index("warns_guild_user_active_index").on(
      table.guildId,
      table.userId,
      table.revoked,
    ),
  }),
);

export const warnSettings = sqliteTable("warn_settings", {
  guildId: text("guild_id").primaryKey(),
  maxWarns: integer("max_warns").notNull().default(10),
  defaultExpiryDays: integer("default_expiry_days").notNull().default(3),
  dmOnWarn: integer("dm_on_warn", { mode: "boolean" }).notNull().default(true),
  autoApplyWarnPunishments: integer("auto_apply_warn_punishments", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  dangerouslyBypassWarnPermissions: integer(
    "dangerously_bypass_warn_permissions",
    { mode: "boolean" },
  )
    .notNull()
    .default(false),
  logChannelId: text("log_channel_id"),
  actions: text("actions").notNull().default("[]"),
  roleApply: text("role_apply"),
  createdAt: integer("created_at").notNull().default(nowMilliseconds),
  updatedAt: integer("updated_at").notNull().default(nowMilliseconds),
});

export const caseNotes = sqliteTable(
  "case_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    caseId: integer("case_id").notNull(),
    operationKey: text("operation_key").notNull(),
    moderatorId: text("moderator_id").notNull(),
    note: text("note").notNull(),
    createdAt: integer("created_at").notNull().default(nowMilliseconds),
  },
  (table) => ({
    guildCaseForeignKey: foreignKey({
      columns: [table.guildId, table.caseId],
      foreignColumns: [modCases.guildId, modCases.id],
      name: "case_notes_guild_case_fk",
    }),
    guildOperationKeyUnique: uniqueIndex(
      "case_notes_guild_operation_key_unique",
    ).on(table.guildId, table.operationKey),
    guildCaseCreatedIndex: index("case_notes_guild_case_created_index").on(
      table.guildId,
      table.caseId,
      table.createdAt,
    ),
  }),
);

export const warnPunishmentBatches = sqliteTable(
  "warn_punishment_batches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull(),
    guildId: text("guild_id").notNull(),
    warnCaseId: integer("warn_case_id").notNull(),
    targetUserId: text("target_user_id").notNull(),
    threshold: integer("threshold").notNull(),
    operationKey: text("operation_key").notNull(),
    configJson: text("config_json").notNull().default("{}"),
    state: text("state", {
      enum: [
        "pending",
        "partially_applied",
        "completed",
        "cancelled",
        "failed",
      ],
    })
      .notNull()
      .default("pending"),
    revision: integer("revision").notNull().default(1),
    dismissedBy: text("dismissed_by"),
    dismissedAt: integer("dismissed_at"),
    displayChannelId: text("display_channel_id"),
    displayMessageId: text("display_message_id"),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull().default(nowMilliseconds),
    updatedAt: integer("updated_at").notNull().default(nowMilliseconds),
  },
  (table) => ({
    guildWarnCaseForeignKey: foreignKey({
      columns: [table.guildId, table.warnCaseId],
      foreignColumns: [modCases.guildId, modCases.id],
      name: "warn_punishment_batches_guild_warn_case_fk",
    }),
    guildPublicIdUnique: uniqueIndex(
      "warn_punishment_batches_guild_public_id_unique",
    ).on(table.guildId, table.publicId),
    guildOperationKeyUnique: uniqueIndex(
      "warn_punishment_batches_guild_operation_key_unique",
    ).on(table.guildId, table.operationKey),
    guildIdIdUnique: uniqueIndex(
      "warn_punishment_batches_guild_id_id_unique",
    ).on(table.guildId, table.id),
    guildStateCreatedIndex: index(
      "warn_punishment_batches_guild_state_created_index",
    ).on(table.guildId, table.state, table.createdAt),
    expiryIndex: index("warn_punishment_batches_expiry_index").on(
      table.expiresAt,
    ),
  }),
);

export const warnPunishmentItems = sqliteTable(
  "warn_punishment_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    batchId: integer("batch_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    punishmentType: text("punishment_type", {
      enum: ["ban", "kick", "mute", "role", "message"],
    }).notNull(),
    duration: integer("duration"),
    roleId: text("role_id"),
    message: text("message"),
    state: text("state", {
      enum: [
        "pending",
        "executing",
        "applied",
        "cancelled",
        "superseded",
        "inapplicable",
        "retryable_failed",
        "terminal_failed",
        "manual_review",
      ],
    })
      .notNull()
      .default("pending"),
    version: integer("version").notNull().default(1),
    leaseToken: text("lease_token"),
    leaseExpiresAt: integer("lease_expires_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: integer("last_attempt_at"),
    resultCaseId: integer("result_case_id"),
    failureCode: text("failure_code"),
    createdAt: integer("created_at").notNull().default(nowMilliseconds),
    updatedAt: integer("updated_at").notNull().default(nowMilliseconds),
  },
  (table) => ({
    guildBatchForeignKey: foreignKey({
      columns: [table.guildId, table.batchId],
      foreignColumns: [warnPunishmentBatches.guildId, warnPunishmentBatches.id],
      name: "warn_punishment_items_guild_batch_fk",
    }),
    guildResultCaseForeignKey: foreignKey({
      columns: [table.guildId, table.resultCaseId],
      foreignColumns: [modCases.guildId, modCases.id],
      name: "warn_punishment_items_guild_result_case_fk",
    }),
    batchOrdinalUnique: uniqueIndex(
      "warn_punishment_items_batch_ordinal_unique",
    ).on(table.batchId, table.ordinal),
    guildIdIdUnique: uniqueIndex("warn_punishment_items_guild_id_id_unique").on(
      table.guildId,
      table.id,
    ),
    guildStateCreatedIndex: index(
      "warn_punishment_items_guild_state_created_index",
    ).on(table.guildId, table.state, table.createdAt),
    leaseExpiryIndex: index("warn_punishment_items_lease_expiry_index").on(
      table.state,
      table.leaseExpiresAt,
    ),
  }),
);

export const warnPunishmentAttempts = sqliteTable(
  "warn_punishment_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    itemId: integer("item_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    actorId: text("actor_id"),
    state: text("state", {
      enum: ["claimed", "applied", "denied", "failed", "recovered"],
    }).notNull(),
    failureCode: text("failure_code"),
    detail: text("detail"),
    createdAt: integer("created_at").notNull().default(nowMilliseconds),
  },
  (table) => ({
    guildItemForeignKey: foreignKey({
      columns: [table.guildId, table.itemId],
      foreignColumns: [warnPunishmentItems.guildId, warnPunishmentItems.id],
      name: "warn_punishment_attempts_guild_item_fk",
    }),
    itemAttemptUnique: uniqueIndex(
      "warn_punishment_attempts_item_attempt_unique",
    ).on(table.itemId, table.attemptNumber),
    guildStateCreatedIndex: index(
      "warn_punishment_attempts_guild_state_created_index",
    ).on(table.guildId, table.state, table.createdAt),
  }),
);

export const punishmentRoles = sqliteTable(
  "punishment_roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
    warnLevel: integer("warn_level").notNull(),
    caseId: integer("case_id"),
    expiresAt: integer("expires_at"),
    removed: integer("removed", { mode: "boolean" }).notNull().default(false),
    removedBy: text("removed_by"),
    removedAt: integer("removed_at"),
    createdAt: integer("created_at").notNull().default(nowMilliseconds),
    updatedAt: integer("updated_at").notNull().default(nowMilliseconds),
  },
  (table) => ({
    guildCaseForeignKey: foreignKey({
      columns: [table.guildId, table.caseId],
      foreignColumns: [modCases.guildId, modCases.id],
      name: "punishment_roles_guild_case_fk",
    }),
    guildUserRoleUnique: uniqueIndex("punishment_roles_guild_user_role_unique").on(
      table.guildId,
      table.userId,
      table.roleId,
    ),
    guildUserActiveIndex: index("punishment_roles_guild_user_active_index").on(
      table.guildId,
      table.userId,
      table.removed,
    ),
    expiryIndex: index("punishment_roles_expiry_index").on(
      table.removed,
      table.expiresAt,
    ),
  }),
);

export const temporaryBanTokens = sqliteTable(
  "temporary_ban_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    caseId: integer("case_id").notNull(),
    token: text("token").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull().default(nowMilliseconds),
  },
  (table) => ({
    guildCaseForeignKey: foreignKey({
      columns: [table.guildId, table.caseId],
      foreignColumns: [modCases.guildId, modCases.id],
      name: "temporary_ban_tokens_guild_case_fk",
    }),
    guildCaseUnique: uniqueIndex("temporary_ban_tokens_guild_case_unique").on(
      table.guildId,
      table.caseId,
    ),
    tokenUnique: uniqueIndex("temporary_ban_tokens_token_unique").on(
      table.token,
    ),
    expiryIndex: index("temporary_ban_tokens_expiry_index").on(table.expiresAt),
  }),
);

export type ModCase = typeof modCases.$inferSelect;
export type ModCaseInsert = typeof modCases.$inferInsert;
export type CaseCounter = typeof caseCounters.$inferSelect;
export type CaseCounterInsert = typeof caseCounters.$inferInsert;
export type Warn = typeof warns.$inferSelect;
export type WarnInsert = typeof warns.$inferInsert;
export type WarnSettings = typeof warnSettings.$inferSelect;
export type WarnSettingsInsert = typeof warnSettings.$inferInsert;
export type CaseNote = typeof caseNotes.$inferSelect;
export type CaseNoteInsert = typeof caseNotes.$inferInsert;
export type WarnPunishmentBatch = typeof warnPunishmentBatches.$inferSelect;
export type WarnPunishmentBatchInsert =
  typeof warnPunishmentBatches.$inferInsert;
export type WarnPunishmentItem = typeof warnPunishmentItems.$inferSelect;
export type WarnPunishmentItemInsert = typeof warnPunishmentItems.$inferInsert;
export type WarnPunishmentAttempt = typeof warnPunishmentAttempts.$inferSelect;
export type WarnPunishmentAttemptInsert =
  typeof warnPunishmentAttempts.$inferInsert;
export type PunishmentRole = typeof punishmentRoles.$inferSelect;
export type PunishmentRoleInsert = typeof punishmentRoles.$inferInsert;
export type TemporaryBanToken = typeof temporaryBanTokens.$inferSelect;
export type TemporaryBanTokenInsert = typeof temporaryBanTokens.$inferInsert;
//!SECTION

//SECTION - Redis Backup

export const redisBackups = sqliteTable(
  "redis_backups",
  {
    topic: text("topic").notNull(),
    key: text("key").notNull(),
    payload: text("payload"),
    contentHash: text("content_hash").notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at").notNull().default(nowMilliseconds),
  },
  (table) => ({
    topicKeyPk: primaryKey({
      columns: [table.topic, table.key],
    }),
    topicDeletedIndex: index("redis_backups_topic_deleted_index").on(
      table.topic,
      table.deleted,
    ),
  }),
);

export type RedisBackup = typeof redisBackups.$inferSelect;
export type RedisBackupInsert = typeof redisBackups.$inferInsert;
//!SECTION
