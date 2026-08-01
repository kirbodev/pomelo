 # Warn Settings UX Refresh Implementation Plan
 
 > **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
 
 **Goal:** Fix seven UX problems in `/warn settings` and persistent moderation interactions: preset translations, general settings discoverability, warn-level editing, add-punishment flow, terminal-punishment deduplication, expired interaction messaging, and persistent paginated messages.
 
 **Architecture:** Keep the existing Redis-backed `WarnWorkflowState` and `WarnWorkflowRepository` foundation; extend it with additional workflow actions and a new Redis-backed persistent paginator. Reuse the `/settings guild/user` select-then-act pattern. All new user-facing strings go through the humanizer pass and are added to `en-US`, `it`, and `es-ES` locales.
 
 **Tech Stack:** Sapphire 5, discord.js v14, Components v2, Bun, Redis JSON, libSQL/Drizzle.
 
 ## Global Constraints
 
 - Components v2 is required for any new embed-like message (`ContainerBuilder`, `TextDisplayBuilder`, `SectionBuilder`, `ActionRowBuilder`).
 - Every user-facing string must be localized via `LanguageKeys` and present in `en-US`, `it`, `es-ES`.
 - Humanize every new/edited string.
 - Use `Colors.*` only; no hex literals.
 - Persistent controls must be Sapphire `InteractionHandler` files with Redis TTL state.
 - Do not use `awaitMessageComponent` for persistent UI.
 
 ---
 
 ### Task 1: Fix preset selector translations
 
 **Files:**
 - Modify: `src/commands/mod/warnSettings.ts`
 - Modify: `src/lib/i18n/commands/moderation.ts`
 - Modify: `src/languages/*/commands/moderation.json`
 
 **Interfaces:**
 - Consumes: `PRESETS` record, existing `LanguageKeys.Commands.Moderation.WarnSettings.preset*` keys.
 - Produces: Select options use translated names/descriptions instead of raw keys; description is always set.
 
 - [ ] **Step 1: Update `showPresetSelector`** to build options by mapping `Object.entries(PRESETS)` and using the preset's localized name + description keys. Keep the values as preset keys.
 - [ ] **Step 2: Add top-level preset description keys** to `LanguageKeys.Commands.Moderation.WarnSettings` if not already present, pointing to `commands/moderation:warnSettings.preset*Desc`.
 - [ ] **Step 3: Add localized strings** for `presetLemomemeDesc`, `presetRecommendedDesc`, `presetProgressiveDesc`, `presetStrictStrikeDesc` in `en-US`, `it`, `es-ES`.
 - [ ] **Step 4: Humanize strings.**
 - [ ] **Step 5: Verify** with `bun run typecheck` and `bun run lint:fix`.
 
 ---
 
 ### Task 2: Redesign general settings selector
 
 **Files:**
 - Modify: `src/interaction-handlers/warnQuickstart.ts`
 - Modify: `src/lib/moderation/workflowRepository.ts`
 - Modify: `src/lib/moderation/types.ts`
 - Modify: `src/lib/i18n/commands/moderation.ts` and `src/languages/*`
 
 **Interfaces:**
 - Consumes: `WarnWorkflowState.config`.
 - Produces: Step 3 renders a select menu of general settings; selecting one shows a toggle button (DM) or a modal input (expiry/log channel).
 
 - [ ] **Step 1: Add new quickstart actions** to `QuickstartActions` and step allowlists in `workflowRepository.ts`.
 - [ ] **Step 2: Extend `WarnWorkflowState`** with `editingGeneralSetting` and optional `generalSettingInput`.
 - [ ] **Step 3: Rewrite `renderWarnQuickstart` step 3** to show a StringSelectMenu with options: Default expiry, DM on warn, Log channel. Below it, render the control for the selected setting.
 - [ ] **Step 4: Implement modal handling** for expiry/log channel, parse value, update state, re-render.
 - [ ] **Step 5: Update `reduce`** to handle `select-general-setting`, `toggle-dm-from-menu`, `set-expiry`, `set-log-channel`.
 - [ ] **Step 6: Add translations** for new keys.
 - [ ] **Step 7: Humanize strings.**
 - [ ] **Step 8: Verify** typecheck/lint.
 
 ---
 
 ### Task 3: Redesign edit warn level menu
 
 **Files:**
 - Modify: `src/interaction-handlers/warnQuickstart.ts`
 - Modify: `src/lib/moderation/workflowRepository.ts`
 - Modify: i18n files
 
 **Interfaces:**
 - Consumes: `state.config.levels[idx].punishments`.
 - Produces: A single select menu of punishments; selecting one reveals Edit/Delete buttons.
 
 - [ ] **Step 1: Remove per-punishment edit/delete button rows** from `renderWarnQuickstart` step 5.
 - [ ] **Step 2: Add a punishment select menu** with options showing punishment labels. Add action `select-punishment` with `entityId` = punishment index.
 - [ ] **Step 3: Track `editingPunishmentIndex`** in state.
 - [ ] **Step 4: When a punishment is selected**, render Edit/Delete action buttons and a Back button below the list.
 - [ ] **Step 5: Update `reduce`** and action allowlists.
 - [ ] **Step 6: Add translations** (`selectPunishment`, `editSelectedPunishment`, `deleteSelectedPunishment`, `backToLevel`).
 - [ ] **Step 7: Humanize strings.**
 - [ ] **Step 8: Verify** typecheck/lint.
 
 ---
 
 ### Task 4: Sequential add-punishment flow
 
 **Files:**
 - Modify: `src/interaction-handlers/warnQuickstart.ts`
 - Modify: `src/lib/moderation/workflowRepository.ts`
 - Modify: i18n files
 
 **Interfaces:**
 - Consumes: `WarnPunishmentType`, current level punishments.
 - Produces: A button opens a new "add punishment" step where type, duration/role are collected one-by-one via select/modal.
 
 - [ ] **Step 1: Add new step** for add-punishment flow to workflow steps.
 - [ ] **Step 2: Replace the "add punishment" select** with a button labeled `addPunishment`.
 - [ ] **Step 3: In the new step**, show a select menu for punishment type (mute/kick/ban/role) with descriptions.
 - [ ] **Step 4: After type selection**, show follow-up inputs for duration/role/kick confirm.
 - [ ] **Step 5: Validate** one-each limit before allowing creation.
 - [ ] **Step 6: Update `reduce`** and action allowlists.
 - [ ] **Step 7: Add translations** for new keys.
 - [ ] **Step 8: Humanize strings.**
 - [ ] **Step 9: Verify** typecheck/lint.
 
 ---
 
 ### Task 5: Disable mute/kick/ban when one already exists
 
 **Files:**
 - Modify: `src/interaction-handlers/warnQuickstart.ts`
 - Modify: i18n files
 
 **Interfaces:**
 - Consumes: current level's punishment types.
 - Produces: Add-punishment type options have `disabled: true` for types already present.
 
 - [ ] **Step 1: Create helper `terminalTypeTaken(level, type)`** returning boolean for `mute`, `kick`, `ban`.
 - [ ] **Step 2: When rendering type options**, set `disabled: terminalTypeTaken(level, type)` and append "(already added)" description.
 - [ ] **Step 3: Validate in `reduce`** as a guard.
 - [ ] **Step 4: Add translations** (`punishmentAlreadyAdded`).
 - [ ] **Step 5: Humanize strings.**
 - [ ] **Step 6: Verify** typecheck/lint.
 
 ---
 
 ### Task 6: Improve expired persistent interaction UX
 
 **Files:**
 - Modify: `src/interaction-handlers/warnQuickstart.ts`
 - Modify: `src/interaction-handlers/warnApproval.ts`
 - Modify: i18n files
 
 **Interfaces:**
 - Consumes: existing `replyUnavailable` methods.
 - Produces: Clear, actionable messages distinguishing timeout, completion, cancellation, and missing permissions.
 
 - [ ] **Step 1: Distinguish failure reasons** in handlers where possible.
 - [ ] **Step 2: Add new language keys** for each distinct reason.
 - [ ] **Step 3: Update `replyUnavailable`** in both handlers to accept reason/context.
 - [ ] **Step 4: Humanize strings.**
 - [ ] **Step 5: Verify** typecheck/lint.
 
 ---
 
 ### Task 7: Persistent paginated message
 
 **Files:**
 - Create: `src/interaction-handlers/persistentPaginator.ts`
 - Modify: `src/commands/mod/case.ts`
 - Modify: `src/lib/i18n/commands/moderation.ts` and `src/languages/*`
 
 **Interfaces:**
 - Consumes: arbitrary page data serialized to Redis; `InteractionHandler` routes page actions.
 - Produces: A paginated Components v2 message whose controls remain usable across restarts.
 
 - [ ] **Step 1: Design Redis schema** for paginator state.
 - [ ] **Step 2: Create `PersistentPaginatorRepository`** with save/load/advance methods using Lua CAS.
 - [ ] **Step 3: Create `PersistentPaginatorHandler`** extending `InteractionHandler`, parsing custom IDs.
 - [ ] **Step 4: Render pages as Components v2** with previous/next/first/last/jump-to-page actions.
 - [ ] **Step 5: Update `CaseCommand`** to use the persistent paginator.
 - [ ] **Step 6: Add translations** for pagination labels.
 - [ ] **Step 7: Humanize strings.**
 - [ ] **Step 8: Verify** typecheck/lint and run focused tests.
 
 ---
 
 ### Task 8: Final integration and verification
 
 **Files:**
 - All modified files.
 
 - [ ] **Step 1: Run `bun run lint:fix`.**
 - [ ] **Step 2: Run `bun run typecheck`.**
 - [ ] **Step 3: Run focused tests** for moderation workflow and actions.
 - [ ] **Step 4: Check all three locale files** for missing keys.
 - [ ] **Step 5: Review diff** for accidental breaking changes.
 - [ ] **Step 6: Update changelog** in `src/changelog.ts`.
 
 ---
