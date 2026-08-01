import { Command } from "@sapphire/framework";
import { Subcommand } from "@sapphire/plugin-subcommands";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import type { TFunction } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ApplicationIntegrationType,
  ButtonBuilder,
  ButtonStyle,
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
import { Colors } from "../../lib/colors.js";
import { normalizeActions } from "../../lib/moderation/migration.js";
import { createComponentId } from "../../lib/helpers/componentSessions.js";
import type { WarnLevel, WarnPunishment } from "../../lib/moderation/types.js";

export const WARN_SETTINGS_FEATURE = "wp";
export const QA_CONFIG_FEATURE = "qa-config";

const formatDurationHours = (ms: number): string => {
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${String(days)}d` : `${String(hours)}h`;
};

const PRESET_KEYS = ["lemomeme", "recommended", "progressive", "strictStrike"] as const;

function presetOption(key: typeof PRESET_KEYS[number], t: TFunction) {
  const base = LanguageKeys.Commands.Moderation.WarnSettings;
  const labelKey =
    key === "lemomeme"
      ? base.presetLemomeme
      : key === "recommended"
        ? base.presetRecommended
        : key === "progressive"
          ? base.presetProgressive
          : base.presetStrictStrike;
  const descKey =
    key === "lemomeme"
      ? base.Quickstart.presetLemomemeDesc
      : key === "recommended"
        ? base.Quickstart.presetRecommendedDesc
        : key === "progressive"
          ? base.Quickstart.presetProgressiveDesc
          : base.Quickstart.presetStrictStrikeDesc;
  return { label: t(labelKey), description: t(descKey), value: key };
}

const punishmentLine = (p: WarnPunishment, t: TFunction): string => {
  switch (p.type) {
    case "mute":
      return `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentMute)} (${formatDurationHours(p.duration ?? 0)})`;
    case "kick":
      return t(
        LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentKick,
      );
    case "ban":
      return p.duration
        ? `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentBan)} (${formatDurationHours(p.duration)})`
        : t(
            LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
              .punishmentBanPerm,
          );
    case "role":
      return p.roleId
        ? `${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.punishmentRole)} -> <@&${p.roleId}>`
        : t(
            LanguageKeys.Commands.Moderation.WarnSettings.Quickstart
              .punishmentRole,
          );
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

export class ModSettingsCommand extends CommandUtils.PomeloSubcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: "modsettings",
      description: "Manage moderation settings.",
      requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
      preconditions: ["GuildOnly"],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Moderation.WarnSettings.commandName,
        LanguageKeys.Commands.Moderation.WarnSettings.commandDescription,
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .addSubcommand((sub) =>
          applyLocalizedBuilder(
            sub,
            LanguageKeys.Commands.Moderation.WarnSettings.subcommandActionsName,
            LanguageKeys.Commands.Moderation.WarnSettings
              .subcommandActionsDescription,
          ).setName("actions"),
        )
        .addSubcommand((sub) =>
          applyLocalizedBuilder(
            sub,
            LanguageKeys.Commands.Moderation.WarnSettings.subcommandRolesName,
            LanguageKeys.Commands.Moderation.WarnSettings
              .subcommandRolesDescription,
          ).setName("roles"),
        )
        .addSubcommand((sub) =>
          applyLocalizedBuilder(
            sub,
            LanguageKeys.Commands.Moderation.WarnSettings.subcommandPresetName,
            LanguageKeys.Commands.Moderation.WarnSettings
              .subcommandPresetDescription,
          ).setName("preset"),
        )
        .addSubcommand((sub) =>
          sub
            .setName("quickactions")
            .setDescription("Configure quick actions for moderation."),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return;

    if (subcommand === "roles") {
      await this.showRoleConfig(interaction);
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

    if (subcommand === "quickactions") {
      await this.showQuickActionsConfig(interaction);
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
    if (!settings) {
      const emptyContainer = new ContainerBuilder()
        .setAccentColor(Colors.Warning)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            t(LanguageKeys.Commands.Moderation.WarnSettings.viewEmpty),
          ),
        );
      await this.reply(
        interaction,
        { components: [emptyContainer], flags: MessageFlags.IsComponentsV2 },
        { type: PomeloReplyType.Error },
      );
      return;
    }
    const levels = normalizeActions(settings.actions);

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

  private async showRoleConfig(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const t = await fetchT(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return;

    // Saving happens in the persistent warnSettingsModal interaction handler.
    const modal = new ModalBuilder()
      .setCustomId(
        createComponentId(WARN_SETTINGS_FEATURE, interaction.user.id, "roles"),
      )
      .setTitle(
        t(LanguageKeys.Commands.Moderation.WarnSettings.roleConfigTitle),
      )
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("config")
            .setLabel(
              t(LanguageKeys.Commands.Moderation.WarnSettings.roleConfigLabel),
            )
            .setPlaceholder(
              t(
                LanguageKeys.Commands.Moderation.WarnSettings
                  .roleConfigPlaceholder,
              ),
            )
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false),
        ),
      );

    await interaction.showModal(modal);
  }

  private async showQuickActionsConfig(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const t = await fetchT(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return;

    const settings = await this.container.redis.jsonGet(guildId, "GuildSettings");
    const qa = settings?.quickActions ?? { actions: [] };
    const actions = qa.actions ?? [];

    const subactionTypeLabel = (type: string): string => {
      const keyMap: Record<string, string> = {
        warn: LanguageKeys.Commands.Moderation.QuickActions.subWarn,
        mute: LanguageKeys.Commands.Moderation.QuickActions.subMute,
        addRole: LanguageKeys.Commands.Moderation.QuickActions.subAddRole,
        sendDm: LanguageKeys.Commands.Moderation.QuickActions.subSendDm,
        kick: LanguageKeys.Commands.Moderation.QuickActions.subKick,
        ban: LanguageKeys.Commands.Moderation.QuickActions.subBan,
      };
      return t(keyMap[type] ?? type);
    };

    const subactionDetail = (sub: { type: string; warnAmount?: number; muteDuration?: number; roleId?: string; dmMessage?: string; kickReason?: string; banReason?: string; banDuration?: number }): string => {
      switch (sub.type) {
        case "warn": return ` (${sub.warnAmount ?? 1}x)`;
        case "mute": {
          if (!sub.muteDuration) return "";
          const mins = Math.round(sub.muteDuration / 60000);
          if (mins >= 1440) return ` (${Math.round(mins / 1440)}d)`;
          if (mins >= 60) return ` (${Math.round(mins / 60)}h)`;
          return ` (${mins}m)`;
        }
        case "addRole": return sub.roleId ? ` (<@&${sub.roleId}>)` : "";
        case "sendDm": return "";
        case "kick": return sub.kickReason ? ` (${sub.kickReason})` : "";
        case "ban": {
          const parts: string[] = [];
          if (sub.banDuration) {
            const mins = Math.round(sub.banDuration / 60000);
            if (mins >= 1440) parts.push(`${Math.round(mins / 1440)}d`);
            else if (mins >= 60) parts.push(`${Math.round(mins / 60)}h`);
            else parts.push(`${mins}m`);
          } else {
            parts.push("perm");
          }
          return ` (${parts.join(", ")})`;
        }
        default: return "";
      }
    };

    const triggerLabel = (triggers: string[]): string =>
      triggers.map((tr) => {
        if (tr === "mute") return t(LanguageKeys.Commands.Moderation.QuickActions.mute);
        if (tr === "warn") return t(LanguageKeys.Commands.Moderation.QuickActions.warn);
        return tr;
      }).join(", ");

    const actionLines = actions.length > 0
      ? actions.map((qa: { id: string; label: string; triggers: string[]; subactions: { type: string; warnAmount?: number; muteDuration?: number; roleId?: string; dmMessage?: string; kickReason?: string; banReason?: string; banDuration?: number }[] }, i: number) => {
          const subs = qa.subactions.map((s) => `${subactionTypeLabel(s.type)}${subactionDetail(s)}`).join(" → ");
          return `${i + 1}. **${qa.label}** — ${triggerLabel(qa.triggers)}\n   ${subs}`;
        }).join("\n\n")
      : t(LanguageKeys.Commands.Moderation.QuickActions.noActions);

    const textContent = [
      `# ${t(LanguageKeys.Commands.Moderation.QuickActions.configTitle)}`,
      actionLines,
    ].join("\n\n");

    const container = new ContainerBuilder()
      .setAccentColor(Colors.Info)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(textContent));

    const components: (
      | ContainerBuilder
      | ActionRowBuilder<ButtonBuilder>
      | ActionRowBuilder<StringSelectMenuBuilder>
    )[] = [container];

    if (actions.length > 0) {
      const removeSelect = new StringSelectMenuBuilder()
        .setCustomId(
          createComponentId(QA_CONFIG_FEATURE, interaction.user.id, "remove"),
        )
        .setPlaceholder(
          t(LanguageKeys.Commands.Moderation.QuickActions.removeAction),
        )
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          actions.map((qa: { id: string; label: string }, i: number) => ({
            label: qa.label,
            value: String(i),
          })),
        );
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect),
      );
    }

    const addButton = new ButtonBuilder()
      .setCustomId(
        createComponentId(QA_CONFIG_FEATURE, interaction.user.id, "add"),
      )
      .setLabel(t(LanguageKeys.Commands.Moderation.QuickActions.addAction))
      .setStyle(ButtonStyle.Primary);
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(addButton),
    );

    await this.reply(
      interaction,
      { components, flags: MessageFlags.IsComponentsV2 },
      { type: PomeloReplyType.Success },
    );
  }

  private async showPresetSelector(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const t = await fetchT(interaction);
    // The selection is handled by the persistent warnSettingsFlow
    // interaction handler, so the menu keeps working after restarts.
    const select = new StringSelectMenuBuilder()
      .setCustomId(
        createComponentId(WARN_SETTINGS_FEATURE, interaction.user.id, "preset"),
      )
      .setPlaceholder(
        t(
          LanguageKeys.Commands.Moderation.WarnSettings.presetPickerPlaceholder,
        ),
      )
      .addOptions(PRESET_KEYS.map((key) => presetOption(key, t)));

    const container = new ContainerBuilder()
      .setAccentColor(Colors.Info)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(LanguageKeys.Commands.Moderation.WarnSettings.presetPickerTitle)}`,
        ),
        new TextDisplayBuilder().setContent(
          t(
            LanguageKeys.Commands.Moderation.WarnSettings
              .presetPickerDescription,
          ),
        ),
      );

    await this.reply(
      interaction,
      {
        components: [
          container,
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        ],
        flags: MessageFlags.IsComponentsV2,
      },
      { type: PomeloReplyType.Success },
    );
  }
}
