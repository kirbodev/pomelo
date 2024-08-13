import { Args, Command } from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import { config, maintainanceMode } from "../../config.js";
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import CommandUtils from "../../utilities/commandUtils.js";

export class UserCommand extends CommandUtils.DevCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description:
        "Sets maintenance mode on or off. Optionally provide a message.",
      detailedDescription: {
        syntax: "<on: true/false> [reason: text]",
        examples: ["false", "true Emergency maintenance"],
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder //
          .setName(this.name)
          .setDescription(this.description)
          .addBooleanOption((option) =>
            option //
              .setName("on")
              .setDescription("Whether to turn maintainance mode on.")
              .setRequired(true)
          )
          .addStringOption((option) =>
            option //
              .setName("reason")
              .setDescription("The reason for turning maintainance mode on.")
          ),
      {
        guildIds: config.testServers,
      }
    );
  }

  public override async verifiedChatInputRun(
    interaction: Command.ChatInputCommandInteraction | ModalSubmitInteraction,
    originalInteraction: ChatInputCommandInteraction
  ) {
    const on = originalInteraction.options.getBoolean("on", true);
    const reason = originalInteraction.options.getString("reason");
    await this.execute(interaction, on, reason ?? undefined);
  }

  public override async verifiedMessageRun(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    args: Args
  ) {
    const on = await args.pickResult("boolean");
    if (on.isErr()) {
      await this.sendSyntaxError(interaction);
      return;
    }
    const reason = await args.restResult("string");
    await this.execute(interaction, on.unwrap(), reason.unwrapOr(undefined));
  }

  private async execute(
    interaction:
      | Command.ChatInputCommandInteraction
      | ModalSubmitInteraction
      | ButtonInteraction,
    on: boolean,
    reason?: string
  ) {
    maintainanceMode.set(on, reason);
    await interaction.reply({
      embeds: [
        new EmbedUtils.EmbedConstructor() //
          .setTitle("Maintainance Mode")
          .setDescription(
            `Maintainance mode is now ${on ? "on" : "off"}${
              reason ? ` with reason: ${reason}` : ""
            }.`
          ),
      ],
      ephemeral: true,
    });
  }
}
