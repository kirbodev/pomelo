# Multi-Punishment Warn Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each warn level apply multiple punishments, carry a per-level message appended to the warned user's DM, and offer customisable durations (editable mute ≤28d; ban permanent or temp).

**Architecture:** Replace the flat `WarnActionConfig[]` (one action per level) with a nested `WarnLevel[]` where each level holds `punishments: WarnPunishment[]` + an optional `message`. A `normalizeActions` helper converts legacy flat configs on read (no DB migration). The execution engine loops levels → punishments; the quickstart step-5 editor becomes a punishment list with per-row edit/remove and two modals (punishment details, level details).

**Tech Stack:** Sapphire 5, discord.js v14 (Components v2), Drizzle/libSQL, Bun runtime, `bun:test` for unit tests (NOT Jest — the repo's `package.json` says `jest` but the only existing test, `tests/redis.test.ts`, uses `bun:test`).

## Global Constraints

- **Test runner:** `bun test` with `import { test, expect } from "bun:test"`. Run a single file with `bun test tests/path/file.test.ts`. Pure unit tests only — no Redis/DB/discord.js mocks required for the lib functions; the Discord-interaction code is exercised manually against a live Discord guild (see Task 9).
- **Colors:** use `Colors.*` from `src/lib/colors.ts` — never hex literals.
- **Components v2:** new/edited wizard renderers use `ContainerBuilder` + `TextDisplayBuilder` + `ActionRowBuilder` with `MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral`.
- **i18n:** every new user-facing string gets a `LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.*` key, added to **all three** locale files (`en-US`, `it`, `es-ES`) and to `src/lib/i18n/commands/moderation.ts`. Run every English string through the humanizer skill before translating.
- **No comments** in code unless requested. kebab-case files. `.js` extensions on relative imports. `private` keyword for private fields.
- **Button emoji rule:** emoji-only where the icon is self-explanatory (edit `✏️`, remove `🗑️`); text-only otherwise (add, back, cancel, confirm, save). Never both label and emoji on one button.
- **No DB migration.** The `warn_settings.actions` column stays `text` JSON; only its shape changes.
- **Commit cadence:** commit after each task. The repo commits features directly to `main`; follow that. End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `src/lib/moderation/types.ts` | `WarnPunishment`, `WarnLevel`, `PunishResult`, `LevelExecResult`, updated `WarnActionResult`. Pure types. | Modify |
| `src/lib/moderation/migration.ts` | `normalizeActions(raw): WarnLevel[]` (legacy conversion) + `sanitizeLevelMessage(text): string` (strip mass-pings/role mentions, cap 1000). Pure functions. | Create |
| `tests/moderation/migration.test.ts` | Unit tests for `normalizeActions` + `sanitizeLevelMessage`. | Create |
| `src/lib/moderation/presets.ts` | Four presets rewritten as `WarnLevel[]`. | Modify |
| `src/lib/moderation/actions.ts` | Level-based threshold loop; public `executeLevel` + private `executePunishment`; `tryWarnDm` with per-level messages; gate DM on `dmOnWarn`. | Modify |
| `src/lib/moderation/quickstartWizard.ts` | Step-5 punishment-list editor; `showPunishmentModal` + `showLevelDetailsModal`; emoji buttons; `WarnLevel[]` state. | Modify |
| `src/commands/mod/warn.ts` | `handleWarnResult` renders per-punishment results; presents `autoConfirm: false` confirmation via `ButtonConfirmationConstructor`; calls `executeLevel` on confirm. | Modify |
| `src/commands/mod/warnSettings.ts` | View + actions renderers read `WarnLevel[]` via `normalizeActions`; multi-punishment summary. | Modify |
| `src/lib/i18n/commands/moderation.ts` | New `Quickstart` keys. | Modify |
| `src/languages/en-US/commands/moderation.json` | New strings (humanized). | Modify |
| `src/languages/it/commands/moderation.json` | New strings (humanized + translated). | Modify |
| `src/languages/es-ES/commands/moderation.json` | New strings (humanized + translated). | Modify |
| `src/lib/emojis.ts` | Add `Edit = "✏️"`, `Trash = "🗑️"` Unicode glyphs. | Modify |

**Decomposition rationale:** `migration.ts` is split out so the pure conversion/sanitization logic is unit-testable in isolation and `types.ts` stays pure types. The wizard is one file (it already is) — splitting it would scatter the step state machine.

---

### Task 1: Types — replace `WarnActionConfig` with `WarnLevel` + `WarnPunishment`

**Files:**
- Modify: `src/lib/moderation/types.ts` (whole file — replace `WarnActionConfig`, update `WarnActionResult`)

**Interfaces:**
- Produces: `WarnPunishmentType`, `WarnPunishment`, `WarnLevel`, `PunishResult`, `LevelExecResult`, and an updated `WarnActionResult` (signatures below). Later tasks import these from `./types.js`.
- Removes: `WarnActionConfig` (all references replaced across later tasks).

- [ ] **Step 1: Replace the types file**

Overwrite `src/lib/moderation/types.ts` with:

```ts
import type { ModCase } from "../../db/schema.js";

export type ActionType = "ban" | "unban" | "kick" | "mute" | "unmute" | "warn" | "unwarn" | "note";

export type WarnPunishmentType = "mute" | "kick" | "ban" | "role";

export type WarnPunishment = {
  type: WarnPunishmentType;
  duration?: number;
  roleId?: string;
  deleteMessageDays?: 0 | 86400 | 259200 | 604800;
};

export type WarnLevel = {
  warnCount: number;
  punishments: WarnPunishment[];
  message?: string;
  autoConfirm: boolean;
};

export type RoleApplyConfig = Record<string, string>;

export type ModActionResult = {
  success: boolean;
  case: ModCase | null;
  dmSent: boolean;
  error?: string;
};

export type PunishResult = {
  punishment: WarnPunishment;
  success: boolean;
  error?: string;
};

export type LevelExecResult = {
  level: WarnLevel;
  results: PunishResult[];
};

export type WarnActionResult = ModActionResult & {
  warnCount: number;
  thresholdActions?: Array<{
    level: WarnLevel;
    autoExecuted: boolean;
    results?: PunishResult[];
    error?: string;
  }>;
};

export type ModActionOptions = {
  reason?: string;
  duration?: number;
  deleteMessageDays?: 0 | 86400 | 259200 | 604800;
};
```

- [ ] **Step 2: Verify it typechecks**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "types.ts|Cannot find module" | head`
Expected: errors in OTHER files that still reference `WarnActionConfig` (presets.ts, actions.ts, quickstartWizard.ts, warnSettings.ts) — that's expected; those are fixed in later tasks. No errors inside `types.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/lib/moderation/types.ts
git commit -m "refactor(mod): replace WarnActionConfig with WarnLevel + WarnPunishment types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `migration.ts` — `normalizeActions` + `sanitizeLevelMessage` (TDD)

**Files:**
- Create: `src/lib/moderation/migration.ts`
- Create: `tests/moderation/migration.test.ts`

**Interfaces:**
- Produces: `normalizeActions(raw: string | null | undefined): WarnLevel[]` and `sanitizeLevelMessage(text: string): string`. Consumed by actions.ts, warnSettings.ts, quickstartWizard.ts.
- Consumes: `WarnLevel`, `WarnPunishment` from `./types.js` (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `tests/moderation/migration.test.ts`:

```ts
import { test, expect } from "bun:test";
import { normalizeActions, sanitizeLevelMessage } from "../../src/lib/moderation/migration.js";

test("normalizeActions returns [] for null/undefined/empty", () => {
  expect(normalizeActions(null)).toEqual([]);
  expect(normalizeActions(undefined)).toEqual([]);
  expect(normalizeActions("")).toEqual([]);
  expect(normalizeActions("[]")).toEqual([]);
});

test("normalizeActions returns [] for malformed JSON", () => {
  expect(normalizeActions("{not json")).toEqual([]);
  expect(normalizeActions("'a'")).toEqual([]);
});

test("normalizeActions passes through new WarnLevel[] shape", () => {
  const input = JSON.stringify([
    { warnCount: 2, punishments: [{ type: "mute", duration: 3600000 }], autoConfirm: true },
  ]);
  expect(normalizeActions(input)).toEqual([
    { warnCount: 2, punishments: [{ type: "mute", duration: 3600000 }], autoConfirm: true },
  ]);
});

test("normalizeActions converts a legacy flat mute action", () => {
  const legacy = JSON.stringify([
    { warnCount: 3, actionType: "mute", duration: 3600000, autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 3, punishments: [{ type: "mute", duration: 3600000 }], autoConfirm: true },
  ]);
});

test("normalizeActions converts a legacy flat ban action (temp)", () => {
  const legacy = JSON.stringify([
    { warnCount: 6, actionType: "ban", duration: 604800000, autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 6, punishments: [{ type: "ban", duration: 604800000 }], autoConfirm: true },
  ]);
});

test("normalizeActions converts a legacy permanent ban (no duration)", () => {
  const legacy = JSON.stringify([
    { warnCount: 7, actionType: "ban", autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 7, punishments: [{ type: "ban" }], autoConfirm: true },
  ]);
});

test("normalizeActions converts actionType none to empty punishments", () => {
  const legacy = JSON.stringify([
    { warnCount: 1, actionType: "none", autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 1, punishments: [], autoConfirm: true },
  ]);
});

test("normalizeActions converts a role action carrying roleId", () => {
  const legacy = JSON.stringify([
    { warnCount: 2, actionType: "role", roleId: "123", autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 2, punishments: [{ type: "role", roleId: "123" }], autoConfirm: true },
  ]);
});

test("normalizeActions drops the message actionType entirely", () => {
  const legacy = JSON.stringify([
    { warnCount: 3, actionType: "message", message: "hi", autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    { warnCount: 3, punishments: [], autoConfirm: true },
  ]);
});

test("normalizeActions merges flat entries sharing a warnCount", () => {
  const legacy = JSON.stringify([
    { warnCount: 3, actionType: "mute", duration: 3600000, autoConfirm: true },
    { warnCount: 3, actionType: "role", roleId: "9", autoConfirm: true },
  ]);
  expect(normalizeActions(legacy)).toEqual([
    {
      warnCount: 3,
      punishments: [
        { type: "mute", duration: 3600000 },
        { type: "role", roleId: "9" },
      ],
      autoConfirm: true,
    },
  ]);
});

test("normalizeActions sorts levels ascending by warnCount and dedupes", () => {
  const legacy = JSON.stringify([
    { warnCount: 5, actionType: "kick", autoConfirm: true },
    { warnCount: 2, actionType: "mute", duration: 1000, autoConfirm: true },
  ]);
  const out = normalizeActions(legacy);
  expect(out.map((l) => l.warnCount)).toEqual([2, 5]);
});

test("sanitizeLevelMessage strips @everyone and @here", () => {
  expect(sanitizeLevelMessage("hey @everyone @here yo")).toBe("hey everyone here yo");
});

test("sanitizeLevelMessage strips role mentions", () => {
  expect(sanitizeLevelMessage("warn <@&123> please")).toBe("warn please");
});

test("sanitizeLevelMessage keeps user mentions", () => {
  expect(sanitizeLevelMessage("hi <@123> and <@!456>")).toBe("hi <@123> and <@!456>");
});

test("sanitizeLevelMessage caps at 1000 chars", () => {
  const long = "x".repeat(2000);
  expect(sanitizeLevelMessage(long).length).toBe(1000);
});

test("sanitizeLevelMessage trims and returns empty for whitespace", () => {
  expect(sanitizeLevelMessage("   ")).toBe("");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/moderation/migration.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/moderation/migration.js'` (file doesn't exist yet).

- [ ] **Step 3: Implement `migration.ts`**

Create `src/lib/moderation/migration.ts`:

```ts
import type { WarnLevel, WarnPunishment, WarnPunishmentType } from "./types.js";

const MAX_LEVEL_MESSAGE = 1000;

type LegacyAction = {
  warnCount: number;
  actionType: "none" | "mute" | "kick" | "ban" | "role" | "message";
  duration?: number;
  roleId?: string;
  autoConfirm: boolean;
};

const isLegacy = (entry: unknown): entry is LegacyAction => {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.warnCount === "number" &&
    typeof e.actionType === "string" &&
    typeof e.autoConfirm === "boolean"
  );
};

const isNewLevel = (entry: unknown): entry is WarnLevel => {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return typeof e.warnCount === "number" && Array.isArray(e.punishments);
};

const legacyToPunishment = (a: LegacyAction): WarnPunishment | null => {
  switch (a.actionType) {
    case "mute":
      return { type: "mute", duration: a.duration };
    case "kick":
      return { type: "kick" };
    case "ban":
      return { type: "ban", duration: a.duration };
    case "role":
      return { type: "role", roleId: a.roleId };
    case "none":
    case "message":
    default:
      return null;
  }
};

export function normalizeActions(raw: string | null | undefined): WarnLevel[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const byCount = new Map<number, WarnLevel>();
  for (const entry of parsed) {
    if (isNewLevel(entry)) {
      const existing = byCount.get(entry.warnCount);
      if (existing) {
        existing.punishments.push(...entry.punishments);
        if (entry.message && !existing.message) existing.message = entry.message;
      } else {
        byCount.set(entry.warnCount, {
          warnCount: entry.warnCount,
          punishments: [...entry.punishments],
          message: entry.message,
          autoConfirm: entry.autoConfirm,
        });
      }
      continue;
    }
    if (isLegacy(entry)) {
      const punishment = legacyToPunishment(entry);
      const existing = byCount.get(entry.warnCount);
      if (existing) {
        if (punishment) existing.punishments.push(punishment);
      } else {
        byCount.set(entry.warnCount, {
          warnCount: entry.warnCount,
          punishments: punishment ? [punishment] : [],
          autoConfirm: entry.autoConfirm,
        });
      }
    }
  }

  return [...byCount.values()].sort((a, b) => a.warnCount - b.warnCount);
}

export function sanitizeLevelMessage(text: string): string {
  const stripped = text
    .replace(/@everyone/gi, "everyone")
    .replace(/@here/gi, "here")
    .replace(/<@&\d+>/g, "")
    .trim();
  return stripped.slice(0, MAX_LEVEL_MESSAGE);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/moderation/migration.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/moderation/migration.ts tests/moderation/migration.test.ts
git commit -m "feat(mod): add normalizeActions + sanitizeLevelMessage helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rewrite presets as `WarnLevel[]`

**Files:**
- Modify: `src/lib/moderation/presets.ts` (whole file)

**Interfaces:**
- Produces: `PRESETS: Record<string, WarnPreset>` where `WarnPreset.levels: WarnLevel[]`. Consumed by quickstartWizard.ts (Task 6) and warnSettings.ts (Task 8).
- Consumes: `WarnLevel` from `./types.js` (Task 1).

- [ ] **Step 1: Overwrite `src/lib/moderation/presets.ts`**

```ts
import type { WarnLevel } from "./types.js";

export type WarnPreset = {
  name: string;
  defaultExpiryDays: number;
  levels: WarnLevel[];
};

export const PRESETS: Record<string, WarnPreset> = {
  lemomeme: {
    name: "Lemomeme",
    defaultExpiryDays: 7,
    levels: [
      { warnCount: 1, punishments: [{ type: "role", roleId: "" }], autoConfirm: true },
      { warnCount: 2, punishments: [{ type: "role", roleId: "" }], autoConfirm: true },
      { warnCount: 3, punishments: [{ type: "ban" }], autoConfirm: true },
    ],
  },
  recommended: {
    name: "Recommended",
    defaultExpiryDays: 30,
    levels: [
      { warnCount: 2, punishments: [{ type: "mute", duration: 3600000 }], autoConfirm: true },
      { warnCount: 3, punishments: [{ type: "mute", duration: 43200000 }], autoConfirm: true },
      { warnCount: 4, punishments: [{ type: "mute", duration: 259200000 }], autoConfirm: true },
      { warnCount: 5, punishments: [{ type: "mute", duration: 604800000 }], autoConfirm: true },
      { warnCount: 6, punishments: [{ type: "ban", duration: 604800000 }], autoConfirm: true },
      { warnCount: 7, punishments: [{ type: "ban" }], autoConfirm: true },
    ],
  },
  progressive: {
    name: "Progressive",
    defaultExpiryDays: 14,
    levels: [
      { warnCount: 2, punishments: [{ type: "mute", duration: 86400000 }], autoConfirm: true },
      { warnCount: 3, punishments: [{ type: "mute", duration: 604800000 }], autoConfirm: true },
      { warnCount: 4, punishments: [{ type: "kick" }], autoConfirm: true },
      { warnCount: 5, punishments: [{ type: "ban" }], autoConfirm: true },
    ],
  },
  strictStrike: {
    name: "Strict Strike",
    defaultExpiryDays: 90,
    levels: [
      { warnCount: 2, punishments: [{ type: "mute", duration: 259200000 }], autoConfirm: true },
      { warnCount: 3, punishments: [{ type: "mute", duration: 604800000 }], autoConfirm: true },
      { warnCount: 4, punishments: [{ type: "ban", duration: 1209600000 }], autoConfirm: true },
      { warnCount: 5, punishments: [{ type: "ban" }], autoConfirm: true },
    ],
  },
};
```

- [ ] **Step 2: Verify it typechecks**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "presets.ts"`
Expected: no errors in `presets.ts` (errors remain in actions.ts / quickstartWizard.ts / warnSettings.ts — fixed later).

- [ ] **Step 3: Commit**

```bash
git add src/lib/moderation/presets.ts
git commit -m "refactor(mod): rewrite presets as WarnLevel[]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Execution engine — level loop, `executeLevel`, `tryWarnDm`

**Files:**
- Modify: `src/lib/moderation/actions.ts` — imports, `tryDm`→`tryWarnDm`, `warn()`, `setWarnLevel()`, replace `executeThresholdAction` with `executeLevel` + `executePunishment`.

**Interfaces:**
- Produces: public `executeLevel(guild, moderator, target, level, reason?): Promise<LevelExecResult>` (called by warn.ts on manual confirm, Task 7). Private `executePunishment`. `tryWarnDm(target, guildName, reason, amount, levelMessages)`.
- Consumes: `normalizeActions` + `sanitizeLevelMessage` from `./migration.js` (Task 2); `WarnLevel`, `WarnPunishment`, `PunishResult`, `LevelExecResult`, `WarnActionResult` from `./types.js` (Task 1).

- [ ] **Step 1: Update imports**

At the top of `src/lib/moderation/actions.ts`, replace the `./types.js` import block and add the migration import. Change:

```ts
import {
  type ModActionResult,
  type WarnActionResult,
  type ActionType,
  type WarnActionConfig,
  type ModActionOptions,
} from "./types.js";
```

to:

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
} from "./types.js";
import { normalizeActions, sanitizeLevelMessage } from "./migration.js";
```

- [ ] **Step 2: Replace `tryDm` usage for warns with `tryWarnDm`**

Add a new private method to `ModActionService` (keep the existing `tryDm` for kick/ban/mute; warns use the new one). Insert after the existing `tryDm` method:

```ts
private async tryWarnDm(
  target: User,
  guildName: string,
  reason: string | undefined,
  amount: number,
  levelMessages: string[],
): Promise<boolean> {
  try {
    const lines: string[] = [`You've been **warned** in **${guildName}**.`];
    if (reason) lines.push(`**Reason:** ${reason} (warn level: ${amount})`);
    if (levelMessages.length > 0) lines.push("", ...levelMessages);
    const base = lines.join("\n");
    if (base.length <= 2000) {
      await target.send(base);
      return true;
    }
    await target.send(base.slice(0, 2000));
    const overflow = levelMessages.join("\n").slice(Math.max(0, 2000 - base.length));
    if (overflow.trim()) await target.send(overflow.slice(0, 2000));
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Rewrite the `warn()` method's threshold + DM section**

In `warn()`, replace everything from the `const dmSent = await this.tryDm(...)` line through the end of the threshold `try/catch` block with:

```ts
    const settings = await this.getWarnSettings(guild.id);
    const expiryDays = customExpiryDays ?? settings?.defaultExpiryDays ?? 3;
    const expiryMs = expiryDays * 86400000;

    const caseEntry = await this.logCase(guild.id, target.id, moderator.id, "warn", reason || "", false);

    for (let i = 0; i < amount; i++) {
      const expiresAt = expiryDays ? new Date(Date.now() + (i + 1) * expiryMs) : null;
      await db.insert(warns).values({
        caseId: caseEntry.id,
        guildId: guild.id,
        userId: target.id,
        moderatorId: moderator.id,
        warnCount: i + 1,
        expiresAt: expiresAt,
      });
    }

    const levels = normalizeActions(settings?.actions);
    const postCount = preCount + amount;
    const crossed = levels.filter((l) => l.warnCount > preCount && l.warnCount <= postCount);
    const levelMessages = crossed
      .map((l) => {
        const msg = l.message ? sanitizeLevelMessage(l.message) : "";
        return msg ? `⚠️ Level ${l.warnCount}: ${msg}` : "";
      })
      .filter(Boolean);

    const dmSent = settings?.dmOnWarn !== false
      ? await this.tryWarnDm(target.user, guild.name, reason, amount, levelMessages)
      : false;

    const thresholdActions: WarnActionResult["thresholdActions"] = [];
    for (const level of crossed) {
      if (level.punishments.length === 0) continue;
      if (level.autoConfirm) {
        const result = await this.executeLevel(guild, moderator, target, level, reason);
        thresholdActions.push({ level, autoExecuted: true, results: result.results });
      } else {
        thresholdActions.push({ level, autoExecuted: false });
      }
    }

    return {
      success: true,
      case: caseEntry,
      dmSent,
      warnCount: amount,
      thresholdActions: thresholdActions.length > 0 ? thresholdActions : undefined,
    };
```

Note: this removes the old `JSON.parse(settings.actions)` try/catch — `normalizeActions` handles malformed JSON internally. The `preCount` variable is already computed above this block (keep that line).

- [ ] **Step 4: Rewrite the `setWarnLevel()` threshold section**

In `setWarnLevel()`, replace the threshold `try/catch` block (from `const thresholdActions` through the end of the `try/catch`) with:

```ts
    const thresholdActions: WarnActionResult["thresholdActions"] = [];
    if (settings?.actions) {
      const levels = normalizeActions(settings.actions);
      const postCount = preCount + level;
      const crossed = levels.filter((l) => l.warnCount > preCount && l.warnCount <= postCount);
      for (const lvl of crossed) {
        if (lvl.punishments.length === 0) continue;
        if (lvl.autoConfirm) {
          const result = await this.executeLevel(guild, moderator, target, lvl, reason);
          thresholdActions.push({ level: lvl, autoExecuted: true, results: result.results });
        } else {
          thresholdActions.push({ level: lvl, autoExecuted: false });
        }
      }
    }
```

`setWarnLevel` keeps `dmSent: false` (no DM — it's a direct mod tool).

- [ ] **Step 5: Replace `executeThresholdAction` with `executeLevel` + `executePunishment`**

Delete the existing `private async executeThresholdAction(...)` method and add these two methods (note `executeLevel` is **public**):

```ts
async executeLevel(
  guild: Guild,
  moderator: GuildMember,
  target: GuildMember,
  level: WarnLevel,
  reason?: string,
): Promise<LevelExecResult> {
  const results: PunishResult[] = [];
  for (const punishment of level.punishments) {
    try {
      await this.executePunishment(guild, moderator, target, punishment, reason);
      results.push({ punishment, success: true });
    } catch (err) {
      results.push({ punishment, success: false, error: String(err) });
    }
  }
  return { level, results };
}

private async executePunishment(
  guild: Guild,
  moderator: GuildMember,
  target: GuildMember,
  punishment: WarnPunishment,
  reason?: string,
): Promise<void> {
  switch (punishment.type) {
    case "ban":
      await this.ban(guild, moderator, target, reason, {
        duration: punishment.duration,
        deleteMessageDays: punishment.deleteMessageDays,
      });
      break;
    case "kick":
      await this.kick(guild, moderator, target, reason);
      break;
    case "mute":
      if (!punishment.duration) throw new Error("durationTooLong");
      await this.mute(guild, moderator, target, punishment.duration, reason);
      break;
    case "role":
      if (punishment.roleId) {
        const role = guild.roles.cache.get(punishment.roleId);
        if (role) await target.roles.add(role, reason);
      }
      break;
  }
}
```

- [ ] **Step 6: Verify it typechecks**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "actions.ts"`
Expected: no errors in `actions.ts`. (Errors remain in quickstartWizard.ts, warn.ts, warnSettings.ts — fixed in Tasks 6–8.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/moderation/actions.ts
git commit -m "feat(mod): level-based threshold execution + per-level DM messages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: i18n keys + emojis (all three locales, humanized)

**Files:**
- Modify: `src/lib/i18n/commands/moderation.ts` (add keys under `Quickstart`)
- Modify: `src/languages/en-US/commands/moderation.json`
- Modify: `src/languages/it/commands/moderation.json`
- Modify: `src/languages/es-ES/commands/moderation.json`
- Modify: `src/lib/emojis.ts` (add `Edit`, `Trash`)

**Interfaces:**
- Produces: new `LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.*` keys (listed below) + `Emojis.Edit` / `Emojis.Trash`. Consumed by quickstartWizard.ts (Task 6) and warn.ts (Task 7).

**Humanizer note:** The English strings below are drafts. Before adding them, run each through the humanizer skill. Then translate the humanized English to `it` and `es-ES` and humanize those too. The JSON values shown are the humanized English targets; the implementer writes the humanized `it` / `es-ES` equivalents.

- [ ] **Step 1: Add emoji glyphs to `src/lib/emojis.ts`**

Inside the `Emojis` enum, add (alphabetical-ish placement is fine):

```ts
  Edit = "✏️",
  Trash = "🗑️",
```

- [ ] **Step 2: Add keys to `src/lib/i18n/commands/moderation.ts`**

Inside the `Quickstart: { ... }` object (after `actionMessageDesc`), add:

```ts
      punishments: T("commands/moderation:warnSettings.quickstart.punishments"),
      addPunishment: T("commands/moderation:warnSettings.quickstart.addPunishment"),
      editPunishment: T("commands/moderation:warnSettings.quickstart.editPunishment"),
      removePunishment: T("commands/moderation:warnSettings.quickstart.removePunishment"),
      levelDetails: T("commands/moderation:warnSettings.quickstart.levelDetails"),
      levelMessage: T("commands/moderation:warnSettings.quickstart.levelMessage"),
      levelMessagePlaceholder: T("commands/moderation:warnSettings.quickstart.levelMessagePlaceholder"),
      durationOptional: T("commands/moderation:warnSettings.quickstart.durationOptional"),
      durationPermanent: T("commands/moderation:warnSettings.quickstart.durationPermanent"),
      maxPunishments: T("commands/moderation:warnSettings.quickstart.maxPunishments"),
      confirmLevelTitle: FT<{ level: number }>("commands/moderation:warnSettings.quickstart.confirmLevelTitle"),
      confirmLevelDesc: FT<{ punishments: string }>("commands/moderation:warnSettings.quickstart.confirmLevelDesc"),
      confirmLevelConfirm: T("commands/moderation:warnSettings.quickstart.confirmLevelConfirm"),
      confirmLevelCancel: T("commands/moderation:warnSettings.quickstart.confirmLevelCancel"),
      confirmLevelDeclined: T("commands/moderation:warnSettings.quickstart.confirmLevelDeclined"),
      confirmLevelTimeout: T("commands/moderation:warnSettings.quickstart.confirmLevelTimeout"),
      punishmentMute: T("commands/moderation:warnSettings.quickstart.punishmentMute"),
      punishmentKick: T("commands/moderation:warnSettings.quickstart.punishmentKick"),
      punishmentBan: T("commands/moderation:warnSettings.quickstart.punishmentBan"),
      punishmentBanPerm: T("commands/moderation:warnSettings.quickstart.punishmentBanPerm"),
      punishmentRole: T("commands/moderation:warnSettings.quickstart.punishmentRole"),
```

- [ ] **Step 3: Add strings to `src/languages/en-US/commands/moderation.json`**

Inside the `"quickstart": { ... }` object (after `"actionMessageDesc": "I'll send a custom message."`), add (these are the humanized English targets):

```json
      "punishments": "Punishments",
      "addPunishment": "Add punishment",
      "editPunishment": "Edit punishment",
      "removePunishment": "Remove",
      "levelDetails": "Edit level details",
      "levelMessage": "Level message",
      "levelMessagePlaceholder": "Shown to the user in their warn DM when they hit this level.",
      "durationOptional": "Duration (leave blank for permanent)",
      "durationPermanent": "Permanent",
      "maxPunishments": "A level can have up to 4 punishments.",
      "confirmLevelTitle": "Level {{level}} reached",
      "confirmLevelDesc": "Punishments ready to apply: {{punishments}}",
      "confirmLevelConfirm": "Apply punishments",
      "confirmLevelCancel": "Skip",
      "confirmLevelDeclined": "I skipped the punishment for that level.",
      "confirmLevelTimeout": "You took too long, so I skipped the punishment for that level.",
      "punishmentMute": "Mute",
      "punishmentKick": "Kick",
      "punishmentBan": "Ban",
      "punishmentBanPerm": "Permanent ban",
      "punishmentRole": "Role",
```

- [ ] **Step 4: Add the same keys (translated + humanized) to `it` and `es-ES`**

In `src/languages/it/commands/moderation.json` and `src/languages/es-ES/commands/moderation.json`, add the same keys inside `"quickstart"` with humanized translations. Example Italian targets (humanize again before finalizing):

```json
      "punishments": "Punizioni",
      "addPunishment": "Aggiungi punizione",
      "editPunishment": "Modifica punizione",
      "removePunishment": "Rimuovi",
      "levelDetails": "Modifica dettagli livello",
      "levelMessage": "Messaggio del livello",
      "levelMessagePlaceholder": "Mostrato all'utente nel DM di warn quando raggiunge questo livello.",
      "durationOptional": "Durata (vuoto per permanente)",
      "durationPermanent": "Permanente",
      "maxPunishments": "Un livello può avere fino a 4 punizioni.",
      "confirmLevelTitle": "Livello {{level}} raggiunto",
      "confirmLevelDesc": "Punizioni pronte da applicare: {{punishments}}",
      "confirmLevelConfirm": "Applica punizioni",
      "confirmLevelCancel": "Salta",
      "confirmLevelDeclined": "Ho saltato la punizione per quel livello.",
      "confirmLevelTimeout": "Ci hai messo troppo, ho saltato la punizione per quel livello.",
      "punishmentMute": "Mute",
      "punishmentKick": "Kick",
      "punishmentBan": "Ban",
      "punishmentBanPerm": "Ban permanente",
      "punishmentRole": "Ruolo",
```

- [ ] **Step 5: Verify the JSON parses and keys resolve**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "moderation.ts|moderation.json" | head`
Expected: no errors. (If `LanguageKeys` typing complains, the JSON key names must match the `T(...)` paths exactly.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/emojis.ts src/lib/i18n/commands/moderation.ts src/languages/en-US/commands/moderation.json src/languages/it/commands/moderation.json src/languages/es-ES/commands/moderation.json
git commit -m "i18n(mod): add multi-punishment warn level strings + edit/trash emojis

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Quickstart wizard — step-5 punishment-list editor + modals

**Files:**
- Modify: `src/lib/moderation/quickstartWizard.ts` — imports, `QuickstartConfig.levels` type, `ACTION_TYPE_LABEL_KEYS`, step-4 add-level, step-5 handlers + render, `formatLevelSummary`, replace `showDetailsModal`/`handleModalSubmit` with `showPunishmentModal` + `showLevelDetailsModal`, preset-detection in `renderPresetSelection`.

**Interfaces:**
- Produces: a step-5 editor that edits `WarnLevel.punishments[]` + `WarnLevel.message` + `WarnLevel.autoConfirm` in wizard state. Saves `WarnLevel[]` JSON to `warn_settings.actions` (unchanged save method).
- Consumes: `WarnLevel`, `WarnPunishment`, `WarnPunishmentType` from `./types.js` (Task 1); `sanitizeLevelMessage` from `./migration.js` (Task 2); `PRESETS` from `./presets.js` (Task 3); new i18n keys + `Emojis.Edit`/`Emojis.Trash` (Task 5).

**Cap constant:** `MAX_PUNISHMENTS_PER_LEVEL = 4` (module-level const near the top).

- [ ] **Step 1: Update imports + config type**

In `src/lib/moderation/quickstartWizard.ts`:

Change the `./types.js` import:
```ts
import type { WarnActionConfig } from "./types.js";
```
to:
```ts
import type { WarnLevel, WarnPunishment, WarnPunishmentType } from "./types.js";
```

Add after the `./presets.js` import:
```ts
import { sanitizeLevelMessage } from "./migration.js";
import { Emojis } from "../emojis.js";
```

Change `QuickstartConfig`:
```ts
export type QuickstartConfig = {
  defaultExpiryDays: number;
  dmOnWarn: boolean;
  logChannelId?: string;
  levels: WarnLevel[];
};
```

Add a module-level constant after `wizardStates`:
```ts
const MAX_PUNISHMENTS_PER_LEVEL = 4;
```

Delete the `ACTION_TYPE_LABEL_KEYS` const entirely (replaced by `punishmentSummary` in step 5.7).

- [ ] **Step 2: Add a `punishmentSummary` helper + rewrite `formatLevelSummary`**

Add this private method (replaces the old `formatLevelSummary`). It renders one level's punishments comma-joined, then the auto/manual marker:

```ts
private punishmentLabel(p: WarnPunishment, t: TFunction): string {
  switch (p.type) {
    case "mute":
      return `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentMute)} (${this.formatDurationShort(p.duration ?? 0)})`;
    case "kick":
      return t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentKick);
    case "ban":
      return p.duration
        ? `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBan)} (${this.formatDurationShort(p.duration)})`
        : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBanPerm);
    case "role":
      return p.roleId
        ? `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole)} → <@&${p.roleId}>`
        : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole);
  }
}

private formatDurationShort(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days}d` : `${hours}h`;
}

