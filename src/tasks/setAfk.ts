import { ScheduledTask } from '@sapphire/plugin-scheduled-tasks';
import type { Account } from '../db/schema.js';
import { getCalendarEvents, isEventOngoing } from '../lib/helpers/calendar.js';
import { convertToDiscordTimestamp } from '../lib/helpers/timestamp.js';

export class AfkCalendarTask extends ScheduledTask {
    public constructor(context: ScheduledTask.LoaderContext, options: ScheduledTask.Options) {
        super(context, {
            ...options,
        });
    }

    public async run(payload: unknown) {
        if (!payload || typeof payload !== "object" || !("account" in payload) || !("endTime" in payload) || !("userId" in payload)) return;
        const data = payload as { account: Account; endTime: Date; userId: string };

        const ongoing = await isEventOngoing(data.account);

        if (!ongoing) return;

        await this.container.redis.jsonSet(data.userId, "Afk", {
            startedAt: new Date(),
            endsAt: data.endTime,
            text: `(AUTO) AFK: ${convertToDiscordTimestamp(Date.now(), "t")} - ${convertToDiscordTimestamp(data.endTime.getTime(), "t")}`,
        });
    }
}

declare module '@sapphire/plugin-scheduled-tasks' {
    interface ScheduledTasks {
        setAfk: never;
    }
}