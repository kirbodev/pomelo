import { Events, Listener } from "@sapphire/framework";
import type { Presence } from "discord.js";

/**
 * Presence-based AFK auto-removal (opt-in via the autoAfkRemoval user
 * setting). Two-phase state machine so setting AFK while online doesn't
 * instantly clear it:
 * 1. Arm — the user goes offline while AFK; wentOffline is persisted on the
 *    Afk object so the state survives restarts.
 * 2. Fire — the user comes back online (idle/dnd don't count); a delayed
 *    confirmation task re-checks the presence so a brief mobile check-in
 *    doesn't wipe the AFK status.
 */
export const AFK_PRESENCE_CLAIM_PREFIX = "afk-presence-check:";
export const AFK_PRESENCE_CONFIRM_DELAY = 60_000;
// Outlives the confirmation delay so re-scheduling can't race the task.
const CLAIM_TTL_SECONDS = 90;

export class PresenceAfkRemovalListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: Events.PresenceUpdate,
    });
  }

  public async run(oldPresence: Presence | null, newPresence: Presence) {
    if (newPresence.user?.bot) return;
    const newStatus = newPresence.status;
    // Skip activity-only updates and any status that isn't a meaningful
    // transition. PresenceUpdate is high-volume, so exit as early as possible.
    if (oldPresence?.status === newStatus) return;
    if (newStatus !== "offline" && newStatus !== "online") return;

    const userId = newPresence.userId;
    const settings = await this.container.redis.jsonGet(
      userId,
      "UserSettings",
    );
    if (!settings?.autoAfkRemoval) return;

    // Only the manual AFK key — calendar (AUTO) AFKs are managed by their
    // event window, never presence.
    const afkData = await this.container.redis.jsonGet(userId, "Afk");
    if (!afkData) return;
    if (afkData.eventId) return;

    if (newStatus === "offline") {
      if (afkData.wentOffline) return;
      await this.container.redis.jsonUpdate(userId, "Afk", {
        wentOffline: true,
      });
      return;
    }

    // Back online — only fire when the removal was armed by going offline.
    if (!afkData.wentOffline) return;

    // The event fires once per mutual guild; claim atomically so only one
    // confirmation task gets scheduled.
    const claimed = await this.container.redis.set(
      `${AFK_PRESENCE_CLAIM_PREFIX}${userId}`,
      "1",
      "EX",
      CLAIM_TTL_SECONDS,
      "NX",
    );
    if (claimed !== "OK") return;

    await this.container.tasks.create(
      {
        name: "confirmAfkPresenceRemoval",
        payload: { userId },
      },
      AFK_PRESENCE_CONFIRM_DELAY,
    );
  }
}
