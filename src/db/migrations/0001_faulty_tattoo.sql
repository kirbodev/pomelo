PRAGMA foreign_keys = OFF;
--> statement-breakpoint
DROP TABLE IF EXISTS `warns`;
--> statement-breakpoint
DROP TABLE IF EXISTS `case_notes`;
--> statement-breakpoint
DROP TABLE IF EXISTS `warn_settings`;
--> statement-breakpoint
DROP TABLE IF EXISTS `mod_cases`;
--> statement-breakpoint
CREATE TABLE `mod_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`case_number` integer NOT NULL,
	`operation_key` text NOT NULL,
	`parent_case_id` integer,
	`source_case_id` integer,
	`user_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`action_type` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`resulting_warn_count` integer,
	`duration` integer,
	`dm_sent` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`failure_code` text,
	`temporary_ban_token` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`guild_id`,`parent_case_id`) REFERENCES `mod_cases`(`guild_id`,`id`),
	FOREIGN KEY (`guild_id`,`source_case_id`) REFERENCES `mod_cases`(`guild_id`,`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mod_cases_guild_case_number_unique` ON `mod_cases` (`guild_id`,`case_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mod_cases_guild_operation_key_unique` ON `mod_cases` (`guild_id`,`operation_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mod_cases_guild_id_id_unique` ON `mod_cases` (`guild_id`,`id`);
--> statement-breakpoint
CREATE TABLE `case_counters` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`next_case_number` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `warn_settings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`max_warns` integer DEFAULT 10 NOT NULL,
	`default_expiry_days` integer DEFAULT 3 NOT NULL,
	`dm_on_warn` integer DEFAULT true NOT NULL,
	`auto_apply_warn_punishments` integer DEFAULT false NOT NULL,
	`dangerously_bypass_warn_permissions` integer DEFAULT false NOT NULL,
	`log_channel_id` text,
	`actions` text DEFAULT '[]' NOT NULL,
	`role_apply` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `case_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`case_id` integer NOT NULL,
	`operation_key` text NOT NULL,
	`moderator_id` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`guild_id`,`case_id`) REFERENCES `mod_cases`(`guild_id`,`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `case_notes_guild_operation_key_unique` ON `case_notes` (`guild_id`,`operation_key`);
--> statement-breakpoint
CREATE INDEX `case_notes_guild_case_created_index` ON `case_notes` (`guild_id`,`case_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `warns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_id` integer NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`warn_count` integer NOT NULL,
	`expires_at` integer,
	`revoked` integer DEFAULT false NOT NULL,
	`revoked_by` text,
	`revoked_at` integer,
	`revoked_by_case_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`guild_id`,`case_id`) REFERENCES `mod_cases`(`guild_id`,`id`),
	FOREIGN KEY (`guild_id`,`revoked_by_case_id`) REFERENCES `mod_cases`(`guild_id`,`id`)
);
--> statement-breakpoint
CREATE INDEX `warns_guild_user_active_index` ON `warns` (`guild_id`,`user_id`,`revoked`);
--> statement-breakpoint
CREATE TABLE `warn_punishment_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`warn_case_id` integer NOT NULL,
	`target_user_id` text NOT NULL,
	`threshold` integer NOT NULL,
	`operation_key` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL CHECK (`state` IN ('pending','partially_applied','completed','cancelled','failed')),
	`revision` integer DEFAULT 1 NOT NULL,
	`dismissed_by` text,
	`dismissed_at` integer,
	`display_channel_id` text,
	`display_message_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`guild_id`,`warn_case_id`) REFERENCES `mod_cases`(`guild_id`,`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warn_punishment_batches_guild_public_id_unique` ON `warn_punishment_batches` (`guild_id`,`public_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `warn_punishment_batches_guild_operation_key_unique` ON `warn_punishment_batches` (`guild_id`,`operation_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `warn_punishment_batches_guild_id_id_unique` ON `warn_punishment_batches` (`guild_id`,`id`);
--> statement-breakpoint
CREATE INDEX `warn_punishment_batches_guild_state_created_index` ON `warn_punishment_batches` (`guild_id`,`state`,`created_at`);
--> statement-breakpoint
CREATE TABLE `warn_punishment_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`batch_id` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`punishment_type` text NOT NULL,
	`duration` integer,
	`role_id` text,
	`message` text,
	`state` text DEFAULT 'pending' NOT NULL CHECK (`state` IN ('pending','executing','applied','cancelled','superseded','inapplicable','retryable_failed','terminal_failed','manual_review')),
	`version` integer DEFAULT 1 NOT NULL,
	`lease_token` text,
	`lease_expires_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`result_case_id` integer,
	`failure_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`guild_id`,`batch_id`) REFERENCES `warn_punishment_batches`(`guild_id`,`id`),
	FOREIGN KEY (`guild_id`,`result_case_id`) REFERENCES `mod_cases`(`guild_id`,`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warn_punishment_items_batch_ordinal_unique` ON `warn_punishment_items` (`batch_id`,`ordinal`);
--> statement-breakpoint
CREATE UNIQUE INDEX `warn_punishment_items_guild_id_id_unique` ON `warn_punishment_items` (`guild_id`,`id`);
--> statement-breakpoint
CREATE INDEX `warn_punishment_items_guild_state_created_index` ON `warn_punishment_items` (`guild_id`,`state`,`created_at`);
--> statement-breakpoint
CREATE INDEX `warn_punishment_items_lease_expiry_index` ON `warn_punishment_items` (`state`,`lease_expires_at`);
--> statement-breakpoint
CREATE TABLE `warn_punishment_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`item_id` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`actor_id` text,
	`state` text NOT NULL,
	`failure_code` text,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`guild_id`,`item_id`) REFERENCES `warn_punishment_items`(`guild_id`,`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warn_punishment_attempts_item_attempt_unique` ON `warn_punishment_attempts` (`item_id`,`attempt_number`);
--> statement-breakpoint
CREATE INDEX `warn_punishment_attempts_guild_state_created_index` ON `warn_punishment_attempts` (`guild_id`,`state`,`created_at`);
--> statement-breakpoint
CREATE TABLE `temporary_ban_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`case_id` integer NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`guild_id`,`case_id`) REFERENCES `mod_cases`(`guild_id`,`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `temporary_ban_tokens_guild_case_unique` ON `temporary_ban_tokens` (`guild_id`,`case_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `temporary_ban_tokens_token_unique` ON `temporary_ban_tokens` (`token`);
--> statement-breakpoint
CREATE INDEX `temporary_ban_tokens_expiry_index` ON `temporary_ban_tokens` (`expires_at`);
--> statement-breakpoint
PRAGMA foreign_keys = ON;
