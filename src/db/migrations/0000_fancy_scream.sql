CREATE TABLE `calendarAccount` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `calendarUser`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `afkCalendar` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`calendarId` text NOT NULL,
	`calendars` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendarAuthenticator` (
	`credentialID` text NOT NULL,
	`userId` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`credentialPublicKey` text NOT NULL,
	`counter` integer NOT NULL,
	`credentialDeviceType` text NOT NULL,
	`credentialBackedUp` integer NOT NULL,
	`transports` text,
	PRIMARY KEY(`credentialID`, `userId`),
	FOREIGN KEY (`userId`) REFERENCES `calendarUser`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `case_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_id` integer NOT NULL,
	`moderator_id` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `mod_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`last_verified` integer DEFAULT (CURRENT_TIMESTAMP),
	`timestamp` integer DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE TABLE `calendarLinkedAccount` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`linkCode` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mod_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`action_type` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`duration` integer,
	`dm_sent` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendarSession` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `calendarUser`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `syncedEvents` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`eventId` text NOT NULL,
	`taskId` text,
	`startTime` integer NOT NULL,
	`endTime` integer NOT NULL,
	`afkActive` integer DEFAULT false NOT NULL,
	`lastModified` integer,
	`createdAt` integer DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `calendarUser` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text
);
--> statement-breakpoint
CREATE TABLE `calendarVerificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
--> statement-breakpoint
CREATE TABLE `warn_settings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`max_warns` integer DEFAULT 10 NOT NULL,
	`default_expiry_days` integer DEFAULT 3 NOT NULL,
	`dm_on_warn` integer DEFAULT true NOT NULL,
	`log_channel_id` text,
	`actions` text DEFAULT '[]' NOT NULL,
	`role_apply` text
);
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
	FOREIGN KEY (`case_id`) REFERENCES `mod_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendarAuthenticator_credentialID_unique` ON `calendarAuthenticator` (`credentialID`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendarLinkedAccount_linkCode_unique` ON `calendarLinkedAccount` (`linkCode`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendarUser_email_unique` ON `calendarUser` (`email`);