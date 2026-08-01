# QR Code Settings: Domain-Based URL Lists

## Summary

Replace the regex-based Rules system in QR Code settings with a simpler, domain-centric approach. Guild admins manage URL allowlists and blocklists by adding plain domains (not regex patterns). Two new toggle settings enable bundled default lists (a blocklist of known sketchy sites, an allowlist of known safe sites).

## Motivation

The existing Rules system required guild admins to write regex patterns and pick content types. Nobody is doing that. The replacement trades granular control for a dramatically simpler UX: type a domain, done. Subdomains and paths are covered automatically.

---

## Architecture

### Redis Schema Changes

File: `src/db/redis/schema.ts`

Remove the `rules` field. Add four new fields to the `QrScanner` object:

```ts
customAllowlist: z.array(z.string()).default([]),
customBlocklist: z.array(z.string()).default([]),
defaultBlocklistEnabled: z.boolean().default(false),
defaultAllowlistEnabled: z.boolean().default(false),
```

Both custom arrays are capped at 25 entries per guild per mode. The default toggles are only meaningful when their respective mode is active (`defaultBlocklistEnabled` only matters when `mode=blocklist`, same for allowlist).

### Migration

The `rules` field is dropped entirely. This feature is dev-only with no active users, so no migration logic is needed. Zod's schema will strip the unknown `rules` key on next read.

---

## Domain Matching Engine

File: `src/lib/moderation/qr-scanner.ts`

Replace `evaluateQrSafety` with domain-based matching.

### Normalization

When storing a domain:
- Lowercase
- Strip `www.` prefix
- If a full URL is provided (protocol/path), extract just the hostname

When matching a scanned URL:
- Extract hostname from the URL
- Lowercase and strip `www.`

### Matching Rules

A domain entry matches a scanned URL's hostname when:
- **Exact**: entry `evil.com` matches hostname `evil.com`
- **Subdomain**: entry `evil.com` matches hostname `sub.evil.com` or `a.b.evil.com`
- **Parent**: entry `sub.evil.com` matches hostname `evil.com`
- **Non-match**: entry `evil.com` does NOT match `notevil.com` (boundary check — the match must be at a dot boundary or be an exact match)

Path is irrelevant — any page on a matched domain is covered.

### Evaluation Logic

```
mode = off        → always safe
mode = allowlist  → safe if URL matches any customAllowlist entry
                     OR (defaultAllowlistEnabled AND URL matches default allowlist)
mode = blocklist  → safe UNLESS URL matches any customBlocklist entry
                     OR (defaultBlocklistEnabled AND URL matches default blocklist)
```

---

## Default Lists

### Default Blocklist

File: `src/lib/moderation/default-blocklist.ts`

