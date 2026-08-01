import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { redisBackups } from "../db/schema.js";
import {
  BACKUP_TOPICS,
  DIRTY_SET_KEY,
  HASH_CACHE_KEY,
  TURSO_READ_PAGE_SIZE,
  VERIFY_CRON,
  VERIFY_LOCK_KEY,
  VERIFY_LOCK_TTL,
  diffBackupState,
  encodeDirtyMember,
  hashValue,
  type BackupRowState,
  type BackupTopic,
} from "../lib/helpers/backup.js";

const HASH_BATCH_SIZE = 50;

export class VerifyRedisBackupIntegrityTask extends ScheduledTask {
  public constructor(
    context: ScheduledTask.LoaderContext,
    options: ScheduledTask.Options,
  ) {
    super(context, {
      ...options,
      pattern: VERIFY_CRON,
      name: "verifyRedisBackupIntegrity",
    });
  }

  public async run() {
    const redis = this.container.redis;
    const lock = await redis.set(
      VERIFY_LOCK_KEY,
      "1",
      "PX",
      VERIFY_LOCK_TTL,
      "NX",
    );
    if (lock !== "OK") return;

    try {
      let checked = 0;
      let reEnqueued = 0;
      let suspectedLoss = 0;

      for (const topic of BACKUP_TOPICS) {
        const redisHashes = await this.collectRedisHashes(topic);
        const backupRows = await this.fetchBackupRows(topic);
        const diff = diffBackupState(redisHashes, backupRows);

        checked += redisHashes.size;

        if (diff.staleKeys.length > 0) {
          // Repair through the incremental pipeline — no direct Turso writes
          await redis.sadd(
            DIRTY_SET_KEY,
            ...diff.staleKeys.map((key) => encodeDirtyMember(topic, key)),
          );
          reEnqueued += diff.staleKeys.length;
        }

        if (diff.suspectedLossKeys.length > 0) {
          suspectedLoss += diff.suspectedLossKeys.length;
          this.container.logger.error(
            `Redis backup integrity: ${String(diff.suspectedLossKeys.length)} ${topic} key(s) are backed up as live but missing from Redis — potential data loss. Keys: ${diff.suspectedLossKeys.join(", ")}`,
          );
          // Drop stale cache entries so a re-created key gets backed up fresh
          await redis.hdel(
            HASH_CACHE_KEY,
            ...diff.suspectedLossKeys.map((key) =>
              encodeDirtyMember(topic, key),
            ),
          );
        }
      }

      this.container.logger.info(
        `Redis backup integrity: checked ${String(checked)} keys, re-enqueued ${String(reEnqueued)}, suspected loss ${String(suspectedLoss)}.`,
      );
    } finally {
      await this.container.redis.del(VERIFY_LOCK_KEY);
    }
  }

  private async collectRedisHashes(topic: BackupTopic) {
    const redis = this.container.redis;
    const keys = await redis.scanTopicKeys(topic);
    const hashes = new Map<string, string>();
    for (let i = 0; i < keys.length; i += HASH_BATCH_SIZE) {
      const batch = keys.slice(i, i + HASH_BATCH_SIZE);
      const values = await Promise.all(
        batch.map((key) => redis.jsonGet(key, topic)),
      );
      for (const [j, value] of values.entries()) {
        if (value === null) continue;
        hashes.set(batch[j], hashValue(value));
      }
    }
    return hashes;
  }

  private async fetchBackupRows(topic: BackupTopic) {
    const rows: BackupRowState[] = [];
    let offset = 0;
    // Hash column only, paginated — never read payloads during the sweep
    for (;;) {
      const page = await db
        .select({
          key: redisBackups.key,
          contentHash: redisBackups.contentHash,
          deleted: redisBackups.deleted,
        })
        .from(redisBackups)
        .where(eq(redisBackups.topic, topic))
        .limit(TURSO_READ_PAGE_SIZE)
        .offset(offset);
      rows.push(...page);
      if (page.length < TURSO_READ_PAGE_SIZE) break;
      offset += TURSO_READ_PAGE_SIZE;
    }
    return rows;
  }
}

declare module "@sapphire/plugin-scheduled-tasks" {
  interface ScheduledTasks {
    verifyRedisBackupIntegrity: never;
  }
}
