import { Args, Command } from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import { config } from "../../config.js";
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { inspect } from "bun";
import { Colors } from "../../lib/colors.js";
import { EmbedLimits } from "@sapphire/discord-utilities";

export class UserCommand extends CommandUtils.DevCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description:
        "Evaluate raw javascript code. !!! Very dangerous, only use if you know what you are doing !!!",
      detailedDescription: {
        syntax: "<code: text>",
        examples: [
          "return 'hello world';\n> 'hello world'",
          "return 1 + 1;\n> 2",
        ],
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder //
          .setName(this.name)
          .setDescription(this.description)
          .addStringOption((option) =>
            option //
              .setName("code")
              .setDescription("The code to evaluate.")
              .setRequired(true)
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
    const code = originalInteraction.options.getString("code", true);
    await this.execute(interaction, code);
  }

  public override async verifiedMessageRun(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    args: Args
  ) {
    const code = await args.restResult("string");
    if (code.isErr()) return this.sendSyntaxError(interaction);
    await this.execute(interaction, code.unwrap());
  }

  private async execute(
    interaction:
      | Command.ChatInputCommandInteraction
      | ModalSubmitInteraction
      | ButtonInteraction,
    code: string
  ) {
    let result;
    let errored = false;
    try {
      result = inspect(eval(code), {
        depth: 5,
      });
    } catch (error) {
      errored = true;
      result = String(error);
    }
    result = result.replaceAll("`", "\\`");
    result =
      result.length > EmbedLimits.MaximumDescriptionLength - 9
        ? result.slice(0, EmbedLimits.MaximumDescriptionLength - 12) + "..."
        : result;
    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle("Eval")
      .setDescription(`\`\`\`js\n${result}\`\`\``)
      .setColor(errored ? Colors.Error : Colors.Success)
      .setTimestamp();
    await this.reply(
      interaction,
      {
        embeds: [embed],
      },
      {
        type: PomeloReplyType.Sensitive,
      }
    );
  }
}
