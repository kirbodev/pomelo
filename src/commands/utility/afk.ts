import { Args, Command, container } from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import ms from "../../lib/helpers/ms.js";
import {
  ApplicationIntegrationType,
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  TimestampStyles,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { Colors } from "../../lib/colors.js";
import { convertToDiscordTimestamp } from "../../lib/helpers/timestamp.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { Afk } from "../../db/redis/schema.js";
import { URGENT_PING } from "../../lib/helpers/constants.js";
import { recentReversions } from "../../listeners/afk/preventAutomodRuleEdit.js";

const MAX_AFK_DURATION = ms("30d");
const MIN_AFK_DURATION = ms("1m");
const MAX_AFK_MESSAGE_LENGTH = 200;
const VALID_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

export class AfkCommand extends CommandUtils.PomeloCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Set your AFK status",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      detailedDescription: {
        examples: ["", "be back in a bit", "afk for 10 minutes 10m"],
        syntax: "[reason] [duration]",
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const messageLocs = getOptionLocalizations(
      LanguageKeys.Commands.Utility.Afk.messageFieldName,
      LanguageKeys.Commands.Utility.Afk.messageFieldDescription
    );
    const durationLocs = getOptionLocalizations(
      LanguageKeys.Commands.Utility.Afk.durationFieldName,
      LanguageKeys.Commands.Utility.Afk.durationFieldDescription
    );
    const attachmentLocs = getOptionLocalizations(
      LanguageKeys.Commands.Utility.Afk.attachmentFieldName,
      LanguageKeys.Commands.Utility.Afk.attachmentFieldDescription
    );

    registry.registerChatInputCommand((builder) => {
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Utility.Afk.commandName,
        LanguageKeys.Commands.Utility.Afk.commandDescription
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([
          ApplicationIntegrationType.GuildInstall,
          ApplicationIntegrationType.UserInstall,
        ])
        .addStringOption((option) =>
          option
            .setName(messageLocs.englishName)
            .setNameLocalizations(messageLocs.names)
            .setDescription(messageLocs.englishDescription)
            .setDescriptionLocalizations(messageLocs.descriptions)
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName(durationLocs.englishName)
            .setNameLocalizations(durationLocs.names)
            .setDescription(durationLocs.englishDescription)
            .setDescriptionLocalizations(durationLocs.descriptions)
            .setRequired(false)
        )
        .addAttachmentOption((option) =>
          option
            .setName(attachmentLocs.englishName)
            .setNameLocalizations(attachmentLocs.names)
            .setDescription(attachmentLocs.englishDescription)
            .setDescriptionLocalizations(attachmentLocs.descriptions)
            .setRequired(false)
        );
    });
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const message = interaction.options.getString("message") ?? undefined;
    const durationAsString = interaction.options.getString("duration");
    const duration = durationAsString ? ms(durationAsString) : undefined;
    const attachment = interaction.options.getAttachment("attachment");

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    await this.execute(interaction, message, duration, attachment?.url);
  }

  public override async messageRun(message: Message, args: Args) {
    let text = (await args.restResult("string")).unwrapOr(undefined);
    const duration = (await args.pickResult("duration")).unwrapOr(undefined);
    let attachment = (
      await args.pickResult("attachment", {
        allowedExtensions: VALID_EXTENSIONS,
      })
    ).unwrapOr(undefined);

    if (duration) text = text?.replace(duration.rawTime, "").trim();
    if (attachment) text = text?.replace(attachment, "").trim();

    if (message.attachments.size > 0) {
      const nativeAttachment = message.attachments.first();
      if (
        nativeAttachment &&
        nativeAttachment.contentType &&
        nativeAttachment.contentType in VALID_EXTENSIONS
      ) {
        attachment = nativeAttachment.url;
      }
    }

    await this.execute(message, text, duration?.value, attachment);
  }

  private async execute(
    interaction: Command.ChatInputCommandInteraction | Message,
    message?: string,
    duration?: number,
    attachment?: string
  ) {
    const t = await fetchT(interaction);
    const user =
      interaction instanceof Message ? interaction.author : interaction.user;

    const afkData = await this.container.redis.jsonGet(user.id, "Afk");

    if (message && message.length > MAX_AFK_MESSAGE_LENGTH)
      return this.error(interaction, this, {
        error: "StringTooLong",
        context: {
          length: MAX_AFK_MESSAGE_LENGTH,
        },
      });

    if (duration && duration < MIN_AFK_DURATION)
      return this.error(interaction, this, {
        error: "DurationTooShort",
        context: {
          length: MIN_AFK_DURATION,
          error: "test",
        },
      });

    if (duration && duration > MAX_AFK_DURATION)
      return this.error(interaction, this, {
        error: "DurationTooLong",
        context: {
          length: MAX_AFK_DURATION,
        },
      });

    const durationAsTimestamp = duration
      ? convertToDiscordTimestamp(
          Date.now() + duration,
          TimestampStyles.ShortDateTime
        )
      : null;
    let description: string;
    if (message && duration) {
      description = t(
        LanguageKeys.Commands.Utility.Afk.desc_with_message_and_duration,
        {
          message,
          time: durationAsTimestamp,
        }
      );
    } else if (message) {
      description = t(LanguageKeys.Commands.Utility.Afk.desc_with_message, {
        message,
      });
    } else if (duration) {
      description = t(LanguageKeys.Commands.Utility.Afk.desc_with_duration, {
        time: durationAsTimestamp,
      });
    } else {
      description = t(LanguageKeys.Commands.Utility.Afk.desc);
    }

    //NOTE - Might want to change; overwrite note is shown even if data is identical

    if (afkData)
      description += `\n${t(LanguageKeys.Commands.Utility.Afk.overwriteNote)}`;

    const success = await AfkCommand.setAfk(
      user.id,
      {
        text: message,
        attachment: attachment ?? undefined,
        endsAt: duration ? new Date(Date.now() + duration) : null,
        startedAt: afkData ? new Date(afkData.startedAt) : new Date(),
      },
      !!afkData
    );

    if (!success)
      return this.error(interaction, this, {
        error: "ServerError",
        message: "Failed to set AFK data",
      });

    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(t(LanguageKeys.Commands.Utility.Afk.title))
      .setDescription(description)
      .setColor(Colors.Success);

    return this.reply(
      interaction,
      {
        embeds: [embed],
      },
      {
        type: PomeloReplyType.Success,
      }
    );
  }

  static async setAfk(userId: string, afkData: Afk, alreadyAfk = false) {
    // parse with zod
    const data = Afk.safeParse(afkData);
    if (!data.success) return false;

    const success = await container.redis.jsonSet(userId, "Afk", data.data);
    if (!success) return false;
    const expire = data.data.endsAt
      ? await container.redis.expireat(
          `Afk:${userId}`,
          Math.round(new Date(data.data.endsAt).getTime() / 1000)
        )
      : true;
    if (!expire) return false;

    if (alreadyAfk) return true;

    const user = await container.client.users.fetch(userId).catch(() => null);
    if (!user) return false;

    const fetchedGuilds = await container.client.guilds
      .fetch()
      .catch(() => null);
    if (!fetchedGuilds) return false;

    const guilds = (
      await Promise.all(
        Array.from(fetchedGuilds.values()).map(
          async (g) => await g.fetch().catch(() => null)
        )
      ).catch(() => null)
    )?.filter((g) => g !== null);

    if (!guilds) return false;

    for (const guild of guilds) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      const settings = await container.redis.jsonGet(guild.id, "GuildSettings");
      if (!settings) continue;
      const userSettings = await container.redis.jsonGet(
        userId,
        "UserSettings"
      );

      if (settings.afkEnabled) {
        const memberName = member.nickname ?? member.displayName;
        if (!memberName.startsWith("[AFK]"))
          await member.setNickname(`[AFK] ${memberName}`).catch(() => null);

        if (settings.blockAfkMentions) {
          const autoModRules = await guild.autoModerationRules
            .fetch()
            .catch(() => null);
          if (!autoModRules) continue;

          const afkRule = autoModRules.find(
            (r) => r.creatorId === container.client.id && r.name.includes("AFK")
          );

          const blockedAfks = [
            ...(afkRule?.triggerMetadata.keywordFilter ?? []),
          ];
          if (blockedAfks.includes(`<@${member.id}>`)) continue;
          blockedAfks.push(`<@${member.id}>`);

          const allowList = [...(afkRule?.triggerMetadata.allowList ?? [])];
          if (!userSettings || userSettings.allowUrgentPings)
            allowList.push(`${URGENT_PING}<@${member.id}>`);

          if (afkRule) {
            const action = afkRule.actions[0];
            const guildT = await fetchT(guild);
            const customMessage = guildT(
              LanguageKeys.Commands.Utility.Afk.blockedAfk
            );
            action.metadata.customMessage = customMessage;

            recentReversions.set(afkRule.id, Date.now());
            setTimeout(() => {
              recentReversions.delete(afkRule.id);
            }, 5000).unref();

            await afkRule
              .edit({
                triggerMetadata: {
                  allowList,
                  keywordFilter: blockedAfks,
                },
                actions: [action],
              })
              .catch(() => null);
          } else {
            const guildT = await fetchT(guild);
            const customMessage = guildT(
              LanguageKeys.Commands.Utility.Afk.blockedAfk
            );

            await guild.autoModerationRules
              .create({
                enabled: true,
                actions: [
                  {
                    type: AutoModerationActionType.BlockMessage,
                    metadata: {
                      customMessage,
                    },
                  },
                ],
                name: "AFK - Pomelo",
                eventType: AutoModerationRuleEventType.MessageSend,
                triggerType: AutoModerationRuleTriggerType.Keyword,
                triggerMetadata: {
                  keywordFilter: blockedAfks,
                  allowList,
                },
              })
              .catch(() => null);
          }
        }
      }
    }

    return true;
  }
}
