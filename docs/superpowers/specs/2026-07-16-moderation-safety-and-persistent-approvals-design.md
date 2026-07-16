# Moderation Safety and Persistent Approvals

> **Date:** 2026-07-16
>
> **Project:** Pomelo Discord Bot
>
> **Status:** Approved conversational design, pending written-spec review
>
> **Linear context inherited from the moderation milestone:** POM-46, POM-47, POM-49, POM-52, POM-58, POM-59, POM-60, POM-61, POM-64, POM-70
>
> **Supersedes:** Conflicting moderation collector, permission, case-identity, warning-level, and punishment-execution behavior in the 2026-07-13 through 2026-07-16 moderation plans.

## 1. Outcomes

This remediation must:

1. Record a valid warning even when its configured punishments cannot run immediately.
2. Prevent a moderator from gaining undeclared ban, kick, mute, or role capabilities through a warning.
3. Allow a server to opt into that dangerous policy behavior through a clearly named, default-off setting.
4. Let moderators apply only the pending punishments they can currently perform while leaving the rest for a stronger moderator.
5. Keep all moderation controls usable after the originating command returns and across bot restarts.
6. Make every moderation mutation guild-scoped, transactional where possible, idempotent, and auditable.
7. Return a localized setup error when warn settings do not exist. No warning case or row is created.
8. Fix the remaining permission, hierarchy, execution-result, expiry, duration, DM, pagination, and audit flaws found in the current implementation.

POM-61 modstats and POM-64 lock or lockdown remain separate feature work. This remediation makes the case ledger safe enough for modstats later, but it does not add those commands.

## 2. Authoritative auto-application rule

Add two guild settings:

```ts
autoApplyWarnPunishments: boolean; // default false
dangerouslyBypassWarnPermissions: boolean; // default false
```

`WarnLevel.autoConfirm` remains the per-level switch.

Automatic execution is allowed only when:

```ts
const shouldAutoExecute =
  settings.autoApplyWarnPunishments &&
  level.autoConfirm &&
  issuerMeetsAllRequiredHierarchy &&
  (
    settings.dangerouslyBypassWarnPermissions ||
    issuerHasAllActionPermissions
  );
```

The consequences are:

- If `autoApplyWarnPunishments` is off, every crossed punishment is pending.
- If the level's `autoConfirm` is off, every punishment in that level is pending.
- If the dangerous bypass is off and the warning issuer does not have every action-specific permission, every punishment in that level is pending. Do not auto-apply only a subset from the warn command.
- If the issuer fails any required actor hierarchy check, every punishment in that level is pending regardless of the dangerous bypass.
- If the dangerous bypass is on, missing action-specific permissions on the warning issuer do not block automatic policy execution.
- The dangerous bypass never bypasses bot permissions, Discord hierarchy, role editability, target validity, duration limits, configuration validation, or Discord API failures.
- Presets and quickstart defaults never enable either setting implicitly.
- Existing or partially migrated settings treat missing values as `false`.

Changing either guild-wide setting requires `ManageGuild`. Enabling `dangerouslyBypassWarnPermissions` additionally requires a persistent destructive confirmation and a durable configuration-audit record containing the actor and old and new values.

## 3. Permission and hierarchy model

Recording a warning requires `ModerateMembers` and the normal target protections.

Every punishment is authorized independently at approval time:

| Punishment | Actor permission | Actor hierarchy |
|---|---|---|
| Mute | `ModerateMembers` | Actor above target unless actor is guild owner |
| Kick | `KickMembers` | Actor above target unless actor is guild owner |
| Ban | `BanMembers` | Actor above target when the target is still a member, unless actor is guild owner |
| Role | `ManageRoles` | Actor above target and assigned role unless actor is guild owner |

`Administrator` satisfies permission bits but does not bypass Discord role hierarchy. Only the guild owner bypasses actor hierarchy.

Bot capability is evaluated separately:

- Mute requires `ModerateMembers` and a moderatable target.
- Kick requires `KickMembers` and a kickable target.
- Ban requires `BanMembers`; if the target is still a member, it also requires a bannable target.
- Role requires `ManageRoles`; the role must exist, be unmanaged, and be below the bot.

