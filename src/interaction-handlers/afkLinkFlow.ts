import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
} from "discord.js";
import {
  AFK_LINK_FEATURE,
  handleCalendarSelection,
} from "../lib/helpers/calendarLink.js";
import {
  createComponentId,
  parseComponentId,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";

type AfkLinkAction = "linkid" | "select";

/**
 * Persistent components for /afklink: the "enter link code" button (opens
 * the link-code modal) and the calendar select menu. The owning user's ID
 * travels in the custom ID and is enforced on every click.
 */
export class AfkLinkFlowHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.MessageComponent,
    });
  }

  public override parse(interaction: Interaction) {
    if (!interaction.isMessageComponent()) return this.none();
    const parts = parseComponentId(AFK_LINK_FEATURE, interaction.customId);
    if (
      !parts ||
      parts.length !== 2 ||
      (parts[1] !== "linkid" && parts[1] !== "select")
    )
      return this.none();
    return this.some({ userId: parts[0], action: parts[1] as AfkLinkAction });
  }

  public override async run(
    interaction: Interaction,
    parsed: { userId: string; action: AfkLinkAction },
  ): Promise<void> {
    if (!interaction.isMessageComponent()) return;
    if (interaction.user.id !== parsed.userId)
      return replyWrongTarget(interaction);

    if (parsed.action === "linkid" && interaction.isButton()) {
      const t = await fetchT(interaction);
      const modal = new ModalBuilder()
        .setCustomId(
          createComponentId(AFK_LINK_FEATURE, interaction.user.id, "modal"),
        )
        .setTitle(t(LanguageKeys.Commands.Utility.Afklink.linkId))
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("id")
              .setLabel(t(LanguageKeys.Commands.Utility.Afklink.linkId))
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
        );
      await interaction.showModal(modal);
      return;
    }

    if (parsed.action === "select" && interaction.isStringSelectMenu()) {
      await handleCalendarSelection(interaction);
    }
  }
}
