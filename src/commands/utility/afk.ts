import { Args, Command, UserError } from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import {
  applyLocalizedBuilder,
  fetchT,
} from "@sapphire/plugin-i18next";
import ms from "../../lib/helpers/ms.js";
import {
  Message,
  PermissionFlagsBits,
  TimestampStyles,
} from "discord.js";
import {
  LanguageKeys,
} from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { Colors } from "../../lib/colors.js";
import { convertToDiscordTimestamp } from "../../lib/helpers/timestamp.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";

const MAX_AFK_DURATION = ms("30d");
const MIN_AFK_DURATION = ms("1m");
const MAX_AFK_MESSAGE_LENGTH = 200;
const VALID_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

export class UserCommand extends CommandUtils.PomeloCommand {
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

    const success = await this.container.redis.jsonSet(user.id, "Afk", {
      text: message,
      attachment: attachment ?? undefined,
      guildId: interaction.guildId ?? undefined,
      endsAt: duration ? new Date(Date.now() + duration) : null,
    });

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
}