private formatLevelSummary(level: WarnLevel, t: TFunction): string {
  if (level.punishments.length === 0) {
    return t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.none);
  }
  const parts = level.punishments.map((p) => this.punishmentLabel(p, t));
  parts.push(
    level.autoConfirm
      ? `⚡ ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.auto)}`
      : `⚠️ ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.manual)}`,
  );
  return parts.join(", ");
}
```

- [ ] **Step 3: Update step-4 add-level + the step-4 select options**

In `handleComponentInteraction`, step-4 `addWarnLevel` branch, replace the push:

```ts
      } else if (customId === "addWarnLevel") {
        state.config.levels.push({
          warnCount: state.config.levels.length + 1,
          punishments: [],
          autoConfirm: true,
        });
        state.currentLevelIndex = state.config.levels.length - 1;
        state.step = 5;
        this.setState(state);
        await this.editAndRender(interaction, 5);
```

In `renderWarnLevelsEditor`, the `selectOptions` map currently reads `ACTION_TYPE_LABEL_KEYS[level.actionType]`. Replace the `description` line to use the new summary:

```ts
      const selectOptions = state.config.levels.slice(0, 25).map((level, index) => {
        return {
          label: t(
            LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.levelNSummary,
            { level: index + 1 },
          ),
          description: this.formatLevelSummary(level, t).slice(0, 100),
          value: String(index),
        };
      });
```

- [ ] **Step 4: Rewrite step-5 component handlers**

In `handleComponentInteraction`, replace the entire `if (state.step === 5) { ... }` block with:

```ts
    if (state.step === 5) {
      if (customId === "addPunishment") {
        if (!interaction.isStringSelectMenu()) return;
        if (state.currentLevelIndex === undefined) return;
        const level = state.config.levels[state.currentLevelIndex];
        if (level.punishments.length >= MAX_PUNISHMENTS_PER_LEVEL) return;
        const type = interaction.values[0] as WarnPunishmentType;
        const newPunishment: WarnPunishment =
          type === "mute" ? { type, duration: 3600000 }
          : type === "ban" ? { type }
          : type === "role" ? { type, roleId: "" }
          : { type };
        level.punishments.push(newPunishment);
        this.setState(state);
        await this.showPunishmentModal(interaction, level.punishments.length - 1);
      } else if (customId.startsWith("editPunishment:")) {
        const idx = parseInt(customId.split(":")[1] ?? "", 10);
        if (state.currentLevelIndex === undefined || !Number.isFinite(idx)) return;
        await this.showPunishmentModal(interaction, idx);
      } else if (customId.startsWith("removePunishment:")) {
        const idx = parseInt(customId.split(":")[1] ?? "", 10);
        if (state.currentLevelIndex === undefined || !Number.isFinite(idx)) return;
        state.config.levels[state.currentLevelIndex].punishments.splice(idx, 1);
        this.setState(state);
        await this.editAndRender(interaction, 5);
      } else if (customId === "editLevelDetails") {
        await this.showLevelDetailsModal(interaction);
      } else if (customId === "removeCurrentLevel") {
        if (state.currentLevelIndex !== undefined) {
          state.config.levels.splice(state.currentLevelIndex, 1);
          for (let i = 0; i < state.config.levels.length; i++) {
            state.config.levels[i].warnCount = i + 1;
          }
          state.currentLevelIndex = undefined;
          state.step = 4;
          this.setState(state);
          await this.editAndRender(interaction, 4);
        }
      } else if (customId === "cancelEdit") {
        state.step = 4;
        state.currentLevelIndex = undefined;
        this.setState(state);
        await this.editAndRender(interaction, 4);
      }
      return;
    }
```

- [ ] **Step 5: Rewrite `renderEditWarnLevel` (step 5 view)**

Replace the whole `renderEditWarnLevel` method with:

```ts
private renderEditWarnLevel(t: TFunction): RenderResult {
  const state = this.getState();
  if (!state || state.currentLevelIndex === undefined) {
    throw new Error("Quickstart state missing currentLevelIndex in step 5");
  }
  const level = state.config.levels[state.currentLevelIndex];

  const container = new ContainerBuilder()
    .setAccentColor(Colors.Info)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t(
          LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.editWarnLevelTitle,
          { level: state.currentLevelIndex + 1 },
        )}`,
      ),
      new TextDisplayBuilder().setContent(
        `**${t(
          LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.levelNSummary,
          { level: state.currentLevelIndex + 1 },
        )}** — ${this.formatLevelSummary(level, t)}`,
      ),
    );

  const rows: (
    | ActionRowBuilder<ButtonBuilder>
    | ActionRowBuilder<StringSelectMenuBuilder>
  )[] = [];

  if (level.punishments.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `*${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.none)}*`,
      ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishments)}`,
      ),
    );
    for (let i = 0; i < level.punishments.length; i++) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `• ${this.punishmentLabel(level.punishments[i], t)}`,
        ),
      );
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`editPunishment:${i}`)
            .setEmoji(Emojis.Edit)
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`removePunishment:${i}`)
            .setEmoji(Emojis.Trash)
            .setStyle(ButtonStyle.Danger),
        ),
      );
    }
  }

  const atCap = level.punishments.length >= MAX_PUNISHMENTS_PER_LEVEL;
  const addSelect = new StringSelectMenuBuilder()
    .setCustomId("addPunishment")
    .setPlaceholder(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.addPunishment))
    .setDisabled(atCap)
    .addOptions(
      { label: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentMute), value: "mute" },
      { label: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentKick), value: "kick" },
      { label: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBan), value: "ban" },
      { label: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole), value: "role" },
    );
  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(addSelect));

  if (atCap) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.maxPunishments),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("editLevelDetails")
        .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.levelDetails))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("removeCurrentLevel")
        .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.remove))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("cancelEdit")
        .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.cancel))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    components: [container, ...rows],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}
