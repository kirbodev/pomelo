# Multi-Punishment Warn Levels — Design Spec

> **Safety amendment (2026-07-16):** The command-local confirmation and collector behavior in this document is superseded by [Moderation Safety and Persistent Approvals](./2026-07-16-moderation-safety-and-persistent-approvals-design.md). Crossed punishments are durable per-item approvals handled by Sapphire `InteractionHandler` files. The approval UI supports partial application, `Apply all`, and permission-gated dismissal. `autoApplyWarnPunishments` and `dangerouslyBypassWarnPermissions` are separate, default-off guild settings. Automatic execution always requires issuer hierarchy; the dangerous setting bypasses only missing action-specific permissions.

> **Date:** 2026-07-16
> **Project:** Pomelo Discord Bot
> **Scope:** Rework the warn-level editor in the `/warn quickstart` wizard so each warn level can apply multiple punishments, carry a per-level message, and offer customisable punishment durations (editable mute time; ban permanent vs temporary).

---

## 1. Goals

1. **Multiple punishments per warn level.** A single warn threshold can apply several actions at once (e.g. mute + role + kick).
2. **Per-level message.** Custom text, written during setup, appended to the **DM sent to the warned user** when that level is crossed. Not a separate DM, not a channel post, not in the mod-facing success embed.
3. **Customisable punishments.** Mute duration is editable (up to 28 days, Discord's cap). Ban is either **permanent** or a **temp ban with a duration** (auto-unban scheduled). Role keeps its role picker. Kick has no parameters.

## 2. Non-goals

- No change to the `mod_cases` / `warns` / `case_notes` tables.
- No change to the DM the warned user receives beyond appending the per-level message.
- No channel-post "message" punishment. The old `actionType: "message"` shape (never user-selectable, no live data) is dropped.
- No DB migration. The `actions` column stays a `text` JSON column; only its shape changes, with read-time conversion of legacy configs.

---

## 3. Data model

### 3.1 New types (`src/lib/moderation/types.ts`)

```ts
export type WarnPunishmentType = "mute" | "kick" | "ban" | "role";

export type WarnPunishment = {
  type: WarnPunishmentType;
  duration?: number;            // ms. ban: omitted = permanent. mute: required, <= 2419200000 (28d)
  roleId?: string;              // role only
  deleteMessageDays?: 0 | 86400 | 259200 | 604800; // ban only, default 0
};

export type WarnLevel = {
  warnCount: number;            // threshold (1-based)
  punishments: WarnPunishment[]; // empty = "record only"
  message?: string;             // per-level text, appended to the warned user's DM
  autoConfirm: boolean;         // applies to all punishments in this level
};
```

The `WarnActionConfig` type is removed. `WarnActionResult` (see 4.4) and `RoleApplyConfig` stay.

### 3.2 Storage

The `warn_settings.actions` column keeps storing JSON, now a serialized `WarnLevel[]`. Same column, same default `"[]"`.

### 3.3 Legacy conversion (`normalizeActions`)

A helper `normalizeActions(raw: string | null | undefined): WarnLevel[]` lives in a new `src/lib/moderation/migration.ts` (logic, not types — keeps `types.ts` pure). It converts the old flat `WarnActionConfig[]` on every read:

- Flat entry `{ warnCount, actionType, duration, roleId, autoConfirm }` becomes `WarnLevel { warnCount, punishments: [{ type: actionType, duration, roleId }], autoConfirm }`.
- `actionType: "none"` becomes `WarnLevel { warnCount, punishments: [], autoConfirm }`.
- `actionType: "message"` is dropped (never user-selectable, no live data; its `message` field is not preserved).
- Multiple flat entries sharing a `warnCount` are merged into one `WarnLevel` with multiple punishments.
- Levels are deduplicated by `warnCount` and sorted ascending.

Every read site (`actions.ts` threshold loop, `warnSettings.ts` view/actions renderers, `quickstartWizard.ts` preset import) calls `normalizeActions` instead of raw `JSON.parse`. Writes always store the new shape.

---

## 4. Execution engine (`src/lib/moderation/actions.ts`)

### 4.1 Threshold loop

`warn()` and `setWarnLevel()` replace the flat-action loop with a level loop. Threshold detection stays "newly crossed only": a level fires when `level.warnCount > preCount && level.warnCount <= postCount`.

```ts
const levels = normalizeActions(settings?.actions);
const crossed = levels.filter(l => l.warnCount > preCount && l.warnCount <= postCount);

for (const level of crossed) {
  if (level.punishments.length === 0) continue;          // record-only, no punishment to run
  if (level.autoConfirm) {
    const result = await this.executeLevel(guild, moderator, target, level, reason);
    thresholdActions.push({ level, autoExecuted: true, results: result.results });
  } else {
    // Service does NOT block here. It records the level as pending and returns.
    // The command layer (warn.ts handleWarnResult) presents the confirmation
    // dialog and calls executeLevel on confirm (see section 6).
    thresholdActions.push({ level, autoExecuted: false });
  }
}
```

### 4.2 `executeLevel` + `executePunishment`

`executeLevel` is **public** — the command layer calls it after a manual confirmation (section 6). `executePunishment` stays private.

```ts
async executeLevel(guild, moderator, target, level, reason): Promise<LevelExecResult> {
  const results: PunishResult[] = [];
  for (const p of level.punishments) {
    try {
      await this.executePunishment(guild, moderator, target, p, reason);
      results.push({ punishment: p, success: true });
    } catch (err) {
      results.push({ punishment: p, success: false, error: String(err) });
    }
  }
  return { level, results };
}
```

`executePunishment` is a switch over `p.type`, reusing the existing action bodies:

- **mute** — requires `duration`. Missing or > 28d throws `durationTooLong`. Caught per-punishment so sibling punishments still run.
- **ban** with no `duration` — permanent, no `autoUnban` task scheduled.
- **ban** with `duration` — temp ban + `autoUnban` BullMQ task (existing behaviour).
- **role** — `target.roles.add(role, reason)` if the role resolves.
- **kick** — `target.kick(reason)`.

Each punishment produces its own `mod_cases` row via the existing `ban`/`mute`/`kick` methods (which already log). Role application does not create a case row (unchanged from today).

### 4.3 Per-level DM message

Applies to `warn()` only. `setWarnLevel()` does not DM today (`dmSent: false`) and that is unchanged — it is a direct mod tool, not a user-facing warn event.

The DM is sent **once**, with the per-level messages of all newly-crossed levels appended. To compute them before sending, the order in `warn()` becomes: validate -> count warns -> insert warns -> load settings + `normalizeActions` -> compute `crossed` -> send DM (with messages) -> run threshold loop.

A new `tryWarnDm(target, guildName, reason, amount, levelMessages)` replaces the inline `tryDm("warned", ...)` call:

```
You've been warned in **Server**.
Reason: spamming links (warn level: 1)

⚠️ Level 3: This is your final warning. Next one is a ban.
```

- `levelMessages` is collected from **all** crossed levels (including record-only ones with `punishments: []`), each `message` trimmed and non-empty, prefixed with `⚠️ Level N: `.
- No crossed level has a message -> the DM is identical to today.
- `dmOnWarn: false` -> the entire DM is skipped, message included. This also fixes a pre-existing gap where `warn()` DMs even when `dmOnWarn` is false; the DM send is gated on `settings.dmOnWarn`.
- `autoConfirm: false` levels still contribute their message to the DM. The user reached that warn count, so they get the warning text regardless of whether the mod later confirms the punishment.
- **Sanitization:** each level message is sanitized via a `sanitizeLevelMessage(text)` helper (in `src/lib/moderation/migration.ts` alongside `normalizeActions`) at both save time (level-details modal) and render time (defense in depth). It strips `@everyone` / `@here` mass-ping tokens and role mentions `<@&id>` (which don't render usefully in a DM); user mentions `<@id>` / `<@!id>` are kept since a mod may intentionally reference a user. The stored value is the sanitized text, capped at 1000 chars (see 5.5).
- **2000-char DM cap:** the base warn DM is always short. If appending the level messages would exceed Discord's 2000-char message limit, the level messages are sent as a single follow-up message in the same DM channel (a continuation, not a separate notification) rather than truncating mid-sentence.

### 4.4 `WarnActionResult` shape

```ts
type PunishResult = { punishment: WarnPunishment; success: boolean; error?: string };
type LevelExecResult = { level: WarnLevel; results: PunishResult[] };

type WarnActionResult = ModActionResult & {
  warnCount: number;
  thresholdActions?: Array<{
    level: WarnLevel;
    autoExecuted: boolean;
    results?: PunishResult[];   // present when autoExecuted
    error?: string;             // present when confirm declined / failed
  }>;
};
```

`warn.ts` `handleWarnResult` renders each level: one line per punishment with ✅ / ❌ and the error when present. The per-level message is **not** repeated here (it lives in the DM only).

---

## 5. Step-5 editor UX (`src/lib/moderation/quickstartWizard.ts`)

Step 5 (`renderEditWarnLevel`) changes from a single action-type select to a punishment list.

### 5.1 Layout (Components v2)

```
# Edit Warn Level 3
Level 3 — Mute (12h), Role → @Warned ⚡ Auto

Punishments
• Mute — 12h          [✏️] [🗑️]
• Role → @Warned      [✏️] [🗑️]

[Add punishment ▾]            (StringSelect: mute / kick / ban / role)
─────
[Edit level details]          (modal: per-level message + autoConfirm)
[Remove level]  [Back to levels]
```

### 5.2 Button emoji convention

**Emoji-only where the icon is self-explanatory; text-only otherwise. Never both on the same button.**

| Button | Treatment | Reason |
|---|---|---|
| Edit punishment / edit level details | `✏️` emoji-only | The row/section text gives context |
| Remove punishment / remove level | `🗑️` emoji-only | Unambiguous on a one-line row |
| Add punishment / add warn level | text-only "Add punishment" / "Add warn level" | A bare `➕` on an empty list is not clear enough |
| Back / cancel | text-only "Back" / "Cancel" | Icon alone is ambiguous mid-wizard |
| Continue / confirm / save | text-only "Continue" / "Confirm" / "Save" | Icon alone is ambiguous |
| Auto / manual markers in summaries | keep existing `⚡`/`⚠️` inline text | Not buttons |

All emojis are Unicode glyphs (not custom guild emoji), so they render in every server with no `Emojis` enum dependency. Reused glyphs are added to `src/lib/emojis.ts` for consistency if not already present.

### 5.3 Interactions (new customIds, handled in `handleComponentInteraction` step 5)

- `addPunishment` (StringSelect) — pushes a new punishment with defaults onto `level.punishments`, then opens the punishment-detail modal for the new entry. Defaults: mute -> `{ type: "mute", duration: 3600000 }`; ban -> `{ type: "ban" }` (permanent); role -> `{ type: "role", roleId: "" }` (modal requires the role); kick -> `{ type: "kick" }`.
- `editPunishment:<i>` (Button, emoji `✏️`) — opens the punishment-detail modal pre-filled with punishment `i`'s current values.
- `removePunishment:<i>` (Button, emoji `🗑️`) — splices punishment `i`, re-renders step 5.
- `editLevelDetails` (Button, text "Edit level details") — opens the level-details modal.
- `removeCurrentLevel`, `cancelEdit` — unchanged behaviour, text labels.

### 5.4 Punishment-detail modal (`showPunishmentModal`, replaces `showDetailsModal`)

One modal open at a time; `state.modalCustomId` is reused.

- **mute** — `duration` field, required, placeholder `1h`. Parsed via `modActionService.parseDuration`. Rejected if missing or > 28d with the existing `invalidDuration` key.
- **ban** — `duration` field, **optional**, placeholder `7d or leave blank for permanent`. Empty -> permanent. Filled -> temp ban.
- **role** — `role` field, required, ID or mention, stripped to a raw ID with `replace(/[<@&>]/g, "")`.
- **kick** — no fields; the modal is skipped and the punishment is added directly.

Cap: **4 punishments per level**. Hitting the cap disables the `addPunishment` select and shows the `maxPunishments` hint. No silent truncation.

### 5.5 Level-details modal (`showLevelDetailsModal`)

- `message` — `TextInputStyle.Paragraph`, optional, `setMaxLength(1000)`, placeholder `Shown to the user in their warn DM at this level.`. Trimmed on save; empty/whitespace -> `undefined`. Sanitized via `sanitizeLevelMessage` at save and render (see 4.3).
- `autoExecute` — `TextInputStyle.Short`, required, `yes` / `no` (kept as a text input to match the existing pattern; noted as a future cleanup to become a toggle button).

### 5.6 State

`QuickstartState` gains nothing new. `currentLevelIndex` already points at the `WarnLevel` being edited; punishments and the message live inside it. `QuickstartConfig.levels` becomes `WarnLevel[]`.

The **add-level** button (step 4) now pushes `{ warnCount: levels.length + 1, punishments: [], autoConfirm: true }` instead of the old `actionType: "none"` shape.

### 5.7 Summary rendering

`formatLevelSummary` lists the level's punishments comma-joined (`Mute (12h), Role → @Warned`), then the `⚡ Auto` / `⚠️ Manual` marker. A record-only level (`punishments: []`) renders as the existing `none` label. The step-4 level list and step-6 review both use this summary.

---

## 6. Confirmation dialog for `autoConfirm: false` levels

When a warn crosses a level with `autoConfirm: false`, instead of auto-running, the mod gets a v2 confirmation via `ComponentUtils.ButtonConfirmationConstructor`:

```
Level 3 threshold reached for @user
Punishments: Mute (12h), Role → @Warned
[Confirm]  [Cancel]
```

- **Confirm** -> `executeLevel` runs all the level's punishments; results append to the final success embed.
- **Cancel / timeout** -> recorded as declined. The warn itself still stands; only the punishment is skipped.
- 10-minute timeout, **error shown on timeout** per the Brand Book rule for confirmation dialogs.
- The per-level DM message already went out (section 4.3). Confirmation gates the punishment only, not the DM.

Because `warn()` / `setWarnLevel()` run inside a deferred reply and the confirmation is a follow-up component interaction, the service returns `autoExecuted: false` for these levels and the command layer (`warn.ts`) is responsible for presenting the dialog and calling `executeLevel` on confirm. The service exposes `executeLevel` as a public method for this.

Both the `/warn` and `/warn level set` paths flow through `handleWarnResult`, so that is the single place that detects `autoExecuted: false` levels and presents the confirmation dialog.

---

## 7. Presets (`src/lib/moderation/presets.ts`)

All four presets convert to `WarnLevel[]`. `WarnPreset.levels` becomes `WarnLevel[]`.

Example — `recommended`:

```ts
levels: [
  { warnCount: 2, punishments: [{ type: "mute", duration: 3600000 }], autoConfirm: true },
  { warnCount: 3, punishments: [{ type: "mute", duration: 43200000 }], autoConfirm: true },
  { warnCount: 4, punishments: [{ type: "mute", duration: 259200000 }], autoConfirm: true },
  { warnCount: 5, punishments: [{ type: "mute", duration: 604800000 }], autoConfirm: true },
  { warnCount: 6, punishments: [{ type: "ban", duration: 604800000 }], autoConfirm: true },
  { warnCount: 7, punishments: [{ type: "ban" }], autoConfirm: true }, // permanent
],
```

`lemomeme`'s role levels keep `punishments: [{ type: "role", roleId: "" }]` — the mod fills the role via the editor after picking the preset (same empty-`roleId` flow as today).

The preset-detection logic in `renderPresetSelection` (comparing `JSON.stringify(p.levels)` to the current config) is updated to compare normalized `WarnLevel[]` shapes.

---

## 8. i18n keys (new, all three locales, humanized)

Added under `LanguageKeys.Commands.Moderation.WarnSettings.Quickstart`:

| Key | English draft |
|---|---|
| `punishments` | "Punishments" |
| `addPunishment` | "Add punishment" |
| `editPunishment` | "Edit punishment" |
| `removePunishment` | "Remove" |
| `levelDetails` | "Edit level details" |
| `levelMessage` | "Level message" |
| `levelMessagePlaceholder` | "Shown to the user in their warn DM at this level." |
| `durationOptional` | "Duration (leave blank for permanent)" |
| `durationPermanent` | "Permanent" |
| `maxPunishments` | "A level can have up to 4 punishments." |
| `confirmLevelTitle` | "Level {{level}} threshold reached" |
| `confirmLevelDesc` | "Punishments: {{punishments}}" |
| `confirmLevelConfirm` | "Confirm" |
| `confirmLevelCancel` | "Cancel" |
| `confirmLevelDeclined` | "Punishment skipped." |
| `punishmentMute` | "Mute" |
| `punishmentKick` | "Kick" |
| `punishmentBan` | "Ban" |
| `punishmentBanPerm` | "Permanent ban" |
| `punishmentRole` | "Role" |

Every string is run through the humanizer skill before it lands, and translated to `it` and `es-ES` with the same humanizer pass. `actionsListLine` / `actionsListDuration` in `warnSettings.ts` are updated to render the multi-punishment summary.

The existing `actionMute` / `actionKick` / `actionBan` / `actionRole` / `actionNone` keys are reused where the single-action label still fits (preset descriptions, view renderers). The new `punishment*` keys are used inside the editor and confirm dialog where permanent-vs-temp ban needs to read differently.

---

## 9. Files touched

| File | Change |
|---|---|
| `src/lib/moderation/types.ts` | Replace `WarnActionConfig` with `WarnPunishment` + `WarnLevel`; add `PunishResult`, `LevelExecResult`; update `WarnActionResult` |
| `src/lib/moderation/migration.ts` | New file. `normalizeActions(raw): WarnLevel[]` — legacy flat-config conversion; `sanitizeLevelMessage(text)` — strip mass-pings + role mentions, cap 1000 chars |
| `src/lib/moderation/actions.ts` | Level-based threshold loop; public `executeLevel` + private `executePunishment`; `tryWarnDm` with per-level messages; gate DM on `dmOnWarn` |
| `src/lib/moderation/presets.ts` | Rewrite all presets to `WarnLevel[]` |
| `src/lib/moderation/quickstartWizard.ts` | Step-5 punishment list editor; punishment-detail + level-details modals; emoji buttons; `WarnLevel[]` state |
| `src/commands/mod/warn.ts` | `handleWarnResult` renders per-punishment results; presents `autoConfirm: false` confirmation dialog and calls `executeLevel` on confirm |
| `src/commands/mod/warnSettings.ts` | View + actions renderers read `WarnLevel[]` via `normalizeActions`; multi-punishment summary |
| `src/lib/i18n/commands/moderation.ts` | New `Quickstart` keys |
| `src/languages/en-US/commands/moderation.json` | New strings |
| `src/languages/it/commands/moderation.json` | New strings |
| `src/languages/es-ES/commands/moderation.json` | New strings |
| `src/lib/emojis.ts` | Add reused glyphs (`✏️`, `🗑️`) if not present |

No DB migration. No new tables. No new scheduled tasks (temp bans reuse the existing `autoUnban` task).

---

## 10. Testing checklist (per AGENTS.md §12)

- [ ] Step 5: add mute / kick / ban / role punishments; edit each; remove each; 4-punishment cap disables the add select.
- [ ] Ban punishment: permanent (blank duration) vs temp (filled duration) both save and execute correctly; temp ban schedules `autoUnban`.
- [ ] Mute punishment: duration editable; > 28d rejected with `invalidDuration`; missing duration rejected.
- [ ] Per-level message: set, saved, rendered in the warned user's DM only (not the success embed, not a channel, not a separate DM).
- [ ] `dmOnWarn: false` skips the entire DM including the per-level message.
- [ ] `setWarnLevel` does not send a DM (unchanged); its `autoConfirm: false` levels still present confirmation via `handleWarnResult`.
- [ ] Per-level messages that would exceed Discord's 2000-char DM limit spill into a single follow-up DM message instead of truncating.
- [ ] Per-level message sanitization: `@everyone` / `@here` and role mentions `<@&id>` are stripped; user mentions `<@id>` are kept; messages over 1000 chars are rejected/capped at the editor.
- [ ] Multiple punishments on one level all execute; one failing punishment does not abort siblings.
- [ ] `autoConfirm: false` level presents the confirmation dialog; confirm runs punishments, cancel/timeout skips them with an error shown on timeout.
- [ ] Legacy flat `actions` JSON loads correctly via `normalizeActions` (single action, `none`, duplicate `warnCount`, `message` type dropped).
- [ ] Presets apply in the new shape; preset detection matches after edits.
- [ ] View (`/warn settings`) and actions list render multi-punishment levels.
- [ ] All new strings localized in `en-US`, `it`, `es-ES` and humanized.
- [ ] Buttons use emoji-only or text-only per §5.2; no button mixes label and emoji.


