ALTER TABLE `warn_punishment_batches` ADD `expires_at` integer;--> statement-breakpoint
CREATE INDEX `warn_punishment_batches_expiry_index` ON `warn_punishment_batches` (`expires_at`);
