import { container } from "@sapphire/framework";
import type { TFunction } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
  WebhookClient,
  type ModalSubmitInteraction,
} from "discord.js";
import { Colors } from "../colors.js";
import { config } from "../../config.js";
import { LanguageKeys } from "../i18n/languageKeys.js";
import { PomeloReplyType } from "../../utilities/commandUtils.js";
import { createComponentId } from "./componentSessions.js";

export const FEEDBACK_FEATURE = "fb";

export type FeedbackType = "bug" | "feature";

export function isFeedbackType(value: string): value is FeedbackType {
  return value === "bug" || value === "feature";
}

export function buildFeedbackModal(
  t: TFunction,
  userId: string,
  type: FeedbackType,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(createComponentId(FEEDBACK_FEATURE, userId, "modal", type))
    .setTitle(t(LanguageKeys.Commands.Utility.Feedback.modalTitle))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("title")
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
          .setCustomId("description")
          .setLabel(t(LanguageKeys.Commands.Utility.Feedback.descriptionLabel))
          .setPlaceholder(
            t(LanguageKeys.Commands.Utility.Feedback.descriptionPlaceholder),
          )
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true),
      ),
    );
}

function buildReportContainer(
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

async function deliverReport(
  interaction: ModalSubmitInteraction,
  report: ContainerBuilder,
): Promise<boolean> {
  const webhookUrl = process.env.FEEDBACK_WEBHOOK_URL;
  if (webhookUrl) {
    const sent = await new WebhookClient({ url: webhookUrl })
      .send({
        flags: MessageFlags.IsComponentsV2,
        components: [report],
      })
      .then(() => true)
      .catch((e: unknown) => {
        container.logger.warn("Failed to send feedback webhook", e);
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
        components: [report],
      })
      .then(() => true)
      .catch(() => false);
    if (sent) deliveredToOwner = true;
  }

  return deliveredToOwner;
}

export async function submitFeedback(
  interaction: ModalSubmitInteraction,
  type: FeedbackType,
  title: string,
  description: string,
  t: TFunction,
): Promise<void> {
  const user = interaction.user;
  const guild = interaction.guild
    ? { name: interaction.guild.name, id: interaction.guild.id }
    : null;

  const report = buildReportContainer(
    type,
    title,
    description,
    t,
    { tag: user.tag, id: user.id, avatarUrl: user.displayAvatarURL() },
    guild,
  );

  const delivered = await deliverReport(interaction, report);

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

    await container.utilities.commandUtils.reply(
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

  await container.utilities.commandUtils.reply(
    interaction,
    { components: [successContainer] },
    { type: PomeloReplyType.Success },
  );
}
