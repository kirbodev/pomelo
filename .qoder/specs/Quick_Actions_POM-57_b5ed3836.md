# Quick Actions — POM-57 Implementation Plan

## Summary

Add a **QuickActionRowBuilder** that appends context-aware action buttons to moderation command replies. After a mod runs `/warn`, `/mute`, `/ban`, or `/kick`, the reply includes a row of buttons for follow-up actions (e.g., mute, kick, ban after a warn). The executing command's own action is excluded. Guild admins can configure up to 2 custom actions (add role, send message) via `/modsettings`. All button routing uses the existing `componentSessions.ts` persistent pattern for restart safety.

## Architecture Decisions

- **Persistence**: Use `componentSessions.ts` (not `workflowRepository.ts`) — each button click is independent, no multi-step state needed.
- **Storage**: Add `quickActions` field to existing `GuildSettings` in Redis (not a new schema key) — keeps hot-path reads simple and avoids new registration.
- **Ephemeral buttons**: Quick actions appear on the ephemeral reply (moderator-only). This matches the spec — quick actions are a moderator tool, not public.
- **Atomic claims**: Use `claimComponentSession()` for single-use actions to prevent double-execution.
- **Default behavior**: When no guild config exists, show all built-in actions except the executed one. Feature is opt-in for custom actions.

## Task Breakdown

### Task 1: Define types and Redis schema
**Files**: `src/lib/moderation/types.ts`, `src/db/redis/schema.ts`

- Add to `types.ts`:
  - `QuickActionBuiltin = "mute" | "kick" | "ban" | "warn"`
  - `QuickActionCustomType = "addRole" | "sendMessage"`
  - `QuickActionCustom = { type: QuickActionCustomType; label: string; roleId?: string; messageText?: string }`
  - `QuickActionSession = { guildId: string; moderatorId: string; targetId: string; executedAction: string; channelId: string }`
- Add to `GuildSettings` in `schema.ts`:
  - `quickActions: z.object({ hiddenActions: z.array(z.enum(["mute","kick","ban","warn"])).default([]), customActions: z.array(QuickActionCustomSchema).max(2).default([]) }).default({ hiddenActions: [], customActions: [] })`

**Dependencies**: None (foundational)

### Task 2: Create the QuickActionRowBuilder
**New file**: `src/lib/moderation/quickActionRow.ts`

- Export `buildQuickActionRow(opts)` function:
  - Input: `{ guildId, moderatorId, targetId, channelId, executedAction, t }`
  - Reads `GuildSettings.quickActions` from Redis
  - Builds list of built-in buttons: all of `["mute","kick","ban","warn"]` minus `executedAction` minus `hiddenActions`
  - Appends custom action buttons from guild config (up to 2)
  - Total max 5 buttons (Discord ActionRow limit)
  - Each button gets customId via `createComponentId("qa", sessionId, actionKey)`
  - Saves session via `saveComponentSession("qa", sessionId, sessionData, 900)` (15 min TTL)
  - Returns `{ row: ActionRowBuilder<ButtonBuilder> | null }` — null if no actions to show
- Button labels from i18n (`t(LanguageKeys.Commands.Moderation.QuickActions.*)`)

**Dependencies**: Task 1 (types), Task 5 (i18n keys for labels)

### Task 3: Create the interaction handler
**New file**: `src/interaction-handlers/quickAction.ts`

