# Full Safe Warn-System Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the partial warn feature with a guild-scoped, durable and permission-safe moderation system.

**Architecture:** libSQL owns all moderation facts: immutable cases, warning units, punishment batches/items/attempts, and audit history. Redis holds only expiring quickstart drafts and individual approval-menu selections. A service layer owns every database mutation; command and Sapphire interaction-handler code validates Discord state then calls that layer.

**Tech Stack:** Bun, TypeScript, Sapphire 5, discord.js v14.22, Drizzle/libSQL, ioredis JSON, BullMQ, Jest.

## Global Constraints

- Existing moderation data may be discarded; do not alter non-moderation tables.
- All new visible strings are localized in `en-US`, `it`, and `es-ES`, referenced by `LanguageKeys`, and humanized.
- New message UI uses Components v2 and `MessageFlags.IsComponentsV2`.
- Temporary drafts and selections use Redis TTLs; saved settings, cases, approvals, attempts, and audits use libSQL.
- Every mutation is guild-scoped, idempotent through an operation key, and validates current Discord permissions and hierarchy.
- No command-owned collectors, `awaitMessageComponent`, or in-memory workflow state may remain for moderation controls.

---

### Task 1: Rebuild the moderation persistence model

**Files:** Modify `src/db/schema.ts`; replace the moderation portion of `src/db/migrations/`; add `tests/moderation/schema.test.ts`.

**Interfaces:** Export `modCases`, `caseCounters`, `warns`, `warnSettings`, `caseNotes`, `warnPunishmentBatches`, `warnPunishmentItems`, `warnPunishmentAttempts`, and corresponding inferred types. `ModCase` includes `guildId`, `caseNumber`, `operationKey`, `parentCaseId`, `sourceCaseId`, `status`, `failureCode`, and integer millisecond timestamps.

- [ ] Write failing schema tests asserting each guild can allocate case number `1`, case numbers are unique per guild, and a warning unit cannot reference a case from another guild.
- [ ] Run `bun test tests/moderation/schema.test.ts`; confirm the tests fail because the new tables and constraints do not exist.
- [ ] Replace only moderation tables with a destructive migration. Add safe-default `autoApplyWarnPunishments` and `dangerouslyBypassWarnPermissions` columns to `warn_settings`; add a `(guild_id, case_number)` unique index and a `(guild_id, operation_key)` unique index to `mod_cases`; give all moderation timestamps `(unixepoch() * 1000)` defaults.
- [ ] Add punishment batch state `pending|partially_applied|completed|cancelled|failed`, item state `pending|executing|applied|cancelled|superseded|inapplicable|retryable_failed|terminal_failed|manual_review`, optimistic versions, lease fields, attempt counters, and indexes by guild, state, and creation time.
- [ ] Run the schema tests and `bun run db:generate`; confirm schema tests pass and the generated migration changes only moderation objects.
- [ ] Commit with `feat(mod): rebuild durable moderation persistence`.

### Task 2: Define validated moderation contracts

**Files:** Modify `src/lib/moderation/types.ts` and `src/lib/moderation/migration.ts`; add `tests/moderation/contracts.test.ts`.

**Interfaces:** Export `WarnLevel`, `WarnPunishment`, `WarnPunishmentType`, `PunishmentItemState`, `WarnWorkflowState`, `normalizeActions(raw)`, `sanitizeLevelMessage(message)`, `validateWarnLevel(level)`, and `validateWorkflowState(raw)`.

- [ ] Write failing tests that reject kick-plus-ban in a new level, reject malformed punishment data, preserve legacy action parsing, and reject expired or malformed workflows.
- [ ] Run `bun test tests/moderation/contracts.test.ts`; confirm every new validation expectation fails.
- [ ] Implement Zod-backed normalization and validation. A new level permits at most one terminal membership action; legacy kick-plus-ban remains readable for reconciliation. Workflow state contains only `id`, `revision`, `ownerId`, `guildId`, `messageId`, `status`, `expiresAt`, `step`, and validated config.
- [ ] Run the contracts test file; confirm it passes.
- [ ] Commit with `feat(mod): validate warn policies and workflows`.

