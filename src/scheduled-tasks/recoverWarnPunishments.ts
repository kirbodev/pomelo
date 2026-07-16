import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import { modActionService } from "../lib/moderation/actions.js";

export class RecoverWarnPunishmentsTask extends ScheduledTask {
  public constructor(
    context: ScheduledTask.LoaderContext,
    options: ScheduledTask.Options,
  ) {
    super(context, options);
  }

  public async run(): Promise<void> {
    await modActionService.recoverExpiredClaims();
  }
}

declare module "@sapphire/plugin-scheduled-tasks" {
  interface ScheduledTasks {
    recoverWarnPunishments: undefined;
  }
}
