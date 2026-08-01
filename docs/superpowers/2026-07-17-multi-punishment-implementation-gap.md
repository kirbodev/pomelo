## Multi-Punishment Warn Levels — Implementation Gap Report

**Source plan:** `docs/superpowers/plans/2026-07-16-multi-punishment-warn-levels.md`
**Verification date:** 2026-07-17
**Method:** Cross-referenced every task in the plan against the live source files, then ran `bunx tsc --noEmit` to surface type errors and `bun test` for the unit-testable migration logic.

### Summary

The implementation diverged into a hybrid state: the **backend/data layer** (Tasks 1–5) is complete, but three of the four **presentation/command-layer** tasks (Tasks 6–8) were either left in their pre-plan state or replaced with a simplified alternative that omits the multi-punishment editor, per-punishment result rendering, and the `normalizeActions`-based settings viewer. The project **does not typecheck** — 28 errors across `quickstartWizard.ts`, `warn.ts`, and `warnSettings.ts`.

### Implemented (✅)

| Task | File(s) | Status |
|---|---|---|
| 1 — Types | `src/lib/moderation/types.ts` | `WarnLevel`, `WarnPunishment`, `PunishResult`, `LevelExecResult`, updated `WarnActionResult`, plus bonus durable-workflow types (`WarnWorkflowState`, `PunishmentItemState`, etc.). `WarnActionConfig` is removed as required. |
| 2 — Migration + TDD | `src/lib/moderation/migration.ts`, `tests/moderation/migration.test.ts` | `normalizeActions()` and `sanitizeLevelMessage()` implemented with Zod validation. All 16 unit tests pass (`bun test`). Bonus: `validateWarnLevel()`, `validateWorkflowState()`. |
| 3 — Presets | `src/lib/moderation/presets.ts` | All four presets rewritten as `WarnLevel[]` — matches the plan exactly. |
| 4 — Execution engine | `src/lib/moderation/actions.ts` | `executeLevel()`, `executePunishment()`, `tryWarnDm()` all present. `warn()` calls `normalizeActions()`, computes crossed levels, gates DM on `dmOnWarn`. Bonus: full `PunishmentCapabilityAdapter`, batch/item persistence, `claimPunishmentItem`/`applyEligibleItems` for durable approval. |
| 5 — Emojis + i18n keys | `src/lib/emojis.ts`, `src/lib/i18n/commands/moderation.ts`, all 3 locale JSON files | `Emojis.Edit` and `Emojis.Trash` added. Every new key from the plan (punishment labels, confirm-level strings, approval strings) is present in `en-US`, `it`, and `es-ES`. |

### Not implemented (❌)

#### Task 6 — Quickstart step-5 multi-punishment editor (plan §5, `src/lib/moderation/quickstartWizard.ts`)

**What the plan requires:** Replace the single-action step-5 selector with a punishment-list view showing up to 4 punishments per level, each with emoji-only edit (✏️) / remove (🗑️) buttons, an "Add punishment" select (disabled at cap), a punishment-detail modal (type, duration, role), and a level-details modal (per-level message, autoExecute). The level type changes from `WarnActionConfig` to `WarnLevel`.

**What exists instead:**
- **`quickstartWizard.ts`** is untouched from before the plan — it still imports `WarnActionConfig` (which no longer exists in `types.ts`), still builds `QuickstartConfig.levels: WarnActionConfig[]`, still renders the old single-action step-5 with `selectActionType`, and still uses the old single-action `showDetailsModal`. This file has **25 compilation errors** (1 missing type + 24 `Quickstart` casing errors).
- **`warnQuickstart.ts`** (interaction handler) was written as a **replacement** quickstart using the new durable-workflow infrastructure (`WarnWorkflowRepository` + Redis). However, it is a **stripped-down** wizard: step 4 (levels) shows only a count summary with back/review buttons — there is **no step 5 at all**, no multi-punishment editor, no per-punishment buttons, no punishment/level modals, no `AddPunishment` select, no 4-punishment cap. The `warnSettings.ts` `runQuickstart()` delegates to this handler, so the user-visible wizard is the simplified one.

**Gap:** The multi-punishment editor (punishment list, detail modal, level-details modal, emoji buttons, cap enforcement) needs to be built into `warnQuickstart.ts` (the durable-workflow handler) as its step 5, or the old `quickstartWizard.ts` needs to be ported to the new types + durable-workflow pattern. Either way, the editor UI described in the plan does not exist.

