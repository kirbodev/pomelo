# Warn Partial Success: Transactional Warns with Durable Threshold Execution

> **Date:** 2026-08-11
> **Project:** Pomelo Discord Bot
> **Scope:** Rework warn threshold execution so the warning increment always lands, and threshold punishments execute through the durable libSQL ledger with a single authoritative public card, read-only moderation log, and click-time authorization.

---

## Summary

Today the warning record is written before threshold execution, but live punishments bypass the durable ledger and failed work can be reported as complete. This design keeps the transactional warning write, then unifies all live threshold execution on the existing libSQL `warn_punishment_batches` / `warn_punishment_items` ledger. Every warn produces one public Components v2 result card in the command channel. When unresolved punishments remain, that card includes one "Apply all pending" button covering every crossed threshold from the warning operation. Pomelo also publishes read-only entries to the configured Discord moderation log. A new `/warnings pending` subcommand recovers warning operations whose card was deleted or lost. No unrelated refactors are included.

---

## Motivation

Code findings in the current implementation:

- `ModActionService.createWarn()` (`src/lib/moderation/actions.ts:230`) already records the warn case, the warning units, and the crossed threshold batches and items inside one transaction, so the warning increment is durable before any punishment runs. This is the correct foundation and stays.
- Live execution diverges from the ledger. `warn()` (`actions.ts:2270`) routes autoConfirm thresholds through the legacy `executeLevel()` / `executePunishment()` path, which runs `ban` / `kick` / `mute` / `role` directly with no capability adapter, no item claim, and no ledger state. After running, `settleLegacyExecutedBatch()` (`actions.ts:995`) flips every still-pending item in the batch to `superseded`, hiding items that were never attempted or that failed.
- Manual thresholds are disconnected from the ledger. `requestLevelConfirmation()` (`src/lib/moderation/warnReply.ts:242`) writes a `WarnLevelSession` to Redis and `warnLevelConfirm.ts` calls `executeLevel()` on confirm. This path never touches the durable ledger.
- The durable approval handler exists but is never wired. `src/interaction-handlers/warnApproval.ts` implements `pm:wa:1` custom IDs with a capability adapter, but nothing ever publishes the card: `displayChannelId` and `displayMessageId` on `warn_punishment_batches` are never written, and `createApprovalCustomId()` has no call site outside the handler itself.
- Operation keys are random. `warn()` passes `operationKey: crypto.randomUUID()` (`actions.ts:2297`) and `logCase()` uses `crypto.randomUUID()` (`actions.ts:1992`), so a retried interaction duplicates warnings instead of resolving the existing ledger result.
- "Apply selected" is broken. `applyEligibleItems()` (`actions.ts:895`) treats an absent or empty `itemIds` list as "all items" (`sql\`1 = 1\``), so an expired or empty selection applies everything.
- No pending recovery surface. `warns.ts` exposes `list`, `remove`, `level set`, and `multi` only. A deleted card leaves an unresolved batch unreachable.
- No message-command parity. `warn.ts:87` and `warns.ts:437` reply "Use the slash command /warn." instead of executing.
- Batch expiry is unused. `warn_punishment_batches.expires_at` exists (migration `0002`) but nothing writes it, and the batch is made inapplicable only inside `cancelInapplicableBatches()` on unwarn / level set. Natural warn expiry never reconciles batches.
- Raw errors leak. `punishmentResultLine()` (`levelConfirm.ts:44`) and `warnReply.ts:145` append `String(err)` to user-facing output.

---

## Goals

1. The warning increment and resulting warn level are recorded transactionally first and are successful even when threshold punishments are blocked or fail.
2. All live threshold execution, automatic and manual, runs through the durable libSQL ledger with capability-aware, idempotent, per-item execution.
3. One authoritative public Components v2 card per warning operation, with a single "Apply all pending" control when any crossed batch remains unresolved.
4. The configured Discord moderation log receives read-only initial and transition entries that link back to the live card.
5. Deterministic operation keys derived from the triggering interaction or message, so retries never duplicate warnings.
6. True message-command parity for `/warn`, `/warns`, and `/heavywarn`, including server-side user resolution.
7. `/warnings pending` recovery for deleted or failed display cards.
8. Uncertain Discord outcomes settle to `manual_review`, never blind retry, and no state is hidden behind `superseded`.