The service re-fetches the actor, bot member, target member where applicable, and referenced roles every time. Cached interaction-time objects and values embedded in component IDs are not authoritative.

Missing actor permission leaves the punishment pending. Missing bot capability also leaves a retryable punishment pending and records the failure. A deleted or permanently invalid target role becomes inapplicable.

## 4. Persistent interaction routing

Every component that must remain usable after its command returns uses Sapphire's interaction-collector system through `InteractionHandler` files in `src/interaction-handlers/`.

Do not use:

- `createMessageComponentCollector`
- `awaitMessageComponent`
- command-owned promises
- in-memory callback maps
- array indexes as persistent entity identifiers

Use:

- Redis with a TTL and optimistic revision for temporary workflows such as quickstart and advanced warn.
- libSQL for durable punishment approvals, attempts, moderation cases, and dismissal state.
- Stable opaque session, batch, and item identifiers.

Recommended routing contracts:

```text
pm:wq:1:<sessionId>:<revision>:<action>[:<entityId>]
pm:wa:1:<batchPublicId>:<revision>:<action>
pm:wv:1:<sessionId>:<revision>:<action>[:<entityId>]
```

`wq` is warn quickstart, `wa` is warn approval, and `wv` is advanced warn.

Custom IDs:

- Stay below Discord's 100-character limit.
- Contain only a versioned prefix, opaque persisted ID, revision, allowlisted action, and optional opaque child ID.
- Never contain serialized state, permissions, authorization claims, reasons, names, or secrets.
- Are routing hints only.

Every handler:

1. Strictly parses the custom ID and action allowlist.
2. Requires guild context.
3. Loads persisted state scoped by `interaction.guildId`.
4. Validates the stored guild, user or actor rule, message, status, expiry, and revision.
5. Re-fetches referenced Discord entities.
6. Re-checks actor and bot permissions and hierarchy.
7. Uses an atomic revision update or item claim before mutation.
8. Renders controls containing the new revision.

Stale controls return a localized ephemeral error and refresh or direct the moderator to the newest view.

## 5. Quickstart and advanced-warn state

Quickstart and advanced warn are temporary Redis workflows:

```ts
type WarnWorkflowState = {
  id: string;
  revision: number;
  ownerId: string;
  guildId: string;
  messageId: string;
  status: "open" | "saved" | "cancelled";
  expiresAt: number;
  step: number;
  config: unknown;
};
```

Requirements:

- Ten-minute sliding TTL.
- Zod validation on every read.
- Compare-and-swap revision updates.
- Stable IDs for warn levels and punishments.
- Persistent `MessageComponent` and `ModalSubmit` handlers.
- Save and cancel close the workflow and disable its controls.
- A restart does not invalidate an unexpired workflow.
- Expiry is enforced from persisted state. A collector ending is not the expiry mechanism.

The quickstart review contains both auto-application settings. The dangerous toggle opens an explicit warning confirmation before it becomes enabled in the draft.

## 6. Durable warn-punishment model

Warning creation, warning units, newly crossed thresholds, and pending punishment records are written in one transaction. Discord punishment calls happen only after that transaction commits.

### 6.1 Batches

One batch represents one warn level crossed by one warning action:

```ts
type WarnPunishmentBatch = {
  id: number;
  publicId: string;
  guildId: string;
  targetUserId: string;
  sourceWarnCaseId: number;
  threshold: number;
  sourceModeratorId: string;
  state: "pending" | "partially_applied" | "completed" | "cancelled" | "failed";
  displayStatus: "active" | "dismissed";
  displayChannelId: string | null;
  displayMessageId: string | null;
  dismissedById: string | null;
  dismissedAt: number | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
};
```

`publicId` is opaque and unique. `sourceWarnCaseId` is guild-scoped. Display state is independent of execution state.

### 6.2 Items

One item represents one independently applicable punishment:

