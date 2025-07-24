import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import type { Account } from "../db/schema.js";
import { createAutoAFKMessage, setAfk } from "../lib/helpers/afk.js";

export class AfkCalendarTask extends ScheduledTask {
  public constructor(
    context: ScheduledTask.LoaderContext,
    options: ScheduledTask.Options
  ) {
    super(context, {
      ...options,
    });
  }

  public async run(payload: unknown) {
    if (
      !payload ||
      typeof payload !== "object" ||
      !("account" in payload) ||
      !("endTime" in payload) ||
      !("userId" in payload) ||
      !("startTime" in payload) ||
      !("eventId" in payload)
    )
      return;
    const data = payload as {
      account: Account;
      endTime: Date;
      userId: string;
      startTime: Date;
      eventId: string;
    };

    const startTime = new Date(data.startTime);
    const endTime = new Date(data.endTime);

    await setAfk(`${data.userId}AUTO`, {
      startedAt: startTime,
      endsAt: endTime,
      text: createAutoAFKMessage(startTime, endTime),
      eventId: data.eventId,
    });
  }
}

declare module "@sapphire/plugin-scheduled-tasks" {
  interface ScheduledTasks {
    setAfk: {
      account: Account;
      endTime: Date;
      userId: string;
      startTime: Date;
      eventId: string;
    };
  }
}
