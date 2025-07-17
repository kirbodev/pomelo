import { calendar_v3, google } from "googleapis";
import { afkCalendars, type Account } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";

export type PomeloCalendarEvent = calendar_v3.Schema$Event & {
  calendarId: string;
};

export async function getCalendarEvents(calendarAcc: Account) {
  const calendars = await db
    .select()
    .from(afkCalendars)
    .where(eq(afkCalendars.calendarId, calendarAcc.providerAccountId));

  const selectedCalendars = calendars[0]?.calendars?.split(",") ?? [];

  if (!selectedCalendars.length) return [];

  const oauth = new google.auth.OAuth2({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uris: [
      "https://kdv.one",
      "https://pom.kdv.one",
      "https://pomelo.kdv.one",
      "https://pom.kdv.one/api/auth/callback/google",
      "http://localhost:3000/api/auth/callback/google",
    ],
  });

  oauth.setCredentials({
    access_token: calendarAcc.access_token,
    refresh_token: calendarAcc.refresh_token,
  });

  const client = google.calendar({
    version: "v3",
    auth: oauth,
  });

  let events: PomeloCalendarEvent[] = [];

  for (const calendar of selectedCalendars) {
    const calendarEvents = await client.events.list({
      calendarId: calendar,
      timeMin: new Date().toISOString(),
      timeMax: new Date(
        new Date().getTime() + 60 * 60 * 24 * 1000
      ).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    events = events.concat(
      calendarEvents.data.items?.map((e) => {
        return {
          ...e,
          calendarId: calendar,
        };
      }) ?? []
    );
  }

  events.sort((a, b) => {
    if (!a.start?.dateTime || !b.start?.dateTime) return 0;
    return (
      new Date(a.start.dateTime).getTime() -
      new Date(b.start.dateTime).getTime()
    );
  });

  events = events.filter(
    (event) => event.eventType === "default" && event.status === "confirmed"
  );

  return events;
}

export async function isEventOngoing(calendarAcc: Account) {
  const events = await getCalendarEvents(calendarAcc);
  const now = new Date();
  return events.some(
    (event) =>
      event.start?.dateTime &&
      new Date(event.start.dateTime) < now &&
      ((event.end?.dateTime && new Date(event.end.dateTime) > now) ||
        (event.end?.date && new Date(event.end.date) > now))
  );
}

export async function getCalendar(calendarId: string, calendarAcc: Account) {
  const oauth = new google.auth.OAuth2({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uris: [
      "https://kdv.one",
      "https://pom.kdv.one",
      "https://pomelo.kdv.one",
      "https://pom.kdv.one/api/auth/callback/google",
      "http://localhost:3000/api/auth/callback/google",
    ],
  });

  oauth.setCredentials({
    access_token: calendarAcc.access_token,
    refresh_token: calendarAcc.refresh_token,
  });

  const client = google.calendar({
    version: "v3",
    auth: oauth,
  });

  const calendar = await client.calendars.get({
    calendarId: calendarId,
  });

  return calendar.data;
}
