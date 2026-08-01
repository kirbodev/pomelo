# Moderation System — Design Spec

> **Date:** 2026-07-13
> **Project:** Pomelo Discord Bot
> **Milestone:** Implement moderation commands (Linear)
> **Issues:** POM-46, POM-47, POM-49, POM-52, POM-58, POM-59, POM-60, POM-61, POM-64, POM-70

---

## 1. Architecture

### 1.1 Layered design

```
Commands (thin wrappers)
    ↓
ModActionService (abstraction layer)
    ↓
Discord API  ←  Database (libSQL)  ←  DM dispatcher
```

Each mod action (ban, kick, mute, warn) is **abstracted away from the command** via a shared `ModActionService`. Commands parse user input and render results; the service handles validation, execution, DMs, and logging.

### 1.2 Files

| Path | Role |
|---|---|
| `src/lib/moderation/actions.ts` | ModActionService — execute, DM, log |
| `src/lib/moderation/types.ts` | Shared types |
| `src/lib/moderation/errors.ts` | Moderation-specific error helpers |
| `src/commands/mod/ban.ts` | `/ban` + `/unban` |
| `src/commands/mod/kick.ts` | `/kick` |
| `src/commands/mod/mute.ts` | `/mute` + `/unmute` |
| `src/commands/mod/warn.ts` | `/warn`, `/heavywarn`, `/warn list`, `/warn remove`, `/warn level` |
| `src/commands/mod/warnSettings.ts` | `/warn settings` subcommands |
| `src/commands/mod/case.ts` | `/case` — caselogs |
| `src/commands/mod/note.ts` | `/note` — mod notes |
| `src/db/schema.ts` | libSQL tables (mod_cases, warns, warn_settings, case_notes) |
| `src/db/redis/schema.ts` | Redis — active warnings cache (optional) |

---

## 2. Database Schema (libSQL)

### 2.1 `mod_cases` — single table for all action types

| Column | Type | Notes |
|---|---|---|
| `id` | `integer` (PK, autoincrement) | Case number, per-guild counter |
| `guild_id` | `text` | Discord snowflake |
| `user_id` | `text` | Target user |
| `moderator_id` | `text` | Acting moderator |
| `action_type` | `text` | `ban` / `unban` / `kick` / `mute` / `unmute` / `warn` / `unwarn` / `note` |
| `reason` | `text` | Stated reason |
| `duration` | `integer` | ms for temp bans/mutes (nullable) |
| `dm_sent` | `integer` (`boolean`) | Whether DM reached target |
| `created_at` | `integer` (`timestamp_ms`) | |
| `updated_at` | `integer` (`timestamp_ms`) | |

### 2.2 `warns` — warn-specific data

| Column | Type | Notes |
|---|---|---|
| `id` | `integer` (PK, autoincrement) | |
| `case_id` | `integer` (FK → mod_cases.id) | |
| `guild_id` | `text` | |
| `user_id` | `text` | |
| `moderator_id` | `text` | |
| `warn_count` | `integer` | Position in sequence (1-based) |
| `expires_at` | `integer` (`timestamp_ms`, nullable) | null = permanent |
| `revoked` | `integer` (`boolean`) | |
| `revoked_by` | `text` (nullable) | |
| `revoked_at` | `integer` (`timestamp_ms`, nullable) | |

### 2.3 `warn_settings` — guild configuration

| Column | Type | Default | Notes |
|---|---|---|---|
| `guild_id` | `text` (PK) | — | |
| `max_warns` | `integer` | `10` | Max warn count before ban |
| `default_expiry_days` | `integer` | `3` | Per-count expiry |
| `dm_on_warn` | `integer` (`boolean`) | `true` | |
| `log_channel_id` | `text` | `null` | Optional log channel |
| `actions` | `text` (JSON) | `"[]"` | Threshold actions |
| `role_apply` | `text` (JSON) | `null` | `{ warnLevel: roleId, ... }` or `"all": roleId` |

**`actions` JSON shape:**
```ts
type WarnAction = {
  warnCount: number;        // threshold
  actionType: "mute" | "kick" | "ban" | "role" | "message";
  duration?: number;         // ms for mute/ban
  roleId?: string;           // for "role" action
  message?: string;          // template with {user}, {reason}, {count}, etc.
  messageTarget?: "dm" | "channel";
  channelId?: string;
  autoConfirm: boolean;      // auto-execute vs ask mod
};
```

**`role_apply` JSON shape:**
```json
{ "2": "role_id_for_level_2", "5": "role_id_for_level_5" }
// or
{ "all": "role_id_for_every_warn" }
```

### 2.4 `case_notes` — mod notes on actions

| Column | Type | Notes |
|---|---|---|
| `id` | `integer` (PK, autoincrement) | |
| `case_id` | `integer` (FK → mod_cases.id) | |
| `moderator_id` | `text` | Which mod wrote this note |
| `note` | `text` | Content |
| `created_at` | `integer` (`timestamp_ms`) | |

---

