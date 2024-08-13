import { AllFlowsPrecondition, Precondition } from "@sapphire/framework";
import type {
  ChatInputCommandInteraction,
  ContextMenuCommandInteraction,
  Message,
} from "discord.js";

export class AnalyticsPrecondition extends AllFlowsPrecondition {
  constructor(context: Precondition.LoaderContext) {
    super(context, {
      //   enabled: !process.env.DEV,
      position: 30,
    });
  }

  public override async messageRun(interaction: Message) {
    const name = await this.container.utilities.commandUtils.getCommandName(
      interaction
    );
    if (!name) return this.ok();
    return this.execute({
      name,
      type: "message",
      user: interaction.author.id,
      guild: interaction.guild?.id,
    });
  }

  public override chatInputRun(interaction: ChatInputCommandInteraction) {
    return this.execute({
      name: interaction.commandName,
      type: "chatInput",
      user: interaction.user.id,
      guild: interaction.guild?.id,
    });
  }

  public override contextMenuRun(interaction: ContextMenuCommandInteraction) {
    return this.execute({
      name: interaction.commandName,
      type: "contextMenu",
      user: interaction.user.id,
      guild: interaction.guild?.id,
    });
  }

  private execute(options: {
    name: string;
    type: "chatInput" | "contextMenu" | "message";
    user: string;
    guild?: string;
  }) {
    const { name, type, user, guild } = options;
    if (name)
      this.container.analytics.capture({
        distinctId: user,
        event: name,
        properties: {
          type,
          guild,
          version: this.container.version,
        },
      });
    return this.ok();
  }
}

declare module "@sapphire/framework" {
  interface Preconditions {
    SendAnalytics: never;
  }
}
