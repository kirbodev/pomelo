import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as schema from "../../src/db/schema.js";
import {
  ModActionService,
  type PunishmentCapabilityAdapter,
} from "../../src/lib/moderation/actions.js";

const migrationsPath = join(import.meta.dir, "../../src/db/migrations");
const now = 1_700_000_000_000;
const temporaryClients: Array<ReturnType<typeof createClient>> = [];

afterEach(() => {
  for (const client of temporaryClients.splice(0)) client.close();
});

function capabilities(
  overrides: Partial<Awaited<ReturnType<PunishmentCapabilityAdapter["resolve"]>>> = {},
): PunishmentCapabilityAdapter {
  return {
    resolve: async () => ({
      actorId: "moderator",
      targetId: "member",
      actorPosition: 10,
      targetPosition: 1,
      botPosition: 20,
      actorPermissions: new Set(["ban", "kick", "mute", "role"]),
      botPermissions: new Set(["ban", "kick", "mute", "role"]),
      ...overrides,
    }),
    apply: async () => ({ success: true }),
    scheduleAutoUnban: async () => undefined,
    unban: async () => ({ success: true }),
  };
}

async function createExecution(adapter = capabilities()) {
  const directory = mkdtempSync(join(tmpdir(), "pomelo-punishment-execution-"));
  const client = createClient({
    url: pathToFileURL(join(directory, "execution.db")).toString(),
  });
  temporaryClients.push(client);
  await client.execute("PRAGMA foreign_keys = ON");
  for (const filename of readdirSync(migrationsPath)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(join(migrationsPath, filename), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await client.execute(statement);
    }
  }
  const database = drizzle(client, { schema });
  const service = new ModActionService(database, () => now, adapter);
  await client.execute({
    sql: "INSERT INTO warn_settings (guild_id, default_expiry_days, actions) VALUES ('guild', 0, ?)",
    args: [JSON.stringify([{ warnCount: 1, punishments: [{ type: "ban" }], autoConfirm: true }])],
  });
  const warning = await service.createWarn({
    guildId: "guild",
    actorId: "moderator",
    targetId: "member",
    amount: 1,
    operationKey: "warn:seed",
  });
  const batch = warning.batches[0];
  if (!batch) throw new Error("Expected punishment batch");
  const [item] = await database.select().from(schema.warnPunishmentItems);
  if (!item) throw new Error("Expected punishment item");
  return {
    client,
    database,
    databaseUrl: pathToFileURL(join(directory, "execution.db")).toString(),
    service,
    batch,
    item,
  };
}

test("safe default leaves auto-confirmed punishment pending", async () => {
  const { client, service, batch } = await createExecution();

  const results = await service.applyEligibleItems({
    guildId: "guild",
    batchId: batch.id,
    actorId: "moderator",
    automatic: true,
  });
  const state = await client.execute("SELECT state FROM warn_punishment_items");

  expect(results).toEqual([]);
  expect(state.rows[0]?.state).toBe("pending");
});

test("automatic execution carries the configured permission bypass into each item", async () => {
  const applied: string[] = [];
  const adapter = capabilities({ actorPermissions: new Set() });
  adapter.apply = async (item) => {
    applied.push(item.punishmentType);
    return { success: true };
  };
  const { database, service, batch } = await createExecution(adapter);
  await database
    .update(schema.warnSettings)
    .set({ autoApplyWarnPunishments: true, dangerouslyBypassWarnPermissions: true })
    .where(eq(schema.warnSettings.guildId, "guild"));

  const results = await service.applyEligibleItems({
    guildId: "guild",
    batchId: batch.id,
    actorId: "moderator",
    automatic: true,
  });

  expect(applied).toEqual(["ban"]);
  expect(results.map((result) => result.state)).toEqual(["applied"]);
});

