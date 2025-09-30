import changelog from "../../changelog.js";

import { Command } from "@sapphire/framework";
import { applyLocalizedBuilder } from "@sapphire/plugin-i18next";
import { Message, MessageFlags, PermissionFlagsBits } from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils from "../../utilities/commandUtils.js";
import ComponentUtils from "../../utilities/componentUtils.js";
import EmbedUtils from "../../utilities/embedUtils.js";

export class ChangelogCommand extends CommandUtils.PomeloCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Show the bot's changelog.",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      detailedDescription: {
        examples: [""],
        syntax: "",
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) => {
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Utility.Changelog.commandName,
        LanguageKeys.Commands.Utility.Changelog.commandDescription,
      )
        .setName(this.name)
        .setDescription(this.description);
    });
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
    await this.execute(interaction);
  }

  public override async messageRun(message: Message) {
    await this.execute(message);
  }

  private async execute(
    interaction: Command.ChatInputCommandInteraction | Message,
  ) {
    const embeds = changelog.map((entry) => {
      const changes = entry.changes.map((change) => `- ${change}`);
      return new EmbedUtils.EmbedConstructor()
        .setTitle(`v${entry.version}`)
        .setTimestamp(new Date(entry.date))
        .setDescription(changes.join("\n"));
    });

    const paginated = new ComponentUtils.PomeloPaginatedMessage().addPages(
      embeds.map((e) => {
        return {
          embeds: [e],
        };
      }),
    );

    await paginated.run(interaction);
  }
}
