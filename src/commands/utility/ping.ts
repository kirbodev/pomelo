import { Command } from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import ms from "../../lib/helpers/ms.js";
import {
  ChatInputCommandInteraction,
  Message,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";

export class UserCommand extends CommandUtils.PomeloCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      enabled: false,
      description: "Check the bot's latency and other useful information.",
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
          LanguageKeys.Commands.Utility.Ping.commandName,
          LanguageKeys.Commands.Utility.Ping.commandDescription
        )
          .setName(this.name)
          .setDescription(this.description);
      },
      {
        idHints: ["1264272556526145667"],
      }
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    await this.execute(interaction);
  }

  public override async messageRun(message: Message) {
    await this.execute(message);
  }

  private async execute(
    interaction: Command.ChatInputCommandInteraction | Message
  ) {
    const ping = Date.now() - interaction.createdTimestamp;
    const ws = interaction.client.ws.ping;

    const t = await fetchT(interaction);

    await this.reply(
      interaction,
      {
        embeds: [
          new EmbedUtils.EmbedConstructor() //
            .setTitle(t(LanguageKeys.Commands.Utility.Ping.title))
            .setDescription(
              t(LanguageKeys.Commands.Utility.Ping.desc, {
                latency: `${ping.toString()}ms`,
              })
            )
            .setFields([
              {
                name: t(
                  LanguageKeys.Commands.Utility.Ping.APILatencyFieldTitle
                ),
                value:
                  ws <= 0 ? t(LanguageKeys.Arguments.Na) : `${ws.toString()}ms`,
                inline: true,
              },
              {
                name: t(LanguageKeys.Commands.Utility.Ping.uptimeFieldTitle),
                value: ms(interaction.client.uptime),
                inline: true,
              },
            ])
            .setFooter({
              text: `v${this.container.version}`,
            }),
        ],
        ...(interaction instanceof ChatInputCommandInteraction && {
          flags: MessageFlags.Ephemeral,
        }),
      },
      {
        type: PomeloReplyType.Sensitive,
      }
    );
  }
}
