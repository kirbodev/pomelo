# QR Domain-Based URL Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regex-based QR code rules with domain-based URL allowlists/blocklists, including bundled default lists and a simple domain-add modal.

**Architecture:** Domain matching engine in `qr-scanner.ts` checks exact domain, subdomain, and parent domain matches. Default blocklist/allowlist are static `Set<string>` exports. Settings UI in `securitySettings.ts` rebuilds with conditional pages based on mode. Custom lists stored as `string[]` in Redis, capped at 25 entries.

**Tech Stack:** TypeScript, Zod (schema), discord.js v14, Sapphire framework, Bun test runner

## Global Constraints

- No comments unless requested — code should be self-documenting
- All user-facing strings must be localized via `LanguageKeys.*`
- All user-facing strings must pass through the humanizer skill
- Use `Colors.*` enum for all embed/component colors — no hex literals
- File naming: `kebab-case.ts`
- Relative imports use `.js` extension
- TypeScript strict mode — no `any` without justification
- Embeds use `EmbedUtils.EmbedConstructor` (existing code paths)
- Run `bun run lint:fix` after implementation
- Run `bun test` to verify all tests pass

---

### Task 1: Update Redis Schema

**Files:**
- Modify: `src/db/redis/schema.ts:130-153`

**Interfaces:**
- Consumes: existing `QrScanner` schema
- Produces: new `QrScanner` schema with `customAllowlist`, `customBlocklist`, `defaultBlocklistEnabled`, `defaultAllowlistEnabled` fields

- [ ] **Step 1: Update the QrScanner schema**

Open `src/db/redis/schema.ts` and replace lines 130-153:

```ts
export const QrScanner = z.object({
  mode: z.enum(["allowlist", "blocklist", "off"]).default("off"),
  customAllowlist: z.array(z.string()).default([]),
  customBlocklist: z.array(z.string()).default([]),
  defaultBlocklistEnabled: z.boolean().default(false),
  defaultAllowlistEnabled: z.boolean().default(false),
  safeAction: z
    .object({
      enabled: z.boolean().default(false),
      channelId: z.string().regex(ChannelRegex).optional(),
    })
    .default({}),
  unsafeAction: z
    .object({
      enabled: z.boolean().default(true),
      channelId: z.string().regex(ChannelRegex).optional(),
      deleteMessage: z.boolean().default(true),
    })
    .default({}),
});
```

- [ ] **Step 2: Verify schema compiles**

Run: `bun run build`
Expected: No TypeScript errors

- [ ] **Step 3: Commit schema change**

```bash
git add src/db/redis/schema.ts
git commit -m "feat(qr): replace rules with domain-based lists in schema"
```

---

### Task 2: Create Default Lists