---

## Non-goals

- No per-batch time-based expiry. Batches remain actionable until completed, dismissed (baseline dismissal is retained), or made inapplicable because the active warning count falls below the crossed threshold.
- No new schema table is expected. Existing batches for one warn case can share the same display binding and be loaded by `warnCaseId`. If implementation proves that a schema change is safer, `bun run db:generate` and `bun run db:migrate` are required before merge.
- No privacy constraints on the card or the log. The card is public in the channel, and no ephemeral treatment is added.
- No change to the quickstart wizard, presets, or settings UX beyond what execution needs.
- No retry of uncertain Discord outcomes, and no automatic application of items the issuer cannot perform.
- No rewrite of unrelated embed code in the moderation commands.

---

## Approved decisions

### 1. The warning is recorded first, transactionally

`createWarn()` and the ledger-level `setWarnLevelLedger()` keep recording the case, the warning units, and the crossed batches and items in one transaction, exactly as today. Threshold execution is a separate phase after the transaction commits. A failure, block, or decline in the punishment phase never rolls back or degrades the warning increment. The final warn level shown in responses is always the committed ledger value, never affected by punishment outcomes.

### 2. One durable execution path

Retire live use of `executeLevel()` and `executePunishment()` for threshold execution in `warn()`, `setWarnLevelLegacy()`, and `warnLevelConfirm.ts`. Live execution, both automatic and after a click, goes through the ledger:

1. `claimPunishmentItem()` atomically claims the item (version, lease, attempt row).
2. The `PunishmentCapabilityAdapter` applies the punishment.
3. `completeClaim()` writes the terminal or retryable state, the execution case, the attempt outcome, and refreshes the batch state.

Retire the Redis `WarnLevelSession` / `WARN_LEVEL_FEATURE` path for threshold execution. `warnLevelConfirm.ts` and its `requestLevelConfirmation()` helper are removed; their buttons are replaced by the public ledger card. Existing Redis sessions expire naturally via their TTL and are not migrated.

### 3. autoConfirm capability semantics

When an autoConfirm threshold is crossed:

- If `dangerouslyBypassWarnPermissions` is `false`, immediately apply only the items the issuer has full runtime authority to perform (permission, hierarchy over target, role hierarchy, and not targeting self or an administrator) and that the bot can perform (permission, bot hierarchy over target and role). Blocked items stay durable and `pending` on the public card.
- If `dangerouslyBypassWarnPermissions` is `true`, preserve current bypass semantics: skip only the issuer permission check. Bot capability, bot hierarchy, target validity (self, administrator), role hierarchy, and mute duration still apply, and blocked items stay `pending`.
- Automatic execution never applies an item the bot cannot perform. A bot-level blocker is a configuration defect, recorded on the card, not a click problem.

This replaces the current all-or-nothing check in `applyEligibleItems()` (`actions.ts:929`), which applies nothing when any item fails validation.

### 4. Manual thresholds stay fully manual

An `autoConfirm: false` threshold never executes automatically. The warning is recorded, and all items of that level stay `pending` on the public card until a moderator with full authority clicks "Apply all pending". Nothing about the quickstart's per-level `autoConfirm` setting changes.

### 5. One public command card per warning operation

Every warn response is public in the channel where the warn was created, for both slash and message commands. A fully settled warning shows its completed result without controls. A warning with unresolved punishments shows the same result plus the live approval controls:

- Slash: the command defers without `MessageFlags.Ephemeral`, then edits that public reply.
- Message: `message.reply()` renders the card publicly.

