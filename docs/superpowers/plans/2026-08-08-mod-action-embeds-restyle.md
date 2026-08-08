# Mod Action Embeds Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every action-result embed in the mod commands: titles, `@mention (username)` user format, secondary info in fields, natural warn counting ("twice"/"thrice"), and a warn history field.

**Architecture:** Rendering-only restyle. Three pure helpers (`userMention`, warn-count key selection, punishment labels, history text) sit in `src/lib/moderation/actionEmbed.ts` and are unit-tested; a new read-only `getWarnHistory()` joins `warns` + `mod_cases` for the history field; commands build embeds with title + one description sentence + fields.

**Tech Stack:** TypeScript (strict), Sapphire 5 + discord.js v14, Drizzle ORM over libSQL, i18next via `@sapphire/plugin-i18next`, bun:test for tests (run with `bun test`, not jest — the `tests/` suite imports from `bun:test`).

## Global Constraints

- All user-facing strings go through `LanguageKeys.*`; never inline a string. New keys are added to **all three** locales: `en-US`, `it`, `es-ES` (`src/languages/*/commands/moderation.json`).
- Every new/edited user-facing string gets a humanizer pass: 1st person, informal professional, no em-dash habit, no "warn(s)"-style hacks. This is a hard rule from AGENTS.md §1.9.
- The design spec is at `docs/superpowers/specs/2026-08-08-mod-action-embeds-restyle-design.md`. Deviation from spec: the `userMention` helper lives in the existing `src/lib/helpers/stringUtils.ts` (there is no `string.ts`).
- Embed colors: success embeds use `Colors.Success`, error embeds `Colors.Error`, info views `Colors.Info`. Never use a hex literal.
- User references: `userMention()` = `<@id> (username)`; used in every description sentence and list title. Raw mentions don't ping from ephemeral replies.
- Tests: `bun test <file>`. No typecheck script exists; run `bunx tsc --noEmit` for type checking.
- Do not touch: quick action rows, warn-level confirmation dialog, DB schema, Redis schema, error embeds (they stay description-only).

---

### Task 1: Pure helpers — `userMention`, warn-count key, punishment label, history text

**Files:**
- Modify: `src/lib/helpers/stringUtils.ts` (append `userMention`)
- Modify: `src/lib/moderation/types.ts` (add `WarnHistoryEntry`, `WarnHistory`)
- Create: `src/lib/moderation/actionEmbed.ts`
- Test: `tests/moderation/action-embed.test.ts`

**Interfaces:**
- Produces:
  - `userMention(user: { id: string; username: string }): string` → `"<@id> (username)"`
  - `WarnCountDescKey` type + `warnCountDescKey(amount: number): WarnCountDescKey`
  - `punishmentLabel(p: WarnPunishment, t: TFunction): string`
  - `warnHistoryFieldValue(history: WarnHistory, t: TFunction): string`
  - `WarnHistory = { active: number; expired: number; total: number; recent: WarnHistoryEntry[] }`, `WarnHistoryEntry = { id: number; reason: string | null; expiresAt: number | null }`

- [ ] **Step 1: Write the failing tests**

Create `tests/moderation/action-embed.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { TFunction } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../../src/lib/i18n/languageKeys.js";
import { userMention } from "../../src/lib/helpers/stringUtils.js";
import {
  punishmentLabel,
  warnCountDescKey,
  warnHistoryFieldValue,
} from "../../src/lib/moderation/actionEmbed.js";
import type { WarnHistory } from "../../src/lib/moderation/types.js";

const fakeT = ((key: string) => key) as unknown as TFunction;

test("userMention returns a mention with the username in parentheses", () => {
  expect(userMention({ id: "695228246966534255", username: "kdv_" })).toBe(
    "<@695228246966534255> (kdv_)",
  );
});

test("warnCountDescKey maps 1/2/3 to once/twice/thrice and 4+ to times", () => {
  expect(warnCountDescKey(1)).toBe(LanguageKeys.Commands.Moderation.Warn.desc);
  expect(warnCountDescKey(2)).toBe(
    LanguageKeys.Commands.Moderation.Warn.descTwice,
  );
  expect(warnCountDescKey(3)).toBe(
    LanguageKeys.Commands.Moderation.Warn.descThrice,
  );
  expect(warnCountDescKey(4)).toBe(
    LanguageKeys.Commands.Moderation.Warn.descTimes,
  );
  expect(warnCountDescKey(10)).toBe(
    LanguageKeys.Commands.Moderation.Warn.descTimes,
  );
});

test("punishmentLabel resolves the right key per punishment type", () => {
  expect(
    punishmentLabel({ type: "mute", duration: 3_600_000 }, fakeT),
  ).toBe("commands/moderation:warn.punishmentMuteFor");
  expect(punishmentLabel({ type: "kick" }, fakeT)).toBe(
    "commands/moderation:warnSettings.quickstart.punishmentKick",
  );
  expect(punishmentLabel({ type: "ban", duration: 604_800_000 }, fakeT)).toBe(
    "commands/moderation:warn.punishmentBanFor",
  );
  expect(punishmentLabel({ type: "ban" }, fakeT)).toBe(
    "commands/moderation:warnSettings.quickstart.punishmentBanPerm",
  );
  expect(punishmentLabel({ type: "role", roleId: "1" }, fakeT)).toBe(
    "commands/moderation:warnSettings.quickstart.punishmentRole",
  );
});

test("warnHistoryFieldValue renders counts plus one line per recent warn", () => {
  const history: WarnHistory = {
    active: 2,
    expired: 1,
    total: 3,
    recent: [
      { id: 12, reason: "spam", expiresAt: 1_700_000_100_000 },
      { id: 8, reason: null, expiresAt: null },
    ],
  };
  const lines = warnHistoryFieldValue(history, fakeT).split("\n");
  expect(lines[0]).toBe(
    LanguageKeys.Commands.Moderation.Warn.historyCounts,
  );
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain(
    LanguageKeys.Commands.Moderation.Warn.historyEntry,
  );
  expect(lines[2]).toContain(
    LanguageKeys.Commands.Moderation.Warn.historyEntryNoExpiry,
  );
  expect(lines[2]).toContain(
    LanguageKeys.Commands.Moderation.Fields.noReason,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/moderation/action-embed.test.ts`
Expected: FAIL — module `actionEmbed` not found / `userMention` not exported.

- [ ] **Step 3: Append `userMention` to `src/lib/helpers/stringUtils.ts`**

Add at the end of the file:

```ts
/**
 * Formats a user as a raw mention followed by the username in parentheses.
 * @param user - The user (id + username are always present on User/GuildMember)
 * @returns e.g. `<@695228246966534255> (kdv_)`
 */
export function userMention(user: {
  id: string;
  username: string;
}): string {
  return `<@${user.id}> (${user.username})`;
}
```

- [ ] **Step 4: Add `WarnHistory` types to `src/lib/moderation/types.ts`**

Append at the end of the file:

```ts
export type WarnHistoryEntry = {
  id: number;
  reason: string | null;
  expiresAt: number | null;
};

export type WarnHistory = {
  active: number;
  expired: number;
  total: number;
  recent: WarnHistoryEntry[];
};
```

- [ ] **Step 5: Create `src/lib/moderation/actionEmbed.ts`**

