import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import type { Interaction } from "discord.js";
import {
  AFK_LINK_FEATURE,
  completeAccountLink,
} from "../lib/helpers/calendarLink.js";
import {
  parseComponentId,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";

/**
 * Persistent modal-submit handler for the /afklink link-code modal. The
 * submitted code is validated against the OAuth tables on every submit, so
 * no in-memory state is required.
 */
export class AfkLinkModalHandler extends InteractionHandler {
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
    const parts = parseComponentId(AFK_LINK_FEATURE, interaction.customId);
    if (!parts || parts.length !== 2 || parts[1] !== "modal")
      return this.none();
    return this.some({ userId: parts[0] });
  }

  public override async run(
    interaction: Interaction,
    parsed: { userId: string },
  ): Promise<void> {
    if (!interaction.isModalSubmit()) return;
    if (interaction.user.id !== parsed.userId)
      return replyWrongTarget(interaction);

    const linkCode = interaction.fields.getTextInputValue("id");
    await completeAccountLink(interaction, linkCode);
  }
}
