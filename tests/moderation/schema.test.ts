import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsPath = join(import.meta.dir, "../../src/db/migrations");

async function createMigratedDatabase() {
  const client = createClient({ url: "file::memory:" });
  await client.execute("PRAGMA foreign_keys = ON");

  for (const filename of readdirSync(migrationsPath).filter((name) => name.endsWith(".sql")).sort()) {
    const migration = readFileSync(join(migrationsPath, filename), "utf8");

    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement);
    }
  }

  return client;
}

async function insertCase(client: ReturnType<typeof createClient>, guildId: string, caseNumber: number, operationKey: string) {
  return client.execute({
    sql: `INSERT INTO mod_cases (guild_id, case_number, operation_key, user_id, moderator_id, action_type)
          VALUES (?, ?, ?, 'user', 'moderator', 'warn')`,
    args: [guildId, caseNumber, operationKey],
  });
}

test("each guild can allocate public case number 1", async () => {
  const client = await createMigratedDatabase();

  await client.execute("INSERT INTO case_counters (guild_id, next_case_number) VALUES ('alpha', 2), ('beta', 2)");
  await insertCase(client, "alpha", 1, "alpha:1");
  await insertCase(client, "beta", 1, "beta:1");

  const result = await client.execute("SELECT guild_id, case_number FROM mod_cases ORDER BY guild_id");
  expect(result.rows.map((row) => ({ guild_id: row["guild_id"], case_number: row["case_number"] }))).toEqual([
    { guild_id: "alpha", case_number: 1 },
    { guild_id: "beta", case_number: 1 },
  ]);
});

test("public case numbers are unique within a guild", async () => {
  const client = await createMigratedDatabase();
  await insertCase(client, "alpha", 1, "alpha:1");

  await expect(insertCase(client, "alpha", 1, "alpha:2")).rejects.toThrow();
});

test("warning units cannot point at a case from another guild", async () => {
  const client = await createMigratedDatabase();
  const caseResult = await insertCase(client, "alpha", 1, "alpha:1");
  const caseId = caseResult.lastInsertRowid;

  if (caseId === undefined) throw new Error("Expected a case ID");

  await expect(
    client.execute({
      sql: "INSERT INTO warns (case_id, guild_id, user_id, moderator_id, warn_count) VALUES (?, 'beta', 'user', 'moderator', 1)",
      args: [caseId],
    })
  ).rejects.toThrow();
});
