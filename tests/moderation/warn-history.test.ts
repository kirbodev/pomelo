import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as schema from "../../src/db/schema.js";
import { ModActionService } from "../../src/lib/moderation/actions.js";

const migrationsPath = join(import.meta.dir, "../../src/db/migrations");
const now = 1_700_000_000_000;
const temporaryClients: Array<ReturnType<typeof createClient>> = [];

afterEach(() => {
  for (const client of temporaryClients.splice(0)) {
    client.close();
  }
});

async function createLedger() {
  const directory = mkdtempSync(join(tmpdir(), "pomelo-warn-history-"));
  const client = createClient({
    url: pathToFileURL(join(directory, "ledger.db")).toString(),
  });
  temporaryClients.push(client);
  await client.execute("PRAGMA foreign_keys = ON");

  for (const filename of readdirSync(migrationsPath)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = readFileSync(join(migrationsPath, filename), "utf8");

    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement);
    }
  }

  return {
    client,
    service: new ModActionService(drizzle(client, { schema }), () => now),
  };
}

async function insertCase(
  client: ReturnType<typeof createClient>,
  id: number,
  reason: string,
  caseNumber: number,
) {
  await client.execute({
    sql: "INSERT INTO mod_cases (id, guild_id, case_number, operation_key, user_id, moderator_id, action_type, reason, dm_sent, created_at, updated_at) VALUES (?, 'guild', ?, ?, 'member', 'moderator', 'warn', ?, 0, 1700000000000, 1700000000000)",
    args: [id, caseNumber, `key-${id}`, reason],
  });
}

async function insertWarn(
  client: ReturnType<typeof createClient>,
  id: number,
  caseId: number,
  expiresAt: number | null,
  revoked: boolean,
  createdAt: number,
) {
  await client.execute({
    sql: "INSERT INTO warns (id, case_id, guild_id, user_id, moderator_id, warn_count, expires_at, revoked, created_at) VALUES (?, ?, 'guild', 'member', 'moderator', 1, ?, ?, ?)",
    args: [
      id,
      caseId,
      expiresAt,
      revoked ? 1 : 0,
      createdAt,
    ],
  });
}

test("getWarnHistory counts active, expired and total and returns recent active warns", async () => {
  const { client, service } = await createLedger();

  await insertCase(client, 1, "spam", 1);
  await insertCase(client, 2, "nsfw", 2);
  await insertCase(client, 3, "raiding", 3);
  await insertWarn(client, 1, 1, now + 86_400_000, false, now - 10_000);
  await insertWarn(client, 2, 2, null, false, now - 5_000);
  await insertWarn(client, 3, 3, now - 1_000, false, now - 2_000);

  const history = await service.getWarnHistory("guild", "member");

  expect(history.active).toBe(2);
  expect(history.expired).toBe(1);
  expect(history.total).toBe(3);
  expect(history.recent).toHaveLength(2);
  expect(history.recent[0].reason).toBe("nsfw");
  expect(history.recent[0].expiresAt).toBeNull();
  expect(history.recent[1].reason).toBe("spam");
});

test("getWarnHistory excludes revoked warns from active and recent, keeps them in total", async () => {
  const { client, service } = await createLedger();

  await insertCase(client, 1, "spam", 1);
  await insertCase(client, 2, "nsfw", 2);
  await insertWarn(client, 1, 1, null, true, now - 10_000);
  await insertWarn(client, 2, 2, null, false, now - 5_000);

  const history = await service.getWarnHistory("guild", "member");

  expect(history.active).toBe(1);
  expect(history.expired).toBe(0);
  expect(history.total).toBe(2);
  expect(history.recent).toHaveLength(1);
  expect(history.recent[0].id).toBe(2);
});
