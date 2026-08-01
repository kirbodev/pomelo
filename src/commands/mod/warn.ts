import { Args, Command } from "@sapphire/framework";
import { applyLocalizedBuilder } from "@sapphire/plugin-i18next";
import {
  ApplicationIntegrationType,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  GuildMember,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils from "../../utilities/commandUtils.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { modActionService } from "../../lib/moderation/actions.js";
import { handleWarnResult } from "../../lib/moderation/warnReply.js";
import { Colors } from "../../lib/colors.js";
import { fetchT } from "@sapphire/plugin-i18next";
import EmbedUtils from "../../utilities/embedUtils.js";
import { PomeloReplyType } from "../../utilities/commandUtils.js";

export class WarnCommand extends CommandUtils.ModCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Warn a user.",
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
    const amountLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Warn.amountFieldName,
      LanguageKeys.Commands.Moderation.Warn.amountFieldDescription,
    );

    registry.registerChatInputCommand((builder) =>
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Moderation.Warn.commandName,
        LanguageKeys.Commands.Moderation.Warn.commandDescription,
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .addUserOption((option) =>
          option.setName(userLocs.englishName).setNameLocalizations(userLocs.names).setDescription(userLocs.englishDescription).setDescriptionLocalizations(userLocs.descriptions).setRequired(true),
        )
        .addStringOption((option) =>
          option.setName(reasonLocs.englishName).setNameLocalizations(reasonLocs.names).setDescription(reasonLocs.englishDescription).setDescriptionLocalizations(reasonLocs.descriptions).setRequired(false),
        )
        .addIntegerOption((option) =>
          option.setName(amountLocs.englishName).setNameLocalizations(amountLocs.names).setDescription(amountLocs.englishDescription).setDescriptionLocalizations(amountLocs.descriptions).setRequired(false).setMinValue(1).setMaxValue(10),
        ),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason");
    const amount = interaction.options.getInteger("amount") ?? 1;
    const member = interaction.guild?.members.cache.get(user.id);

    if (!member) {
      const t = await fetchT(interaction);
      const embed = new EmbedUtils.EmbedConstructor().setColor(Colors.Error).setDescription(t(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild));
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Error });
    }

    const moderator = interaction.member instanceof GuildMember ? interaction.member : null;
    if (!moderator || !interaction.guild || !member) return;
    const result = await modActionService.warn(interaction.guild, moderator, member, reason ?? undefined, amount);
    await handleWarnResult(this, interaction, result, member);
  }

  public override async messageRun(message: Message, _args: Args) {
    await message.reply("Use the slash command /warn.");
  }
}