```

- [ ] **Step 6: Replace `showDetailsModal` + `handleModalSubmit` with `showPunishmentModal` + `showLevelDetailsModal`**

Delete the existing `showDetailsModal` and `handleModalSubmit` methods. Add these two:

```ts
private async showPunishmentModal(
  interaction: MessageComponentInteraction,
  punishmentIndex: number,
): Promise<void> {
  const state = this.getState();
  if (!state || state.currentLevelIndex === undefined) return;
  const level = state.config.levels[state.currentLevelIndex];
  const punishment = level.punishments[punishmentIndex];
  if (!punishment) return;
  const t = await fetchT(interaction);

  const modal = new ModalBuilder()
    .setCustomId(state.modalCustomId)
    .setTitle(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.editPunishment));

  if (punishment.type === "mute") {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("duration")
          .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.duration))
          .setPlaceholder(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.durationPlaceholder))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(this.formatDurationShort(punishment.duration ?? 3600000)),
      ),
    );
  } else if (punishment.type === "ban") {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("duration")
          .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.durationOptional))
          .setPlaceholder("7d")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(punishment.duration ? this.formatDurationShort(punishment.duration) : ""),
      ),
    );
  } else if (punishment.type === "role") {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("role")
          .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.role))
          .setPlaceholder(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.rolePlaceholder))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(punishment.roleId ?? ""),
      ),
    );
  } else {
    // kick: nothing to edit — save directly and re-render.
    state.step = 5;
    this.setState(state);
    await interaction.update({ components: (await this.renderStep(5)).components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return;
  }

  await interaction.showModal(modal);
  const modalInteraction = await interaction
    .awaitModalSubmit({
      time: 600000,
      filter: (i) => i.customId === state.modalCustomId && i.user.id === interaction.user.id,
    })
    .catch(() => null);

  if (!modalInteraction) return;

  if (punishment.type === "mute") {
    const duration = modActionService.parseDuration(modalInteraction.fields.getTextInputValue("duration"));
    if (!duration || duration > 2419200000) {
      await modalInteraction.reply({
        content: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.invalidDuration),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    punishment.duration = duration;
  } else if (punishment.type === "ban") {
    const raw = modalInteraction.fields.getTextInputValue("duration").trim();
    if (raw) {
      const duration = modActionService.parseDuration(raw);
      if (!duration) {
        await modalInteraction.reply({
          content: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.invalidDuration),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      punishment.duration = duration;
    } else {
      delete punishment.duration;
    }
  } else if (punishment.type === "role") {
    punishment.roleId = modalInteraction.fields.getTextInputValue("role").replace(/[<@&>]/g, "");
  }

  this.setState(state);
  await modalInteraction.deferUpdate();
  const { components, flags } = await this.renderStep(5);
  await modalInteraction.editReply({ components, flags });
}

private async showLevelDetailsModal(interaction: MessageComponentInteraction): Promise<void> {
  const state = this.getState();
  if (!state || state.currentLevelIndex === undefined) return;
  const level = state.config.levels[state.currentLevelIndex];
  const t = await fetchT(interaction);

  const modal = new ModalBuilder()
    .setCustomId(state.modalCustomId)
    .setTitle(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.levelDetails))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("message")
          .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.levelMessage))
          .setPlaceholder(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.levelMessagePlaceholder))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setValue(level.message ?? ""),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("autoExecute")
          .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.autoExecute))
          .setValue(level.autoConfirm ? "yes" : "no")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );

  await interaction.showModal(modal);
  const modalInteraction = await interaction
    .awaitModalSubmit({
      time: 600000,
      filter: (i) => i.customId === state.modalCustomId && i.user.id === interaction.user.id,
    })
    .catch(() => null);

  if (!modalInteraction) return;

  const auto = modalInteraction.fields.getTextInputValue("autoExecute").toLowerCase();
  if (auto !== "yes" && auto !== "no" && auto !== "si" && auto !== "sí") {
    await modalInteraction.reply({
      content: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.invalidAutoExecute),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  level.autoConfirm = auto === "yes" || auto === "si" || auto === "sí";

  const rawMessage = modalInteraction.fields.getTextInputValue("message").trim();
  level.message = rawMessage ? sanitizeLevelMessage(rawMessage) : undefined;

  this.setState(state);
  await modalInteraction.deferUpdate();
  const { components, flags } = await this.renderStep(5);
  await modalInteraction.editReply({ components, flags });
}
```

- [ ] **Step 7: Fix preset detection in `renderPresetSelection`**

The existing detection compares `JSON.stringify(p.levels)` to `state.config.levels`. Since both are now `WarnLevel[]`, the comparison still works, but `state.config.levels` may carry `undefined` `message` fields that presets don't. Replace the `selectedPreset` computation:

```ts
    const selectedPreset = state.config.levels.length
      ? Object.entries(PRESETS).find(
          ([, p]) =>
            JSON.stringify(p.levels) ===
            JSON.stringify(
              state.config.levels.map((l) => ({
                warnCount: l.warnCount,
                punishments: l.punishments,
                autoConfirm: l.autoConfirm,
              })),
            ),
        )?.[0]
      : undefined;
```

This ignores the `message` field when matching, so a preset with an added per-level message still detects as its base preset.

- [ ] **Step 8: Verify it typechecks**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "quickstartWizard.ts"`
Expected: no errors. (Errors remain in warn.ts and warnSettings.ts — Tasks 7–8.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/moderation/quickstartWizard.ts
git commit -m "feat(mod): step-5 multi-punishment editor + per-level message modal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `warn.ts` — render per-punishment results + manual confirmation

**Files:**
- Modify: `src/commands/mod/warn.ts` — imports, `handleWarnResult`.

**Interfaces:**
- Produces: `handleWarnResult` renders each crossed level's per-punishment outcome, and for `autoConfirm: false` levels presents a `ButtonConfirmationConstructor` dialog and calls `modActionService.executeLevel(...)` on confirm.
- Consumes: `WarnLevel`, `WarnPunishment`, `PunishResult` from `../../lib/moderation/types.js` (Task 1); `modActionService.executeLevel` (Task 4); `ButtonConfirmationConstructor` from `../../utilities/componentUtils.js`; new i18n keys (Task 5).

- [ ] **Step 1: Update imports**

In `src/commands/mod/warn.ts`, add to the discord.js import:

```ts
  ContainerBuilder,
  TextDisplayBuilder,
  ButtonStyle,
  ComponentType,
```

Add imports:

```ts
import { ComponentUtils } from "../../utilities/componentUtils.js";
import { container } from "@sapphire/framework";
import type { WarnLevel, PunishResult } from "../../lib/moderation/types.js";
```

Also ensure `TFunction` is imported from `@sapphire/plugin-i18next` (add to the existing `fetchT` import line).

- [ ] **Step 2: Add a punishment-result label helper**

Add this private method to `WarnCommand`:

```ts
private punishmentResultLine(p: PunishResult, t: TFunction): string {
  const typeLabel = p.punishment.type === "mute"
    ? t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentMute)
    : p.punishment.type === "kick"
      ? t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentKick)
      : p.punishment.type === "ban"
        ? p.punishment.duration
          ? t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBan)
          : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBanPerm)
        : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole);
  const status = p.success ? "✅" : "❌";
  return `${status} ${typeLabel}${p.error ? ` (${p.error})` : ""}`;
}
```

(`TFunction` is imported from `@sapphire/plugin-i18next` — add it to the existing import if not present.)

- [ ] **Step 3: Rewrite `handleWarnResult`**

Replace the whole `handleWarnResult` method with:

```ts
private async handleWarnResult(
  target: Command.ChatInputCommandInteraction | Message,
  result: WarnActionResult,
  member: GuildMember,
) {
  const t = await fetchT(target);
  if (!result.success) {
    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Error)
      .setDescription(t(LanguageKeys.Commands.Moderation.Errors.hierarchyTooLow));
    await this.reply(target, { embeds: [embed] }, { type: PomeloReplyType.Error });
    return;
  }

  const activeCount = await modActionService.getActiveWarnCount(target.guildId!, member.id);
  const lines: string[] = [
    t(LanguageKeys.Commands.Moderation.Warn.desc, { user: member.user.tag, amount: String(result.warnCount) }),
    `User now has ${activeCount} active warn(s).`,
  ];

  if (result.thresholdActions?.length) {
    for (const ta of result.thresholdActions) {
      if (ta.autoExecuted && ta.results) {
        for (const pr of ta.results) {
          lines.push(`Level ${ta.level.warnCount}: ${this.punishmentResultLine(pr, t)}`);
        }
      } else if (ta.error) {
        lines.push(`❌ Level ${ta.level.warnCount}: ${ta.error}`);
      } else {
        // autoConfirm: false — present confirmation, then execute on confirm
        const executed = await this.confirmAndExecuteLevel(target, ta.level, member, t);
        for (const pr of executed) {
          lines.push(`Level ${ta.level.warnCount}: ${this.punishmentResultLine(pr, t)}`);
        }
      }
    }
  }

  const embed = new EmbedUtils.EmbedConstructor()
    .setColor(Colors.Success)
    .setDescription(lines.join("\n"));
  await this.reply(target, { embeds: [embed] }, { type: PomeloReplyType.Success });
}

private async confirmAndExecuteLevel(
  target: Command.ChatInputCommandInteraction | Message,
  level: WarnLevel,
  member: GuildMember,
  t: TFunction,
): Promise<PunishResult[]> {
  const punishmentsSummary = level.punishments
    .map((p) => {
      if (p.type === "mute") return t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentMute);
      if (p.type === "ban") return p.duration
        ? t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBan)
        : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBanPerm);
      if (p.type === "kick") return t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentKick);
      return t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole);
    })
    .join(", ");

  const channel = target.channel;
  if (!channel) return [];
  if (!("awaitMessageComponent" in channel)) return [];

  const confirmation = new ComponentUtils.ButtonConfirmationConstructor({
    buttons: {
      confirm: { text: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.confirmLevelConfirm), style: ButtonStyle.Success },
      cancel: { text: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.confirmLevelCancel), style: ButtonStyle.Secondary },
    },
  });

  const container = new ContainerBuilder()
    .setAccentColor(Colors.Warning)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.confirmLevelTitle, { level: level.warnCount })}\n${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.confirmLevelDesc, { punishments: punishmentsSummary })}`,
      ),
    );

  const sent = await channel.send({
    components: [container, confirmation],
    flags: MessageFlags.IsComponentsV2,
  });

  const button = await sent
    .awaitMessageComponent({
      filter: (i) =>
        i.user.id === (target instanceof Message ? target.author.id : target.user.id),
      time: 1000 * 60 * 10,
      componentType: ComponentType.Button,
    })
    .catch(() => null);

  await container.utilities.componentUtils.disableButtons(sent).catch(() => null);

  if (!button) {
    await channel.send(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.confirmLevelTimeout)).catch(() => null);
    return [];
  }
  await button.deferUpdate().catch(() => null);

  if (button.component?.style !== ButtonStyle.Success) {
    await button
      .followUp({
        content: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.confirmLevelDeclined),
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => null);
    return [];
  }

  const moderator = target instanceof Message
    ? (target.member instanceof GuildMember ? target.member : null)
    : (target.member instanceof GuildMember ? target.member : null);
  const guild = target.guild;
  if (!moderator || !guild) return [];
  const exec = await modActionService.executeLevel(guild, moderator, member, level);
  return exec.results;
}
```

**Notes for the implementer:**
- `ComponentType` must be added to the discord.js import in Step 1.
- `ButtonConfirmationConstructor` extends `ActionRowBuilder<ButtonBuilder>`, so it can be passed directly as a component row alongside the `ContainerBuilder`. Its confirm/cancel button customIds are nanoid-generated internally; we distinguish confirm vs cancel by `ButtonStyle.Success` (confirm) vs `ButtonStyle.Secondary` (cancel), which matches the options we pass.
- The 10-minute timeout matches the spec. On timeout we send the `confirmLevelTimeout` message (error shown on timeout, per the Brand Book rule for confirmation dialogs). On cancel we send an ephemeral `confirmLevelDeclined`.
- `target.channel` exists on both `Message` and `ChatInputCommandInteraction`; the `"awaitMessageComponent" in channel` guard narrows to a text-based channel. If the union typing fights you, cast `channel as any` for the `.send`/`awaitMessageComponent` calls only, with a one-line justification comment.

- [ ] **Step 4: Verify it typechecks**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "warn.ts"`
Expected: no errors. If the `channel` union typing rejects `.send`/`awaitMessageComponent`, apply the documented `channel as any` cast with a one-line justification comment and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/commands/mod/warn.ts
git commit -m "feat(mod): per-punishment result rendering + manual level confirmation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `warnSettings.ts` — view + actions renderers read `WarnLevel[]`

