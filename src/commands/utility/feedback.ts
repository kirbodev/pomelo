import { Command } from "@sapphire/framework";
import {
  applyLocalizedBuilder,
  fetchT,
  getLocalizedData,
} from "@sapphire/plugin-i18next";
import type { TFunction } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ApplicationIntegrationType,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils from "../../utilities/commandUtils.js";
import { Colors } from "../../lib/colors.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import {
  FEEDBACK_FEATURE,
  buildFeedbackModal,
  type FeedbackType,
} from "../../lib/helpers/feedback.js";
import { createComponentId } from "../../lib/helpers/componentSessions.js";

function getChoiceLocalizations(key: string) {
  const raw = getLocalizedData(key);
  const names = Object.fromEntries(
    Object.entries(raw.localizations).filter(([, v]) => v !== null),
  );
  return { name: raw.value, names };
}

export class FeedbackCommand extends CommandUtils.PomeloCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Report a bug or suggest a feature to me.",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      detailedDescription: {
        examples: ["bug", "feature"],
        syntax: "[bug|feature]",
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const typeLocs = getOptionLocalizations(
      LanguageKeys.Commands.Utility.Feedback.typeFieldName,
      LanguageKeys.Commands.Utility.Feedback.typeFieldDescription,
    );
    const bugLocs = getChoiceLocalizations(
      LanguageKeys.Commands.Utility.Feedback.typeBug,
    );
    const featureLocs = getChoiceLocalizations(
      LanguageKeys.Commands.Utility.Feedback.typeFeature,
    );

    registry.registerChatInputCommand((builder) =>
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Utility.Feedback.commandName,
        LanguageKeys.Commands.Utility.Feedback.commandDescription,
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([
          ApplicationIntegrationType.GuildInstall,
          ApplicationIntegrationType.UserInstall,
        ])
        .addStringOption((option) =>
          option
            .setName(typeLocs.englishName)
            .setNameLocalizations(typeLocs.names)
            .setDescription(typeLocs.englishDescription)
            .setDescriptionLocalizations(typeLocs.descriptions)
            .setRequired(true)
            .setChoices(
              {
                name: bugLocs.name,
                name_localizations: bugLocs.names,
                value: "bug",
              },
              {
                name: featureLocs.name,
                name_localizations: featureLocs.names,
                value: "feature",
              },
            ),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const type = interaction.options.getString("type", true) as FeedbackType;
    const t = await fetchT(interaction);
    // Submission is handled by the persistent feedbackModal interaction
    // handler; the type travels in the modal's custom ID.
    await interaction.showModal(
      buildFeedbackModal(t, interaction.user.id, type),
    );
  }

  public override async messageRun(message: Message) {
    const t = await fetchT(message);

    // The bug/feature buttons are persistent and routed through the
    // feedbackFlow interaction handler, so no collector is needed here.
    await message.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [this.buildChooseContainer(t, message.author.id)],
    });
  }

  private buildChooseContainer(t: TFunction, userId: string): ContainerBuilder {
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(createComponentId(FEEDBACK_FEATURE, userId, "bug"))
        .setLabel(t(LanguageKeys.Commands.Utility.Feedback.bugButton))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(createComponentId(FEEDBACK_FEATURE, userId, "feature"))
        .setLabel(t(LanguageKeys.Commands.Utility.Feedback.featureButton))
        .setStyle(ButtonStyle.Primary),
    );

    return new ContainerBuilder()
      .setAccentColor(Colors.Default)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ${t(LanguageKeys.Commands.Utility.Feedback.chooseTitle)}\n${t(LanguageKeys.Commands.Utility.Feedback.chooseDescription)}`,
        ),
      )
      .addActionRowComponents(buttons);
  }
}