### Task 3: Implement immutable case and warning-unit transactions

**Files:** Replace the persistence methods in `src/lib/moderation/actions.ts`; add `tests/moderation/warn-service.test.ts`.

**Interfaces:** `createWarn(input)` returns `{ case: ModCase; finalWarnCount: number; batches: WarnPunishmentBatch[] }`. `setWarnLevel(input)` sets the final active count. `revokeWarn(input)` creates an `unwarn` case and revokes units without deleting history. All methods require `guildId`, actor ID, target ID, and a unique operation key.

- [ ] Write failing tests for missing settings producing no writes, `3 -> 5` inserting two units, `5 -> 2` revoking the newest three, `2 -> 2` producing no case, and only upward crossings creating batches.
- [ ] Run `bun test tests/moderation/warn-service.test.ts`; confirm the required service API is absent or behavior is incorrect.
- [ ] Implement each operation in one libSQL transaction with a single captured `now`, per-guild case-number allocation, immutable case insertion, exact active-unit selection, and batch/item snapshot creation before Discord work.
- [ ] Mark unresolved items cancelled or inapplicable when a revoked or expired level no longer applies; never reverse already applied Discord punishments automatically.
- [ ] Run the warning-service tests; confirm they pass.
- [ ] Commit with `feat(mod): add transactional warning ledger`.

### Task 4: Implement safe punishment execution and recovery

**Files:** Modify `src/lib/moderation/actions.ts`; replace `src/scheduled-tasks/autoUnban.ts`; add `src/scheduled-tasks/recoverWarnPunishments.ts`; add `tests/moderation/punishment-execution.test.ts`.

**Interfaces:** `claimPunishmentItem(input)`, `applyPunishmentItem(input)`, `applyEligibleItems(input)`, `dismissBatch(input)`, and `recoverExpiredClaims()`. Each apply result contains its actual final state and optional resulting case number.

- [ ] Write failing tests for safe-default pending behavior, partial approval, optimistic claim races, a failed service return not being treated as success, ban-before-kick legacy precedence, and a mismatched temp-ban token never unbanning.
- [ ] Run `bun test tests/moderation/punishment-execution.test.ts`; confirm the behaviors fail.
- [ ] Re-fetch actor, target, bot member, and referenced role for every attempt. Enforce action-specific permissions and hierarchy, then atomically claim eligible items before Discord API calls. Create linked child cases and append attempts for success, denial, failure, and retry.
- [ ] Auto-apply only when `autoApplyWarnPunishments && level.autoConfirm && actorHierarchyValid && (dangerouslyBypassWarnPermissions || actorHasAllActionPermissions)`; dangerous bypass never skips bot capability, hierarchy, validation, or API errors.
- [ ] Add a deterministic `auto-unban:<guildId>:<internalCaseId>` job with an external ban token; recovery rethrows retryable task failures and sends ambiguous actions to manual review.
- [ ] Run the execution tests; confirm they pass.
- [ ] Commit with `feat(mod): execute durable punishments safely`.

### Task 5: Add durable approval and workflow interaction handling

**Files:** Create `src/interaction-handlers/warnApproval.ts`, `src/interaction-handlers/warnQuickstart.ts`, and a workflow repository; refactor `src/lib/moderation/quickstartWizard.ts`; add `tests/moderation/interaction-routing.test.ts`.

**Interfaces:** Approval IDs use `pm:wa:1:<batchPublicId>:<revision>:<action>`. Quickstart IDs use `pm:wq:1:<sessionId>:<revision>:<action>[:<entityId>]`. `WarnWorkflowRepository` stores Zod-validated drafts at `warn-workflow:<id>` with a sliding ten-minute Redis TTL. Selection values use `warn-punishment-selection:<guildId>:<batchPublicId>:<userId>:<revision>` with five-minute TTL.

