import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as schema from "../../src/db/schema.js";
import {
  ModActionService,
  type PunishmentCapabilityAdapter,
} from "../../src/lib/moderation/actions.js";
import {
  computePunishmentRoleExpiry,
  getPersistedPunishmentRoles,
  recordPunishmentRole,
  releasePunishmentRoles,
  releaseUnjustifiedPunishmentRoles,
  sweepExpiredPunishmentRoles,
} from "../../src/lib/moderation/punishmentRoles.js";

const migrationsPath = join(import.meta.dir, "../../src/db/migrations");
const now = 1_700_000_000_000;
const day = 86_400_000;
const temporaryClients: Array<ReturnType<typeof createClient>> = [];

afterEach(() => {
  for (const client of temporaryClients.splice(0)) client.close();
});

async function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "pomelo-punishment-roles-"));
  const client = createClient({
    url: pathToFileURL(join(directory, "roles.db")).toString(),
  });
  temporaryClients.push(client);
  await client.execute("PRAGMA foreign_keys = ON");
  for (const filename of readdirSync(migrationsPath)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(
      join(migrationsPath, filename),
      "utf8",
    ).split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement);
    }
  }
  return { client, database: drizzle(client, { schema }) };
}

async function seedCase(database: Awaited<ReturnType<typeof createDatabase>>["database"]) {
  const [caseEntry] = await database
    .insert(schema.modCases)
    .values({
      guildId: "guild",
      caseNumber: 1,
      operationKey: "case:seed",
      userId: "member",
      moderatorId: "moderator",
      actionType: "warn",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return caseEntry;
}

async function seedWarns(
  database: Awaited<ReturnType<typeof createDatabase>>["database"],
  caseId: number,
  expiries: Array<number | null>,
) {
  for (const [index, expiresAt] of expiries.entries()) {
    await database.insert(schema.warns).values({
      caseId,
      guildId: "guild",
      userId: "member",
      moderatorId: "moderator",
      warnCount: index + 1,
      expiresAt,
      createdAt: now,
    });
  }
}

test("computePunishmentRoleExpiry picks the warn whose expiry drops the count below the level", () => {
  expect(computePunishmentRoleExpiry([], 1)).toBeNull();
  expect(computePunishmentRoleExpiry([100, 300, 200], 3)).toBe(100);
  expect(computePunishmentRoleExpiry([100, 300, 200], 1)).toBe(300);
  expect(computePunishmentRoleExpiry([100, null, 200], 1)).toBeNull();
  // Count already below the level: clamp to the earliest expiry.
  expect(computePunishmentRoleExpiry([100, 200], 5)).toBe(100);
});

test("recordPunishmentRole stores the assignment with a warn-derived expiry", async () => {
  const { database } = await createDatabase();
  const caseEntry = await seedCase(database);
  await seedWarns(database, caseEntry.id, [now + day, now + 2 * day, now + 3 * day]);

  await recordPunishmentRole(
    {
      guildId: "guild",
      userId: "member",
      roleId: "role-1",
      warnLevel: 3,
      caseId: caseEntry.id,
    },
    database,
    now,
  );

  const [record] = await database
    .select()
    .from(schema.punishmentRoles)
    .where(eq(schema.punishmentRoles.roleId, "role-1"))
    .limit(1);
  expect(record.warnLevel).toBe(3);
  expect(record.caseId).toBe(caseEntry.id);
  expect(record.expiresAt).toBe(now + day);
  expect(record.removed).toBe(false);
});

test("recordPunishmentRole merges duplicate roles onto the lowest justifying level", async () => {
  const { database } = await createDatabase();
  const caseEntry = await seedCase(database);
  await seedWarns(database, caseEntry.id, [now + day, now + 2 * day, now + 3 * day]);

  await recordPunishmentRole(
    { guildId: "guild", userId: "member", roleId: "role-1", warnLevel: 3 },
    database,
    now,
  );
  await recordPunishmentRole(
    { guildId: "guild", userId: "member", roleId: "role-1", warnLevel: 2 },
    database,
    now,
  );

  const records = await database
    .select()
    .from(schema.punishmentRoles)
    .where(eq(schema.punishmentRoles.roleId, "role-1"))
    .limit(5);
  expect(records).toHaveLength(1);
  expect(records[0].warnLevel).toBe(2);
  // Level 2 stops being met once two of the three warns expired.
  expect(records[0].expiresAt).toBe(now + 2 * day);
});

test("recordPunishmentRole reactivates a previously released record", async () => {
  const { database } = await createDatabase();
  const caseEntry = await seedCase(database);
  await seedWarns(database, caseEntry.id, [now + day]);

  await recordPunishmentRole(
    { guildId: "guild", userId: "member", roleId: "role-1", warnLevel: 1 },
    database,
    now,
  );
  await releasePunishmentRoles(
    { guildId: "guild", userId: "member", roleIds: ["role-1"], removedBy: "manual" },
    database,
    now,
  );
  await recordPunishmentRole(
    { guildId: "guild", userId: "member", roleId: "role-1", warnLevel: 1 },
    database,
    now,
  );

  const active = await getPersistedPunishmentRoles("guild", "member", database, now);
  expect(active).toHaveLength(1);
  expect(active[0].removed).toBe(false);
  expect(active[0].removedBy).toBeNull();
});

test("getPersistedPunishmentRoles skips released and expired records", async () => {
  const { database } = await createDatabase();
  await database.insert(schema.punishmentRoles).values([
    { guildId: "guild", userId: "member", roleId: "active", warnLevel: 1, expiresAt: now + day, createdAt: now, updatedAt: now },
    { guildId: "guild", userId: "member", roleId: "forever", warnLevel: 1, expiresAt: null, createdAt: now, updatedAt: now },
    { guildId: "guild", userId: "member", roleId: "expired", warnLevel: 1, expiresAt: now - 1, createdAt: now, updatedAt: now },
    { guildId: "guild", userId: "member", roleId: "released", warnLevel: 1, expiresAt: null, removed: true, createdAt: now, updatedAt: now },
  ]);

  const active = await getPersistedPunishmentRoles("guild", "member", database, now);
  expect(active.map((record) => record.roleId).sort()).toEqual(["active", "forever"]);
});

test("releaseUnjustifiedPunishmentRoles only releases levels above the active warn count", async () => {
  const { database } = await createDatabase();
  const caseEntry = await seedCase(database);
  await seedWarns(database, caseEntry.id, [now + day, now + 2 * day]);
  await database.insert(schema.punishmentRoles).values([
    { guildId: "guild", userId: "member", roleId: "low", warnLevel: 2, createdAt: now, updatedAt: now },
    { guildId: "guild", userId: "member", roleId: "high", warnLevel: 3, createdAt: now, updatedAt: now },
  ]);

  const released = await releaseUnjustifiedPunishmentRoles(
    { guildId: "guild", userId: "member", removedBy: "moderator" },
    database,
    now,
  );
  expect(released.map((record) => record.roleId)).toEqual(["high"]);

  const active = await getPersistedPunishmentRoles("guild", "member", database, now);
  expect(active.map((record) => record.roleId)).toEqual(["low"]);
  const [releasedRecord] = await database
    .select()
    .from(schema.punishmentRoles)
    .where(eq(schema.punishmentRoles.roleId, "high"))
    .limit(1);
  expect(releasedRecord.removedBy).toBe("moderator");
});

test("sweepExpiredPunishmentRoles refreshes still-justified records instead of releasing them", async () => {
  const { database } = await createDatabase();
  const caseEntry = await seedCase(database);
  // Two warns still active — a level-2 record whose stored expiry is stale.
  await seedWarns(database, caseEntry.id, [now + day, now + 2 * day]);
  await database.insert(schema.punishmentRoles).values({
    guildId: "guild",
    userId: "member",
    roleId: "role-1",
    warnLevel: 2,
    expiresAt: now - 1,
    createdAt: now,
    updatedAt: now,
  });

  await sweepExpiredPunishmentRoles(database, now, () => Promise.resolve(true));

  const [record] = await database
    .select()
    .from(schema.punishmentRoles)
    .where(eq(schema.punishmentRoles.roleId, "role-1"))
    .limit(1);
  expect(record.removed).toBe(false);
  expect(record.expiresAt).toBe(now + day);
});

test("sweepExpiredPunishmentRoles releases unjustified records and retries unconfirmed removals", async () => {
  const { database } = await createDatabase();
  await database.insert(schema.punishmentRoles).values([
    { guildId: "guild", userId: "member", roleId: "gone", warnLevel: 1, expiresAt: now - 1, createdAt: now, updatedAt: now },
    { guildId: "guild", userId: "member", roleId: "stuck", warnLevel: 1, expiresAt: now - 1, createdAt: now, updatedAt: now },
  ]);

  await sweepExpiredPunishmentRoles(database, now, (_guildId, _userId, roleIds) =>
    Promise.resolve(roleIds.includes("gone")),
  );

  const [removedRecord] = await database
    .select()
    .from(schema.punishmentRoles)
    .where(eq(schema.punishmentRoles.roleId, "gone"))
    .limit(1);
  expect(removedRecord.removed).toBe(true);
  expect(removedRecord.removedBy).toBe("system");

  // Discord removal wasn't confirmed — record goes back for the next sweep.
  const [retryRecord] = await database
    .select()
    .from(schema.punishmentRoles)
    .where(eq(schema.punishmentRoles.roleId, "stuck"))
    .limit(1);
  expect(retryRecord.removed).toBe(false);
});

function roleCapabilities(): PunishmentCapabilityAdapter {
  return {
    resolve: () =>
      Promise.resolve({
        actorId: "moderator",
        targetId: "member",
        actorPosition: 10,
        targetPosition: 1,
        botPosition: 20,
        actorPermissions: new Set(["ban", "kick", "mute", "role"] as const),
        botPermissions: new Set(["ban", "kick", "mute", "role"] as const),
        rolePosition: 5,
      }),
    apply: () => Promise.resolve({ success: true }),
    scheduleAutoUnban: () => Promise.resolve(undefined),
    unban: () => Promise.resolve({ success: true }),
  };
}

test("applied role punishments are persisted and released again on warn revocation", async () => {
  const { client, database } = await createDatabase();
  const service = new ModActionService(database, () => now, roleCapabilities());
  await client.execute({
    sql: "INSERT INTO warn_settings (guild_id, default_expiry_days, auto_apply_warn_punishments, actions) VALUES ('guild', 3, 1, ?)",
    args: [
      JSON.stringify([
        {
          warnCount: 1,
          punishments: [{ type: "role", roleId: "role-1" }],
          autoConfirm: true,
        },
      ]),
    ],
  });

  const warning = await service.createWarn({
    guildId: "guild",
    actorId: "moderator",
    targetId: "member",
    amount: 1,
    operationKey: "warn:role",
  });
  const batch = warning.batches.at(0);
  if (!batch) throw new Error("Expected punishment batch");

  await service.applyEligibleItems({
    guildId: "guild",
    batchId: batch.id,
    actorId: "moderator",
    automatic: true,
  });

  const persisted = await getPersistedPunishmentRoles("guild", "member", database, now);
  expect(persisted).toHaveLength(1);
  expect(persisted[0].roleId).toBe("role-1");
  expect(persisted[0].warnLevel).toBe(1);
  expect(persisted[0].caseId).toBe(warning.case?.id ?? null);

  if (!warning.case) throw new Error("Expected warn case");
  await service.revokeWarn({
    guildId: "guild",
    actorId: "moderator",
    targetId: "member",
    operationKey: "unwarn:role",
    sourceCaseId: warning.case.id,
  });

  const remaining = await getPersistedPunishmentRoles("guild", "member", database, now);
  expect(remaining).toHaveLength(0);
  const [record] = await database
    .select()
    .from(schema.punishmentRoles)
    .where(
      and(
        eq(schema.punishmentRoles.guildId, "guild"),
        eq(schema.punishmentRoles.roleId, "role-1"),
      ),
    )
    .limit(1);
  expect(record.removed).toBe(true);
  expect(record.removedBy).toBe("moderator");
});
