import { container, type Command } from "@sapphire/framework";
import { fetchT, type TFunction } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  Message,
  StringSelectMenuBuilder,
  User,
  type EmbedData,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { eq } from "drizzle-orm";
import { google } from "googleapis";
import EmbedUtils from "../../utilities/embedUtils.js";
import { Colors } from "../colors.js";
import { LanguageKeys, LanguageKeyValues } from "../i18n/languageKeys.js";
import { db } from "../../db/index.js";
import {
  accounts,
  afkCalendars,
  linkedAccounts,
  users,
} from "../../db/schema.js";
import { PomeloReplyType } from "../../utilities/commandUtils.js";
import { createComponentId } from "./componentSessions.js";

export const AFK_LINK_FEATURE = "al";

export const requiredScopes = [
  "https://www.googleapis.com/auth/calendar.events.public.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned.readonly",
  "https://www.googleapis.com/auth/calendar.calendars.readonly",
];

type LinkInteraction =
  | Command.ChatInputCommandInteraction
  | Message
  | ModalSubmitInteraction
  | StringSelectMenuInteraction;

function getAfkLinkCommand(): Command | undefined {
  return container.stores.get("commands").get("afklink");
}

async function replyLinkError(
  interaction: LinkInteraction,
  error: keyof typeof LanguageKeyValues.Errors,
): Promise<void> {
  const command = getAfkLinkCommand();
  if (!command) return;
  await container.utilities.commandUtils.implementErrorMessage(
    interaction,
    command,
    { error },
  );
}

async function verifyAccount(interaction: LinkInteraction) {
  const user =
    interaction instanceof Message ? interaction.author : interaction.user;
  const account = await db
    .select()
    .from(linkedAccounts)
    .where(eq(linkedAccounts.userId, user.id));

  if (account.length === 0) {
    void replyLinkError(interaction, "GenericError");
    return { calendarUser: null, calendarAcc: null };
  }

  const calendarUser = await db
    .select()
    .from(users)
    .where(eq(users.id, account[0].linkCode));

  if (!calendarUser[0] || !calendarUser[0].email) {
    void replyLinkError(interaction, "NoEmail");
    return { calendarUser: null, calendarAcc: null };
  }

  const calendarAcc = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, calendarUser[0].id));

  if (!calendarAcc[0] || !calendarAcc[0].refresh_token) {
    void replyLinkError(interaction, "AuthError");
    return { calendarUser: null, calendarAcc: null };
  }

  return {
    calendarUser: calendarUser[0],
    calendarAcc: calendarAcc[0],
  };
}

export async function createCalendarSelectMenu(
  calendars: string[],
  user: User,
  t: TFunction,
) {
  const currentCalendarsEntry = await db
    .select()
    .from(afkCalendars)
    .where(eq(afkCalendars.userId, user.id));
  const currentCalendars = currentCalendarsEntry[0]?.calendars?.split(",") ?? [];

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(createComponentId(AFK_LINK_FEATURE, user.id, "select"))
      .setPlaceholder(t(LanguageKeys.Commands.Utility.Afklink.selectCalendars))
      .setMinValues(0)
      .setMaxValues(calendars.length)
      .addOptions(
        calendars.map((name) => ({
          label: name,
          value: name,
          default: currentCalendars.includes(name),
        })),
      ),
  );
}

/**
 * Completes the "enter link code" flow: validates the code against the OAuth
 * tables, stores the link, and hands over to the calendar selector.
 */
