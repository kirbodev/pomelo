import type { Command } from "@sapphire/framework";
import CommandUtils from "../../utilities/commandUtils.js";
import {
  ApplicationCommandType,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  UserContextMenuCommandInteraction,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import {
  applyLocalizedBuilder,
  applyNameLocalizedBuilder,
} from "@sapphire/plugin-i18next";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { sendAFKEmbed } from "../../listeners/afk/lookForMentions.js";
import { ApplicationIntegrationType } from "discord.js";

export class AfkGetCommand extends CommandUtils.PomeloCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Get a user's afk status",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      detailedDescription: {
        examples: ["@user", ""],
        syntax: "[user]",
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerContextMenuCommand((builder) => {
      applyNameLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Utility.Afkget.contextName
      ).setType(ApplicationCommandType.User);
    });

    const userLocs = getOptionLocalizations(
      LanguageKeys.Commands.Utility.Afkget.userFieldName,
      LanguageKeys.Commands.Utility.Afkget.userFieldDescription
    );

    registry.registerChatInputCommand((builder) => {
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Utility.Afkget.commandName,
        LanguageKeys.Commands.Utility.Afkget.commandDescription
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([
          ApplicationIntegrationType.GuildInstall,
          ApplicationIntegrationType.UserInstall,
        ])
        .addUserOption((option) =>
          option
            .setName(userLocs.englishName)
            .setNameLocalizations(userLocs.names)
            .setDescription(userLocs.englishDescription)
            .setDescriptionLocalizations(userLocs.descriptions)
            .setRequired(false)
        );
    });
  }

  public override async contextMenuRun(
    interaction: UserContextMenuCommandInteraction
  ) {
    const userId = interaction.targetId;

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    return this.execute(interaction, userId);
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const userId =
      interaction.options.getUser("user")?.id ?? interaction.user.id;

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    return this.execute(interaction, userId);
  }

  private async execute(
    interaction:
      | Command.ChatInputCommandInteraction
      | UserContextMenuCommandInteraction
      | Message,
    userId: string
  ) {
    const afkData = await this.container.redis.jsonGet(userId, "Afk");
    if (!afkData || new Date(afkData.endsAt ?? 0) < new Date()) {
      void this.error(interaction, this, {
        error: "NotAFK",
      });
    } else
      return await sendAFKEmbed(
        new Map([[userId, afkData]]),
        interaction,
        false,
        false
      );
  }
}
