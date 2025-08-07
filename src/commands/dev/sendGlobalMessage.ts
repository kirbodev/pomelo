import { Command } from "@sapphire/framework";
import { config } from "../../config.js";
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import CommandUtils from "../../utilities/commandUtils.js";
import { findModChannel } from "../../listeners/onboarding/onboarding.js";
import EmbedUtils from "../../utilities/embedUtils.js";

export class SendGlobalMessageCommand extends CommandUtils.DevCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description:
        "Send a global message. Optionally, send it in translated versions.",
      detailedDescription: {
        syntax: "<message: text> ...[locale: locale]",
        examples: ["hello", '"hello" es="hola" fr="bonjour"'],
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder //
          .setName(this.name)
          .setDescription(this.description)
          .addStringOption((option) =>
            option //
              .setName("title")
              .setDescription("The title of the message.")
              .setRequired(true),
          )
          .addStringOption((option) =>
            option //
              .setName("text")
              .setDescription("The text to send.")
              .setRequired(true),
          )
          .addStringOption((option) =>
            option //
              .setName("title_translated")
              .setDescription(
                'The locales to send the title in. e.g: es="hola" fr="bonjour"',
              )
              .setRequired(false),
          )
          .addStringOption((option) =>
            option //
              .setName("text_translated")
              .setDescription(
                'The locales to send the message in. e.g: es="hola" fr="bonjour"',
              )
              .setRequired(false),
          ),
      {
        guildIds: config.testServers,
      },
    );
  }

  public override async verifiedChatInputRun(
    interaction: Command.ChatInputCommandInteraction | ModalSubmitInteraction,
    originalInteraction: ChatInputCommandInteraction,
  ) {
    const text = originalInteraction.options.getString("text", true);
    const rawtranslated =
      originalInteraction.options.getString("text_translated");
    const translated = rawtranslated
      ? parseLocaleString(rawtranslated)
      : undefined;
    const title = originalInteraction.options.getString("title", true);
    const rawtitletranslated =
      originalInteraction.options.getString("title_translated");
    const titletranslated = rawtitletranslated
      ? parseLocaleString(rawtitletranslated)
      : undefined;
    await this.execute(interaction, title, text, titletranslated, translated);
  }

  private async execute(
    interaction:
      | Command.ChatInputCommandInteraction
      | ModalSubmitInteraction
      | ButtonInteraction,
    title: string,
    text: string,
    titletranslated?: Record<string, string>,
    texttranslated?: Record<string, string>,
  ) {
    const guilds = await interaction.client.guilds.fetch();
    for (const oauthGuild of guilds.values()) {
      const guild = await oauthGuild.fetch();
      const channel = await findModChannel(guild);
      if (!channel) continue;
      const guildSettings = await this.container.redis.jsonGet(
        guild.id,
        "GuildSettings",
      );
      if (!guildSettings) continue;
      const locale = guildSettings.locale;
      const translatedTitle = titletranslated?.[locale] ?? title;
      const translatedText = texttranslated?.[locale] ?? text;
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(translatedTitle)
        .setDescription(translatedText);
      await channel.send({ embeds: [embed] });
    }
  }
}

function parseLocaleString(input: string): Record<string, string> {
  const result: Record<string, string> = {};

  const regex = /(\w+)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(input)) !== null) {
    const [, key, value] = match;
    result[key] = value;
  }

  return result;
}
