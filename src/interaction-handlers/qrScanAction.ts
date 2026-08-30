import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import {
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type Interaction,
} from "discord.js";
import {
  parseComponentId,
  replyInteractionExpired,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";

export const QR_SCAN_FEATURE = "qrscan";

export class QrScanActionHandler extends InteractionHandler {
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
    const parts = parseComponentId(QR_SCAN_FEATURE, interaction.customId);
    if (!parts || parts.length < 2 || parts[0] !== "delete") return this.none();
    return this.some({ targetMessageId: parts[1] });
  }

  public override async run(
    interaction: Interaction,
    parsed: { targetMessageId: string },
  ): Promise<void> {
    if (!interaction.isMessageComponent()) return;
    if (!interaction.guildId) return replyInteractionExpired(interaction);
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages))
      return replyWrongTarget(interaction);

    try {
      const channel = interaction.channel;
      if (!channel) return replyInteractionExpired(interaction);

      const targetMessage = await channel.messages
        .fetch(parsed.targetMessageId)
        .catch(() => null);
      if (targetMessage) {
        await targetMessage.delete();
      }

      const disabledRows = interaction.message.components.map((row) => {
        const rowData =
          row.toJSON() as APIActionRowComponent<APIComponentInMessageActionRow>;
        return {
          ...rowData,
          components: rowData.components.map((component) =>
            "custom_id" in component &&
            component.custom_id === interaction.customId
              ? { ...component, disabled: true }
              : component,
          ),
        };
      });

      await interaction.update({ components: disabledRows });
    } catch (error) {
      this.container.logger.error(
        "[QRScanner] Failed to delete message via button: %s",
        error,
      );
      await replyInteractionExpired(interaction);
    }
  }
}
