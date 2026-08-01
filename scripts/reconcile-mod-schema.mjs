// One-off reconciliation: bring the live Turso DB up to the post-0002
// moderation schema WITHOUT dropping legacy tables (migration 0001 is a
// destructive DROP+CREATE and was never applied to this DB).
// Everything here is additive: ADD COLUMN, CREATE TABLE/INDEX IF NOT
// EXISTS, and backfills for the new NOT NULL-ish columns.
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function run(sql) {
  try {
    await client.execute(sql);
    console.log("OK  ", sql.split("\n")[0].slice(0, 90));
  } catch (e) {
    if (/duplicate column name/i.test(e.message)) {
      console.log("SKIP (exists)", sql.split("\n")[0].slice(0, 70));
      return;
    }
    throw e;
  }
}

// --- mod_cases: add the new-system columns, backfill identifiers ---
await run("ALTER TABLE `mod_cases` ADD COLUMN `case_number` integer");
await run("ALTER TABLE `mod_cases` ADD COLUMN `operation_key` text");
await run("ALTER TABLE `mod_cases` ADD COLUMN `parent_case_id` integer");
await run("ALTER TABLE `mod_cases` ADD COLUMN `source_case_id` integer");
await run("ALTER TABLE `mod_cases` ADD COLUMN `resulting_warn_count` integer");
await run(
  "ALTER TABLE `mod_cases` ADD COLUMN `status` text DEFAULT 'completed' NOT NULL",
);
await run("ALTER TABLE `mod_cases` ADD COLUMN `failure_code` text");
await run("ALTER TABLE `mod_cases` ADD COLUMN `temporary_ban_token` text");
await run(
  "UPDATE `mod_cases` SET `case_number` = (SELECT COUNT(*) FROM `mod_cases` m2 WHERE m2.`guild_id` = `mod_cases`.`guild_id` AND m2.`id` <= `mod_cases`.`id`) WHERE `case_number` IS NULL",
);
await run(
  "UPDATE `mod_cases` SET `operation_key` = 'legacy:' || `id` WHERE `operation_key` IS NULL",
);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `mod_cases_guild_case_number_unique` ON `mod_cases` (`guild_id`,`case_number`)",
);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `mod_cases_guild_operation_key_unique` ON `mod_cases` (`guild_id`,`operation_key`)",
);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `mod_cases_guild_id_id_unique` ON `mod_cases` (`guild_id`,`id`)",
);

// --- case_counters ---
await run(`CREATE TABLE IF NOT EXISTS \`case_counters\` (
	\`guild_id\` text PRIMARY KEY NOT NULL,
	\`next_case_number\` integer DEFAULT 1 NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL
)`);
await run(
  "INSERT INTO `case_counters` (`guild_id`, `next_case_number`) SELECT `guild_id`, MAX(`case_number`) + 1 FROM `mod_cases` GROUP BY `guild_id` ON CONFLICT(`guild_id`) DO NOTHING",
);

// --- warn_settings: the columns behind the reported save error ---
await run(
  "ALTER TABLE `warn_settings` ADD COLUMN `auto_apply_warn_punishments` integer DEFAULT false NOT NULL",
);
await run(
  "ALTER TABLE `warn_settings` ADD COLUMN `dangerously_bypass_warn_permissions` integer DEFAULT false NOT NULL",
);
await run(
  "ALTER TABLE `warn_settings` ADD COLUMN `created_at` integer DEFAULT 0 NOT NULL",
);
await run(
  "ALTER TABLE `warn_settings` ADD COLUMN `updated_at` integer DEFAULT 0 NOT NULL",
);
await run(
  "UPDATE `warn_settings` SET `created_at` = strftime('%s','now') * 1000 WHERE `created_at` = 0",
);
await run(
  "UPDATE `warn_settings` SET `updated_at` = strftime('%s','now') * 1000 WHERE `updated_at` = 0",
);

// --- case_notes ---
await run("ALTER TABLE `case_notes` ADD COLUMN `guild_id` text");
await run("ALTER TABLE `case_notes` ADD COLUMN `operation_key` text");
await run(
  "UPDATE `case_notes` SET `guild_id` = (SELECT `guild_id` FROM `mod_cases` WHERE `mod_cases`.`id` = `case_notes`.`case_id`) WHERE `guild_id` IS NULL",
);
await run(
  "UPDATE `case_notes` SET `operation_key` = 'legacy:' || `id` WHERE `operation_key` IS NULL",
);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `case_notes_guild_operation_key_unique` ON `case_notes` (`guild_id`,`operation_key`)",
);
await run(
  "CREATE INDEX IF NOT EXISTS `case_notes_guild_case_created_index` ON `case_notes` (`guild_id`,`case_id`,`created_at`)",
);

// --- warns ---
await run("ALTER TABLE `warns` ADD COLUMN `revoked_by_case_id` integer");
await run(
  "ALTER TABLE `warns` ADD COLUMN `created_at` integer DEFAULT 0 NOT NULL",
);
await run(
  "UPDATE `warns` SET `created_at` = strftime('%s','now') * 1000 WHERE `created_at` = 0",
);
await run(
  "CREATE INDEX IF NOT EXISTS `warns_guild_user_active_index` ON `warns` (`guild_id`,`user_id`,`revoked`)",
);

