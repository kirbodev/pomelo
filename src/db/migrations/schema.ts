import { sqliteTable, AnySQLiteColumn, text, integer, foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const devs = sqliteTable("devs", {
	user_id: text("user_id").primaryKey().notNull(),
	secret: text("secret").notNull(),
	last_verified: integer("last_verified").default(sql`(CURRENT_TIMESTAMP)`),
	timestamp: integer("timestamp").default(sql`(CURRENT_TIMESTAMP)`),
});

export const calendarAccount = sqliteTable("calendarAccount", {
	userId: text("userId").notNull().references(() => calendarUser.id, { onDelete: "cascade" } ),
	type: text("type").notNull(),
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
(table) => {
	return {
		pk0: primaryKey({ columns: [table.provider, table.providerAccountId], name: "calendarAccount_provider_providerAccountId_pk"})
	}
});

export const calendarAuthenticator = sqliteTable("calendarAuthenticator", {
	credentialID: text("credentialID").notNull(),
	userId: text("userId").notNull().references(() => calendarUser.id, { onDelete: "cascade" } ),
	providerAccountId: text("providerAccountId").notNull(),
	credentialPublicKey: text("credentialPublicKey").notNull(),
	counter: integer("counter").notNull(),
	credentialDeviceType: text("credentialDeviceType").notNull(),
	credentialBackedUp: integer("credentialBackedUp").notNull(),
	transports: text("transports"),
},
(table) => {
	return {
		credentialID_unique: uniqueIndex("calendarAuthenticator_credentialID_unique").on(table.credentialID),
		pk0: primaryKey({ columns: [table.credentialID, table.userId], name: "calendarAuthenticator_credentialID_userId_pk"})
	}
});

export const calendarSession = sqliteTable("calendarSession", {
	sessionToken: text("sessionToken").primaryKey().notNull(),
	userId: text("userId").notNull().references(() => calendarUser.id, { onDelete: "cascade" } ),
	expires: integer("expires").notNull(),
});

export const calendarUser = sqliteTable("calendarUser", {
	id: text("id").primaryKey().notNull(),
	name: text("name"),
	email: text("email"),
	emailVerified: integer("emailVerified"),
	image: text("image"),
},
(table) => {
	return {
		email_unique: uniqueIndex("calendarUser_email_unique").on(table.email),
	}
});

export const calendarVerificationToken = sqliteTable("calendarVerificationToken", {
	identifier: text("identifier").notNull(),
	token: text("token").notNull(),
	expires: integer("expires").notNull(),
},
(table) => {
	return {
		pk0: primaryKey({ columns: [table.identifier, table.token], name: "calendarVerificationToken_identifier_token_pk"})
	}
});

export const calendarLinkedAccount = sqliteTable("calendarLinkedAccount", {
	id: text("id").primaryKey().notNull(),
	userId: text("userId").notNull(),
	linkCode: text("linkCode").notNull(),
},
(table) => {
	return {
		linkCode_unique: uniqueIndex("calendarLinkedAccount_linkCode_unique").on(table.linkCode),
	}
});

export const afkCalendar = sqliteTable("afkCalendar", {
	id: text("id").primaryKey().notNull(),
	userId: text("userId").notNull(),
	calendarId: text("calendarId").notNull(),
	calendars: text("calendars").notNull(),
});

export const case_notes = sqliteTable("case_notes", {
	id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
	case_id: integer("case_id").notNull().references(() => mod_cases.id),
	moderator_id: text("moderator_id").notNull(),
	note: text("note").notNull(),
	created_at: integer("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const mod_cases = sqliteTable("mod_cases", {
	id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
	guild_id: text("guild_id").notNull(),
	user_id: text("user_id").notNull(),
	moderator_id: text("moderator_id").notNull(),
	action_type: text("action_type").notNull(),
	reason: text("reason").default("").notNull(),
	duration: integer("duration"),
	dm_sent: integer("dm_sent").default(false).notNull(),
	created_at: integer("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updated_at: integer("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const warn_settings = sqliteTable("warn_settings", {
	guild_id: text("guild_id").primaryKey().notNull(),
	max_warns: integer("max_warns").default(10).notNull(),
	default_expiry_days: integer("default_expiry_days").default(3).notNull(),
	dm_on_warn: integer("dm_on_warn").default(true).notNull(),
	log_channel_id: text("log_channel_id"),
	actions: text("actions").default("[]").notNull(),
	role_apply: text("role_apply"),
});

export const warns = sqliteTable("warns", {
	id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
	case_id: integer("case_id").notNull().references(() => mod_cases.id),
	guild_id: text("guild_id").notNull(),
	user_id: text("user_id").notNull(),
	moderator_id: text("moderator_id").notNull(),
	warn_count: integer("warn_count").notNull(),
	expires_at: integer("expires_at"),
	revoked: integer("revoked").default(false).notNull(),
	revoked_by: text("revoked_by"),
	revoked_at: integer("revoked_at"),
});

export const syncedEvents = sqliteTable("syncedEvents", {
	id: text("id").primaryKey().notNull(),
	userId: text("userId").notNull(),
	eventId: text("eventId").notNull(),
	taskId: text("taskId"),
	startTime: integer("startTime").notNull(),
	endTime: integer("endTime").notNull(),
	afkActive: integer("afkActive").default(false).notNull(),
	lastModified: integer("lastModified"),
	createdAt: integer("createdAt").default(sql`(CURRENT_TIMESTAMP)`),
});