A `Set<string>` of normalized domains for known sketchy, pornographic, malware, and gambling sites. Sourced from well-known public lists (e.g. Steven Black's hosts file). Bundled statically — updated when the bot is redeployed.

### Default Allowlist

File: `src/lib/moderation/default-allowlist.ts`

A `Set<string>` of normalized domains for sites that are 99% safe, especially ones where QR codes are commonly used:
- Payment/finance: `paypal.com`, `venmo.com`, `cash.app`
- Social/messaging: `discord.com`, `instagram.com`, `snapchat.com`, `tiktok.com`
- Tech: `google.com`, `apple.com`, `spotify.com`

No URL shorteners (`bit.ly`, `tinyurl.com`, etc.) — they redirect to anything.

---

## Settings UI

File: `src/commands/mod/securitySettings.ts`

The `MenuPaginatedMessage` pages are reorganized. Pages 2-3 and 9-10 are conditionally visible based on mode.

| Page | Control | Type | Visibility |
|------|---------|------|------------|
| 1 | Mode | StringSelect (allowlist/blocklist/off) | Always |
| 2 | Default Blocklist | Toggle button | mode=blocklist |
| 3 | Custom Blocklist | Add button + Remove button | mode=blocklist |
| 4 | Safe Action | Toggle button | Always |
| 5 | Safe Action Channel | ChannelSelect | Always |
| 6 | Unsafe Action | Toggle button | Always |
| 7 | Unsafe Action Channel | ChannelSelect | Always |
| 8 | Delete Message | Toggle button | Always |
| 9 | Default Allowlist | Toggle button | mode=allowlist |
| 10 | Custom Allowlist | Add button + Remove button | mode=allowlist |

When mode=off, only pages 1, 4-8 are shown.

### Default Toggle Pages (2, 9)

Simple on/off button. A one-line description explains what the default list contains. Uses the same `confirmSettingChange` flash pattern as other toggles.

### Custom List Pages (3, 10)

Shows current entry count ("**3** / 25 entries"). Two buttons:
- **Add** — opens a modal (see below)
- **Remove** — shows a StringSelect with current entries, removes selected entry

After add/remove, rebuild the settings menu to reflect the new state.

---

## Add Domain Modal

### Input

Single text input: "Domain" with placeholder "e.g. example.com".

### Validation

1. **Empty** — reject
2. **Invalid domain** — must have at least one dot, valid characters only (alphanumeric, hyphens, dots), no spaces. Reject.
3. **Normalization** — lowercase, strip `www.`, extract hostname if full URL provided
4. **Duplicate** — already in the list. Reject.
5. **Full** — list has 25 entries. Reject.

### Error Messages (localized, humanized)

- Invalid domain: "That doesn't look like a valid domain. Just give me something like `example.com`."
- Already in list: "That's already in the list."
- List full: "You've hit the 25-entry limit. Remove some before adding more."

### On Success

Push to `customAllowlist` or `customBlocklist` in Redis. Flash green confirmation. Rebuild settings menu.

---

## Interaction Handlers

The add/remove flows follow the same in-command collector pattern as the current Rules page (the settings menu itself is non-durable — rebuilt on each invocation). No new Sapphire InteractionHandler files are needed for this feature.

---

## Quickstart Wizard

File: `src/interaction-handlers/qrQuickstart.ts`

No changes to the quickstart flow. The wizard covers mode selection and delete-message toggle. Default toggles and custom lists are advanced settings — users configure them from the main `/securitysettings qr` menu after quickstart.

---

## Listener Changes

File: `src/listeners/moderation/scanQrCodes.ts`

No changes needed. The listener calls `evaluateQrSafety` which is replaced by the new domain-based evaluation. The listener's interface (settings object from Redis) stays the same shape.

---

## i18n

New keys added to all three locales (`en-US`, `it`, `es-ES`):

### Settings UI
- `qrDefaultBlocklist` / `qrDescDefaultBlocklist` — page label and description
- `qrDefaultAllowlist` / `qrDescDefaultAllowlist` — page label and description
- `qrCustomBlocklist` / `qrDescCustomBlocklist` — page label and description
- `qrCustomAllowlist` / `qrDescCustomAllowlist` — page label and description
- `qrAddEntry` / `qrRemoveEntry` — button labels
- `qrEntryCount` — "X / 25 entries" display (with `{count}` placeholder)

### Modal
- `qrAddDomainModalTitle` — "Add to Blocklist" / "Add to Allowlist"
- `qrModalDomainInput` — input label
- `qrModalDomainPlaceholder` — "e.g. example.com"

### Validation Errors
- `qrInvalidDomain` — invalid domain format
- `qrDuplicateDomain` — already in list
- `qrMaxEntriesReached` — 25-entry limit

### Removal
- `qrSelectEntryToRemove` — select prompt

Remove all `qrRule*`, `qrModalPattern*`, `qrModalType*`, `qrAddRule*`, `qrRemoveRule*`, `qrInvalidRegex`, `qrInvalidRuleType`, `qrMaxRulesReached` keys.

---

## Test Updates

### `tests/moderation/qr-scanner.test.ts`

Replace rule-based tests with domain-matching tests:
- Exact match, subdomain match, parent domain match
- Dot-boundary non-match (`notevil.com` vs `evil.com`)
- `www.` stripping
- Full URL extraction (protocol + path stripping)
- Allowlist mode with custom + default lists
- Blocklist mode with custom + default lists
- Off mode

### `tests/moderation/qr-listener.test.ts`

Update test fixtures to use new schema shape (no `rules`, new fields). No logic changes needed in the listener itself.

---

## Files Changed

| File | Change |
|------|--------|
| `src/db/redis/schema.ts` | Remove `rules`, add 4 new fields |
| `src/lib/moderation/qr-scanner.ts` | Rewrite `evaluateQrSafety` to domain-based |
| `src/lib/moderation/default-blocklist.ts` | New file — static blocklist domains |
| `src/lib/moderation/default-allowlist.ts` | New file — static allowlist domains |
| `src/commands/mod/securitySettings.ts` | Rebuild settings menu pages, add modal, remove Rules page |
| `src/languages/en-US/commands/moderation.json` | Add new keys, remove old rule keys |
| `src/languages/it/commands/moderation.json` | Same |
| `src/languages/es-ES/commands/moderation.json` | Same |
| `src/lib/i18n/commands/moderation.ts` | Update LanguageKeys bindings |
| `src/languages/en-US/errors.json` | Add QR validation error keys |
| `src/languages/it/errors.json` | Same |
| `src/languages/es-ES/errors.json` | Same |
| `src/lib/i18n/errors.ts` | Update error LanguageKeys |
| `tests/moderation/qr-scanner.test.ts` | Rewrite for domain-based matching |
| `tests/moderation/qr-listener.test.ts` | Update fixtures |
