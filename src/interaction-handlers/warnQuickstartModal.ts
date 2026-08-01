import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import type { TFunction } from "@sapphire/plugin-i18next";
import { eq } from "drizzle-orm";
import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type Interaction,
  type ModalSubmitInteraction,
} from "discord.js";
import { db } from "../db/index.js";
import { warnSettings } from "../db/schema.js";
import { Colors } from "../lib/colors.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { modActionService } from "../lib/moderation/actions.js";
import { sanitizeLevelMessage } from "../lib/moderation/migration.js";
import { BackupTtlMs } from "../lib/moderation/settingsBackup.js";
import {
  parseQuickstartModalCustomId,
  type QuickstartModalCustomId,
} from "../lib/moderation/workflowRepository.js";
import type {
  WarnPunishment,
  WarnWorkflowState,
} from "../lib/moderation/types.js";
import {
  renderWarnQuickstart,
  warnSettingsBackupRepository,
  warnWorkflowRepository,
} from "./warnQuickstart.js";

/**
 * Persistent modal-submit handler for the warn quickstart wizard. The
 * workflow state lives in Redis (warnWorkflowRepository), so modal
 * submissions keep working across restarts; the custom ID carries the
 * session, revision, and action.
 */
export class WarnQuickstartModalHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
    });
  }

  public override parse(interaction: Interaction) {
    if (!interaction.isModalSubmit()) return this.none();
    const parsed = parseQuickstartModalCustomId(interaction.customId);
    return parsed ? this.some(parsed) : this.none();
  }

  public override async run(
    interaction: Interaction,
    parsed: QuickstartModalCustomId,
  ): Promise<void> {
    if (!interaction.isModalSubmit()) return;
    const guildId = interaction.guildId;
    if (!guildId) return this.replyUnavailable(interaction);

    const state = await warnWorkflowRepository.get(parsed.sessionId);
    if (
      !state ||
      state.status !== "active" ||
      state.guildId !== guildId ||
      state.ownerId !== interaction.user.id ||
      state.revision !== parsed.revision ||
      (interaction.isFromMessage() &&
        state.messageId !== interaction.message.id)
    )
      return this.replyUnavailable(interaction);

    if (parsed.action === "edit-punishment")
      return this.handleEditPunishment(interaction, state, parsed);
    if (parsed.action === "edit-details")
      return this.handleEditDetails(interaction, state);
    if (parsed.action === "reset-settings")
      return this.handleResetSettings(interaction, state);
    return this.handleAddPunishment(interaction, state, parsed);
  }

  private async handleEditPunishment(
    interaction: ModalSubmitInteraction,
    state: WarnWorkflowState,
    parsed: QuickstartModalCustomId,
  ): Promise<void> {
    const t = await fetchT(interaction);
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
    const idx = state.editingLevelIndex;
    const pIdx = parsed.entityId !== undefined ? Number(parsed.entityId) : -1;
    if (idx === undefined || idx >= state.config.levels.length)
      return this.replyUnavailable(interaction);
    const level = state.config.levels[idx];
    if (!Number.isFinite(pIdx) || pIdx < 0 || pIdx >= level.punishments.length)
      return this.replyUnavailable(interaction);
    const punishment = { ...level.punishments[pIdx] };

    if (punishment.type === "mute") {
      const duration = modActionService.parseDuration(
        interaction.fields.getTextInputValue("duration"),
      );
      if (!duration || duration > 2_419_200_000) {
        await interaction.reply({
          content: String(t(key.invalidDuration)),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      punishment.duration = duration;
    } else if (punishment.type === "ban") {
      const raw = interaction.fields.getTextInputValue("duration").trim();
      if (raw) {
        const duration = modActionService.parseDuration(raw);
        if (!duration) {
          await interaction.reply({
            content: String(t(key.invalidDuration)),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        punishment.duration = duration;
      } else {
        delete punishment.duration;
      }
    } else if (punishment.type === "role") {
      // Role punishments are edited with a role select menu on the
      // message, never a modal.
      return this.replyUnavailable(interaction);
    }

    const newLevels = [...state.config.levels];
    const newPunishments = [...level.punishments];
    newPunishments[pIdx] = punishment;
    newLevels[idx] = { ...level, punishments: newPunishments };
    const next = { ...state, config: { ...state.config, levels: newLevels } };
    await this.advanceAndRender(interaction, next);
  }

  private async handleEditDetails(
    interaction: ModalSubmitInteraction,
    state: WarnWorkflowState,
  ): Promise<void> {
    const idx = state.editingLevelIndex;
    if (idx === undefined || idx >= state.config.levels.length)
      return this.replyUnavailable(interaction);
    const level = state.config.levels[idx];

    const rawMessage = interaction.fields.getTextInputValue("message").trim();
    const message = rawMessage ? sanitizeLevelMessage(rawMessage) : undefined;

    const newLevels = [...state.config.levels];
    newLevels[idx] = { ...level, message };
    const next = {
      ...state,
      // Land back on the level details menu with the fresh value visible.
      editingLevelSetting: "menu" as const,
      config: { ...state.config, levels: newLevels },
    };
    await this.advanceAndRender(interaction, next);
  }

  private async handleAddPunishment(
    interaction: ModalSubmitInteraction,
    state: WarnWorkflowState,
    parsed: QuickstartModalCustomId,
  ): Promise<void> {
    const t = await fetchT(interaction);
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
    const idx = state.editingLevelIndex;
    // The chosen type travels in the modal custom ID so the workflow
    // revision doesn't move while the modal is open. Only mute and ban
    // collect details through a modal.
    const type =
      parsed.entityId === "mute" || parsed.entityId === "ban"
        ? parsed.entityId
        : undefined;
    if (idx === undefined || idx >= state.config.levels.length || !type)
      return this.replyUnavailable(interaction);
    const level = state.config.levels[idx];

    const newPunishment: WarnPunishment = { type };
    if (type === "mute") {
      const duration = modActionService.parseDuration(
        interaction.fields.getTextInputValue("duration"),
      );
      if (!duration || duration > 2_419_200_000) {
        await interaction.reply({
          content: String(t(key.invalidDuration)),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      newPunishment.duration = duration;
    } else {
      const raw = interaction.fields.getTextInputValue("duration").trim();
      if (raw) {
        const duration = modActionService.parseDuration(raw);
        if (!duration) {
          await interaction.reply({
            content: String(t(key.invalidDuration)),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        newPunishment.duration = duration;
      }
    }

    const newLevels = [...state.config.levels];
    newLevels[idx] = {
      ...level,
      punishments: [...level.punishments, newPunishment],
    };
    const next = {
      ...state,
      addPunishmentStep: undefined,
      addPunishmentType: undefined,
      addPunishmentDraft: undefined,
      config: { ...state.config, levels: newLevels },
    };
    await this.advanceAndRender(interaction, next);
  }

  private async handleResetSettings(
    interaction: ModalSubmitInteraction,
    state: WarnWorkflowState,
  ): Promise<void> {
    const t = await fetchT(interaction);
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
    if (state.step !== 7 || state.resetStage !== "confirm")
      return this.replyUnavailable(interaction);
    // Destructive action: re-check the live permission, the modal custom ID
    // is routing only.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return this.replyUnavailable(interaction);

    const phrase = interaction.fields.getTextInputValue("confirm").trim();
    if (phrase !== "RESET") {
      await interaction.reply({
        content: String(t(key.resetModalMismatch)),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const current = await modActionService.getWarnSettings(state.guildId);
    if (!current) return this.replyUnavailable(interaction);

    // Snapshot before wiping. SET NX keeps the snapshot from the first
    // reset of the 24-hour window; later resets never overwrite it.
    const backup = await warnSettingsBackupRepository.save({
      guildId: state.guildId,
      savedAt: Date.now(),
      resetBy: interaction.user.id,
      settings: {
        maxWarns: current.maxWarns,
        defaultExpiryDays: current.defaultExpiryDays,
        dmOnWarn: current.dmOnWarn,
        autoApplyWarnPunishments: current.autoApplyWarnPunishments,
        dangerouslyBypassWarnPermissions:
          current.dangerouslyBypassWarnPermissions,
        logChannelId: current.logChannelId,
        actions: current.actions,
        roleApply: current.roleApply,
      },
    });

    await db
      .delete(warnSettings)
      .where(eq(warnSettings.guildId, state.guildId));

    await this.notifyLogChannel(interaction, current.logChannelId, t);

    const next: WarnWorkflowState = {
      ...state,
      resetStage: "done",
      hadExistingSettings: false,
      backupAvailable: true,
      restoreExpiresAt: backup.savedAt + BackupTtlMs,
    };
    await this.advanceAndRender(interaction, next);
  }

  private async notifyLogChannel(
    interaction: ModalSubmitInteraction,
    logChannelId: string | null,
    t: TFunction,
  ): Promise<void> {
    if (!logChannelId) return;
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
    try {
      const channel = await interaction.guild?.channels.fetch(logChannelId);
      if (!channel?.isTextBased()) return;
      await channel.send({
        components: [
          new ContainerBuilder()
            .setAccentColor(Colors.Warning)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                `# ${t(key.resetLogTitle)}\n${t(key.resetLogMessage, { user: `<@${interaction.user.id}>` })}`,
              ),
            ),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch {
      // A missing channel or missing permissions shouldn't block the reset.
    }
  }

  private async advanceAndRender(
    interaction: ModalSubmitInteraction,
    next: WarnWorkflowState,
  ): Promise<void> {
    const stored = await warnWorkflowRepository.advance(next);
    if (!stored) return this.replyUnavailable(interaction);
    const t = await fetchT(interaction);
    if (interaction.isFromMessage()) {
      await interaction.update({
        components: renderWarnQuickstart(stored, t, interaction.guild),
      });
    } else {
      await interaction.reply({
        components: renderWarnQuickstart(stored, t, interaction.guild),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }
  }

  private async replyUnavailable(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    const t = await fetchT(interaction);
    await interaction
      .reply({
        content: String(
          t(
            LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
              .interactionExpired,
          ),
        ),
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => null);
  }
}
