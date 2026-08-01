# QR Code Scanner Feature (POM-65)

## Summary

Add a moderation listener that automatically scans QR codes in message image attachments, validates them against configurable whitelist/blacklist rules, and takes action (log safe, delete+alert unsafe). Settings stored in Redis per-guild, following existing moderation listener patterns.

## Architecture

```
Message with image → qrCodeScanner listener → download image → sharp preprocess → zxing-wasm decode → URL classification → action (notify/delete/log)
```

**Core components:**
- **Listener** (`src/listeners/moderation/qrCodeScanner.ts`) — hooks into `messageCreate`, filters for images, orchestrates scan pipeline
- **QR scanner helper** (`src/lib/helpers/qrScanner.ts`) — image download, sharp preprocessing, zxing-wasm decoding
- **URL classifier** (`src/lib/helpers/qrUrlClassifier.ts`) — whitelist/blacklist matching, data type detection
- **Redis settings** — extend `src/db/redis/schema.ts` with `QrScannerSettings`
- **Interaction handler** (`src/interaction-handlers/qrScannerSettings.ts`) — modal/button flow for configuring settings
- **i18n keys** — add to all 3 locales

## Implementation Steps

### Step 1: Install dependencies
- Add `zxing-wasm` and `sharp` to package.json
- Run `bun install`
- Note: sharp is already used in the project; verify it's present. If not, add it.

### Step 2: Redis schema — QR scanner settings
**File:** `src/db/redis/schema.ts`

Add `QrScannerSettings` Zod schema:
```ts
export const QrScannerSettings = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["silent", "notify"]).default("notify"),
  // "silent" = delete unsafe QRs without notifying, "notify" = send alert to channel
  unsafeAction: z.enum(["delete", "log"]).default("delete"),
  alertChannelId: z.string().nullable().default(null),
  filterMode: z.enum(["blacklist", "whitelist"]).default("blacklist"),
  allowedPatterns: z.array(z.string()).default([]),  // regex patterns for whitelist mode
  blockedPatterns: z.array(z.string()).default([]),  // regex patterns for blacklist mode
  allowedTypes: z.array(z.enum(["url", "text", "wifi", "contact", "other"])).default(["url", "text", "wifi", "contact", "other"]),
  showContent: z.boolean().default(true),  // show decoded QR content in notifications
});
```

Add to the guild settings path in the Redis JSON schema. Follow existing pattern for reading/writing guild settings.

### Step 3: QR scanner helper module
**File:** `src/lib/helpers/qrScanner.ts`

Functions:
- `downloadImage(url: string): Promise<Buffer>` — fetch attachment via discord.js CDN URL, with size limit (e.g., 10MB)
- `preprocessImage(buffer: Buffer): Promise<Buffer>` — sharp pipeline: resize to max 2000px, enhance contrast, convert to grayscale, sharpen
- `decodeQrCodes(buffer: Buffer): Promise<QRDecodeResult[]>` — zxing-wasm `decode` with `tryHarder: true`, return array of `{ content, format, type }`
- `scanMessageAttachments(message: Message): Promise<QRDecodeResult[]>` — orchestrate: filter image attachments, download, preprocess, decode

### Step 4: URL classifier helper
**File:** `src/lib/helpers/qrUrlClassifier.ts`

Functions:
- `classifyQRContent(content: string): QRContentType` — detect if URL, plain text, WiFi config, vCard, or other
- `isAllowed(content: string, type: QRContentType, settings: QrScannerSettings): boolean` — check against whitelist/blacklist patterns and allowed types
- Pattern matching uses `new RegExp(pattern)` with try/catch for safety

### Step 5: Moderation listener
**File:** `src/listeners/moderation/qrCodeScanner.ts`

- Extend `Listener` with `event: "messageCreate"`, `type: ListenerType.ONCE` (or `ListenerOptions` as appropriate — follow existing moderation listener pattern)
- Guard: skip if author is bot, if message has no image attachments, if guild settings don't have QR scanner enabled
- Pipeline: fetch settings → scan attachments → classify each QR → if unsafe: delete message (if `unsafeAction: "delete"`) + send alert; if safe + `showContent: true`: optionally log
- Use `container.redis.jsonGet` to read guild settings
- Error handling: if scan fails (corrupt image, timeout), silently skip — don't block message delivery
- Components v2 for alert messages (ContainerBuilder + TextDisplayBuilder)

### Step 6: Interaction handler for settings
**File:** `src/interaction-handlers/qrScannerSettings.ts`

- Sapphire InteractionHandler for configuring QR scanner settings
- Modal for adding/editing filter patterns
- Buttons for toggling enabled/disabled, switching filter mode
- Follow persistent component routing pattern (not collector-backed)
- Entry point: button in existing mod settings or a new `/qrscanner` subcommand

### Step 7: Command integration (optional subcommand)
**File:** `src/commands/mod/modSettings.ts` (extend existing) OR new command

Add a QR Scanner section to the existing moderation settings flow. This could be:
- A new subcommand group under `/modsettings` 
- Or a button in the existing mod settings embed that opens the QR scanner config

Follow existing `warnSettingsFlow.ts` pattern for the interaction handler approach.

### Step 8: i18n keys
**Files:** `src/languages/en-US/`, `src/languages/it/`, `src/languages/es-ES/`

Add keys for:
- QR scanner settings labels and descriptions
- Alert messages (unsafe QR detected, safe QR logged)
- Error messages (scan failed, image too large)
- Modal labels (patterns, filter mode, etc.)
- All strings must be humanized per §6.3

### Step 9: Tests
**File:** `tests/moderation/qrScanner.test.ts`

- Unit tests for URL classifier (whitelist/blacklist matching, type detection)
- Unit tests for QR content classification
- Mock the image download + decode for listener tests
- Follow existing test patterns in `tests/moderation/`

## Dependencies

```
Step 1 (deps) → Step 2 (schema) → Step 3 (scanner helper) → Step 4 (classifier)
                                                              ↓
                                              Step 5 (listener) → Step 6 (interaction handler)
                                                              ↓
                                              Step 7 (command integration)
                                                              ↓
                                              Step 8 (i18n) → Step 9 (tests)
```

Steps 3 and 4 can be done in parallel. Steps 6 and 7 can be done in parallel after Step 5.

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| Large images cause memory pressure | Sharp resize to max 2000px, enforce 10MB download limit |
| zxing-wasm blocks event loop | WASM runs off main thread in Bun; add timeout (5s per image) |
| Malicious QR content (phishing URLs) | Never auto-navigate or embed URLs as clickable links in alerts; show in code blocks |
| Redis schema change breaks existing guilds | All new fields have defaults; Zod `.default()` handles migration on read |
| Sharp/zxing-wasm not compatible with Bun | Both have native Bun support; verify in Step 1 |
| False positives on blurry images | Sharp preprocessing (contrast + sharpen) improves detection; graceful skip on failure |

## Rejected Alternatives

- **Scheduled task for async scanning**: Rejected — QR scanning should be synchronous with message delivery to allow deletion of unsafe messages before they're widely seen. BullMQ adds latency.
- **Separate command instead of listener**: Rejected — the issue implies automatic scanning of messages, not manual on-demand scanning. A listener is the right primitive.
- **Storing scan results in libSQL**: Rejected — scan results are ephemeral (the message either stays or gets deleted). No need for persistent relational storage. Redis settings are sufficient.
- **Using a different QR library**: Rejected — issue explicitly specifies `zxing-wasm` for its speed advantage.