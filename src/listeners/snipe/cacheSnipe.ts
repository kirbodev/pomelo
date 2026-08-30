import { Listener } from "@sapphire/framework";
import { Events, type Message } from "discord.js";
import { setSnipe, type SnipeEntry } from "../../lib/helpers/snipeStore.js";

export class CacheSnipeListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: Events.MessageDelete,
    });
  }

  public run(message: Message) {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (message.system) return;
    if (message.content.length === 0 && message.attachments.size === 0) return;

    const entry: SnipeEntry = {
      content: message.content,
      authorId: message.author.id,
      authorUsername: message.author.username,
      authorAvatarURL: message.author.displayAvatarURL(),
      attachments: message.attachments.map((attachment) => ({
        url: attachment.url,
        proxyURL: attachment.proxyURL,
        name: attachment.name,
        contentType: attachment.contentType,
      })),
      createdAt: message.createdAt,
      deletedAt: new Date(),
    };

    setSnipe(message.channelId, entry);
  }
}