One warning can cross several configured thresholds and create several batches. The response card aggregates every batch created by the warn case. Each unresolved batch stores the same `displayChannelId` and `displayMessageId`, so the handler can bind the complete warning operation to the exact message without adding another table. The lowest unresolved batch ID is the control anchor used in the opaque custom ID; the handler loads all sibling batches by `warnCaseId` and never trusts the anchor as the complete authorization scope. `MessageFlags.IsComponentsV2` is combined with no ephemeral flag.

The card carries one primary control: "Apply all pending". It covers every actionable item across every sibling batch from the warn case. Baseline dismissal is retained as a secondary control and dismisses every unresolved sibling batch in one transaction. Only one live control message exists per warning operation. Re-publishing through `/warnings pending` replaces the binding on every unresolved sibling, bumps their revisions, and makes the old message fail the binding check.

### 6. Read-only Discord moderation log

When `warnSettings.logChannelId` points to a usable text channel, Pomelo publishes a read-only Components v2 log entry for the initial warn result and each later material state transition: items applied, batch dismissed, batch made inapplicable, or manual review required. Each entry includes actor attribution, a Discord timestamp, the case number, and a link to the live card (`https://discord.com/channels/{guild}/{channel}/{message}`). Log entries never carry action buttons and are never edited into a second approval surface. Unauthorized button clicks do not create Discord log spam because they do not change durable state.

The libSQL attempt rows and case notes remain the durable audit source. Discord log delivery is a best-effort projection of that source. A missing log channel or a failed log send cannot roll back the warning or punishment result; Pomelo records the delivery failure through the existing logger and Sentry path without exposing a raw error to moderators.

### 7. Apply all authorization and atomic claim

"Apply all pending" authorizes against every still-pending item across every sibling batch for the warn case. A pending item is one in `pending` or `retryable_failed`; items already `applied`, in `manual_review`, or cancelled are not part of the scope.

At click time the handler re-fetches, from Discord, the actor, the target, the bot member, roles, the guild and message binding, the batch revision, and the warning level behind the batch. Full authority over all pending items is required before any side effect:

- If the actor lacks authority for any still-pending item, nothing is applied and the clicker gets a localized ephemeral reason naming the blocker.
- If all pending items authorize, every sibling batch revision is claimed in one database transaction, then each item is executed with per-item revalidation through the capability adapter and idempotent claims (version + lease + `pendingPunishmentExecutions` dedupe). A concurrent or repeated click returns the actual recorded result instead of double-applying.

An unauthorized click must not partially apply a subset.

### 8. No time-based expiry

By user choice there is no time-based expiry for batches. A batch stays actionable until it is completed, dismissed, or made inapplicable. It becomes inapplicable when the warning state no longer reaches its threshold:

- The warn behind it is removed (`unwarn`, level decrease, existing `cancelInapplicableBatches()`).
- Active warns fall below the threshold, including natural warn expiry, reconciled by a periodic pass.

Target absence, bot permission, hierarchy, and repairable configuration problems are live blockers, not expiry. They remain visible and can be retried after staff fix the underlying problem. A permanently invalid punishment, such as a deleted configured role ID, becomes `terminal_failed` and requires settings repair rather than repeated clicks. Reconciliation and click-time validation prevent stale actions. A card is never auto-closed by a clock.

### 9. Deterministic operation keys

Operation keys derive from the triggering interaction or message context, not randomness:

```
warn:<source>:<guildId>:<channelId>:<messageId>:<authorId>:<targetId>
```

- Slash: `source` is `slash`, `messageId` is the interaction id. Discord retries of the same interaction reuse the same id.
- Message command: `source` is `message`, `messageId` is the command message id.

The existing unique index `(guild_id, operation_key)` on `mod_cases` and `getExistingLedgerResult()` make retries resolve the committed ledger result instead of inserting duplicate warns. Batch operation keys keep the current `{operationKey}:threshold:{level}` suffix. Ledger-phase keys (`warn-batch-dismiss`, `punishment:{itemId}:attempt:{n}:result`) stay deterministic as they already are.