```ts
type WarnPunishmentItem = {
  id: number;
  publicId: string;
  guildId: string;
  batchId: number;
  ordinal: number;
  punishmentType: "mute" | "kick" | "ban" | "role";
  configJson: string;
  requiredPermission: string;
  state:
    | "pending"
    | "executing"
    | "applied"
    | "cancelled"
    | "superseded"
    | "inapplicable"
    | "retryable_failed"
    | "terminal_failed"
    | "manual_review";
  executorId: string | null;
  resultingCaseId: number | null;
  claimToken: string | null;
  claimExpiresAt: number | null;
  attemptCount: number;
  lastError: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};
```

The configuration snapshot is validated before insertion and never rewritten by later settings edits.

### 6.3 Attempts

Every apply, automatic execution, dismissal, stale click, denial, and failure creates an append-only attempt or review record. Store stable error identifiers or bounded diagnostics, never raw stack traces or Discord response bodies.

### 6.4 Constraints and indexes

At minimum:

- Unique batch `publicId`.
- Unique item `publicId`.
- Unique `(sourceWarnCaseId, threshold)`.
- Unique `(batchId, ordinal)`.
- Unique resulting execution case per item.
- Batch indexes by guild, target, state, display status, and creation time.
- Item indexes by guild, batch, state, lease expiry, and ordinal.
- Attempt indexes by guild, batch, and creation time.

## 7. Approval UI

Approval messages use Components v2. The configured moderation log channel receives the shared approval when usable. If no usable log channel exists, the batch remains available through `/warnings pending`, and the warn result tells the acting moderator that punishments are waiting.

### 7.1 One pending punishment

Show:

- Target.
- Originating warn case.
- Warn level.
- Punishment summary.
- Required permission.
- `Apply punishment` button.
- `Dismiss` button.

### 7.2 Multiple pending punishments

Show:

- Target.
- Originating warn case.
- Warn level.
- One status line per punishment.
- Multi-choice string select menu containing currently pending opaque item public IDs.
- `Apply selected` button.
- `Apply all` button.
- `Dismiss` button.

Applied, superseded, failed, or inapplicable items remain visible as status lines but are not selectable.

Because Discord does not carry a select submission into a later button click, store each moderator's current selection in Redis:

```text
warn-punishment-selection:<guildId>:<batchPublicId>:<userId>:<revision>
```

The value is a Zod-validated item-public-ID array with a short TTL. The database remains authoritative, and the apply operation intersects the selection with currently pending items in the same batch.

## 8. Apply behavior

### 8.1 One punishment

`Apply punishment` attempts the item only if the clicker currently has the actor permission and hierarchy. Otherwise, it returns a localized ephemeral error and leaves the item pending.

### 8.2 Apply selected

The handler intersects:

1. The clicker's Redis selection.
2. Items belonging to the loaded guild-scoped batch.
3. Items currently pending or retryable.
4. Items the clicker can currently perform.

It atomically claims and executes the eligible subset. Selected but unauthorized items remain pending and are listed with the missing requirement.

If no item is eligible, mutate nothing.

### 8.3 Apply all

`Apply all` evaluates every pending item and applies only the clicker's eligible subset. Unauthorized items remain pending for a stronger moderator.

For example, a moderator with `ModerateMembers` but not `BanMembers` can apply a mute while the ban remains pending.

### 8.4 Atomic claims

Only an item returned by a conditional claim may execute:

```sql
UPDATE warn_punishment_items
SET state = 'executing',
    executor_id = :actorId,
    claim_token = :token,
    claim_expires_at = :leaseExpiry,
    attempt_count = attempt_count + 1,
    version = version + 1
WHERE guild_id = :guildId
  AND id = :itemId
  AND version = :expectedVersion
  AND state IN ('pending', 'retryable_failed')
RETURNING *;
```

This prevents two moderators from executing the same item.

### 8.5 Execution order

Execute non-terminal actions first:

1. Role additions.
2. Mutes.
3. The single configured terminal action, kick or ban.

New configuration rejects more than one terminal membership action and rejects kick plus ban.

For legacy kick-plus-ban data:

- If both are claimed together, ban executes first and has precedence.
- A successful ban supersedes a still-pending kick.
- If only kick is actor-eligible, it may run while ban remains pending.
- A later ban remains valid by user ID after a kick.

Returned action results with `success: false` are failures. They must never be rendered or persisted as successful executions.

## 9. Dismiss behavior

Dismissal hides the active shared approval display. It does not cancel, decline, apply, or remove the pending punishments.

Before dismissal:

1. Reconcile stale, cancelled, and inapplicable items.
2. Reject while any item is executing.
3. Collect every unresolved actionable item in `pending`, `retryable_failed`, or `manual_review`.
4. Require the clicker to have the actor permission and hierarchy for all of them.

Bot capability is not part of dismissal authority.

If the clicker lacks authority for any pending punishment, return a localized error listing the unmet requirements.

Dismissal and note creation occur in one compare-and-set database transaction:

- Change `displayStatus` from `active` to `dismissed`.
- Store the acknowledging moderator and timestamp.
- Increment the batch revision.
- Append exactly one automatic note to the originating warning case, surfaced in the user's moderation notes.
- Set the note author to the acknowledging moderator.
- State the warn level or batch and that the punishments remain available through `/warnings pending`.

A stale second dismissal creates no duplicate note.

The original approval message is edited to remove active controls. If message cleanup fails, database state remains authoritative, the failure is reported to Sentry, and cleanup may be retried.

## 10. Slash fallback

Add `/warnings pending` as the durable recovery surface. Discord cannot combine direct root options on `/warn <user>` with a `/warn pending` subcommand, so pending review belongs on the separate warn-management command.

It:

- Lists active and dismissed batches with pending, retryable, or manual-review items.
- Supports a target filter.
- Uses real database pagination.
- Clearly labels dismissed batches.
- Opens the same Components v2 approval view.
- Re-checks permissions on every click.

Dismissed punishments remain slash-applicable. A future explicit cancellation workflow is separate, destructive, reasoned, and audited.

## 11. Warn count and reversal semantics

`setWarnLevel` sets the final active warning count. It does not add that number.

Inside one transaction:

1. Capture one `now`.
2. Load active warning units for the guild and target.
3. Calculate `delta = desiredLevel - currentLevel`.
4. Positive delta inserts exactly that many units.
5. Negative delta revokes exactly that many newest active units first.
6. Zero delta creates no case and changes no rows.
7. Only upward crossings create threshold batches.

Active warning units satisfy:

```text
revokedAt is null
and (expiresAt is null or expiresAt > now)
```

When a warning is revoked or expiry drops the active count below a threshold, unresolved punishment items become cancelled or inapplicable. Already applied punishments are not silently reversed.

If the target leaves:

- Mute, kick, and role items become inapplicable.
- Ban remains pending because it can operate by user ID.

Role punishments must record Pomelo grant provenance. A role is removed after the active warn count falls below its threshold only if Pomelo originally granted that role. Never remove a pre-existing or manually granted role.

## 12. Guild-scoped immutable case ledger

Keep a global internal case ID for foreign keys and add a public per-guild case number:

```ts
type ModCaseIdentity = {
  id: number;
  guildId: string;
  caseNumber: number;
  operationKey: string;
};
```

Requirements:

- Unique `(guildId, caseNumber)`.
- Unique `(guildId, operationKey)`.
- A guild case-counter table allocates numbers in the case transaction.
- Every public lookup or mutation resolves by `(guildId, caseNumber)`.
- `case_notes` includes `guildId` and uses a guild-scoped foreign key.
- Warnings and reversal links use guild-scoped foreign keys.
- Commands and component handlers never accept an internal case ID from a user.

Cases are an immutable audit ledger:

- Unwarn creates an `unwarn` case and marks warning units revoked.
- Unban creates an `unban` case linked to the source ban when known.
- Note removal creates a void or redaction audit event.
- Original cases and notes are never hard-deleted to represent an undo.
- Threshold punishments create child cases linked to both the source warn and punishment item.
- Role applications are auditable moderation actions, not unlogged side effects.

