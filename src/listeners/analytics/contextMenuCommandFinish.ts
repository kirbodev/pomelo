import {
  Events,
  Listener,
  type ContextMenuCommand,
  type ContextMenuCommandFinishPayload,
} from "@sapphire/framework";
import type { ContextMenuCommandInteraction } from "discord.js";
import handler from "../../handlers/commandFinishHandler.js";

export class ContextMenuCommandFinish extends Listener<
  typeof Events.ContextMenuCommandFinish
> {
  public override run(
    interaction: ContextMenuCommandInteraction,
    command: ContextMenuCommand,
    payload: ContextMenuCommandFinishPayload
  ) {
    handler(interaction, command, payload);
  }
}
