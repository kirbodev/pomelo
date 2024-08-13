import {
  Events,
  Listener,
  type MessageCommand,
  type MessageCommandFinishPayload,
} from "@sapphire/framework";
import type { Message } from "discord.js";
import handler from "../../handlers/commandFinishHandler.js";

export class MessageCommandFinish extends Listener<
  typeof Events.MessageCommandFinish
> {
  public override run(
    interaction: Message,
    command: MessageCommand,
    payload: MessageCommandFinishPayload
  ) {
    handler(interaction, command, payload);
  }
}