// --- warn punishment batch tables (0001) + expires_at (0002) ---
await run(`CREATE TABLE IF NOT EXISTS \`warn_punishment_batches\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`public_id\` text NOT NULL,
	\`guild_id\` text NOT NULL,
	\`warn_case_id\` integer NOT NULL,
	\`target_user_id\` text NOT NULL,
	\`threshold\` integer NOT NULL,
	\`operation_key\` text NOT NULL,
	\`config_json\` text DEFAULT '{}' NOT NULL,
	\`state\` text DEFAULT 'pending' NOT NULL CHECK (\`state\` IN ('pending','partially_applied','completed','cancelled','failed')),
	\`revision\` integer DEFAULT 1 NOT NULL,
	\`dismissed_by\` text,
	\`dismissed_at\` integer,
	\`display_channel_id\` text,
	\`display_message_id\` text,
	\`expires_at\` integer,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`guild_id\`,\`warn_case_id\`) REFERENCES \`mod_cases\`(\`guild_id\`,\`id\`)
)`);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `warn_punishment_batches_guild_public_id_unique` ON `warn_punishment_batches` (`guild_id`,`public_id`)",
);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `warn_punishment_batches_guild_operation_key_unique` ON `warn_punishment_batches` (`guild_id`,`operation_key`)",
);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `warn_punishment_batches_guild_id_id_unique` ON `warn_punishment_batches` (`guild_id`,`id`)",
);
await run(
  "CREATE INDEX IF NOT EXISTS `warn_punishment_batches_guild_state_created_index` ON `warn_punishment_batches` (`guild_id`,`state`,`created_at`)",
);
await run(
  "CREATE INDEX IF NOT EXISTS `warn_punishment_batches_expiry_index` ON `warn_punishment_batches` (`expires_at`)",
);

await run(`CREATE TABLE IF NOT EXISTS \`warn_punishment_items\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`guild_id\` text NOT NULL,
	\`batch_id\` integer NOT NULL,
	\`ordinal\` integer NOT NULL,
	\`punishment_type\` text NOT NULL,
	\`duration\` integer,
	\`role_id\` text,
	\`message\` text,
	\`state\` text DEFAULT 'pending' NOT NULL CHECK (\`state\` IN ('pending','executing','applied','cancelled','superseded','inapplicable','retryable_failed','terminal_failed','manual_review')),
	\`version\` integer DEFAULT 1 NOT NULL,
	\`lease_token\` text,
	\`lease_expires_at\` integer,
	\`attempt_count\` integer DEFAULT 0 NOT NULL,
	\`last_attempt_at\` integer,
	\`result_case_id\` integer,
	\`failure_code\` text,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`guild_id\`,\`batch_id\`) REFERENCES \`warn_punishment_batches\`(\`guild_id\`,\`id\`),
	FOREIGN KEY (\`guild_id\`,\`result_case_id\`) REFERENCES \`mod_cases\`(\`guild_id\`,\`id\`)
)`);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `warn_punishment_items_batch_ordinal_unique` ON `warn_punishment_items` (`batch_id`,`ordinal`)",
);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `warn_punishment_items_guild_id_id_unique` ON `warn_punishment_items` (`guild_id`,`id`)",
);
await run(
  "CREATE INDEX IF NOT EXISTS `warn_punishment_items_guild_state_created_index` ON `warn_punishment_items` (`guild_id`,`state`,`created_at`)",
);
await run(
  "CREATE INDEX IF NOT EXISTS `warn_punishment_items_lease_expiry_index` ON `warn_punishment_items` (`state`,`lease_expires_at`)",
);

await run(`CREATE TABLE IF NOT EXISTS \`warn_punishment_attempts\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`guild_id\` text NOT NULL,
	\`item_id\` integer NOT NULL,
	\`attempt_number\` integer NOT NULL,
	\`actor_id\` text,
	\`state\` text NOT NULL,
	\`failure_code\` text,
	\`detail\` text,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`guild_id\`,\`item_id\`) REFERENCES \`warn_punishment_items\`(\`guild_id\`,\`id\`)
)`);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `warn_punishment_attempts_item_attempt_unique` ON `warn_punishment_attempts` (`item_id`,`attempt_number`)",
);
await run(
  "CREATE INDEX IF NOT EXISTS `warn_punishment_attempts_guild_state_created_index` ON `warn_punishment_attempts` (`guild_id`,`state`,`created_at`)",
);

await run(`CREATE TABLE IF NOT EXISTS \`temporary_ban_tokens\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`guild_id\` text NOT NULL,
	\`case_id\` integer NOT NULL,
	\`token\` text NOT NULL,
	\`expires_at\` integer NOT NULL,
	\`consumed_at\` integer,
	\`created_at\` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (\`guild_id\`,\`case_id\`) REFERENCES \`mod_cases\`(\`guild_id\`,\`id\`)
)`);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `temporary_ban_tokens_guild_case_unique` ON `temporary_ban_tokens` (`guild_id`,`case_id`)",
);
await run(
  "CREATE UNIQUE INDEX IF NOT EXISTS `temporary_ban_tokens_token_unique` ON `temporary_ban_tokens` (`token`)",
);
await run(
  "CREATE INDEX IF NOT EXISTS `temporary_ban_tokens_expiry_index` ON `temporary_ban_tokens` (`expires_at`)",
);

// --- Mark 0001 as applied so a future `db:migrate` doesn't DROP live
// tables. Hash + timestamp mirror what drizzle's migrator would record.
const sql0001 = readFileSync("src/db/migrations/0001_faulty_tattoo.sql");
const hash = createHash("sha256").update(sql0001).digest("hex");
const existing = await client.execute({
  sql: "SELECT 1 FROM __drizzle_migrations WHERE hash = ?",
  args: [hash],
});
if (existing.rows.length === 0) {
  await client.execute({
    sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    args: [hash, 1784239349264],
  });
  console.log("OK   marked 0001_faulty_tattoo as applied");
} else {
  console.log("SKIP 0001 already recorded");
}

console.log("\nReconciliation complete.");
client.close();