## 3. ModActionService (`src/lib/moderation/actions.ts`)

### 3.1 Interface

```ts
class ModActionService {
  async kick(guild, target, moderator, reason, options?): Promise<ModActionResult>
  async ban(guild, target, moderator, reason, options?): Promise<ModActionResult>
  async unban(guild, targetId, moderator, reason): Promise<ModActionResult>
  async mute(guild, target, moderator, duration, reason, options?): Promise<ModActionResult>
  async unmute(guild, target, moderator, reason): Promise<ModActionResult>
  async warn(guild, target, moderator, reason, options?): Promise<WarnActionResult>
  async unwarn(guild, caseId, moderator): Promise<ModActionResult>
  async setWarnLevel(guild, target, moderator, level, reason): Promise<WarnActionResult>
  async editDuration(caseId, newDuration): Promise<void>
  async addNote(caseId, moderatorId, note): Promise<void>
}
```

### 3.2 Execution flow (every action)

1. **Validate** — hierarchy check (can this mod act on this target?), bot permissions, target is not the bot, target is not a guild owner
2. **Execute** — Discord API call (for mutes via `member.timeout()`, bans via `guild.bans.create()`, etc.)
3. **Notify** — attempt DM to target with action + reason + server name. Catch failures silently (user may have DMs closed)
4. **Log** — insert into `mod_cases` (and `warns` for warns)
5. **Check thresholds** (warn only) — check if target now exceeds a warn threshold; if so, execute configured actions (auto or ask mod)
6. **Return** — `{ success: boolean, case: Case, dmSent: boolean, thresholdActions?: [...] }`

### 3.3 Temp bans — auto-unban

Temporary bans (those with a `duration` set) schedule a BullMQ task at ban time. When the duration expires, the task calls `ModActionService.unban()`. This ensures bans are automatically reversed without polling.

### 3.3 Warn-specific logic

- **Regular warn**: `amount` = number of warn counts. Creates that many `warns` rows, each with staggered expiry (count 1 at `now + expiry`, count 2 at `now + 2×expiry`, etc.)
- **Warn level set** (`/warn level set`): Sets `level` counts all expiring at the same time (`now + defaultExpiryDays`). Fires the punishment for that level.
- **Expiry check**: On any command that reads warns, expired entries are filtered out. Current warn level = count of active (non-expired, non-revoked) warns for that user+guild.
- **Threshold actions**: When warn level crosses a threshold (e.g., level 3 → mute), the configured action executes. If `autoConfirm: false`, a confirmation v2 dialog is sent to the mod first.

### 3.4 Editing durations

`editDuration(caseId, newDurationMs)` updates:
- `mod_cases.duration` for ban/mute cases
- `warns.expires_at` for warn entries (recalculates from now + newDuration)

---

## 4. Commands

### 4.1 Kick — `/kick <user> [reason]`

- Guild-only, `KickMembers` permission
- Required bot permission: `KickMembers`
- Calls `ModActionService.kick()`
- Response: v2 `ContainerBuilder` with result (user, reason, DM status)

### 4.2 Ban — `/ban <user> [reason] [duration] [delete_messages]`

- Guild-only, `BanMembers` permission
- Required bot permission: `BanMembers`
- `duration`: optional time string (e.g. `7d`, `24h`). If set → temp ban + POM-59 unban
- `delete_messages`: choices — `none`, `1d`, `3d`, `7d` (maps to `deleteMessageSeconds`)
- Blocks POM-59 (unban)
- Response: v2 `ContainerBuilder`

### 4.3 Unban — `/unban <user_id> [reason]`

- Guild-only, `BanMembers` permission
- Takes user ID string (user is not in guild)
- Calls `ModActionService.unban()`

### 4.4 Mute — `/mute <user> <duration> [reason]`

- Guild-only, `ModerateMembers` permission
- Required bot permission: `ModerateMembers`
- Uses Discord timeout (`member.timeout(durationMs, reason)`)
- Enforced: max 28 days (Discord limit)
- Blocks POM-58 (unmute)

### 4.5 Unmute — `/unmute <user> [reason]`

- Guild-only, `ModerateMembers` permission
- Removes timeout via `member.timeout(null)`

### 4.6 Warn — `/warn <user> [reason] [amount] [advanced]`

- Guild-only, `ModerateMembers` permission
- `amount`: integer 1-10, default 1
- `advanced`: boolean, default false. If true → opens a modal to edit every detail before issuing
- Heavywarn shorthand: detect as message command or slash alias

**Subcommands:**

| Command | Action |
|---|---|
| `/warn list <user>` | Shows active warns for user |
| `/warn remove <case_id>` | Revokes a specific warn |
| `/warn level set <user> <level> [reason]` | Sets warn level directly (all counts expire together) |
| `/warn multi <users> [reason] [amount] [advanced]` | Same warn to multiple users. `users` is a string option that accepts comma-separated mentions/IDs (e.g. `@user1 @user2` or `123,456,789`). Each user is warned individually through the service. |