**Files:**
- Create: `src/lib/moderation/default-blocklist.ts`
- Create: `src/lib/moderation/default-allowlist.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `DEFAULT_BLOCKLIST: Set<string>`, `DEFAULT_ALLOWLIST: Set<string>`

- [ ] **Step 1: Create the default blocklist**

Create `src/lib/moderation/default-blocklist.ts`:

```ts
export const DEFAULT_BLOCKLIST: Set<string> = new Set([
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "youporn.com",
  "tube8.com",
  "brazzers.com",
  "bangbros.com",
  "naughtyamerica.com",
  "chaturbate.com",
  "livejasmin.com",
  "stripchat.com",
  "cam4.com",
  "myfreecams.com",
  "bongacams.com",
  "onlyfans.com",
  "fansly.com",
  "manyvids.com",
  "justforfans.com",
  "bet365.com",
  "draftkings.com",
  "fanduel.com",
  "williamhill.com",
  "betmgm.com",
  "caesars.com",
  "pokerstars.com",
  "888casino.com",
  "unibet.com",
  "betway.com",
]);
```

- [ ] **Step 2: Create the default allowlist**

Create `src/lib/moderation/default-allowlist.ts`:

```ts
export const DEFAULT_ALLOWLIST: Set<string> = new Set([
  "discord.com",
  "instagram.com",
  "snapchat.com",
  "tiktok.com",
  "paypal.com",
  "venmo.com",
  "cash.app",
  "google.com",
  "apple.com",
  "spotify.com",
  "microsoft.com",
  "github.com",
]);
```

- [ ] **Step 3: Commit default lists**

```bash
git add src/lib/moderation/default-blocklist.ts src/lib/moderation/default-allowlist.ts
git commit -m "feat(qr): add default blocklist and allowlist"
```

---

### Task 3: Write Domain Matching Tests (TDD)

**Files:**
- Modify: `tests/moderation/qr-scanner.test.ts:127-226` (replace evaluateQrSafety describe block)

**Interfaces:**
- Consumes: `evaluateQrSafety`, `QrSafetySettings` from `qr-scanner.ts`
- Produces: test cases for domain matching

- [ ] **Step 1: Write failing tests for domain matching**

Replace the `evaluateQrSafety` describe block (lines 127-226) in `tests/moderation/qr-scanner.test.ts`:

```ts
describe("evaluateQrSafety", () => {
  const urlData: ParsedQrData = { raw: "https://example.com", contentType: "url", url: "https://example.com" };

  it('returns "safe" when mode is off', () => {
    const settings: QrSafetySettings = { mode: "off", customAllowlist: [], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(urlData, settings)).toBe("safe");
  });

  it('returns "unsafe" when allowlist has no entries and defaults disabled', () => {
    const settings: QrSafetySettings = { mode: "allowlist", customAllowlist: [], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(urlData, settings)).toBe("unsafe");
  });

  it('returns "safe" when blocklist has no entries and defaults disabled', () => {
    const settings: QrSafetySettings = { mode: "blocklist", customAllowlist: [], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(urlData, settings)).toBe("safe");
  });

  it("matches exact domain in custom allowlist", () => {
    const settings: QrSafetySettings = { mode: "allowlist", customAllowlist: ["example.com"], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(urlData, settings)).toBe("safe");
  });

  it("matches subdomain of entry in allowlist", () => {
    const subData: ParsedQrData = { raw: "https://sub.example.com", contentType: "url", url: "https://sub.example.com" };
    const settings: QrSafetySettings = { mode: "allowlist", customAllowlist: ["example.com"], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(subData, settings)).toBe("safe");
  });

  it("matches parent domain of entry in allowlist", () => {
    const settings: QrSafetySettings = { mode: "allowlist", customAllowlist: ["sub.example.com"], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(urlData, settings)).toBe("safe");
  });

  it("does not match partial domain names (dot boundary)", () => {
    const notEvil: ParsedQrData = { raw: "https://notevil.com", contentType: "url", url: "https://notevil.com" };
    const settings: QrSafetySettings = { mode: "blocklist", customAllowlist: [], customBlocklist: ["evil.com"], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(notEvil, settings)).toBe("safe");
  });

  it("strips www. from scanned URL", () => {
    const wwwData: ParsedQrData = { raw: "https://www.example.com", contentType: "url", url: "https://www.example.com" };
    const settings: QrSafetySettings = { mode: "allowlist", customAllowlist: ["example.com"], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(wwwData, settings)).toBe("safe");
  });

  it("strips www. from entry", () => {
    const settings: QrSafetySettings = { mode: "allowlist", customAllowlist: ["www.example.com"], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(urlData, settings)).toBe("safe");
  });

  it("matches blocklist entry as unsafe", () => {
    const settings: QrSafetySettings = { mode: "blocklist", customAllowlist: [], customBlocklist: ["example.com"], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(urlData, settings)).toBe("unsafe");
  });

  it("uses default blocklist when enabled", () => {
    const sketchy: ParsedQrData = { raw: "https://pornhub.com", contentType: "url", url: "https://pornhub.com" };
    const settings: QrSafetySettings = { mode: "blocklist", customAllowlist: [], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: true };
    expect(evaluateQrSafety(sketchy, settings)).toBe("unsafe");
  });

  it("ignores default blocklist when disabled", () => {
    const sketchy: ParsedQrData = { raw: "https://pornhub.com", contentType: "url", url: "https://pornhub.com" };
    const settings: QrSafetySettings = { mode: "blocklist", customAllowlist: [], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(sketchy, settings)).toBe("safe");
  });

  it("uses default allowlist when enabled", () => {
    const safe: ParsedQrData = { raw: "https://discord.com", contentType: "url", url: "https://discord.com" };
    const settings: QrSafetySettings = { mode: "allowlist", customAllowlist: [], customBlocklist: [], defaultAllowlistEnabled: true, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(safe, settings)).toBe("safe");
  });

  it("ignores default allowlist when disabled", () => {
    const safe: ParsedQrData = { raw: "https://discord.com", contentType: "url", url: "https://discord.com" };
    const settings: QrSafetySettings = { mode: "allowlist", customAllowlist: [], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(safe, settings)).toBe("unsafe");
  });

  it("allowlist combines custom and default entries", () => {
    const custom: ParsedQrData = { raw: "https://mybank.com", contentType: "url", url: "https://mybank.com" };
    const settings: QrSafetySettings = { mode: "allowlist", customAllowlist: ["mybank.com"], customBlocklist: [], defaultAllowlistEnabled: true, defaultBlocklistEnabled: false };
    expect(evaluateQrSafety(custom, settings)).toBe("safe");
    expect(evaluateQrSafety({ raw: "https://discord.com", contentType: "url" }, settings)).toBe("safe");
  });
});
```

Also update the imports at the top of the file:

```ts
import {
  classifyQrContent,
  parseQrData,
  evaluateQrSafety,
  preprocessImage,
  decodeQrCodes,
  type ParsedQrData,
  type QrSafetySettings,
} from "../../src/lib/moderation/qr-scanner.js";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/moderation/qr-scanner.test.ts`
Expected: Tests fail with "Type 'QrSafetySettings' does not match" or "evaluateQrSafety is not a function" errors

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/moderation/qr-scanner.test.ts
git commit -m "test(qr): add domain matching tests (failing)"
```

---

### Task 4: Implement Domain Matching Engine

**Files:**
- Modify: `src/lib/moderation/qr-scanner.ts:137-178` (replace QrSafetySettings and evaluateQrSafety)

**Interfaces:**
- Consumes: `DEFAULT_BLOCKLIST`, `DEFAULT_ALLOWLIST` from Task 2
- Produces: `evaluateQrSafety` with domain matching, exported `QrSafetySettings` type, exported `normalizeDomain` and `matchesDomain` helpers

- [ ] **Step 1: Import default lists**

Add imports at the top of `src/lib/moderation/qr-scanner.ts`:

```ts
import { DEFAULT_BLOCKLIST } from "./default-blocklist.js";
import { DEFAULT_ALLOWLIST } from "./default-allowlist.js";
```

- [ ] **Step 2: Replace QrSafetySettings and evaluateQrSafety**

Replace lines 137-178 in `src/lib/moderation/qr-scanner.ts`:

```ts
export interface QrSafetySettings {
  mode: "allowlist" | "blocklist" | "off";
  customAllowlist: string[];
  customBlocklist: string[];
  defaultAllowlistEnabled: boolean;
  defaultBlocklistEnabled: boolean;
}

export function normalizeDomain(input: string): string {
  let domain = input.toLowerCase().trim();
  if (domain.startsWith("www.")) domain = domain.slice(4);
  try {
    const url = new URL(domain.startsWith("http") ? domain : `https://${domain}`);
    domain = url.hostname;
  } catch {
    // not a URL, use as-is
  }
  if (domain.startsWith("www.")) domain = domain.slice(4);
  return domain;
}

