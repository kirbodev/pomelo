import type { Command } from "@sapphire/framework";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import {
  ApplicationIntegrationType,
  type ChatInputCommandInteraction,
  Message,
  PermissionFlagsBits,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import { getSnipe } from "../../lib/helpers/snipeStore.js";
import { convertToDiscordTimestamp } from "../../lib/helpers/timestamp.js";
import { Colors } from "../../lib/colors.js";

export class SnipeCommand extends CommandUtils.PomeloCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Show the last deleted message in this channel.",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      detailedDescription: {
        examples: [""],
        syntax: "",
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) => {
        applyLocalizedBuilder(
          builder,
          LanguageKeys.Commands.Utility.Snipe.commandName,
          LanguageKeys.Commands.Utility.Snipe.commandDescription,
        )
          .setName(this.name)
          .setDescription(this.description)
          .setIntegrationTypes([ApplicationIntegrationType.GuildInstall]);
      },
      {
        idHints: [],
      },
    );
  }

  public override async chatInputRun(
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    await this.execute(interaction, interaction.channelId);
  }

  public override async messageRun(message: Message) {
    await this.execute(message, message.channelId);
  }

  private async execute(
    interaction: ChatInputCommandInteraction | Message,
    channelId: string,
  ) {
    const t = await fetchT(interaction);
    const entry = getSnipe(channelId);

    if (!entry) {
      return await this.reply(
        interaction,
        {
          embeds: [
            new EmbedUtils.EmbedConstructor()
              .setDescription(t(LanguageKeys.Commands.Utility.Snipe.noSnipeData))
              .setColor(Colors.Error),
          ],
        },
        { type: PomeloReplyType.Error },
      );
    }

    const isNSFW =
      interaction instanceof Message
        ? (interaction.channel.isThread()
            ? interaction.channel.parent?.nsfw ?? false
            : (interaction.channel as { nsfw?: boolean }).nsfw ?? false)
        : (interaction.channel?.isThread()
            ? interaction.channel.parent?.nsfw ?? false
            : (interaction.channel as { nsfw?: boolean }).nsfw ?? false);

    const hasAttachments = entry.attachments.length > 0;
    const imageAttachment =
      !isNSFW && hasAttachments
        ? entry.attachments.find((a) =>
            a.contentType?.startsWith("image/"),
          )
        : undefined;

    const description = entry.content
      ? entry.content
      : t(LanguageKeys.Commands.Utility.Snipe.noTextContent);

    const embed = new EmbedUtils.EmbedConstructor()
      .setAuthor({
        name: entry.authorUsername,
        iconURL: entry.authorAvatarURL ?? undefined,
      })
      .setDescription(description)
      .setColor(Colors.Info)
      .setFooter({
        text: `${t(LanguageKeys.Commands.Utility.Snipe.deletedAt)} ${convertToDiscordTimestamp(entry.deletedAt.getTime(), "R")}`,
      });

    if (imageAttachment) {
      embed.setImage(imageAttachment.url);
    } else if (hasAttachments && !entry.content) {
      // Non-image attachments with no text — mention they exist
      const attachmentNames = entry.attachments
        .map((a) => `\`${a.name}\``)
        .join(", ");
      embed.setDescription(
        `${t(LanguageKeys.Commands.Utility.Snipe.noTextContent)}\n${attachmentNames}`,
      );
    }

    return await this.reply(
      interaction,
      { embeds: [embed] },
      { type: PomeloReplyType.Success },
    );
  }
}