```ts
import type { TFunction } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../i18n/languageKeys.js";
import type { WarnHistory, WarnPunishment } from "./types.js";
import ms from "../helpers/ms.js";

export type WarnCountDescKey =
  | typeof LanguageKeys.Commands.Moderation.Warn.desc
  | typeof LanguageKeys.Commands.Moderation.Warn.descTwice
  | typeof LanguageKeys.Commands.Moderation.Warn.descThrice
  | typeof LanguageKeys.Commands.Moderation.Warn.descTimes;

/**
 * Picks the description key for a warn count: once (plain), twice, thrice,
 * or N times.
 */
export function warnCountDescKey(amount: number): WarnCountDescKey {
  if (amount === 1) return LanguageKeys.Commands.Moderation.Warn.desc;
  if (amount === 2) return LanguageKeys.Commands.Moderation.Warn.descTwice;
  if (amount === 3) return LanguageKeys.Commands.Moderation.Warn.descThrice;
  return LanguageKeys.Commands.Moderation.Warn.descTimes;
}

/**
 * Localized label for a threshold punishment, e.g. "Mute for 1h",
 * "Kick", "Ban for 7d", "Permanent ban", "Role".
 */
export function punishmentLabel(
  p: WarnPunishment,
  t: TFunction,
): string {
  if (p.type === "mute" && p.duration)
    return t(LanguageKeys.Commands.Moderation.Warn.punishmentMuteFor, {
      duration: ms(p.duration),
    });
  if (p.type === "mute")
    return t(
      LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
        .punishmentMute,
    );
  if (p.type === "kick")
    return t(
      LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
        .punishmentKick,
    );
  if (p.type === "ban" && p.duration)
    return t(LanguageKeys.Commands.Moderation.Warn.punishmentBanFor, {
      duration: ms(p.duration),
    });
  if (p.type === "ban")
    return t(
      LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
        .punishmentBanPerm,
    );
  return t(
    LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
      .punishmentRole,
  );
}

/**
 * Renders the "Warn history" field: a counts line plus up to three recent
 * active warns.
 */
export function warnHistoryFieldValue(
  history: WarnHistory,
  t: TFunction,
): string {
  const lines = [
    t(LanguageKeys.Commands.Moderation.Warn.historyCounts, {
      active: history.active,
      expired: history.expired,
      total: history.total,
    }),
  ];
  for (const entry of history.recent) {
    const reason =
      entry.reason ||
      t(LanguageKeys.Commands.Moderation.Fields.noReason);
    lines.push(
      entry.expiresAt
        ? t(LanguageKeys.Commands.Moderation.Warn.historyEntry, {
            id: String(entry.id),
            reason,
            expiry: `<t:${Math.floor(entry.expiresAt / 1000)}:R>`,
          })
        : t(LanguageKeys.Commands.Moderation.Warn.historyEntryNoExpiry, {
            id: String(entry.id),
            reason,
          }),
    );
  }
  return lines.join("\n");
}
```

Note: `punishmentMuteFor`, `punishmentBanFor`, `historyCounts`, `historyEntry`, `historyEntryNoExpiry`, `Fields.noReason` keys are added in Task 3 — the test file compiles independently but the full suite must wait for Task 3.

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/moderation/action-embed.test.ts`
Expected: PASS (all 4 tests). If the suite fails only on key-typing errors referencing not-yet-existing keys, temporarily stub the new keys in `src/lib/i18n/commands/moderation.ts` + `src/languages/en-US/commands/moderation.json` per Task 3's spec, or defer running this suite until Task 3 is done.

- [ ] **Step 7: Commit**

```bash
git add src/lib/helpers/stringUtils.ts src/lib/moderation/types.ts src/lib/moderation/actionEmbed.ts tests/moderation/action-embed.test.ts
git commit -m "feat(mod): add user mention and embed text helpers"
```

---

### Task 2: `getWarnHistory` service method

**Files:**
- Modify: `src/lib/moderation/actions.ts` (add method after `getActiveWarnCount`, line ~2167)
- Test: `tests/moderation/warn-history.test.ts`

**Interfaces:**
- Consumes: `WarnHistory` type from `src/lib/moderation/types.js` (Task 1), `this.getNow()`, existing `db` + `warns`/`modCases` imports (all present in actions.ts already).
- Produces: `getWarnHistory(guildId: string, userId: string): Promise<WarnHistory>` — used by Task 4's `handleWarnResult`.

- [ ] **Step 1: Write the failing test**

Create `tests/moderation/warn-history.test.ts` (mirrors the harness in `tests/moderation/warn-service.test.ts` — same `createLedger` helper):

```ts
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
  const directory = mkdtempSync(join(tmpdir(), "pomelo-warn-history-"));
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

async function insertCase(
  client: ReturnType<typeof createClient>,
  id: number,
  reason: string,
  caseNumber: number,
) {
  await client.execute({
    sql: "INSERT INTO mod_cases (id, guild_id, case_number, operation_key, user_id, moderator_id, action_type, reason, dm_sent, created_at, updated_at) VALUES (?, 'guild', ?, ?, 'member', 'moderator', 'warn', ?, 0, 1700000000000, 1700000000000)",
    args: [id, caseNumber, `key-${id}`, reason],
  });
}

async function insertWarn(
  client: ReturnType<typeof createClient>,
  id: number,
  caseId: number,
  expiresAt: number | null,
  revoked: boolean,
  createdAt: number,
) {
  await client.execute({
    sql: "INSERT INTO warns (id, case_id, guild_id, user_id, moderator_id, warn_count, expires_at, revoked, created_at) VALUES (?, ?, 'guild', 'member', 'moderator', 1, ?, ?, ?)",
    args: [
      id,
      caseId,
      expiresAt,
      revoked ? 1 : 0,
      createdAt,
    ],
  });
}

test("getWarnHistory counts active, expired and total and returns recent active warns", async () => {
  const { client, service } = await createLedger();

  await insertCase(client, 1, "spam", 1);
  await insertCase(client, 2, "nsfw", 2);
  await insertCase(client, 3, "raiding", 3);
  await insertWarn(client, 1, 1, now + 86_400_000, false, now - 10_000);
  await insertWarn(client, 2, 2, null, false, now - 5_000);
  await insertWarn(client, 3, 3, now - 1_000, false, now - 2_000);

  const history = await service.getWarnHistory("guild", "member");

  expect(history.active).toBe(2);
  expect(history.expired).toBe(1);
  expect(history.total).toBe(3);
  expect(history.recent).toHaveLength(2);
  expect(history.recent[0].reason).toBe("nsfw");
  expect(history.recent[0].expiresAt).toBeNull();
  expect(history.recent[1].reason).toBe("spam");
});

