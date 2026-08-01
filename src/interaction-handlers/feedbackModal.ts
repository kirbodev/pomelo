import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import { MessageFlags, type Interaction } from "discord.js";
import {
  parseComponentId,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";
import {
  FEEDBACK_FEATURE,
  isFeedbackType,
  submitFeedback,
  type FeedbackType,
} from "../lib/helpers/feedback.js";

/**
 * Persistent modal-submit handler for /feedback. All context (submitter and
 * feedback type) travels in the modal's custom ID, so submissions survive
 * restarts.
 */
export class FeedbackModalHandler extends InteractionHandler {
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
    const parts = parseComponentId(FEEDBACK_FEATURE, interaction.customId);
    if (
      !parts ||
      parts.length !== 3 ||
      parts[1] !== "modal" ||
      !isFeedbackType(parts[2])
    )
      return this.none();
    return this.some({ userId: parts[0], type: parts[2] });
  }

  public override async run(
    interaction: Interaction,
    parsed: { userId: string; type: FeedbackType },
  ): Promise<void> {
    if (!interaction.isModalSubmit()) return;
    if (interaction.user.id !== parsed.userId)
      return replyWrongTarget(interaction);

    const title = interaction.fields.getTextInputValue("title");
    const description = interaction.fields.getTextInputValue("description");

    await interaction.deferReply({
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    const t = await fetchT(interaction);
    await submitFeedback(interaction, parsed.type, title, description, t);

    // The modal came from the message-command button flow; retire the
    // choice buttons now that feedback has been sent.
    if (interaction.isFromMessage())
      void this.container.utilities.componentUtils.disableButtons(
        interaction.message,
      );
  }
}
