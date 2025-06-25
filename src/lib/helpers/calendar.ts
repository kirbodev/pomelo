import { calendar_v3, google } from "googleapis";
import { afkCalendars, type Account } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";

export async function getCalendarEvents(calendarAcc: Account) {
    const selectedCalendars = await db.select().from(afkCalendars).where(eq(afkCalendars.calendarId, calendarAcc.userId));

    if (!selectedCalendars.length) return [];

    const oauth = new google.auth.OAuth2({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        credentials: {
            access_token: calendarAcc.access_token,
            refresh_token: calendarAcc.refresh_token,
            expiry_date: calendarAcc.expires_at,
            token_type: calendarAcc.token_type,
            id_token: calendarAcc.id_token,
            scope: calendarAcc.scope ?? undefined,
        }
    })

    const client = google.calendar({
        version: "v3",
        auth: oauth,
    });

    let events: calendar_v3.Schema$Event[] = [];

    for (const calendar of selectedCalendars) {
        const calendarEvents = await client.events.list({
            calendarId: calendar.calendarId,
            timeMin: new Date().toISOString(),
            timeMax: new Date(new Date().getTime() + 60 * 60 * 24 * 1000).toISOString(),
            singleEvents: true,
            orderBy: "startTime",
        });

        events = events.concat(calendarEvents.data.items ?? []);
    }

    events.sort((a, b) => {
        if (!a.start?.dateTime || !b.start?.dateTime) return 0;
        return new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime();
    });

    events = events.filter((event) => event.eventType === "default" && event.status === "confirmed");

    return events;
}

export async function isEventOngoing(calendarAcc: Account) {
    const events = await getCalendarEvents(calendarAcc);
    const now = new Date();
    return events.some((event) => event.start?.dateTime && new Date(event.start.dateTime) < now && (event.end?.dateTime && new Date(event.end.dateTime) > now || event.end?.date && new Date(event.end.date) > now));
}