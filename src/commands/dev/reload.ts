import { Command } from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import { container } from "@sapphire/framework";
import { config } from "../../config.js";
import ms from "../../lib/helpers/ms.js";
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";

export class UserCommand extends CommandUtils.DevCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Reloads all internal pieces",
      detailedDescription: {
        examples: [""],
        syntax: "",
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder //
          .setName(this.name)
          .setDescription(this.description),
      {
        guildIds: config.testServers,
      }
    );
  }

  public override async verifiedChatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    await this.execute(interaction);
  }

  public override async verifiedMessageRun(
    interaction: ButtonInteraction | ModalSubmitInteraction
  ) {
    await this.execute(interaction);
  }

  private async execute(
    interaction:
      | Command.ChatInputCommandInteraction
      | ButtonInteraction
      | ModalSubmitInteraction
  ) {
    const now = performance.now();
    for (const store of container.stores.values()) {
      await store.loadAll();
    }
    const time = Math.round(performance.now() - now);
    // internationalisation is not needed for dev commands
    await this.reply(
      interaction,
      {
        embeds: [
          new EmbedUtils.EmbedConstructor() //
            .setTitle("Reloaded")
            .setDescription(`Do not rely on reloading to update utilities.
            Reloaded the following pieces in ${ms(time)}:
                - ${[...container.stores.values()]
                .map((store) => store.name)
                .join("\n- ")}`),
        ],
        ...(interaction instanceof ChatInputCommandInteraction && {
          flags: MessageFlags.Ephemeral,
        }),
      },
      {
        type: PomeloReplyType.Sensitive,
      }
    );
  }
}
