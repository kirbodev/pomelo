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
  const directory = mkdtempSync(join(tmpdir(), "pomelo-warn-ledger-"));
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
    databaseUrl: pathToFileURL(join(directory, "ledger.db")).toString(),
    service: new ModActionService(drizzle(client, { schema }), () => now),
  };
}

async function insertSettings(
  client: ReturnType<typeof createClient>,
  actions = "[]",
) {
  await client.execute({
    sql: "INSERT INTO warn_settings (guild_id, default_expiry_days, actions) VALUES ('guild', 0, ?)",
    args: [actions],
  });
}

const baseInput = {
  guildId: "guild",
  actorId: "moderator",
  targetId: "member",
  reason: "reason",
};

test("missing warn settings reject without writing a case or warning unit", async () => {
  const { client, service } = await createLedger();

  await expect(
    service.createWarn({ ...baseInput, amount: 1, operationKey: "warn:missing" }),
  ).rejects.toThrow("warnSettingsNotConfigured");

  const cases = await client.execute("SELECT COUNT(*) AS count FROM mod_cases");
  const warningUnits = await client.execute("SELECT COUNT(*) AS count FROM warns");

  expect(cases.rows[0]?.count).toBe(0);
  expect(warningUnits.rows[0]?.count).toBe(0);
});

test("adding warnings from three to five adds two units and snapshots crossed punishments", async () => {
  const { client, service } = await createLedger();
  await insertSettings(
    client,
    JSON.stringify([
      {
        warnCount: 4,
        punishments: [{ type: "mute", duration: 60_000 }],
        autoConfirm: false,
      },
    ]),
  );

  await service.createWarn({ ...baseInput, amount: 3, operationKey: "warn:three" });
  const result = await service.createWarn({
    ...baseInput,
    amount: 2,
    operationKey: "warn:five",
  });

  const warningUnits = await client.execute(
    "SELECT warn_count FROM warns WHERE guild_id = 'guild' AND user_id = 'member' ORDER BY warn_count",
  );
  const items = await client.execute(
    "SELECT punishment_type, duration FROM warn_punishment_items ORDER BY ordinal",
  );

  expect(result.finalWarnCount).toBe(5);
  expect(result.batches).toHaveLength(1);
  expect(result.batches[0]?.threshold).toBe(4);
  expect(warningUnits.rows.map((row) => row.warn_count)).toEqual([1, 2, 3, 4, 5]);
  expect(
    items.rows.map((item) => ({
      punishmentType: String(item.punishment_type),
      duration: Number(item.duration),
    })),
  ).toEqual([{ punishmentType: "mute", duration: 60_000 }]);
});

test("setting a level from five to two revokes the newest three warning units", async () => {
  const { client, service } = await createLedger();
  await insertSettings(client);
  await service.createWarn({ ...baseInput, amount: 5, operationKey: "warn:five" });

  const result = await service.setWarnLevel({
    ...baseInput,
    level: 2,
    operationKey: "level:two",
  });
  const warnings = await client.execute(
    "SELECT warn_count, revoked, revoked_by_case_id FROM warns WHERE guild_id = 'guild' ORDER BY warn_count",
  );
  const revokeCaseId = result.case?.id;
  if (revokeCaseId === undefined) throw new Error("Expected an unwarn case");

  expect(result.finalWarnCount).toBe(2);
  expect(result.case?.actionType).toBe("unwarn");
  expect(
    warnings.rows.map((warning) => ({
      warnCount: Number(warning.warn_count),
      revoked: Number(warning.revoked),
      revokedByCaseId:
        warning.revoked_by_case_id === null
          ? null
          : Number(warning.revoked_by_case_id),
    })),
  ).toEqual([
    { warnCount: 1, revoked: 0, revokedByCaseId: null },
    { warnCount: 2, revoked: 0, revokedByCaseId: null },
    { warnCount: 3, revoked: 1, revokedByCaseId: revokeCaseId },
    { warnCount: 4, revoked: 1, revokedByCaseId: revokeCaseId },
    { warnCount: 5, revoked: 1, revokedByCaseId: revokeCaseId },
  ]);
});

test("setting an unchanged level writes no case", async () => {
  const { client, service } = await createLedger();
  await insertSettings(client);
  await service.createWarn({ ...baseInput, amount: 2, operationKey: "warn:two" });

  const result = await service.setWarnLevel({
    ...baseInput,
    level: 2,
    operationKey: "level:two",
  });
  const cases = await client.execute("SELECT action_type FROM mod_cases ORDER BY id");

  expect(result.case).toBeNull();
  expect(result.finalWarnCount).toBe(2);
  expect(cases.rows.map((caseEntry) => String(caseEntry.action_type))).toEqual([
    "warn",
  ]);
});

test("only upward threshold crossings create punishment batches", async () => {
  const { client, service } = await createLedger();
  await insertSettings(
    client,
    JSON.stringify([
      {
        warnCount: 4,
        punishments: [{ type: "kick" }],
        autoConfirm: false,
      },
    ]),
  );
  await service.createWarn({ ...baseInput, amount: 5, operationKey: "warn:five" });

  const result = await service.setWarnLevel({
    ...baseInput,
    level: 2,
    operationKey: "level:two",
  });
  const batches = await client.execute(
    "SELECT threshold FROM warn_punishment_batches WHERE guild_id = 'guild' ORDER BY id",
  );

  expect(result.batches).toEqual([]);
  expect(batches.rows.map((batch) => Number(batch.threshold))).toEqual([4]);
});

