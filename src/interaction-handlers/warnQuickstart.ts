import {
  container,
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import type { TFunction } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js";
import { db } from "../db/index.js";
import { warnSettings } from "../db/schema.js";
import { Colors } from "../lib/colors.js";
import { Emojis } from "../lib/emojis.js";
import { convertToDiscordTimestamp } from "../lib/helpers/timestamp.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { normalizeActions } from "../lib/moderation/migration.js";
import { PRESETS } from "../lib/moderation/presets.js";
import {
  BackupTtlMs,
  WarnSettingsBackupRepository,
} from "../lib/moderation/settingsBackup.js";
import {
  WarnWorkflowRepository,
  createQuickstartCustomId,
  createQuickstartModalCustomId,
  isQuickstartActionAllowed,
  parseQuickstartCustomId,
  type QuickstartCustomId,
} from "../lib/moderation/workflowRepository.js";
import type {
  WarnWorkflowState,
  WarnPunishment,
  WarnPunishmentType,
  WarnLevel,
} from "../lib/moderation/types.js";

const MAX_PUNISHMENTS_PER_LEVEL = 4;

function formatDurationShort(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days}d` : `${hours}h`;
}

function presetOptions(t: TFunction) {
  const base = LanguageKeys.Commands.Moderation.WarnSettings;
  return [
    {
      label: t(base.presetLemomeme),
      description: t(base.Quickstart.presetLemomemeDesc),
      value: "lemomeme",
    },
    {
      label: t(base.presetRecommended),
      description: t(base.Quickstart.presetRecommendedDesc),
      value: "recommended",
    },
    {
      label: t(base.presetProgressive),
      description: t(base.Quickstart.presetProgressiveDesc),
      value: "progressive",
    },
    {
      label: t(base.presetStrictStrike),
      description: t(base.Quickstart.presetStrictStrikeDesc),
      value: "strictStrike",
    },
  ];
}

function punishmentLabel(
  p: WarnPunishment,
  t: TFunction,
  guild?: Guild | null,
): string {
  const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
  switch (p.type) {
    case "mute":
      return `${t(key.punishmentMute)} (${formatDurationShort(p.duration ?? 3600000)})`;
    case "kick":
      return String(t(key.punishmentKick));
    case "ban":
      return p.duration
        ? `${t(key.punishmentBan)} (${formatDurationShort(p.duration)})`
        : String(t(key.punishmentBanPerm));
    case "role": {
      if (!p.roleId) return String(t(key.punishmentRole));
      // Select menu and button labels show mentions as raw text, so
      // resolve the role name whenever a guild is on hand.
      const display = guild
        ? `@${guild.roles.cache.get(p.roleId)?.name ?? p.roleId}`
        : `<@&${p.roleId}>`;
      return `${t(key.punishmentRole)} → ${display}`;
    }
  }
}

function formatLevelSummary(
  level: WarnLevel,
  t: TFunction,
  guild?: Guild | null,
): string {
  const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
  if (level.punishments.length === 0) {
    return String(t(key.none));
  }
  const parts = level.punishments.map((p) => punishmentLabel(p, t, guild));
  parts.push(
    level.autoConfirm
      ? `⚡ ${t(key.auto)}`
      : `⚠️ ${t(key.manual)}`,
  );
  return parts.join(", ");
}

export const warnWorkflowRepository = new WarnWorkflowRepository(
  container.redis,
);

export const warnSettingsBackupRepository = new WarnSettingsBackupRepository(
  container.redis,
);

export function createWarnQuickstartState(input: {
  id: string;
  ownerId: string;
  guildId: string;
  messageId: string;
}): WarnWorkflowState {
  return {
    ...input,
    revision: 1,
    status: "active",
    expiresAt: Date.now() + 604_800_000,
    step: 1,
    config: { defaultExpiryDays: 3, dmOnWarn: true, levels: [] },
  };
}

export class WarnQuickstartHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.MessageComponent,
    });
  }

  public override parse(interaction: Interaction) {
    if (!interaction.isMessageComponent()) return this.none();
    const parsed = parseQuickstartCustomId(interaction.customId);
    return parsed ? this.some(parsed) : this.none();
  }

  public override async run(
    interaction: Interaction,
    parsed: QuickstartCustomId,
  ): Promise<void> {
    if (!interaction.isMessageComponent()) return;
    const guildId = interaction.guildId;
    if (!guildId) return;
    const state = await warnWorkflowRepository.loadForInteraction({
      sessionId: parsed.sessionId,
      guildId,
      ownerId: interaction.user.id,
      messageId: interaction.message.id,
      revision: parsed.revision,
    });
    if (!state) return this.replyUnavailable(interaction);
    if (!isQuickstartActionAllowed(state.step, parsed.action))
      return this.replyUnavailable(interaction);

    if (parsed.action === "edit-punishment") {
      await this.handleEditPunishmentModal(interaction, state, parsed);
      return;
    }
    if (parsed.action === "edit-message") {
      await this.handleEditMessageModal(interaction, state);
      return;
    }
    if (parsed.action === "confirm-reset") {
      await this.handleResetConfirmModal(interaction, state);
      return;
    }
    if (parsed.action === "restore-backup") {
      await this.handleRestoreBackup(interaction, state);
      return;
    }
    if (
      parsed.action === "start-add-punishment" ||
      parsed.action === "choose-add-punishment-type" ||
      parsed.action === "confirm-add-punishment" ||
      parsed.action === "cancel-add-punishment"
    ) {
      await this.handleAddPunishmentFlow(interaction, state, parsed);
      return;
    }

    const next = this.reduce(state, interaction, parsed);
    if (next === null) {
      await this.replyUnavailable(interaction);
      return;
    }
    const stored = await warnWorkflowRepository.advance(next);
    if (!stored) return this.replyUnavailable(interaction);
    if (parsed.action === "save") await this.saveSettings(stored);
    const t = await fetchT(interaction);
    await interaction.update({ components: renderWarnQuickstart(stored, t, interaction.guild) });
  }

  private async handleEditPunishmentModal(
    interaction: MessageComponentInteraction,
    state: WarnWorkflowState,
    parsed: QuickstartCustomId,
  ): Promise<void> {
    const idx = state.editingLevelIndex;
    const pIdx = parsed.entityId !== undefined ? Number(parsed.entityId) : -1;
    if (idx === undefined || idx >= state.config.levels.length) return;
    if (!Number.isFinite(pIdx) || pIdx < 0) return;
    const level = state.config.levels[idx];
    const punishment = level.punishments[pIdx];
    if (!punishment) return;
    const t = await fetchT(interaction);
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;

    // Role punishments are edited with a role select menu on the message,
    // not a modal — role IDs are hard to type and pings don't work in modals.
    if (interaction.isRoleSelectMenu()) {
      if (punishment.type !== "role") return this.replyUnavailable(interaction);
      const roleId = interaction.values[0];
      if (!roleId) return this.replyUnavailable(interaction);
      const newPunishments = [...level.punishments];
      newPunishments[pIdx] = { type: "role", roleId };
      const newLevels = [...state.config.levels];
      newLevels[idx] = { ...level, punishments: newPunishments };
      const next = { ...state, config: { ...state.config, levels: newLevels } };
      const stored = await warnWorkflowRepository.advance(next);
      if (!stored) return this.replyUnavailable(interaction);
      await interaction.update({ components: renderWarnQuickstart(stored, t, interaction.guild) });
      return;
    }

    // Submission is handled by the persistent warnQuickstartModal handler;
    // the session, revision, and punishment index travel in the custom ID.
    const modalId = createQuickstartModalCustomId(
      state.id,
      state.revision,
      "edit-punishment",
      String(pIdx),
    );

    if (punishment.type === "kick" || punishment.type === "role") {
      await interaction.deferUpdate();
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(String(t(key.editPunishment)));

    if (punishment.type === "mute") {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("duration")
            .setLabel(String(t(key.duration)))
            .setPlaceholder(String(t(key.durationPlaceholder)))
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(formatDurationShort(punishment.duration ?? 3600000)),
        ),
      );
    } else {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("duration")
            .setLabel(String(t(key.durationOptional)))
            .setPlaceholder("7d")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(punishment.duration ? formatDurationShort(punishment.duration) : ""),
        ),
      );
    }

    await interaction.showModal(modal);
  }

  private async handleEditMessageModal(
    interaction: MessageComponentInteraction,
    state: WarnWorkflowState,
  ): Promise<void> {
    const idx = state.editingLevelIndex;
    if (idx === undefined || idx >= state.config.levels.length) return;
    const level = state.config.levels[idx];
    const t = await fetchT(interaction);
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
    // Submission is handled by the persistent warnQuickstartModal handler.
    // No revision bump here — the message keeps its controls usable while
    // the modal is open.
    const modalId = createQuickstartModalCustomId(
      state.id,
      state.revision,
      "edit-details",
    );

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(String(t(key.levelMessage)))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("message")
            .setLabel(String(t(key.levelMessage)))
            .setPlaceholder(String(t(key.levelMessagePlaceholder)))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000)
            .setValue(level.message ?? ""),
        ),
      );

    await interaction.showModal(modal);
  }

  private async handleResetConfirmModal(
    interaction: MessageComponentInteraction,
    state: WarnWorkflowState,
  ): Promise<void> {
    if (state.step !== 7 || state.resetStage !== "confirm")
      return this.replyUnavailable(interaction);
    // Resetting is destructive — never trust the custom ID alone, make sure
    // the clicker still holds Manage Server right now.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return this.replyUnavailable(interaction);
    const t = await fetchT(interaction);
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
    // Submission lands in the persistent warnQuickstartModal handler. No
    // revision bump — the message keeps its controls while the modal is open.
    const modal = new ModalBuilder()
      .setCustomId(
        createQuickstartModalCustomId(state.id, state.revision, "reset-settings"),
      )
      .setTitle(String(t(key.resetModalTitle)))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("confirm")
            .setLabel(String(t(key.resetModalLabel)).slice(0, 45))
            .setPlaceholder("RESET")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(16),
        ),
      );
    await interaction.showModal(modal);
  }

  private async handleRestoreBackup(
    interaction: MessageComponentInteraction,
    state: WarnWorkflowState,
  ): Promise<void> {
    const fromResetScreen = state.step === 7 && state.resetStage === "done";
    if (!fromResetScreen && state.step !== 1)
      return this.replyUnavailable(interaction);
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return this.replyUnavailable(interaction);
    const t = await fetchT(interaction);
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;

    const backup = await warnSettingsBackupRepository.get(state.guildId);
    if (!backup) {
      // The 24-hour window is over — this is a confirmation-style control,
      // so expiry gets a visible error.
      await interaction.reply({
        components: [
          new ContainerBuilder()
            .setAccentColor(Colors.Error)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                String(t(key.restoreExpired)),
              ),
            ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    await db
      .insert(warnSettings)
      .values({ guildId: state.guildId, ...backup.settings })
      .onConflictDoUpdate({
        target: warnSettings.guildId,
        set: { ...backup.settings },
      });
    // Restoring is one-shot; drop the snapshot so it can't be replayed.
    await warnSettingsBackupRepository.delete(state.guildId);

    const next: WarnWorkflowState = {
      ...state,
      step: 7,
      resetStage: "restored",
      hadExistingSettings: true,
      backupAvailable: false,
      restoreExpiresAt: undefined,
      config: {
        defaultExpiryDays: backup.settings.defaultExpiryDays,
        dmOnWarn: backup.settings.dmOnWarn,
        logChannelId: backup.settings.logChannelId,
        levels: normalizeActions(backup.settings.actions),
      },
    };
    const stored = await warnWorkflowRepository.advance(next);
    if (!stored) return this.replyUnavailable(interaction);
    await interaction.update({
      components: renderWarnQuickstart(stored, t, interaction.guild),
    });
  }

  private async handleAddPunishmentFlow(
    interaction: MessageComponentInteraction,
    state: WarnWorkflowState,
    parsed: QuickstartCustomId,
  ): Promise<void> {
    const t = await fetchT(interaction);
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
    const idx = state.editingLevelIndex;
    if (idx === undefined || idx >= state.config.levels.length) return;
    const level = state.config.levels[idx];

    if (parsed.action === "start-add-punishment") {
      if (level.punishments.length >= MAX_PUNISHMENTS_PER_LEVEL) {
        await interaction.reply({ content: String(t(key.maxPunishments)), flags: MessageFlags.Ephemeral });
        return;
      }
      const next = { ...state, addPunishmentStep: "type" as const };
      const stored = await warnWorkflowRepository.advance(next);
      if (!stored) return this.replyUnavailable(interaction);
      await interaction.update({ components: renderWarnQuickstart(stored, t, interaction.guild) });
      return;
    }

    if (parsed.action === "cancel-add-punishment") {
      const next = { ...state, addPunishmentStep: undefined, addPunishmentType: undefined, addPunishmentDraft: undefined };
      const stored = await warnWorkflowRepository.advance(next);
      if (!stored) return this.replyUnavailable(interaction);
      await interaction.update({ components: renderWarnQuickstart(stored, t, interaction.guild) });
      return;
    }

    if (parsed.action === "choose-add-punishment-type" && interaction.isStringSelectMenu()) {
      const type = interaction.values[0] as WarnPunishmentType;
      if (level.punishments.length >= MAX_PUNISHMENTS_PER_LEVEL) {
        await interaction.reply({ content: String(t(key.maxPunishments)), flags: MessageFlags.Ephemeral });
        return;
      }
      const hasExclusive = level.punishments.some(
        (p) => p.type === type && (p.type === "mute" || p.type === "kick" || p.type === "ban"),
      );
      if (hasExclusive) {
        const typeLabels: Record<WarnPunishmentType, string> = {
          mute: String(t(key.actionMute)),
          kick: String(t(key.actionKick)),
          ban: String(t(key.actionBan)),
          role: String(t(key.actionRole)),
        };
        await interaction.reply({ content: String(t(key.alreadyHasPunishment, { type: typeLabels[type] })), flags: MessageFlags.Ephemeral });
        return;
      }

      if (type === "kick") {
        const newPunishment: WarnPunishment = { type: "kick" };
        const newLevels = [...state.config.levels];
        newLevels[idx] = { ...level, punishments: [...level.punishments, newPunishment] };
        const next = {
          ...state,
          addPunishmentStep: undefined,
          addPunishmentType: undefined,
          addPunishmentDraft: undefined,
          config: { ...state.config, levels: newLevels },
        };
        const stored = await warnWorkflowRepository.advance(next);
        if (!stored) return this.replyUnavailable(interaction);
        await interaction.update({ components: renderWarnQuickstart(stored, t, interaction.guild) });
        return;
      }

      if (type === "role") {
        // Roles are picked with a role select menu on the message — pings
        // don't work in modals and role IDs are easy to get wrong.
        const next = { ...state, addPunishmentStep: "role" as const, addPunishmentType: type };
        const stored = await warnWorkflowRepository.advance(next);
        if (!stored) return this.replyUnavailable(interaction);
        await interaction.update({ components: renderWarnQuickstart(stored, t, interaction.guild) });
        return;
      }

      // Mute/ban details come from a modal. Don't advance the revision here:
      // the message components keep their current revision while the modal
      // is open, so the chosen type travels in the modal custom ID instead.
      const modalId = createQuickstartModalCustomId(
        state.id,
        state.revision,
        "add-punishment",
        type,
      );
      const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(String(t(key.addPunishmentButton)));

      if (type === "mute") {
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("duration")
              .setLabel(String(t(key.duration)))
              .setPlaceholder(String(t(key.durationPlaceholder)))
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue("1h"),
          ),
        );
      } else {
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("duration")
              .setLabel(String(t(key.durationOptional)))
              .setPlaceholder("7d")
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
        );
      }

      await interaction.showModal(modal);
      return;
    }

    if (parsed.action === "confirm-add-punishment" && interaction.isRoleSelectMenu()) {
      if (state.addPunishmentStep !== "role") return this.replyUnavailable(interaction);
      if (level.punishments.length >= MAX_PUNISHMENTS_PER_LEVEL) {
        await interaction.reply({ content: String(t(key.maxPunishments)), flags: MessageFlags.Ephemeral });
        return;
      }
      const roleId = interaction.values[0];
      if (!roleId) return this.replyUnavailable(interaction);
      const newPunishment: WarnPunishment = { type: "role", roleId };
      const newLevels = [...state.config.levels];
      newLevels[idx] = { ...level, punishments: [...level.punishments, newPunishment] };
      const next = {
        ...state,
        addPunishmentStep: undefined,
        addPunishmentType: undefined,
        addPunishmentDraft: undefined,
        config: { ...state.config, levels: newLevels },
      };
      const stored = await warnWorkflowRepository.advance(next);
      if (!stored) return this.replyUnavailable(interaction);
      await interaction.update({ components: renderWarnQuickstart(stored, t, interaction.guild) });
      return;
    }
  }

  private reduce(
    state: WarnWorkflowState,
    interaction: MessageComponentInteraction,
    parsed: QuickstartCustomId,
  ): WarnWorkflowState | null {
    if (parsed.action === "preset") return { ...state, step: 2 };
    if (parsed.action === "scratch") return { ...state, step: 3 };
    if (parsed.action === "select-preset" && interaction.isStringSelectMenu()) {
      const preset = Object.entries(PRESETS).find(
        ([name]) => name === interaction.values[0],
      )?.[1];
      if (!preset) return null;
      return {
        ...state,
        step: 3,
        config: {
          ...state.config,
          defaultExpiryDays: preset.defaultExpiryDays,
          levels: preset.levels,
        },
      };
    }
    if (parsed.action === "select-general-setting" && interaction.isStringSelectMenu()) {
      const setting = interaction.values[0];
      if (setting === "expiry" || setting === "dm" || setting === "logChannel") {
        return { ...state, editingGeneralSetting: setting };
      }
      return null;
    }
    if (parsed.action === "set-expiry" && interaction.isStringSelectMenu()) {
      const days = Number(interaction.values[0]);
      if (!Number.isInteger(days) || days < 0 || days > 365) return null;
      return {
        ...state,
        editingGeneralSetting: undefined,
        config: { ...state.config, defaultExpiryDays: days },
      };
    }
    if (parsed.action === "toggle-dm-from-menu") {
      return {
        ...state,
        editingGeneralSetting: undefined,
        config: { ...state.config, dmOnWarn: !state.config.dmOnWarn },
      };
    }
    if (parsed.action === "expiry" && interaction.isStringSelectMenu()) {
      const days = Number(interaction.values[0]);
      if (!Number.isInteger(days) || days < 0 || days > 365) return null;
      return { ...state, config: { ...state.config, defaultExpiryDays: days } };
    }
    if (parsed.action === "toggle-dm")
      return {
        ...state,
        config: { ...state.config, dmOnWarn: !state.config.dmOnWarn },
      };
    if (parsed.action === "reset") {
      // Only offered while editing a server that actually has saved settings.
      if (state.step !== 3 || !state.hadExistingSettings) return null;
      if (
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      )
        return null;
      return { ...state, step: 7, resetStage: "confirm", editingGeneralSetting: undefined };
    }
    if (parsed.action === "cancel-reset") {
      if (state.step !== 7 || state.resetStage !== "confirm") return null;
      return { ...state, step: 3, resetStage: undefined };
    }
    if (parsed.action === "start-over") {
      // Only reachable from the post-reset screen — drops back into the
      // fresh setup wizard with a clean draft config.
      if (state.step !== 7 || state.resetStage !== "done") return null;
      if (
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      )
        return null;
      return {
        ...state,
        step: 1,
        resetStage: undefined,
        hadExistingSettings: false,
        editingGeneralSetting: undefined,
        config: { defaultExpiryDays: 3, dmOnWarn: true, levels: [] },
      };
    }
    if (parsed.action === "levels") return { ...state, step: 4 };
    if (parsed.action === "back") {
      if (state.step === 7) {
        // Back only exists on the restored screen; it returns to editing.
        if (state.resetStage !== "restored") return null;
        return { ...state, step: 3, resetStage: undefined };
      }
      if (state.step === 5) {
        if (state.addPunishmentStep) {
          return {
            ...state,
            addPunishmentStep: undefined,
            addPunishmentType: undefined,
            addPunishmentDraft: undefined,
          };
        }
        if (state.selectedPunishmentIndex !== undefined) {
          return { ...state, selectedPunishmentIndex: undefined };
        }
        if (
          state.editingLevelSetting === "message" ||
          state.editingLevelSetting === "autoConfirm"
        ) {
          return { ...state, editingLevelSetting: "menu" };
        }
        if (state.editingLevelSetting === "menu") {
          return { ...state, editingLevelSetting: undefined };
        }
        return {
          ...state,
          step: 4,
          editingLevelIndex: undefined,
          editingLevelSetting: undefined,
          selectedPunishmentIndex: undefined,
          addPunishmentStep: undefined,
          addPunishmentType: undefined,
          addPunishmentDraft: undefined,
        };
      }
      if (state.step === 3 && state.editingGeneralSetting) {
        return { ...state, editingGeneralSetting: undefined };
      }
      if (state.step === 6) {
        // Review is reached from the levels list, so back returns there —
        // step 5 needs an editing level and there is none at this point.
        return { ...state, step: 4 };
      }
      return { ...state, step: Math.max(1, state.step - 1) };
    }
    if (parsed.action === "review") return { ...state, step: 6 };
    if (parsed.action === "cancel") return { ...state, status: "cancelled" };
    if (parsed.action === "save") {
      return { ...state, status: "completed" };
    }
    if (parsed.action === "select-level" && interaction.isStringSelectMenu()) {
      const idx = Number(interaction.values[0]);
      if (!Number.isFinite(idx) || idx < 0 || idx >= state.config.levels.length)
        return null;
      return { ...state, step: 5, editingLevelIndex: idx };
    }
    if (parsed.action === "add-level") {
      const newLevels = [
        ...state.config.levels,
        {
          warnCount: state.config.levels.length + 1,
          punishments: [],
          autoConfirm: true,
        },
      ];
      return {
        ...state,
        step: 5,
        editingLevelIndex: newLevels.length - 1,
        config: { ...state.config, levels: newLevels },
      };
    }
    if (parsed.action === "select-punishment" && interaction.isStringSelectMenu()) {
      const pIdx = Number(interaction.values[0]);
      const idx = state.editingLevelIndex;
      if (idx === undefined || idx >= state.config.levels.length) return null;
      if (!Number.isFinite(pIdx) || pIdx < 0 || pIdx >= state.config.levels[idx].punishments.length) return null;
      return { ...state, selectedPunishmentIndex: pIdx };
    }
    if (parsed.action === "edit-details") {
      const idx = state.editingLevelIndex;
      if (idx === undefined || idx >= state.config.levels.length) return null;
      return { ...state, editingLevelSetting: "menu" };
    }
    if (parsed.action === "select-level-setting" && interaction.isStringSelectMenu()) {
      const setting = interaction.values[0];
      if (setting === "message" || setting === "autoConfirm") {
        return { ...state, editingLevelSetting: setting };
      }
      return null;
    }
    if (parsed.action === "toggle-auto-from-menu") {
      const idx = state.editingLevelIndex;
      if (idx === undefined || idx >= state.config.levels.length) return null;
      const level = state.config.levels[idx];
      const newLevels = [...state.config.levels];
      newLevels[idx] = { ...level, autoConfirm: !level.autoConfirm };
      return {
        ...state,
        editingLevelSetting: "menu",
        config: { ...state.config, levels: newLevels },
      };
    }
    if (parsed.action === "clear-message") {
      const idx = state.editingLevelIndex;
      if (idx === undefined || idx >= state.config.levels.length) return null;
      const level = state.config.levels[idx];
      const newLevels = [...state.config.levels];
      newLevels[idx] = { ...level, message: undefined };
      return {
        ...state,
        editingLevelSetting: "menu",
        config: { ...state.config, levels: newLevels },
      };
    }
    if (parsed.action === "remove-punishment") {
      const idx = state.editingLevelIndex;
      const pIdx = parsed.entityId !== undefined ? Number(parsed.entityId) : -1;
      if (idx === undefined || idx >= state.config.levels.length) return null;
      if (!Number.isFinite(pIdx) || pIdx < 0) return null;
      const level = state.config.levels[idx];
      if (pIdx >= level.punishments.length) return null;
      const newPunishments = level.punishments.filter((_, i) => i !== pIdx);
      const newLevels = [...state.config.levels];
      newLevels[idx] = { ...level, punishments: newPunishments };
      return {
        ...state,
        selectedPunishmentIndex: undefined,
        config: { ...state.config, levels: newLevels },
      };
    }
    if (parsed.action === "remove-level") {
      const idx = state.editingLevelIndex;
      if (idx === undefined || idx >= state.config.levels.length) return null;
      const newLevels = state.config.levels
        .filter((_, i) => i !== idx)
        .map((l, i) => ({ ...l, warnCount: i + 1 }));
      return {
        ...state,
        step: 4,
        editingLevelIndex: undefined,
        selectedPunishmentIndex: undefined,
        config: { ...state.config, levels: newLevels },
      };
    }
    return null;
  }

  private async saveSettings(state: WarnWorkflowState): Promise<void> {
    await db
      .insert(warnSettings)
      .values({
        guildId: state.guildId,
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
  }

  private async replyUnavailable(
    interaction: MessageComponentInteraction,
  ): Promise<void> {
    const t = await fetchT(interaction);
    await interaction.reply({
      components: [
        new ContainerBuilder()
          .setAccentColor(Colors.Warning)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.interactionExpired),
            ),
          ),
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }
}

export function renderWarnQuickstart(
  state: WarnWorkflowState,
  t: Awaited<ReturnType<typeof fetchT>>,
  guild: Guild | null = null,
) {
  const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
  const container = new ContainerBuilder().setAccentColor(Colors.Info);
  const button = (
    action: QuickstartCustomId["action"],
    label: string,
    style: ButtonStyle,
  ) =>
    new ButtonBuilder()
      .setCustomId(createQuickstartCustomId(state.id, state.revision, action))
      .setLabel(label)
      .setStyle(style)
      .setDisabled(state.status !== "active");

  if (state.status === "completed") {
    return [
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(key.savedTitle)}
${t(key.savedDescription)}`,
        ),
      ),
    ];
  }
  if (state.status === "cancelled") {
    return [
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(key.cancelledTitle)}
${t(key.cancelledDescription)}`,
        ),
      ),
    ];
  }
  if (state.step === 1) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t(key.welcomeTitle)}
${t(key.welcomeDescription)}`,
      ),
    );
    if (state.backupAvailable) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`*${t(key.restoreHint)}*`),
      );
    }
    const rows: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[] = [
      container,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("preset", t(key.startFromPreset), ButtonStyle.Primary),
        button("scratch", t(key.buildFromScratch), ButtonStyle.Secondary),
      ),
    ];
    if (state.backupAvailable) {
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("restore-backup", String(t(key.restoreButton)), ButtonStyle.Success),
        ),
      );
    }
    return rows;
  }
  if (state.step === 2) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t(key.presetTitle)}
