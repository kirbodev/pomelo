import { sql } from "drizzle-orm";
import { integer, primaryKey, text } from "drizzle-orm/sqlite-core";
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
})

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
  })
)

export const sessions = sqliteTable("calendarSession", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
})

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
  })
)

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
  })
)

export const linkedAccounts = sqliteTable("calendarLinkedAccount", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull(),
  linkCode: text("linkCode").notNull().unique(),
}
)

export const afkCalendars = sqliteTable("afkCalendar", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull(),
  calendarId: text("calendarId").notNull(),
  calendars: text("calendars").notNull(),
})

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type VerificationToken = typeof verificationTokens.$inferSelect;
export type Authenticator = typeof authenticators.$inferSelect;
export type LinkedAccount = typeof linkedAccounts.$inferSelect;
export type LinkedAccountInsert = typeof linkedAccounts.$inferInsert;
export type AfkCalendar = typeof afkCalendars.$inferSelect;
export type AfkCalendarInsert = typeof afkCalendars.$inferInsert;
//!SECTION