test("getWarnHistory excludes revoked warns from active and recent, keeps them in total", async () => {
  const { client, service } = await createLedger();

  await insertCase(client, 1, "spam", 1);
  await insertCase(client, 2, "nsfw", 2);
  await insertWarn(client, 1, 1, null, true, now - 10_000);
  await insertWarn(client, 2, 2, null, false, now - 5_000);

  const history = await service.getWarnHistory("guild", "member");

  expect(history.active).toBe(1);
  expect(history.expired).toBe(0);
  expect(history.total).toBe(2);
  expect(history.recent).toHaveLength(1);
  expect(history.recent[0].id).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/moderation/warn-history.test.ts`
Expected: FAIL — `getWarnHistory` is not a function.

- [ ] **Step 3: Implement `getWarnHistory` in `src/lib/moderation/actions.ts`**

Insert directly after the `getActiveWarnCount` method (after line 2167):

```ts
  async getWarnHistory(
    guildId: string,
    userId: string,
  ): Promise<WarnHistory> {
    const now = this.getNow();
    const [totalRow] = await db
      .select({ count: count() })
      .from(warns)
      .where(and(eq(warns.guildId, guildId), eq(warns.userId, userId)));
    const [expiredRow] = await db
      .select({ count: count() })
      .from(warns)
      .where(
        and(
          eq(warns.guildId, guildId),
          eq(warns.userId, userId),
          eq(warns.revoked, false),
          sql`warns.expires_at IS NOT NULL AND warns.expires_at <= ${now}`,
        ),
      );
    const recent = await db
      .select({
        id: warns.id,
        reason: modCases.reason,
        expiresAt: warns.expiresAt,
      })
      .from(warns)
      .innerJoin(
        modCases,
        and(eq(warns.caseId, modCases.id), eq(warns.guildId, modCases.guildId)),
      )
      .where(
        and(
          eq(warns.guildId, guildId),
          eq(warns.userId, userId),
          eq(warns.revoked, false),
          sql`(warns.expires_at IS NULL OR warns.expires_at > ${now})`,
        ),
      )
      .orderBy(desc(warns.createdAt))
      .limit(3);

    return {
      active: await this.getActiveWarnCount(guildId, userId),
      expired: expiredRow?.count ?? 0,
      total: totalRow?.count ?? 0,
      recent: recent.map((r) => ({
        id: r.id,
        reason: r.reason,
        expiresAt: r.expiresAt,
      })),
    };
  }
```

Add `WarnHistory` to the type import from `./types.js` (line ~30 import block):

```ts
import {
  type ModActionResult,
  type WarnActionResult,
  type ActionType,
  type WarnLevel,
  type WarnPunishment,
  type PunishResult,
  type LevelExecResult,
  type ModActionOptions,
  type PunishmentItemState,
  type WarnHistory,
} from "./types.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/moderation/warn-history.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/moderation/actions.ts tests/moderation/warn-history.test.ts
git commit -m "feat(mod): add warn history summary query"
```

---

### Task 3: Language keys — JSON (3 locales) + `LanguageKeys` entries

**Files:**
- Modify: `src/languages/en-US/commands/moderation.json`
- Modify: `src/languages/it/commands/moderation.json`
- Modify: `src/languages/es-ES/commands/moderation.json`
- Modify: `src/lib/i18n/commands/moderation.ts`

**Interfaces:**
- Produces: all keys consumed by Tasks 1, 4-8:
  - `Moderation.Fields.*` (shared field names): `reason`, `duration`, `dm`, `moderator`, `users`, `messagesDeleted`, `noReason`, `never`, `unknown`, `note`, `notesCount` (plural `notesCount_one`/`notesCount_other`)
  - `Moderation.Warn.*`: changed `desc`, new `descTwice`, `descThrice`, `descTimes`, `punishment`, `punishmentN`, `punishmentMuteFor`, `punishmentBanFor`, `punishmentAtLevel`, `punishmentWaiting`, `historyField`, `historyCounts`, `historyEntry`, `historyEntryNoExpiry`, `removedTitle`, `removedDesc`, `multiTitle` (plural `multiTitle_one`/`multiTitle_other`)
  - `Moderation.Kick/Ban/Mute/Unmute/Unban.desc` — updated values; `descWithReason` removed everywhere; `Ban.descTemp` removed
  - `Moderation.Case.caseHeader`

- [ ] **Step 1: Update `src/languages/en-US/commands/moderation.json`**

Replace the `kick` block (lines 2-14):

```json
  "kick": {
    "commandName": "kick",
    "commandDescription": "Kick a user from the server.",
    "userFieldName": "user",
    "userFieldDescription": "The user to kick.",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the kick.",
    "title": "Kicked",
    "desc": "**{{user}}** has been kicked",
    "dmSent": "DM sent",
    "dmNotSent": "Couldn't DM"
  },
```

Replace the `ban` block (lines 15-38) — drop `descWithReason` and `descTemp`:

```json
  "ban": {
    "commandName": "ban",
    "commandDescription": "Ban a user from the server.",
    "userFieldName": "user",
    "userFieldDescription": "The user to ban.",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the ban.",
    "durationFieldName": "duration",
    "durationFieldDescription": "How long the ban should last (e.g. 7d).",
    "deleteMessagesFieldName": "delete-messages",
    "deleteMessagesFieldDescription": "Delete recent messages from the user.",
    "title": "Banned",
    "desc": "**{{user}}** has been banned",
    "dmSent": "DM sent",
    "dmNotSent": "Couldn't DM",
    "deleteMessagesNone": "Don't delete any",
    "deleteMessages1h": "Last hour",
    "deleteMessages6h": "Last 6 hours",
    "deleteMessages24h": "Last 24 hours",
    "deleteMessages3d": "Last 3 days",
    "deleteMessages7d": "Last 7 days"
  },
```

Replace the `unban` block (lines 39-49) — drop `descWithReason`:

```json
  "unban": {
    "commandName": "unban",
    "commandDescription": "Unban a user from the server.",
    "userIdFieldName": "user-id",
    "userIdFieldDescription": "The ID of the user to unban.",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the unban.",
    "title": "Unbanned",
    "desc": "**{{user}}** has been unbanned"
  },
```

Replace the `mute` block (lines 50-65) — drop `descWithReason`, remove the `durationTooLong` duplicate (it also lives under `errors`):

```json
  "mute": {
    "commandName": "mute",
    "commandDescription": "Mute a user in the server.",
    "userFieldName": "user",
    "userFieldDescription": "The user to mute.",
    "durationFieldName": "duration",
    "durationFieldDescription": "How long the mute should last (e.g. 1h, 7d).",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the mute.",
    "title": "Muted",
    "desc": "**{{user}}** has been muted",
    "dmSent": "DM sent",
    "dmNotSent": "Couldn't DM"
  },
```

Replace the `unmute` block (lines 66-76) — drop `descWithReason`:

```json
  "unmute": {
    "commandName": "unmute",
    "commandDescription": "Unmute a user in the server.",
    "userFieldName": "user",
    "userFieldDescription": "The user to unmute.",
    "reasonFieldName": "reason",
    "reasonFieldDescription": "The reason for the unmute.",
    "title": "Unmuted",
    "desc": "**{{user}}** has been unmuted"
  },
```

Replace the `warn` block's rendering keys (currently lines 104-107) and extend (drop `descWithReason` and `warnedCount`):

```json
    "title": "Warned",
    "desc": "**{{user}}** has been warned",
    "descTwice": "**{{user}}** has been warned **twice**",
    "descThrice": "**{{user}}** has been warned **thrice**",
    "descTimes": "**{{user}}** has been warned **{{count}} times**",
    "punishment": "Punishment",
    "punishmentN": "Punishment {{n}}",
    "punishmentMuteFor": "Mute for {{duration}}",
    "punishmentBanFor": "Ban for {{duration}}",
    "punishmentAtLevel": "at warn level {{level}}",
    "punishmentWaiting": "Waiting for a moderator to confirm",
    "historyField": "Warn history",
    "historyCounts": "**{{active}}** active · **{{expired}}** expired · **{{total}}** total",
    "historyEntry": "#{{id}} — {{reason}} (expires {{expiry}})",
    "historyEntryNoExpiry": "#{{id}} — {{reason}}",
    "removedTitle": "Warn Removed",
    "removedDesc": "Warn #{{id}} removed.",
    "multiTitle_one": "Warned 1 user",
    "multiTitle_other": "Warned {{count}} users",
```

Add the shared `fields` object at the end of the `note` block, before `securitySettings`:

```json
  "fields": {
    "reason": "Reason",
    "duration": "Duration",
    "dm": "DM",
    "moderator": "Moderator",
    "users": "Users",
    "messagesDeleted": "Messages deleted",
    "noReason": "No reason",
    "never": "Never",
    "unknown": "Unknown",
    "note": "Note",
    "notesCount_one": "{{count}} note",
    "notesCount_other": "{{count}} notes"
  },
```

Replace the `note` block's `addedDesc` (line 340 equivalent):

```json
    "addedDesc": "Note added to **{{user}}**.",
```

Replace the `case` block's rendering keys (drop the `choices` sub-object idea — choice names stay English; they are action labels and `registerApplicationCommands` is synchronous, so choice names cannot be localized there):

```json
    "title": "Cases for {{user}}",
    "noCases": "No cases found for this user.",
    "page": "Page {{page}}/{{total}}",
    "empty": "This user has no moderation history.",
    "caseHeader": "Case #{{id}} — {{action}}",
    "fields": {
      "action": "Action",
      "moderator": "Moderator",
      "reason": "Reason",
      "dmStatus": "DM",
      "date": "Date",
      "notes": "Notes"
    }
```

- [ ] **Step 2: Update `src/languages/it/commands/moderation.json`**

Same structural changes, translated. Kick block:

```json
  "kick": {
    "commandName": "kick",
    "commandDescription": "Espelli un utente dal server.",
    "userFieldName": "utente",
    "userFieldDescription": "L'utente da espellere.",
    "reasonFieldName": "motivo",
    "reasonFieldDescription": "Il motivo dell'espulsione.",
    "title": "Espulso",
    "desc": "**{{user}}** è stato espulso",
    "dmSent": "DM inviato",
    "dmNotSent": "Non ho potuto contattarlo in DM"
  },
```

Ban block — drop `descWithReason` and `descTemp` (the old `descTemp` line is removed entirely):

```json
  "ban": {
    "commandName": "ban",
    "commandDescription": "Banna un utente dal server.",
    "userFieldName": "utente",
    "userFieldDescription": "L'utente da bannare.",
    "reasonFieldName": "motivo",
    "reasonFieldDescription": "Il motivo del ban.",
    "durationFieldName": "durata",
    "durationFieldDescription": "Per quanto tempo deve durare il ban (es. 7g).",
    "deleteMessagesFieldName": "elimina-messaggi",
    "deleteMessagesFieldDescription": "Elimina i messaggi recenti dell'utente.",
    "title": "Bannato",
    "desc": "**{{user}}** è stato bannato",
    "dmSent": "DM inviato",
    "dmNotSent": "Non ho potuto contattarlo in DM",
    "deleteMessagesNone": "Non eliminare nulla",
    "deleteMessages1h": "Ultima ora",
    "deleteMessages6h": "Ultime 6 ore",
    "deleteMessages24h": "Ultime 24 ore",
    "deleteMessages3d": "Ultimi 3 giorni",
    "deleteMessages7d": "Ultimi 7 giorni"
  },
```

Unban block — drop `descWithReason`:

```json
  "unban": {
    "commandName": "unban",
    "commandDescription": "Revoca il ban di un utente dal server.",
    "userIdFieldName": "id-utente",
    "userIdFieldDescription": "L'ID dell'utente a cui revocare il ban.",
    "reasonFieldName": "motivo",
    "reasonFieldDescription": "Il motivo della revoca.",
    "title": "Ban Revocato",
    "desc": "Il ban di **{{user}}** è stato revocato"
  },
```

Mute block — drop `descWithReason`:

```json
  "mute": {
    "commandName": "mute",
    "commandDescription": "Silenzia un utente nel server.",
    "userFieldName": "utente",
    "userFieldDescription": "L'utente da silenziare.",
    "durationFieldName": "durata",
    "durationFieldDescription": "Per quanto tempo silenziare (es. 1o, 7g).",
    "reasonFieldName": "motivo",
    "reasonFieldDescription": "Il motivo del mute.",
    "title": "Silenziato",
    "desc": "**{{user}}** è stato silenziato",
    "dmSent": "DM inviato",
    "dmNotSent": "Non ho potuto contattarlo in DM"
  },
```

Unmute block — drop `descWithReason`:

```json
  "unmute": {
    "commandName": "unmute",
    "commandDescription": "Rimuovi il mute di un utente nel server.",
    "userFieldName": "utente",
    "userFieldDescription": "L'utente a cui rimuovere il mute.",
    "reasonFieldName": "motivo",
    "reasonFieldDescription": "Il motivo della rimozione.",
    "title": "Mute Rimosso",
    "desc": "Il mute di **{{user}}** è stato rimosso"
  },
```

Warn block rendering keys:

```json
    "title": "Avvertito",
    "desc": "**{{user}}** è stato avvertito",
    "descTwice": "**{{user}}** è stato avvertito **due volte**",
    "descThrice": "**{{user}}** è stato avvertito **tre volte**",
    "descTimes": "**{{user}}** è stato avvertito **{{count}} volte**",
    "punishment": "Punizione",
    "punishmentN": "Punizione {{n}}",
    "punishmentMuteFor": "Mute per {{duration}}",
    "punishmentBanFor": "Ban per {{duration}}",
    "punishmentAtLevel": "al livello warn {{level}}",
    "punishmentWaiting": "In attesa della conferma di un moderatore",
    "historyField": "Storico warn",
    "historyCounts": "**{{active}}** attivi · **{{expired}}** scaduti · **{{total}}** totali",
    "historyEntry": "#{{id}} — {{reason}} (scade {{expiry}})",
    "historyEntryNoExpiry": "#{{id}} — {{reason}}",
    "removedTitle": "Warn Rimosso",
    "removedDesc": "Il warn #{{id}} è stato rimosso.",
    "multiTitle_one": "Avvertito 1 utente",
    "multiTitle_other": "Avvertiti {{count}} utenti",
```

Shared fields (after the `note` block):

```json
  "fields": {
    "reason": "Motivo",
    "duration": "Durata",
    "dm": "DM",
    "moderator": "Moderatore",
    "users": "Utenti",
    "messagesDeleted": "Messaggi eliminati",
    "noReason": "Nessun motivo",
    "never": "Mai",
    "unknown": "Sconosciuto",
    "note": "Nota",
    "notesCount_one": "{{count}} nota",
    "notesCount_other": "{{count}} note"
  },
```

Note block:

```json
    "addedDesc": "Nota aggiunta a **{{user}}**.",
```

Case block — add `caseHeader` and `choices`:

```json
    "title": "Casi per {{user}}",
    "noCases": "Nessun caso trovato per questo utente.",
    "page": "Pagina {{page}}/{{total}}",
    "empty": "Questo utente non ha una cronologia di moderazione.",
    "caseHeader": "Caso #{{id}} — {{action}}",
  },
```

- [ ] **Step 3: Update `src/languages/es-ES/commands/moderation.json`**

Kick block:

```json
  "kick": {
    "commandName": "kick",
    "commandDescription": "Expulsar a un usuario del servidor.",
    "userFieldName": "usuario",
    "userFieldDescription": "El usuario a expulsar.",
    "reasonFieldName": "razon",
    "reasonFieldDescription": "La razon de la expulsion.",
    "title": "Expulsado",
    "desc": "**{{user}}** ha sido expulsado",
    "dmSent": "DM enviado",
    "dmNotSent": "No pude contactarlo por DM"
  },
```

Ban block — drop `descWithReason` and `descTemp`:

```json
  "ban": {
    "commandName": "ban",
    "commandDescription": "Banear a un usuario del servidor.",
    "userFieldName": "usuario",
    "userFieldDescription": "El usuario a banear.",
    "reasonFieldName": "razon",
    "reasonFieldDescription": "La razon del ban.",
    "durationFieldName": "duracion",
    "durationFieldDescription": "Cuanto debe durar el ban (ej. 7d).",
    "deleteMessagesFieldName": "eliminar-mensajes",
    "deleteMessagesFieldDescription": "Eliminar mensajes recientes del usuario.",
    "title": "Baneado",
    "desc": "**{{user}}** ha sido baneado",
    "dmSent": "DM enviado",
    "dmNotSent": "No pude contactarlo por DM",
    "deleteMessagesNone": "No eliminar nada",
    "deleteMessages1h": "Ultima hora",
    "deleteMessages6h": "Ultimas 6 horas",
    "deleteMessages24h": "Ultimas 24 horas",
    "deleteMessages3d": "Ultimos 3 dias",
    "deleteMessages7d": "Ultimos 7 dias"
  },
```

Unban block — drop `descWithReason`:

```json
  "unban": {
    "commandName": "unban",
    "commandDescription": "Desbanear a un usuario del servidor.",
    "userIdFieldName": "id-usuario",
    "userIdFieldDescription": "El ID del usuario a desbanear.",
    "reasonFieldName": "razon",
    "reasonFieldDescription": "La razon del desbaneo.",
    "title": "Desbaneado",
    "desc": "**{{user}}** ha sido desbaneado"
  },
```

Mute block — drop `descWithReason`:

```json
  "mute": {
    "commandName": "mute",
    "commandDescription": "Silenciar a un usuario en el servidor.",
    "userFieldName": "usuario",
    "userFieldDescription": "El usuario a silenciar.",
    "durationFieldName": "duracion",
    "durationFieldDescription": "Cuanto debe durar el silencio (ej. 1h, 7d).",
    "reasonFieldName": "razon",
    "reasonFieldDescription": "La razon del silencio.",
    "title": "Silenciado",
    "desc": "**{{user}}** ha sido silenciado",
    "dmSent": "DM enviado",
    "dmNotSent": "No pude contactarlo por DM"
  },
```

Unmute block — drop `descWithReason`:

```json
  "unmute": {
    "commandName": "unmute",
    "commandDescription": "Quitar el silencio a un usuario en el servidor.",
    "userFieldName": "usuario",
    "userFieldDescription": "El usuario al que quitar el silencio.",
    "reasonFieldName": "razon",
    "reasonFieldDescription": "La razon de quitar el silencio.",
    "title": "Silencio Quitado",
    "desc": "El silencio de **{{user}}** ha sido quitado"
  },
```

Warn block rendering keys:

```json
    "title": "Advertido",
    "desc": "**{{user}}** ha sido advertido",
    "descTwice": "**{{user}}** ha sido advertido **dos veces**",
    "descThrice": "**{{user}}** ha sido advertido **tres veces**",
    "descTimes": "**{{user}}** ha sido advertido **{{count}} veces**",
    "punishment": "Sancion",
    "punishmentN": "Sancion {{n}}",
    "punishmentMuteFor": "Mute por {{duration}}",
    "punishmentBanFor": "Ban por {{duration}}",
    "punishmentAtLevel": "en el nivel de warn {{level}}",
    "punishmentWaiting": "Esperando la confirmacion de un moderador",
    "historyField": "Historial de warns",
    "historyCounts": "**{{active}}** activos · **{{expired}}** expirados · **{{total}}** totales",
    "historyEntry": "#{{id}} — {{reason}} (expira {{expiry}})",
    "historyEntryNoExpiry": "#{{id}} — {{reason}}",
    "removedTitle": "Advertencia Quitada",
    "removedDesc": "La advertencia #{{id}} ha sido quitada.",
    "multiTitle_one": "Advertido 1 usuario",
    "multiTitle_other": "Advertidos {{count}} usuarios",
```

Shared fields (after the `note` block):

```json
  "fields": {
    "reason": "Motivo",
    "duration": "Duracion",
    "dm": "DM",
    "moderator": "Moderador",
    "users": "Usuarios",
    "messagesDeleted": "Mensajes eliminados",
    "noReason": "Sin motivo",
    "never": "Nunca",
    "unknown": "Desconocido",
    "note": "Nota",
    "notesCount_one": "{{count}} nota",
    "notesCount_other": "{{count}} notas"
  },
```

Note block:

```json
    "addedDesc": "Nota agregada a **{{user}}**.",
```

Case block — add `caseHeader` and `choices`:

```json
    "title": "Casos para {{user}}",
    "noCases": "No se encontraron casos para este usuario.",
    "page": "Pagina {{page}}/{{total}}",
    "empty": "Este usuario no tiene historial de moderacion.",
    "caseHeader": "Caso #{{id}} — {{action}}",
  },
