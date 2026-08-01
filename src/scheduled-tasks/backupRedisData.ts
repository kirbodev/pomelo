import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { redisBackups, type RedisBackupInsert } from "../db/schema.js";
import {
  BACKUP_CRON,
  BACKUP_LOCK_KEY,
  BACKUP_LOCK_TTL,
  DIRTY_SET_KEY,
  HASH_CACHE_KEY,
  MAX_KEYS_PER_RUN,
  TOMBSTONE_HASH,
  UPSERT_CHUNK_SIZE,
  decodeDirtyMember,
  hashValue,
} from "../lib/helpers/backup.js";

interface PendingBackup {
  member: string;
  row: RedisBackupInsert;
}

export class BackupRedisDataTask extends ScheduledTask {
  public constructor(
    context: ScheduledTask.LoaderContext,
    options: ScheduledTask.Options,
  ) {
    super(context, {
      ...options,
      pattern: BACKUP_CRON,
      name: "backupRedisData",
    });
  }

  public async run() {
    const redis = this.container.redis;
    const lock = await redis.set(
      BACKUP_LOCK_KEY,
      "1",
      "PX",
      BACKUP_LOCK_TTL,
      "NX",
    );
    if (lock !== "OK") return;

    try {
      const members = await redis.spop(DIRTY_SET_KEY, MAX_KEYS_PER_RUN);
      if (members.length === 0) return;

      const cachedHashes = await redis.hmget(HASH_CACHE_KEY, ...members);
      const pending: PendingBackup[] = [];
      const now = Date.now();

      for (const [i, member] of members.entries()) {
        const decoded = decodeDirtyMember(member);
        if (!decoded) continue;

        const value = await redis.jsonGet(decoded.key, decoded.topic);
        if (value === null) {
          // Deleted in Redis — tombstone only if it was ever backed up
          if (cachedHashes[i] === null) continue;
          pending.push({
            member,
            row: {
              topic: decoded.topic,
              key: decoded.key,
              payload: null,
              contentHash: TOMBSTONE_HASH,
              deleted: true,
              updatedAt: now,
            },
          });
          continue;
        }

        const contentHash = hashValue(value);
        if (contentHash === cachedHashes[i]) continue;
        pending.push({
          member,
          row: {
            topic: decoded.topic,
            key: decoded.key,
            payload: JSON.stringify(value),
            contentHash,
            deleted: false,
            updatedAt: now,
          },
        });
      }

      let written = 0;
      for (let i = 0; i < pending.length; i += UPSERT_CHUNK_SIZE) {
        const chunk = pending.slice(i, i + UPSERT_CHUNK_SIZE);
        try {
          await db
            .insert(redisBackups)
            .values(chunk.map((entry) => entry.row))
            .onConflictDoUpdate({
              target: [redisBackups.topic, redisBackups.key],
              set: {
                payload: sql`excluded.payload`,
                contentHash: sql`excluded.content_hash`,
                deleted: sql`excluded.deleted`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
          written += chunk.length;

          // Sync the hash cache only after the chunk is durably written
          const live = chunk.filter((entry) => !entry.row.deleted);
          const tombstoned = chunk.filter((entry) => entry.row.deleted);
          if (live.length > 0)
            await redis.hset(
              HASH_CACHE_KEY,
              Object.fromEntries(
                live.map((entry) => [entry.member, entry.row.contentHash]),
              ),
            );
          if (tombstoned.length > 0)
            await redis.hdel(
              HASH_CACHE_KEY,
              ...tombstoned.map((entry) => entry.member),
            );
        } catch (error) {
          // Requeue the failed chunk so the next run retries it
          await redis.sadd(
            DIRTY_SET_KEY,
            ...chunk.map((entry) => entry.member),
          );
          this.container.logger.error(
            `Redis backup: failed to upsert a chunk of ${String(chunk.length)} rows, requeued:`,
            error,
          );
        }
      }

      this.container.logger.info(
        `Redis backup: ${String(members.length)} dirty keys, ${String(written)} rows written, ${String(
          members.length - pending.length,
        )} unchanged.`,
      );
    } finally {
      await this.container.redis.del(BACKUP_LOCK_KEY);
    }
  }
}

declare module "@sapphire/plugin-scheduled-tasks" {
  interface ScheduledTasks {
    backupRedisData: never;
  }
}
