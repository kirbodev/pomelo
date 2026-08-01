import { container } from "@sapphire/framework";
import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  punishmentRoles,
  warns,
  type PunishmentRole,
} from "../../db/schema.js";

type Executor =
  | typeof db
  | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * Actor recorded on releases performed by the bot itself (expiry sweeps,
 * rejoin revalidation, deleted roles) rather than by a human.
 */
export const PUNISHMENT_ROLE_SYSTEM_ACTOR = "system";

/** Actor recorded when staff strip the role directly through Discord. */
export const PUNISHMENT_ROLE_MANUAL_ACTOR = "manual";

export type RecordPunishmentRoleInput = {
  guildId: string;
  userId: string;
  roleId: string;
  /** The warn level whose punishment assigned this role. */
  warnLevel: number;
  /** The warn case that triggered the assignment, when known. */
  caseId?: number | null;
};

export type ReleasePunishmentRolesInput = {
  guildId: string;
  userId: string;
  roleIds: readonly string[];
  removedBy: string | null;
};

/**
 * Computes when the user's active warn count drops below `warnLevel`, which
 * is the moment a punishment role assigned at that level stops being
 * justified. Warns without an expiry sort last; if the deciding warn never
 * expires, the role persists until it's released manually.
 */
export function computePunishmentRoleExpiry(
  expiries: ReadonlyArray<number | null>,
  warnLevel: number,
): number | null {
  if (expiries.length === 0) return null;
  const sorted = [...expiries].sort((left, right) => {
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  });
  const index = Math.max(0, sorted.length - warnLevel);
  return sorted[index] ?? null;
}

/**
 * Expiry timestamps of the user's active (non-revoked, non-expired) warns.
 */
export async function getActiveWarnExpiries(
  guildId: string,
  userId: string,
  executor: Executor = db,
  now: number = Date.now(),
): Promise<Array<number | null>> {
  const rows = await executor
    .select({ expiresAt: warns.expiresAt })
    .from(warns)
    .where(
      and(
        eq(warns.guildId, guildId),
        eq(warns.userId, userId),
        eq(warns.revoked, false),
        or(isNull(warns.expiresAt), gt(warns.expiresAt, now)),
      ),
    )
    .limit(200);
  return rows.map((row) => row.expiresAt);
}

function isPunishmentRoleConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE") &&
    error.message.includes("punishment_roles")
  );
}

/**
 * Records (or refreshes) a role that was assigned as a warn punishment, so
 * it can be reapplied if the member leaves and rejoins. One row exists per
 * (guild, user, role); when the same role is assigned by several warn levels
 * the lowest level wins, because the role stays justified for as long as the
 * lowest of those levels is still met.
 */
export async function recordPunishmentRole(
  input: RecordPunishmentRoleInput,
  executor: Executor = db,
  now: number = Date.now(),
): Promise<void> {
  const expiries = await getActiveWarnExpiries(
    input.guildId,
    input.userId,
    executor,
    now,
  );

  const existing = await executor
    .select()
    .from(punishmentRoles)
    .where(
      and(
        eq(punishmentRoles.guildId, input.guildId),
        eq(punishmentRoles.userId, input.userId),
        eq(punishmentRoles.roleId, input.roleId),
      ),
    )
    .limit(1);
  const row = existing.at(0);

  if (!row) {
    try {
      await executor.insert(punishmentRoles).values({
        guildId: input.guildId,
        userId: input.userId,
        roleId: input.roleId,
        warnLevel: input.warnLevel,
        caseId: input.caseId ?? null,
        expiresAt: computePunishmentRoleExpiry(expiries, input.warnLevel),
        createdAt: now,
        updatedAt: now,
      });
      return;
    } catch (error) {
      // Lost an insert race; fall through and merge into the winner's row.
      if (!isPunishmentRoleConflict(error)) throw error;
    }
  }

  const mergedLevel =
    row && !row.removed
      ? Math.min(row.warnLevel, input.warnLevel)
      : input.warnLevel;
  await executor
    .update(punishmentRoles)
    .set({
      warnLevel: mergedLevel,
      caseId: input.caseId ?? row?.caseId ?? null,
      expiresAt: computePunishmentRoleExpiry(expiries, mergedLevel),
      removed: false,
      removedBy: null,
      removedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(punishmentRoles.guildId, input.guildId),
        eq(punishmentRoles.userId, input.userId),
        eq(punishmentRoles.roleId, input.roleId),
      ),
    );
}

/**
 * Punishment roles that should currently be on the member — active records
 * whose expiry hasn't passed. Used to reapply roles on rejoin.
 */
export async function getPersistedPunishmentRoles(
  guildId: string,
  userId: string,
  executor: Executor = db,
  now: number = Date.now(),
): Promise<PunishmentRole[]> {
  return executor
    .select()
    .from(punishmentRoles)
    .where(
      and(
        eq(punishmentRoles.guildId, guildId),
        eq(punishmentRoles.userId, userId),
        eq(punishmentRoles.removed, false),
        or(
          isNull(punishmentRoles.expiresAt),
          gt(punishmentRoles.expiresAt, now),
        ),
      ),
    )
    .limit(50);
}