```

- [ ] **Step 4: Update `src/lib/i18n/commands/moderation.ts`**

In `Kick` (lines 5-21): remove `descWithReason` (lines 16-18), keep `desc: FT<{ user: string }>("commands/moderation:kick.desc")`.

In `Ban` (lines 22-55): remove `descWithReason` (lines 41-43) and `descTemp` (lines 44-46).

In `Unban` (lines 56-72): remove `descWithReason` (lines 69-71).

In `Mute` (lines 73-96): remove `descWithReason` (lines 90-92) and `durationTooLong` (line 95).

In `Unmute` (lines 97-111): remove `descWithReason` (lines 107-109).

Replace the `Warn` rendering keys (lines 157-162):

```ts
    title: T("commands/moderation:warn.title"),
    desc: FT<{ user: string }>("commands/moderation:warn.desc"),
    descTwice: FT<{ user: string }>("commands/moderation:warn.descTwice"),
    descThrice: FT<{ user: string }>("commands/moderation:warn.descThrice"),
    descTimes: FT<{ user: string; count: number }>(
      "commands/moderation:warn.descTimes",
    ),
    punishment: T("commands/moderation:warn.punishment"),
    punishmentN: FT<{ n: number }>("commands/moderation:warn.punishmentN"),
    punishmentMuteFor: FT<{ duration: string }>(
      "commands/moderation:warn.punishmentMuteFor",
    ),
    punishmentBanFor: FT<{ duration: string }>(
      "commands/moderation:warn.punishmentBanFor",
    ),
    punishmentAtLevel: FT<{ level: number }>(
      "commands/moderation:warn.punishmentAtLevel",
    ),
    punishmentWaiting: T("commands/moderation:warn.punishmentWaiting"),
    historyField: T("commands/moderation:warn.historyField"),
    historyCounts: FT<{ active: number; expired: number; total: number }>(
      "commands/moderation:warn.historyCounts",
    ),
    historyEntry: FT<{ id: string; reason: string; expiry: string }>(
      "commands/moderation:warn.historyEntry",
    ),
    historyEntryNoExpiry: FT<{ id: string; reason: string }>(
      "commands/moderation:warn.historyEntryNoExpiry",
    ),
    removedTitle: T("commands/moderation:warn.removedTitle"),
    removedDesc: FT<{ id: string }>("commands/moderation:warn.removedDesc"),
    multiTitle: FT<{ count: number }>(
      "commands/moderation:warn.multiTitle_other",
    ),