test("manual execution applies only items the moderator can perform", async () => {
  const applied: string[] = [];
  const adapter = capabilities({ actorPermissions: new Set(["ban"]) });
  adapter.apply = async (item) => {
    applied.push(item.punishmentType);
    return { success: true };
  };
  const { client, database, service, batch } = await createExecution(adapter);
  await database.insert(schema.warnPunishmentItems).values({
    guildId: "guild",
    batchId: batch.id,
    ordinal: 2,
    punishmentType: "role",
    roleId: "role",
    createdAt: now,
    updatedAt: now,
  });

  const results = await service.applyEligibleItems({
    guildId: "guild",
    batchId: batch.id,
    actorId: "moderator",
    automatic: false,
  });
  const states = await client.execute(
    "SELECT punishment_type, state FROM warn_punishment_items ORDER BY ordinal",
  );

  expect(applied).toEqual(["ban"]);
  expect(results.map((result) => result.state)).toEqual(["applied", "pending"]);
  expect(states.rows).toEqual([
    { punishment_type: "ban", state: "applied" },
    { punishment_type: "role", state: "pending" },
  ]);
});

test("only one concurrent claimant can mutate a punishment", async () => {
  let calls = 0;
  const adapter = capabilities();
  adapter.apply = async () => {
    calls++;
    return { success: true };
  };
  const { service, item } = await createExecution(adapter);

  const [first, second] = await Promise.all([
    service.applyPunishmentItem({ guildId: "guild", itemId: item.id, actorId: "moderator" }),
    service.applyPunishmentItem({ guildId: "guild", itemId: item.id, actorId: "moderator" }),
  ]);

  expect(calls).toBe(1);
  expect(first.state).toBe("applied");
  expect(second.state).toBe("applied");
});

test("distinct services return the current state when a conditional item claim loses", async () => {
  let calls = 0;
  const adapter = capabilities();
  adapter.apply = async () => {
    calls++;
    return { success: true };
  };
  const { databaseUrl, item } = await createExecution(adapter);
  const firstClient = createClient({ url: databaseUrl });
  const secondClient = createClient({ url: databaseUrl });
  temporaryClients.push(firstClient, secondClient);
  const first = new ModActionService(drizzle(firstClient, { schema }), () => now, adapter);
  const second = new ModActionService(drizzle(secondClient, { schema }), () => now, adapter);

  const results = await Promise.all([
    first.applyPunishmentItem({ guildId: "guild", itemId: item.id, actorId: "moderator" }),
    second.applyPunishmentItem({ guildId: "guild", itemId: item.id, actorId: "moderator" }),
  ]);

  expect(calls).toBe(1);
  expect(results.map((result) => result.state)).toContain("applied");
  expect(results.every((result) => ["applied", "executing"].includes(result.state))).toBe(true);
});

test("a false adapter result is never recorded as applied", async () => {
  const adapter = capabilities();
  adapter.apply = async () => ({ success: false, failureCode: "discordRejected" });
  const { client, service, item } = await createExecution(adapter);

  const result = await service.applyPunishmentItem({
    guildId: "guild",
    itemId: item.id,
    actorId: "moderator",
  });
  const stored = await client.execute("SELECT state FROM warn_punishment_items");

  expect(result.state).not.toBe("applied");
  expect(stored.rows[0]?.state).toBe("manual_review");
});

test("a ban suppresses a later legacy kick in the same batch", async () => {
  const applied: string[] = [];
  const adapter = capabilities();
  adapter.apply = async (item) => {
    applied.push(item.punishmentType);
    return { success: true };
  };
  const { database, service, batch } = await createExecution(adapter);
  await database.insert(schema.warnPunishmentItems).values({
    guildId: "guild",
    batchId: batch.id,
    ordinal: 2,
    punishmentType: "kick",
    createdAt: now,
    updatedAt: now,
  });

  await service.applyEligibleItems({ guildId: "guild", batchId: batch.id, actorId: "moderator", automatic: false });

  expect(applied).toEqual(["ban"]);
});