/**
 * Marks the given punishment roles as released so they stop being reapplied.
 * Only touches records that are still active.
 */
export async function releasePunishmentRoles(
  input: ReleasePunishmentRolesInput,
  executor: Executor = db,
  now: number = Date.now(),
): Promise<PunishmentRole[]> {
  if (input.roleIds.length === 0) return [];
  return executor
    .update(punishmentRoles)
    .set({
      removed: true,
      removedBy: input.removedBy,
      removedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(punishmentRoles.guildId, input.guildId),
        eq(punishmentRoles.userId, input.userId),
        eq(punishmentRoles.removed, false),
        inArray(punishmentRoles.roleId, [...input.roleIds]),
      ),
    )
    .returning();
}

/**
 * Releases every punishment role whose warn level is no longer met by the
 * user's active warn count (after an unwarn/revocation), then strips those
 * roles from the member if they're still in the guild. Discord removal is
 * best-effort — the record is released either way, since the warn backing it
 * is gone.
 */
export async function releaseUnjustifiedPunishmentRoles(
  input: { guildId: string; userId: string; removedBy: string | null },
  executor: Executor = db,
  now: number = Date.now(),
): Promise<PunishmentRole[]> {
  const activeCount = (
    await getActiveWarnExpiries(input.guildId, input.userId, executor, now)
  ).length;
  const released = await executor
    .update(punishmentRoles)
    .set({
      removed: true,
      removedBy: input.removedBy,
      removedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(punishmentRoles.guildId, input.guildId),
        eq(punishmentRoles.userId, input.userId),
        eq(punishmentRoles.removed, false),
        gt(punishmentRoles.warnLevel, activeCount),
      ),
    )
    .returning();
  if (released.length === 0) return released;
  await removePunishmentRolesFromMember(
    input.guildId,
    input.userId,
    released.map((record) => record.roleId),
    "Warning revoked; punishment role released.",
  );
  return released;
}

/**
 * Best-effort removal of punishment roles from a guild member. Returns true
 * when the Discord state is confirmed clean (roles removed, member gone, or
 * roles already absent) and false when the removal couldn't be confirmed.
 */
export async function removePunishmentRolesFromMember(
  guildId: string,
  userId: string,
  roleIds: readonly string[],
  reason: string,
): Promise<boolean> {
  try {
    const guild = container.client.guilds.cache.get(guildId);
    if (!guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return true;
    const present = roleIds.filter((roleId) => member.roles.cache.has(roleId));
    if (present.length === 0) return true;
    await member.roles.remove(present, reason);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sweeps punishment role records whose stored expiry has passed. Records
 * that are still justified (newer warns kept the count at or above the
 * level) get their expiry pushed forward instead of being released — this
 * self-heals staleness from warns added or re-timed after assignment.
 * Records that can't be confirmed removed on Discord are put back so the
 * next sweep retries.
 */
export async function sweepExpiredPunishmentRoles(
  executor: Executor = db,
  now: number = Date.now(),
  removeRoles: typeof removePunishmentRolesFromMember = removePunishmentRolesFromMember,
): Promise<void> {
  const due = await executor
    .select()
    .from(punishmentRoles)
    .where(
      and(
        eq(punishmentRoles.removed, false),
        isNotNull(punishmentRoles.expiresAt),
        lte(punishmentRoles.expiresAt, now),
      ),
    )
    .limit(100);

  for (const record of due) {
    const expiries = await getActiveWarnExpiries(
      record.guildId,
      record.userId,
      executor,
      now,
    );
    if (expiries.length >= record.warnLevel) {
      await executor
        .update(punishmentRoles)
        .set({
          expiresAt: computePunishmentRoleExpiry(expiries, record.warnLevel),
          updatedAt: now,
        })
        .where(
          and(
            eq(punishmentRoles.id, record.id),
            eq(punishmentRoles.removed, false),
          ),
        );
      continue;
    }

    const claimed = await executor
      .update(punishmentRoles)
      .set({
        removed: true,
        removedBy: PUNISHMENT_ROLE_SYSTEM_ACTOR,
        removedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(punishmentRoles.id, record.id),
          eq(punishmentRoles.removed, false),
        ),
      )
      .returning({ id: punishmentRoles.id });
    if (claimed.length === 0) continue;

    const confirmed = await removeRoles(
      record.guildId,
      record.userId,
      [record.roleId],
      "Warning expired; punishment role released.",
    );
    if (!confirmed) {
      await executor
        .update(punishmentRoles)
        .set({ removed: false, removedBy: null, removedAt: null, updatedAt: now })
        .where(eq(punishmentRoles.id, record.id));
    }
  }
}