### 4.7 Warn Settings — `/warn settings`

Subcommand tree:

| Subcommand | Action |
|---|---|
| `/warn settings` | View current config in a v2 container |
| `/warn settings max-warns <number>` | Set max warns (1-20) |
| `/warn settings expiry <days>` | Default expiry days |
| `/warn settings dm <boolean>` | Toggle DM on warn |
| `/warn settings log-channel <channel>` | Set log channel |
| `/warn settings actions` | Interactive action config (select menus + modals) |
| `/warn settings roles` | Configure role-per-warn-level |
| `/warn settings preset <name>` | Apply a preset |
| `/warn quickstart` | Interactive walkthrough setup wizard |

**Presets:**
- `mute>kick>ban` — mute at warn 3, kick at warn 5, ban at warn 10
- `mute>mute>ban` — mute at 3, mute again at 5, ban at 7
- `mute>mute>mute;ban` — mute...mute...mute+ban at 10
- `mute>mute>kick>ban` — mute/mute/kick/ban

### 4.8 Caselogs — `/case <user> [action_type]`

- Guild-only, `ModerateMembers` permission
- **Uses embeds** (PaginatedMessage) as specified — not Components v2
- Paginated: 5 cases per page
- Filterable by `action_type` (choices: `ban`, `kick`, `mute`, `warn`, `all`)
- Shows: case ID, action type, moderator, reason, DM status, timestamp
- If notes exist on a case, shows a note count indicator

### 4.9 Mod Notes — `/note <user> <note>`

**Subcommands:**

| Command | Action |
|---|---|
| `/note add <user> <note>` | Add a note (creates a mod_case of type "note") |
| `/note list <user>` | List notes in caselogs view |
| `/note remove <case_id>` | Remove (requires caselog reference) |

Notes appear in the user's caselogs, showing which mod wrote each note and when.

---

## 5. User Interface (Components v2)

All new command responses use **Components v2** (`MessageFlags.IsComponentsV2`), except caselogs (paginated embeds).

### 5.1 Action confirmation pattern

```
┌─ Container (accent: green/red) ─────────────────┐
│  TextDisplay: "**Banned** @user (`id`)"          │
│  ─── Separator (divider) ───                     │
│  TextDisplay: "**Reason:** spam"                 │
│  TextDisplay: "**Duration:** 7 days"             │
│  TextDisplay: "**DM sent:** ✅"                  │
│  ─── Separator (small) ───                       │
│  [ActionRow: Edit Duration] [Add Note]           │
└──────────────────────────────────────────────────┘
```

### 5.2 Warn threshold confirmation (autoConfirm: false)

When a warn triggers a threshold action that needs confirmation, a v2 dialog with confirm/cancel buttons appears for the mod.

### 5.3 Advanced warn flow

When `advanced: true` on `/warn` or `/warn multi`:

1. **Options modal** — fields: reason, amount, custom duration/custom expiry per count, custom punishments/roles to apply
2. **Preview v2 container** — shows full breakdown of what will happen: which warn counts are added, what thresholds are crossed, what actions will fire, total effective duration
3. **Confirm / cancel buttons** — mod reviews and confirms. Only on confirm does the warn actually issue

This applies to both single-target and multi-warn.

### 5.4 Quick-start wizard

Multi-step interactive:
1. Select a preset (buttons) → configures actions
2. Set max warns (select menu: 3, 5, 7, 10, 15, 20)
3. Set expiry (select menu: 1d, 3d, 7d, 14d, 30d)
4. Set log channel (channel select menu)
5. Review config (v2 container) → confirm to save

---

## 6. Error handling

| Scenario | Behavior |
|---|---|
| Target not in guild (kick/mute) | Localized error: "I couldn't find that user in this server" |
| Mod hierarchy too low | Error: "You can't action that user — they're above you in the role hierarchy" |
| Bot hierarchy too low | Error: "I can't action that user — I need a higher role" |
| Cannot DM target | Silently log `dm_sent: false`, continue |
| Duration exceeds 28d (mute) | Error: "Timeouts can't be longer than 28 days" |
| Warn settings not configured | Prompt mod to run `/warn quickstart` or `/warn settings` |
| Case not found (unwarn, edit) | Error: "I couldn't find that case" |
| Warn already revoked | Error: "That warn has already been removed" |
| Invalid target (self) | Error unless the mod action is allowed on self |
| Target is bot owner | Error: "I can't action the bot owner" |
| Discord API error (rate limit, etc.) | Generic error with Sentry logging |

---

## 7. Future / Deferred

These issues exist in Linear but are **lower priority** and can be tackled after the above is shipped:

| Issue | Why deferred |
|---|---|
| **POM-61** Modstats | Needs a meaningful history of cases first |
| **POM-64** Lock/lockdown | Independent feature, no DB dependency |
| **POM-73** Security analysis | Entirely separate concern |

---

## 8. Migration

No existing mod data to migrate (greenfield feature). Run `bun run db:generate && bun run db:migrate` to create new tables.
