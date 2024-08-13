import { Events, Listener } from "@sapphire/framework";

export class ReadyListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options
  ) {
    super(context, {
      ...options,
      once: true,
      event: Events.ClientReady,
    });
  }

  public run() {
    if (process.env.DEV) return;
    setInterval(() => {
      this.sendHeartbeats();
    }, 1000 * 60).unref();
    this.sendHeartbeats();
  }

  private sendHeartbeats() {
    if (!process.env.HEARTBEAT_URL) return;
    fetch(process.env.HEARTBEAT_URL).catch(() => {
      this.container.logger.error("Failed to send heartbeat");
    });
  }
}