**Files:**
- Modify: `src/commands/mod/warnSettings.ts` — replace `parseActions` + `actionTypeLabelKey` usage with `normalizeActions`; render multi-punishment summaries in `showView` and `showActions`.

**Interfaces:**
- Consumes: `normalizeActions` from `../../lib/moderation/migration.js` (Task 2); `WarnLevel` from `../../lib/moderation/types.js` (Task 1).

- [ ] **Step 1: Replace the `parseActions` helper and `actionTypeLabelKey`**

At the top of `src/commands/mod/warnSettings.ts`, delete the `parseActions` function and the `actionTypeLabelKey` function. Add imports:

```ts
import { normalizeActions } from "../../lib/moderation/migration.js";
import type { WarnLevel, WarnPunishment } from "../../lib/moderation/types.js";
```

Add a shared summary helper (module-level, replacing both deleted helpers):

```ts
const formatDurationHours = (ms: number): string => {
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days}d` : `${hours}h`;
};

const punishmentLine = (p: WarnPunishment, t: TFunction): string => {
  switch (p.type) {
    case "mute":
      return `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentMute)} (${formatDurationHours(p.duration ?? 0)})`;
    case "kick":
      return t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentKick);
    case "ban":
      return p.duration
        ? `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBan)} (${formatDurationHours(p.duration)})`
        : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBanPerm);
    case "role":
      return p.roleId
        ? `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole)} → <@&${p.roleId}>`
        : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole);
  }
};

