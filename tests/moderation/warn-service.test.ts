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
