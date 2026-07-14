# Modernized Moderation Quickstart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 6-step interactive quickstart wizard for the warn system with preset/from-scratch options, dynamic warn levels, and Components v2 UI.

**Architecture:** State machine-based wizard with in-memory state keyed by user+guild. Each step renders Components v2 containers with buttons/selects. Wizard writes to existing `warnSettings` table on completion.

**Tech Stack:** Sapphire 5, discord.js v14.22+, Components v2, libSQL/Turso, i18next

## Global Constraints

- All new files use Components v2 (`ContainerBuilder` + `TextDisplayBuilder`/`SectionBuilder`/`SeparatorBuilder`) with `MessageFlags.IsComponentsV2`
- Commands extend `CommandUtils.PomeloCommand` or `CommandUtils.PomeloSubcommand`
- Guild-only — NO `UserInstall` integration type
- Ephemeral-by-default replies
- Colors from `src/lib/colors.ts`; Emojis from `src/lib/emojis.ts`
- i18n: three locales (`en-US`, `it`, `es-ES`), keys via `src/lib/i18n/commands/moderation.ts`
- All strings must pass through humanizer skill before committing
- Component timeouts: 10 minutes, silent on timeout (no error message)
- Use `nanoid()` for custom IDs, filter components by `interaction.user.id`

---

## File Structure

```
src/
├── commands/mod/
│   └── warnSettings.ts              # Modify: add quickstart wizard entry point
├── lib/moderation/
│   ├── quickstartWizard.ts          # New: wizard state machine + step rendering
│   └── presets.ts                   # New: preset definitions (extract from warnSettings.ts)
├── languages/
│   ├── en-US/commands/
│   │   └── moderation.json          # Modify: add quickstart strings
│   ├── it/commands/
│   │   └── moderation.json          # Modify: add quickstart strings (Italian)
│   └── es-ES/commands/
│       └── moderation.json          # Modify: add quickstart strings (Spanish)
└── lib/i18n/commands/
    └── moderation.ts                # Modify: add LanguageKeys for quickstart
```

---

### Task 1: Extract Presets to Separate File

**Files:**
- Create: `src/lib/moderation/presets.ts`
- Modify: `src/commands/mod/warnSettings.ts:28-54` (remove inline PRESETS)

**Interfaces:**
- Consumes: `WarnActionConfig` from `src/lib/moderation/types.ts`
- Produces: `PRESETS` object used by quickstart wizard

- [ ] **Step 1: Create presets.ts**

```ts
import type { WarnActionConfig } from "./types.js";

export const PRESETS: Record<string, { name: string; levels: WarnActionConfig[] }> = {
  lemomeme: {
    name: "Lemomeme",
    levels: [
      { warnCount: 1, actionType: "role", roleId: "", autoConfirm: true },
      { warnCount: 2, actionType: "role", roleId: "", autoConfirm: true },
      { warnCount: 3, actionType: "ban", autoConfirm: true },
    ],
  },
  recommended: {
    name: "Recommended",
    levels: [
      { warnCount: 2, actionType: "mute", duration: 3600000, autoConfirm: true },
      { warnCount: 3, actionType: "mute", duration: 43200000, autoConfirm: true },
      { warnCount: 4, actionType: "mute", duration: 259200000, autoConfirm: true },
      { warnCount: 5, actionType: "mute", duration: 604800000, autoConfirm: true },
      { warnCount: 6, actionType: "ban", duration: 604800000, autoConfirm: true },
      { warnCount: 7, actionType: "ban", autoConfirm: true },
    ],
  },
  progressive: {
    name: "Progressive",
    levels: [
      { warnCount: 2, actionType: "mute", duration: 86400000, autoConfirm: true },
      { warnCount: 3, actionType: "mute", duration: 604800000, autoConfirm: true },
      { warnCount: 4, actionType: "kick", autoConfirm: true },
      { warnCount: 5, actionType: "ban", autoConfirm: true },
    ],
  },
  strictStrike: {
    name: "Strict Strike",
    levels: [
      { warnCount: 2, actionType: "mute", duration: 259200000, autoConfirm: true },
      { warnCount: 3, actionType: "mute", duration: 604800000, autoConfirm: true },
      { warnCount: 4, actionType: "ban", duration: 1209600000, autoConfirm: true },
      { warnCount: 5, actionType: "ban", autoConfirm: true },
    ],
  },
};
```

- [ ] **Step 2: Update warnSettings.ts to import presets**

Add import at top of `src/commands/mod/warnSettings.ts`:

```ts
import { PRESETS } from "../../lib/moderation/presets.js";
```

- [ ] **Step 3: Remove inline PRESETS from warnSettings.ts**

Delete lines 28-54 in `src/commands/mod/warnSettings.ts` (the `const PRESETS: Record<string, WarnActionConfig[]> = { ... }` block).

- [ ] **Step 4: Update preset references in warnSettings.ts**

Change all `PRESETS[preset]` to `PRESETS[preset].levels` in `src/commands/mod/warnSettings.ts`:

```ts
// In showPresetSelector method
const actionsJson = JSON.stringify(PRESETS[preset].levels);

// In runQuickstart method
actions: JSON.stringify(PRESETS[preset].levels),
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/moderation/presets.ts src/commands/mod/warnSettings.ts
git commit -m "refactor: extract presets to separate file"
```

