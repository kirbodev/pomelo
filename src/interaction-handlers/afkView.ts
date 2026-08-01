import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import { MessageFlags, type Interaction } from "discord.js";
import { z } from "zod";
import type { Afk } from "../db/redis/schema.js";
import {
  AFK_VIEW_FEATURE,
  getAFKData,
} from "../lib/helpers/afk.js";
import {
  getComponentSession,
  parseComponentId,
  replyInteractionExpired,
} from "../lib/helpers/componentSessions.js";
import { createPages } from "../listeners/afk/lookForMentions.js";
import ComponentUtils from "../utilities/componentUtils.js";

const AfkViewSession = z.object({
  userIds: z.array(z.string()).min(1),
});

/**
 * Persistent "view AFK details" button attached to the AFK summary embed.
 * The session only stores the mentioned user IDs; the AFK data itself is
 * re-fetched on click so the details are always current.
 */
export class AfkViewHandler extends InteractionHandler {
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
    const parts = parseComponentId(AFK_VIEW_FEATURE, interaction.customId);
    if (!parts || parts.length !== 1) return this.none();
    return this.some({ sessionId: parts[0] });
  }

  public override async run(
    interaction: Interaction,
    parsed: { sessionId: string },
  ): Promise<void> {
    if (!interaction.isButton()) return;
    const session = await getComponentSession(
      AFK_VIEW_FEATURE,
      parsed.sessionId,
      AfkViewSession,
    );
    if (!session) return replyInteractionExpired(interaction);

    const afks = new Map<string, Afk>();
    for (const userId of session.userIds) {
      const afk = await getAFKData(userId);
      if (afk) afks.set(userId, afk);
    }
    if (afks.size === 0) return replyInteractionExpired(interaction);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await fetchT(interaction);

    const pages = await createPages(t, afks);
    if (pages.length === 1) {
      await interaction.editReply(pages[0]);
      return;
    }

    const paginate = new ComponentUtils.MenuPaginatedMessage();
    pages.forEach((page) => paginate.addPageBuilder(page));
    await paginate.run(interaction).catch(() => null);
  }
}