### 10. Message-command parity

`warn.ts`, `warns.ts`, and `heavywarn.ts` get real `messageRun()` implementations mirroring `chatInputRun`, per AGENTS.md section 4. Arguments parse through Sapphire `Args`. User resolution follows the AGENTS.md order: mention, user id, strict username match, then lazy username search, with a confirmation dialog when a lazy match resolves for a moderation action. All execution paths share the same ledger and card rendering, so slash and message commands produce identical results and the same public card.

### 11. `/warnings pending` recovery

Add a `pending` subcommand to `warns.ts` that groups unresolved batches by warn case and lists each warning operation once: target, case, crossed thresholds, reason, and item summary. Selecting an operation re-publishes one aggregate card as a new public message in the channel where the warn was created, writes that display binding to every unresolved sibling batch, bumps all sibling revisions, and logs the transition. The old card, if it still exists, stops working because its message ID no longer matches the binding. This is the recovery path for deleted or failed display cards.

---

## State model and UX

### States

Batch states used on the card:

| State | Meaning |
|---|---|
| `pending` | No item applied yet. |
| `partially_applied` | At least one item applied, others still actionable. |
| `completed` | All items terminal and accounted for (applied, cancelled, inapplicable). |
| `failed` | At least one item is `manual_review` or `terminal_failed` and needs human attention. |
| `cancelled` | Dismissed or made inapplicable because the warning no longer reaches the threshold. |

Item states: `pending`, `executing`, `applied`, `cancelled`, `inapplicable`, `retryable_failed`, `terminal_failed`, and `manual_review`. `superseded` is removed as an outcome that hides work: a failed or unattempted item is never settled as `superseded`. Existing `superseded` rows from the legacy path are treated as terminal record-only during migration (see Migration plan) and are not re-queued.

Ban precedence is deterministic: ban items execute before other items in a batch, and a kick item is never hidden as `superseded`. A kick behind a pending or temporary ban stays `pending`. A kick behind an applied permanent ban settles to `cancelled` with a blocker note, visible on the card and in the log.

Uncertain Discord outcomes (timeout, unknown error, unresolved REST result) settle to `manual_review` and are never blindly retried. `retryable_failed` is reserved for confirmed-transient, confirmed-not-applied outcomes. The existing `recoverExpiredClaims()` task (`src/scheduled-tasks/recoverWarnPunishments.ts`) is kept as the model for lease expiry settling to `manual_review`.

### Card rendering

- Accent `Colors.Warning` while unresolved (`pending`, `partially_applied`).
- Accent `Colors.Success` when `completed`.
- Accent `Colors.Error` when `failed` / `manual_review`.
- Accent `Colors.Default` for `cancelled` / `inapplicable`.

The card always shows: target, warn case number, reason, warning increase and resulting warn level, applied items, pending items, manual-review items, and blockers. Blockers are localized human strings mapped from failure codes, never raw `String(err)` or stack traces. Actor attribution appears for the warn and for every transition that changed state.

Reconciliation: extend the periodic recovery task (or add a sibling task) to scan unresolved batches, recompute each target's active warn count (respecting natural expiry), and cancel batches whose threshold exceeds the active count, marking items `inapplicable` and logging the transition. This closes the stale-warning gap left by `cancelInapplicableBatches()` only firing on unwarn and level set.

Bot and configuration blockers (bot hierarchy too low, bot missing a permission, role deleted, invalid mute duration, settings not configured) are recorded on the card as blockers. They cannot be fixed by another moderator clicking Apply all because the bot's capability and the configuration are identical for every clicker. Repairable blockers remain pending so staff can fix the setting or hierarchy and try again. Permanently invalid item snapshots become `terminal_failed` and require a new configured threshold rather than a blind retry.

---

## Current implementation critique

