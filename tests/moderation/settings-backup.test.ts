import { expect, test } from "bun:test";
import {
  BackupTtlMs,
  BackupTtlSeconds,
  WarnSettingsBackupRepository,
  type BackupRedis,
  type WarnSettingsBackup,
} from "../../src/lib/moderation/settingsBackup.js";
import { isQuickstartActionAllowed } from "../../src/lib/moderation/workflowRepository.js";

class MemoryBackupRedis implements BackupRedis {
  public readonly values = new Map<string, string>();
  public readonly ttl = new Map<string, number>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(
    key: string,
    value: string,
    _mode: "EX",
    seconds: number,
  ): Promise<"OK" | null> {
    // NX semantics: refuse the write when the key already exists.
    if (this.values.has(key)) return Promise.resolve(null);
    this.values.set(key, value);
    this.ttl.set(key, seconds);
    return Promise.resolve("OK");
  }

  del(key: string): Promise<number> {
    this.ttl.delete(key);
    return Promise.resolve(this.values.delete(key) ? 1 : 0);
  }
}

const makeBackup = (
  overrides: Partial<WarnSettingsBackup> = {},
): WarnSettingsBackup => ({
  guildId: "guild",
  savedAt: 1_000,
  resetBy: "moderator",
  settings: {
    maxWarns: 10,
    defaultExpiryDays: 3,
    dmOnWarn: true,
    autoApplyWarnPunishments: false,
    dangerouslyBypassWarnPermissions: false,
    logChannelId: "log-channel",
    actions: '[{"warnCount":1,"punishments":[],"autoConfirm":true}]',
    roleApply: null,
  },
  ...overrides,
});

test("backup writes carry the 24-hour TTL for automatic cleanup", async () => {
  const redis = new MemoryBackupRedis();
  const repository = new WarnSettingsBackupRepository(redis, () => 2_000);

  await repository.save(makeBackup());

  expect(BackupTtlSeconds).toBe(86_400);
  expect(redis.ttl.get("warn-settings-backup:guild")).toBe(BackupTtlSeconds);
});

test("only the first reset of a 24-hour window is retained", async () => {
  const redis = new MemoryBackupRedis();
  const repository = new WarnSettingsBackupRepository(redis, () => 5_000);

  const first = await repository.save(makeBackup({ savedAt: 1_000 }));
  const second = await repository.save(
    makeBackup({ savedAt: 4_000, resetBy: "someone-else" }),
  );

  expect(first.savedAt).toBe(1_000);
  // The second reset returns the retained snapshot, not its own.
  expect(second.savedAt).toBe(1_000);
  expect(second.resetBy).toBe("moderator");
  expect((await repository.get("guild"))?.savedAt).toBe(1_000);
});

test("snapshots older than 24 hours are never handed out", async () => {
  const redis = new MemoryBackupRedis();
  let now = 1_000;
  const repository = new WarnSettingsBackupRepository(redis, () => now);

  await repository.save(makeBackup({ savedAt: 1_000 }));
  now = 1_000 + BackupTtlMs - 1;
  expect(await repository.get("guild")).not.toBeNull();

  now = 1_000 + BackupTtlMs;
  expect(await repository.get("guild")).toBeNull();
  expect(redis.values.size).toBe(0);
});

test("corrupt or malformed snapshots are dropped instead of restored", async () => {
  const redis = new MemoryBackupRedis();
  const repository = new WarnSettingsBackupRepository(redis, () => 1_000);

  redis.values.set("warn-settings-backup:guild", "{not json");
  expect(await repository.get("guild")).toBeNull();

  redis.values.set(
    "warn-settings-backup:guild",
    JSON.stringify({ guildId: "guild", savedAt: 1, resetBy: "x" }),
  );
  expect(await repository.get("guild")).toBeNull();
  expect(redis.values.size).toBe(0);
});

test("restore consumes the snapshot so it can't be replayed", async () => {
  const redis = new MemoryBackupRedis();
  const repository = new WarnSettingsBackupRepository(redis, () => 2_000);

  await repository.save(makeBackup());
  await repository.delete("guild");
  expect(await repository.get("guild")).toBeNull();
});

test("reset and restore actions are bound to their screens", () => {
  expect(isQuickstartActionAllowed(3, "reset")).toBe(true);
  expect(isQuickstartActionAllowed(1, "reset")).toBe(false);
  expect(isQuickstartActionAllowed(7, "confirm-reset")).toBe(true);
  expect(isQuickstartActionAllowed(7, "cancel-reset")).toBe(true);
  expect(isQuickstartActionAllowed(7, "restore-backup")).toBe(true);
  expect(isQuickstartActionAllowed(1, "restore-backup")).toBe(true);
  expect(isQuickstartActionAllowed(3, "confirm-reset")).toBe(false);
  expect(isQuickstartActionAllowed(6, "reset")).toBe(false);
});
