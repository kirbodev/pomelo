import { Args, Command } from "@sapphire/framework";
import { Subcommand } from "@sapphire/plugin-subcommands";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import {
  ApplicationIntegrationType,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  GuildMember,
  User,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { modActionService } from "../../lib/moderation/actions.js";
import { Colors } from "../../lib/colors.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import ms from "../../lib/helpers/ms.js";
import { buildQuickActionRow } from "../../lib/moderation/quickActionRow.js";
import { userMention } from "../../lib/helpers/stringUtils.js";

export class BanCommand extends CommandUtils.PomeloSubcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      description: "Ban or unban a user.",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      requiredUserPermissions: [PermissionFlagsBits.BanMembers],
      preconditions: ["GuildOnly"],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const userLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Ban.userFieldName,
      LanguageKeys.Commands.Moderation.Ban.userFieldDescription,
    );
    const reasonLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Ban.reasonFieldName,
      LanguageKeys.Commands.Moderation.Ban.reasonFieldDescription,
    );
    const durationLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Ban.durationFieldName,
      LanguageKeys.Commands.Moderation.Ban.durationFieldDescription,
    );
    const deleteLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Ban.deleteMessagesFieldName,
      LanguageKeys.Commands.Moderation.Ban.deleteMessagesFieldDescription,
    );
    const userIdLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Unban.userIdFieldName,
      LanguageKeys.Commands.Moderation.Unban.userIdFieldDescription,
    );

    registry.registerChatInputCommand((builder) => {
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Moderation.Ban.commandName,
        LanguageKeys.Commands.Moderation.Ban.commandDescription,
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .addSubcommand((sub) =>
          applyLocalizedBuilder(
            sub,
            LanguageKeys.Commands.Moderation.Ban.commandName,
            LanguageKeys.Commands.Moderation.Ban.commandDescription,
          )
            .setName("ban")
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
            )
            .addStringOption((option) =>
              option
                .setName(durationLocs.englishName)
                .setNameLocalizations(durationLocs.names)
                .setDescription(durationLocs.englishDescription)
                .setDescriptionLocalizations(durationLocs.descriptions)
                .setRequired(false),
            )
            .addStringOption((option) =>
              option
                .setName(deleteLocs.englishName)
                .setNameLocalizations(deleteLocs.names)
                .setDescription(deleteLocs.englishDescription)
                .setDescriptionLocalizations(deleteLocs.descriptions)
                .setRequired(false)
                .addChoices(
                  { name: "Don't delete any", value: "0" },
                  { name: "Last hour", value: "3600" },
                  { name: "Last 6 hours", value: "21600" },
                  { name: "Last 24 hours", value: "86400" },
                  { name: "Last 3 days", value: "259200" },
                  { name: "Last 7 days", value: "604800" },
                ),
            ),
        )
        .addSubcommand((sub) =>
          applyLocalizedBuilder(
            sub,
            LanguageKeys.Commands.Moderation.Unban.commandName,
            LanguageKeys.Commands.Moderation.Unban.commandDescription,
          )
            .setName("unban")
            .addStringOption((option) =>
              option
                .setName(userIdLocs.englishName)
                .setNameLocalizations(userIdLocs.names)
                .setDescription(userIdLocs.englishDescription)
                .setDescriptionLocalizations(userIdLocs.descriptions)
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

      return builder;
    });
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "ban") {
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason");
      const durationStr = interaction.options.getString("duration");
      const deleteChoice = interaction.options.getString("delete-messages");

      let duration: number | undefined;
      if (durationStr) {
        const parsed = ms(durationStr);
        if (typeof parsed === "number" && !isNaN(parsed)) {
          duration = parsed;
        }
      }

      const deleteMessageSeconds = deleteChoice
        ? (parseInt(deleteChoice, 10) as
            | 0
            | 3600
            | 21600
            | 86400
            | 259200
            | 604800)
        : undefined;

      await this.executeBan(
        interaction,
        user,
        duration,
        deleteMessageSeconds,
        reason ?? undefined,
      );
    } else if (subcommand === "unban") {
      const userId = interaction.options.getString("user-id", true);
      const reason = interaction.options.getString("reason");

      await this.executeUnban(interaction, userId, reason ?? undefined);
    }
  }

  public override async messageRun(message: Message, args: Args) {
    const t = await fetchT(message);
    const sub = await args.pick("string").catch(() => "ban");

    if (sub === "unban") {
      const userId = await args.pick("string");
      const reason = await args.rest("string").catch(() => null);
      await this.executeUnban(message, userId, reason ?? undefined);
    } else {
      const user = await args.pick("user");
      const reason = await args.rest("string").catch(() => null);
      const member = message.guild?.members.cache.get(user.id);
      if (!member) {
        await message.reply(
          t(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild),
        );
        return;
      }
      await this.executeBan(
        message,
        user,
        undefined,
        undefined,
        reason ?? undefined,
      );
    }
  }

  private async executeBan(
    target: Command.ChatInputCommandInteraction | Message,
    user: User,
    duration?: number,
    deleteMessageSeconds?: 0 | 3600 | 21600 | 86400 | 259200 | 604800,
    reason?: string,
  ) {
    const t = await fetchT(target);
    const guild = target.guild;
    if (!guild) return;

    const moderator =
      target.member instanceof GuildMember ? target.member : null;
    if (!moderator) return;

    let targetMember: GuildMember | User = user;
    const fetched = guild.members.cache.get(user.id);
    if (fetched) targetMember = fetched;

    const result = await modActionService.ban(
      guild,
      moderator,
      targetMember,
      reason,
      {
        duration,
        ...(deleteMessageSeconds !== undefined && deleteMessageSeconds > 0
          ? { deleteMessageDays: deleteMessageSeconds }
          : {}),
      },
    );

    if (!result.success) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Error)
        .setDescription(
          t(LanguageKeys.Commands.Moderation.Errors.hierarchyTooLow),
        );

      await this.reply(
        target,
        { embeds: [embed] },
        { type: PomeloReplyType.Error },
      );
      return;
    }

    const deleteKey = deleteMessageSeconds
      ? this.deleteMessagesKey(deleteMessageSeconds)
      : null;

    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Success)
      .setTitle(t(LanguageKeys.Commands.Moderation.Ban.title))
      .setDescription(
        t(LanguageKeys.Commands.Moderation.Ban.desc, {
          user: userMention(user),
        }),
      )
      .addFields(
        ...(reason
          ? [
              {
                name: t(LanguageKeys.Commands.Moderation.Fields.reason),
                value: reason,
                inline: false,
              },
            ]
          : []),
        ...(duration
          ? [
              {
                name: t(LanguageKeys.Commands.Moderation.Fields.duration),
                value: this.formatMs(duration),
                inline: true,
              },
            ]
          : []),
        ...(deleteKey
          ? [
              {
                name: t(
                  LanguageKeys.Commands.Moderation.Fields.messagesDeleted,
                ),
                value: t(LanguageKeys.Commands.Moderation.Ban[deleteKey]),
                inline: true,
              },
            ]
          : []),
        {
          name: t(LanguageKeys.Commands.Moderation.Fields.dm),
          value: result.dmSent
            ? t(LanguageKeys.Commands.Moderation.Ban.dmSent)
            : t(LanguageKeys.Commands.Moderation.Ban.dmNotSent),
          inline: true,
        },
      );

    const guildId = target.guildId ?? target.guild.id;
    const moderatorId =
      target instanceof Message ? target.author.id : target.user.id;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const channelId = target.channelId ?? target.channel?.id;
    const quickActions =
      guildId && channelId
        ? await buildQuickActionRow({
            guildId,
            moderatorId,
            targetId: user.id,
            channelId,
            executedAction: "ban",
            t,
          })
        : { row: null };

    await this.reply(
      target,
      {
        embeds: [embed],
        ...(quickActions.row ? { components: [quickActions.row] } : {}),
      },
      { type: PomeloReplyType.Success },
    );
  }

  private async executeUnban(
    target: Command.ChatInputCommandInteraction | Message,
    userId: string,
    reason?: string,
  ) {
    const t = await fetchT(target);
    const guild = target.guild;
    if (!guild) return;

    const moderator =
      target.member instanceof GuildMember ? target.member : null;
    if (!moderator) return;

    const result = await modActionService.unban(
      guild,
      moderator,
      userId,
      reason,
    );

    if (!result.success) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Error)
        .setDescription(
          t(LanguageKeys.Commands.Moderation.Errors.caseNotFound),
        );

      await this.reply(
        target,
        { embeds: [embed] },
        { type: PomeloReplyType.Error },
      );
      return;
    }

    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Success)
      .setTitle(t(LanguageKeys.Commands.Moderation.Unban.title))
      .setDescription(
        t(LanguageKeys.Commands.Moderation.Unban.desc, {
          user: userMention({ id: userId, username: userId }),
        }),
      )
      .addFields(
        ...(reason
          ? [
              {
                name: t(LanguageKeys.Commands.Moderation.Fields.reason),
                value: reason,
                inline: false,
              },
            ]
          : []),
      );

    await this.reply(
      target,
      { embeds: [embed] },
      { type: PomeloReplyType.Success },
    );
  }

  private deleteMessagesKey(
    seconds: 0 | 3600 | 21600 | 86400 | 259200 | 604800,
  ):
    | "deleteMessages1h"
    | "deleteMessages6h"
    | "deleteMessages24h"
    | "deleteMessages3d"
    | "deleteMessages7d"
    | null {
    if (seconds === 3600) return "deleteMessages1h";
    if (seconds === 21600) return "deleteMessages6h";
    if (seconds === 86400) return "deleteMessages24h";
    if (seconds === 259200) return "deleteMessages3d";
    if (seconds === 604800) return "deleteMessages7d";
    return null;
  }

  private formatMs(ms: number): string {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    if (days > 0) return `${days.toString()}d ${hours.toString()}h`;
    return `${hours.toString()}h`;
  }
}
