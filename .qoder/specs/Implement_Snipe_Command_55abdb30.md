# Implement Snipe Command (POM-45)

## Context

POM-45 requests a "snipe" feature — showing the last deleted message in a channel. The issue emphasizes efficiency and suggests in-memory/local storage. This is a greenfield feature: no existing `messageDelete` listeners or snipe code exists in the codebase.

## Architecture

- **Storage**: Module-level `Map<string, SnipeEntry>` keyed by channel ID, storing one entry per channel. Entries auto-expire after a configurable TTL (default: 1 hour) via `setTimeout` to prevent stale data and unbounded memory growth.
- **Cache population**: A `messageDelete` listener captures deleted messages and stores them in the cache.
- **Display**: A `/snipe` utility command reads from the cache and displays the result in a public embed.
- **Scope**: Delete-only for the initial implementation. Edit snipe is deferred to a follow-up.

### Why these decisions

- **In-memory Map**: Matches the issue's guidance, zero dependencies, O(1) lookup/insert, ~400 bytes per entry.
- **1-hour TTL**: Long enough to be useful (people snipe minutes after deletion), short enough to prevent memory bloat. `setTimeout` with `.unref()` so timers don't block process exit.
- **Public reply**: Snipe is observable by others in the channel — same visibility as the original message.
- **Guild-only command**: Snipe is channel-scoped and requires guild context. Register with `GuildInstall` only.
- **No Partials.Message**: The bot already has `GuildMessages` + `MessageContent` intents, so messages are cached in normal operation. Adding the partial is unnecessary overhead.

---

## Task Breakdown

### Task 1: Create the snipe cache module

**File**: `src/lib/helpers/snipeStore.ts` (new)

- Define `SnipeEntry` interface:
  ```ts
  interface SnipeEntry {
    content: string;
    authorId: string;
    authorUsername: string;
    authorAvatarURL: string | null;
    attachments: { url: string; proxyURL: string; name: string; contentType: string | null }[];
    createdAt: Date;
    deletedAt: Date;
  }
  ```
- Export a module-level `Map<string, SnipeEntry>`.
- Export functions: `getSnipe(channelId: string): SnipeEntry | undefined`, `setSnipe(channelId: string, entry: SnipeEntry): void`, `clearSnipe(channelId: string): void`.
- `setSnipe` sets the entry and starts a `setTimeout` (1 hour) to auto-delete it. Use `.unref()` on the timer.
- Cap `content` at 4096 chars to bound memory.

### Task 2: Create the messageDelete listener

**File**: `src/listeners/snipe/cacheSnipe.ts` (new)

- Extend `Listener` from `@sapphire/framework`.
- Set `event: Events.MessageDelete` (from `discord.js`).
- Guard clauses:
  - Ignore partial messages (`if (message.partial) return`).
  - Ignore bot/system messages.
  - Ignore DMs (check `message.guild`).
  - Ignore messages with no content AND no attachments.
- Build a `SnipeEntry` from the message data and call `setSnipe(message.channelId, entry)`.

### Task 3: Add i18n keys

**Files to modify**:
- `src/lib/i18n/commands/utility.ts` — add `Snipe` key block with `T()` / `FT<{}>()` entries.
- `src/languages/en-US/commands/utility.json` — English translations.
- `src/languages/it/commands/utility.json` — Italian translations.
- `src/languages/es-ES/commands/utility.json` — Spanish translations.

**Keys needed**:
- `commandName` — "snipe"
- `commandDescription` — "Show the last deleted message in this channel"
- `noSnipeData` — "There's nothing to snipe here."
- Embed fields: `deletedBy`, `deletedAt`, `noTextContent`, `attachments`

All strings must follow Pomelo's voice (informal professional, 1st person) and be humanized per AGENTS.md §6.3.

### Task 4: Create the snipe command

**File**: `src/commands/utility/snipe.ts` (new)

