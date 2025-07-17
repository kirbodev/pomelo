import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import type { Account } from "../db/schema.js";
import { convertToDiscordTimestamp } from "../lib/helpers/timestamp.js";
import { Emojis } from "../lib/emojis.js";
import { AfkCommand } from "../commands/utility/afk.js";

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

    await AfkCommand.setAfk(data.userId, {
      startedAt: startTime,
      endsAt: endTime,
      text: AfkCalendarTask.createAutoAFKMessage(startTime, endTime),
      eventId: data.eventId,
    });
  }

  static createAutoAFKMessage(newStartTime: Date, newEndTime: Date) {
    const startTime = newStartTime.getTime();
    const endTime = newEndTime.getTime();
    const timeOverflow = endTime - startTime;
    let longTime = false;
    if (timeOverflow > 24 * 60 * 60 * 1000) {
      longTime = true;
    }

    return `${Emojis.Automatic} ${convertToDiscordTimestamp(
      startTime,
      longTime ? "f" : "t"
    )} - ${convertToDiscordTimestamp(endTime, longTime ? "f" : "t")}`;
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