The existing code has a strong transactional core and a sound capability adapter, but the production routes bypass them:

- **Strong:** `createWarn()` records the warning and ledger atomically; `createCrossedBatches()` derives deterministic batch operation keys; the `PunishmentCapabilityAdapter` in `warnApproval.ts` models actor, target, bot, role, and permissions; `claimPunishmentItem()` uses version + lease + attempt rows for safe claims; `recoverExpiredClaims()` correctly routes lease expiry to `manual_review`.
- **Legacy executor in production:** `warn()` and `setWarnLevelLegacy()` route autoConfirm execution through `executeLevel()`, a permission-blind executor that never consults the adapter and never touches item state. The ledger is then whitewashed by `settleLegacyExecutedBatch()`, which marks unattempted and failed items `superseded`. A failed punishment is therefore invisible to every surface except a raw string in the response embed.
- **Failures settled as superseded:** `recordUnclaimedOutcome()` accepts `superseded` as a terminal state, and the kick-behind-ban path writes `superseded` with `banPrecedesKick`, deleting the item from every recovery surface.
- **Manual confirmation disconnected:** the Redis `warnLevelConfirm` flow executes levels without the ledger, so a manual threshold's items stay `pending` in libSQL forever while the punishment runs outside it.
- **Approval card never published or bound:** `warnApproval.ts` renders and routes the durable card, but no code publishes it; `displayChannelId` / `displayMessageId` are never written, so the message binding check can never pass.
- **Random operation keys:** `crypto.randomUUID()` in `warn()` and `logCase()` defeats the `(guild_id, operation_key)` uniqueness guarantee and the `getExistingLedgerResult()` recovery path.
- **No pending fallback:** a deleted or failed card leaves unresolved batches unreachable; there is no list or re-publish surface.
- **Stale warning cancellation gaps:** batches are cancelled only on unwarn and level set; natural warn expiry leaves inapplicable batches actionable.
- **Raw errors:** `punishmentResultLine()` and `handleWarnResult()` append `String(err)` to user-facing output.
- **Apply-selected empty means all:** an empty or expired selection flows into `applyEligibleItems()` and applies the entire batch.
- **Broken message parity:** `messageRun` implementations reply "Use the slash command /warn.".

---

## Migration plan

Preserve current dirty user changes. Nothing resets `warn_settings`, Redis workflows, or ledger data.

1. Ship the new execution path behind the existing settings; no feature flag change is required because `autoApplyWarnPunishments`, `autoConfirm`, and `dangerouslyBypassWarnPermissions` already gate behavior.
2. Existing unresolved batches (`pending`, `partially_applied`, `failed`) stay actionable under the new path with no data change. Their cards are published lazily: `/warnings pending` lists them, and re-publishing binds a card.
3. Existing `superseded` items from the legacy executor are treated as terminal record-only. They are not re-queued and not relabeled, so no user-visible history changes.
4. Redis `wl` sessions expire naturally via TTL; the `warnLevelConfirm.ts` path is removed from code, not from Redis.
5. Any batch whose threshold now exceeds the target's active warn count is cancelled by the first reconciliation pass, not by a data migration.
6. No schema migration is expected. All batches from one warn case share the aggregate card binding, and the handler loads them by `warnCaseId`. If implementation proves otherwise, run `bun run db:generate` and `bun run db:migrate` and include the generated migration.

Avoid unrelated refactors: the quickstart wizard, presets, and settings viewers are untouched except for strings they share with the card.

---

## Testing

