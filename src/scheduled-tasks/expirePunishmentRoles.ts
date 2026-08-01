import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import { sweepExpiredPunishmentRoles } from "../lib/moderation/punishmentRoles.js";

/**
 * Periodically releases punishment roles whose backing warns have expired,
 * removing the role from the member when they're still in the guild. Runs
 * off persisted state, so expiries are honored across restarts.
 */
export class ExpirePunishmentRolesTask extends ScheduledTask {
  public constructor(
    context: ScheduledTask.LoaderContext,
    options: ScheduledTask.Options,
  ) {
    super(context, {
      ...options,
      pattern: "*/5 * * * *",
      name: "expirePunishmentRoles",
    });
  }

  public async run(): Promise<void> {
    await sweepExpiredPunishmentRoles();
  }
}

declare module "@sapphire/plugin-scheduled-tasks" {
  interface ScheduledTasks {
    expirePunishmentRoles: undefined;
  }
}
