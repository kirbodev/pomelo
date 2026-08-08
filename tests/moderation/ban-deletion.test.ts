import { createClient } from "@libsql/client";
import { afterEach, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GuildMember, type Guild } from "discord.js";
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
  const directory = mkdtempSync(join(tmpdir(), "pomelo-ban-deletion-"));
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

function member(id: string, position: number, isTarget = false) {
  return Object.defineProperties(
    Object.create(GuildMember.prototype),
    {
      id: { value: id },
      user: {
        value: {
          id,
          ...(isTarget ? { send: mock(() => Promise.resolve()) } : {}),
        },
      },
      roles: { value: { highest: { position } } },
      permissions: { value: { has: () => false } },
    },
  ) as GuildMember;
}

function guildWith(bansCreate: (userId: string, options: unknown) => Promise<unknown>) {
  return {
    id: "guild",
    name: "Test Server",
    ownerId: "owner",
    client: { user: { id: "bot" } },
    members: { fetchMe: mock(() => member("bot", 20)) },
    bans: { create: bansCreate },
  } as unknown as Guild;
}

test("ban forwards the 1h message-deletion choice to Discord", async () => {
  const { service } = await createLedger();
  const bansCreate = mock(() => Promise.resolve());
  const guild = guildWith(bansCreate);
  const moderator = member("moderator", 10);
  const target = member("member", 1, true);

  const result = await service.ban(guild, moderator, target, "reason", {
    deleteMessageDays: 3600,
  });

  expect(result.success).toBe(true);
  expect(bansCreate).toHaveBeenCalledWith("member", {
    reason: "reason",
    deleteMessageSeconds: 3600,
  });
});

test("ban omits deleteMessageSeconds when no deletion window is chosen", async () => {
  const { service } = await createLedger();
  const bansCreate = mock(() => Promise.resolve());
  const guild = guildWith(bansCreate);
  const moderator = member("moderator", 10);
  const target = member("member", 1, true);

  await service.ban(guild, moderator, target, "reason");

  expect(bansCreate).toHaveBeenCalledWith("member", {
    reason: "reason",
    deleteMessageSeconds: undefined,
  });
});
