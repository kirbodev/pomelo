import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import { db } from "../db/index.js";
import { linkedAccounts, accounts, afkCalendars } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { google } from "googleapis";
import { getCalendarEvents } from "../lib/helpers/calendar.js";

export class SyncCalendarTask extends ScheduledTask {
    public constructor(context: ScheduledTask.LoaderContext, options: ScheduledTask.Options) {
        super(context, {
            ...options,
            pattern: "*/5 * * * *",
        });
    }

    public async run() {
        const accs = await db.select().from(linkedAccounts);

        for (const acc of accs) {
            const calendarAcc = await db.select().from(accounts).where(eq(accounts.userId, acc.linkCode));

            if (!calendarAcc[0]) continue;

            const events = await getCalendarEvents(calendarAcc[0]);

            for (const event of events) {
                if (!event.end?.date && !event.end?.dateTime) continue;
                //STUB - eod for no end time
                this.container.tasks.create({
                    name: "setAfk",
                    payload: {
                        account: calendarAcc[0],
                        endTime: event.end?.dateTime ?? event.end?.date,
                        userId: acc.userId,
                    }
                })
            }
        }
    }
}

declare module '@sapphire/plugin-scheduled-tasks' {
    interface ScheduledTasks {
        syncCalendar: never;
    }
}