${t(key.presetDescription)}`,
      ),
    );
    return [
      container,
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            createQuickstartCustomId(state.id, state.revision, "select-preset"),
          )
          .addOptions(presetOptions(t)),
      ),
    ];
  }

  if (state.step === 3) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t(key.generalOptionsTitle)}
${state.hadExistingSettings ? t(key.editExistingDescription) : t(key.generalOptionsDescription)}`,
      ),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${t(key.defaultExpiry)}:** ${t(key.expiryDays, { days: state.config.defaultExpiryDays })}
**${t(key.dmOnWarn)}:** ${state.config.dmOnWarn ? t(key.dmEnabled) : t(key.dmDisabled)}`,
      ),
    );

    if (state.editingGeneralSetting === "expiry") {
      return [
        container,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              createQuickstartCustomId(state.id, state.revision, "set-expiry"),
            )
            .setPlaceholder(String(t(key.expiryDays, { days: state.config.defaultExpiryDays })))
            .addOptions(
              [1, 3, 7, 14, 30, 60, 90, 180, 365].map((days) => ({
                label: t(key.expiryDays, { days }),
                value: String(days),
                default: state.config.defaultExpiryDays === days,
              })),
            ),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("back", String(t(key.back)), ButtonStyle.Secondary),
        ),
      ];
    }

    if (state.editingGeneralSetting === "dm") {
      const dmLabel = state.config.dmOnWarn
        ? `${t(key.dmEnabled)} — ${t(key.dmOnWarn)}`
        : `${t(key.dmDisabled)} — ${t(key.dmOnWarn)}`;
      return [
        container,
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(createQuickstartCustomId(state.id, state.revision, "toggle-dm-from-menu"))
            .setLabel(dmLabel)
            .setStyle(state.config.dmOnWarn ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(state.status !== "active"),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("back", String(t(key.back)), ButtonStyle.Secondary),
        ),
      ];
    }

    const hubRows: (
      | ContainerBuilder
      | ActionRowBuilder<ButtonBuilder>
      | ActionRowBuilder<StringSelectMenuBuilder>
    )[] = [
      container,
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            createQuickstartCustomId(state.id, state.revision, "select-general-setting"),
          )
          .setPlaceholder(String(t(key.selectGeneralSettingPlaceholder)))
          .addOptions(
            { label: String(t(key.defaultExpiry)), description: t(key.expiryDays, { days: state.config.defaultExpiryDays }), value: "expiry" },
            { label: String(t(key.dmOnWarn)), description: state.config.dmOnWarn ? String(t(key.dmEnabled)) : String(t(key.dmDisabled)), value: "dm" },
          ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("levels", t(key.configureWarnLevels), ButtonStyle.Primary),
      ),
    ];
    if (state.hadExistingSettings) {
      // Reset gets its own row so it's impossible to miss — and impossible
      // to fat-finger next to another button.
      hubRows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("reset", String(t(key.resetButton)), ButtonStyle.Danger),
        ),
      );
    }
    return hubRows;
  }

  if (state.step === 4) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t(key.warnLevelsTitle)}
${t(key.warnLevelsDescription)}`,
      ),
    );
    if (state.config.levels.length > 0) {
      for (let i = 0; i < state.config.levels.length; i++) {
        const lvl = state.config.levels[i];
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**${t(key.levelNSummary, { level: i + 1 })}** — ${formatLevelSummary(lvl, t)}`,
          ),
        );
      }
    }
    const components: (
      | ContainerBuilder
      | ActionRowBuilder<ButtonBuilder>
      | ActionRowBuilder<StringSelectMenuBuilder>
    )[] = [container];
    if (state.config.levels.length > 0) {
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              createQuickstartCustomId(state.id, state.revision, "select-level"),
            )
            .setPlaceholder(String(t(key.selectWarnLevel)))
            .addOptions(
              state.config.levels.slice(0, 25).map((lvl, i) => ({
                label: String(t(key.levelNSummary, { level: i + 1 })),
                description: formatLevelSummary(lvl, t, guild).slice(0, 100),
                value: String(i),
              })),
            ),
        ),
      );
    }
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("add-level", String(t(key.addWarnLevel)), ButtonStyle.Success),
        button("back", String(t(key.back)), ButtonStyle.Secondary),
        button("review", String(t(key.continueToReview)), ButtonStyle.Primary),
      ),
    );
    return components;
  }

  if (state.step === 5) {
    const idx = state.editingLevelIndex;
    if (idx === undefined || idx >= state.config.levels.length) {
      return [container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(String(t(key.interactionExpired))),
      )];
    }
    const level = state.config.levels[idx];

    // Editing one specific punishment gets its own screen so it's clear
    // what's being changed.
    if (
      state.selectedPunishmentIndex !== undefined &&
      state.selectedPunishmentIndex < level.punishments.length &&
      !state.addPunishmentStep &&
      !state.editingLevelSetting
    ) {
      const selP = level.punishments[state.selectedPunishmentIndex];
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(key.editPunishment)}
**${t(key.levelNSummary, { level: idx + 1 })}** — ${punishmentLabel(selP, t)}`,
        ),
      );
      const rows: (
        | ContainerBuilder
        | ActionRowBuilder<ButtonBuilder>
        | ActionRowBuilder<RoleSelectMenuBuilder>
      )[] = [container];
      if (selP.type === "role") {
        // Role punishments are edited with a role select — no modal.
        rows.push(
          new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(
                createQuickstartCustomId(state.id, state.revision, "edit-punishment", String(state.selectedPunishmentIndex)),
              )
              .setPlaceholder(String(t(key.editPunishment)).slice(0, 150))
              .setDisabled(state.status !== "active"),
          ),
        );
        rows.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                createQuickstartCustomId(state.id, state.revision, "remove-punishment", String(state.selectedPunishmentIndex)),
              )
              .setEmoji(Emojis.Trash)
              .setLabel(String(t(key.removePunishment)))
              .setStyle(ButtonStyle.Danger),
            button("back", String(t(key.back)), ButtonStyle.Secondary),
          ),
        );
        return rows;
      }
      const actionRow = new ActionRowBuilder<ButtonBuilder>();
      if (selP.type !== "kick") {
        // Kicks have no settings to change — only removal makes sense.
        actionRow.addComponents(
          new ButtonBuilder()
            .setCustomId(
              createQuickstartCustomId(state.id, state.revision, "edit-punishment", String(state.selectedPunishmentIndex)),
            )
            .setEmoji(Emojis.Edit)
            .setLabel(`${t(key.editPunishment)}: ${punishmentLabel(selP, t, guild).slice(0, 40)}`)
            .setStyle(ButtonStyle.Primary),
        );
      }
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(
            createQuickstartCustomId(state.id, state.revision, "remove-punishment", String(state.selectedPunishmentIndex)),
          )
          .setEmoji(Emojis.Trash)
          .setLabel(String(t(key.removePunishment)))
          .setStyle(ButtonStyle.Danger),
      );
      rows.push(actionRow);
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("back", String(t(key.back)), ButtonStyle.Secondary),
        ),
      );
      return rows;
    }

    // Level details work like the general settings menu: pick a setting,
    // then edit it on its own screen.
    if (state.editingLevelSetting) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(key.levelDetailsTitle, { level: idx + 1 })}`,
        ),
      );

      if (state.editingLevelSetting === "message") {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### ${t(key.levelMessage)}
${level.message ?? `*${t(key.noLevelMessage)}*`}`,
          ),
        );
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("edit-message", String(t(key.editMessage)), ButtonStyle.Primary),
        );
        if (level.message) {
          row.addComponents(
            button("clear-message", String(t(key.clearMessage)), ButtonStyle.Danger),
          );
        }
        row.addComponents(button("back", String(t(key.back)), ButtonStyle.Secondary));
        return [container, row];
      }

      if (state.editingLevelSetting === "autoConfirm") {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### ${t(key.autoExecute)}
${t(key.autoExecuteDesc)}`,
          ),
        );
        return [
          container,
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(createQuickstartCustomId(state.id, state.revision, "toggle-auto-from-menu"))
              .setLabel(`${level.autoConfirm ? t(key.auto) : t(key.manual)} — ${t(key.autoExecute)}`)
              .setStyle(level.autoConfirm ? ButtonStyle.Success : ButtonStyle.Secondary)
              .setDisabled(state.status !== "active"),
          ),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            button("back", String(t(key.back)), ButtonStyle.Secondary),
          ),
        ];
      }

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**${t(key.levelMessage)}:** ${level.message ? level.message.slice(0, 200) : t(key.noLevelMessage)}
**${t(key.autoExecute)}:** ${level.autoConfirm ? t(key.auto) : t(key.manual)}`,
        ),
      );
      return [
        container,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              createQuickstartCustomId(state.id, state.revision, "select-level-setting"),
            )
            .setPlaceholder(String(t(key.selectGeneralSettingPlaceholder)))
            .addOptions(
              {
                label: String(t(key.levelMessage)),
                description: (level.message ?? String(t(key.noLevelMessage))).slice(0, 100),
                value: "message",
              },
              {
                label: String(t(key.autoExecute)),
                description: String(level.autoConfirm ? t(key.auto) : t(key.manual)),
                value: "autoConfirm",
              },
            ),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("back", String(t(key.back)), ButtonStyle.Secondary),
        ),
      ];
    }

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t(key.editWarnLevelTitle, { level: idx + 1 })}`,
      ),
    );

    const atCap = level.punishments.length >= MAX_PUNISHMENTS_PER_LEVEL;

    if (state.addPunishmentStep === "type") {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${t(key.punishmentTypeSelect)}`),
      );
      const hasMute = level.punishments.some((p) => p.type === "mute");
      const hasKick = level.punishments.some((p) => p.type === "kick");
      const hasBan = level.punishments.some((p) => p.type === "ban");
      const typeOptions = [
        ...(hasMute ? [] : [{ label: String(t(key.actionMute)), description: String(t(key.actionMuteDesc)), value: "mute" }]),
        ...(hasKick ? [] : [{ label: String(t(key.actionKick)), description: String(t(key.actionKickDesc)), value: "kick" }]),
        ...(hasBan ? [] : [{ label: String(t(key.actionBan)), description: String(t(key.actionBanDesc)), value: "ban" }]),
        { label: String(t(key.actionRole)), description: String(t(key.actionRoleDesc)), value: "role" },
      ];
      return [
        container,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              createQuickstartCustomId(state.id, state.revision, "choose-add-punishment-type"),
            )
            .setPlaceholder(String(t(key.punishmentTypeSelect)))
            .addOptions(typeOptions),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(createQuickstartCustomId(state.id, state.revision, "cancel-add-punishment"))
            .setLabel(String(t(key.cancelAddPunishment)))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(state.status !== "active"),
        ),
      ];
    }

    if (state.addPunishmentStep === "role") {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${t(key.actionRole)}\n${t(key.actionRoleDesc)}`),
      );
      return [
        container,
        new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(
              createQuickstartCustomId(state.id, state.revision, "confirm-add-punishment"),
            )
            .setPlaceholder(String(t(key.actionRole)))
            .setDisabled(state.status !== "active"),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(createQuickstartCustomId(state.id, state.revision, "cancel-add-punishment"))
            .setLabel(String(t(key.cancelAddPunishment)))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(state.status !== "active"),
        ),
      ];
    }

    if (level.punishments.length === 0) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`*${t(key.noPunishmentsYet)}*`),
      );
    } else {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${t(key.punishments)}`),
      );
      for (let i = 0; i < level.punishments.length; i++) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${i + 1}. ${punishmentLabel(level.punishments[i], t)}`,
          ),
        );
      }
    }

    if (atCap) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(String(t(key.maxPunishments))),
      );
    }

    const components: (
      | ContainerBuilder
      | ActionRowBuilder<ButtonBuilder>
      | ActionRowBuilder<StringSelectMenuBuilder>
      | ActionRowBuilder<RoleSelectMenuBuilder>
    )[] = [container];

    if (level.punishments.length > 0) {
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              createQuickstartCustomId(state.id, state.revision, "select-punishment"),
            )
            .setPlaceholder(String(t(key.selectPunishmentPlaceholder)))
            .addOptions(
              level.punishments.map((p, i) => ({
                label: punishmentLabel(p, t, guild).slice(0, 100),
                description: (i + 1).toString(),
                value: String(i),
              })),
            ),
        ),
      );
    }

    if (!atCap && !state.addPunishmentStep) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(createQuickstartCustomId(state.id, state.revision, "start-add-punishment"))
            .setLabel(String(t(key.addPunishmentButton)))
            .setStyle(ButtonStyle.Success)
            .setDisabled(state.status !== "active"),
        ),
      );
    }

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("edit-details", String(t(key.levelDetails)), ButtonStyle.Primary),
        button("remove-level", String(t(key.remove)), ButtonStyle.Danger),
        button("back", String(t(key.back)), ButtonStyle.Secondary),
      ),
    );
    return components;
  }

  if (state.step === 7) {
    if (state.resetStage === "confirm") {
      container
        .setAccentColor(Colors.Error)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# ${t(key.resetConfirmTitle)}
${t(key.resetConfirmDescription)}`,
          ),
        );
      return [
        container,
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("confirm-reset", String(t(key.resetConfirmContinue)), ButtonStyle.Danger),
          button("cancel-reset", String(t(key.resetConfirmCancel)), ButtonStyle.Secondary),
        ),
      ];
    }
    if (state.resetStage === "done") {
      const restoreUntil = convertToDiscordTimestamp(
        state.restoreExpiresAt ?? Date.now() + BackupTtlMs,
        "R",
      );
      container
        .setAccentColor(Colors.Warning)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# ${t(key.resetDoneTitle)}
${t(key.resetDoneDescription, { timestamp: restoreUntil })}`,
          ),
        );
      return [
        container,
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("start-over", String(t(key.startOverButton)), ButtonStyle.Primary),
          button("restore-backup", String(t(key.restoreButton)), ButtonStyle.Success),
        ),
      ];
    }
    if (state.resetStage === "restored") {
      container
        .setAccentColor(Colors.Success)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# ${t(key.restoredTitle)}
${t(key.restoredDescription)}`,
          ),
        );
      return [
        container,
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("back", String(t(key.back)), ButtonStyle.Secondary),
        ),
      ];
    }
    return [
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(String(t(key.interactionExpired))),
      ),
    ];
  }

  // Review: the full picture of what's about to be saved.
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${t(key.reviewTitle)}
${t(key.reviewDescription)}`,
    ),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### ${t(key.generalSettings)}
**${t(key.defaultExpiry)}:** ${t(key.expiryDays, { days: state.config.defaultExpiryDays })}
**${t(key.dmOnWarn)}:** ${state.config.dmOnWarn ? t(key.dmEnabled) : t(key.dmDisabled)}`,
    ),
  );
  const levelLines = state.config.levels.map(
    (lvl, i) =>
      `**${t(key.levelNSummary, { level: i + 1 })}** — ${formatLevelSummary(lvl, t)}`,
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### ${t(key.warnLevelsSummary, { count: state.config.levels.length })}
${levelLines.length > 0 ? levelLines.join("\n") : `*${t(key.none)}*`}`,
    ),
  );
  return [
    container,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button("back", String(t(key.back)), ButtonStyle.Secondary),
      button("save", String(t(key.saveConfiguration)), ButtonStyle.Success),
      button("cancel", String(t(key.cancel)), ButtonStyle.Secondary),
    ),
  ];
}