```

Add a top-level `Fields` export to the default object (after the `Note` block, before `SecuritySettings`):

```ts
  Fields: {
    reason: T("commands/moderation:fields.reason"),
    duration: T("commands/moderation:fields.duration"),
    dm: T("commands/moderation:fields.dm"),
    moderator: T("commands/moderation:fields.moderator"),
    users: T("commands/moderation:fields.users"),
    messagesDeleted: T("commands/moderation:fields.messagesDeleted"),
    noReason: T("commands/moderation:fields.noReason"),
    never: T("commands/moderation:fields.never"),
    unknown: T("commands/moderation:fields.unknown"),
    note: T("commands/moderation:fields.note"),
    notesCount: FT<{ count: number }>(
      "commands/moderation:fields.notesCount_other",
    ),
  },
```

In `Case` (lines 616-638): add after `empty`:

```ts
    caseHeader: FT<{ id: string; action: string }>(
      "commands/moderation:case.caseHeader",
    ),
```

- [ ] **Step 5: Verify**

Run: `bunx tsc --noEmit`
Expected: no new type errors (the `descTimes` FT uses `count`, `multiTitle` references the `_other` key which now exists).

Run: `bun test tests/moderation/action-embed.test.ts tests/moderation/warn-history.test.ts`
Expected: PASS.

Run: `bun run lint:fix`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/languages/en-US/commands/moderation.json src/languages/it/commands/moderation.json src/languages/es-ES/commands/moderation.json src/lib/i18n/commands/moderation.ts
git commit -m "feat(i18n): add mod embed restyle keys across locales"
```

---

### Task 4: Restyle `warnReply.ts` (warn / heavywarn / warns level set results)

**Files:**
- Modify: `src/lib/moderation/warnReply.ts`

**Interfaces:**
- Consumes: `userMention` (Task 1), `warnCountDescKey`/`punishmentLabel`/`warnHistoryFieldValue` (Task 1), `modActionService.getWarnHistory` (Task 2), `LanguageKeys.Commands.Moderation.{Warn,Fields,Kick}.*` (Task 3).
- Produces: `handleWarnResult(host, target, result, member)` with the same signature — used by warn.ts, warns.ts (level set), heavywarn.ts (Task 5).

- [ ] **Step 1: Rewrite `handleWarnResult`'s success path**

Replace the import block (lines 1-36) — add:

```ts
import { userMention } from "../helpers/stringUtils.js";
import {
  punishmentLabel,
  warnCountDescKey,
  warnHistoryFieldValue,
} from "./actionEmbed.js";
```

Replace everything from `const activeCount = ...` (line 74) through the final embed construction (line 101):

