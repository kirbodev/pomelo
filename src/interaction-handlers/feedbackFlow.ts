import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import type { Interaction } from "discord.js";
import {
  parseComponentId,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";
import {
  FEEDBACK_FEATURE,
  buildFeedbackModal,
  isFeedbackType,
  type FeedbackType,
} from "../lib/helpers/feedback.js";

/**
 * Persistent bug/feature choice buttons for the message version of
 * /feedback. The invoking user's ID travels in the custom ID; the button
 * opens the feedback modal handled by the feedbackModal handler.
 */
export class FeedbackFlowHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.Button,
    });
  }

  public override parse(interaction: Interaction) {
    if (!interaction.isButton()) return this.none();
    const parts = parseComponentId(FEEDBACK_FEATURE, interaction.customId);
    if (!parts || parts.length !== 2 || !isFeedbackType(parts[1]))
      return this.none();
    return this.some({ userId: parts[0], type: parts[1] });
  }

  public override async run(
    interaction: Interaction,
    parsed: { userId: string; type: FeedbackType },
  ): Promise<void> {
    if (!interaction.isButton()) return;
    if (interaction.user.id !== parsed.userId)
      return replyWrongTarget(interaction);

    const t = await fetchT(interaction);
    await interaction.showModal(
      buildFeedbackModal(t, interaction.user.id, parsed.type),
    );
  }
}
