import { Command } from "@sapphire/framework";
import { Subcommand } from "@sapphire/plugin-subcommands";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ApplicationIntegrationType,
  ComponentType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { modActionService } from "../../lib/moderation/actions.js";
import { PRESETS } from "../../lib/moderation/presets.js";
import { Colors } from "../../lib/colors.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { db } from "../../db/index.js";
import { warnSettings } from "../../db/schema.js";
import { nanoid } from "nanoid";
import type { WarnActionConfig } from "../../lib/moderation/types.js";

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

    // roles uses a modal first, so don't defer before showing it
    if (subcommand === "roles") {
      await this.showRoleConfig(interaction);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await fetchT(interaction);

    if (subcommand === "actions") {
      const settings = await modActionService.getWarnSettings(guildId);
      const currentActions: WarnActionConfig[] = settings?.actions ? JSON.parse(settings.actions) as WarnActionConfig[] : [];
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Info)
        .setDescription(
          currentActions.length > 0
            ? currentActions.map((a) => `At warn ${a.warnCount.toString()}: ${a.actionType}${a.duration ? ` (${Math.floor(a.duration / 3600000).toString()}h)` : ""}`).join("\n")
            : t(LanguageKeys.Commands.Moderation.WarnSettings.noActions),
        );
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
      return;
    }

    if (subcommand === "preset") {
      await this.showPresetSelector(interaction);
      return;
    }

    if (subcommand === "quickstart") {
      await this.runQuickstart(interaction);
      return;
    }

    // Default: show view
    await this.showView(interaction);
  }

  private async showView(interaction: Command.ChatInputCommandInteraction) {
    const t = await fetchT(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return;
    const settings = await modActionService.getWarnSettings(guildId);

    if (!settings) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Warning)
        .setDescription(t(LanguageKeys.Commands.Moderation.Errors.warnSettingsNotConfigured));
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Error });
      return;
    }

    const actions: WarnActionConfig[] = JSON.parse(settings.actions || "[]") as WarnActionConfig[];
    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Info)
      .setDescription([
        `**${t(LanguageKeys.Commands.Moderation.WarnSettings.expiry)}:** ${settings.defaultExpiryDays.toString()} days`,
        `**${t(LanguageKeys.Commands.Moderation.WarnSettings.dmOnWarn)}:** ${settings.dmOnWarn ? "Yes" : "No"}`,
        `**${t(LanguageKeys.Commands.Moderation.WarnSettings.actions)}:**`,
        ...(actions.length > 0 ? actions.map((a) => `- At warn ${a.warnCount.toString()}: ${a.actionType}`) : [t(LanguageKeys.Commands.Moderation.WarnSettings.noActions)]),
      ].join("\n"));

    await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
  }

  private async showRoleConfig(interaction: Command.ChatInputCommandInteraction) {
    const t = await fetchT(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return;

    const modal = new ModalBuilder()
      .setCustomId(nanoid())
      .setTitle("Role-per-Level Config")
      .setComponents([
        new ActionRowBuilder<TextInputBuilder>().setComponents([
          new TextInputBuilder()
            .setCustomId("config")
            .setLabel("JSON config (e.g. {\"3\":\"roleid\"})")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false),
        ]),
      ]);

    await interaction.showModal(modal);
    const modalInteraction = await interaction.awaitModalSubmit({ time: 600000, filter: (i) => i.customId === modal.data.custom_id }).catch(() => null);
    if (!modalInteraction) return;

    const configStr = modalInteraction.fields.getTextInputValue("config");

    await db.insert(warnSettings).values({ guildId, roleApply: configStr || null }).onConflictDoUpdate({ target: warnSettings.guildId, set: { roleApply: configStr || null } });

    await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    const embed = new EmbedUtils.EmbedConstructor().setColor(Colors.Success).setDescription(t(LanguageKeys.Commands.Moderation.WarnSettings.updated));
    await this.reply(modalInteraction, { embeds: [embed] }, { type: PomeloReplyType.Success });
  }

  private async showPresetSelector(interaction: Command.ChatInputCommandInteraction) {
    const t = await fetchT(interaction);
    const id = nanoid();
    const select = new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder("Select a preset")
      .addOptions([
        { label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetLemomeme), value: "lemomeme", description: "Role at 1-2 warns, ban at 3" },
        { label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetRecommended), value: "recommended", description: "Escalating timeouts, temp-ban at 6, ban at 7" },
        { label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetProgressive), value: "progressive", description: "Timeouts, kick at 4, ban at 5" },
        { label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetStrictStrike), value: "strictStrike", description: "Long timeouts, temp-ban at 4, ban at 5" },
      ]);

    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Info)
      .setDescription("Choose a preset:");

    await this.reply(interaction, { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().setComponents([select])] }, { type: PomeloReplyType.Success });

    const selectInteraction = await interaction.channel?.awaitMessageComponent({ filter: (i) => i.customId === id && i.user.id === interaction.user.id, time: 60000, componentType: ComponentType.StringSelect }).catch(() => null);
    if (!selectInteraction) return;

    const preset = selectInteraction.values[0] as keyof typeof PRESETS;
    const guildId = interaction.guildId;
    if (!guildId) return;
    const actionsJson = JSON.stringify(PRESETS[preset].levels);

    await db.insert(warnSettings).values({ guildId, actions: actionsJson }).onConflictDoUpdate({ target: warnSettings.guildId, set: { actions: actionsJson } });

    await selectInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    const embed2 = new EmbedUtils.EmbedConstructor().setColor(Colors.Success).setDescription(t(LanguageKeys.Commands.Moderation.WarnSettings.updated));
    await this.reply(selectInteraction, { embeds: [embed2] }, { type: PomeloReplyType.Success });
  }

  private async runQuickstart(interaction: Command.ChatInputCommandInteraction) {
    const t = await fetchT(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return;
    const id = nanoid();

    const select = new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder("Choose a severity preset")
      .addOptions([
        { label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetLemomeme), value: "lemomeme", description: "Role at 1-2 warns, ban at 3" },
        { label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetRecommended), value: "recommended", description: "Escalating timeouts, temp-ban at 6, ban at 7" },
        { label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetProgressive), value: "progressive", description: "Timeouts, kick at 4, ban at 5" },
        { label: t(LanguageKeys.Commands.Moderation.WarnSettings.presetStrictStrike), value: "strictStrike", description: "Long timeouts, temp-ban at 4, ban at 5" },
      ]);

    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Info)
      .setDescription("Welcome to the warn system setup! First, choose a severity preset:");

    await this.reply(interaction, { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().setComponents([select])] }, { type: PomeloReplyType.Success });

    const selectInteraction = await interaction.channel?.awaitMessageComponent({ filter: (i) => i.customId === id && i.user.id === interaction.user.id, time: 120000, componentType: ComponentType.StringSelect }).catch(() => null);
    if (!selectInteraction) return;

    const preset = selectInteraction.values[0] as keyof typeof PRESETS;

    const modal = new ModalBuilder()
      .setCustomId(nanoid())
      .setTitle("Warn System Configuration")
      .setComponents([
        new ActionRowBuilder<TextInputBuilder>().setComponents([
          new TextInputBuilder().setCustomId("expiryDays").setLabel("Warn expiry days (1-365)").setStyle(TextInputStyle.Short).setValue("3").setRequired(true),
        ]),
        new ActionRowBuilder<TextInputBuilder>().setComponents([
          new TextInputBuilder().setCustomId("dmOnWarn").setLabel("DM on warn? (yes/no)").setStyle(TextInputStyle.Short).setValue("yes").setRequired(true),
        ]),
      ]);

    await selectInteraction.showModal(modal);
    const modalInteraction = await selectInteraction.awaitModalSubmit({ time: 600000, filter: (i) => i.customId === modal.data.custom_id }).catch(() => null);
    if (!modalInteraction) return;

    const expiryDays = parseInt(modalInteraction.fields.getTextInputValue("expiryDays"), 10) || 3;
    const dmOnWarn = modalInteraction.fields.getTextInputValue("dmOnWarn").toLowerCase() === "yes";

    await db.insert(warnSettings).values({
      guildId,
      defaultExpiryDays: expiryDays,
      dmOnWarn,
      actions: JSON.stringify(PRESETS[preset].levels),
    }).onConflictDoUpdate({
      target: warnSettings.guildId,
      set: { defaultExpiryDays: expiryDays, dmOnWarn, actions: JSON.stringify(PRESETS[preset].levels) },
    });

    await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    const embed2 = new EmbedUtils.EmbedConstructor().setColor(Colors.Success).setDescription(t(LanguageKeys.Commands.Moderation.WarnSettings.updated));
    await this.reply(modalInteraction, { embeds: [embed2] }, { type: PomeloReplyType.Success });
  }
}