test("a direct kick is superseded while its batch ban is still pending", async () => {
  const applied: string[] = [];
  const adapter = capabilities();
  adapter.apply = async (item) => {
    applied.push(item.punishmentType);
    return { success: true };
  };
  const { database, service, batch } = await createExecution(adapter);
  const [kick] = await database
    .insert(schema.warnPunishmentItems)
    .values({
      guildId: "guild",
      batchId: batch.id,
      ordinal: 2,
      punishmentType: "kick",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!kick) throw new Error("Expected kick item");

  const result = await service.applyPunishmentItem({
    guildId: "guild",
    itemId: kick.id,
    actorId: "moderator",
  });

  expect(result.state).toBe("superseded");
  expect(applied).toEqual([]);
});

test("a mismatched temporary-ban token never unbans", async () => {
  let unbans = 0;
  const adapter = capabilities();
  adapter.unban = async () => {
    unbans++;
    return { success: true };
  };
  const { client, service } = await createExecution(adapter);
  await client.execute(
    "INSERT INTO mod_cases (guild_id, case_number, operation_key, user_id, moderator_id, action_type) VALUES ('guild', 2, 'ban:case', 'member', 'moderator', 'ban')",
  );
  await client.execute(
    "INSERT INTO temporary_ban_tokens (guild_id, case_id, token, expires_at) VALUES ('guild', 2, 'correct-token', ?)",
    [now + 60_000],
  );

  const result = await service.runAutoUnban({
    guildId: "guild",
    userId: "member",
    internalCaseId: 2,
    token: "wrong-token",
  });

  expect(result).toBe(false);
  expect(unbans).toBe(0);
});

test("auto-unban requires the stored case user and atomically claims the token", async () => {
  let unbans = 0;
  const adapter = capabilities();
  adapter.unban = async () => {
    unbans++;
    return { success: true };
  };
  const { client, databaseUrl, service } = await createExecution(adapter);
  await client.execute(
    "INSERT INTO mod_cases (guild_id, case_number, operation_key, user_id, moderator_id, action_type) VALUES ('guild', 2, 'ban:case', 'member', 'moderator', 'ban')",
  );
  await client.execute(
    "INSERT INTO temporary_ban_tokens (guild_id, case_id, token, expires_at) VALUES ('guild', 2, 'token', ?)",
    [now],
  );

  const wrongUser = await service.runAutoUnban({
    guildId: "guild",
    userId: "other-member",
    internalCaseId: 2,
    token: "token",
  });
  const firstClient = createClient({ url: databaseUrl });
  const secondClient = createClient({ url: databaseUrl });
  temporaryClients.push(firstClient, secondClient);
  const firstService = new ModActionService(drizzle(firstClient, { schema }), () => now, adapter);
  const secondService = new ModActionService(drizzle(secondClient, { schema }), () => now, adapter);
  const [first, second] = await Promise.all([
    firstService.runAutoUnban({ guildId: "guild", userId: "member", internalCaseId: 2, token: "token" }),
    secondService.runAutoUnban({ guildId: "guild", userId: "member", internalCaseId: 2, token: "token" }),
  ]);

  expect(wrongUser).toBe(false);
  expect([first, second].filter(Boolean)).toHaveLength(1);
  expect(unbans).toBe(1);
});

test("a retryable auto-unban failure releases its token for the retry", async () => {
  let attempts = 0;
  const adapter = capabilities();
  adapter.unban = async () => {
    attempts++;
    return attempts === 1
      ? { success: false, retryable: true, failureCode: "temporaryDiscordFailure" }
      : { success: true };
  };
  const { client, service } = await createExecution(adapter);
  await client.execute(
    "INSERT INTO mod_cases (guild_id, case_number, operation_key, user_id, moderator_id, action_type) VALUES ('guild', 2, 'ban:case', 'member', 'moderator', 'ban')",
  );
  await client.execute(
    "INSERT INTO temporary_ban_tokens (guild_id, case_id, token, expires_at) VALUES ('guild', 2, 'token', ?)",
    [now],
  );

  await expect(
    service.runAutoUnban({ guildId: "guild", userId: "member", internalCaseId: 2, token: "token" }),
  ).rejects.toThrow("temporaryDiscordFailure");
  const retry = await service.runAutoUnban({
    guildId: "guild",
    userId: "member",
    internalCaseId: 2,
    token: "token",
  });

  expect(retry).toBe(true);
  expect(attempts).toBe(2);
});

test("a stale dismiss revision returns false without adding a note", async () => {
  const { client, service, batch } = await createExecution();

  const result = await service.dismissBatch({
    guildId: "guild",
    batchId: batch.id,
    actorId: "moderator",
    expectedRevision: batch.revision + 1,
  });
  const notes = await client.execute("SELECT COUNT(*) AS count FROM case_notes");

  expect(result).toBe(false);
  expect(notes.rows[0]?.count).toBe(0);
});