- **Service, state, idempotency, concurrency:** ledger transaction commits before execution; duplicate operation keys resolve the existing result; `claimBatchRevision()` serializes concurrent Apply all clicks; concurrent item claims do not double-apply; lease expiry settles to `manual_review`; batch state refresh transitions `pending` to `partially_applied` to `completed`.
- **Interaction handler, payload, auth:** custom ID parsing and routing; guild, message, channel, and all sibling revisions reject clicks on stale or foreign cards; a multi-threshold warn renders one aggregate card; unauthorized clicks apply nothing and return the localized ephemeral reason; authorized clicks require full authority over every pending item across every crossed threshold before any side effect; per-item revalidation at click time.
- **Regression:** the Apply-selected empty-selection bug is fixed, meaning an empty selection never applies all.
- **Localization:** every new string exists in `en-US`, `it`, and `es-ES`, humanized per AGENTS.md rule 9, and blockers map failure codes to localized prose with no raw errors.
- **Logging:** every transition writes an attempt row or case note with actor, timestamp, and failure code; the configured Discord log channel receives a read-only Components v2 entry linking to the live card; log delivery failure does not change the moderation result.
- **No-expiry validity:** batches remain actionable after arbitrary idle time; stale actions are prevented by reconciliation and click-time validation, not a clock.
- **Message / slash parity:** `/warn`, `/heavywarn`, `/warns level set`, and their message-command forms produce the same ledger, the same public card, and the same recovery behavior; lazy username resolution confirms before acting.
- **Real Discord UI:** in the Bot Testing server, with a warn-only moderator (ModerateMembers only) and a fully authorized moderator: verify partial success on autoConfirm with blocked items left pending; Apply all with full authority; Apply all by an unauthorized moderator applies nothing; manual thresholds stay pending until clicked; `/warnings pending` recovers a deleted card; uncertain outcomes land in `manual_review`; bot and config blockers render as localized blockers.

---

## Changelog

A changelog entry is required in `src/changelog.ts` describing: warnings now record transactionally first, threshold punishments run through the durable ledger with partial success, one public Apply-all card per unresolved batch, `/warnings pending` recovery, deterministic retry-safe operation keys, and full message-command parity.

---

## Acceptance criteria

- [ ] A warn whose threshold punishment is blocked still records the warning increment and resulting level; the response never reports the warn as failed.
- [ ] All live threshold execution goes through the ledger; `executeLevel()` and `warnLevelConfirm.ts` are retired for threshold use.
- [ ] With `dangerouslyBypassWarnPermissions` false, autoConfirm applies only items the issuer and bot can fully perform, and leaves the rest `pending`.
- [ ] With bypass true, only the issuer permission check is skipped; bot capability and target validity still apply.
- [ ] Manual thresholds never auto-execute.
- [ ] Every warn produces a public card in the warn channel for slash and message commands; unresolved punishments add the live controls.
- [ ] A warn crossing several thresholds still produces one aggregate card and one "Apply all pending" primary control, plus the retained baseline dismiss control.
- [ ] Apply all requires full authority over every still-pending item across all crossed thresholds at click time; an unauthorized click applies nothing and returns a localized ephemeral reason.
- [ ] The configured Discord moderation log is read-only, records the initial result and later transitions with actor attribution, and links back to the live card.
- [ ] Batches have no time-based expiry and remain actionable until completed, dismissed, or made inapplicable by warn removal or active-level decrease; reconciliation covers natural warn expiry while live capability problems remain explicit blockers.
- [ ] Operation keys are deterministic per triggering interaction or message; retries resolve the existing ledger result without duplicate warns.
- [ ] `warn.ts`, `warns.ts`, and `heavywarn.ts` implement true message-command parity with AGENTS.md user resolution.
- [ ] `/warnings pending` lists unresolved batches and re-publishes cards for deleted or failed display messages.
- [ ] `superseded` never hides a failed or unattempted item; uncertain Discord outcomes settle to `manual_review`; ban precedence is deterministic and visible.
- [ ] No raw errors reach user-facing output; every blocker is localized in all three locales and humanized.
- [ ] The Apply-selected empty-selection bug is fixed.
- [ ] The full test matrix in the Testing section passes, including real Discord UI with warn-only and fully authorized moderator roles.
- [ ] Changelog entry added; no schema migration unless proven necessary, in which case `db:generate` and `db:migrate` run.