export async function completeAccountLink(
  interaction: ModalSubmitInteraction,
  linkCode: string,
): Promise<void> {
  const t = await fetchT(interaction);

  await interaction.deferUpdate();

  // check if user gave permission to all scopes
  const calendarAccount = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, linkCode));

  if (!calendarAccount[0] || !calendarAccount[0].refresh_token) {
    void replyLinkError(interaction, "AuthError");
    return;
  }

  const calendarUser = await db
    .select()
    .from(users)
    .where(eq(users.id, calendarAccount[0].userId));

  if (!calendarUser[0] || !calendarUser[0].email) {
    void replyLinkError(interaction, "NoEmail");
    return;
  }

  const calendarScopes = calendarAccount[0].scope?.split(" ");

  if (
    !calendarScopes ||
    !requiredScopes.every((scope) => calendarScopes.includes(scope))
  ) {
    void replyLinkError(interaction, "MissingScopes");
    return;
  }

  await db.insert(linkedAccounts).values({
    userId: interaction.user.id,
    linkCode,
  });

  await interaction.editReply({
    embeds: [
      new EmbedUtils.EmbedConstructor()
        .setTitle(t(LanguageKeys.Commands.Utility.Afklink.successTitle))
        .setDescription(t(LanguageKeys.Commands.Utility.Afklink.successDesc))
        .setColor(Colors.Success),
    ],
    components: [],
  });

  void configureCalendars(interaction);
}

/**
 * Fetches the linked Google account's calendars and replies with the
 * persistent calendar select menu (routed through the afkLinkFlow handler).
 */
export async function configureCalendars(
  interaction: Command.ChatInputCommandInteraction | Message | ModalSubmitInteraction,
): Promise<void> {
  const t = await fetchT(interaction);
  const user =
    interaction instanceof Message ? interaction.author : interaction.user;

  const { calendarUser, calendarAcc } = await verifyAccount(interaction);

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

  const calendarList = await client.calendarList.list().catch((e: unknown) => {
    container.logger.warn("Failed to login to calendar", e);
    void replyLinkError(interaction, "MissingScopes");
    return null;
  });

  if (!calendarList) return;

  if (!calendarList.data.items) {
    void replyLinkError(interaction, "NoneFound");
    return;
  }

  const calendars = calendarList.data.items;

  const calendarNames = [
    ...new Set(
      calendars
        .map(
          (calendar) =>
            calendar.summary ??
            `Calendar ${calendar.id ?? calendars.indexOf(calendar).toString()}`,
        )
        .filter((name) => name),
    ),
  ];

  const selectMenu = await createCalendarSelectMenu(calendarNames, user, t);

  await container.utilities.commandUtils.reply(
    interaction,
    {
      embeds: [
        new EmbedUtils.EmbedConstructor()
          .setTitle(t(LanguageKeys.Commands.Utility.Afklink.selectCalendars))
          .setDescription(
            t(LanguageKeys.Commands.Utility.Afklink.selectCalendarsDescription),
          )
          .setColor(Colors.Default),
      ],
      components: [selectMenu],
    },
    {
      type: PomeloReplyType.Sensitive,
    },
  );
}

/**
 * Persists a calendar selection made through the persistent select menu.
 * The available calendar names are read back from the menu on the message,
 * and the Google account ID is re-derived from the database.
 */
export async function handleCalendarSelection(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const user = interaction.user;
  const t = await fetchT(interaction);

  const selectedCalendars = interaction.values;
  const calendarNames = interaction.component.options.map(
    (option) => option.value,
  );

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
    const { calendarAcc } = await verifyAccount(interaction);
    if (!calendarAcc) return;
    await db.insert(afkCalendars).values({
      userId: user.id,
      calendarId: calendarAcc.providerAccountId,
      calendars: selectedCalendars.join(","),
    });
  }

  const editedEmbed = new EmbedUtils.EmbedConstructor(
    interaction.message.embeds[0].data as EmbedData,
  );
  editedEmbed.setColor(Colors.Success);

  const selectMenu = await createCalendarSelectMenu(calendarNames, user, t);

  const reply = await interaction
    .editReply({
      embeds: [editedEmbed],
      components: [selectMenu],
    })
    .catch(() => null);

  if (!reply) return;

  setTimeout(() => {
    void interaction
      .editReply({
        embeds: [editedEmbed.setColor(Colors.Default)],
      })
      .catch(() => null);
  }, 2500);
}
