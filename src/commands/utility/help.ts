import {
  Args,
  Command,
  type DetailedDescriptionCommandObject,
} from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import {
  applyLocalizedBuilder,
  fetchT,
  i18next,
} from "@sapphire/plugin-i18next";
import { Message, PermissionFlagsBits } from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils from "../../utilities/commandUtils.js";
import ComponentUtils from "../../utilities/componentUtils.js";
import { Colors } from "../../lib/colors.js";

export class UserCommand extends CommandUtils.PomeloCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Get help for a command or a list of commands.",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      detailedDescription: {
        examples: ["", "settings"],
        syntax: "[command]",
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) => {
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Utility.Help.commandName,
        LanguageKeys.Commands.Utility.Help.commandDescription
      )
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("The command to get help for.")
            .setRequired(false)
            .setChoices(
              this.getCommands().map((command) => {
                return {
                  name: command.name,
                  value: command.name,
                };
              })
            )
        );
    });
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const commandName = interaction.options.getString("command");
    await this.execute(interaction, commandName);
  }

  public override async messageRun(message: Message, args: Args) {
    const commandName = await args.pick("string").catch(() => null);
    await this.execute(message, commandName);
  }

  private async execute(
    interaction: Command.ChatInputCommandInteraction | Message,
    commandName: string | null
  ) {
    const t = await fetchT(interaction);
    if (!interaction.member) return;
    let commands = this.getCommands();
    if (commandName)
      commands = commands.filter((command) => command.name === commandName);

    const menu = new ComponentUtils.MenuPaginatedMessage({
      template: new EmbedUtils.EmbedConstructor().setColor(Colors.Default),
    });
    for (const command of commands) {
      if (
        !this.container.utilities.commandUtils.isUserEligible(
          interaction.member,
          command.name
        )
      )
        continue;
      const prefix = this.container.client.options.defaultPrefix as string;
      const desc =
        command.detailedDescription as DetailedDescriptionCommandObject;
      const examples = desc.examples
        .map((ex) => `${prefix}${command.name} ${ex}`)
        .join("\n");
      const syntax = `${prefix}${command.name} ${desc.syntax}`;
      menu.addPageEmbed(
        new EmbedUtils.EmbedConstructor()
          .setTitle(
            i18next.exists(
              `commands/${command.category ?? ""}:${command.name}.commandName`
            )
              ? t(
                  `commands/${command.category ?? ""}:${
                    command.name
                  }.commandName`
                )
              : command.name
          )
          .setDescription(
            i18next.exists(
              `commands/${command.category ?? ""}:${
                command.name
              }.commandDescription`
            )
              ? t(
                  `commands/${command.category ?? ""}:${
                    command.name
                  }.commandDescription`
                )
              : command.description
          )
          .setColor(Colors.Default)
          .setFields([
            {
              name: t(LanguageKeys.Errors.SyntaxError.syntaxFieldTitle),
              value: `\`\`\`${syntax}\`\`\``,
            },
            {
              name: t(LanguageKeys.Errors.SyntaxError.exampleFieldTitle),
              value: examples,
            },
          ])
      );
    }
    await menu.run(interaction);
  }

  private getCommands() {
    const rawCommands = Array.from(this.container.stores.get("commands"));
    const commands = rawCommands.map((command) => command[1]);
    return commands;
  }
}
