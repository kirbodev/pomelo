# Modernized Moderation Quickstart — Design Spec

> **Date:** 2026-07-14
> **Project:** Pomelo Discord Bot
> **Feature:** Modernized `/warn quickstart` wizard
> **Replaces:** Basic 3-step quickstart (preset → modal → save)

---

## 1. Overview

The quickstart wizard is a multi-step interactive setup flow for the warn system. It guides moderators through configuring warn levels, punishments, roles, and general settings using a modern, flexible interface.

**Key improvements over the old system:**
- Two entry paths: start from preset OR build from scratch
- Fully customizable warn levels (no hard limits)
- Granular control: each warn level can have multiple punishments + roles
- Modern Components v2 UI throughout
- No "max warns" setting — warn count is dynamic based on configured levels

---

## 2. User Flow

### Step 1: Welcome Screen

**Components v2 container** with:
- Title: "Warn System Setup"
- Description: "Let's configure your warn system. Start with a preset or build from scratch."
- Two buttons:
  - **"Start from preset"** (ButtonStyle.Primary) → goes to Step 2
  - **"Build from scratch"** (ButtonStyle.Secondary) → goes to Step 3 with empty config

**Interaction:** Button click advances to the appropriate step.

---

### Step 2: Preset Selection (if chosen)

**Components v2 container** with:
- Title: "Choose a Preset"
- Description: "Pick a starting point. You can customize everything after."
- String select menu with presets:
  - **Lemomeme** — Role at warns 1-2, ban at 3
  - **Recommended** — Escalating timeouts, temp-ban at 6, ban at 7
  - **Progressive** — Timeouts, kick at 4, ban at 5
  - **Strict Strike** — Long timeouts, temp-ban at 4, ban at 5
- Button: **"Continue"** → goes to Step 3 with preset loaded

**Preset data structure:**
```ts
type Preset = {
  name: string;
  levels: WarnActionConfig[];
};
```

**Interaction:** Select preset, click Continue to load it into the editor.

---

### Step 3: General Options

**Components v2 container** with:
- Title: "General Settings"
- Description: "Configure the core warn system behavior."
- Settings (inline, using select menus and toggles):
  - **Default expiry** — String select: 3d, 7d, 14d, 30d, 60d, 90d, 180d, 365d
  - **DM on warn** — Toggle button (✅ Yes / ❌ No)
  - **Log channel** — Channel select menu (optional)
- Button: **"Configure warn levels"** (ButtonStyle.Primary) → goes to Step 4
- Button: **"Back"** (ButtonStyle.Secondary) → returns to Step 1 or 2

**Data stored in memory** (not yet saved to DB):
```ts
type QuickstartConfig = {
  defaultExpiryDays: number;
  dmOnWarn: boolean;
  logChannelId?: string;
  levels: WarnActionConfig[];
};
```

**Interaction:** Adjust settings, click "Configure warn levels" to proceed.

---

### Step 4: Warn Levels Editor (Main Hub)

**Paginated embed** (using `ComponentUtils.PomeloPaginatedMessage`) with:
- Each page shows up to 3 warn levels
- Each level displayed as a field:
  - **Level N** — summary of actions
  - If has punishments: "🔨 Mute (1h), Kick"
  - If has role: "👤 Role: @Moderator"
  - If auto-execute: "⚡ Auto"
- Buttons per level (in action row):
  - **"Edit"** (ButtonStyle.Primary) → opens Step 5 modal for that level
  - **"Remove"** (ButtonStyle.Danger) → removes the level with confirmation
- Global buttons:
  - **"Add warn level"** (ButtonStyle.Success) → adds a new empty level, opens Step 5
  - **"Back to general options"** (ButtonStyle.Secondary) → returns to Step 3
  - **"Continue to review"** (ButtonStyle.Primary) → goes to Step 6

**Pagination:**
- If ≤3 levels: single page, no pagination controls
- If >3 levels: standard PomeloPaginatedMessage with prev/next buttons

**Interaction:**
- Click "Edit" → modal for that level
- Click "Add warn level" → creates empty level, opens modal
- Click "Remove" → confirmation dialog, then removes
- Click "Continue to review" → summary screen

---

### Step 5: Edit Warn Level

**Two-step process:**

**Step 5a: Action Type Selection (on the embed)**
- When user clicks "Edit" or "Add warn level", show a Components v2 container with:
  - String select menu: Action type (Mute, Kick, Ban, Role, None)
  - Button: **"Continue"** → opens modal with relevant fields

