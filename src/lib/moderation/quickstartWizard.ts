import { container } from "@sapphire/framework";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { nanoid } from "nanoid";
import { Colors } from "../colors.js";
import { fetchT } from "../i18n/utils.js";
import { LanguageKeys } from "../i18n/languageKeys.js";
import type { WarnActionConfig } from "./types.js";

export type QuickstartConfig = {
  defaultExpiryDays: number;
  dmOnWarn: boolean;
  logChannelId?: string;
  levels: WarnActionConfig[];
};

export type QuickstartState = {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  config: QuickstartConfig;
  currentLevelIndex?: number;
  selectedActionType?: string;
  messageId?: string;
};

const wizardStates = new Map<string, QuickstartState>();

export class QuickstartWizard {
  private stateKey: string;

  constructor(private interaction: ChatInputCommandInteraction) {
    this.stateKey = `${interaction.user.id}:${interaction.guildId}`;
  }

  initialize(preset?: string): QuickstartState {
    const config: QuickstartConfig = {
      defaultExpiryDays: 3,
      dmOnWarn: true,
      levels: [],
    };

    if (preset) {
      const { PRESETS } = require("./presets.js");
      if (PRESETS[preset]) {
        config.levels = [...PRESETS[preset].levels];
      }
    }

    const state: QuickstartState = {
      step: 1,
      config,
    };

    wizardStates.set(this.stateKey, state);
    return state;
  }

  getState(): QuickstartState | null {
    return wizardStates.get(this.stateKey) ?? null;
  }

  updateState(updates: Partial<QuickstartState>): void {
    const state = this.getState();
    if (state) {
      wizardStates.set(this.stateKey, { ...state, ...updates });
    }
  }

  clearState(): void {
    wizardStates.delete(this.stateKey);
  }

  async handleComponentInteraction(interaction: MessageComponentInteraction): Promise<void> {
    const state = this.getState();
    if (!state) return;

    const customId = interaction.customId;

    // Step 1: Welcome screen
    if (state.step === 1) {
      if (customId === "startFromPreset") {
        state.step = 2;
        this.updateState(state);
        await this.editAndRender(interaction, 2);
      } else if (customId === "buildFromScratch") {
        state.step = 3;
        this.updateState(state);
        await this.editAndRender(interaction, 3);
      }
    }

    // Step 2: Preset selection
    if (state.step === 2) {
      if (customId === "selectPreset") {
        const presetKey = interaction.values[0];
        const { PRESETS } = require("./presets.js");
        if (PRESETS[presetKey]) {
          state.config.levels = [...PRESETS[presetKey].levels];
          state.step = 3;
          this.updateState(state);
          await this.editAndRender(interaction, 3);
        }
      }
    }

    // Step 3: General options
    if (state.step === 3) {
      if (customId === "selectExpiry") {
        state.config.defaultExpiryDays = parseInt(interaction.values[0], 10);
        this.updateState(state);
        await this.editAndRender(interaction, 3);
      } else if (customId === "toggleDmOn" || customId === "toggleDmOff") {
        state.config.dmOnWarn = !state.config.dmOnWarn;
        this.updateState(state);
        await this.editAndRender(interaction, 3);
      } else if (customId === "selectLogChannel") {
        state.config.logChannelId = interaction.values[0];
        this.updateState(state);
        await this.editAndRender(interaction, 3);
      } else if (customId === "backToWelcome") {
        state.step = 1;
        this.updateState(state);
        await this.editAndRender(interaction, 1);
      } else if (customId === "configureWarnLevels") {
        state.step = 4;
        this.updateState(state);
        await this.editAndRender(interaction, 4);
      }
    }

    // Step 4: Warn levels editor
    if (state.step === 4) {
      if (customId.startsWith("editLevel_")) {
        const index = parseInt(customId.split("_")[1], 10);
        state.currentLevelIndex = index;
        state.step = 5;
        this.updateState(state);
        await this.editAndRender(interaction, 5);
      } else if (customId.startsWith("removeLevel_")) {
        const index = parseInt(customId.split("_")[1], 10);
        state.config.levels.splice(index, 1);
        // Update warnCount for remaining levels
        state.config.levels.forEach((level, i) => {
          level.warnCount = i + 1;
        });
        this.updateState(state);
        await this.editAndRender(interaction, 4);
      } else if (customId === "addWarnLevel") {
        state.config.levels.push({
          warnCount: state.config.levels.length + 1,
          actionType: "none",
          autoConfirm: true,
        });
        state.currentLevelIndex = state.config.levels.length - 1;
        state.step = 5;
        this.updateState(state);
        await this.editAndRender(interaction, 5);
      } else if (customId === "backToGeneral") {
        state.step = 3;
        this.updateState(state);
        await this.editAndRender(interaction, 3);
      } else if (customId === "continueToReview") {
        state.step = 6;
        this.updateState(state);
        await this.editAndRender(interaction, 6);
      }
    }

    // Step 5: Edit warn level
    if (state.step === 5) {
      if (customId === "selectActionType") {
        state.selectedActionType = interaction.values[0];
        if (state.currentLevelIndex !== undefined) {
          state.config.levels[state.currentLevelIndex].actionType = state.selectedActionType as any;
        }
        this.updateState(state);
      } else if (customId === "openDetailsModal") {
        await this.showDetailsModal(interaction);
      } else if (customId === "cancelEdit") {
        state.step = 4;
        state.currentLevelIndex = undefined;
        this.updateState(state);
        await this.editAndRender(interaction, 4);
      }
    }

    // Step 6: Review & save
    if (state.step === 6) {
      if (customId === "saveConfiguration") {
        await this.saveConfiguration(interaction);
      } else if (customId === "editWarnLevels") {
        state.step = 4;
        this.updateState(state);
        await this.editAndRender(interaction, 4);
      } else if (customId === "cancelSetup") {
        this.clearState();
        await this.showCancelledMessage(interaction);
      }
    }
  }

