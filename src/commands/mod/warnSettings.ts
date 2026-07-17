import { Command } from "@sapphire/framework";
import { Subcommand } from "@sapphire/plugin-subcommands";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import type { TFunction } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ApplicationIntegrationType,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { modActionService } from "../../lib/moderation/actions.js";
import { PRESETS } from "../../lib/moderation/presets.js";
import { WarnWorkflowRepository } from "../../lib/moderation/workflowRepository.js";
import {
  createWarnQuickstartState,
  renderWarnQuickstart,
  warnWorkflowRepository,
} from "../../interaction-handlers/warnQuickstart.js";
import { Colors } from "../../lib/colors.js";
import { db } from "../../db/index.js";
import { warnSettings } from "../../db/schema.js";
import { nanoid } from "nanoid";
import { normalizeActions } from "../../lib/moderation/migration.js";
import type { WarnLevel, WarnPunishment } from "../../lib/moderation/types.js";

const formatDurationHours = (ms: number): string => {
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days}d` : `${hours}h`;
};

const punishmentLine = (p: WarnPunishment, t: TFunction): string => {
  switch (p.type) {
    case "mute":
      return `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentMute)} (${formatDurationHours(p.duration ?? 0)})`;
    case "kick":
      return t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentKick);
    case "ban":
      return p.duration
        ? `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBan)} (${formatDurationHours(p.duration)})`
        : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBanPerm);
    case "role":
      return p.roleId
        ? `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole)} -> <@&${p.roleId}>`
        : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole);
  }
};

const levelLine = (level: WarnLevel, t: TFunction): string => {
  const punishments = level.punishments.length
    ? level.punishments.map((p) => punishmentLine(p, t)).join(", ")
    : t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.none);
  return t(LanguageKeys.Commands.Moderation.WarnSettings.actionsListLine, {
    count: level.warnCount,
    action: punishments,
    duration: "",
  });
};

export class WarnSettingsCommand extends CommandUtils.PomeloSubcommand {
  public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
    super(context, {
      ...options,
      description: "Manage warn system settings.",
      requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
      preconditions: ["GuildOnly"],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      applyLocalizedBuilder(builder, LanguageKeys.Commands.Moderation.WarnSettings.commandName, LanguageKeys.Commands.Moderation.WarnSettings.commandDescription)
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .addSubcommand((sub) =>
          applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.WarnSettings.subcommandActionsName, LanguageKeys.Commands.Moderation.WarnSettings.subcommandActionsDescription)
            .setName("actions"),
        )
        .addSubcommand((sub) =>
          applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.WarnSettings.subcommandRolesName, LanguageKeys.Commands.Moderation.WarnSettings.subcommandRolesDescription)
            .setName("roles"),
        )
        .addSubcommand((sub) =>
          applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.WarnSettings.subcommandPresetName, LanguageKeys.Commands.Moderation.WarnSettings.subcommandPresetDescription)
            .setName("preset"),
        )
        .addSubcommand((sub) =>
          applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.WarnSettings.quickstartCommandName, LanguageKeys.Commands.Moderation.WarnSettings.quickstartCommandDescription)
            .setName("quickstart"),
        ),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return;

    if (subcommand === "roles") {
      await this.showRoleConfig(interaction);
      return;
    }

    if (subcommand === "quickstart") {
      await this.runQuickstart(interaction);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subcommand === "actions") {
      await this.showActions(interaction);
      return;
    }

    if (subcommand === "preset") {
      await this.showPresetSelector(interaction);
      return;
    }

    await this.showView(interaction);
  }

  private async showView(interaction: Command.ChatInputCommandInteraction) {
    const t = await fetchT(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return;
    const settings = await modActionService.getWarnSettings(guildId);

    if (!settings) {
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Warning)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            t(LanguageKeys.Commands.Moderation.WarnSettings.viewEmpty),
          ),
        );
      await this.reply(
        interaction,
        { components: [container], flags: MessageFlags.IsComponentsV2 },
        { type: PomeloReplyType.Error },
      );
      return;
    }

    const levels = normalizeActions(settings.actions);
    const actionsLine =
      levels.length > 0
        ? levels.map((l) => levelLine(l, t)).join("\n")
        : t(LanguageKeys.Commands.Moderation.WarnSettings.noActions);

    const logChannelLine = settings.logChannelId
      ? `<#${settings.logChannelId}>`
      : t(LanguageKeys.Commands.Moderation.WarnSettings.notSet);

    const container = new ContainerBuilder()
      .setAccentColor(Colors.Info)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            `**${t(LanguageKeys.Commands.Moderation.WarnSettings.expiry)}:** ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.expiryDays, { days: settings.defaultExpiryDays })}`,
            `**${t(LanguageKeys.Commands.Moderation.WarnSettings.dmOnWarn)}:** ${
              settings.dmOnWarn
                ? t(LanguageKeys.Commands.Moderation.WarnSettings.viewEnabled)
                : t(LanguageKeys.Commands.Moderation.WarnSettings.viewDisabled)
            }`,
            `**${t(LanguageKeys.Commands.Moderation.WarnSettings.viewLogChannel)}:** ${logChannelLine}`,
            `**${t(LanguageKeys.Commands.Moderation.WarnSettings.actions)}:**`,
            actionsLine,
          ].join("\n"),
        ),
      );

    await this.reply(
      interaction,
      { components: [container], flags: MessageFlags.IsComponentsV2 },
      { type: PomeloReplyType.Success },
    );
  }

  private async showActions(interaction: Command.ChatInputCommandInteraction) {
    const t = await fetchT(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return;
    const settings = await modActionService.getWarnSettings(guildId);
    const levels = normalizeActions(settings?.actions);

    const container = new ContainerBuilder()
      .setAccentColor(Colors.Info)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(LanguageKeys.Commands.Moderation.WarnSettings.actionsListTitle)}`,
        ),
      );

    if (levels.length === 0) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          t(LanguageKeys.Commands.Moderation.WarnSettings.actionsListEmpty),
        ),
      );
    } else {
      const lines = levels.map((l) => levelLine(l, t));
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );
    }

    await this.reply(
      interaction,
      { components: [container], flags: MessageFlags.IsComponentsV2 },
      { type: PomeloReplyType.Success },
    );
  }

  private async showRoleConfig(interaction: Command.ChatInputCommandInteraction) {
    const t = await fetchT(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return;

    const modalId = nanoid();
    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(t(LanguageKeys.Commands.Moderation.WarnSettings.roleConfigTitle))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("config")
            .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.roleConfigLabel))
            .setPlaceholder(
              t(LanguageKeys.Commands.Moderation.WarnSettings.roleConfigPlaceholder),
            )
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false),
        ),
      );

    await interaction.showModal(modal);
    const modalInteraction = await interaction
      .awaitModalSubmit({
        time: 600000,
        filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
      })
      .catch(() => null);
    if (!modalInteraction) return;

    const configStr = modalInteraction.fields.getTextInputValue("config").trim();

    await db
      .insert(warnSettings)
      .values({ guildId, roleApply: configStr || null })
      .onConflictDoUpdate({
        target: warnSettings.guildId,
        set: { roleApply: configStr || null },
      });

    await modalInteraction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    const container = new ContainerBuilder()
      .setAccentColor(Colors.Success)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          t(LanguageKeys.Commands.Moderation.WarnSettings.roleConfigSaved),
        ),
      );
    await this.reply(
      modalInteraction,
      { components: [container] },
      { type: PomeloReplyType.Success },
    );
  }

  private async showPresetSelector(interaction: Command.ChatInputCommandInteraction) {
    const t = await fetchT(interaction);
    const selectId = nanoid();
    const select = new StringSelectMenuBuilder()
      .setCustomId(selectId)
      .setPlaceholder(
        t(LanguageKeys.Commands.Moderation.WarnSettings.presetPickerPlaceholder),
      )
      .addOptions([
        {
          label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetLemomeme),
          description: t(
            LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetLemomemeDesc,
          ),
          value: "lemomeme",
        },
        {
          label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetRecommended),
          description: t(
            LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetRecommendedDesc,
          ),
          value: "recommended",
        },
        {
          label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetProgressive),
          description: t(
            LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetProgressiveDesc,
          ),
          value: "progressive",
        },
        {
          label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetStrictStrike),
          description: t(
            LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.presetStrictStrikeDesc,
          ),
          value: "strictStrike",
        },
      ]);

    const container = new ContainerBuilder()
      .setAccentColor(Colors.Info)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(LanguageKeys.Commands.Moderation.WarnSettings.presetPickerTitle)}`,
        ),
        new TextDisplayBuilder().setContent(
          t(LanguageKeys.Commands.Moderation.WarnSettings.presetPickerDescription),
        ),
      );

    await this.reply(
      interaction,
      {
        components: [container, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
        flags: MessageFlags.IsComponentsV2,
      },
      { type: PomeloReplyType.Success },
    );

    const selectInteraction = await interaction.channel
      ?.awaitMessageComponent({
        filter: (i) => i.customId === selectId && i.user.id === interaction.user.id,
        time: 60000,
        componentType: ComponentType.StringSelect,
      })
      .catch(() => null);
    if (!selectInteraction) return;

    const preset = selectInteraction.values[0] as keyof typeof PRESETS;
    if (!PRESETS[preset]) return;
    const guildId = interaction.guildId;
    if (!guildId) return;
    const actionsJson = JSON.stringify(PRESETS[preset].levels);

    await db
      .insert(warnSettings)
      .values({ guildId, actions: actionsJson })
      .onConflictDoUpdate({
        target: warnSettings.guildId,
        set: { actions: actionsJson },
      });

    await selectInteraction.deferReply({
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    const successContainer = new ContainerBuilder()
      .setAccentColor(Colors.Success)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          t(LanguageKeys.Commands.Moderation.WarnSettings.updated),
        ),
      );
    await this.reply(
      selectInteraction,
      { components: [successContainer] },
      { type: PomeloReplyType.Success },
    );
  }

  private async runQuickstart(interaction: Command.ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const state = createWarnQuickstartState({
      id: WarnWorkflowRepository.createId(),
      ownerId: interaction.user.id,
      guildId,
      messageId: "pending",
    });
    const t = await fetchT(interaction);
    const reply = await interaction.reply({
      components: renderWarnQuickstart(state, t),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    const message = await reply.fetch();
    await warnWorkflowRepository.save({ ...state, messageId: message.id });
  }
}