- [ ] Write failing tests for malformed, stale, cross-guild, expired, and replayed IDs; assert valid selection state cannot authorize an item that is no longer pending in libSQL.
- [ ] Run `bun test tests/moderation/interaction-routing.test.ts`; confirm routing validation is absent.
- [ ] Replace collector and modal-wait logic with Sapphire handlers. Handlers parse only allowlisted actions, load authoritative state, compare revision, validate owner/message/guild, invoke service methods, then render controls with the next revision.
- [ ] Render Components v2 approval messages: one pending item has Apply and Dismiss; multiple items have a select menu, Apply selected, Apply all, and Dismiss. Dismiss requires authority for every unresolved item, hides only the display, and atomically appends one note.
- [ ] Persist quickstart drafts in Redis only; save converts the validated draft to libSQL settings and disables controls. Enabling dangerous bypass requires a persistent destructive confirmation and configuration-audit case.
- [ ] Run interaction-routing tests; confirm they pass.
- [ ] Commit with `feat(mod): route warn workflows and approvals durably`.

### Task 6: Replace the command surface and settings UI

**Files:** Replace `src/commands/mod/warn.ts` and `src/commands/mod/warnSettings.ts`; add `src/commands/mod/warnings.ts`; update moderation i18n files and language-key exports; add command-focused tests.

**Interfaces:** `/warn <user> [reason] [amount] [advanced]`, `/heavywarn <user> [reason] [advanced]`, and `/warnings pending [user]`, `list <user>`, `remove <case-number> [reason]`, `level set <user> <level> [reason] [advanced]`, and `multi <users> [reason] [amount] [advanced]` call the service layer only.

- [ ] Write failing command tests for registration shape, guild-only integration, public case-number use, localized missing-settings errors, and Components v2 reply flags.
- [ ] Run the command test files; confirm the old command tree fails the expected registration and routing assertions.
- [ ] Register the direct `/warn` command and `/warnings` management command. Make all management lookups resolve `(guildId, caseNumber)` and expose active/dismissed pending batches with database pagination.
- [ ] Convert quickstart to the Redis workflow handlers. Render all settings, safe-default policy toggles, per-level multi-punishment summaries, and approval outcomes from localized keys only.
- [ ] Run command tests and locale-key parity checks; confirm they pass.
- [ ] Commit with `feat(mod): replace warn commands with safe workflow UX`.

### Task 7: Migrate remaining moderation actions to the case ledger

**Files:** Refactor `src/commands/mod/ban.ts`, `kick.ts`, `mute.ts`, `case.ts`, and `note.ts`; extend `src/lib/moderation/actions.ts`; add `tests/moderation/case-ledger.test.ts`.

**Interfaces:** Direct actions create immutable guild-scoped cases through the service. Notes have guild IDs and are never hard-deleted; a removal writes a redaction or void event. Every successful direct or automatic action has an audit-log reason and linked public case number.

- [ ] Write failing tests that prevent cross-guild case access, preserve original notes after removal, link automatic child cases to their source warning and item, and prevent a scheduled unban from creating duplicates.
- [ ] Run `bun test tests/moderation/case-ledger.test.ts`; confirm current direct commands bypass the durable case ledger.
- [ ] Route every direct moderation mutation through the service. Replace internal-case user inputs with public case numbers, add source/parent links, and make case/note list queries real paginated database queries.
- [ ] Run case-ledger tests; confirm they pass.
- [ ] Commit with `refactor(mod): use guild-scoped immutable case ledger`.

### Task 8: Complete verification and Discord acceptance testing

**Files:** Update or add all moderation tests; update `src/changelog.ts`.

- [ ] Run the targeted Jest moderation suite, then `bun test`, `bunx tsc --noEmit -p tsconfig.json`, and non-mutating ESLint checks for every changed TypeScript file.
- [ ] Generate and apply the fresh moderation migration in the Bot Testing environment; run `PRAGMA foreign_key_check` and verify moderation table/index shape.
- [ ] Use the Pomelo Discord feature-testing skill to test quickstart, safe defaults, dangerous-confirmation audit, partial approval, dismissal, restart recovery, public case scoping, and token-safe auto-unban with administrator and restricted-moderator accounts.
- [ ] Add a humanized changelog entry and commit verification-only changes.
