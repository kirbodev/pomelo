import {
  Events,
  Listener,
  type ChatInputCommand,
  type ChatInputCommandFinishPayload,
} from "@sapphire/framework";
import type { ChatInputCommandInteraction } from "discord.js";
import handler from "../../handlers/commandFinishHandler.js";

export class ChatInputCommandFinish extends Listener<
  typeof Events.ChatInputCommandFinish
> {
  public override run(
    interaction: ChatInputCommandInteraction,
    command: ChatInputCommand,
    payload: ChatInputCommandFinishPayload
  ) {
    handler(interaction, command, payload);
  }
}