- Extend `CommandUtils.PomeloCommand`.
- Constructor: description, `requiredClientPermissions: [PermissionFlagsBits.EmbedLinks]`.
- `registerApplicationCommands`: Register with `applyLocalizedBuilder`, `setIntegrationTypes([ApplicationIntegrationType.GuildInstall])` (guild-only).
- `chatInputRun`:
  1. `deferReply()` (public, not ephemeral — snipe is observable).
  2. Call `getSnipe(channelId)`.
  3. If nothing found: throw `UserError` with `identifier: LanguageKeys.Errors.NoneFound` and `context: { resource: "deleted message" }`, or reply with the localized `noSnipeData` key.
  4. If found: build embed with `EmbedUtils.EmbedConstructor`:
     - **Author**: message author username + avatar.
     - **Description**: message content, or localized "no text content" if attachment-only.
     - **Image**: first image attachment URL (if any).
     - **Color**: `Colors.Info` (blue — informational).
     - **Footer**: "Deleted <t:UNIX:R>" using `convertToDiscordTimestamp`.
  5. Reply via `this.reply(target, { embeds: [embed] }, { type: PomeloReplyType.Success })`.
- `messageRun`: Mirror the same logic for prefix command parity.

### Task 5: Verify and test

- Run TypeScript compilation (`bun run build`) to check for type errors.
- Run ESLint (`bun run lint`) to check for style violations.
- Optionally add unit tests for `snipeStore.ts` in `tests/snipe/snipe-store.test.ts`.

---

## Dependencies

```
Task 1 (cache module) ──┐
                         ├──> Task 2 (listener)
Task 3 (i18n keys) ─────┤
                         └──> Task 4 (command) ──> Task 5 (verify)
```

Tasks 1 and 3 can run in parallel. Task 2 depends on Task 1. Task 4 depends on Tasks 1 and 3. Task 5 depends on Tasks 2 and 4.

---

## File Change Summary

| File | Action |
|------|--------|
| `src/lib/helpers/snipeStore.ts` | **CREATE** — in-memory cache module |
| `src/listeners/snipe/cacheSnipe.ts` | **CREATE** — messageDelete listener |
| `src/commands/utility/snipe.ts` | **CREATE** — snipe command |
| `src/lib/i18n/commands/utility.ts` | **MODIFY** — add Snipe key block |
| `src/languages/en-US/commands/utility.json` | **MODIFY** — add English strings |
| `src/languages/it/commands/utility.json` | **MODIFY** — add Italian strings |
| `src/languages/es-ES/commands/utility.json` | **MODIFY** — add Spanish strings |

Total: **3 new files, 4 modified files**. No database changes, no new dependencies, no new preconditions.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Memory growth from unexpired entries | TTL (1 hour) via `setTimeout` with `.unref()`. Map bounded by channel count × 1 entry. |
| Partial messages in delete events | Guard with `if (message.partial) return`. |
| Attachment URLs expire after deletion | Store URLs as-is; CDN URLs remain valid for session lifetime. Acceptable trade-off. |
| NSFW content in snipe embed | Check `channel.nsfw` — if the deleted message was in an NSFW channel, do not show attachment images (or refuse to display). |
| Embed overflow from long messages | `EmbedConstructor` already trims to Discord limits. Cap stored content at 4096 chars as extra safety. |
| Snipe used in DMs | `GuildInstall`-only registration + guild context check prevents this. |

---

## Rejected Alternatives

| Alternative | Why Rejected |
|-------------|-------------|
| **Redis for snipe cache** | Issue explicitly says "doesn't cost much" and suggests in-memory. Redis adds network I/O overhead for ephemeral data. |
| **libSQL for snipe cache** | Same as above — persistent DB is overkill for volatile, per-channel data. |
| **Multiple entries per channel (multi-snipe)** | Over-engineering for initial implementation. Can be added later by changing Map value to a fixed-size array. |
| **Edit snipe in initial scope** | Increases complexity (needs `messageUpdate` listener, before/after content storage, subcommand). Defer to follow-up. |
| **Adding Partials.Message** | Bot already has `GuildMessages` + `MessageContent` intents. Messages are cached in normal operation. The partial adds overhead for edge cases. |
| **Ephemeral reply** | Snipe is traditionally public — everyone in the channel sees the deleted message. Ephemeral defeats the purpose. |
