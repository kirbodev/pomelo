import type { Command } from "@sapphire/framework";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import {
  ApplicationCommandType,
  GuildMember,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  UserContextMenuCommandInteraction,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import {
  applyLocalizedBuilder,
  applyNameLocalizedBuilder,
  fetchT,
} from "@sapphire/plugin-i18next";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { deleteAFKData, getAFKData } from "../../lib/helpers/afk.js";
import { ApplicationIntegrationType } from "discord.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { Colors } from "../../lib/colors.js";
import ms from "ms";

export class AfkRemoveCommand extends CommandUtils.PomeloCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Remove a user's afk status",
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
        LanguageKeys.Commands.Utility.Afkremove.contextName
      ).setType(ApplicationCommandType.User);
    });

    const userLocs = getOptionLocalizations(
      LanguageKeys.Commands.Utility.Afkremove.userFieldName,
      LanguageKeys.Commands.Utility.Afkremove.userFieldDescription
    );

    registry.registerChatInputCommand((builder) => {
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Utility.Afkremove.commandName,
        LanguageKeys.Commands.Utility.Afkremove.commandDescription
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
    const t = await fetchT(interaction);
    const user =
      interaction instanceof Message ? interaction.author : interaction.user;

    const afkData = await getAFKData(userId);
    if (!afkData) {
      void this.error(interaction, this, {
        error: "NotAFK",
      });
      return;
    }

    let embedDesc: string;
    if (user.id !== userId) {
      if (!interaction.guild) {
        void this.error(interaction, this, {
          error: "NotInGuild",
        });
        return;
      }

      const member =
        interaction.member instanceof GuildMember ? interaction.member : null;
      if (!member) {
        void this.error(interaction, this, {
          error: "GenericError",
          message: "Your member object was not found",
        });
        return;
      }

      if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        void this.error(interaction, this, {
          error: "MissingPermission",
          context: {
            permission:
              this.container.utilities.commandUtils.getPermissionNames(
                new PermissionsBitField(PermissionFlagsBits.ManageMessages)
              ),
          },
        });
        return;
      }

      embedDesc = t(LanguageKeys.Commands.Utility.Afkremove.desc, {
        user: `<@${userId}>`,
      });
    } else {
      embedDesc = t(LanguageKeys.Commands.Utility.Afk.removeDescription, {
        time: ms(Date.now() - new Date(afkData.startedAt).getTime()),
      });
    }

    await deleteAFKData(userId);

    const autoAFK = await this.container.redis.jsonGet(`${userId}AUTO`, "Afk");
    if (autoAFK) {
      embedDesc += `\n${t(
        LanguageKeys.Commands.Utility.Afkremove.autoStatusNote
      )}`;
    }

    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(t(LanguageKeys.Commands.Utility.Afk.removeTitle))
      .setDescription(embedDesc)
      .setColor(Colors.Success);

    return await this.reply(
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
