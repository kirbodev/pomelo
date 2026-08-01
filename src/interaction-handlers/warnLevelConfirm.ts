import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT, type TFunction } from "@sapphire/plugin-i18next";
import {
  ContainerBuilder,
  TextDisplayBuilder,
  type Interaction,
} from "discord.js";
import { Colors } from "../lib/colors.js";
import {
  claimComponentSession,
  getComponentSession,
  parseComponentId,
  replyInteractionExpired,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { modActionService } from "../lib/moderation/actions.js";
import {
  WARN_LEVEL_FEATURE,
  WarnLevelSession,
  punishmentResultLine,
} from "../lib/moderation/levelConfirm.js";
import type { WarnLevel } from "../lib/moderation/types.js";

type WarnLevelAction = "confirm" | "cancel";

/**
 * Persistent confirmation buttons for manually-confirmed warn levels. The
 * pending punishment lives in Redis and is claimed atomically on the first
 * decision, so the dialog survives restarts and can't be replayed.
 */
export class WarnLevelConfirmHandler extends InteractionHandler {
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
    const parts = parseComponentId(WARN_LEVEL_FEATURE, interaction.customId);
    if (
      !parts ||
      parts.length !== 2 ||
      (parts[1] !== "confirm" && parts[1] !== "cancel")
    )
      return this.none();
    return this.some({
      sessionId: parts[0],
      action: parts[1] as WarnLevelAction,
    });
  }

  public override async run(
    interaction: Interaction,
    parsed: { sessionId: string; action: WarnLevelAction },
  ): Promise<void> {
    if (!interaction.isButton()) return;
    const guild = interaction.guild;
    if (!guild) return replyInteractionExpired(interaction);

    const session = await getComponentSession(
      WARN_LEVEL_FEATURE,
      parsed.sessionId,
      WarnLevelSession,
    );
    if (
      !session ||
      session.guildId !== guild.id ||
      session.messageId !== interaction.message.id
    )
      return replyInteractionExpired(interaction);

    // Only the moderator who issued the warn may decide.
    if (interaction.user.id !== session.moderatorId)
      return replyWrongTarget(interaction);

    const t = await fetchT(interaction);
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;

    if (parsed.action === "cancel") {
      const claimed = await claimComponentSession(
        WARN_LEVEL_FEATURE,
        parsed.sessionId,
        WarnLevelSession,
      );
      if (!claimed) return replyInteractionExpired(interaction);
      await interaction.update({
        components: [
          this.dialogContainer(
            claimed.level.warnCount,
            t(key.confirmLevelDeclined),
            t,
          ),
        ],
      });
      return;
    }

    // Re-resolve everything server-side before acting; the custom ID is
    // routing, not authorization.
    const moderator = await guild.members
      .fetch(session.moderatorId)
      .catch(() => null);
    const target = await guild.members
      .fetch(session.targetId)
      .catch(() => null);
    if (!moderator || !target) return replyInteractionExpired(interaction);

    const claimed = await claimComponentSession(
      WARN_LEVEL_FEATURE,
      parsed.sessionId,
      WarnLevelSession,
    );
    if (!claimed) return replyInteractionExpired(interaction);

    await interaction.deferUpdate();
    const exec = await modActionService.executeLevel(
      guild,
      moderator,
      target,
      claimed.level as WarnLevel,
      claimed.reason,
    );

    const lines = exec.results.map((result) =>
      punishmentResultLine(result, t),
    );
    await interaction
      .editReply({
        components: [
          this.dialogContainer(
            claimed.level.warnCount,
            lines.join("\n") || t(key.none),
            t,
          ),
        ],
      })
      .catch(() => null);
  }

  private dialogContainer(
    level: number,
    body: string,
    t: TFunction,
  ): ContainerBuilder {
    const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
    return new ContainerBuilder()
      .setAccentColor(Colors.Warning)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "### " + t(key.confirmLevelTitle, { level }) + "\n" + body,
        ),
      );
  }
}
