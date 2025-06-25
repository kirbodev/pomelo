import { Listener } from "@sapphire/framework";
import { Events } from "@sapphire/framework";
import type { Message } from "discord.js";

export class ReadyListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options
  ) {
    super(context, {
      ...options,
      event: Events.MessageCreate,
    });
  }

  public async run(message: Message) {
    if (message.author.bot) return;
    if (!message.guild) return;
  }
}