const levelLine = (level: WarnLevel, t: TFunction): string => {
  const punishments = level.punishments.length
    ? level.punishments.map((p) => punishmentLine(p, t)).join(", ")
    : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.none);
  return t(LanguageKeys.Commands.Moderation.WarnSettings.actionsListLine, {
    count: String(level.warnCount),
    action: punishments,
    duration: "",
  });
};
```

Add `TFunction` to the `@sapphire/plugin-i18next` import.

- [ ] **Step 2: Update `showView` and `showActions` to use `normalizeActions` + `levelLine`**

In `showView`, replace:
```ts
    const actions = parseActions(settings.actions);
    const actionsLine =
      actions.length > 0
        ? actions
            .map((a) => { ... })
            .join("\n")
        : t(LanguageKeys.Commands.Moderation.WarnSettings.noActions);
```
with:
```ts
    const levels = normalizeActions(settings.actions);
    const actionsLine =
      levels.length > 0
        ? levels.map((l) => levelLine(l, t)).join("\n")
        : t(LanguageKeys.Commands.Moderation.WarnSettings.noActions);
```

In `showActions`, replace:
```ts
    const actions = parseActions(settings?.actions);
```
with:
```ts
    const levels = normalizeActions(settings?.actions);
```
and replace the `actions.map((a) => { ... })` block with:
```ts
      const lines = levels.map((l) => levelLine(l, t));
