CREATE TABLE `redis_backups` (
	`topic` text NOT NULL,
	`key` text NOT NULL,
	`payload` text,
	`content_hash` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`key`, `topic`)
);
--> statement-breakpoint
CREATE INDEX `redis_backups_topic_deleted_index` ON `redis_backups` (`topic`,`deleted`);
