import { Command } from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  Message,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ApplicationIntegrationType,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { Colors } from "../../lib/colors.js";
import { linkedAccounts } from "../../db/schema.js";
import { db } from "../../db/index.js";
import { eq } from "drizzle-orm";
import {
  AFK_LINK_FEATURE,
  configureCalendars,
} from "../../lib/helpers/calendarLink.js";
import { createComponentId } from "../../lib/helpers/componentSessions.js";

export class AfkLinkCommand extends CommandUtils.PomeloCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description:
        "Link your Google Calendar to Pomelo to automatically set your AFK status when you're busy.",
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
          LanguageKeys.Commands.Utility.Afklink.commandName,
          LanguageKeys.Commands.Utility.Afklink.commandDescription,
        )
          .setName(this.name)
          .setDescription(this.description)
          .setIntegrationTypes([
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall,
          ]);
      },
      {
        idHints: ["1264272556526145667"],
      },
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    await this.execute(interaction);
  }

  public override async messageRun(message: Message) {
    await this.execute(message);
  }

  private async execute(
    interaction: Command.ChatInputCommandInteraction | Message,
  ) {
    const t = await fetchT(interaction);

    const user =
      interaction instanceof ChatInputCommandInteraction
        ? interaction.user
        : interaction.author;

    const account = await db
      .select()
      .from(linkedAccounts)
      .where(eq(linkedAccounts.userId, user.id));

    if (account.length > 0) {
      await configureCalendars(interaction);
      return;
    }

    // The link-code button and the calendar select menu are persistent —
    // routed through the afkLinkFlow / afkLinkModal interaction handlers.
    const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel(t(LanguageKeys.Commands.Utility.Afklink.button))
        .setStyle(ButtonStyle.Link)
        .setURL("https://pom.kdv.one/calendar/login"),
      new ButtonBuilder()
        .setCustomId(createComponentId(AFK_LINK_FEATURE, user.id, "linkid"))
        .setLabel(t(LanguageKeys.Commands.Utility.Afklink.linkId))
        .setStyle(ButtonStyle.Primary),
    );

    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(t(LanguageKeys.Commands.Utility.Afklink.title))
      .setDescription(t(LanguageKeys.Commands.Utility.Afklink.desc))
      .setColor(Colors.Default);

    await this.reply(
      interaction,
      {
        embeds: [embed],
        components: [button],
      },
      {
        type: PomeloReplyType.Sensitive,
      },
    );
  }
}
