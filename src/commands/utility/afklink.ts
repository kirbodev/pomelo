import { Command } from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import {
  applyLocalizedBuilder,
  fetchT,
  type TFunction,
} from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  Message,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  ComponentType,
  StringSelectMenuInteraction,
  type EmbedData,
  User,
  MessageFlags,
  ApplicationIntegrationType,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { Colors } from "../../lib/colors.js";
import {
  accounts,
  afkCalendars,
  linkedAccounts,
  users,
} from "../../db/schema.js";
import { db } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { google } from "googleapis";

const requiredScopes = [
  "https://www.googleapis.com/auth/calendar.events.public.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned.readonly",
  "https://www.googleapis.com/auth/calendar.calendars.readonly",
];

export class UserCommand extends CommandUtils.PomeloCommand {
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
          LanguageKeys.Commands.Utility.Afklink.commandDescription
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
      }
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
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
    interaction: Command.ChatInputCommandInteraction | Message
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
      await this.configure(interaction);
      return;
    }

    const menuId = nanoid();

    const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel(t(LanguageKeys.Commands.Utility.Afklink.button))
        .setStyle(ButtonStyle.Link)
        .setURL("https://pom.kdv.one/calendar/login"),
      new ButtonBuilder()
        .setCustomId(`${menuId}-linkid`)
        .setLabel(t(LanguageKeys.Commands.Utility.Afklink.linkId))
        .setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(t(LanguageKeys.Commands.Utility.Afklink.title))
      .setDescription(t(LanguageKeys.Commands.Utility.Afklink.desc))
      .setColor(Colors.Default);

    const i = await this.reply(
      interaction,
      {
        embeds: [embed],
        components: [button],
      },
      {
        type: PomeloReplyType.Sensitive,
      }
    );

    const buttonInteraction = await i
      .awaitMessageComponent({
        filter: (i) => i.customId.startsWith(menuId) && i.user.id === user.id,
        time: 60000 * 5,
      })
      .catch(() => null);

    if (!buttonInteraction) {
      await this.container.utilities.componentUtils.disableButtons(
        i instanceof Message ? i : await i.fetch()
      );
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`${menuId}-modal`)
      .setTitle(t(LanguageKeys.Commands.Utility.Afklink.linkId))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(`${menuId}-id`)
            .setLabel(t(LanguageKeys.Commands.Utility.Afklink.linkId))
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

    await buttonInteraction.showModal(modal);

    const modalInteraction = await buttonInteraction
      .awaitModalSubmit({
        filter: (i) => i.customId.startsWith(menuId) && i.user.id === user.id,
        time: 60000 * 5,
      })
      .catch(async () => {
        await this.container.utilities.componentUtils.disableButtons(
          i instanceof Message ? i : await i.fetch()
        );
        return;
      });

    if (!modalInteraction) return;

    const id = modalInteraction.fields.getTextInputValue(`${menuId}-id`);

    await modalInteraction.deferUpdate();

    // check if user gave permission to all scopes
    const calendarAccount = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, id));

    if (!calendarAccount[0] || !calendarAccount[0].refresh_token) {
      void this.error(modalInteraction, this, {
        error: "AuthError",
      });
      return;
    }

    const calendarUser = await db
      .select()
      .from(users)
      .where(eq(users.id, calendarAccount[0].userId));

    if (!calendarUser[0] || !calendarUser[0].email) {
      void this.error(modalInteraction, this, {
        error: "NoEmail",
      });
      return;
    }

    const calendarScopes = calendarAccount[0].scope?.split(" ");

    if (
      !calendarScopes ||
      !requiredScopes.every((scope) => calendarScopes.includes(scope))
    ) {
      void this.error(modalInteraction, this, {
        error: "MissingScopes",
      });
      return;
    }

    await db.insert(linkedAccounts).values({
      userId: user.id,
      linkCode: id,
    });

    await modalInteraction.editReply({
      embeds: [
        new EmbedUtils.EmbedConstructor()
          .setTitle(t(LanguageKeys.Commands.Utility.Afklink.successTitle))
          .setDescription(t(LanguageKeys.Commands.Utility.Afklink.successDesc))
          .setColor(Colors.Success),
      ],
      components: [],
    });

    void this.configure(modalInteraction);
  }

  private async verifyAccount(
    interaction:
      | Command.ChatInputCommandInteraction
      | Message
      | ModalSubmitInteraction
  ) {
    let fail = false;
    const user =
      interaction instanceof Message ? interaction.author : interaction.user;
    const account = await db
      .select()
      .from(linkedAccounts)
      .where(eq(linkedAccounts.userId, user.id));

    if (account.length === 0) {
      void this.error(interaction, this, {
        error: "GenericError",
      });
      fail = true;
    }

    const calendarUser = await db
      .select()
      .from(users)
      .where(eq(users.id, account[0].linkCode));

    if (!calendarUser[0] || !calendarUser[0].email) {
      void this.error(interaction, this, {
        error: "NoEmail",
      });
      fail = true;
    }

    const calendarAcc = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, calendarUser[0].id));

    if (!calendarAcc[0] || !calendarAcc[0].refresh_token) {
      void this.error(interaction, this, {
        error: "AuthError",
      });
      fail = true;
    }

    if (fail)
      return {
        calendarUser: null,
        calendarAcc: null,
      };

    return {
      calendarUser: calendarUser[0],
      calendarAcc: calendarAcc[0],
    };
  }

  private async configure(
    interaction:
      | Command.ChatInputCommandInteraction
      | Message
      | ModalSubmitInteraction
  ) {
    const t = await fetchT(interaction);
    const user =
      interaction instanceof Message ? interaction.author : interaction.user;

    const { calendarUser, calendarAcc } = await this.verifyAccount(interaction);

    if (!calendarUser) return;

    const oauth = new google.auth.OAuth2({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uris: [
        "https://kdv.one",
        "https://pom.kdv.one",
        "https://pomelo.kdv.one",
        "https://pom.kdv.one/api/auth/callback/google",
        "http://localhost:3000/api/auth/callback/google",
      ],
      credentials: {
        access_token: calendarAcc.access_token,
        refresh_token: calendarAcc.refresh_token,
        expiry_date: calendarAcc.expires_at,
        token_type: calendarAcc.token_type,
        id_token: calendarAcc.id_token,
        scope: calendarAcc.scope ?? undefined,
      },
    });

    const { credentials } = await oauth.refreshAccessToken();
    oauth.setCredentials(credentials);

    const client = google.calendar({
      version: "v3",
      auth: oauth,
    });

    const calendarList = await client.calendarList
      .list()
      .catch((e: unknown) => {
        this.container.logger.warn("Failed to login to calendar", e);
        void this.error(interaction, this, {
          error: "MissingScopes",
        });
        return null;
      });

    if (!calendarList) return;

    if (!calendarList.data.items) {
      void this.error(interaction, this, {
        error: "NoneFound",
      });
      return;
    }

    const calendars = calendarList.data.items;

    const calendarNames = [
      ...new Set(
        calendars
          .map(
            (calendar) =>
              calendar.summary ??
              `Calendar ${
                calendar.id ?? calendars.indexOf(calendar).toString()
              }`
          )
          .filter((name) => name)
      ),
    ];

    const menuId = nanoid();

    const selectMenu = await this.createSelectMenu(
      calendarNames,
      user,
      t,
      menuId
    );

    const i = await this.reply(
      interaction,
      {
        embeds: [
          new EmbedUtils.EmbedConstructor()
            .setTitle(t(LanguageKeys.Commands.Utility.Afklink.selectCalendars))
            .setDescription(
              t(
                LanguageKeys.Commands.Utility.Afklink.selectCalendarsDescription
              )
            )
            .setColor(Colors.Default),
        ],
        components: [selectMenu],
      },
      {
        type: PomeloReplyType.Sensitive,
      }
    );

    const selectInteraction =
      i.createMessageComponentCollector<ComponentType.StringSelect>({
        filter: (i) => i.customId.startsWith(menuId) && i.user.id === user.id,
        time: 60000 * 5,
      });

    selectInteraction.on("collect", (i) => {
      void this.handleSelectMenu(
        i,
        calendarAcc.providerAccountId,
        i instanceof Message ? i : i.message,
        calendarNames,
        menuId
      );
    });

    selectInteraction.on("end", () => {
      void (async () => {
        void this.container.utilities.componentUtils.disableButtons(
          i instanceof Message ? i : await i.fetch()
        );
      })();
    });
  }

  private async createSelectMenu(
    calendars: string[],
    user: User,
    t: TFunction,
    menuId: string
  ) {
    const currentCalendarsEntry = await db
      .select()
      .from(afkCalendars)
      .where(eq(afkCalendars.userId, user.id));
    const currentCalendars =
      currentCalendarsEntry[0]?.calendars?.split(",") ?? [];

    const selectMenu =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${menuId}-select`)
          .setPlaceholder(
            t(LanguageKeys.Commands.Utility.Afklink.selectCalendars)
          )
          .setMinValues(0)
          .setMaxValues(calendars.length)
          .addOptions(
            calendars.map((name) => ({
              label: name,
              value: name,
              default: currentCalendars.includes(name),
            }))
          )
      );

    return selectMenu;
  }

  private async handleSelectMenu(
    interaction: StringSelectMenuInteraction,
    calendarId: string,
    replyMessage: Message,
    calendars: string[],
    menuId: string
  ) {
    const user = interaction.user;
    const t = await fetchT(interaction);

    const selectedCalendars = interaction.values;

    await interaction.deferUpdate();

    const currentCalendarsEntry = await db
      .select()
      .from(afkCalendars)
      .where(eq(afkCalendars.userId, user.id));

    if (currentCalendarsEntry.length > 0) {
      await db
        .update(afkCalendars)
        .set({
          calendars: selectedCalendars.join(","),
        })
        .where(eq(afkCalendars.userId, user.id));
    } else {
      await db.insert(afkCalendars).values({
        userId: user.id,
        calendarId: calendarId,
        calendars: selectedCalendars.join(","),
      });
    }

    const editedEmbed = new EmbedUtils.EmbedConstructor(
      replyMessage.embeds[0].data as EmbedData
    );
    editedEmbed.setColor(Colors.Success);

    const selectMenu = await this.createSelectMenu(calendars, user, t, menuId);

    const reply = await interaction
      .editReply({
        embeds: [editedEmbed],
        components: [selectMenu],
      })
      .catch(() => null);

    if (!reply) return;

    setTimeout(() => {
      void interaction.editReply({
        embeds: [editedEmbed.setColor(Colors.Default)],
      });
    }, 2500);
  }
}
