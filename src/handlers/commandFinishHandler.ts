import {
  container,
  type ChatInputCommand,
  type ChatInputCommandFinishPayload,
  type ContextMenuCommand,
  type ContextMenuCommandFinishPayload,
  type MessageCommand,
  type MessageCommandFinishPayload,
} from "@sapphire/framework";
import {
  type ChatInputCommandInteraction,
  ContextMenuCommandInteraction,
  Message,
} from "discord.js";

export default function handler(
  interaction:
    | ChatInputCommandInteraction
    | ContextMenuCommandInteraction
    | Message,
  command: ChatInputCommand | ContextMenuCommand | MessageCommand,
  payload:
    | ChatInputCommandFinishPayload
    | ContextMenuCommandFinishPayload
    | MessageCommandFinishPayload
) {
  const name = command.name;
  const userId =
    interaction instanceof Message
      ? interaction.author.id
      : interaction.user.id;
  const guildId = interaction.guildId ?? `DM-${userId}`;
  const time = payload.duration;
  const type =
    interaction instanceof Message
      ? "message"
      : interaction instanceof ContextMenuCommandInteraction
      ? "contextMenu"
      : "chatInput";

  container.analytics.capture({
    distinctId: userId,
    event: `user executed ${name} command`,
    properties: {
      command: name,
      guild: guildId,
      time,
      type: type,
    },
  });
}