  private async editAndRender(interaction: MessageComponentInteraction, step: number): Promise<void> {
    const { components, flags } = await this.renderStep(step);
    await interaction.editReply({
      components,
      flags,
    });
  }

  async renderStep(step: number): Promise<{ components: any[]; flags: number }> {
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

    return {
      components: [container, selectRow],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    };
  }

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

  private async showDetailsModal(interaction: MessageComponentInteraction): Promise<void> {
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
      filter: (i) => i.customId === "editLevelDetails" && i.user.id === interaction.user.id,
    }).catch(() => null);

    if (!modalInteraction) {
      state.step = 4;
      this.updateState(state);
      return;
    }

    await this.handleModalSubmit(modalInteraction);
  }

  private async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const state = this.getState()!;
    const t = await fetchT(interaction);

    const autoExecuteValue = interaction.fields.getTextInputValue("autoExecute").toLowerCase();
    if (autoExecuteValue !== "yes" && autoExecuteValue !== "no" && autoExecuteValue !== "si" && autoExecuteValue !== "sí") {
      await interaction.reply({
        content: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.invalidAutoExecute),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const level = state.config.levels[state.currentLevelIndex!];
    level.autoConfirm = autoExecuteValue === "yes" || autoExecuteValue === "si" || autoExecuteValue === "sí";

    if (level.actionType === "mute" || level.actionType === "ban") {
      const durationStr = interaction.fields.getTextInputValue("duration");
      const { modActionService } = await import("./actions.js");
      const duration = modActionService.parseDuration(durationStr);

      if (!duration) {
        await interaction.reply({
          content: t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.invalidDuration),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      level.duration = duration;
    }

    if (level.actionType === "role") {
      const roleStr = interaction.fields.getTextInputValue("role");
      const roleId = roleStr.replace(/[<@&>]/g, "");
      level.roleId = roleId;
    }

    state.step = 4;
    state.currentLevelIndex = undefined;
    this.updateState(state);

    await interaction.deferUpdate();
    const { components, flags } = await this.renderStep(4);
    await interaction.editReply({ components, flags });
  }

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

  private async saveConfiguration(interaction: MessageComponentInteraction): Promise<void> {
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

  private async showCancelledMessage(interaction: MessageComponentInteraction): Promise<void> {
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
}
