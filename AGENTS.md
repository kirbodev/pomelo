# AGENTS.md — Pomelo

This file is the **source of truth** for any AI agent working on the Pomelo codebase. The design rules are grounded in the [Notion Brand Book](https://app.notion.com/p/ee2780ffb9684b64b604554e8627e0ee) and the existing code patterns in `src/`.

> **Mission:** Create a reliable Discord bot with a consistent, good UI/UX.
> **Vision:** Become the "Arc Browser" of Discord bots — a modern alternative that doesn't have to conform to legacy standards.

Pomelo is **alpha-stage** QOL-first Discord bot, built on **Sapphire** + **discord.js v14**, using a dual-database (Redis + libSQL/Turso) stack. Refer to `README.md` for the user-facing summary.

---

## 1. Core principles (read first, never violate)

1. **Modern-first.** Always prefer the newest Discord feature that solves the problem. If a legacy pattern (`message.content` parsing, `MessageEmbed` JSON, un-paginated lists) can be replaced with a 2024+ Discord feature, do it.
2. **User-installable by default.** Every chat-input command must be registered with **both** `ApplicationIntegrationType.GuildInstall` and `ApplicationIntegrationType.UserInstall` unless it *requires* guild context (e.g. moderation). See `src/commands/utility/afk.ts:55`.
3. **Ephemeral-by-default.** Replies that show only one user state (settings, errors, AFK results, help) are `MessageFlags.Ephemeral`. Only make a reply public when the action is observable by others (AFK set in a public channel, moderation log, public announcement).
4. **Validate, never trust.** Client data (usernames, display names, role names, channel names) is user-controlled. Resolve IDs server-side and re-fetch on use.
5. **i18n always.** Every user-facing string lives in `src/languages/<locale>/...` and is referenced via `LanguageKeys.*`. Never inline a string.
6. **Dual-DB aware.** Hot/frequent data (AFK state, settings, cooldowns) → **Redis** via `container.redis.json*`. Persistent/relational data (devs, OAuth tokens, persistent logs) → **libSQL** via `db` (drizzle). See `src/db/redis/schema.ts` and `src/db/schema.ts`.
7. **No breaking changes without a migration plan.** Pomelo is in alpha with active servers. Adding a `Settings` field? Default it. Renaming a key? Migrate on read.
8. **The Brand Book is law.** Colors, typography, writing style, and UI primitives come from Notion, not from the LLM's taste. When in doubt, look it up.
9. **Humanize all user-facing text.** Every string the user reads — error messages, embeds, modals, button labels, descriptions, replies, confirmations — must be run through the **humanizer** skill before it lands. If you wrote it, run it through humanizer. If you changed a key, run the *whole* string through humanizer. If it sounds like a press release, a chatbot, or anything with an em-dash habit, rewrite it. Pomelo's voice is informal professional, 1st person, friendly assertive — see §6.3. No string ships un-humanized.

---

## 2. Tech stack (do not introduce alternatives)

| Concern | Tool | Where |
|---|---|---|
| Bot framework | Sapphire 5 + `@sapphire/plugin-*` | `package.json:67-99` |
| Discord lib | discord.js v14 | `package.json:82` |
| Runtime | Bun | `scripts/chokidar.js`, `package.json:13-17` |
| Build | SWC | `package.json:9-10` |
| Cache + hot data | Redis (ioredis) + JSON modules | `src/db/redis/` |
| Persistent data | libSQL / Turso + Drizzle | `src/db/` |
| Background jobs | BullMQ (`plugin-scheduled-tasks`) | `src/scheduled-tasks/`, `src/index.ts:151` |
| i18n | i18next via `@sapphire/plugin-i18next` | `src/lib/i18n/` |
| Validation | Zod | `src/lib/helpers/zod.ts` |
| Analytics | PostHog | `src/handlers/commandFinishHandler.ts` |
| Errors / tracing | Sentry (`@sentry/bun`) | `src/index.ts:18-34` |
| Lint / format | ESLint + Prettier + husky + lint-staged | `package.json:25-30` |

Do not add: Express, Koa, Fastify, Prisma, TypeORM, axios, lodash, moment, chalk. Use `discord.js`, `@sapphire/utilities`, and `luxon` instead.

---

## 3. Project structure

```
src/
├── arguments/        # Custom Sapphire Args (duration, attachment, boolean)
├── commands/
│   ├── dev/          # DevCommand — gated by OwnerOnly + OTP
│   ├── utility/      # PomeloCommand — user-facing features
│   └── mod/          # ModCommand — moderation (uses ModCommand base)
├── handlers/         # Error/finish handlers wired into listeners
├── interaction-handlers/  # Custom ID / autocomplete handlers
├── listeners/        # Event listeners (ready, afk/*, errors/*, analytics/*)
├── preconditions/    # OwnerOnly, MaintenanceMode, SendAnalytics
├── scheduled-tasks/  # BullMQ recurring jobs
├── db/               # Drizzle schema, Redis schema, JSON helpers
├── lib/
│   ├── colors.ts     # Brand color enum — single source of truth
│   ├── emojis.ts     # Custom Discord emoji strings
│   ├── i18n/         # languageKeys, locales, helpers
│   └── helpers/      # ms, timestamp, zod, string, afk
├── languages/        # en-US, it, es-ES translation JSON
└── utilities/        # commandUtils, embedUtils, componentUtils (Sapphire Utilities)
```

**Top-level rules:**

- New user-facing command → `src/commands/utility/`
- New moderation command → `src/commands/mod/` and extend `CommandUtils.ModCommand`
- New dev command → `src/commands/dev/` and extend `CommandUtils.DevCommand` (auto-applies `OwnerOnly`)
- New event listener → `src/listeners/<category>/<name>.ts` (mirroring existing layout)
- New translation key → edit **all three** locales: `en-US`, `it`, `es-ES`

---

## 4. Command conventions

Every command extends one of three base classes from `src/utilities/commandUtils.ts`:

| Class | Use for | Notes |
|---|---|---|
| `CommandUtils.PomeloCommand` | User-facing QOL commands | Has `reply()`, `error()`, `getUserSettings()`, `isUserEligible()`. See `src/commands/utility/afk.ts:20`. |
| `CommandUtils.PomeloSubcommand` | Subcommand trees (e.g. `settings`) | See `src/commands/utility/settings.ts:112`. |
| `CommandUtils.ModCommand` | Moderation commands | Same as `PomeloCommand`, semantically grouped. |
| `CommandUtils.DevCommand` | Dev-only commands | Auto-applies `OwnerOnly` precondition + OTP verification via `verifyDev()`. See `src/commands/dev/eval.ts` for the `verifiedXxxRun` pattern. |

**Skeleton (use this as a starting point):**

```ts
import { Command, Args } from "@sapphire/framework";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import {
  ApplicationIntegrationType,
  Message,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";

export class MyCommand extends CommandUtils.PomeloCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Short user-facing description",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      detailedDescription: {
        syntax: "<required> [optional]",
        examples: ["", "an example", "another 10m"],
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const nameLocs = getOptionLocalizations(
      LanguageKeys.Commands.Utility.My.optionName,
      LanguageKeys.Commands.Utility.My.optionDescription
    );

    registry.registerChatInputCommand((builder) =>
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Utility.My.commandName,
        LanguageKeys.Commands.Utility.My.commandDescription
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([
          ApplicationIntegrationType.GuildInstall,
          ApplicationIntegrationType.UserInstall,
        ])
        .addStringOption((o) =>
          o
            .setName(nameLocs.englishName)
            .setNameLocalizations(nameLocs.names)
            .setDescription(nameLocs.englishDescription)
            .setDescriptionLocalizations(nameLocs.descriptions)
            .setRequired(true)
        )
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const value = interaction.options.getString("value", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.execute(interaction, value);
  }

  public override async messageRun(message: Message, args: Args) {
    const value = await args.pick("string");
    await this.execute(message, value);
  }

  private async execute(target: Command.ChatInputCommandInteraction | Message, value: string) {
    const t = await fetchT(target);
    // ... logic ...
    return this.reply(
      target,
      { embeds: [/* EmbedConstructor */] },
      { type: PomeloReplyType.Success }
    );
  }
}
```

**Mandatory patterns:**

- **Always localize** command + option names/descriptions via `applyLocalizedBuilder` + `getOptionLocalizations`. See `src/commands/utility/afk.ts:33-84`.
- **Always `deferReply({ flags: MessageFlags.Ephemeral })`** for chat input before doing any work that may take >1s.
- **Always go through `this.reply(...)`** — never call `interaction.reply()` directly. `reply()` honors user/guild `preferEphemeral`/`forceEphemeral` settings, the `Sensitive` reply type, and edits deferred replies. See `src/utilities/commandUtils.ts:271-315`.
- **Always go through `this.error(...)`** for user-facing errors — it pushes through the `commandDeniedHandler` which localizes and formats with the right color. See `src/utilities/commandUtils.ts:178-197` and `src/handlers/commandDeniedHandler.ts`.
- **Mirror `chatInputRun` and `messageRun`**: every command must work as both a slash command AND a legacy message command (`;command ...`) unless context prevents it. Pomelo is "modern but not only modern."

---

## 5. Modern Discord features — preference order

When implementing anything, prefer the **highest** entry on this list that fits:

### Messaging
1. **Ephemeral replies** (`MessageFlags.Ephemeral`) for anything 1-user state.
2. **Follow-ups** over editing the original reply when adding new information.
3. **AutoMod rules** (`AutoModerationRuleTriggerType.Keyword`, `MentionSpam`, `Spam`, etc.) over manual regex/message-scanning logic. See `src/listeners/afk/preventAutomodRuleDeletion.ts`.
4. **Discord timestamps** (`<t:UNIX:F>`, `<t:UNIX:R>`) over hardcoded dates/times. Use `convertToDiscordTimestamp()` from `src/lib/helpers/timestamp.ts`.

### Interactions
5. **Modals** for any form with >1 input or any sensitive data. Give **≥10 minutes** to answer. **Do not** display an error on timeout.
6. **Native select menus** (`UserSelectMenuBuilder`, `RoleSelectMenuBuilder`, `ChannelSelectMenuBuilder`, `MentionableSelectMenuBuilder`, `StringSelectMenuBuilder`) over free-text input when the option set is bounded.
7. **Paginated embeds** via `ComponentUtils.PomeloPaginatedMessage` (or `MenuPaginatedMessage` for >5 pages) when an embed would exceed ~5–10 fields. See `src/utilities/componentUtils.ts:322`.
8. **Custom buttons for dangerous/irreversible actions.** `ComponentUtils.ButtonConfirmationConstructor` is allowed only for process-local confirmations. Durable settings or moderation confirmations must use dedicated Sapphire `InteractionHandler` files and persisted state. Timeout = 10 min; **do** display an error on expiry.
9. **Ephemeral "view" buttons** with `ComponentUtils.EphemeralButton` for "view more details" patterns.
10. **Autocomplete** for any string option with a discoverable set (e.g. AFK message). See `src/interaction-handlers/afkAutocomplete.ts`.
11. **Localized option names/descriptions** via `getOptionLocalizations()` — never ship English-only.

### Slash commands
12. **Subcommands** (`@sapphire/plugin-subcommands`) when a command has ≥2 distinct modes.
13. **Context menu commands** for actions on a specific message/user (e.g. "Report to mods").
14. **`setIntegrationTypes([GuildInstall, UserInstall])`** unless the command is guild-only.
15. **`setNSFW(true)`** for any command that can return NSFW content.
16. **Preconditions** (`OwnerOnly`, `MaintenanceMode`, `SendAnalytics`) instead of inline permission checks.

### Moderation (when implementing mod features)
17. **Timeouts** (`GuildMember#timeout`) over kicks for first offenses.
18. **AutoMod actions** over manual moderation where possible.
19. **Audit log reasons** (`{ reason }` second arg) on every mod action.

### Data & events
20. **`container.analytics.capture`** in every command finish (handled automatically by listeners, do not duplicate).
21. **Sentry** for unexpected errors (auto-wired in `src/index.ts:18-34`); do not call `console.error` for handled paths.
22. **`drizzle` queries** with explicit `where` and `limit`; never `SELECT *` without both.

### Components v2 (the default for any **new** file)
23. **Components v2** is the new top-level message primitive. It supersedes `EmbedBuilder` + `ActionRowBuilder` for any file you create from scratch. Mark the message with `MessageFlags.IsComponentsV2` (required). See `discord.js` ≥ 14.22 builders:
    - `ContainerBuilder` — top-level layout unit. `.setAccentColor(Colors.X)` replaces the old embed `color`. Supports `spoiler: true`.
    - `TextDisplayBuilder` — rich text (markdown + mentions), no length limit other than the message cap.
    - `SectionBuilder` — `addTextDisplayComponents` for text + a single `setButtonAccessory` / `setThumbnailAccessory` / `setTextDisplayAccessory`.
    - `SeparatorBuilder` — `.setDivider(true).setSpacing(SeparatorSpacingSize.Small | Large)`.
    - `MediaGalleryBuilder` + `MediaGalleryItemBuilder` — image grids in place of `setImage`.
    - `FileDisplayBuilder` — display an already-uploaded attachment in-line.
    - `LabelBuilder` — replaces the old `Label` strings in modals; wraps a `TextInputBuilder` and can stand alone for a labeled read-only line.
    - `ActionRowBuilder` — still used, but **only** for `ButtonBuilder` / select menus; cannot hold text.
    - `ThumbnailBuilder` — standalone thumbnail component (not just as a section accessory).
24. **When to use v2 vs. legacy `EmbedConstructor`:** the existing files in `src/` still use embeds (the bot is mid-migration). **Do not** rewrite working embed code just to be fashionable — but every new file you author (new command, new listener, new embed-like response, new modal) **must** use Components v2 unless it can't (see the constraint below). Aim to migrate `EmbedConstructor` call sites to v2 when you touch them anyway.
25. **Hard constraints** with `MessageFlags.IsComponentsV2`:
    - **Cannot** mix with `embeds`, `attachments`, `stickers`, or `poll`. The message is *only* components.
    - **Cannot** be edited back to an embed (or vice versa). The flag is locked for the message's lifetime.
    - **Cannot** be used with `flags: MessageFlags.Ephemeral` in a way that loses the v2 flag. Combine them: `flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral`.
    - `setComponents` in modals now expects `[LabelBuilder, ...]` not `[ActionRowBuilder, ...]`.

**Avoid** (legacy): `message.content` parsing for command routing, `MessageEmbed` JSON, manual cooldown maps in memory, hand-rolled modal timeouts, hand-rolled paginators, `axios`/`fetch` for anything Discord already has a typed wrapper for, `EmbedBuilder` for any **new** code.

---

## 6. Design system (Brand Book — Notion: Brand Book → Colours / Typography / Writing Style)

### 6.1 Colours

The single source of truth is `src/lib/colors.ts`. **Never** use a hex literal in a command, embed, or component.

| Enum | Hex | Role | Use for |
|---|---|---|---|
| `Colors.Error` | `#FF3C3C` | Primary brand red | Bot errors |
| `Colors.Warning` | `#FF8552` | Secondary brand orange | Bot warnings / default embed |
| `Colors.Success` | `#5DC764` | Green | Bot success |
| `Colors.Info` | `#3772FF` | Blue | Bot info / popups |
| `Colors.Default` | `#FFFFC7` | Cream | Default embed color (used by `EmbedConstructor`) |

Rules:
- Embeds must use one of these five. Hard fail in code review if you see `#xxxxxx`.
- `EmbedUtils.EmbedConstructor` already applies `Colors.Default` and a timestamp — start there, then override only when the semantic colour is non-default.
- Button styles: use `ButtonStyle.Success` (green) for positive confirms, `ButtonStyle.Danger` (red) for destructive actions, `ButtonStyle.Primary` (blurple) for neutral primary actions, `ButtonStyle.Secondary` (grey) for cancel/back. **Do not** style confirm buttons red unless the action is destructive.

### 6.2 Typography

Discord renders plain text — typography rules apply to how we *write* and to external surfaces (the website at `https://pom.kdv.one/`).

- **Primary font:** Vercel Geist Sans — used in headings, buttons, promo titles.
- **Secondary font:** Vercel Geist Mono — used in code, variable text (e.g. `There are ***37** *members`).
- In embeds, use Discord's markdown:
  - **bold** for emphasis on numbers or key words.
  - *italics* for soft emphasis.
  - ***bold italics*** for double emphasis.
  - `inline code` for IDs, durations, error identifiers.
  - ```code blocks``` for multi-line technical content.
  - **No underlines, no all-caps, no "smart quotes."**
- **Discord timestamps** (`<t:UNIX:FORMAT>`) over hard-coded dates whenever the message is time-sensitive.

### 6.3 Writing style

| Guideline | Do | Don't |
|---|---|---|
| Person | 1st person: "I", "my", "me" | "We", "our", "us" |
| Tone | Informal professional: "Sorry", "looks like", "you're", "can't" | "gonna", "ur", "hm" |
| Assertion | Friendly assertive: "You can't", "don't", "slow down" | "You did x wrong" |
| Dates | European: `18/6/24` | `6/18/24` |
| Emphasis | `**bold**` or `*italics*` | UNDERLINES, ALL CAPS |
| Punctuation | End longer sentences with a period | "Slow down" |

**Examples to copy:**
- ✅ "**I** couldn't find that"
- ✅ "Looks like you've done something wrong"
- ✅ "You're doing that too fast"
- ✅ "There are ***37** *members"
- ✅ "That feature can't be used here."

**Humanizer pass — mandatory.** Before any user-facing string is committed, run it through the **humanizer** skill. Strip AI tells: "Certainly", "I'd be happy to", "Let me explain", rule-of-three padding, "delve into", "tapestry", excessive em-dashes, and anything that reads like a press release. Pomelo's voice is conversational, direct, and short — a person typing in a Discord chat, not a brand-writing LLM.

Errors that look like `Raw ZodError: Expected string, received undefined` are **never acceptable**. The `commandDeniedHandler` (`src/handlers/commandDeniedHandler.ts:31-90`) wraps every UserError with localized, human prose.

---

## 7. UI primitive rules (Notion: User Interface + User Experience)

| Primitive | When | When **not** | Timeouts | Notes |
|---|---|---|---|---|
| **Components v2** (`ContainerBuilder` + `TextDisplayBuilder` / `SectionBuilder` / etc.) | **Required for new files.** Default for any embed-like response authored from scratch. | Don't use when you need attachments/stickers/polls (mutually exclusive with `IsComponentsV2`). Don't use to edit a pre-existing embed-based message. | n/a | Flag with `MessageFlags.IsComponentsV2`. `setAccentColor(Colors.X)` replaces the old embed `color`. See §5 entry #23. |
| **Embed** (`EmbedConstructor`) | Default for **existing** code paths. Acceptable for new code only when v2 is genuinely impossible (e.g. the message must carry an attachment, sticker, or poll alongside text). | Pure 1-line confirmations (use ephemeral text), or >5–10 fields (use paginated). | n/a | Always set timestamp via constructor. Migrate to v2 when you touch the call site anyway. |
| **Modal** | Forms, sensitive data, multi-input | Boolean questions, single short text | ≥10 min, **no error on timeout** | New modals **must** use `LabelBuilder` to wrap `TextInputBuilder` (v2 modal pattern). Validate every input — Discord offers limited validation, client data is untrusted. |
| **Confirmation dialog** | Dangerous/irreversible actions (e.g. dev OTP, ban, mass-delete) | Anything else | ≥10 min, **display error on expiry** | Only for `y/n` style decisions. `ButtonConfirmationConstructor` is process-local; moderation and durable settings confirmations require persistent Sapphire handlers. |
| **Message components** (buttons + selects) | Quick actions, drill-downs, navigation | When the answer is "more than 5 options" without pagination | Route persistent controls through Sapphire `InteractionHandler` files so they survive command completion and restarts. | In v2 messages, buttons/selects still live inside `ActionRowBuilder` (a child of `ContainerBuilder` / `SectionBuilder` / `LabelBuilder`), but the action row cannot hold text. |

### User identification (Notion: User Experience → Users)

When a command accepts a user:
- **Slash command:** use the default `USER` option type — Discord handles the picker.
- **Message command:** accept in this order:
  1. **Mention** (`@username`)
  2. **User ID** (`695228246966534255`)
  3. **Strict username match** (`kdv_`)
  4. **Lazy username search** (`kdv` → `kdv_`) — and for moderation actions, **add a confirmation dialog** when a lazy match resolves.

### Embeds
- Always use `EmbedUtils.EmbedConstructor` (extends `EmbedBuilder` with safety). It trims overflow with `...`, enforces `EmbedLimits`, and applies `Colors.Default` + timestamp. See `src/utilities/embedUtils.ts:39-215`.
- Use a **paginated embed** (`PomeloPaginatedMessage`) for >5–10 fields depending on field size.
- For moderation logs, **always** set `setFooter` with a moderator identifier and a case ID.

### Modals
- Use `"y/n"` for boolean questions.
- Validate everything. Show a localized error inside the modal if input is bad.
- Do not display an error on timeout.

### Components (buttons & selects)
- **Persistent component routing.** Any component that must remain usable after its command returns must use a Sapphire `InteractionHandler` under `src/interaction-handlers/`. Do not use `createMessageComponentCollector`, `awaitMessageComponent`, or in-memory callback maps for persistent feature UI.
- Do not use `ButtonConfirmationConstructor` or `EphemeralButton` for moderation approvals, durable settings changes, or another workflow that must survive a restart; both helpers are collector-backed. Build the Components v2 controls and route them through dedicated handlers instead.
- Store temporary workflow state in Redis with a TTL and durable moderation approval state in libSQL. A process restart must not invalidate a control while its persisted state is still active.
- Treat `customId` as an opaque routing key only. Keep it under Discord's 100-character limit and include only a versioned feature prefix, opaque record or session ID, revision, allowlisted action, and optional opaque child ID.
- On every interaction, validate persisted state, user, guild, message, revision, permissions, hierarchy, and referenced Discord entities. Custom IDs and select values are never authorization.
- Temporary waits are allowed only when the interaction cannot outlive the current process and no durable feature state or moderation action depends on it.
- **Disable buttons after one click** with `container.utilities.componentUtils.disableButtons(message)`. See `src/utilities/componentUtils.ts:110-137`.
- For "view more" patterns, use `EphemeralButton` — the click result is ephemeral to the clicker.

---

## 8. Error handling

**Always** throw a `UserError` with `identifier` set to a `LanguageKeys.Errors.*` key — never throw raw strings or `Error`. The flow:

1. Command throws `UserError { identifier: "StringTooLong", context: { length: 200 } }`.
2. Sapphire emits `ChatInputCommandError` / `MessageCommandError`.
3. Listener in `src/listeners/errors/*Error.ts` calls the shared `handler()` from `src/handlers/commandDeniedHandler.ts`.
4. Handler resolves the `LanguageKeys.Errors.*` key, fills variables from `error.context` (matching `{varName}` placeholders in the description), and replies with an ephemeral red embed.
5. Unmapped identifiers fall through to `Errors.GenericError` and the identifier is shown in a code block for debugging.

**When adding a new error string:**
1. Draft the English string in Pomelo's voice (§6.3).
2. **Run it through the humanizer skill.** If it still sounds like AI, rewrite. No exception.
3. Translate to `it` and `es-ES` — translated strings get the same humanizer pass.
4. Add the key to **all three** `src/languages/*/errors.json` files.
5. Use `{curlyBracePlaceholders}` for any interpolated values, then pass them in `error.context` from the throw site.
6. If the error is from a custom precondition, also wire it in `convertInternalToKnownError()` in `src/handlers/commandDeniedHandler.ts:152-179`.

---

## 9. i18n

- `LanguageKeys` (`src/lib/i18n/languageKeys.ts`) is a type-safe enum of every user-facing string. Use it.
- `fetchT(interaction | message)` returns a `TFunction` — call it as `t(LanguageKeys.Errors.X.title)` or `t(LanguageKeys.Errors.X.desc_detailed, { varName: "value" })`.
- Locales: `en-US` (default), `it`, `es-ES`. The `fetchLanguage` resolver in `src/index.ts:97-132` follows this priority: forced guild setting → user setting → interaction locale → guild locale → `en-US`.
- `fallbackLng` chain (`src/index.ts:140-144`): `es-419` → `es-ES`, `uk` → `ru`, else → `en-US`. Add new fallback chains here.
- **Never** call `t("Some raw string")` — only `t(LanguageKeys.Something.dot.path)`.
- **Humanize every new key** before adding it (see §1 rule #9 and §6.3). If a key ever gets edited, the whole key goes through humanizer again — partial passes are not allowed.

---

## 10. Database

### Redis (hot path)
- Access via `container.redis.json*` (`jsonGet`, `jsonSet`, `jsonDel`).
- Schemas in `src/db/redis/schema.ts` are Zod schemas — use them to validate after fetch, and use the inferred types in code.
- One user's data lives at key `userId` with paths (`UserSettings`, `Afk`, ...). Guild data at `guildId` with paths (`GuildSettings`, ...).

### libSQL (cold path)
- Access via `db` (`src/db/index.ts`) — Drizzle ORM.
- Schemas in `src/db/schema.ts`. After changing them, run `bun run db:generate` then `bun run db:migrate`.
- Use `eslint-plugin-drizzle` rules (`package.json:58`) — they enforce the Drizzle query style.

---

## 11. Scheduled tasks

- Place in `src/scheduled-tasks/`. Each task is a class extending `ScheduledTask` from `@sapphire/plugin-scheduled-tasks`.
- BullMQ is configured in `src/index.ts:151-163` with `removeOnComplete: true` and `removeOnFail: 20`. Tasks that must not be lost should set their own `removeOnComplete: false` in the job options.
- Task names must be unique and stable — they're persisted across restarts.

---

## 12. Testing / pre-merge checklist

Adapted from the Notion "Test requirements for new features" page. **Every PR must clear all of these before review.**

### Core
- [ ] Command runs as expected (correct output, valid syntax)
- [ ] Command only runs when it should (permissions, context, preconditions)
- [ ] Edge cases handled (empty args, invalid input, unexpected formats)
- [ ] Cooldowns enforced (`defaultCooldown` in `src/index.ts:92-96`)
- [ ] Respects server-specific config (prefix, locale, `forceEphemeral`, toggles)

### Permissions
- [ ] Bot has required permissions (`requiredClientPermissions`)
- [ ] User permission checks in place (`requiredUserPermissions`, `preconditions`)
- [ ] Channel / DM context restricted when needed (`GuildOnly`, `DMOnly`)

### Data
- [ ] DB ops work (create, update, delete, retrieve)
- [ ] No duplication or unintended loss
- [ ] Persists across restarts
- [ ] Graceful fallback for missing/corrupt data

### Output
- [ ] Embeds correctly formatted (title, fields, **color from `Colors.*`**, timestamp)
- [ ] Strings within Discord's character/embed limits (handled by `EmbedConstructor`)
- [ ] Errors are user-friendly and **localized**
- [ ] Output is fully localized in `en-US`, `it`, `es-ES`
- [ ] **Every new / edited user-facing string passed through the humanizer skill** (see §1 #9)

### Interactions
- [ ] Buttons / menus respond correctly
- [ ] Persistent controls use Sapphire interaction handlers and persisted state
- [ ] Component expiry handled from persisted state (silent if modern, error if confirmation)
- [ ] Components can't be replayed or spammed (revision / atomic claim / disable after completion)
- [ ] Every interaction revalidates the actor, guild, message, permissions, hierarchy, and referenced entities

### Scheduled tasks
- [ ] Trigger at the right time
- [ ] Don't run multiple times accidentally
- [ ] Fail gracefully, log to Sentry
- [ ] Don't block the event loop

### Regression
- [ ] Tested by ≥2 roles / users
- [ ] Doesn't break existing functionality
- [ ] Persists through restart / redeploy
- [ ] Tests added in `tests/` where it makes sense (Jest is the runner)

### Security
- [ ] No sensitive info in responses / logs (no OTPs, no secrets, no raw stack traces)
- [ ] Inputs sanitized
- [ ] Users can't trick the command into affecting other users' data

### Release prep
- [ ] Feature can be toggled on/off (guild / user setting) when it makes sense
- [ ] Staging server tested
- [ ] Rollback plan: is the feature gated by a setting / precondition / feature flag?
- [ ] Changelog entry added to `src/changelog.ts`

---

## 13. Coding style (mechanical rules)

- **TypeScript strict mode.** `tsconfig.json` is strict. No `any`, no `as any` without a justification comment.
- **ESLint + Prettier** run on pre-commit via husky + lint-staged. Run `bun run lint:fix` before committing.
- **No comments unless requested** — code should be self-documenting via clear names. The codebase has a no-comment culture.
- **No emoji in code or commit messages** unless the user asks. Emoji live in `Emojis` enum / `src/lib/emojis.ts`.
- **File naming:** `kebab-case.ts` for everything.
- **Imports:** `node:fs`-style for Node built-ins. Use `.js` extension in relative imports (TS ESM convention). Example: `import { db } from "../db/index.js";` — see `src/commands/utility/afk.ts:13`.
- **Class names:** `PascalCase` extending Sapphire base classes.
- **Constants / enums:** `PascalCase` for the enum name, `PascalCase` for members (`Colors.Error`, not `COLORS.ERROR`).
- **Private fields:** use TypeScript `private` keyword (the codebase prefers it over `#private`).

---

## 14. Anti-patterns (refuse to write these)

- ❌ `interaction.reply({ content: "..." })` with no embed for anything but a 1-line confirmation.
- ❌ Hard-coded English strings in `t()` calls.
- ❌ `console.log` for anything other than dev-mode debug. Use `container.logger.*`.
- ❌ `client.users.fetch()` in a hot loop without caching.
- ❌ `JSON.parse` / `JSON.stringify` on Redis JSON data — use `container.redis.jsonGet/Set`.
- ❌ `await Promise.all([...])` with no `try/catch` over user-facing actions.
- ❌ A new moderation action that *doesn't* write to Sentry / PostHog / a case-log.
- ❌ A command that fails silently. Always send **something** to the user.
- ❌ A paginator that loses state on restart (the existing `PomeloPaginatedMessage` handles this; don't reinvent).
- ❌ An embed color literal (`0xFF3C3C`) outside `src/lib/colors.ts`.
- ❌ A slash command that is not `GuildInstall` + `UserInstall` (unless guild-only by nature).
- ❌ A modal that displays an error on timeout. (Notion rule — see §7.)
- ❌ A confirmation dialog that doesn't display an error on timeout. (Notion rule — see §7.)
- ❌ A new file (new command, new listener, new modal, new embed-like response) using `EmbedBuilder` / `EmbedConstructor` instead of `ContainerBuilder` + `TextDisplayBuilder` / `SectionBuilder`. See §5 entry #23.
- ❌ A new modal using `ActionRowBuilder<TextInputBuilder>` instead of `LabelBuilder` + `TextInputBuilder`. See §5 entry #23.
- ❌ Mixing `embeds: [...]` with `components: [...]` on a `MessageFlags.IsComponentsV2` message — Discord rejects it.
- ❌ Editing a v2 message back to an embed (or vice versa) — the v2 flag is locked for the message's lifetime.

---

## 15. When in doubt

1. **Read the Brand Book** (`/ee2780ffb9684b64b604554e8627e0ee` in Notion). The seven sub-pages cover everything.
2. **Read an existing command** that does something similar. `src/commands/utility/afk.ts` and `src/commands/utility/settings.ts` are the canonical examples.
3. **Read `commandUtils.ts` and `componentUtils.ts`** — most helpers you need are already there.
4. **Ask.** The user (kdv_) prefers explicit clarification over assumptions. State the assumption, propose a fix, then ask.
5. **Prefer a feature the bot doesn't have yet** over a feature it already has — that's how Pomelo stays ahead of Dyno and friends.

But most importantly, be creative and innovative!