- Sapphire `InteractionHandler` with `InteractionHandlerTypes.Button`
- `parse()`: Check `parseComponentId("qa", customId)` — return `some({ sessionId, actionKey })` or `none()`
- `run()`:
  1. Load session via `getComponentSession("qa", sessionId)`
  2. Validate: guild exists, clicker is the original moderator, target still in guild, moderator has permissions for the action
  3. Route by action type:
     - Built-in (`mute`/`kick`/`ban`/`warn`): Call `modActionService.<action>()` with appropriate params. For `mute`, use a default duration (e.g., 10 minutes) since no duration was specified — or show a modal for duration input.
     - Custom `addRole`: Show a `RoleSelectMenuBuilder` (secondary interaction) or use pre-configured `roleId` from guild config
     - Custom `sendMessage`: Show a `ModalBuilder` for message content, or use pre-configured `messageText` from guild config
  4. Reply ephemerally with success/error embed
  5. Use `claimComponentSession()` for single-use built-in actions; custom actions with pre-configured data can be reusable (don't claim)
  6. Disable clicked button via `disableButtons()` if single-use

**Dependencies**: Task 1 (types/session schema), Task 2 (custom ID format)

### Task 4: Wire into mod command reply paths
**Files**: `src/commands/mod/warn.ts`, `src/commands/mod/mute.ts`, `src/commands/mod/ban.ts`, `src/commands/mod/kick.ts`, `src/lib/moderation/warnReply.ts`

- In each command's success reply, after building the embed:
  ```ts
  const quickActions = await buildQuickActionRow({ guildId, moderatorId, targetId, channelId, executedAction: "mute", t });
  // Then in reply:
  this.reply(target, { embeds: [embed], ...(quickActions.row ? { components: [quickActions.row] } : {}) }, { type: PomeloReplyType.Success });
  ```
- Specific injection points:
  - `warn.ts` / `warnReply.ts`: Inside `handleWarnResult()` at the `this.reply()` call (~line 101). Pass `executedAction: "warn"`.
  - `mute.ts`: In `executeMute()` at the reply call (~line 248). Pass `executedAction: "mute"`.
  - `ban.ts`: In `executeBan()` at the reply call (~line 233). Pass `executedAction: "ban"`.
  - `kick.ts`: In `execute()` at the reply call (~line 127). Pass `executedAction: "kick"`.

**Dependencies**: Task 2 (builder), Task 3 (handler must exist for buttons to route)

### Task 5: Add i18n keys
**Files**: `src/languages/en-US/commands/moderation.json`, `src/languages/it/commands/moderation.json`, `src/languages/es-ES/commands/moderation.json`, `src/lib/i18n/commands/moderation.ts`

- Add `QuickActions` section with keys for:
  - Button labels: `mute`, `kick`, `ban`, `warn`, `addRole`, `sendMessage`
  - Action results: `actionSuccess` (with `{action}` placeholder), `actionFailed`
  - Configuration: `configTitle`, `hiddenActions`, `customActions`, `maxCustomReached`, `addAction`, `removeAction`
  - Interaction prompts: `selectRole`, `enterMessage`, `interactionExpired`, `wrongUser`
- All strings must pass through the humanizer (AGENTS.md §1 rule 9)
- Map keys in `src/lib/i18n/commands/moderation.ts`

**Dependencies**: None (can proceed in parallel with Task 1)

### Task 6: Add configuration UI to `/modsettings`
**File**: `src/commands/mod/modSettings.ts`

- Add a "Quick Actions" section to the existing settings flow
- Allow admins to:
  - Toggle built-in actions on/off (via `StringSelectMenuBuilder` with multi-select)
  - Add up to 2 custom actions: pick type (`addRole`/`sendMessage`), set label, configure role or message text
  - Remove existing custom actions
- Save to `GuildSettings.quickActions` via `container.redis.jsonSet()`
- May need new interaction handlers for the configuration flow (modal for custom action details)

**Dependencies**: Task 1 (schema), Task 5 (i18n keys for config UI)

### Task 7: Tests
**New file**: `tests/moderation/quickActions.test.ts`

- Schema validation: hidden actions, custom action limits, defaults
- `buildQuickActionRow()` filtering: excludes executed action, respects hidden actions, caps at 5 buttons
- Session creation and TTL
- Interaction handler: permission validation, action routing, claim semantics

**Dependencies**: Tasks 1-3

## Execution Order

```
Task 1 (types/schema) ──┬──> Task 2 (builder) ──┬──> Task 4 (wire into commands)
                        │                        │
Task 5 (i18n) ──────────┤──> Task 3 (handler) ──┘
                        │
                        └──> Task 6 (config UI)

Task 7 (tests) ── after Tasks 1-3
```

Tasks 1 and 5 can start in parallel. Tasks 2 and 3 can start after Task 1. Task 4 needs both 2 and 3. Task 6 needs 1 and 5.

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Ephemeral reply + components | Ephemeral replies support components in discord.js. Only the moderator sees buttons — this is desired. |
| Double-click race condition | `claimComponentSession()` is atomic (Lua script). Second click gets "interaction expired". |
| `mute` quick action needs a duration | Use a sensible default (10 min) or show a duration modal. Recommend default for speed. |
| `warn` quick action needs an amount | Use default amount=1. The warn level confirmation flow in `warnReply.ts` already handles threshold escalation. |
| Custom ID length | `pm:qa:1:<nanoid(21)>:<action(~8)>` = ~35 chars. Well within 100-char limit. |
| Schema backward compat | Zod `.default()` on `quickActions` field means existing guilds without the key get empty defaults. |
| `kick` target is gone | After kick, the user left. Ban still works (ban by ID). Mute/warn don't apply. Builder should exclude inapplicable actions for kicked targets. |

## Rejected Alternatives

- **Separate Redis schema for QuickActions**: Adds a new key registration, more Redis calls per command. Storing in `GuildSettings` is simpler and already fetched.
- **`workflowRepository.ts` pattern**: Overkill — quick actions are stateless single-click operations, not multi-step workflows.
- **`ButtonConfirmationConstructor` (collector pattern)**: Not persistent — dies on restart. Quick actions must survive restarts since they appear on moderator replies.
- **Public (non-ephemeral) buttons**: Conflicts with `preferEphemeral`/`forceEphemeral` settings. Quick actions are a moderator tool; other users don't need access.
- **Components v2 for quick action row**: AGENTS.md says v2 for new files, but quick action buttons are `ActionRowBuilder<ButtonBuilder>` children inside an existing embed reply. v2 messages cannot mix with embeds. The row must use legacy ActionRow format since it accompanies an embed.