Every operation carries an idempotency key derived from the Discord interaction, scheduled job, or punishment item.

## 13. Temporary-ban safety

Temporary bans use a durable external ban token and deterministic BullMQ job:

```text
auto-unban:<guildId>:<internalBanCaseId>
```

The scheduled payload contains guild ID, internal source case ID, target user ID, and expected token.

Before unbanning:

1. Load the source case by guild and internal ID.
2. Verify action, target, success status, duration, and expected token.
3. Return idempotently if a linked successful scheduled unban already exists.
4. Fetch the current Discord ban and compare its token marker.
5. If the token differs, treat the job as stale and do not remove a newer ban.
6. If it matches, execute a service-level unban and create one linked scheduled `unban` case.

Unexpected failures are reported and rethrown so BullMQ retries with backoff. Do not swallow errors and lose the scheduled action.

## 14. Remaining implementation corrections

The remediation also fixes:

- Missing warn settings return a localized `warnSettingsNotConfigured` error before any write.
- Ban hierarchy checks fetch the current member instead of trusting cache presence.
- Invalid ban durations return an error instead of becoming permanent bans.
- Error branches return immediately and never fall through to success rendering.
- Punishment services treat returned failure objects as failures.
- Warn lists exclude expired and revoked rows and show the public case number and case reason.
- Warn DMs are sent after durable persistence, report the correct resulting warn level, and cannot overflow Discord limits.
- The configured moderation log channel is used for warns, actions, reversals, approvals, dismissal, failures, automatic unbans, and dangerous-setting changes.
- Case and note views use real database pagination and grouped note counts instead of fixed-size truncation and N+1 queries.
- Moderation timestamps use integer epoch milliseconds. SQLite defaults use `(unixepoch() * 1000)`.
- Service APIs own database mutations; commands and interaction handlers do not directly update moderation tables.
- All new or materially rewritten moderation responses use Components v2 except an explicitly retained legacy paginator.
- Slash and message-command paths share the same services and validation.
- All visible strings are localized in `en-US`, `it`, and `es-ES` and use the normal `UserError` flow.

## 15. Command surface

The direct action commands remain direct:

```text
/warn <user> [reason] [amount] [advanced]
/heavywarn <user> [reason] [advanced]
/kick <user> [reason]
/ban <user> [reason] [duration] [delete-messages]
/unban <user-id> [reason]
/mute <user> <duration> [reason]
/unmute <user> [reason]
/warnings pending [user]
```

Move the existing `/warn list`, `/warn remove`, `/warn level set`, and `/warn multi` operations to:

```text
/warnings list <user>
/warnings remove <case-number> [reason]
/warnings level set <user> <level> [reason] [advanced]
/warnings multi <users> [reason] [amount] [advanced]
```

Use a two-deployment registration migration:

1. Introduce `/warnings` with management and pending operations while retaining the existing `/warn warn`, list, remove, level, and multi tree. Mark the old paths deprecated in command descriptions and responses.
2. After the replacement commands have propagated and the deprecation has been announced, replace the `/warn` tree with direct `/warn <user>`. Keep `/warnings` as the management surface.

Legacy message commands mirror the same service behavior where context allows. During the migration window, existing message syntax remains accepted as aliases.

Advanced warn uses the Redis-backed persistent workflow and previews the resulting warn level, crossed thresholds, automatic punishments, and pending punishments before confirmation.

## 16. Migration requirements

Use a new additive Drizzle migration.

The migration:

1. Adds safe-default warn settings.
2. Adds per-guild case numbers, operation keys, execution status, source, parent linkage, and failure metadata.
3. Adds the case-counter table.
4. Adds guild IDs and scoped foreign keys to notes and warning relationships.
5. Adds durable punishment batches, items, and attempt records.
6. Corrects moderation timestamp defaults and converts legacy text timestamps.
7. Backfills per-guild case numbers in stable order.
8. Seeds counters to each guild's maximum case number.
9. Adds constraints and indexes after validating the backfill.