```
(keep the surrounding `if (levels.length === 0) { ... } else { ... }` structure, just swap `actions` → `levels`).

- [ ] **Step 3: Verify it typechecks**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "warnSettings.ts"`
Expected: no errors. This should clear the last remaining `WarnActionConfig` references.

- [ ] **Step 4: Full typecheck**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | head`
Expected: no errors referencing the moderation files. (Unrelated pre-existing errors, if any, are out of scope.)

- [ ] **Step 5: Commit**

```bash
git add src/commands/mod/warnSettings.ts
git commit -m "feat(mod): warn settings view renders multi-punishment levels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Lint, full test suite, and manual verification

**Files:**
- No new files. Verifies the whole change.

- [ ] **Step 1: Run the unit tests**

Run: `bun test tests/moderation/migration.test.ts`
Expected: all `normalizeActions` + `sanitizeLevelMessage` tests PASS.

- [ ] **Step 2: Lint the touched files**

Run: `bunx eslint src/lib/moderation/types.ts src/lib/moderation/migration.ts src/lib/moderation/presets.ts src/lib/moderation/actions.ts src/lib/moderation/quickstartWizard.ts src/commands/mod/warn.ts src/commands/mod/warnSettings.ts src/lib/emojis.ts src/lib/i18n/commands/moderation.ts --fix`
Expected: no errors after auto-fix. Commit any formatting changes the fix applies:

```bash
git add -A && git commit -m "style(mod): lint multi-punishment warn level files

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" || true
```

- [ ] **Step 3: Manual verification against a live Discord guild**

This is a Discord bot — verification happens against a live Discord guild via the running bot. Steps:

1. Build and start the bot: `bun run build && bun run start` (uses `.env.local`).
2. In a test guild where you have `ManageGuild`, run `/warn settings quickstart`.
3. **Step 5 editor:** add a mute (edit duration to `2h`), add a role, add a ban set to permanent, add a kick. Confirm each shows with `✏️`/`🗑️` buttons. Confirm the 4th punishment disables the add select and shows the cap message.
4. **Level details modal:** set a per-level message with `@everyone` and a role mention `<@&id>`; on save confirm the stored value has them stripped (re-open the modal to verify). Set autoExecute to `no`.
5. Save the configuration. Run `/warn settings` and confirm the view lists all punishments per level, permanent ban reads "Permanent ban".
6. **DM message:** warn a test user to cross the level. Confirm the user's DM contains `⚠️ Level N: <message>` and that `@everyone`/role mentions were stripped. Confirm the mod success embed lists each punishment with ✅/❌.
7. **Manual confirm:** with the `autoConfirm: false` level, warn a user across it. Confirm the confirm/skip buttons appear; click Apply → punishments run; click Skip → declined message shows.
8. **`dmOnWarn: false`:** toggle it off in general options, save, warn across a level with a message. Confirm no DM is sent.
9. **Legacy load:** if any guild has an old flat `actions` JSON in the DB, confirm `/warn settings` still renders it (converted via `normalizeActions`). If none exists, temporarily insert a flat row via `bun run db:studio` to verify conversion.