```ts
  const user = userMention(member.user);
  const desc = t(warnCountDescKey(result.warnCount), {
    user,
    count: result.warnCount,
  });

  const fields: Array<{
    name: string;
    value: string;
    inline: boolean;
  }> = [];

  if (result.case?.reason) {
    fields.push({
      name: t(LanguageKeys.Commands.Moderation.Fields.reason),
      value: result.case.reason,
      inline: false,
    });
  }

  let punishmentCount = 0;
  if (result.thresholdActions?.length) {
    for (const ta of result.thresholdActions) {
      const levelNote = ` (${t(
        LanguageKeys.Commands.Moderation.Warn.punishmentAtLevel,
        { level: ta.level.warnCount },
      )})`;
      if (ta.autoExecuted && ta.results) {
        for (const pr of ta.results) {
          punishmentCount++;
          const label = punishmentLabel(pr.punishment, t);
          fields.push({
            name:
              punishmentCount === 1
                ? t(LanguageKeys.Commands.Moderation.Warn.punishment)
                : t(LanguageKeys.Commands.Moderation.Warn.punishmentN, {
                    n: punishmentCount,
                  }),
            value: pr.success
              ? `${label} ✅${levelNote}`
              : `${label} ❌${levelNote}`,
            inline: false,
          });
        }
      } else if (ta.error) {
        for (const p of ta.level.punishments) {
          punishmentCount++;
          fields.push({
            name:
              punishmentCount === 1
                ? t(LanguageKeys.Commands.Moderation.Warn.punishment)
                : t(LanguageKeys.Commands.Moderation.Warn.punishmentN, {
                    n: punishmentCount,
                  }),
            value: `${punishmentLabel(p, t)} ❌${levelNote}`,
            inline: false,
          });
        }
      } else {
        const requested = await requestLevelConfirmation(
          target,
          ta.level,
          member,
          t,
        );
        punishmentCount++;
        fields.push({
          name:
            punishmentCount === 1
              ? t(LanguageKeys.Commands.Moderation.Warn.punishment)
              : t(LanguageKeys.Commands.Moderation.Warn.punishmentN, {
                  n: punishmentCount,
                }),
          value: requested
            ? `${ta.level.punishments
                .map((p) => punishmentLabel(p, t))
                .join(", ")} ⏳ ${t(
                LanguageKeys.Commands.Moderation.Warn.punishmentWaiting,
              )}${levelNote}`
            : `${ta.level.punishments
                .map((p) => punishmentLabel(p, t))
                .join(", ")} ❌${levelNote}`,
          inline: false,
        });
      }
    }
  }

  fields.push({
    name: t(LanguageKeys.Commands.Moderation.Fields.dm),
    value: result.dmSent
      ? t(LanguageKeys.Commands.Moderation.Kick.dmSent)
      : t(LanguageKeys.Commands.Moderation.Kick.dmNotSent),
    inline: true,
  });

  const history = await modActionService.getWarnHistory(
    target.guildId!,
    member.id,
  );
  fields.push({
    name: t(LanguageKeys.Commands.Moderation.Warn.historyField),
    value: warnHistoryFieldValue(history, t),
    inline: false,
  });

  const embed = new EmbedUtils.EmbedConstructor()
    .setColor(Colors.Success)
    .setTitle(t(LanguageKeys.Commands.Moderation.Warn.title))
    .setDescription(desc)
    .addFields(fields);
```

The rest of the function (quick actions row + reply) stays unchanged.

- [ ] **Step 2: Verify**

Run: `bunx tsc --noEmit` — Expected: no new errors.
Run: `bun test tests/moderation/action-embed.test.ts tests/moderation/warn-history.test.ts` — Expected: PASS.
Run: `bun run lint:fix` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/moderation/warnReply.ts
git commit -m "feat(mod): render warn results with title, fields and warn history"
```

---

### Task 5: Route heavywarn through `handleWarnResult`

**Files:**
- Modify: `src/commands/mod/heavywarn.ts`

**Interfaces:**
- Consumes: `handleWarnResult` (Task 4). Produces nothing downstream.

- [ ] **Step 1: Rewrite the success path of `chatInputRun`**

In `src/commands/mod/heavywarn.ts`, replace the block from `const result = await modActionService.warn(...)` (line 84) to the end of the method (line 103):

```ts
    const result = await modActionService.warn(guild, moderator, member, reason ?? undefined, 2);

    await handleWarnResult(this, interaction, result, member);
  }
```

Add the import next to the existing `handleWarnResult` usage import list (line 13 area):

```ts
import { handleWarnResult } from "../../lib/moderation/warnReply.js";
```

(If already present via another import, just use it.) Then remove the now-unused imports: `EmbedUtils`, `Colors`, `fetchT` is still used by the error path (line 76), keep it. `user` variable is still used for the member lookup — keep.

- [ ] **Step 2: Verify**

Run: `bunx tsc --noEmit` — Expected: no unused-import or missing-import errors.
Run: `bun run lint:fix` — Expected: clean (eslint catches unused imports).

- [ ] **Step 3: Commit**

```bash
git add src/commands/mod/heavywarn.ts
git commit -m "refactor(mod): reuse warn result rendering in heavywarn"
```

---

### Task 6: Restyle kick, mute, unmute

**Files:**
- Modify: `src/commands/mod/kick.ts`
- Modify: `src/commands/mod/mute.ts`

**Interfaces:**
- Consumes: `userMention` (Task 1), `LanguageKeys.Commands.Moderation.{Kick,Mute,Unmute,Fields}.*` (Task 3).

- [ ] **Step 1: Kick — replace the success embed block**

In `src/commands/mod/kick.ts`, add `userMention` to the import from `../../lib/helpers/stringUtils.js`:

```ts
import { userMention } from "../../lib/helpers/stringUtils.js";
```

Replace lines 117-126 (from `const mainText = ...` through the embed construction):

```ts
    const desc = t(LanguageKeys.Commands.Moderation.Kick.desc, {
      user: userMention(member.user),
    });

    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Success)
      .setTitle(t(LanguageKeys.Commands.Moderation.Kick.title))
      .setDescription(desc)
      .addFields(
        ...(reason
          ? [
              {
                name: t(LanguageKeys.Commands.Moderation.Fields.reason),
                value: reason,
                inline: false,
              },
            ]
          : []),
        {
          name: t(LanguageKeys.Commands.Moderation.Fields.dm),
          value: result.dmSent
            ? t(LanguageKeys.Commands.Moderation.Kick.dmSent)
            : t(LanguageKeys.Commands.Moderation.Kick.dmNotSent),
          inline: true,
        },
      );
```

- [ ] **Step 2: Mute — replace the `executeMute` embed block**

In `src/commands/mod/mute.ts`, add the import:

```ts
import { userMention } from "../../lib/helpers/stringUtils.js";
```

Replace lines 236-247 (from `const durationDisplay = ...` through the embed construction):

```ts
    const durationDisplay = this.formatMs(duration);
    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Success)
      .setTitle(t(LanguageKeys.Commands.Moderation.Mute.title))
      .setDescription(
        t(LanguageKeys.Commands.Moderation.Mute.desc, {
          user: userMention(member.user),
        }),
      )
      .addFields(
        {
          name: t(LanguageKeys.Commands.Moderation.Fields.duration),
          value: durationDisplay,
          inline: true,
        },
        ...(reason
          ? [
              {
                name: t(LanguageKeys.Commands.Moderation.Fields.reason),
                value: reason,
                inline: false,
              },
            ]
          : []),
        {
          name: t(LanguageKeys.Commands.Moderation.Fields.dm),
          value: result.dmSent
            ? t(LanguageKeys.Commands.Moderation.Mute.dmSent)
            : t(LanguageKeys.Commands.Moderation.Mute.dmNotSent),
          inline: true,
        },
      );
```

- [ ] **Step 3: Mute — replace the `executeUnmute` embed block**

Replace lines 293-299:

```ts
    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Success)
      .setTitle(t(LanguageKeys.Commands.Moderation.Unmute.title))
      .setDescription(
        t(LanguageKeys.Commands.Moderation.Unmute.desc, {
          user: userMention(member.user),
        }),
      )
      .addFields(
        ...(reason
          ? [
              {
                name: t(LanguageKeys.Commands.Moderation.Fields.reason),
                value: reason,
                inline: false,
              },
            ]
          : []),
      );
```

- [ ] **Step 4: Mute — localize the `messageRun` hardcoded strings**

Replace lines 187 and 198:

```ts
        await message.reply(t(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild));
```

and

```ts
        await message.reply(t(LanguageKeys.Commands.Moderation.Errors.durationTooLong));
```

(`fetchT` is already called at the top of `messageRun`? It is not — add `const t = await fetchT(message);` at the top of `messageRun` (line 179) and reuse it in both replacements. The existing `this.executeMute(message, ...)` path already fetches its own t.)

- [ ] **Step 5: Verify**

Run: `bunx tsc --noEmit` — Expected: no errors.
Run: `bun run lint:fix` — Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/commands/mod/kick.ts src/commands/mod/mute.ts
git commit -m "feat(mod): restyle kick and mute result embeds"
```

---

### Task 7: Restyle ban, unban (+ fix missing returns)

**Files:**
- Modify: `src/commands/mod/ban.ts`

**Interfaces:**
- Consumes: `userMention` (Task 1), `LanguageKeys.Commands.Moderation.{Ban,Unban,Fields}.*` (Task 3).

- [ ] **Step 1: Add imports and a delete-messages helper**

In `src/commands/mod/ban.ts`, add:

```ts
import { userMention } from "../../lib/helpers/stringUtils.js";
```

Add a private method to the class, placed right before `formatMs`:

