import { Command } from "@sapphire/framework";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import {
  ApplicationIntegrationType,
  MessageFlags,
  PermissionFlagsBits,
  GuildMember,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { modActionService } from "../../lib/moderation/actions.js";
import { handleWarnResult } from "../../lib/moderation/warnReply.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { Colors } from "../../lib/colors.js";

export class HeavywarnCommand extends CommandUtils.ModCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Issue a heavy warn (2 warn counts).",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      requiredUserPermissions: [PermissionFlagsBits.ModerateMembers],
      preconditions: ["GuildOnly"],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const userLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Warn.userFieldName,
      LanguageKeys.Commands.Moderation.Warn.userFieldDescription,
    );
    const reasonLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Warn.reasonFieldName,
      LanguageKeys.Commands.Moderation.Warn.reasonFieldDescription,
    );

    registry.registerChatInputCommand((builder) =>
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Moderation.Warn.heavywarnCommandName,
        LanguageKeys.Commands.Moderation.Warn.heavywarnCommandDescription,
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .addUserOption((option) =>
          option
            .setName(userLocs.englishName)
            .setNameLocalizations(userLocs.names)
            .setDescription(userLocs.englishDescription)
            .setDescriptionLocalizations(userLocs.descriptions)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName(reasonLocs.englishName)
            .setNameLocalizations(reasonLocs.names)
            .setDescription(reasonLocs.englishDescription)
            .setDescriptionLocalizations(reasonLocs.descriptions)
            .setRequired(false),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    if (!guild) return;

    const member = guild.members.cache.get(user.id);
    if (!member) {
      const t = await fetchT(interaction);
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Error)
        .setDescription(
          t(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild),
        );
      return this.reply(
        interaction,
        { embeds: [embed] },
        { type: PomeloReplyType.Error },
      );
    }

    const moderator =
      interaction.member instanceof GuildMember ? interaction.member : null;
    if (!moderator) return;

    const result = await modActionService.warn(
      guild,
      moderator,
      member,
      reason ?? undefined,
      2,
    );

    await handleWarnResult(this, interaction, result, member);
  }
}
