import { z } from "zod";

// A reset backup lives for exactly 24 hours; Redis TTL handles cleanup.
export const BackupTtlSeconds = 86_400;
export const BackupTtlMs = BackupTtlSeconds * 1000;

const backupSettingsSchema = z
  .object({
    maxWarns: z.number().int().positive(),
    defaultExpiryDays: z.number().int().min(0).max(365),
    dmOnWarn: z.boolean(),
    autoApplyWarnPunishments: z.boolean(),
    dangerouslyBypassWarnPermissions: z.boolean(),
    logChannelId: z.string().trim().min(1).nullable(),
    actions: z.string(),
    roleApply: z.string().nullable(),
  })
  .strict();

const backupSchema = z
  .object({
    guildId: z.string().trim().min(1),
    savedAt: z.number().int().positive(),
    resetBy: z.string().trim().min(1),
    settings: backupSettingsSchema,
  })
  .strict();

export type WarnSettingsBackup = z.infer<typeof backupSchema>;

export type BackupRedis = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
    condition: "NX",
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

/**
 * Redis-backed store for the pre-reset warn settings snapshot. Writes use
 * SET NX with a 24h TTL, so the first reset in a 24-hour window wins and
 * later resets never overwrite the retained backup; expiry cleanup is
 * fully delegated to Redis.
 */
export class WarnSettingsBackupRepository {
  public constructor(
    private readonly redis: BackupRedis,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Stores the snapshot unless one already exists. Returns the backup that
   * is actually retained (the existing one when a reset already happened
   * within the current 24-hour window).
   */
  public async save(backup: WarnSettingsBackup): Promise<WarnSettingsBackup> {
    const validated = backupSchema.parse(backup);
    const result = await this.redis.set(
      this.key(validated.guildId),
      JSON.stringify(validated),
      "EX",
      BackupTtlSeconds,
      "NX",
    );
    if (result === "OK") return validated;
    // NX refused the write — an earlier reset already holds the window.
    const existing = await this.get(validated.guildId);
    return existing ?? validated;
  }

  public async get(guildId: string): Promise<WarnSettingsBackup | null> {
    const raw = await this.redis.get(this.key(guildId));
    if (!raw) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      await this.redis.del(this.key(guildId));
      return null;
    }
    const parsed = backupSchema.safeParse(decoded);
    // Belt and braces on top of the Redis TTL: never hand out a snapshot
    // older than the 24-hour restore window.
    if (!parsed.success || parsed.data.savedAt + BackupTtlMs <= this.now()) {
      await this.redis.del(this.key(guildId));
      return null;
    }
    return parsed.data;
  }

  public async delete(guildId: string): Promise<void> {
    await this.redis.del(this.key(guildId));
  }

  private key(guildId: string): string {
    return `warn-settings-backup:${guildId}`;
  }
}
