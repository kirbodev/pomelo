import { Args, Command } from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import {
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import CommandUtils from "../../utilities/commandUtils.js";
import { EmbedLimits, TwemojiRegex } from "@sapphire/discord-utilities";
import { Colors } from "../../lib/colors.js";
import type { PaginatedMessageActionContext } from "@sapphire/discord.js-utilities";
import { fetchT } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import * as Emojis from "node-emoji";
import ComponentUtils from "../../utilities/componentUtils.js";

type Emoji = {
  emoji: string;
  url: string;
  unicode?: string;
};

export class UserCommand extends CommandUtils.PomeloCommand {
  #EmojiRegex = /(?:<(?<animated>a)?:(?<name>\w{2,32}):)?(?<id>\d{17,21})>?/g;

  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "Get the large image form and link of an emoji(s).",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      detailedDescription: {
        examples: [
          "<:1000catstare:1239642986711744633>",
          "✨",
          "<:salutations:1265769840678010991> ✨",
          "<:1000catstare:1239642986711744633> <:salutations:1265769840678010991>",
        ],
        syntax: "<emojis: text>",
      },
      aliases: [
        "bigemojis",
        "cloneemoji",
        "cloneemojis",
        "copyemoji",
        "copyemojis",
        "getemoji",
        "getemojis",
      ],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) => {
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName("emojis")
            .setDescription("The emoji(s) to enlarge.")
            .setRequired(true)
        );
    });
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const emojis = interaction.options.getString("emojis", true);
    await this.execute(interaction, emojis);
  }

  public override async messageRun(message: Message, args: Args) {
    const emojis = await args.rest("string").catch(() => {
      void this.sendSyntaxError(message);
      return null;
    });
    if (!emojis) return;
    await this.execute(message, emojis);
  }

  private async execute(
    interaction: Command.ChatInputCommandInteraction | Message,
    rawEmojis: string
  ) {
    const emojis = await this.getEmojis(rawEmojis);

    if (!emojis.length) return this.sendSyntaxError(interaction);

    const paginatedMessage = new ComponentUtils.PomeloPaginatedMessage({
      template: new EmbedBuilder().setColor(Colors.Default),
    });

    for (let i = 0; i < emojis.length; i++) {
      const emoji = emojis[i];
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(`Emoji ${(i + 1).toString()}`)
        .setColor(Colors.Default)
        .setImage(emoji.url)
        .setFields({
          name: "URL",
          value: emoji.url,
        });
      paginatedMessage.addPageEmbed(embed).addPageAction(
        {
          customId: `clone_${i.toString()}`,
          style: ButtonStyle.Primary,
          type: ComponentType.Button,
          emoji: "📤",
          label: "Clone",
          run: (context: PaginatedMessageActionContext) => {
            void this.cloneEmoji(context, emojis[i]);
            return null;
          },
        },
        i
      );
    }
    await paginatedMessage.run(interaction);
  }

  private async cloneEmoji(
    context: PaginatedMessageActionContext,
    emoji: Emoji
  ) {
    const { interaction } = context;
    await interaction.deferUpdate();

    const t = await fetchT(interaction);
    // Check permissions
    if (
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuildExpressions
      ) &&
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.CreateGuildExpressions
      )
    ) {
      await interaction.followUp({
        embeds: [
          new EmbedUtils.EmbedConstructor()
            .setTitle(t(LanguageKeys.Errors.MissingPermission.title))
            .setDescription(
              t(LanguageKeys.Errors.MissingPermission.desc_detailed, {
                permission:
                  this.container.utilities.commandUtils.getPermissionNames(
                    new PermissionsBitField(
                      PermissionFlagsBits.ManageGuildExpressions
                    )
                  ),
              })
            )
            .setColor(Colors.Error),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      !interaction.guild?.members.me?.permissions.has(
        PermissionFlagsBits.CreateGuildExpressions
      ) &&
      !interaction.guild?.members.me?.permissions.has(
        PermissionFlagsBits.ManageGuildExpressions
      )
    ) {
      await interaction.followUp({
        embeds: [
          new EmbedUtils.EmbedConstructor()
            .setTitle(t(LanguageKeys.Errors.BotMissingPermission.title))
            .setDescription(
              t(LanguageKeys.Errors.BotMissingPermission.desc_detailed, {
                permission:
                  this.container.utilities.commandUtils.getPermissionNames(
                    new PermissionsBitField(
                      PermissionFlagsBits.CreateGuildExpressions
                    )
                  ),
              })
            )
            .setColor(Colors.Error),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const emojiName =
      (emoji.unicode
        ? Emojis.find(emoji.unicode)?.key
        : emoji.emoji.split(":")[1].split(":")[0].slice(0, 32)) ??
      `clone_${Date.now().toString()}`;

    let error: unknown;
    const clone = await interaction.guild.emojis
      .create({
        attachment: emoji.url,
        name: emojiName,
        reason: `Cloned by ${interaction.user.tag}`,
      })
      .catch((e: unknown) => {
        error = e;
        return null;
      });

    if (!clone) {
      const errMessage =
        (error instanceof Error ? error.message : "Unknown error")
          .replaceAll("`", "\\`")
          .slice(0, EmbedLimits.MaximumFieldValueLength - 12) + "...";
      await interaction.followUp({
        embeds: [
          new EmbedUtils.EmbedConstructor()
            .setTitle(t(LanguageKeys.Errors.GenericError.title))
            .setDescription(t(LanguageKeys.Errors.GenericError.desc))
            .addField(
              t(LanguageKeys.Errors.GenericError.field1.title),
              `\`\`\`js${errMessage}\`\`\``
            ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.followUp({
      embeds: [
        new EmbedUtils.EmbedConstructor()
          .setTitle(t(LanguageKeys.Commands.Utility.CloneEmoji.title))
          .setDescription(
            t(LanguageKeys.Commands.Utility.CloneEmoji.desc, {
              emoji: clone.name,
            })
          )
          .setColor(Colors.Success)
          .setThumbnail(clone.imageURL()),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async getEmojis(message: string) {
    const matches = Array.from(message.matchAll(this.#EmojiRegex));
    const ids = matches.map((emoji) => emoji[3]);
    const uniqueIds = [...new Set(ids)];
    const uniqueNames = uniqueIds
      .map((id) => matches.find((emoji) => emoji[3] === id))
      .filter((e) => e !== undefined)
      .map((e) => e[0]);
    const emojis: Emoji[] = [];
    for (let i = 0; i < uniqueIds.length; i++) {
      const emojiId = uniqueIds[i];
      let emoji = `https://cdn.discordapp.com/emojis/${emojiId}.gif`;
      let res = await fetch(emoji);
      if (res.ok) {
        emojis.push({
          emoji: uniqueNames[i],
          url: emoji,
        });
        continue;
      }
      emoji = `https://cdn.discordapp.com/emojis/${emojiId}.png`;
      res = await fetch(emoji);
      if (res.ok)
        emojis.push({
          emoji: uniqueNames[i],
          url: emoji,
        });
    }
    const twemojis = await this.getTwemojis(message);
    return this.orderEmojis([...emojis, ...twemojis], message);
  }

  private async getTwemojis(message: string) {
    const matches = message.matchAll(new RegExp(TwemojiRegex, "g"));
    const emojis = Array.from(matches).map((emoji) => emoji[0]);
    const uniqueEmojis = [...new Set(emojis)];
    const unicodeEmojis = uniqueEmojis.map((emoji) =>
      this.emojiToUnicode(emoji)
    );
    const twemojis: Emoji[] = [];
    for (const emoji of unicodeEmojis) {
      const res = await fetch(
        `https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/${emoji}.png`
      );
      if (res.ok)
        twemojis.push({
          emoji: uniqueEmojis[unicodeEmojis.indexOf(emoji)],
          url: `https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/${emoji}.png`,
          unicode: emoji,
        });
    }
    return twemojis;
  }

  private orderEmojis(emojis: Emoji[], message: string) {
    // Order the emojis based on the order they appear in the message
    const orderedEmojis: Emoji[] = [];
    const emojiMap = new Map<string, string>();
    for (const emoji of emojis) {
      const index = message.indexOf(emoji.emoji);
      emojiMap.set(emoji.url, index.toString());
    }
    const sortedEmojis = Array.from(emojiMap.entries()).sort(
      (a, b) => parseInt(a[1]) - parseInt(b[1])
    );
    for (const [emoji] of sortedEmojis) {
      orderedEmojis.push(emojis.find((e) => e.url === emoji) as Emoji);
    }
    return orderedEmojis;
  }

  private emojiToUnicode(emoji: string) {
    if (emoji.length === 1) return emoji.charCodeAt(0).toString(16);
    const pairs: string[] = [];
    for (let i = 0; i < emoji.length; i++) {
      const highSurrogate = emoji.charCodeAt(i);
      if (
        highSurrogate >= 0xd800 &&
        highSurrogate <= 0xdbff &&
        i + 1 < emoji.length
      ) {
        const lowSurrogate = emoji.charCodeAt(i + 1);
        const comp =
          (highSurrogate - 0xd800) * 0x400 + (lowSurrogate - 0xdc00) + 0x10000;
        pairs.push(comp.toString(16));
        i++; // Increment by 2 to skip the low surrogate
      } else {
        pairs.push(highSurrogate.toString(16));
      }
    }
    return pairs.join("-");
  }
}