export function matchesDomain(hostname: string, entry: string): boolean {
  const normalizedHost = normalizeDomain(hostname);
  const normalizedEntry = normalizeDomain(entry);
  if (normalizedHost === normalizedEntry) return true;
  if (normalizedHost.endsWith(`.${normalizedEntry}`)) return true;
  if (normalizedEntry.endsWith(`.${normalizedHost}`)) return true;
  return false;
}

function hostnameFromData(data: ParsedQrData): string | null {
  if (data.url) {
    try {
      return new URL(data.url).hostname;
    } catch {
      return null;
    }
  }
  try {
    return new URL(data.raw).hostname;
  } catch {
    return null;
  }
}

export function evaluateQrSafety(
  data: ParsedQrData,
  settings: QrSafetySettings,
): "safe" | "unsafe" {
  if (settings.mode === "off") return "safe";

  const hostname = hostnameFromData(data);

  if (settings.mode === "allowlist") {
    if (!hostname) return "unsafe";
    if (settings.customAllowlist.some((entry) => matchesDomain(hostname, entry))) return "safe";
    if (settings.defaultAllowlistEnabled && [...DEFAULT_ALLOWLIST].some((entry) => matchesDomain(hostname, entry))) return "safe";
    return "unsafe";
  }

  // blocklist
  if (!hostname) return "safe";
  if (settings.customBlocklist.some((entry) => matchesDomain(hostname, entry))) return "unsafe";
  if (settings.defaultBlocklistEnabled && [...DEFAULT_BLOCKLIST].some((entry) => matchesDomain(hostname, entry))) return "unsafe";
  return "safe";
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test tests/moderation/qr-scanner.test.ts`
Expected: All `evaluateQrSafety` tests pass

- [ ] **Step 4: Commit implementation**

```bash
git add src/lib/moderation/qr-scanner.ts
git commit -m "feat(qr): implement domain-based matching engine"
```

---

### Task 5: Update Listener to Use New Settings Shape

**Files:**
- Modify: `src/listeners/moderation/scanQrCodes.ts:109-116`

**Interfaces:**
- Consumes: new `QrSafetySettings` type
- Produces: updated listener that passes new settings shape to `evaluateQrSafety`

- [ ] **Step 1: Update the evaluateQrSafety call**

Replace lines 109-116 in `src/listeners/moderation/scanQrCodes.ts`:

```ts
const evaluations: Array<{ parsed: ParsedQrData; safety: "safe" | "unsafe" }> = [];
for (const result of results) {
  try {
    const parsed = parseQrData(result.raw, result.contentType);
    const safety = evaluateQrSafety(parsed, {
      mode: settings.mode,
      customAllowlist: settings.customAllowlist,
      customBlocklist: settings.customBlocklist,
      defaultAllowlistEnabled: settings.defaultAllowlistEnabled,
      defaultBlocklistEnabled: settings.defaultBlocklistEnabled,
    });
    evaluations.push({ parsed, safety });
  } catch (error) {
    this.container.logger.error(
      "[QRScanner] Error evaluating QR result: %s",
      error,
    );
  }
}
```

- [ ] **Step 2: Verify listener compiles**

Run: `bun run build`
Expected: No TypeScript errors

- [ ] **Step 3: Commit listener update**

```bash
git add src/listeners/moderation/scanQrCodes.ts
git commit -m "feat(qr): update listener to use new settings shape"
```

---

### Task 6: Update i18n Keys

**Files:**
- Modify: `src/languages/en-US/commands/moderation.json:347-442`
- Modify: `src/languages/it/commands/moderation.json:347-442`
- Modify: `src/languages/es-ES/commands/moderation.json:347-442`
- Modify: `src/lib/i18n/commands/moderation.ts:672-773`

**Interfaces:**
- Consumes: nothing
- Produces: new LanguageKeys for default lists, custom lists, modal, validation errors

- [ ] **Step 1: Update en-US moderation.json**

Replace the `securitySettings` section (lines 347-442) in `src/languages/en-US/commands/moderation.json`:

```json
  "securitySettings": {
    "commandName": "securitysettings",
    "commandDescription": "Manage security features for the server.",
    "subcommandOverviewName": "overview",
    "subcommandOverviewDescription": "View all security features and their status.",
    "subcommandQrName": "qr",
    "subcommandQrDescription": "Configure QR code scanner settings.",
    "subcommandQuickstartName": "quickstart",
    "subcommandQuickstartDescription": "Set up QR code scanning with a guided wizard.",
    "overviewTitle": "Security Features Overview",
    "qrTitle": "QR Scanner Settings",
    "featureQr": "QR Scanner",
    "enabled": "Enabled",
    "disabled": "Disabled",
    "notConfigured": "Not configured",
    "qrMode": "Mode",
    "qrModeAllowlist": "Allowlist",
    "qrModeBlocklist": "Blocklist",
    "qrModeOff": "Off",
    "qrDefaultBlocklist": "Default blocklist",
    "qrDescDefaultBlocklist": "Block known sketchy sites automatically. Covers porn, gambling, and malware domains.",
    "qrDefaultAllowlist": "Default allowlist",
    "qrDescDefaultAllowlist": "Allow known safe sites automatically. Covers popular sites where QR codes are common.",
    "qrCustomBlocklist": "Custom blocklist",
    "qrDescCustomBlocklist": "Add domains to block. Covers the domain, its subdomains, and all pages.",
    "qrCustomAllowlist": "Custom allowlist",
    "qrDescCustomAllowlist": "Add domains to allow. Covers the domain, its subdomains, and all pages.",
    "qrNoEntries": "No entries added yet.",
    "qrEntryCount": "**{count}** / 25 entries",
    "qrSafeChannel": "Safe action channel",
    "qrUnsafeChannel": "Unsafe action channel",
    "qrDeleteOnUnsafe": "Delete on unsafe",
    "qrToggleEnabled": "Toggle enabled",
    "qrToggleDisabled": "Toggle disabled",
    "qrChangeMode": "Change mode",
    "qrUnsafeAlertTitle": "Unsafe QR code detected",
    "qrUnsafeAlertAuthor": "Author",
    "qrUnsafeAlertChannel": "Channel",
    "qrUnsafeAlertContentType": "Content type",
    "qrSafeAlertTitle": "Safe QR code detected",
    "qrSafeAlertAuthor": "Author",
    "qrSafeAlertChannel": "Channel",
    "qrSafeAlertContentType": "Content type",
    "qrLogTitle": "QR Code Scan Log",
    "qrLogResult": "Result",
    "qrLogResultUnsafe": "Unsafe",
    "qrLogResultSafe": "Safe",
    "qrLogResultNoMatch": "No match",
    "qrLogAuthor": "Author",
    "qrLogChannel": "Channel",
    "qrLogContentType": "Content type",
    "qrSafeActionLabel": "Safe alert",
    "qrUnsafeActionLabel": "Unsafe alert",
    "qrSetSafeChannel": "Set safe channel",
    "qrSetUnsafeChannel": "Set unsafe channel",
    "qrSetLogChannel": "Set log channel",
    "qrToggleSafeAction": "Toggle safe alert",
    "qrToggleUnsafeAction": "Toggle unsafe alert",
    "qrAddEntry": "Add",
    "qrRemoveEntry": "Remove",
    "qrAddDomainModalTitle": "Add to list",
    "qrAddDomainModalTitleBlocklist": "Add to blocklist",
    "qrAddDomainModalTitleAllowlist": "Add to allowlist",
    "qrModalDomainInput": "Domain",
    "qrModalDomainPlaceholder": "e.g. example.com",
    "qrInvalidDomain": "That doesn't look like a valid domain. Just give me something like `example.com`.",
    "qrDuplicateDomain": "That's already in the list.",
    "qrMaxEntriesReached": "You've hit the 25-entry limit. Remove some before adding more.",
    "qrDomainAdded": "Added `{domain}` to the list.",
    "qrDomainRemoved": "Removed `{domain}` from the list.",
    "qrSelectEntryToRemove": "Select an entry to remove",
    "qrDescMode": "Allowlist only passes matching QRs. Blocklist blocks matching QRs. Off skips scanning entirely.",
    "qrDescSafeAction": "Send a notification when a safe QR code is detected.",
    "qrDescSafeChannel": "The channel where safe QR notifications are sent.",
    "qrDescUnsafeAction": "Send a notification when an unsafe QR code is detected.",
    "qrDescUnsafeChannel": "The channel where unsafe QR notifications are sent.",
    "qrDescDeleteOnUnsafe": "Automatically delete messages that contain unsafe QR codes.",
    "qrQuickstartTitle": "QR Scanner Quickstart",
    "qrQuickstepWelcome": "Let me walk you through setting up the QR scanner. It scans images for QR codes and checks them against your rules.",
    "qrQuickstepEnable": "Do you want to enable QR code scanning?",
    "qrQuickstepMode": "Pick a scanning mode.",
    "qrQuickstepChannels": "Where should I send scan results?",
    "qrQuickstepDeleteToggle": "Should I delete messages with unsafe QR codes?",
    "qrQuickstepSummary": "Here's what I've set up. Looks good?",
    "qrQuickstartEnable": "Enable",
    "qrQuickstartSkip": "Skip",
    "qrQuickstartBack": "Back",
    "qrQuickstartNext": "Next",
    "qrQuickstartFinish": "Save & enable",
    "qrQuickstartDone": "QR scanner is ready to go.",
    "qrQuickstartConfirmTitle": "Confirm setup",
    "qrDeleteMessage": "Delete message",
    "qrMessageDeleted": "Message deleted.",
    "qrAutoDeletedNotice": "{user}, your message was automatically removed because it contained an unsafe QR code."
  },
```

- [ ] **Step 2: Update it and es-ES moderation.json**

Apply the same structure to `src/languages/it/commands/moderation.json` and `src/languages/es-ES/commands/moderation.json`, translating the new keys:

Italian new keys:
```json
    "qrDefaultBlocklist": "Blocklist predefinita",
    "qrDescDefaultBlocklist": "Blocca automaticamente i siti pericolosi. Copre domini per adulti, gioco d'azzardo e malware.",
    "qrDefaultAllowlist": "Allowlist predefinita",
    "qrDescDefaultAllowlist": "Consenti automaticamente i siti sicuri. Copre i siti più popolari dove i codici QR sono comuni.",
    "qrCustomBlocklist": "Blocklist personalizzata",
    "qrDescCustomBlocklist": "Aggiungi domini da bloccare. Copre il dominio, i suoi sottodomini e tutte le pagine.",
    "qrCustomAllowlist": "Allowlist personalizzata",
    "qrDescCustomAllowlist": "Aggiungi domini da consentire. Copre il dominio, i suoi sottodomini e tutte le pagine.",
    "qrNoEntries": "Nessun elemento aggiunto.",
    "qrEntryCount": "**{count}** / 25 elementi",
    "qrAddEntry": "Aggiungi",
    "qrRemoveEntry": "Rimuovi",
    "qrAddDomainModalTitleBlocklist": "Aggiungi alla blocklist",
    "qrAddDomainModalTitleAllowlist": "Aggiungi alla allowlist",
    "qrModalDomainInput": "Dominio",
    "qrModalDomainPlaceholder": "es. esempio.com",
    "qrInvalidDomain": "Non sembra un dominio valido. Dammi qualcosa tipo `esempio.com`.",
    "qrDuplicateDomain": "È già nella lista.",
    "qrMaxEntriesReached": "Hai raggiunto il limite di 25 elementi. Rimuovine qualcuno prima di aggiungerne altri.",
    "qrDomainAdded": "`{domain}` aggiunto alla lista.",
    "qrDomainRemoved": "`{domain}` rimosso dalla lista.",
    "qrSelectEntryToRemove": "Seleziona un elemento da rimuovere",
```

Spanish new keys:
```json
    "qrDefaultBlocklist": "Lista de bloqueo predeterminada",
    "qrDescDefaultBlocklist": "Bloquea automáticamente sitios peligrosos. Cubre dominios de pornografía, apuestas y malware.",
    "qrDefaultAllowlist": "Lista de permitidos predeterminada",
    "qrDescDefaultAllowlist": "Permite automáticamente sitios seguros. Cubre los sitios más populares donde los códigos QR son comunes.",
    "qrCustomBlocklist": "Lista de bloqueo personalizada",
    "qrDescCustomBlocklist": "Añade dominios para bloquear. Cubre el dominio, sus subdominios y todas las páginas.",
    "qrCustomAllowlist": "Lista de permitidos personalizada",
    "qrDescCustomAllowlist": "Añade dominios para permitir. Cubre el dominio, sus subdominios y todas las páginas.",
    "qrNoEntries": "No se han añadido entradas.",
    "qrEntryCount": "**{count}** / 25 entradas",
    "qrAddEntry": "Añadir",
    "qrRemoveEntry": "Eliminar",
    "qrAddDomainModalTitleBlocklist": "Añadir a la lista de bloqueo",
    "qrAddDomainModalTitleAllowlist": "Añadir a la lista de permitidos",
    "qrModalDomainInput": "Dominio",
    "qrModalDomainPlaceholder": "ej. ejemplo.com",
    "qrInvalidDomain": "Eso no parece un dominio válido. Dame algo como `ejemplo.com`.",
    "qrDuplicateDomain": "Eso ya está en la lista.",
    "qrMaxEntriesReached": "Has alcanzado el límite de 25 entradas. Elimina algunas antes de añadir más.",
    "qrDomainAdded": "`{domain}` añadido a la lista.",
    "qrDomainRemoved": "`{domain}` eliminado de la lista.",
    "qrSelectEntryToRemove": "Selecciona una entrada para eliminar",
```

- [ ] **Step 3: Update LanguageKeys bindings**

Replace the `SecuritySettings` object (lines 672-773) in `src/lib/i18n/commands/moderation.ts`:

```ts
  SecuritySettings: {
    commandName: T("commands/moderation:securitySettings.commandName"),
    commandDescription: T("commands/moderation:securitySettings.commandDescription"),
    subcommandOverviewName: T("commands/moderation:securitySettings.subcommandOverviewName"),
    subcommandOverviewDescription: T("commands/moderation:securitySettings.subcommandOverviewDescription"),
    subcommandQrName: T("commands/moderation:securitySettings.subcommandQrName"),
    subcommandQrDescription: T("commands/moderation:securitySettings.subcommandQrDescription"),
    subcommandQuickstartName: T("commands/moderation:securitySettings.subcommandQuickstartName"),
    subcommandQuickstartDescription: T("commands/moderation:securitySettings.subcommandQuickstartDescription"),
    overviewTitle: T("commands/moderation:securitySettings.overviewTitle"),
    qrTitle: T("commands/moderation:securitySettings.qrTitle"),
    featureQr: T("commands/moderation:securitySettings.featureQr"),
    enabled: T("commands/moderation:securitySettings.enabled"),
    disabled: T("commands/moderation:securitySettings.disabled"),
    notConfigured: T("commands/moderation:securitySettings.notConfigured"),
    qrMode: T("commands/moderation:securitySettings.qrMode"),
    qrModeAllowlist: T("commands/moderation:securitySettings.qrModeAllowlist"),
    qrModeBlocklist: T("commands/moderation:securitySettings.qrModeBlocklist"),
    qrModeOff: T("commands/moderation:securitySettings.qrModeOff"),
    qrDefaultBlocklist: T("commands/moderation:securitySettings.qrDefaultBlocklist"),
    qrDescDefaultBlocklist: T("commands/moderation:securitySettings.qrDescDefaultBlocklist"),
    qrDefaultAllowlist: T("commands/moderation:securitySettings.qrDefaultAllowlist"),
    qrDescDefaultAllowlist: T("commands/moderation:securitySettings.qrDescDefaultAllowlist"),
    qrCustomBlocklist: T("commands/moderation:securitySettings.qrCustomBlocklist"),
    qrDescCustomBlocklist: T("commands/moderation:securitySettings.qrDescCustomBlocklist"),
    qrCustomAllowlist: T("commands/moderation:securitySettings.qrCustomAllowlist"),
    qrDescCustomAllowlist: T("commands/moderation:securitySettings.qrDescCustomAllowlist"),
    qrNoEntries: T("commands/moderation:securitySettings.qrNoEntries"),
    qrEntryCount: FT<{ count: number }>("commands/moderation:securitySettings.qrEntryCount"),
    qrSafeChannel: T("commands/moderation:securitySettings.qrSafeChannel"),
    qrUnsafeChannel: T("commands/moderation:securitySettings.qrUnsafeChannel"),
    qrDeleteOnUnsafe: T("commands/moderation:securitySettings.qrDeleteOnUnsafe"),
    qrToggleEnabled: T("commands/moderation:securitySettings.qrToggleEnabled"),
    qrToggleDisabled: T("commands/moderation:securitySettings.qrToggleDisabled"),
    qrChangeMode: T("commands/moderation:securitySettings.qrChangeMode"),
    qrUnsafeAlertTitle: T("commands/moderation:securitySettings.qrUnsafeAlertTitle"),
    qrUnsafeAlertAuthor: T("commands/moderation:securitySettings.qrUnsafeAlertAuthor"),
    qrUnsafeAlertChannel: T("commands/moderation:securitySettings.qrUnsafeAlertChannel"),
    qrUnsafeAlertContentType: T("commands/moderation:securitySettings.qrUnsafeAlertContentType"),
    qrSafeAlertTitle: T("commands/moderation:securitySettings.qrSafeAlertTitle"),
    qrSafeAlertAuthor: T("commands/moderation:securitySettings.qrSafeAlertAuthor"),
    qrSafeAlertChannel: T("commands/moderation:securitySettings.qrSafeAlertChannel"),
    qrSafeAlertContentType: T("commands/moderation:securitySettings.qrSafeAlertContentType"),
    qrLogTitle: T("commands/moderation:securitySettings.qrLogTitle"),
    qrLogResult: T("commands/moderation:securitySettings.qrLogResult"),
    qrLogResultUnsafe: T("commands/moderation:securitySettings.qrLogResultUnsafe"),
    qrLogResultSafe: T("commands/moderation:securitySettings.qrLogResultSafe"),
    qrLogResultNoMatch: T("commands/moderation:securitySettings.qrLogResultNoMatch"),
    qrLogAuthor: T("commands/moderation:securitySettings.qrLogAuthor"),
    qrLogChannel: T("commands/moderation:securitySettings.qrLogChannel"),
    qrLogContentType: T("commands/moderation:securitySettings.qrLogContentType"),
    qrSafeActionLabel: T("commands/moderation:securitySettings.qrSafeActionLabel"),
    qrUnsafeActionLabel: T("commands/moderation:securitySettings.qrUnsafeActionLabel"),
    qrSetSafeChannel: T("commands/moderation:securitySettings.qrSetSafeChannel"),
    qrSetUnsafeChannel: T("commands/moderation:securitySettings.qrSetUnsafeChannel"),
    qrSetLogChannel: T("commands/moderation:securitySettings.qrSetLogChannel"),
    qrToggleSafeAction: T("commands/moderation:securitySettings.qrToggleSafeAction"),
    qrToggleUnsafeAction: T("commands/moderation:securitySettings.qrToggleUnsafeAction"),
    qrAddEntry: T("commands/moderation:securitySettings.qrAddEntry"),
    qrRemoveEntry: T("commands/moderation:securitySettings.qrRemoveEntry"),
    qrAddDomainModalTitleBlocklist: T("commands/moderation:securitySettings.qrAddDomainModalTitleBlocklist"),
    qrAddDomainModalTitleAllowlist: T("commands/moderation:securitySettings.qrAddDomainModalTitleAllowlist"),
    qrModalDomainInput: T("commands/moderation:securitySettings.qrModalDomainInput"),
    qrModalDomainPlaceholder: T("commands/moderation:securitySettings.qrModalDomainPlaceholder"),
    qrInvalidDomain: T("commands/moderation:securitySettings.qrInvalidDomain"),
    qrDuplicateDomain: T("commands/moderation:securitySettings.qrDuplicateDomain"),
    qrMaxEntriesReached: T("commands/moderation:securitySettings.qrMaxEntriesReached"),
    qrDomainAdded: FT<{ domain: string }>("commands/moderation:securitySettings.qrDomainAdded"),
    qrDomainRemoved: FT<{ domain: string }>("commands/moderation:securitySettings.qrDomainRemoved"),
    qrSelectEntryToRemove: T("commands/moderation:securitySettings.qrSelectEntryToRemove"),
    qrDescMode: T("commands/moderation:securitySettings.qrDescMode"),
    qrDescSafeAction: T("commands/moderation:securitySettings.qrDescSafeAction"),
    qrDescSafeChannel: T("commands/moderation:securitySettings.qrDescSafeChannel"),
    qrDescUnsafeAction: T("commands/moderation:securitySettings.qrDescUnsafeAction"),
    qrDescUnsafeChannel: T("commands/moderation:securitySettings.qrDescUnsafeChannel"),
    qrDescDeleteOnUnsafe: T("commands/moderation:securitySettings.qrDescDeleteOnUnsafe"),
    qrQuickstartTitle: T("commands/moderation:securitySettings.qrQuickstartTitle"),
    qrQuickstepWelcome: T("commands/moderation:securitySettings.qrQuickstepWelcome"),
    qrQuickstepEnable: T("commands/moderation:securitySettings.qrQuickstepEnable"),
    qrQuickstepMode: T("commands/moderation:securitySettings.qrQuickstepMode"),
    qrQuickstepChannels: T("commands/moderation:securitySettings.qrQuickstepChannels"),
    qrQuickstepDeleteToggle: T("commands/moderation:securitySettings.qrQuickstepDeleteToggle"),
    qrQuickstepSummary: T("commands/moderation:securitySettings.qrQuickstepSummary"),
    qrQuickstartEnable: T("commands/moderation:securitySettings.qrQuickstartEnable"),
    qrQuickstartSkip: T("commands/moderation:securitySettings.qrQuickstartSkip"),
    qrQuickstartBack: T("commands/moderation:securitySettings.qrQuickstartBack"),
    qrQuickstartNext: T("commands/moderation:securitySettings.qrQuickstartNext"),
    qrQuickstartFinish: T("commands/moderation:securitySettings.qrQuickstartFinish"),
    qrQuickstartDone: T("commands/moderation:securitySettings.qrQuickstartDone"),
    qrQuickstartConfirmTitle: T("commands/moderation:securitySettings.qrQuickstartConfirmTitle"),
    qrDeleteMessage: T("commands/moderation:securitySettings.qrDeleteMessage"),
    qrMessageDeleted: T("commands/moderation:securitySettings.qrMessageDeleted"),
    qrAutoDeletedNotice: FT<{ user: string }>("commands/moderation:securitySettings.qrAutoDeletedNotice"),
  },
```

- [ ] **Step 4: Verify i18n compiles**

Run: `bun run build`
Expected: No TypeScript errors

- [ ] **Step 5: Commit i18n updates**

```bash
git add src/languages/ src/lib/i18n/
git commit -m "feat(qr): update i18n keys for domain-based lists"
```

---

### Task 7: Rewrite Settings UI

**Files:**
- Modify: `src/commands/mod/securitySettings.ts`

**Interfaces:**
- Consumes: new `QrScannerSettings` shape, new LanguageKeys
- Produces: updated settings menu with conditional pages, modal for adding domains

- [ ] **Step 1: Update executeQrSettings to use new schema**

Replace lines 180-189 in `src/commands/mod/securitySettings.ts`:

```ts
    let settings = await this.container.redis.jsonGet(guildId, "QrScanner");
    if (!settings) {
      settings = QrScanner.parse({
        mode: "off",
        customAllowlist: [],
        customBlocklist: [],
        defaultAllowlistEnabled: false,
        defaultBlocklistEnabled: false,
        safeAction: {},
        unsafeAction: {},
      });
      await this.container.redis.jsonSet(guildId, "QrScanner", settings);
    }
```

- [ ] **Step 2: Update validFields map to include new settings**

Replace lines 193-237 (the `validFields` Map construction):

```ts
    const validFields = new Map<string, QrSettingData>()
      .set("mode", {
        name: t(sk.qrMode),
        description: t(sk.qrDescMode),
        type: "select",
        selectType: ComponentType.StringSelect,
        options: [
          { label: t(sk.qrModeAllowlist), value: "allowlist", default: settings.mode === "allowlist" },
          { label: t(sk.qrModeBlocklist), value: "blocklist", default: settings.mode === "blocklist" },
          { label: t(sk.qrModeOff), value: "off", default: settings.mode === "off" },
        ],
        currentValue: settings.mode,
      });

    if (settings.mode === "blocklist") {
      validFields
        .set("defaultBlocklistEnabled", {
          name: t(sk.qrDefaultBlocklist),
          description: t(sk.qrDescDefaultBlocklist),
          type: "boolean",
          currentValue: settings.defaultBlocklistEnabled,
        });
    }

    validFields
      .set("safeAction.enabled", {
        name: t(sk.qrSafeActionLabel),
        description: t(sk.qrDescSafeAction),
        type: "boolean",
        currentValue: settings.safeAction.enabled,
      })
      .set("safeAction.channelId", {
        name: t(sk.qrSafeChannel),
        description: t(sk.qrDescSafeChannel),
        type: "select",
        selectType: ComponentType.ChannelSelect,
        currentValue: settings.safeAction.channelId ?? undefined,
      })
      .set("unsafeAction.enabled", {
        name: t(sk.qrUnsafeActionLabel),
        description: t(sk.qrDescUnsafeAction),
        type: "boolean",
        currentValue: settings.unsafeAction.enabled,
      })
      .set("unsafeAction.channelId", {
        name: t(sk.qrUnsafeChannel),
        description: t(sk.qrDescUnsafeChannel),
        type: "select",
        selectType: ComponentType.ChannelSelect,
        currentValue: settings.unsafeAction.channelId ?? undefined,
      })
      .set("unsafeAction.deleteMessage", {
        name: t(sk.qrDeleteOnUnsafe),
        description: t(sk.qrDescDeleteOnUnsafe),
        type: "boolean",
        currentValue: settings.unsafeAction.deleteMessage,
      });

    if (settings.mode === "allowlist") {
      validFields.set("defaultAllowlistEnabled", {
        name: t(sk.qrDefaultAllowlist),
        description: t(sk.qrDescDefaultAllowlist),
        type: "boolean",
        currentValue: settings.defaultAllowlistEnabled,
      });
    }
```

- [ ] **Step 3: Replace addRulesPage call with conditional custom list pages**

Replace line 328 (`this.addRulesPage(menu, guildId, t);`):

```ts
    if (settings.mode === "blocklist") {
      this.addCustomListPage(menu, guildId, t, "blocklist");
    } else if (settings.mode === "allowlist") {
      this.addCustomListPage(menu, guildId, t, "allowlist");
    }
```

- [ ] **Step 4: Remove the addRulesPage method entirely**

Delete the `addRulesPage` method (lines 333-469).

- [ ] **Step 5: Add the addCustomListPage method**

Add this method to the `SecuritySettingsCommand` class:

```ts
  private addCustomListPage(
    menu: InstanceType<typeof ComponentUtils.MenuPaginatedMessage>,
    guildId: string,
    t: TFunction,
    mode: "allowlist" | "blocklist",
  ) {
    const sk = LanguageKeys.Commands.Moderation.SecuritySettings;
    const isBlocklist = mode === "blocklist";
    const listKey = isBlocklist ? "customBlocklist" : "customAllowlist";
    const labelKey = isBlocklist ? sk.qrCustomBlocklist : sk.qrCustomAllowlist;
    const descKey = isBlocklist ? sk.qrDescCustomBlocklist : sk.qrDescCustomAllowlist;

    menu.addAsyncPageEmbed(async () => {
      const settings = await this.container.redis.jsonGet(guildId, "QrScanner");
      const list = settings?.[listKey] ?? [];
      const entriesList = list.length > 0
        ? list.map((d, i) => `${i + 1}. \`${d}\``).join("\n")
        : t(sk.qrNoEntries);
      const count = t(sk.qrEntryCount, { count: list.length });

      return new EmbedUtils.EmbedConstructor()
        .setTitle(t(labelKey))
        .setDescription(`${t(descKey)}\n\n${count}\n\n${entriesList}`);
    });

    const addButton: PaginatedMessageActionButton = {
      customId: `${this.menuId}-qr-add-domain-${mode}`,
      style: ButtonStyle.Secondary,
      label: String(t(sk.qrAddEntry)),
      type: ComponentType.Button,
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isButton()) return null;

        const modalTitle = isBlocklist ? t(sk.qrAddDomainModalTitleBlocklist) : t(sk.qrAddDomainModalTitleAllowlist);
        const modal = new ModalBuilder()
          .setCustomId(`qr-add-domain-${mode}-${nanoid()}`)
          .setTitle(String(modalTitle))
          .setComponents(
            new ActionRowBuilder<TextInputBuilder>().setComponents(
              new TextInputBuilder()
                .setCustomId("domain")
                .setLabel(String(t(sk.qrModalDomainInput)))
                .setPlaceholder(String(t(sk.qrModalDomainPlaceholder)))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(253),
            ),
          );

        await interaction.showModal(modal);
        const modalResult = await interaction.awaitModalSubmit({
          time: 600_000,
          filter: (i) => i.user.id === interaction.user.id,
        }).catch(() => null);

        if (!modalResult) return null;

        const rawDomain = modalResult.fields.getTextInputValue("domain").trim();
        const normalized = this.normalizeDomainInput(rawDomain);

        if (!normalized) {
          await modalResult.reply({ content: t(sk.qrInvalidDomain), flags: MessageFlags.Ephemeral });
          return null;
        }

        const settings = await this.container.redis.jsonGet(guildId, "QrScanner");
        if (!settings) return null;

        const list = settings[listKey];
        if (list.length >= 25) {
          await modalResult.reply({ content: t(sk.qrMaxEntriesReached), flags: MessageFlags.Ephemeral });
          return null;
        }

        if (list.includes(normalized)) {
          await modalResult.reply({ content: t(sk.qrDuplicateDomain), flags: MessageFlags.Ephemeral });
          return null;
        }

        list.push(normalized);
        await this.container.redis.jsonSet(guildId, "QrScanner", settings);
        await modalResult.deferUpdate();

        return null as any;
      },
    };
    menu.addPageAction(addButton, menu.pages.length - 1);

    const removeButton: PaginatedMessageActionButton = {
      customId: `${this.menuId}-qr-remove-domain-${mode}`,
      style: ButtonStyle.Danger,
      label: String(t(sk.qrRemoveEntry)),
      type: ComponentType.Button,
      run: async (context: PaginatedMessageActionContext) => {
        const { interaction } = context;
        if (!interaction.isButton()) return null;

        const settings = await this.container.redis.jsonGet(guildId, "QrScanner");
        if (!settings) return null;

        const list = settings[listKey];
        if (list.length === 0) return null;

        const options = list.map((d, i) => ({
          label: d.length > 80 ? `${d.slice(0, 77)}...` : d,
          value: String(i),
        }));

        const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${this.menuId}-qr-remove-select-${mode}`)
            .setPlaceholder(String(t(sk.qrSelectEntryToRemove)))
            .addOptions(options),
        );

        await interaction.update({ components: [...interaction.message.components!, selectRow] });

        const selectInteraction = await interaction.channel?.awaitMessageComponent({
          filter: (i) => i.customId === `${this.menuId}-qr-remove-select-${mode}` && i.user.id === interaction.user.id,
          time: 60_000,
        }).catch(() => null);

        if (!selectInteraction || !selectInteraction.isStringSelectMenu()) return null;

        const index = parseInt(selectInteraction.values[0], 10);
        const removed = list.splice(index, 1)[0];
        await this.container.redis.jsonSet(guildId, "QrScanner", settings);
        await selectInteraction.deferUpdate();

        return null as any;
      },
    };
    menu.addPageAction(removeButton, menu.pages.length - 1);
  }

  private normalizeDomainInput(input: string): string | null {
    let domain = input.toLowerCase().trim();
    if (!domain) return null;

    if (domain.startsWith("http://") || domain.startsWith("https://")) {
      try {
        const url = new URL(domain);
        domain = url.hostname;
      } catch {
        return null;
      }
    }

    if (domain.includes("/") || domain.includes(" ") || domain.includes(":")) {
      try {
        const url = new URL(`https://${domain}`);
        domain = url.hostname;
      } catch {
        return null;
      }
    }

    if (domain.startsWith("www.")) domain = domain.slice(4);

    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
      return null;
    }

    return domain;
  }
