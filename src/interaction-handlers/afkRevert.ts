import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import { MessageFlags, type Interaction } from "discord.js";
import { z } from "zod";
import { Afk } from "../db/redis/schema.js";
import { getAFKSetEmbed } from "../lib/helpers/afk.js";
import {
  claimComponentSession,
  getComponentSession,
  parseComponentId,
  replyInteractionExpired,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";
import { AFK_REVERT_FEATURE } from "../listeners/afk/removeAFK.js";
import { PomeloReplyType } from "../utilities/commandUtils.js";

const AfkRevertSession = z.object({
  userId: z.string(),
  afk: Afk,
});

/**
 * Persistent "undo AFK removal" button. The removed AFK state is stored in
 * Redis; the session is claimed atomically so the revert can't be replayed.
 */
export class AfkRevertHandler extends InteractionHandler {
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
    const parts = parseComponentId(AFK_REVERT_FEATURE, interaction.customId);
    if (!parts || parts.length !== 1) return this.none();
    return this.some({ sessionId: parts[0] });
  }

  public override async run(
    interaction: Interaction,
    parsed: { sessionId: string },
  ): Promise<void> {
    if (!interaction.isButton()) return;
    const session = await getComponentSession(
      AFK_REVERT_FEATURE,
      parsed.sessionId,
      AfkRevertSession,
    );
    if (!session) return replyInteractionExpired(interaction);
    if (interaction.user.id !== session.userId)
      return replyWrongTarget(interaction);

    const claimed = await claimComponentSession(
      AFK_REVERT_FEATURE,
      parsed.sessionId,
      AfkRevertSession,
    );
    if (!claimed) return replyInteractionExpired(interaction);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await fetchT(interaction);

    await this.container.redis.jsonSet(interaction.user.id, "Afk", claimed.afk);

    const duration = claimed.afk.endsAt
      ? new Date(claimed.afk.endsAt).getTime() - Date.now()
      : undefined;
    const embed = getAFKSetEmbed(
      t,
      claimed.afk.text,
      duration,
      claimed.afk.attachment,
    );

    await this.container.utilities.commandUtils.reply(
      interaction,
      { embeds: [embed] },
      { type: PomeloReplyType.Sensitive },
    );
    void this.container.utilities.componentUtils.disableButtons(
      interaction.message,
    );
  }
}
