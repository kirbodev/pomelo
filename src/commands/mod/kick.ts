import { Args, Command } from "@sapphire/framework";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import {
  ApplicationIntegrationType,
  Message,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { modActionService } from "../../lib/moderation/actions.js";
import { Colors } from "../../lib/colors.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { buildQuickActionRow } from "../../lib/moderation/quickActionRow.js";

export class KickCommand extends CommandUtils.ModCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Kick a user from the server.",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      requiredUserPermissions: [PermissionFlagsBits.KickMembers],
      preconditions: ["GuildOnly"],
      detailedDescription: {
        syntax: "<user> [reason]",
        examples: ["@user", "@user spamming", "695228246966534255"],
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const userLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Kick.userFieldName,
      LanguageKeys.Commands.Moderation.Kick.userFieldDescription,
    );
    const reasonLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Kick.reasonFieldName,
      LanguageKeys.Commands.Moderation.Kick.reasonFieldDescription,
    );

    registry.registerChatInputCommand((builder) =>
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Moderation.Kick.commandName,
        LanguageKeys.Commands.Moderation.Kick.commandDescription,
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

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.execute(interaction, user.id, reason);
  }

  public override async messageRun(message: Message, args: Args) {
    const user = await args.pick("user");
    const reason = await args.rest("string").catch(() => null);

    await this.execute(message, user.id, reason);
  }

  private async execute(target: Command.ChatInputCommandInteraction | Message, userId: string, reason: string | null) {
    const t = await fetchT(target);
    const guild = target.guild;
    if (!guild) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      const t2 = await fetchT(target);
      const embed2 = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Error)
        .setDescription(t2(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild));
      return this.reply(target, { embeds: [embed2] }, { type: PomeloReplyType.Error });
    }

    const moderator = target.member instanceof Message ? null : (target.member as import("discord.js").GuildMember);

    if (!moderator) return;

    const result = await modActionService.kick(guild, moderator, member, reason ?? undefined);

    if (!result.success) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Error)
        .setDescription(t(LanguageKeys.Commands.Moderation.Errors.hierarchyTooLow));

      return this.reply(
        target,
        { embeds: [embed] },
        { type: PomeloReplyType.Error },
      );
    }

    const mainText = reason
      ? t(LanguageKeys.Commands.Moderation.Kick.descWithReason, { user: member.user.tag, reason })
      : t(LanguageKeys.Commands.Moderation.Kick.desc, { user: member.user.tag });
    const dmText = result.dmSent
      ? t(LanguageKeys.Commands.Moderation.Kick.dmSent)
      : t(LanguageKeys.Commands.Moderation.Kick.dmNotSent);

    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Success)
      .setDescription(mainText + "\n\n" + dmText);

    const guildId = target.guildId ?? target.guild.id;
    const moderatorId = target instanceof Message ? target.author.id : target.user.id;
    const channelId = target.channelId ?? target.channel?.id;
    const quickActions = guildId && channelId
      ? await buildQuickActionRow({
          guildId,
          moderatorId,
          targetId: member.id,
          channelId,
          executedAction: "kick",
          t,
        })
      : { row: null };

    return this.reply(
      target,
      { embeds: [embed], ...(quickActions.row ? { components: [quickActions.row] } : {}) },
      { type: PomeloReplyType.Success },
    );
  }
}
