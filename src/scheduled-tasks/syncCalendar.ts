import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import { db } from "../db/index.js";
import { linkedAccounts, accounts, syncedEvents } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getCalendar, getCalendarEvents } from "../lib/helpers/calendar.js";
import { DateTime } from "luxon";
import { convertToDiscordTimestamp } from "../lib/helpers/timestamp.js";
import { Emojis } from "../lib/emojis.js";

export class SyncCalendarTask extends ScheduledTask {
  public constructor(
    context: ScheduledTask.LoaderContext,
    options: ScheduledTask.Options
  ) {
    super(context, {
      ...options,
      pattern: "*/5 * * * *",
      name: "syncCalendar",
    });
  }

  public async run() {
    const accs = await db.select().from(linkedAccounts);

    for (const acc of accs) {
      try {
        const calendarAcc = await db
          .select()
          .from(accounts)
          .where(eq(accounts.userId, acc.linkCode));

        if (!calendarAcc[0]) continue;

        const events = await getCalendarEvents(calendarAcc[0]);

        const existingSyncedEvents = await db
          .select()
          .from(syncedEvents)
          .where(eq(syncedEvents.userId, acc.userId));

        const currentEventIds = new Set<string>();
        const existingEventMap = new Map(
          existingSyncedEvents.map((e) => [e.eventId, e])
        );

        for (const event of events) {
          try {
            if (event.recurrence) continue;
            if (!event.id) continue;

            currentEventIds.add(event.id);

            let endTime: Date;
            let startTime: Date;

            const calendar = await getCalendar(
              event.calendarId,
              calendarAcc[0]
            );

            if (!event.start?.dateTime) {
              const tz = event.start?.timeZone ?? calendar.timeZone;
              if (!tz || !event.start?.date) continue;
              const start = DateTime.fromISO(event.start.date, {
                zone: tz,
              }).startOf("day");
              if (!start.isValid) continue;
              startTime = start.toJSDate();
            } else {
              startTime = new Date(event.start.dateTime);
            }

            if (!event.end?.dateTime) {
              const tz = event.end?.timeZone ?? calendar.timeZone;
              if (!tz || !event.end?.date) continue;
              const end = DateTime.fromISO(event.end.date, {
                zone: tz,
              })
                .minus({
                  day: 1,
                })
                .endOf("day");
              if (!end.isValid) continue;
              endTime = end.toJSDate();
            } else {
              endTime = new Date(event.end.dateTime);
            }

            const now = new Date();
            if (endTime <= now) continue;

            const existingEvent = existingEventMap.get(event.id);
            const lastModified = event.updated ? new Date(event.updated) : null;

            if (!existingEvent) {
              if (startTime > now) {
                const delay = startTime.getTime() - now.getTime();
                if (delay > 0 && delay < 365 * 24 * 60 * 60 * 1000) {
                  const task = await this.container.tasks.create(
                    {
                      name: "setAfk",
                      payload: {
                        account: calendarAcc[0],
                        endTime: endTime,
                        startTime: startTime,
                        userId: acc.userId,
                        eventId: event.id,
                      },
                    },
                    delay
                  );

                  await db.insert(syncedEvents).values({
                    userId: acc.userId,
                    eventId: event.id,
                    taskId: task.id,
                    startTime: startTime,
                    endTime: endTime,
                    lastModified: lastModified,
                    afkActive: false,
                  });
                }
              } else if (startTime <= now && endTime > now) {
                await this.container.tasks.create({
                  name: "setAfk",
                  payload: {
                    account: calendarAcc[0],
                    endTime: endTime,
                    startTime: startTime,
                    userId: acc.userId,
                    eventId: event.id,
                  },
                });

                await db.insert(syncedEvents).values({
                  userId: acc.userId,
                  eventId: event.id,
                  taskId: null,
                  startTime: startTime,
                  endTime: endTime,
                  lastModified: lastModified,
                  afkActive: true,
                });
              }
            } else if (
              (lastModified &&
                existingEvent.lastModified &&
                lastModified > existingEvent.lastModified) ||
              existingEvent.startTime.getTime() !== startTime.getTime() ||
              existingEvent.endTime.getTime() !== endTime.getTime()
            ) {
              const eventHasStarted = startTime <= now;
              const eventHasEnded = endTime <= now;
              const eventIsActive = eventHasStarted && !eventHasEnded;

              if (!eventHasStarted) {
                if (existingEvent.taskId) {
                  try {
                    await this.container.tasks.delete(existingEvent.taskId);
                  } catch (error) {
                    this.container.logger.warn(
                      `Failed to delete task ${existingEvent.taskId}:`,
                      error
                    );
                  }
                }

                if (existingEvent.afkActive) {
                  try {
                    await this.container.redis.jsonDel(acc.userId, "Afk");
                  } catch (error) {
                    this.container.logger.warn(
                      `Failed to delete AFK for user ${acc.userId}:`,
                      error
                    );
                  }
                }

                const delay = startTime.getTime() - now.getTime();
                if (delay > 0 && delay < 365 * 24 * 60 * 60 * 1000) {
                  const task = await this.container.tasks.create(
                    {
                      name: "setAfk",
                      payload: {
                        account: calendarAcc[0],
                        endTime: endTime,
                        startTime: startTime,
                        userId: acc.userId,
                        eventId: event.id,
                      },
                    },
                    delay
                  );

                  await db
                    .update(syncedEvents)
                    .set({
                      taskId: task.id,
                      startTime: startTime,
                      endTime: endTime,
                      lastModified: lastModified,
                      afkActive: false,
                    })
                    .where(eq(syncedEvents.eventId, event.id));
                } else {
                  await db
                    .update(syncedEvents)
                    .set({
                      taskId: null,
                      startTime: startTime,
                      endTime: endTime,
                      lastModified: lastModified,
                      afkActive: false,
                    })
                    .where(eq(syncedEvents.eventId, event.id));
                }
              } else if (eventIsActive) {
                if (existingEvent.taskId) {
                  try {
                    await this.container.tasks.delete(existingEvent.taskId);
                  } catch (error) {
                    console.warn(
                      `Failed to delete task ${existingEvent.taskId}:`,
                      error
                    );
                  }
                }

                if (existingEvent.afkActive) {
                  await this.updateAfkTime(acc.userId, endTime, startTime);
                } else {
                  await this.container.tasks.create({
                    name: "setAfk",
                    payload: {
                      account: calendarAcc[0],
                      endTime: endTime,
                      startTime: startTime,
                      userId: acc.userId,
                      eventId: event.id,
                    },
                  });
                }

                await db
                  .update(syncedEvents)
                  .set({
                    taskId: null,
                    startTime: startTime,
                    endTime: endTime,
                    lastModified: lastModified,
                    afkActive: true,
                  })
                  .where(eq(syncedEvents.eventId, event.id));
              } else {
                if (existingEvent.taskId) {
                  try {
                    await this.container.tasks.delete(existingEvent.taskId);
                  } catch (error) {
                    this.container.logger.warn(
                      `Failed to delete task ${existingEvent.taskId}:`,
                      error
                    );
                  }
                }

                if (existingEvent.afkActive) {
                  try {
                    await this.container.redis.jsonDel(acc.userId, "Afk");
                  } catch (error) {
                    this.container.logger.warn(
                      `Failed to delete AFK for user ${acc.userId}:`,
                      error
                    );
                  }
                }

                await db
                  .delete(syncedEvents)
                  .where(eq(syncedEvents.eventId, event.id));
              }
            }
          } catch (error) {
            this.container.logger.warn(
              `Error processing event ${event.id ?? "unknown"}:`,
              error
            );
            continue;
          }
        }

        for (const existingEvent of existingSyncedEvents) {
          if (!currentEventIds.has(existingEvent.eventId)) {
            try {
              if (existingEvent.taskId) {
                try {
                  await this.container.tasks.delete(existingEvent.taskId);
                } catch (error) {
                  this.container.logger.warn(
                    `Failed to delete task ${existingEvent.taskId}:`,
                    error
                  );
                }
              }

              if (existingEvent.afkActive) {
                try {
                  await this.container.redis.jsonDel(acc.userId, "Afk");
                } catch (error) {
                  this.container.logger.warn(
                    `Failed to delete AFK for user ${acc.userId}:`,
                    error
                  );
                }
              }

              await db
                .delete(syncedEvents)
                .where(eq(syncedEvents.eventId, existingEvent.eventId));
            } catch (error) {
              this.container.logger.warn(
                `Error cleaning up deleted event ${existingEvent.eventId}:`,
                error
              );
            }
          }
        }
      } catch (error) {
        this.container.logger.warn(
          `Error processing account ${acc.linkCode}:`,
          error
        );
        continue;
      }
    }
  }

  private async updateAfkTime(
    userId: string,
    newEndTime: Date,
    newStartTime: Date
  ) {
    const currentAfk = await this.container.redis.jsonGet(userId, "Afk");
    if (!currentAfk) return;

    await this.container.redis.jsonSet(userId, "Afk", {
      ...currentAfk,
      endsAt: newEndTime,
      startedAt: newStartTime,
      text: `${Emojis.Automatic} ${convertToDiscordTimestamp(
        newStartTime.getTime(),
        "t"
      )} - ${convertToDiscordTimestamp(newEndTime.getTime(), "t")}`,
    });
  }
}

declare module "@sapphire/plugin-scheduled-tasks" {
  interface ScheduledTasks {
    syncCalendar: never;
  }
}