test("retries return the original persisted result even when later warnings and a mismatched target exist", async () => {
  const { client, service } = await createLedger();
  await insertSettings(client);

  const original = await service.createWarn({
    ...baseInput,
    amount: 2,
    operationKey: "warn:original",
  });
  await service.createWarn({
    ...baseInput,
    amount: 3,
    operationKey: "warn:later",
  });
  const retry = await service.createWarn({
    ...baseInput,
    amount: 1,
    operationKey: "warn:original",
    targetId: "different-member",
  });
  const storedCase = await client.execute(
    "SELECT user_id, resulting_warn_count FROM mod_cases WHERE operation_key = 'warn:original'",
  );

  expect(retry.case?.id).toBe(original.case?.id);
  expect(retry.finalWarnCount).toBe(2);
  expect(storedCase.rows as unknown[]).toEqual([
    { user_id: "member", resulting_warn_count: 2 },
  ]);
});

test("punishment batches snapshot the complete validated warn level configuration", async () => {
  const { client, service } = await createLedger();
  const level = {
    warnCount: 1,
    punishments: [
      { type: "ban", duration: 600_000, deleteMessageDays: 86_400 },
    ],
    message: "This warning reaches a ban level.",
    autoConfirm: true,
  };
  await insertSettings(client, JSON.stringify([level]));

  await service.createWarn({ ...baseInput, amount: 1, operationKey: "warn:snapshot" });
  const batch = await client.execute(
    "SELECT config_json FROM warn_punishment_batches WHERE operation_key = 'warn:snapshot:threshold:1'",
  );

  expect(batch.rows).toHaveLength(1);
  expect(JSON.parse(String(batch.rows[0]?.config_json))).toEqual(level);
});

test("simultaneous requests with one operation key create one ledger entry and share its result", async () => {
  const { client, service } = await createLedger();
  await insertSettings(client);

  const [first, second] = await Promise.all([
    service.createWarn({ ...baseInput, amount: 1, operationKey: "warn:parallel" }),
    service.createWarn({ ...baseInput, amount: 1, operationKey: "warn:parallel" }),
  ]);
  const counts = await client.execute(
    "SELECT (SELECT COUNT(*) FROM mod_cases WHERE operation_key = 'warn:parallel') AS cases, (SELECT COUNT(*) FROM warns WHERE guild_id = 'guild') AS warns",
  );

  expect(first.case?.id).toBe(second.case?.id);
  expect(first.finalWarnCount).toBe(1);
  expect(second.finalWarnCount).toBe(1);
  expect(counts.rows as unknown[]).toEqual([{ cases: 1, warns: 1 }]);
});

test("simultaneous same-key level changes create one immutable ledger result", async () => {
  const { client, service } = await createLedger();
  await insertSettings(client);
  await service.createWarn({ ...baseInput, amount: 1, operationKey: "warn:seed" });

  const [first, second] = await Promise.all([
    service.setWarnLevel({ ...baseInput, level: 3, operationKey: "level:parallel" }),
    service.setWarnLevel({ ...baseInput, level: 3, operationKey: "level:parallel" }),
  ]);
  const counts = await client.execute(
    "SELECT (SELECT COUNT(*) FROM mod_cases WHERE operation_key = 'level:parallel') AS cases, (SELECT COUNT(*) FROM warns WHERE guild_id = 'guild' AND revoked = false) AS warns",
  );

  expect(first.case?.id).toBe(second.case?.id);
  expect(first.finalWarnCount).toBe(3);
  expect(second.finalWarnCount).toBe(3);
  expect(counts.rows as unknown[]).toEqual([{ cases: 1, warns: 3 }]);
});

test("simultaneous same-key revocations create one immutable ledger result", async () => {
  const { client, service } = await createLedger();
  await insertSettings(client);
  const source = await service.createWarn({
    ...baseInput,
    amount: 2,
    operationKey: "warn:source",
  });
  const sourceCaseId = source.case?.id;
  if (sourceCaseId === undefined) throw new Error("Expected a source warn case");

  const [first, second] = await Promise.all([
    service.revokeWarn({
      ...baseInput,
      operationKey: "revoke:parallel",
      sourceCaseId,
    }),
    service.revokeWarn({
      ...baseInput,
      operationKey: "revoke:parallel",
      sourceCaseId,
    }),
  ]);
  const counts = await client.execute(
    "SELECT (SELECT COUNT(*) FROM mod_cases WHERE operation_key = 'revoke:parallel') AS cases, (SELECT COUNT(*) FROM warns WHERE guild_id = 'guild' AND revoked = true) AS revoked",
  );

  expect(first.case?.id).toBe(second.case?.id);
  expect(first.finalWarnCount).toBe(0);
  expect(second.finalWarnCount).toBe(0);
  expect(counts.rows as unknown[]).toEqual([{ cases: 1, revoked: 2 }]);
});

test("separate services recover one same-key create operation from durable storage", async () => {
  const { client, databaseUrl, service } = await createLedger();
  await insertSettings(client);
  const otherClient = createClient({ url: databaseUrl });
  temporaryClients.push(otherClient);
  await otherClient.execute("PRAGMA foreign_keys = ON");
  const otherService = new ModActionService(
    drizzle(otherClient, { schema }),
    () => now,
  );

  const [first, second] = await Promise.all([
    service.createWarn({ ...baseInput, amount: 1, operationKey: "warn:separate" }),
    otherService.createWarn({ ...baseInput, amount: 1, operationKey: "warn:separate" }),
  ]);
  const counts = await client.execute(
    "SELECT (SELECT COUNT(*) FROM mod_cases WHERE operation_key = 'warn:separate') AS cases, (SELECT COUNT(*) FROM warns WHERE guild_id = 'guild') AS warns",
  );

  expect(first.case?.id).toBe(second.case?.id);
  expect(first.finalWarnCount).toBe(1);
  expect(second.finalWarnCount).toBe(1);
  expect(counts.rows as unknown[]).toEqual([{ cases: 1, warns: 1 }]);
});
