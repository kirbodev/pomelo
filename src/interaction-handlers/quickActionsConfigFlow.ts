import {
  InteractionHandler,
  InteractionHandlerTypes,
  container,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import { z } from "zod";
import {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
} from "discord.js";
import { Colors } from "../lib/colors.js";
import {
  parseComponentId,
  getComponentSession,
  saveComponentSession,
  replyInteractionExpired,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { QA_CONFIG_FEATURE } from "../commands/mod/modSettings.js";
import type { SubActionType } from "../lib/moderation/types.js";

const QA_TRIGGERS_FEATURE = "qa-triggers";
const QA_WIZARD_FEATURE = "qa-wiz";
const SubActionTypeSchema = z.enum([
  "warn",
  "mute",
  "addRole",
  "sendDm",
  "kick",
  "ban",
]);

const WizardSessionSchema = z.object({
  userId: z.string(),
  guildId: z.string(),
  sessionId: z.string(),
  draft: z.object({
    triggers: z.array(z.string()).min(1),
    label: z.string(),
    subactions: z.array(z.any()),
  }),
});

const SUBACTION_TYPE_KEYS: Record<string, string> = {
  warn: LanguageKeys.Commands.Moderation.QuickActions.subWarn,
  mute: LanguageKeys.Commands.Moderation.QuickActions.subMute,
  addRole: LanguageKeys.Commands.Moderation.QuickActions.subAddRole,
  sendDm: LanguageKeys.Commands.Moderation.QuickActions.subSendDm,
  kick: LanguageKeys.Commands.Moderation.QuickActions.subKick,
  ban: LanguageKeys.Commands.Moderation.QuickActions.subBan,
};

export class QuickActionsConfigFlowHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.SelectMenu,
    });
  }

  public override parse(interaction: Interaction) {
    if (!interaction.isStringSelectMenu()) return this.none();

    let parts = parseComponentId(QA_CONFIG_FEATURE, interaction.customId);
    if (parts && parts.length === 2 && parts[1] === "remove") {
      return this.some({ route: "remove", userId: parts[0], sessionId: "" });
    }

    parts = parseComponentId(QA_TRIGGERS_FEATURE, interaction.customId);
    if (parts && parts.length === 2 && parts[1] === "select") {
      return this.some({
        route: "triggersSelect",
        userId: parts[0],
        sessionId: "",
      });
    }

    parts = parseComponentId(QA_WIZARD_FEATURE, interaction.customId);
    if (parts && parts.length >= 3 && parts[1] === "selectSub") {
      return this.some({ route: "selectSub", userId: "", sessionId: parts[0] });
    }

    return this.none();
  }

  public override async run(
    interaction: Interaction,
    parsed: { route: string; userId: string; sessionId: string },
  ): Promise<void> {
    if (!interaction.isStringSelectMenu()) return;

    if (parsed.route === "remove") {
      if (interaction.user.id !== parsed.userId)
        return replyWrongTarget(interaction);
      const guildId = interaction.guildId;
      if (!guildId) return replyInteractionExpired(interaction);
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return replyWrongTarget(interaction);
      await this.handleRemove(interaction, guildId);
    } else if (parsed.route === "triggersSelect") {
      if (interaction.user.id !== parsed.userId)
        return replyWrongTarget(interaction);
      const guildId = interaction.guildId;
      if (!guildId) return replyInteractionExpired(interaction);
      await this.handleTriggersSelect(interaction, parsed.userId, guildId);
    } else if (parsed.route === "selectSub") {
      await this.handleSelectSub(interaction, parsed.sessionId);
    }
  }

  private async handleRemove(interaction: Interaction, guildId: string) {
    if (!interaction.isStringSelectMenu()) return;
    const t = await fetchT(interaction);
    const settings = await container.redis.jsonGet(guildId, "GuildSettings");
    if (!settings) return replyInteractionExpired(interaction);

    const current = settings.quickActions;
    const index = Number.parseInt(interaction.values[0] ?? "", 10);
    if (Number.isNaN(index) || index < 0 || index >= current.actions.length) {
      return replyInteractionExpired(interaction);
    }

    const removed = current.actions[index];
    const actions = current.actions.filter(
      (_: unknown, i: number) => i !== index,
    );

    await container.redis.jsonUpdate(guildId, "GuildSettings", {
      quickActions: { ...current, actions },
    });

    await interaction.reply({
      components: [
        new ContainerBuilder()
          .setAccentColor(Colors.Success)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `${t(LanguageKeys.Commands.Moderation.QuickActions.quickActionDeleted)} — **${removed.label}**`,
            ),
          ),
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }

  private async handleTriggersSelect(
    interaction: Interaction,
    userId: string,
    guildId: string,
  ) {
    if (!interaction.isStringSelectMenu()) return;

    const allowed = new Set(["mute", "warn"]);
    const triggers = interaction.values.filter((v) => allowed.has(v));
    if (triggers.length === 0) return;

    await saveComponentSession(
      QA_TRIGGERS_FEATURE,
      userId,
      { userId, guildId, triggers },
      300,
    );

    const t = await fetchT(interaction);
    const triggerLabels = triggers
      .map((tr) =>
        tr === "mute"
          ? t(LanguageKeys.Commands.Moderation.QuickActions.mute)
          : t(LanguageKeys.Commands.Moderation.QuickActions.warn),
      )
      .join(", ");

    await interaction.reply({
      components: [
        new ContainerBuilder()
          .setAccentColor(Colors.Success)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `${t(LanguageKeys.Commands.Moderation.QuickActions.triggersSelected)}: **${triggerLabels}**. ${t(LanguageKeys.Commands.Moderation.QuickActions.clickContinue)}`,
            ),
          ),
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }

  private async handleSelectSub(interaction: Interaction, sessionId: string) {
    if (!interaction.isStringSelectMenu()) return;
    const session = await getComponentSession(
      QA_WIZARD_FEATURE,
      sessionId,
      WizardSessionSchema,
    );
    if (!session) return replyInteractionExpired(interaction);
    if (interaction.user.id !== session.userId)
      return replyWrongTarget(interaction);

    const subTypeResult = SubActionTypeSchema.safeParse(interaction.values[0]);
    if (!subTypeResult.success) return replyInteractionExpired(interaction);
    const subType: SubActionType = subTypeResult.data;

    const t = await fetchT(interaction);
    const modal = this.buildSubactionModal(sessionId, subType, t);
    await interaction.showModal(modal);
  }

  private buildSubactionModal(
    sessionId: string,
    type: SubActionType,
    t: (key: string) => string,
  ): ModalBuilder {
    const label = t(SUBACTION_TYPE_KEYS[type] ?? type);
    const modal = new ModalBuilder()
      .setCustomId(`qa-sub-modal:${sessionId}:${type}`)
      .setTitle(
        `${t(LanguageKeys.Commands.Moderation.QuickActions.configureSubaction)}: ${label}`,
      );

    switch (type) {
      case "warn":
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("warnAmount")
              .setLabel(
                t(
                  LanguageKeys.Commands.Moderation.QuickActions.warnAmountLabel,
                ),
              )
              .setPlaceholder("1")
              .setStyle(TextInputStyle.Short)
              .setMinLength(1)
              .setMaxLength(2)
              .setRequired(true),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("warnReason")
              .setLabel(
                t(LanguageKeys.Commands.Moderation.QuickActions.reasonLabel),
              )
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
        );
        break;
      case "mute":
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("muteDuration")
              .setLabel(
                t(LanguageKeys.Commands.Moderation.QuickActions.durationLabel),
              )
              .setPlaceholder("10m")
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
        );
        break;
      case "addRole":
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("roleId")
              .setLabel(
                t(LanguageKeys.Commands.Moderation.QuickActions.roleIdLabel),
              )
              .setPlaceholder("123456789012345678")
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
        );
        break;
      case "sendDm":
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("dmMessage")
              .setLabel(
                t(LanguageKeys.Commands.Moderation.QuickActions.messageLabel),
              )
              .setStyle(TextInputStyle.Paragraph)
              .setMinLength(1)
              .setMaxLength(2000)
              .setRequired(true),
          ),
        );
        break;
      case "kick":
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("kickReason")
              .setLabel(
                t(LanguageKeys.Commands.Moderation.QuickActions.reasonLabel),
              )
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
        );
        break;
      case "ban":
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("banReason")
              .setLabel(
                t(LanguageKeys.Commands.Moderation.QuickActions.reasonLabel),
              )
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("banDuration")
              .setLabel(
                t(LanguageKeys.Commands.Moderation.QuickActions.durationLabel),
              )
              .setPlaceholder("7d")
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
        );
        break;
    }

    return modal;
  }
}