```

- [ ] **Step 6: Verify settings command compiles**

Run: `bun run build`
Expected: No TypeScript errors

- [ ] **Step 7: Commit settings UI rewrite**

```bash
git add src/commands/mod/securitySettings.ts
git commit -m "feat(qr): rewrite settings UI with domain-based lists"
```

---

### Task 8: Update QR Listener Tests

**Files:**
- Modify: `tests/moderation/qr-listener.test.ts`

**Interfaces:**
- Consumes: new `QrScannerSettings` shape
- Produces: updated test fixtures

- [ ] **Step 1: Update test fixtures**

Find all `QrScannerSettings` fixtures in `tests/moderation/qr-listener.test.ts` and update them:

Replace any occurrence of:
```ts
{ mode: "...", rules: [...] }
```

With:
```ts
{ mode: "...", customAllowlist: [], customBlocklist: [], defaultAllowlistEnabled: false, defaultBlocklistEnabled: false }
```

- [ ] **Step 2: Run listener tests**

Run: `bun test tests/moderation/qr-listener.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit test updates**

```bash
git add tests/moderation/qr-listener.test.ts
git commit -m "test(qr): update listener tests for new settings shape"
```

---

### Task 9: Run Full Test Suite and Lint

**Files:** none (verification only)

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 2: Run linter**

Run: `bun run lint:fix`
Expected: No lint errors

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: No TypeScript errors

- [ ] **Step 4: Final commit (if any lint/build fixes were needed)**

```bash
git add .
git commit -m "chore: lint and build fixes for QR domain lists"
```

---

## Summary

This plan implements domain-based URL lists for QR code scanning:

1. Schema changes (remove `rules`, add 4 new fields)
2. Default blocklist and allowlist files
3. Domain matching tests (TDD)
4. Domain matching engine implementation
5. Listener update for new settings shape
6. i18n keys (add new, remove old)
7. Settings UI rewrite (conditional pages, modal)
8. Listener test updates
9. Full verification

Each task is self-contained and ends with a commit. The plan follows TDD where applicable (Task 3-4) and maintains consistency with existing patterns in the codebase.
