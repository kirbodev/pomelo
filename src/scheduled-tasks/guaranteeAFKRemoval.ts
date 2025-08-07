import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import {
  deleteAFKData,
  getAFKData,
  removeAutomod,
} from "../lib/helpers/afk.js";

export class GuaranteeAFKRemoval extends ScheduledTask {
  public constructor(
    context: ScheduledTask.LoaderContext,
    options: ScheduledTask.Options,
  ) {
    super(context, {
      ...options,
    });
  }

  public async run(payload: { userId: string }) {
    const afk = await getAFKData(payload.userId);
    if (!afk) return;
    if (afk.eventId) return;
    if (afk.endsAt && new Date(afk.endsAt).getTime() < Date.now()) {
      await deleteAFKData(payload.userId);
      await removeAutomod(payload.userId);
    }
  }
}

declare module "@sapphire/plugin-scheduled-tasks" {
  interface ScheduledTasks {
    guaranteeAFKRemoval: {
      userId: string;
    };
  }
}