```ts
  private deleteMessagesKey(
    seconds: 0 | 3600 | 21600 | 86400 | 259200 | 604800,
  ):
    | "deleteMessages1h"
    | "deleteMessages6h"
    | "deleteMessages24h"
    | "deleteMessages3d"
    | "deleteMessages7d"
    | null {
    if (seconds === 3600) return "deleteMessages1h";
    if (seconds === 21600) return "deleteMessages6h";
    if (seconds === 86400) return "deleteMessages24h";
    if (seconds === 259200) return "deleteMessages3d";
    if (seconds === 604800) return "deleteMessages7d";
    return null;
  }
```

- [ ] **Step 2: Fix the missing `return` in `executeBan`'s error path**

Replace lines 212-218:

```ts
    if (!result.success) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Error)
        .setDescription(t(LanguageKeys.Commands.Moderation.Errors.hierarchyTooLow));

      await this.reply(target, { embeds: [embed] }, { type: PomeloReplyType.Error });
      return;
    }
```

- [ ] **Step 3: Replace the `executeBan` success embed block**

Replace lines 220-232 (from `const desc = duration` through the embed construction):

```ts
    const deleteKey = deleteMessageSeconds
      ? this.deleteMessagesKey(deleteMessageSeconds)
      : null;

    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Success)
      .setTitle(t(LanguageKeys.Commands.Moderation.Ban.title))
      .setDescription(
        t(LanguageKeys.Commands.Moderation.Ban.desc, {
          user: userMention(user),
        }),
      )
      .addFields(
        ...(reason
          ? [
              {
                name: t(LanguageKeys.Commands.Moderation.Fields.reason),
                value: reason,
                inline: false,
              },
            ]
          : []),
        ...(duration
          ? [
              {
                name: t(LanguageKeys.Commands.Moderation.Fields.duration),
                value: this.formatMs(duration),
                inline: true,
              },
            ]
          : []),
        ...(deleteKey
          ? [
              {
                name: t(
                  LanguageKeys.Commands.Moderation.Fields.messagesDeleted,
                ),
                value: t(LanguageKeys.Commands.Moderation.Ban[deleteKey]),
                inline: true,
              },
            ]
          : []),
        {
          name: t(LanguageKeys.Commands.Moderation.Fields.dm),
          value: result.dmSent
            ? t(LanguageKeys.Commands.Moderation.Ban.dmSent)
            : t(LanguageKeys.Commands.Moderation.Ban.dmNotSent),
          inline: true,
        },
      );
```

- [ ] **Step 4: Fix the missing `return` and replace the `executeUnban` embed**

Replace lines 269-283:

```ts
    if (!result.success) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Error)
        .setDescription(t(LanguageKeys.Commands.Moderation.Errors.caseNotFound));

      await this.reply(target, { embeds: [embed] }, { type: PomeloReplyType.Error });
      return;
    }

    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Success)
      .setTitle(t(LanguageKeys.Commands.Moderation.Unban.title))
      .setDescription(
        t(LanguageKeys.Commands.Moderation.Unban.desc, {
          user: userMention({ id: userId, username: userId }),
        }),
      )
      .addFields(
        ...(reason
          ? [
              {
                name: t(LanguageKeys.Commands.Moderation.Fields.reason),
                value: reason,
                inline: false,
              },
            ]
          : []),
      );
```

- [ ] **Step 5: Localize the `messageRun` hardcoded string**

Replace line 182:

```ts
        await message.reply(t(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild));
```

(`fetchT` is not called at the top of `messageRun` — add `const t = await fetchT(message);` at line 171, before `const sub = ...`.)

- [ ] **Step 6: Verify**

Run: `bunx tsc --noEmit` — Expected: no errors. Two type adjustments accompany this task:
1. Widen the `executeBan` parameter type from `deleteMessageDays?: 0 | 86400 | 259200 | 604800` to `deleteMessageSeconds?: 0 | 3600 | 21600 | 86400 | 259200 | 604800` (the choice list includes 1h and 6h, which are valid `deleteMessageSeconds` values) and update the cast in `chatInputRun` (line 159) to `as 0 | 3600 | 21600 | 86400 | 259200 | 604800 | undefined`.
2. The `ModActionOptions.deleteMessageDays` field passed to `modActionService.ban` keeps its existing type — pass the narrowed value only when it fits (0 | 86400 | 259200 | 604800), else omit it; `executeBan` computes that when building the service call.

Run: `bun run lint:fix` — Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/commands/mod/ban.ts
git commit -m "feat(mod): restyle ban and unban result embeds"
```

---

### Task 8: Restyle warns, note, case (+ fix missing returns)

**Files:**
- Modify: `src/commands/mod/warns.ts`
- Modify: `src/commands/mod/note.ts`
- Modify: `src/commands/mod/case.ts`

**Interfaces:**
- Consumes: `userMention` (Task 1), `LanguageKeys.Commands.Moderation.{Warn,Note,Case,Fields}.*` (Task 3).

- [ ] **Step 1: warns — replace the `list` subcommand body**

In `src/commands/mod/warns.ts`, add the imports (extend the existing ones — `and`, `eq`, `desc` from drizzle-orm and `modCases` from the db schema):

```ts
import { desc, eq, and } from "drizzle-orm";
import { warns, modCases } from "../../db/schema.js";
import { userMention } from "../../lib/helpers/stringUtils.js";
```

The `warns` table has no `reason` column — the reason lives on the linked case, so the list query must join `modCases`. Replace the query (lines 148-152) and the rendering (lines 159-167):

```ts
      const activeWarns = await db
        .select({
          id: warns.id,
          reason: modCases.reason,
          expiresAt: warns.expiresAt,
        })
        .from(warns)
        .innerJoin(
          modCases,
          and(eq(warns.caseId, modCases.id), eq(warns.guildId, modCases.guildId)),
        )
        .where(
          and(
            eq(warns.guildId, interaction.guildId!),
            eq(warns.userId, user.id),
            eq(warns.revoked, false),
          ),
        )
        .orderBy(desc(warns.createdAt))
        .limit(20);

      if (activeWarns.length === 0) {
        const embed = new EmbedUtils.EmbedConstructor()
          .setTitle(
            t(LanguageKeys.Commands.Moderation.Warn.listTitle, {
              user: userMention(user),
            }),
          )
          .setColor(Colors.Info)
          .setDescription(t(LanguageKeys.Commands.Moderation.Warn.listEmpty));
        await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
        return;
      }

      const descLines: string[] = [];

      for (const w of activeWarns) {
        const expires = w.expiresAt
          ? `<t:${Math.floor(new Date(w.expiresAt).getTime() / 1000)}:R>`
          : t(LanguageKeys.Commands.Moderation.Fields.never);
        descLines.push(
          t(LanguageKeys.Commands.Moderation.Warn.listEntry, {
            id: String(w.id),
            reason:
              w.reason ||
              t(LanguageKeys.Commands.Moderation.Fields.noReason),
            expiry: expires,
          }),
        );
      }

      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(
          t(LanguageKeys.Commands.Moderation.Warn.listTitle, {
            user: userMention(user),
          }),
        )
        .setColor(Colors.Info)
        .setDescription(descLines.join("\n"));
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
```

Note: this also fixes the double-reply bug when the list is empty (the missing `return`).

- [ ] **Step 2: warns — replace the `remove` subcommand body**

Replace lines 175-184:

```ts
      if (!result.success) {
        const errText =
          result.error === "caseNotFound"
            ? t(LanguageKeys.Commands.Moderation.Errors.caseNotFound)
            : t(LanguageKeys.Commands.Moderation.Errors.warnAlreadyRevoked);
        const embed = new EmbedUtils.EmbedConstructor()
          .setColor(Colors.Error)
          .setDescription(errText);
        await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Error });
        return;
      }

      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Success)
        .setTitle(t(LanguageKeys.Commands.Moderation.Warn.removedTitle))
        .setDescription(
          t(LanguageKeys.Commands.Moderation.Warn.removedDesc, {
            id: String(caseId),
          }),
        )
        .addFields(
          ...(result.case?.reason
            ? [
                {
                  name: t(LanguageKeys.Commands.Moderation.Fields.reason),
                  value: result.case.reason,
                  inline: false,
                },
              ]
            : []),
          ...(result.case
            ? [
                {
                  name: t(LanguageKeys.Commands.Moderation.Fields.moderator),
                  value: `<@${result.case.moderatorId}>`,
                  inline: true,
                },
              ]
            : []),
        );
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
```

Note: this fixes the double-reply bug (missing `return` after the error reply).

- [ ] **Step 3: warns — replace the `multi` subcommand success embed**

Replace lines 197-210:

```ts
      let successCount = 0;
      const warned: string[] = [];
      const moderator = interaction.member instanceof GuildMember ? interaction.member : null;
      if (!moderator) return;

      for (const uid of userIds) {
        const member = interaction.guild?.members.cache.get(uid);
        if (!member) continue;
        if (!interaction.guild) continue;
        const result = await modActionService.warn(interaction.guild, moderator, member, reason ?? undefined, amount);
        if (result.success) {
          successCount++;
          warned.push(userMention(member.user));
        }
      }

      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Success)
        .setTitle(
          t(LanguageKeys.Commands.Moderation.Warn.multiTitle, {
            count: successCount,
          }),
        )
        .addFields(
          ...(warned.length > 0
            ? [
                {
                  name: t(LanguageKeys.Commands.Moderation.Fields.users),
                  value: warned.map((u) => `• ${u}`).join("\n"),
                  inline: false,
                },
              ]
            : []),
        );
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
```

Note: also add a `return` after the parse-error reply (line 192-195) to fix the double-reply bug there.

- [ ] **Step 4: note — replace add/list/remove embeds**

In `src/commands/mod/note.ts`, add the import:

```ts
import { userMention } from "../../lib/helpers/stringUtils.js";
```

Replace the `add` success embed (lines 131-135):

```ts
      const t = await fetchT(interaction);
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Success)
        .setTitle(t(LanguageKeys.Commands.Moderation.Note.addedTitle))
        .setDescription(
          t(LanguageKeys.Commands.Moderation.Note.addedDesc, {
            user: userMention(user),
          }),
        )
        .addFields({
          name: t(LanguageKeys.Commands.Moderation.Fields.note),
          value: note,
          inline: false,
        });
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
```

Replace the `list` embed (lines 157-177) — title with mention, `return` after the empty reply (fixes the double-reply bug), keep the per-note fields:

```ts
      if (userNotes.length === 0) {
        const embed = new EmbedUtils.EmbedConstructor()
          .setTitle(
            t(LanguageKeys.Commands.Moderation.Note.listTitle, {
              user: userMention(user),
            }),
          )
          .setColor(Colors.Info)
          .setDescription(t(LanguageKeys.Commands.Moderation.Note.listEmpty));
        await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
        return;
      }

      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(
          t(LanguageKeys.Commands.Moderation.Note.listTitle, {
            user: userMention(user),
          }),
        )
        .setColor(Colors.Info);

      for (const n of userNotes.slice(0, 10)) {
        const dateStr = n.createdAt
          ? `<t:${Math.floor(new Date(n.createdAt).getTime() / 1000)}:R>`
          : "";
        embed.addFields({
          name: `#${n.id} ${dateStr}`,
          value: `<@${n.moderatorId}>: ${n.reason}`,
          inline: false,
        });
      }

      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
