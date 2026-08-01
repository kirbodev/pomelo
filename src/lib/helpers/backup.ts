import { createHash } from "node:crypto";
import type * as Schemas from "../../db/redis/schema.js";

/**
 * Redis topics that get backed up to libSQL. Add a topic here (and nothing
 * else) to include it in the backup + consistency pipeline.
 */
export const BACKUP_TOPICS = [
  "UserSettings",
  "GuildSettings",
  "Afk",
] as const satisfies readonly (keyof typeof Schemas)[];

export type BackupTopic = (typeof BACKUP_TOPICS)[number];

// Redis bookkeeping keys (cheap; all backup state lives in Redis, not Turso)
export const DIRTY_SET_KEY = "backup:dirty";
export const HASH_CACHE_KEY = "backup:hashes";
export const BACKUP_LOCK_KEY = "backup:lock:backup";
export const VERIFY_LOCK_KEY = "backup:lock:verify";

// Scheduling + batching knobs
export const BACKUP_CRON = "*/15 * * * *";
export const VERIFY_CRON = "0 4 * * *";
export const MAX_KEYS_PER_RUN = 500;
export const UPSERT_CHUNK_SIZE = 50;
export const BACKUP_LOCK_TTL = 10 * 60 * 1000;
export const VERIFY_LOCK_TTL = 15 * 60 * 1000;
export const TURSO_READ_PAGE_SIZE = 500;

export function isBackupTopic(topic: string): topic is BackupTopic {
  return (BACKUP_TOPICS as readonly string[]).includes(topic);
}

/**
 * Encodes a topic + key pair into a dirty set member.
 * Topics never contain ":", so decoding splits on the first separator only.
 */
export function encodeDirtyMember(topic: BackupTopic, key: string): string {
  return `${topic}:${key}`;
}

export function decodeDirtyMember(
  member: string,
): { topic: BackupTopic; key: string } | null {
  const separatorIndex = member.indexOf(":");
  if (separatorIndex === -1) return null;
  const topic = member.slice(0, separatorIndex);
  const key = member.slice(separatorIndex + 1);
  if (!isBackupTopic(topic) || key === "") return null;
  return { topic, key };
}

function sortValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Stable content hash: canonical JSON (sorted keys) + sha1.
 * Identical data always produces the same hash regardless of key order,
 * so unchanged values never cost a Turso write.
 */
export function hashValue(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(sortValue(value))).digest("hex");
}

/** Content hash stored on tombstone rows (the value no longer exists). */
export const TOMBSTONE_HASH = hashValue(null);

export interface BackupRowState {
  key: string;
  contentHash: string;
  deleted: boolean;
}

export interface BackupDiffResult {
  /** Keys whose backup is missing, outdated, or wrongly tombstoned — re-enqueue for backup. */
  staleKeys: string[];
  /** Keys backed up as live but gone from Redis — potential data loss. */
  suspectedLossKeys: string[];
  /** Keys whose backup matches Redis exactly. */
  matching: number;
}

/**
 * Pure diff between the live Redis state (key → content hash) and the backup
 * table rows for one topic. Decides what needs re-backup vs. what looks lost.
 */
export function diffBackupState(
  redisHashes: Map<string, string>,
  backupRows: BackupRowState[],
): BackupDiffResult {
  const staleKeys: string[] = [];
  const suspectedLossKeys: string[] = [];
  let matching = 0;

  const backupByKey = new Map(backupRows.map((row) => [row.key, row]));

  for (const [key, hash] of redisHashes) {
    const row = backupByKey.get(key);
    if (!row || row.deleted || row.contentHash !== hash) staleKeys.push(key);
    else matching++;
  }

  for (const row of backupRows) {
    if (row.deleted) continue;
    if (!redisHashes.has(row.key)) suspectedLossKeys.push(row.key);
  }

  return { staleKeys, suspectedLossKeys, matching };
}
