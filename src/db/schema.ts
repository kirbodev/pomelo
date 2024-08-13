import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";
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