- [ ] **Step 4: Final commit if any verification fixes were needed**

If manual verification surfaced fixes, commit them. Otherwise skip.

---

## Self-Review (run after writing — already done, findings folded in)

- **Spec coverage:** §3 data model → Task 1; §3.3 normalizeActions + §4.3 sanitize → Task 2; §7 presets → Task 3; §4 engine + §4.3 tryWarnDm + dmOnWarn gating → Task 4; §8 i18n + §5.2 emojis → Task 5; §5 editor + modals + §5.2 button rule → Task 6; §4.4 result rendering + §6 confirmation → Task 7; view/actions renderers → Task 8; §10 testing checklist → Task 9. All spec sections covered.
- **Placeholder scan:** no TBD/TODO; every code step has full code.
- **Type consistency:** `WarnLevel` / `WarnPunishment` / `PunishResult` / `LevelExecResult` names match across Tasks 1→7. `executeLevel` is public in Task 4 and called in Task 7. `sanitizeLevelMessage` / `normalizeActions` defined in Task 2, consumed in Tasks 4/6/8. `Emojis.Edit` / `Emojis.Trash` defined in Task 5, used in Task 6. `disableButtons` is an instance method accessed via `container.utilities.componentUtils` (verified against `componentUtils.ts:110`), not a static — Task 7 uses the correct path.
- **Known risk:** Task 7's `channel` union (`Message.channel | ChatInputCommandInteraction.channel`) may need an `as any` cast for `.send`/`awaitMessageComponent`; documented in the task with a fallback. Resolved at typecheck time.














