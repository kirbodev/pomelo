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
  ComponentType,
  ContainerBuilder,
  Message,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
  WebhookClient,
  type ButtonInteraction,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { Colors } from "../../lib/colors.js";
import { config } from "../../config.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { nanoid } from "nanoid";

type FeedbackType = "bug" | "feature";

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
    await this.showFeedbackModal(interaction, type, t);
  }

  public override async messageRun(message: Message) {
    const t = await fetchT(message);
    const menuId = nanoid();

    const reply = await message.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [this.buildChooseContainer(t, menuId, false)],
    });

    const buttonInteraction = await reply
      .awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) =>
          i.customId.startsWith(menuId) && i.user.id === message.author.id,
        time: 60000 * 5,
      })
      .catch(() => null);

    if (!buttonInteraction) {
      await reply
        .edit({ components: [this.buildChooseContainer(t, menuId, true)] })
        .catch(() => null);
      return;
    }

    const type: FeedbackType = buttonInteraction.customId.endsWith("-bug")
      ? "bug"
      : "feature";

    await this.showFeedbackModal(buttonInteraction, type, t);
    await reply
      .edit({ components: [this.buildChooseContainer(t, menuId, true)] })
      .catch(() => null);
  }

  private buildChooseContainer(
    t: TFunction,
    menuId: string,
    disabled: boolean,
  ): ContainerBuilder {
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${menuId}-bug`)
        .setLabel(t(LanguageKeys.Commands.Utility.Feedback.bugButton))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${menuId}-feature`)
        .setLabel(t(LanguageKeys.Commands.Utility.Feedback.featureButton))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
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

  private async showFeedbackModal(
    interaction: Command.ChatInputCommandInteraction | ButtonInteraction,
    type: FeedbackType,
    t: TFunction,
  ) {
    const menuId = nanoid();
    const modal = new ModalBuilder()
      .setCustomId(`${menuId}-modal`)
      .setTitle(t(LanguageKeys.Commands.Utility.Feedback.modalTitle))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(`${menuId}-title`)
            .setLabel(t(LanguageKeys.Commands.Utility.Feedback.titleLabel))
            .setPlaceholder(
              t(LanguageKeys.Commands.Utility.Feedback.titlePlaceholder),
            )
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(`${menuId}-description`)
            .setLabel(
              t(LanguageKeys.Commands.Utility.Feedback.descriptionLabel),
            )
            .setPlaceholder(
              t(LanguageKeys.Commands.Utility.Feedback.descriptionPlaceholder),
            )
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true),
        ),
      );

    await interaction.showModal(modal);

    const modalInteraction = await interaction
      .awaitModalSubmit({
        filter: (i) =>
          i.customId === `${menuId}-modal` && i.user.id === interaction.user.id,
        time: 60000 * 10,
      })
      .catch(() => null);

    if (!modalInteraction) return;

    const title = modalInteraction.fields.getTextInputValue(`${menuId}-title`);
    const description = modalInteraction.fields.getTextInputValue(
      `${menuId}-description`,
    );

    await modalInteraction.deferReply({
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    await this.submitFeedback(modalInteraction, type, title, description, t);
  }

  private buildReportContainer(
    type: FeedbackType,
    title: string,
    description: string,
    t: TFunction,
    user: { tag: string; id: string; avatarUrl: string },
    guild: { name: string; id: string } | null,
  ): ContainerBuilder {
    const typeLabel =
      type === "bug"
        ? t(LanguageKeys.Commands.Utility.Feedback.typeBug)
        : t(LanguageKeys.Commands.Utility.Feedback.typeFeature);

    const fromValue = guild
      ? `${guild.name} (\`${guild.id}\`)`
      : t(LanguageKeys.Commands.Utility.Feedback.directMessage);

    return new ContainerBuilder()
      .setAccentColor(type === "bug" ? Colors.Error : Colors.Info)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ${t(LanguageKeys.Commands.Utility.Feedback.reportTitle, { type: typeLabel })}\n\n**${title}**\n${description}`,
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      )
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `${t(LanguageKeys.Commands.Utility.Feedback.submittedBy)}: ${user.tag} (\`${user.id}\`)\n${t(LanguageKeys.Commands.Utility.Feedback.fromServer)}: ${fromValue}`,
            ),
          )
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.avatarUrl)),
      );
  }

  private async submitFeedback(
    interaction: ModalSubmitInteraction,
    type: FeedbackType,
    title: string,
    description: string,
    t: TFunction,
  ) {
    const user = interaction.user;
    const guild = interaction.guild
      ? { name: interaction.guild.name, id: interaction.guild.id }
      : null;

    const report = this.buildReportContainer(
      type,
      title,
      description,
      t,
      { tag: user.tag, id: user.id, avatarUrl: user.displayAvatarURL() },
      guild,
    );

    const delivered = await this.deliverReport(interaction, report);

    const typeLabel =
      type === "bug"
        ? t(LanguageKeys.Commands.Utility.Feedback.typeBug)
        : t(LanguageKeys.Commands.Utility.Feedback.typeFeature);

    if (!delivered) {
      const failContainer = new ContainerBuilder()
        .setAccentColor(Colors.Error)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## ${t(LanguageKeys.Commands.Utility.Feedback.failTitle)}\n${t(LanguageKeys.Commands.Utility.Feedback.failDesc)}`,
          ),
        );

      await this.reply(
        interaction,
        { components: [failContainer] },
        { type: PomeloReplyType.Error },
      );
      return;
    }

    const successContainer = new ContainerBuilder()
      .setAccentColor(Colors.Success)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ${t(LanguageKeys.Commands.Utility.Feedback.successTitle)}\n${t(LanguageKeys.Commands.Utility.Feedback.successDesc, { type: typeLabel })}`,
        ),
      );

    await this.reply(
      interaction,
      { components: [successContainer] },
      { type: PomeloReplyType.Success },
    );
  }

  private async deliverReport(
    interaction: ModalSubmitInteraction,
    container: ContainerBuilder,
  ): Promise<boolean> {
    const webhookUrl = process.env.FEEDBACK_WEBHOOK_URL;
    if (webhookUrl) {
      const sent = await new WebhookClient({ url: webhookUrl })
        .send({
          flags: MessageFlags.IsComponentsV2,
          components: [container],
        })
        .then(() => true)
        .catch((e: unknown) => {
          this.container.logger.warn("Failed to send feedback webhook", e);
          return false;
        });
      if (sent) return true;
    }

    let deliveredToOwner = false;
    for (const ownerId of config.owners) {
      const owner = await interaction.client.users
        .fetch(ownerId)
        .catch(() => null);
      if (!owner) continue;
      const sent = await owner
        .send({
          flags: MessageFlags.IsComponentsV2,
          components: [container],
        })
        .then(() => true)
        .catch(() => false);
      if (sent) deliveredToOwner = true;
    }

    return deliveredToOwner;
  }
}
