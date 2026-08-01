CREATE TABLE `punishment_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`warn_level` integer NOT NULL,
	`case_id` integer,
	`expires_at` integer,
	`removed` integer DEFAULT false NOT NULL,
	`removed_by` text,
	`removed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`guild_id`,`case_id`) REFERENCES `mod_cases`(`guild_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `punishment_roles_guild_user_role_unique` ON `punishment_roles` (`guild_id`,`user_id`,`role_id`);--> statement-breakpoint
CREATE INDEX `punishment_roles_guild_user_active_index` ON `punishment_roles` (`guild_id`,`user_id`,`removed`);--> statement-breakpoint
CREATE INDEX `punishment_roles_expiry_index` ON `punishment_roles` (`removed`,`expires_at`);