```

Replace the `remove` embed (lines 186-200) — add `return` after the error reply (fixes the delete-despite-not-a-note bug) and add fields:

```ts
      const [existing] = await db.select().from(modCases).where(eq(modCases.id, caseId)).limit(1);
      if (!existing || existing.actionType !== "note") {
        const embed = new EmbedUtils.EmbedConstructor()
          .setColor(Colors.Error)
          .setDescription(t(LanguageKeys.Commands.Moderation.Errors.caseNotFound));
        await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Error });
        return;
      }

      await db.delete(caseNotes).where(eq(caseNotes.caseId, caseId));
      await db.delete(modCases).where(eq(modCases.id, caseId));

      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Success)
        .setTitle(t(LanguageKeys.Commands.Moderation.Note.removedTitle))
        .setDescription(
          t(LanguageKeys.Commands.Moderation.Note.removedDesc, {
            id: String(caseId),
          }),
        )
        .addFields(
          ...(existing.reason
            ? [
                {
                  name: t(LanguageKeys.Commands.Moderation.Fields.note),
                  value: existing.reason,
                  inline: false,
                },
              ]
            : []),
          {
            name: t(LanguageKeys.Commands.Moderation.Fields.moderator),
            value: `<@${existing.moderatorId}>`,
            inline: true,
          },
        );
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
```

- [ ] **Step 5: case — mention format, localized header/strings, localized choices**

In `src/commands/mod/case.ts`, add the import:

```ts
import { userMention } from "../../lib/helpers/stringUtils.js";
```

Change `chatInputRun` (line 86) and `messageRun` (line 91) to pass the `User` object:

```ts
    await this.showCases(interaction, user, actionType);
```

```ts
    await this.showCases(message, user, "all");
```

Change `showCases` signature and title usages:

```ts
  private async showCases(
    interaction: Command.ChatInputCommandInteraction | Message,
    user: import("discord.js").User,
    filterType: string,
  ) {
```

Replace the title calls (lines 108 and 133) with:

```ts
        .setTitle(t(LanguageKeys.Commands.Moderation.Case.title, { user: userMention(user) }))
```

Replace the case header + field value strings (lines 139-150):

```ts
        embed.addFields({
          name: t(LanguageKeys.Commands.Moderation.Case.caseHeader, {
            id: String(c.id),
            action: c.actionType.toUpperCase(),
          }),
          value: [
            `**${t(LanguageKeys.Commands.Moderation.Case.fields.moderator)}:** <@${c.moderatorId}>`,
            `**${t(LanguageKeys.Commands.Moderation.Case.fields.reason)}:** ${c.reason || t(LanguageKeys.Commands.Moderation.Fields.noReason)}`,
            `**${t(LanguageKeys.Commands.Moderation.Case.fields.dmStatus)}:** ${c.dmSent ? ":white_check_mark:" : ":x:"}`,
            `**${t(LanguageKeys.Commands.Moderation.Case.fields.date)}:** ${dateStr}`,
            `**${t(LanguageKeys.Commands.Moderation.Case.fields.notes)}:** ${t(LanguageKeys.Commands.Moderation.Fields.notesCount, { count: nCount })}`,
          ].join("\n"),
          inline: false,
        });
```

Replace the date fallback `"Unknown"` (line 139) with `t(LanguageKeys.Commands.Moderation.Fields.unknown)`.

Leave the `.addChoices` block (lines 66-76) unchanged — choice names are action labels (`Ban`, `Warn`, ...) that match the en-US names, and `registerApplicationCommands` is synchronous so they can't be localized there. `actionTypeAll` already localizes "All".

- [ ] **Step 6: Verify**

Run: `bunx tsc --noEmit` — Expected: no errors.
Run: `bun test` — Expected: full suite PASS (including Tasks 1-2 tests).
Run: `bun run lint:fix` — Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/commands/mod/warns.ts src/commands/mod/note.ts src/commands/mod/case.ts
git commit -m "feat(mod): restyle warns, note and case embeds"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run everything**

```bash
bun run lint:fix
bunx tsc --noEmit
bun test
```

Expected: lint clean, typecheck clean, all tests pass.

- [ ] **Step 2: Grep for leftovers**

```bash
rg "descWithReason|warnedCount|descTemp" src
```

Expected: no matches (the keys are removed everywhere).

```bash
rg "user\.tag|userTag" src/commands/mod
```

Expected: no matches.

```bash
rg "user\(s\)|warn\(s\)" src/languages src/commands/mod
```

Expected: no matches (no "(s)"-style hacks in mod UI).

- [ ] **Step 3: Manual Discord verification**

Per the pomelo-discord-feature-testing skill, in the Bot Testing server run: `/warn` (amount 1, 2, 3, 5), `/heavywarn`, `/warns list`, `/warns remove`, `/warns multi`, `/kick`, `/mute`, `/unmute`, `/ban` (temp + permanent + delete-messages), `/unban`, `/note add`, `/note list`, `/note remove`, `/case`. Verify: title present, `@mention (username)` format, fields layout, "twice/thrice/N times" phrasing, warn history field with counts + 3 lines, no double replies after error paths.

- [ ] **Step 4: Changelog + commit**

Add a changelog entry to `src/changelog.ts` (per AGENTS.md release-prep checklist), then commit any remaining changes:

```bash
git add -A
git commit -m "feat(mod): restyle moderation result embeds"
```
