# Mod Action Result Embeds Restyle

## Summary

Restyle every action-result embed in the new moderation commands (`src/commands/mod/`). Each embed gets a title describing the action performed, users are referenced as `@mention (username)`, and secondary information (reason, duration, punishments, DM status, warn history) moves from the description paragraph into embed fields. The warn count phrase drops `(count: N)` in favor of natural counting ("warned twice", "thrice", "N times").

This is a rendering-only change: no DB schema changes, no command option changes, no behavior changes.

## Motivation

The new mod commands render their results as one wall-of-text description with `user.tag` (`username#1234`) references, no title, and awkward phrasing like `(count: 2)` and `active warn(s)`. The result embeds are the primary feedback surface for moderators; they should read like a well-structured report, not a log line.

---

## Core Patterns

### 1. Titles

Every action-result embed gets `.setTitle(...)` with a localized action title. Most `title` keys already exist in `src/languages/{en-US,it,es-ES}/commands/moderation.json` but are never wired up; wiring them is part of this work. Missing titles (warn removed, multi-warn) are added to all three locales.

| Command / subcommand | Title key | Value (en-US) |
|---|---|---|
| warn, heavywarn, warns level set | `warn.title` (exists) | Warned |
| kick | `kick.title` (exists) | Kicked |
| mute | `mute.title` (exists) | Muted |
| unmute | `unmute.title` (exists) | Unmuted |
| ban | `ban.title` (exists) | Banned |
| unban | `unban.title` (exists) | Unbanned |
| note add | `note.addedTitle` (exists) | Note Added |
| note remove | `note.removedTitle` (exists) | Note Removed |
| warns remove | `warn.removedTitle` (new) | Warn Removed |
| warns multi | `warn.multiTitle` (new) | Warned {{count}} users |

Error embeds (`PomeloReplyType.Error`) keep their current description-only form and `Colors.Error` — the `commandDeniedHandler` owns error presentation.

### 2. User reference format

One helper produces the canonical user reference: `@mention (username)` — a raw Discord mention followed by the username in parentheses.

```ts
// src/lib/helpers/string.ts
export function userMention(user: { id: string; username: string }): string {
  return `<@${user.id}> (${user.username})`;
}
```

Replace every `user.tag` / `userTag` usage in the mod commands' result text with `userMention(...)`:

- `warnReply.ts` (desc sentence)
- `kick.ts`, `mute.ts`, `ban.ts` (desc sentences)
- `note.ts` (`addedDesc` usage, `listTitle`/`listEntry` usage)
- `case.ts` (`title` usage)
- `warns.ts` (`listTitle` usage)

Titles like "Cases for {{user}}" use the mention format too. Raw mentions do not ping from ephemeral replies.

### 3. Field layout

The description keeps exactly one friendly sentence with the mention. Everything secondary becomes fields, in this order:

| Command | Title | Description | Fields (in order) |
|---|---|---|---|
| warn / heavywarn / level set | Warned | `<@id> (username) has been warned [twice/thrice/N times]` | Reason, Punishment(s), DM, Warn history |
| kick | Kicked | `<@id> (username) has been kicked` | Reason, DM |
| mute | Muted | `<@id> (username) has been muted` | Duration, Reason, DM |
| unmute | Unmuted | `<@id> (username) has been unmuted` | Reason |
| ban | Banned | `<@id> (username) has been banned` | Reason, Duration (temp only), Messages deleted (only when set), DM |
| unban | Unbanned | `<@id> (username) has been unbanned` | Reason |
| warns remove | Warn Removed | — | Reason, Moderator |
| warns multi | Warned N Users | localized count sentence (no mention — multiple users) | User list (mentions, one per line) |
| note add | Note Added | `<@id> (username)` | Note |
| note remove | Note Removed | — | Note content, Moderator |

Field rules:

- Fields are omitted when their value is absent (no reason → no Reason field; permanent ban → no Duration field; etc.).
- Field names are inline (`inline: false`) so values have room; the User field is never needed because the description carries the mention.
- The DM status field value: "DM sent" / "Couldn't DM" — humanized, not raw ✓/✗.
- For unban, the target may no longer be resolvable as a member; use `<@id> (id)` fallback: mention renders the username client-side in Discord anyway, so `userMention` accepts a bare id object `{ id, username: id }` for that case.

### 4. Punishment fields (warn result)

Each punishment applied becomes its own field:

- **Single punishment**: field name `Punishment`.
- **Multiple punishments**: field names `Punishment 1`, `Punishment 2`, ... in execution order.
- Value: `<punishment label>` where label is localized — `Mute for 1h`, `Kick`, `Ban`, `Permanent ban`, `Role` — followed by a status marker:
  - `✅` applied
  - `❌` failed (+ short error when available)
  - `⏳` awaiting moderator confirmation (from the pending level dialog)
- When the punishment came from a warn-level trigger, the value appends `(at warn level N)`.

This replaces the current `Level N: ✅ Mute` description lines in `warnReply.ts`.

### 5. Count phrasing

New keys replace `desc`/`descWithReason`'s `(count: {{amount}})` suffix and the `warnedCount` line:

| Key | en-US |
|---|---|
| `desc` | `**{{user}}** has been warned` |
| `descTwice` | `**{{user}}** has been warned **twice**` |
| `descThrice` | `**{{user}}** has been warned **thrice**` |
| `descTimes` | `**{{user}}** has been warned **{{count}} times**` |
| `historyField` | Warn history |
| `activeCounts` | `**{{active}}** active · **{{expired}}** expired · **{{total}}** total` |
| `dmSent` / `dmNotSent` | DM sent / Couldn't DM (reused) |

- amount 1 → `desc`
- amount 2 → `descTwice`
- amount 3 → `descThrice`
- amount 4+ → `descTimes` with `count` = amount

heavywarn (amount 2) naturally renders "has been warned **twice**".

Italian: `è stato avvertito` / `è stato avvertito due volte` / `tre volte` / `{{count}} volte`. Spanish: `ha sido advertido` / `dos veces` / `tres veces` / `{{count}} veces`.

### 6. Warn history field (warn result embeds)

New field in warn/heavywarn/level-set results, last field:

```
**3 active · 2 expired · 5 total**
#12 — spam (expires in 5d)
#8 — nsfw (expires in 30d)
```

- Counts: active (not revoked, not expired), expired (not revoked, `expiresAt` in the past), total (all rows for the user in this guild).
- Recent: up to 3 most recent active warns, newest first, as `#{{id}} — {{reason}} (expires <t:...:R>)`. No expiry suffix for non-expiring warns.
- Backed by a new service method `getWarnHistory(guildId, userId)` in `src/lib/moderation/actions.ts` returning `{ active, expired, total, recent }`. Reason fallback: "No reason" (localized) when the warn has none.

### 7. i18n

- Every new key added to `src/languages/{en-US,it,es-ES}/commands/moderation.json` under the existing command blocks.
- New `LanguageKeys.Commands.Moderation.*` entries in `src/lib/i18n/commands/moderation.ts`.
- Every new/edited string gets the humanizer pass (§6.3 of AGENTS.md) before landing.
- Hardcoded English strings fixed while touching the files:
  - `warns.ts`: `"Warn removed."`, `"Warned ${successCount} user(s)."`, `"No reason"`, `"Never"`, `"Level ..."`-style strings
  - `mute.ts` messageRun: `"I couldn't find that user in this server."`, `"That duration is too long. The maximum is 28 days."`
  - `ban.ts` messageRun: `"I couldn't find that user in this server."`
  - `case.ts`: `"No reason"`, `"Unknown"`, `"note(s)"`, `Case #{{id}} - {{action}}` header

---

## Files Touched

| File | Change |
|---|---|
| `src/lib/helpers/string.ts` | Add `userMention()` helper |
| `src/lib/moderation/actions.ts` | Add `getWarnHistory()` |
| `src/lib/moderation/warnReply.ts` | Title + sentence + fields (Reason, Punishment(s), DM, Warn history) |
| `src/commands/mod/kick.ts` | Title + mention + fields |
| `src/commands/mod/mute.ts` | Title + mention + fields, localize messageRun strings |
| `src/commands/mod/ban.ts` | Title + mention + fields (incl. delete-messages + duration), localize messageRun strings |
| `src/commands/mod/heavywarn.ts` | Route through `handleWarnResult` (reuse warn reply) |
| `src/commands/mod/warns.ts` | Title + mention + fields for remove/multi, localize list strings |
| `src/commands/mod/note.ts` | Title + mention + fields for add/remove, mention in list titles |
| `src/commands/mod/case.ts` | Mention format in titles, localize inline strings |
| `src/lib/i18n/commands/moderation.ts` | New `LanguageKeys` entries |
| `src/languages/{en-US,it,es-ES}/commands/moderation.json` | New keys + humanized strings |

No changes to: the action methods in `src/lib/moderation/actions.ts` (warn/kick/mute/ban logic itself), DB schema, Redis schema, interaction handlers, or quick-action rows. The only addition to `actions.ts` is the new read-only `getWarnHistory()` method.

## Edge Cases

- **Unban with unresolvable user**: mention renders the ID; fall back to `{ id: userId, username: userId }`.
- **Ban of a user not in the guild**: `userMention` works off the `User` object (id + username are always present).
- **Warn with no threshold actions**: no Punishment fields; history field still shown.
- **Warn history with zero warns**: counts show `**0** active · **0** expired · **0** total`; no list lines.
- **Multiple levels triggered** (e.g. amount=2 crossed two levels): Punishment fields numbered across all applied punishments in execution order.
- **`warns list` / `case` / `note list`**: keep existing layouts; only the user reference format changes in titles/lines.

## Testing

- `bun run lint:fix` and typecheck clean.
- Manual sanity pass via the existing Discord bot: run warn (amount 1, 2, 3, 4+), heavywarn, kick, mute, unmute, ban (temp + delete-messages + permanent), unban, warns remove, warns multi, note add, note remove — verify title, mention format, field layout, count phrasing, and warn history in all cases.
- Verify no regressions in the warn-level confirmation dialog flow (it is untouched).