**Step 5b: Details Modal**
- Modal title: "Edit Warn Level N" (or "Add Warn Level")
- Fields (based on action type selected):
  - If Mute/Ban: **Duration** text input (placeholder: "7d, 1h, 30m")
  - If Role: **Role** text input for role ID or mention (Discord modals don't support role selects)
  - If None: no additional fields
  - **Auto-execute** text input: "yes" or "no"
- Buttons (in modal):
  - **"Save"** → saves level, returns to Step 4
  - **"Cancel"** → discards changes, returns to Step 4

**Validation:**
- Duration must parse correctly (use `modActionService.parseDuration()`)
- Role input must resolve to a valid role ID
- Auto-execute must be "yes" or "no"

**Interaction:** Fill in fields, click Save to update the level in memory.

---

### Step 6: Review & Confirm

**Components v2 container** with:
- Title: "Review Configuration"
- Summary sections:
  - **General settings:**
    - Expiry: X days
    - DM on warn: Yes/No
    - Log channel: #channel or "None"
  - **Warn levels (N total):**
    - Level 1: [summary]
    - Level 2: [summary]
    - ...
- Buttons:
  - **"Save configuration"** (ButtonStyle.Success) → saves to DB, shows success
  - **"Edit warn levels"** (ButtonStyle.Primary) → returns to Step 4
  - **"Cancel"** (ButtonStyle.Danger) → discards everything, shows cancelled message

**On save:**
- Insert/update `warnSettings` row in libSQL
- `actions` column = JSON-stringified `levels` array
- Show success message with link to `/warn settings` for future edits

**Interaction:** Review, click Save to commit or Edit to go back.

---

## 3. Data Model

### In-Memory State (during wizard)

```ts
type QuickstartState = {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  config: {
    defaultExpiryDays: number;
    dmOnWarn: boolean;
    logChannelId?: string;
    levels: WarnActionConfig[];
  };
  currentLevelIndex?: number; // for Step 5
};
```

### Database (on save)

```ts
// warnSettings table
{
  guildId: string;
  defaultExpiryDays: number;
  dmOnWarn: boolean;
  logChannelId?: string;
  actions: string; // JSON.stringify(levels)
}
```

---

## 4. Component Architecture

### Files

| File | Role |
|---|---|
| `src/commands/mod/warnSettings.ts` | Hosts the quickstart subcommand + wizard logic |
| `src/lib/moderation/quickstartWizard.ts` | Wizard state machine + step rendering |
| `src/lib/moderation/presets.ts` | Preset definitions (extracted from warnSettings.ts) |

### State Management

The wizard uses **in-memory state** keyed by `interaction.user.id` + `interaction.guildId`. State is stored in a `Map` and cleared after:
- Save (success)
- Cancel (explicit)
- Timeout (10 minutes of inactivity)

```ts
const wizardStates = new Map<string, QuickstartState>();
```

### Component Lifecycle

- **Welcome screen:** ephemeral reply, buttons with custom IDs
- **Preset selection:** ephemeral reply, select menu + button
- **General options:** ephemeral reply, select menus + toggles + buttons
- **Warn levels editor:** ephemeral paginated embed, buttons per level
- **Edit modal:** modal with `LabelBuilder` + `TextInputBuilder`
- **Review:** ephemeral reply, summary + buttons

All components use `nanoid()` for custom IDs and filter by `interaction.user.id` to prevent cross-user interference.

---

## 5. Error Handling

| Scenario | Behavior |
|---|---|
| User times out (10 min inactivity) | Show "Setup cancelled due to inactivity" message, clear state |
| Invalid duration format | Modal validation error, ask to re-enter |
| Missing required field (e.g., role for "Role" action) | Modal validation error |
| User clicks "Back" from Step 1 | No-op (already at start) |
| User tries to edit another user's wizard | Component filter rejects, silent ignore |

---

## 6. UI/UX Details

### Brand Compliance

- All colors from `Colors` enum (no hex literals)
- Success screens: `Colors.Success`
- Error/warning screens: `Colors.Error` or `Colors.Warning`
- Info screens: `Colors.Info`
- Default embeds: `Colors.Default`

### Typography

- Bold for emphasis: **Level 1**, **Mute**, etc.
- Inline code for technical values: `7d`, `1h`, role IDs
- Emojis from `Emojis` enum where appropriate

### Writing Style

- 1st person: "I'll save this", "Let's configure"
- Informal professional: "Looks good", "Ready to save"
- Friendly assertive: "You need to set a duration"

---

## 7. Migration from Old System

The old quickstart is a simple 3-step flow:
1. Select preset
2. Modal for expiry + DM
3. Save

**Migration path:**
- Old `/warn quickstart` command is replaced with new wizard
- No data migration needed (wizard writes to same `warnSettings` table)
- Old presets are preserved in `src/lib/moderation/presets.ts`

---

## 8. Future Enhancements (Out of Scope)

- Import/export configs (JSON)
- Template sharing between servers
- Bulk edit (edit multiple levels at once)
- Warn level preview (simulate warn flow)

---

## 9. Testing Checklist

- [ ] Can start from preset
- [ ] Can start from scratch
- [ ] Can add/remove/edit warn levels
- [ ] Can navigate back/forward between steps
- [ ] Timeout clears state
- [ ] Save writes correct data to DB
- [ ] Cancel discards changes
- [ ] Component filters prevent cross-user interference
- [ ] Modal validation works (duration format, required fields)
- [ ] Pagination works for >3 levels
- [ ] All strings are localized (en-US, it, es-ES)

---

## 10. Open Questions

**Resolved:**
- ~~Max warns?~~ → No, dynamic based on configured levels
- ~~Customization approach?~~ → Both preset and from-scratch paths

**None remaining.**