---

### Task 2: Add i18n Keys for Quickstart

**Files:**
- Modify: `src/languages/en-US/commands/moderation.json`
- Modify: `src/languages/it/commands/moderation.json`
- Modify: `src/languages/es-ES/commands/moderation.json`
- Modify: `src/lib/i18n/commands/moderation.ts`

**Interfaces:**
- Consumes: i18n infrastructure
- Produces: `LanguageKeys.Commands.Moderation.Quickstart.*` keys

- [ ] **Step 1: Add English quickstart keys**

Add to `src/languages/en-US/commands/moderation.json` inside the `warnSettings` object:

```json
"quickstart": {
  "welcomeTitle": "Warn System Setup",
  "welcomeDescription": "Let's configure your warn system. Start with a preset or build from scratch.",
  "startFromPreset": "Start from preset",
  "buildFromScratch": "Build from scratch",
  "presetTitle": "Choose a Preset",
  "presetDescription": "Pick a starting point. You can customize everything after.",
  "presetLemomeme": "Lemomeme",
  "presetLemomemeDesc": "Role at warns 1-2, ban at 3",
  "presetRecommended": "Recommended",
  "presetRecommendedDesc": "Escalating timeouts, temp-ban at 6, ban at 7",
  "presetProgressive": "Progressive",
  "presetProgressiveDesc": "Timeouts, kick at 4, ban at 5",
  "presetStrictStrike": "Strict Strike",
  "presetStrictStrikeDesc": "Long timeouts, temp-ban at 4, ban at 5",
  "continue": "Continue",
  "generalOptionsTitle": "General Settings",
  "generalOptionsDescription": "Configure the core warn system behavior.",
  "defaultExpiry": "Default expiry",
  "dmOnWarn": "DM on warn",
  "logChannel": "Log channel",
  "configureWarnLevels": "Configure warn levels",
  "back": "Back",
  "warnLevelsTitle": "Warn Levels",
  "warnLevelsDescription": "Configure punishments and roles for each warn level.",
  "addWarnLevel": "Add warn level",
  "backToGeneral": "Back to general options",
  "continueToReview": "Continue to review",
  "edit": "Edit",
  "remove": "Remove",
  "editWarnLevelTitle": "Edit Warn Level {{level}}",
  "addWarnLevelTitle": "Add Warn Level",
  "actionType": "Action type",
  "duration": "Duration",
  "durationPlaceholder": "7d, 1h, 30m",
  "role": "Role",
  "rolePlaceholder": "Role ID or mention",
  "autoExecute": "Auto-execute",
  "autoExecuteYes": "yes",
  "autoExecuteNo": "no",
  "save": "Save",
  "cancel": "Cancel",
  "reviewTitle": "Review Configuration",
  "generalSettings": "General settings",
  "expiryDays": "{{days}} days",
  "warnLevelsSummary": "Warn levels ({{count}} total)",
  "levelNSummary": "Level {{level}}",
  "saveConfiguration": "Save configuration",
  "editWarnLevels": "Edit warn levels",
  "savedTitle": "Configuration Saved",
  "savedDescription": "Your warn system is ready to go.",
  "cancelledTitle": "Setup Cancelled",
  "cancelledDescription": "No changes were saved.",
  "timeoutTitle": "Setup Timed Out",
  "timeoutDescription": "You took too long. Run `/warn quickstart` to start again.",
  "invalidDuration": "That doesn't look like a valid duration. Use format like `7d`, `1h`, `30m`.",
  "invalidAutoExecute": "Please enter `yes` or `no`.",
  "none": "None",
  "auto": "Auto",
  "manual": "Manual"
}
```

- [ ] **Step 2: Add Italian quickstart keys**

Add Italian translations to `src/languages/it/commands/moderation.json` (same structure, translated).

- [ ] **Step 3: Add Spanish quickstart keys**

Add Spanish translations to `src/languages/es-ES/commands/moderation.json` (same structure, translated).

- [ ] **Step 4: Add LanguageKeys in moderation.ts**

Add to `src/lib/i18n/commands/moderation.ts` inside the `WarnSettings` object:

```ts
Quickstart: {
  welcomeTitle: T("commands/moderation:warnSettings.quickstart.welcomeTitle"),
  welcomeDescription: T("commands/moderation:warnSettings.quickstart.welcomeDescription"),
  startFromPreset: T("commands/moderation:warnSettings.quickstart.startFromPreset"),
  buildFromScratch: T("commands/moderation:warnSettings.quickstart.buildFromScratch"),
  presetTitle: T("commands/moderation:warnSettings.quickstart.presetTitle"),
  presetDescription: T("commands/moderation:warnSettings.quickstart.presetDescription"),
  presetLemomeme: T("commands/moderation:warnSettings.quickstart.presetLemomeme"),
  presetLemomemeDesc: T("commands/moderation:warnSettings.quickstart.presetLemomemeDesc"),
  presetRecommended: T("commands/moderation:warnSettings.quickstart.presetRecommended"),
  presetRecommendedDesc: T("commands/moderation:warnSettings.quickstart.presetRecommendedDesc"),
  presetProgressive: T("commands/moderation:warnSettings.quickstart.presetProgressive"),
  presetProgressiveDesc: T("commands/moderation:warnSettings.quickstart.presetProgressiveDesc"),
  presetStrictStrike: T("commands/moderation:warnSettings.quickstart.presetStrictStrike"),
  presetStrictStrikeDesc: T("commands/moderation:warnSettings.quickstart.presetStrictStrikeDesc"),
  continue: T("commands/moderation:warnSettings.quickstart.continue"),
  generalOptionsTitle: T("commands/moderation:warnSettings.quickstart.generalOptionsTitle"),
  generalOptionsDescription: T("commands/moderation:warnSettings.quickstart.generalOptionsDescription"),
  defaultExpiry: T("commands/moderation:warnSettings.quickstart.defaultExpiry"),
  dmOnWarn: T("commands/moderation:warnSettings.quickstart.dmOnWarn"),
  logChannel: T("commands/moderation:warnSettings.quickstart.logChannel"),
  configureWarnLevels: T("commands/moderation:warnSettings.quickstart.configureWarnLevels"),
  back: T("commands/moderation:warnSettings.quickstart.back"),
  warnLevelsTitle: T("commands/moderation:warnSettings.quickstart.warnLevelsTitle"),
  warnLevelsDescription: T("commands/moderation:warnSettings.quickstart.warnLevelsDescription"),
  addWarnLevel: T("commands/moderation:warnSettings.quickstart.addWarnLevel"),
  backToGeneral: T("commands/moderation:warnSettings.quickstart.backToGeneral"),
  continueToReview: T("commands/moderation:warnSettings.quickstart.continueToReview"),
  edit: T("commands/moderation:warnSettings.quickstart.edit"),
  remove: T("commands/moderation:warnSettings.quickstart.remove"),
  editWarnLevelTitle: FT<{ level: number }>("commands/moderation:warnSettings.quickstart.editWarnLevelTitle"),
  addWarnLevelTitle: T("commands/moderation:warnSettings.quickstart.addWarnLevelTitle"),
  actionType: T("commands/moderation:warnSettings.quickstart.actionType"),
  duration: T("commands/moderation:warnSettings.quickstart.duration"),
  durationPlaceholder: T("commands/moderation:warnSettings.quickstart.durationPlaceholder"),
  role: T("commands/moderation:warnSettings.quickstart.role"),
  rolePlaceholder: T("commands/moderation:warnSettings.quickstart.rolePlaceholder"),
  autoExecute: T("commands/moderation:warnSettings.quickstart.autoExecute"),
  autoExecuteYes: T("commands/moderation:warnSettings.quickstart.autoExecuteYes"),
  autoExecuteNo: T("commands/moderation:warnSettings.quickstart.autoExecuteNo"),
  save: T("commands/moderation:warnSettings.quickstart.save"),
  cancel: T("commands/moderation:warnSettings.quickstart.cancel"),
  reviewTitle: T("commands/moderation:warnSettings.quickstart.reviewTitle"),
  generalSettings: T("commands/moderation:warnSettings.quickstart.generalSettings"),
  expiryDays: FT<{ days: number }>("commands/moderation:warnSettings.quickstart.expiryDays"),
  warnLevelsSummary: FT<{ count: number }>("commands/moderation:warnSettings.quickstart.warnLevelsSummary"),
  levelNSummary: FT<{ level: number }>("commands/moderation:warnSettings.quickstart.levelNSummary"),
  saveConfiguration: T("commands/moderation:warnSettings.quickstart.saveConfiguration"),
  editWarnLevels: T("commands/moderation:warnSettings.quickstart.editWarnLevels"),
  savedTitle: T("commands/moderation:warnSettings.quickstart.savedTitle"),
  savedDescription: T("commands/moderation:warnSettings.quickstart.savedDescription"),
  cancelledTitle: T("commands/moderation:warnSettings.quickstart.cancelledTitle"),
  cancelledDescription: T("commands/moderation:warnSettings.quickstart.cancelledDescription"),
  timeoutTitle: T("commands/moderation:warnSettings.quickstart.timeoutTitle"),
  timeoutDescription: T("commands/moderation:warnSettings.quickstart.timeoutDescription"),
  invalidDuration: T("commands/moderation:warnSettings.quickstart.invalidDuration"),
  invalidAutoExecute: T("commands/moderation:warnSettings.quickstart.invalidAutoExecute"),
  none: T("commands/moderation:warnSettings.quickstart.none"),
  auto: T("commands/moderation:warnSettings.quickstart.auto"),
  manual: T("commands/moderation:warnSettings.quickstart.manual"),
},
```

- [ ] **Step 5: Commit**

```bash
git add src/languages/ src/lib/i18n/commands/moderation.ts
git commit -m "i18n: add quickstart language keys"
```

---

### Task 3: Create Wizard State Machine

**Files:**
- Create: `src/lib/moderation/quickstartWizard.ts`

**Interfaces:**
- Consumes: `WarnActionConfig`, `PRESETS` from earlier tasks
- Produces: `QuickstartWizard` class with step rendering methods

- [ ] **Step 1: Create quickstartWizard.ts with state types**

```ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "discord.js";
import { nanoid } from "nanoid";
import { fetchT } from "../i18n/utils.js";
import { Colors } from "../colors.js";
import { LanguageKeys } from "../i18n/languageKeys.js";
import { PRESETS } from "./presets.js";
import type { WarnActionConfig } from "./types.js";
import type { Command, Interaction } from "@sapphire/framework";

export type QuickstartStep = 1 | 2 | 3 | 4 | 5 | 6;

export type QuickstartConfig = {
  defaultExpiryDays: number;
  dmOnWarn: boolean;
  logChannelId?: string;
  levels: WarnActionConfig[];
};

export type QuickstartState = {
  step: QuickstartStep;
  config: QuickstartConfig;
  currentLevelIndex?: number;
  selectedActionType?: string;
};

const wizardStates = new Map<string, QuickstartState>();

export class QuickstartWizard {
  private stateKey: string;
  private interaction: Command.ChatInputCommandInteraction;

  constructor(interaction: Command.ChatInputCommandInteraction) {
    this.interaction = interaction;
    this.stateKey = `${interaction.user.id}:${interaction.guildId}`;
  }

  private getState(): QuickstartState | null {
    return wizardStates.get(this.stateKey) ?? null;
  }

  private setState(state: QuickstartState): void {
    wizardStates.set(this.stateKey, state);
  }

  clearState(): void {
    wizardStates.delete(this.stateKey);
  }

  initialize(): QuickstartState {
    const state: QuickstartState = {
      step: 1,
      config: {
        defaultExpiryDays: 3,
        dmOnWarn: true,
        levels: [],
      },
    };
    this.setState(state);
    return state;
  }

  async renderStep(step: QuickstartStep): Promise<{
    components: any[];
    flags: number;
  }> {
    const t = await fetchT(this.interaction);

    switch (step) {
      case 1:
        return this.renderWelcome(t);
      case 2:
        return this.renderPresetSelection(t);
      case 3:
        return this.renderGeneralOptions(t);
      case 4:
        return this.renderWarnLevelsEditor(t);
      case 5:
        return this.renderEditWarnLevel(t);
      case 6:
        return this.renderReview(t);
      default:
        throw new Error(`Invalid step: ${step}`);
    }
  }

  private renderWelcome(t: any): { components: any[]; flags: number } {
    const container = new ContainerBuilder()
      .setAccentColor(Colors.Info)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.welcomeTitle)}`),
        new TextDisplayBuilder().setContent(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.welcomeDescription)),
      );

    const presetButtonId = nanoid();
    const scratchButtonId = nanoid();

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(presetButtonId)
        .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.startFromPreset))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(scratchButtonId)
        .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.buildFromScratch))
        .setStyle(ButtonStyle.Secondary),
    );

    return {
      components: [container, buttons],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    };
  }

  // ... additional step rendering methods will be added in subsequent tasks
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/moderation/quickstartWizard.ts
git commit -m "feat: add quickstart wizard state machine skeleton"
```

---

### Task 4: Implement Step 1 & 2 (Welcome + Preset Selection)

**Files:**
- Modify: `src/lib/moderation/quickstartWizard.ts`

**Interfaces:**
- Consumes: state from Task 3
- Produces: working Steps 1-2 rendering

- [ ] **Step 1: Add handleComponentInteraction method**

Add to `QuickstartWizard` class in `src/lib/moderation/quickstartWizard.ts`:

```ts
async handleComponentInteraction(interaction: any): Promise<void> {
  const state = this.getState();
  if (!state) return;

  const customId = interaction.customId;

  // Step 1: Welcome screen buttons
  if (state.step === 1) {
    if (customId === "startFromPreset") {
      state.step = 2;
      this.setState(state);
      await this.editAndRender(interaction, 2);
    } else if (customId === "buildFromScratch") {
      state.step = 3;
      this.setState(state);
      await this.editAndRender(interaction, 3);
    }
  }

  // Step 2: Preset selection
  if (state.step === 2) {
    if (customId === "selectPreset") {
      const presetKey = interaction.values[0] as keyof typeof PRESETS;
      state.config.levels = [...PRESETS[presetKey].levels];
      state.step = 3;
      this.setState(state);
      await this.editAndRender(interaction, 3);
    } else if (customId === "continueFromPreset") {
      state.step = 3;
      this.setState(state);
      await this.editAndRender(interaction, 3);
    }
  }
}

private async editAndRender(interaction: any, step: QuickstartStep): Promise<void> {
  const { components, flags } = await this.renderStep(step);
  await interaction.update({ components, flags });
}
```

- [ ] **Step 2: Update renderWelcome to use fixed custom IDs**

Replace the `renderWelcome` method in `src/lib/moderation/quickstartWizard.ts`:

```ts
private renderWelcome(t: any): { components: any[]; flags: number } {
  const container = new ContainerBuilder()
    .setAccentColor(Colors.Info)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.welcomeTitle)}`),
      new TextDisplayBuilder().setContent(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.welcomeDescription)),
    );

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("startFromPreset")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.startFromPreset))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("buildFromScratch")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.buildFromScratch))
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    components: [container, buttons],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}
```

- [ ] **Step 3: Add renderPresetSelection method**

Add to `QuickstartWizard` class:

```ts
private renderPresetSelection(t: any): { components: any[]; flags: number } {
  const container = new ContainerBuilder()
    .setAccentColor(Colors.Info)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetTitle)}`),
      new TextDisplayBuilder().setContent(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetDescription)),
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId("selectPreset")
    .addOptions(
      {
        label: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetLemomeme),
        description: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetLemomemeDesc),
        value: "lemomeme",
      },
      {
        label: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetRecommended),
        description: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetRecommendedDesc),
        value: "recommended",
      },
      {
        label: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetProgressive),
        description: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetProgressiveDesc),
        value: "progressive",
      },
      {
        label: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetStrictStrike),
        description: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetStrictStrikeDesc),
        value: "strictStrike",
      },
    );

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("continueFromPreset")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.continue))
      .setStyle(ButtonStyle.Primary),
  );

  return {
    components: [container, selectRow, buttons],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/moderation/quickstartWizard.ts
git commit -m "feat: implement quickstart steps 1-2"
```

---

### Task 5: Implement Step 3 (General Options)

**Files:**
- Modify: `src/lib/moderation/quickstartWizard.ts`

**Interfaces:**
- Consumes: state from Task 4
- Produces: working Step 3 rendering

- [ ] **Step 1: Add renderGeneralOptions method**

Add to `QuickstartWizard` class:

```ts
private renderGeneralOptions(t: any): { components: any[]; flags: number } {
  const state = this.getState()!;
  const container = new ContainerBuilder()
    .setAccentColor(Colors.Info)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.generalOptionsTitle)}`),
      new TextDisplayBuilder().setContent(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.generalOptionsDescription)),
    );

  const expirySelect = new StringSelectMenuBuilder()
    .setCustomId("selectExpiry")
    .addOptions(
      { label: "3 days", value: "3", default: state.config.defaultExpiryDays === 3 },
      { label: "7 days", value: "7", default: state.config.defaultExpiryDays === 7 },
      { label: "14 days", value: "14", default: state.config.defaultExpiryDays === 14 },
      { label: "30 days", value: "30", default: state.config.defaultExpiryDays === 30 },
      { label: "60 days", value: "60", default: state.config.defaultExpiryDays === 60 },
      { label: "90 days", value: "90", default: state.config.defaultExpiryDays === 90 },
      { label: "180 days", value: "180", default: state.config.defaultExpiryDays === 180 },
      { label: "365 days", value: "365", default: state.config.defaultExpiryDays === 365 },
    );

  const expiryRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(expirySelect);

  const dmToggleId = state.config.dmOnWarn ? "toggleDmOff" : "toggleDmOn";
  const dmButton = new ButtonBuilder()
    .setCustomId(dmToggleId)
    .setLabel(`${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.dmOnWarn)}: ${state.config.dmOnWarn ? "✅" : "❌"}`)
    .setStyle(state.config.dmOnWarn ? ButtonStyle.Success : ButtonStyle.Secondary);

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId("selectLogChannel")
    .setPlaceholder(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.logChannel));

  const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("backToWelcome")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.back))
      .setStyle(ButtonStyle.Secondary),
    dmButton,
    new ButtonBuilder()
      .setCustomId("configureWarnLevels")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.configureWarnLevels))
      .setStyle(ButtonStyle.Primary),
  );

  return {
    components: [container, expiryRow, new ActionRowBuilder<ButtonBuilder>().addComponents(dmButton), channelRow, buttons],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}
```

- [ ] **Step 2: Add Step 3 handlers to handleComponentInteraction**

Add to the `handleComponentInteraction` method:

```ts
// Step 3: General options
if (state.step === 3) {
  if (customId === "selectExpiry") {
    state.config.defaultExpiryDays = parseInt(interaction.values[0], 10);
    this.setState(state);
    await this.editAndRender(interaction, 3);
  } else if (customId === "toggleDmOn" || customId === "toggleDmOff") {
    state.config.dmOnWarn = !state.config.dmOnWarn;
    this.setState(state);
    await this.editAndRender(interaction, 3);
  } else if (customId === "selectLogChannel") {
    state.config.logChannelId = interaction.values[0];
    this.setState(state);
    await this.editAndRender(interaction, 3);
  } else if (customId === "backToWelcome") {
    state.step = 1;
    this.setState(state);
    await this.editAndRender(interaction, 1);
  } else if (customId === "configureWarnLevels") {
    state.step = 4;
    this.setState(state);
    await this.editAndRender(interaction, 4);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/moderation/quickstartWizard.ts
git commit -m "feat: implement quickstart step 3 (general options)"
```

---

### Task 6: Implement Step 4 (Warn Levels Editor)

**Files:**
- Modify: `src/lib/moderation/quickstartWizard.ts`

**Interfaces:**
- Consumes: state from Task 5
- Produces: working Step 4 rendering with pagination

- [ ] **Step 1: Add renderWarnLevelsEditor method**

Add to `QuickstartWizard` class:

```ts
private renderWarnLevelsEditor(t: any): { components: any[]; flags: number } {
  const state = this.getState()!;
  const container = new ContainerBuilder()
    .setAccentColor(Colors.Info)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.warnLevelsTitle)}`),
      new TextDisplayBuilder().setContent(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.warnLevelsDescription)),
    );

  if (state.config.levels.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`*${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.none)}*`),
    );
  } else {
    // Show up to 3 levels per page
    const levelsToShow = state.config.levels.slice(0, 3);
    for (let i = 0; i < levelsToShow.length; i++) {
      const level = levelsToShow[i];
      const summary = this.formatLevelSummary(level, t);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.levelNSummary, { level: i + 1 })}\n${summary}`),
      );
    }
  }

  const separator = new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large);
  container.addSeparatorComponents(separator);

  // Action buttons
  const actionButtons: ButtonBuilder[] = [];

  for (let i = 0; i < Math.min(state.config.levels.length, 3); i++) {
    actionButtons.push(
      new ButtonBuilder()
        .setCustomId(`editLevel_${i}`)
        .setLabel(`${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.edit)} ${i + 1}`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`removeLevel_${i}`)
        .setLabel(`${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.remove)} ${i + 1}`)
        .setStyle(ButtonStyle.Danger),
    );
  }

  const buttons: ActionRowBuilder<ButtonBuilder>[] = [];

  if (actionButtons.length > 0) {
    // Split into rows of 5 buttons max
    for (let i = 0; i < actionButtons.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(actionButtons.slice(i, i + 5));
      buttons.push(row);
    }
  }

  const navButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("addWarnLevel")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.addWarnLevel))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("backToGeneral")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.backToGeneral))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("continueToReview")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.continueToReview))
      .setStyle(ButtonStyle.Primary),
  );

  buttons.push(navButtons);

  return {
    components: [container, ...buttons],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

private formatLevelSummary(level: WarnActionConfig, t: any): string {
  const parts: string[] = [];

  if (level.actionType === "none") {
    parts.push(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.none));
  } else {
    parts.push(`**${level.actionType}**`);

    if (level.duration) {
      const hours = Math.floor(level.duration / 3600000);
      const days = Math.floor(hours / 24);
      parts.push(days > 0 ? `(${days}d)` : `(${hours}h)`);
    }

    if (level.roleId) {
      parts.push(`→ <@&${level.roleId}>`);
    }

    parts.push(level.autoConfirm ? `⚡ ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.auto)}` : `⚠️ ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.manual)}`);
  }

  return parts.join(" ");
}
```

- [ ] **Step 2: Add Step 4 handlers to handleComponentInteraction**

Add to the `handleComponentInteraction` method:

```ts
// Step 4: Warn levels editor
if (state.step === 4) {
  if (customId.startsWith("editLevel_")) {
    const index = parseInt(customId.split("_")[1], 10);
    state.currentLevelIndex = index;
    state.step = 5;
    this.setState(state);
    await this.editAndRender(interaction, 5);
  } else if (customId.startsWith("removeLevel_")) {
    const index = parseInt(customId.split("_")[1], 10);
    state.config.levels.splice(index, 1);
    this.setState(state);
    await this.editAndRender(interaction, 4);
  } else if (customId === "addWarnLevel") {
    state.config.levels.push({
      warnCount: state.config.levels.length + 1,
      actionType: "none",
      autoConfirm: true,
    });
    state.currentLevelIndex = state.config.levels.length - 1;
    state.step = 5;
    this.setState(state);
    await this.editAndRender(interaction, 5);
  } else if (customId === "backToGeneral") {
    state.step = 3;
    this.setState(state);
    await this.editAndRender(interaction, 3);
  } else if (customId === "continueToReview") {
    state.step = 6;
    this.setState(state);
    await this.editAndRender(interaction, 6);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/moderation/quickstartWizard.ts
git commit -m "feat: implement quickstart step 4 (warn levels editor)"
```

---

### Task 7: Implement Step 5 (Edit Warn Level)

**Files:**
- Modify: `src/lib/moderation/quickstartWizard.ts`

**Interfaces:**
- Consumes: state from Task 6
- Produces: working Step 5 rendering (action type select + modal)

- [ ] **Step 1: Add renderEditWarnLevel method**

Add to `QuickstartWizard` class:

