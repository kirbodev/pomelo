import { Args, Command } from "@sapphire/framework";
import { Subcommand } from "@sapphire/plugin-subcommands";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import {
  ApplicationIntegrationType,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  GuildMember,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { modActionService } from "../../lib/moderation/actions.js";
import { Colors } from "../../lib/colors.js";
import ms from "../../lib/helpers/ms.js";
import { userMention } from "../../lib/helpers/stringUtils.js";
import { buildQuickActionRow } from "../../lib/moderation/quickActionRow.js";

const MAX_MUTE_DURATION = 28 * 86400000; // 28 days

export class MuteCommand extends CommandUtils.PomeloSubcommand {
  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      description: "Mute or unmute a user.",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      requiredUserPermissions: [PermissionFlagsBits.ModerateMembers],
      preconditions: ["GuildOnly"],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const userLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Mute.userFieldName,
      LanguageKeys.Commands.Moderation.Mute.userFieldDescription,
    );
    const durationLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Mute.durationFieldName,
      LanguageKeys.Commands.Moderation.Mute.durationFieldDescription,
    );
    const reasonLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Mute.reasonFieldName,
      LanguageKeys.Commands.Moderation.Mute.reasonFieldDescription,
    );

    registry.registerChatInputCommand((builder) => {
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Moderation.Mute.commandName,
        LanguageKeys.Commands.Moderation.Mute.commandDescription,
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .addSubcommand((sub) =>
          applyLocalizedBuilder(
            sub,
            LanguageKeys.Commands.Moderation.Mute.commandName,
            LanguageKeys.Commands.Moderation.Mute.commandDescription,
          )
            .setName("mute")
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
                .setName(durationLocs.englishName)
                .setNameLocalizations(durationLocs.names)
                .setDescription(durationLocs.englishDescription)
                .setDescriptionLocalizations(durationLocs.descriptions)
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
        )
        .addSubcommand((sub) =>
          applyLocalizedBuilder(
            sub,
            LanguageKeys.Commands.Moderation.Unmute.commandName,
            LanguageKeys.Commands.Moderation.Unmute.commandDescription,
          )
            .setName("unmute")
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

      return builder;
    });
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "mute") {
      const user = interaction.options.getUser("user", true);
      const durationStr = interaction.options.getString("duration", true);
      const reason = interaction.options.getString("reason");

      const durationMs = ms(durationStr);
      if (typeof durationMs !== "number" || isNaN(durationMs)) {
        const t = await fetchT(interaction);
        const embed = new EmbedUtils.EmbedConstructor()
          .setColor(Colors.Error)
          .setDescription(
            t(LanguageKeys.Commands.Moderation.Errors.durationTooLong),
          );

        await this.reply(
          interaction,
          { embeds: [embed] },
          { type: PomeloReplyType.Error },
        );
        return;
      }

      if (durationMs > MAX_MUTE_DURATION) {
        const t = await fetchT(interaction);
        const embed = new EmbedUtils.EmbedConstructor()
          .setColor(Colors.Error)
          .setDescription(
            t(LanguageKeys.Commands.Moderation.Errors.durationTooLong),
          );

        await this.reply(
          interaction,
          { embeds: [embed] },
          { type: PomeloReplyType.Error },
        );
        return;
      }

      const member = interaction.guild?.members.cache.get(user.id);
      if (!member) {
        const t = await fetchT(interaction);
        const embed = new EmbedUtils.EmbedConstructor()
          .setColor(Colors.Error)
          .setDescription(
            t(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild),
          );

        await this.reply(
          interaction,
          { embeds: [embed] },
          { type: PomeloReplyType.Error },
        );
        return;
      }

      await this.executeMute(
        interaction,
        member,
        durationMs,
        reason ?? undefined,
      );
    } else if (subcommand === "unmute") {
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason");

      const member = interaction.guild?.members.cache.get(user.id);
      if (!member) {
        const t = await fetchT(interaction);
        const embed = new EmbedUtils.EmbedConstructor()
          .setColor(Colors.Error)
          .setDescription(
            t(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild),
          );

        await this.reply(
          interaction,
          { embeds: [embed] },
          { type: PomeloReplyType.Error },
        );
        return;
      }

      await this.executeUnmute(interaction, member, reason ?? undefined);
    }
  }

  public override async messageRun(message: Message, args: Args) {
    const t = await fetchT(message);
    const sub = await args.pick("string").catch(() => "mute");

    if (sub === "unmute") {
      const user = await args.pick("user");
      const reason = await args.rest("string").catch(() => null);
      const member = message.guild?.members.cache.get(user.id);
      if (!member) {
        await message.reply(
          t(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild),
        );
        return;
      }
      await this.executeUnmute(message, member, reason ?? undefined);
    } else {
      const user = await args.pick("user");
      const durationStr = await args.pick("string");
      const reason = await args.rest("string").catch(() => null);

      const durationMs = ms(durationStr);
      if (
        typeof durationMs !== "number" ||
        isNaN(durationMs) ||
        durationMs > MAX_MUTE_DURATION
      ) {
        await message.reply(
          t(LanguageKeys.Commands.Moderation.Errors.durationTooLong),
        );
        return;
      }

      const member = message.guild?.members.cache.get(user.id);
      if (!member) {
        await message.reply(
          t(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild),
        );
        return;
      }

      await this.executeMute(message, member, durationMs, reason ?? undefined);
    }
  }

  private async executeMute(
    target: Command.ChatInputCommandInteraction | Message,
    member: GuildMember,
    duration: number,
    reason?: string,
  ) {
    const t = await fetchT(target);
    const guild = target.guild;
    if (!guild) return;

    const moderator =
      target.member instanceof GuildMember ? target.member : null;
    if (!moderator) return;

    const result = await modActionService.mute(
      guild,
      moderator,
      member,
      duration,
      reason,
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

    const durationDisplay = this.formatMs(duration);
    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Success)
      .setTitle(t(LanguageKeys.Commands.Moderation.Mute.title))
      .setDescription(
        t(LanguageKeys.Commands.Moderation.Mute.desc, {
          user: userMention(member.user),
        }),
      )
      .addFields(
        {
          name: t(LanguageKeys.Commands.Moderation.Fields.duration),
          value: durationDisplay,
          inline: true,
        },
        ...(reason
          ? [
              {
                name: t(LanguageKeys.Commands.Moderation.Fields.reason),
                value: reason,
                inline: false,
              },
            ]
          : []),
        {
          name: t(LanguageKeys.Commands.Moderation.Fields.dm),
          value: result.dmSent
            ? t(LanguageKeys.Commands.Moderation.Mute.dmSent)
            : t(LanguageKeys.Commands.Moderation.Mute.dmNotSent),
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
            targetId: member.id,
            channelId,
            executedAction: "mute",
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

  private async executeUnmute(
    target: Command.ChatInputCommandInteraction | Message,
    member: GuildMember,
    reason?: string,
  ) {
    const t = await fetchT(target);
    const guild = target.guild;
    if (!guild) return;

    const moderator =
      target.member instanceof GuildMember ? target.member : null;
    if (!moderator) return;

    const result = await modActionService.unmute(
      guild,
      moderator,
      member,
      reason,
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

    const embed = new EmbedUtils.EmbedConstructor()
      .setColor(Colors.Success)
      .setTitle(t(LanguageKeys.Commands.Moderation.Unmute.title))
      .setDescription(
        t(LanguageKeys.Commands.Moderation.Unmute.desc, {
          user: userMention(member.user),
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

  private formatMs(ms: number): string {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    if (days > 0) return `${days.toString()}d ${hours.toString()}h`;
    return `${hours.toString()}h`;
  }
}