Migration verification includes:

- No duplicate `(guildId, caseNumber)`.
- No null public case numbers.
- No cross-guild case, warning, note, or punishment relationships.
- No mixed text and integer moderation timestamps.
- `PRAGMA foreign_key_check` passes.

Do not silently repair ambiguous cross-guild legacy data. Stop and report it.

## 17. Recovery behavior

A startup or scheduled recovery task:

1. Finds punishment items left executing after their lease expires.
2. Reconciles Discord state.
3. Marks provably completed actions applied.
4. Returns provably unexecuted retryable actions to pending.
5. Moves ambiguous actions, especially kicks, to manual review.
6. Recalculates batch state and refreshes approval displays.

Message publishing and refresh are best-effort. They never roll back a successful moderation action or delete durable pending state.

## 18. Verification

### Settings and permissions

- Both settings default to false for new and migrated guilds.
- Presets never enable dangerous bypass.
- Every combination of the two global settings, `level.autoConfirm`, and issuer permissions matches the exact formula.
- A warn-only moderator cannot auto-ban under safe defaults.
- Dangerous bypass ignores only the warning issuer's missing action permissions.
- Partial approvers execute only their eligible subset.
- `Apply all` applies the eligible subset and retains the rest.
- Administrator still obeys role hierarchy.
- Guild owner bypasses actor hierarchy but not bot hierarchy.

### Persistence and concurrency

- Controls work after a process restart.
- Malformed, stale, cross-guild, or replayed custom IDs cannot mutate state.
- Redis selections are isolated by guild, batch, moderator, and revision.
- Two moderators cannot execute the same item.
- A more powerful moderator can later complete remaining items.
- Dismissal and its note are atomic and idempotent.

### Warning and case integrity

- Missing settings create no case or warning row.
- `3 -> 5` inserts two warning units.
- `5 -> 2` revokes three newest active units.
- `2 -> 2` is a no-op.
- Only upward crossings create punishment batches.
- Two guilds can both own case number 1.
- No command can resolve another guild's case by number.
- Cases, warning units, and notes are never hard-deleted by service operations.

### Punishment behavior

- One punishment renders `Apply punishment`.
- Multiple punishments render multi-select, `Apply selected`, `Apply all`, and `Dismiss`.
- A partial moderator cannot dismiss.
- A moderator eligible for every remaining item can dismiss.
- Dismissed items remain available through `/warnings pending`.
- Dismiss appends exactly one note authored by the acknowledging moderator.
- New configuration rejects kick plus ban.
- Legacy terminal combinations follow precedence and supersession rules.
- Returned `{ success: false }` results never count as success.
- A deleted role or departed target reconciles safely.

### Temporary bans and audit

- A matching token auto-unbans once and creates one linked case.
- A mismatched token never removes a newer ban.
- Retryable failures are rethrown for BullMQ retry.
- Every successful action includes a Discord audit-log reason and linked Pomelo case.
- Automatic policy actions are distinguishable from human-approved actions.

### Product verification

- Typecheck, lint, migration tests, integration tests, and locale-key parity pass.
- Components v2 payloads validate.
- Quickstart, warn, partial approval, dismissal, restart recovery, and slash fallback are tested through the real Discord UI in the Bot Testing server with at least two permission levels.

## 19. Acceptance criteria

The remediation is complete when:

1. A warning never grants undeclared punishment capability under safe defaults.
2. The dangerous behavior is explicit, default-off, confirmed, audited, and limited to issuer permission bypass.
3. Every crossed punishment is durably pending, atomically executing, or in an auditable terminal state.
4. Partial moderator permissions apply only the permitted subset.
5. Approval and quickstart controls survive restart through Sapphire interaction handlers.
6. Dismissal hides the active display, preserves slash application, requires full actor authority, and appends one authored note.
7. Every case and note operation is guild-scoped and immutable.
8. Warning level changes are exact, transactional, and concurrency-safe.
9. Temporary unbans cannot remove a newer ban.
10. All known critical and non-critical audit findings listed in this design are fixed and verified.
