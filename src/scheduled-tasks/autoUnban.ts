import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import { db } from "../db/index.js";
import {
  ModActionService,
  type PunishmentCapabilityAdapter,
} from "../lib/moderation/actions.js";

type AutoUnbanPayload = {
  guildId: string;
  userId: string;
  internalCaseId: number;
  token: string;
};

export class AutoUnbanTask extends ScheduledTask {
  public constructor(
    context: ScheduledTask.LoaderContext,
    options: ScheduledTask.Options,
  ) {
    super(context, options);
  }

  public async run(payload: AutoUnbanPayload): Promise<void> {
    const guild = this.container.client.guilds.cache.get(payload.guildId);
    if (!guild) throw new Error("autoUnbanGuildUnavailable");

    const adapter: PunishmentCapabilityAdapter = {
      resolve: () =>
        Promise.reject(new Error("autoUnbanDoesNotResolvePunishments")),
      apply: () =>
        Promise.reject(new Error("autoUnbanDoesNotApplyPunishments")),
      scheduleAutoUnban: () =>
        Promise.reject(new Error("autoUnbanDoesNotSchedulePunishments")),
      unban: async ({ userId, reason }) => {
        await guild.bans.remove(userId, reason);
        return { success: true };
      },
    };
    const service = new ModActionService(db, Date.now, adapter);
    await service.runAutoUnban(payload);
  }
}

declare module "@sapphire/plugin-scheduled-tasks" {
  interface ScheduledTasks {
    autoUnban: AutoUnbanPayload;
  }
}