#### Task 7 — Per-punishment result rendering + manual confirmation (`src/commands/mod/warn.ts`)

**What the plan requires:** Rewrite `handleWarnResult` to render each crossed level's per-punishment outcome (✅/❌ + type label) instead of the old flat action-type line. Add `confirmAndExecuteLevel` that presents a `ButtonConfirmationConstructor` + `ContainerBuilder` (Components v2) dialog with Apply/Skip buttons for `autoConfirm: false` levels, then calls `modActionService.executeLevel()` on confirm.

**What exists instead:** `handleWarnResult` is unchanged — it still accesses `ta.action.warnCount` and `ta.action.actionType`, which are fields of the removed `WarnActionConfig` type. The `WarnActionResult.thresholdActions` items now carry `level: WarnLevel` (not `action`), so line 266 produces **2 compilation errors**. There is no `punishmentResultLine` helper, no `confirmAndExecuteLevel` method, and no `ContainerBuilder`/`ButtonConfirmationConstructor` import for the confirmation dialog. Result lines use the old format: `${status} Threshold at ${ta.action.warnCount} warns: ${ta.action.actionType}`.

**Gap:** `warn.ts` needs the entire `handleWarnResult` rewrite described in Task 7.

#### Task 8 — Warn settings viewers use `normalizeActions` + multi-punishment summary (`src/commands/mod/warnSettings.ts`)

**What the plan requires:** Replace the `parseActions` helper and `actionTypeLabelKey` function with `normalizeActions()` from `migration.js`. Add a `levelLine` helper that renders each `WarnLevel` as a comma-joined punishment list. Update `showView` and `showActions` to use `normalizeActions` and render per-punishment summaries.

**What exists instead:** The file still defines `parseActions` returning `WarnActionConfig[]`, still uses `actionTypeLabelKey` with `WarnActionConfig["actionType"]`, and still imports `WarnActionConfig` from `types.ts` (which no longer exports it). It has **11 compilation errors** (1 missing type + 10 `Quickstart` casing errors). The `showView` and `showActions` renderers still produce the old flat single-action-per-level format.

**Gap:** `warnSettings.ts` needs the `normalizeActions` migration and the multi-punishment summary rendering described in Task 8.

#### Task 9 — Lint, full test suite, manual verification

**Blocked by Tasks 6–8.** The unit tests for Task 2 pass, but the project does not typecheck, so no build or manual Discord verification is possible.

### Additional discrepancy: LanguageKeys casing

The `i18n/commands/moderation.ts` file exports the quickstart subtree as `WarnSettings.quickstart` (lowercase). However, `quickstartWizard.ts`, `warnSettings.ts`, and `warnQuickstart.ts` all access it as `.Quickstart` (capital-Q). This causes 24+ compilation errors across those files. Either the access sites need to use `.quickstart`, or the `languageKeys.ts` export needs a `Quickstart` alias.

### Compilation summary

```
src/commands/mod/warn.ts              — 2 errors (ta.action → ta.level)
src/commands/mod/warnSettings.ts      — 11 errors (missing WarnActionConfig + Quickstart casing)
src/lib/moderation/quickstartWizard.ts — 25 errors (missing WarnActionConfig + Quickstart casing)
Total: 28 errors
```

### Recommended approach

Continue using the durable-workflow infrastructure (`warnQuickstart.ts` + `WarnWorkflowRepository`) since it's already wired in (`warnSettings.ts → runQuickstart()`). The work remaining is:

1. **Fix the `Quickstart` → `quickstart` casing** in all three consumer files.
2. **Build the step-5 multi-punishment editor** into `warnQuickstart.ts`: punishment list with emoji edit/remove, add-punishment select, punishment-detail modal, level-details modal, 4-punishment cap.
3. **Rewrite `warn.ts` `handleWarnResult`** for per-punishment rendering + `confirmAndExecuteLevel` with Components v2 confirmation.
4. **Migrate `warnSettings.ts`** from `parseActions`/`WarnActionConfig` to `normalizeActions`/`WarnLevel` with multi-punishment summary.
5. **Run the full typecheck, lint, unit tests, and Discord manual verification** per Task 9.

### Files that can be deleted after migration

Once Tasks 6–8 are done on the new durable-workflow path, delete `src/lib/moderation/quickstartWizard.ts` — it's superseded by `warnQuickstart.ts`.