```ts
private renderEditWarnLevel(t: any): { components: any[]; flags: number } {
  const state = this.getState()!;
  const levelIndex = state.currentLevelIndex!;
  const level = state.config.levels[levelIndex];
  const isNew = level.actionType === "none";

  const container = new ContainerBuilder()
    .setAccentColor(Colors.Info)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${isNew ? t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.addWarnLevelTitle) : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.editWarnLevelTitle, { level: levelIndex + 1 })}`,
      ),
    );

  const actionSelect = new StringSelectMenuBuilder()
    .setCustomId("selectActionType")
    .addOptions(
      { label: "Mute", value: "mute", default: level.actionType === "mute" },
      { label: "Kick", value: "kick", default: level.actionType === "kick" },
      { label: "Ban", value: "ban", default: level.actionType === "ban" },
      { label: "Role", value: "role", default: level.actionType === "role" },
      { label: "None", value: "none", default: level.actionType === "none" },
    );

  const actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(actionSelect);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("openDetailsModal")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.continue))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("cancelEdit")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.cancel))
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    components: [container, actionRow, buttons],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}
```

- [ ] **Step 2: Add Step 5 handlers to handleComponentInteraction**

Add to the `handleComponentInteraction` method:

```ts
// Step 5: Edit warn level
if (state.step === 5) {
  if (customId === "selectActionType") {
    state.selectedActionType = interaction.values[0];
    const levelIndex = state.currentLevelIndex!;
    state.config.levels[levelIndex].actionType = state.selectedActionType as any;
    this.setState(state);
  } else if (customId === "openDetailsModal") {
    await this.showDetailsModal(interaction);
  } else if (customId === "cancelEdit") {
    state.step = 4;
    state.currentLevelIndex = undefined;
    this.setState(state);
    await this.editAndRender(interaction, 4);
  }
}
```

- [ ] **Step 3: Add showDetailsModal method**

Add to `QuickstartWizard` class:

```ts
private async showDetailsModal(interaction: any): Promise<void> {
  const state = this.getState()!;
  const level = state.config.levels[state.currentLevelIndex!];
  const t = await fetchT(interaction);

  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import("discord.js");

  const modal = new ModalBuilder()
    .setCustomId("editLevelDetails")
    .setTitle(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.editWarnLevelTitle, { level: state.currentLevelIndex! + 1 }));

  const fields: any[] = [];

  if (level.actionType === "mute" || level.actionType === "ban") {
    fields.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("duration")
          .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.duration))
          .setPlaceholder(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.durationPlaceholder))
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
  }

  if (level.actionType === "role") {
    fields.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("role")
          .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.role))
          .setPlaceholder(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.rolePlaceholder))
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
  }

  fields.push(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("autoExecute")
        .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.autoExecute))
        .setValue(level.autoConfirm ? "yes" : "no")
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
  );

  modal.addComponents(...fields);
  await interaction.showModal(modal);

  const modalInteraction = await interaction.awaitModalSubmit({
    time: 600000,
    filter: (i: any) => i.customId === "editLevelDetails" && i.user.id === interaction.user.id,
  }).catch(() => null);

  if (!modalInteraction) {
    state.step = 4;
    this.setState(state);
    return;
  }

  // Validate and save
  const autoExecuteValue = modalInteraction.fields.getTextInputValue("autoExecute").toLowerCase();
  if (autoExecuteValue !== "yes" && autoExecuteValue !== "no") {
    await modalInteraction.reply({
      content: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.invalidAutoExecute),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  level.autoConfirm = autoExecuteValue === "yes";

  if (level.actionType === "mute" || level.actionType === "ban") {
    const durationStr = modalInteraction.fields.getTextInputValue("duration");
    const { modActionService } = await import("./actions.js");
    const duration = modActionService.parseDuration(durationStr);

    if (!duration) {
      await modalInteraction.reply({
        content: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.invalidDuration),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    level.duration = duration;
  }

  if (level.actionType === "role") {
    const roleStr = modalInteraction.fields.getTextInputValue("role");
    const roleId = roleStr.replace(/[<@&>]/g, "");
    level.roleId = roleId;
  }

  state.step = 4;
  state.currentLevelIndex = undefined;
  this.setState(state);

  await modalInteraction.deferUpdate();
  const { components, flags } = await this.renderStep(4);
  await interaction.editReply({ components, flags });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/moderation/quickstartWizard.ts
git commit -m "feat: implement quickstart step 5 (edit warn level)"
```

---

### Task 8: Implement Step 6 (Review & Save)

**Files:**
- Modify: `src/lib/moderation/quickstartWizard.ts`

**Interfaces:**
- Consumes: state from Task 7
- Produces: working Step 6 rendering + DB save

- [ ] **Step 1: Add renderReview method**

Add to `QuickstartWizard` class:

```ts
private renderReview(t: any): { components: any[]; flags: number } {
  const state = this.getState()!;
  const container = new ContainerBuilder()
    .setAccentColor(Colors.Success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.reviewTitle)}`),
      new TextDisplayBuilder().setContent(`### ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.generalSettings)}`),
      new TextDisplayBuilder().setContent(
        [
          `**${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.defaultExpiry)}:** ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.expiryDays, { days: state.config.defaultExpiryDays })}`,
          `**${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.dmOnWarn)}:** ${state.config.dmOnWarn ? "✅" : "❌"}`,
          `**${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.logChannel)}:** ${state.config.logChannelId ? `<#${state.config.logChannelId}>` : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.none)}`,
        ].join("\n"),
      ),
    );

  const separator = new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large);
  container.addSeparatorComponents(separator);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`### ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.warnLevelsSummary, { count: state.config.levels.length })}`),
  );

  for (let i = 0; i < state.config.levels.length; i++) {
    const level = state.config.levels[i];
    const summary = this.formatLevelSummary(level, t);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.levelNSummary, { level: i + 1 })}** — ${summary}`),
    );
  }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("saveConfiguration")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.saveConfiguration))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("editWarnLevels")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.editWarnLevels))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("cancelSetup")
      .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.cancel))
      .setStyle(ButtonStyle.Danger),
  );

  return {
    components: [container, buttons],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}
```

- [ ] **Step 2: Add Step 6 handlers to handleComponentInteraction**

Add to the `handleComponentInteraction` method:

```ts
// Step 6: Review & save
if (state.step === 6) {
  if (customId === "saveConfiguration") {
    await this.saveConfiguration(interaction);
  } else if (customId === "editWarnLevels") {
    state.step = 4;
    this.setState(state);
    await this.editAndRender(interaction, 4);
  } else if (customId === "cancelSetup") {
    this.clearState();
    await this.showCancelledMessage(interaction);
  }
}
```

- [ ] **Step 3: Add saveConfiguration method**

Add to `QuickstartWizard` class:

```ts
private async saveConfiguration(interaction: any): Promise<void> {
  const state = this.getState()!;
  const t = await fetchT(interaction);
  const { db } = await import("../../db/index.js");
  const { warnSettings } = await import("../../db/schema.js");
  const { eq } = await import("drizzle-orm");

  const guildId = interaction.guildId!;

  await db
    .insert(warnSettings)
    .values({
      guildId,
      defaultExpiryDays: state.config.defaultExpiryDays,
      dmOnWarn: state.config.dmOnWarn,
      logChannelId: state.config.logChannelId ?? null,
      actions: JSON.stringify(state.config.levels),
    })
    .onConflictDoUpdate({
      target: warnSettings.guildId,
      set: {
        defaultExpiryDays: state.config.defaultExpiryDays,
        dmOnWarn: state.config.dmOnWarn,
        logChannelId: state.config.logChannelId ?? null,
        actions: JSON.stringify(state.config.levels),
      },
    });

  this.clearState();

  const container = new ContainerBuilder()
    .setAccentColor(Colors.Success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.savedTitle)}`),
      new TextDisplayBuilder().setContent(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.savedDescription)),
    );

  await interaction.update({
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

private async showCancelledMessage(interaction: any): Promise<void> {
  const t = await fetchT(interaction);

  const container = new ContainerBuilder()
    .setAccentColor(Colors.Warning)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.cancelledTitle)}`),
      new TextDisplayBuilder().setContent(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.cancelledDescription)),
    );

  await interaction.update({
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/moderation/quickstartWizard.ts
git commit -m "feat: implement quickstart step 6 (review & save)"
```

---

### Task 9: Wire Quickstart into warnSettings Command

**Files:**
- Modify: `src/commands/mod/warnSettings.ts`

**Interfaces:**
- Consumes: `QuickstartWizard` from Task 8
- Produces: working `/warn quickstart` command

- [ ] **Step 1: Import QuickstartWizard**

Add import at top of `src/commands/mod/warnSettings.ts`:

```ts
import { QuickstartWizard } from "../../lib/moderation/quickstartWizard.js";
```

- [ ] **Step 2: Replace runQuickstart method**

Replace the `runQuickstart` method in `src/commands/mod/warnSettings.ts` (lines 223-281):

```ts
private async runQuickstart(interaction: Command.ChatInputCommandInteraction) {
  const wizard = new QuickstartWizard(interaction);
  const state = wizard.initialize();

  const { components, flags } = await wizard.renderStep(1);
  const reply = await interaction.reply({
    components,
    flags,
  });

  const message = await reply.fetch();

  // Component collector
  const collector = message.createMessageComponentCollector({
    time: 600000, // 10 minutes
    filter: (i) => i.user.id === interaction.user.id,
  });

  collector.on("collect", async (i) => {
    await wizard.handleComponentInteraction(i);
  });

  collector.on("end", async () => {
    const currentState = wizard["getState"]();
    if (currentState) {
      wizard.clearState();
      const t = await fetchT(interaction);
      const container = new (await import("discord.js")).ContainerBuilder()
        .setAccentColor(Colors.Warning)
        .addTextDisplayComponents(
          new (await import("discord.js")).TextDisplayBuilder().setContent(`# ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.timeoutTitle)}`),
          new (await import("discord.js")).TextDisplayBuilder().setContent(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.timeoutDescription)),
        );

      await message.edit({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/mod/warnSettings.ts
git commit -m "feat: wire quickstart wizard into command"
```

---

### Task 10: Test the Quickstart Flow

**Files:**
- None (manual testing)

- [ ] **Step 1: Test preset path**

Run: `/warn quickstart` → click "Start from preset" → select "Recommended" → click "Continue" → adjust general options → click "Configure warn levels" → edit a level → click "Continue to review" → click "Save configuration"

Expected: Configuration saved successfully, success message shown

- [ ] **Step 2: Test from-scratch path**

Run: `/warn quickstart` → click "Build from scratch" → adjust general options → click "Configure warn levels" → click "Add warn level" → select action type → fill modal → save → repeat for multiple levels → click "Continue to review" → save

Expected: All levels configured correctly, saved to DB

- [ ] **Step 3: Test navigation**

Test back/forward navigation between all steps. Test cancel at each step. Test timeout (wait 10 minutes).

Expected: Navigation works correctly, cancel clears state, timeout shows message

- [ ] **Step 4: Test validation**

Try entering invalid duration format (e.g., "abc") in modal. Try entering invalid auto-execute value.

Expected: Validation errors shown, modal doesn't save

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "test: verify quickstart wizard functionality"
```

---

## Summary

This plan implements a modernized 6-step quickstart wizard with:
- Preset and from-scratch entry paths
- Dynamic warn levels (no hard limit)
- Components v2 UI throughout
- In-memory state management
- Full i18n support
- Proper validation and error handling

Total estimated time: 4-6 hours for an experienced developer.
