import { ScheduledTask } from "@sapphire/plugin-scheduled-tasks";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import ms from "ms";
import { nanoid } from "nanoid";
import { Colors } from "../lib/colors.js";
import { Emojis } from "../lib/emojis.js";
import {
  deleteAFKData,
  removeAutomod,
  restoreAfkNicknames,
} from "../lib/helpers/afk.js";
import {
  createComponentId,
  saveComponentSession,
} from "../lib/helpers/componentSessions.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { fetchT } from "../lib/i18n/utils.js";
import { AFK_PRESENCE_CLAIM_PREFIX } from "../listeners/afk/presenceAfkRemoval.js";
import { AFK_REVERT_FEATURE } from "../listeners/afk/removeAFK.js";
import EmbedUtils from "../utilities/embedUtils.js";

// Long window on purpose — the DM sticks around, so the undo shouldn't die
// seconds after it arrives.
const REVERT_SESSION_TTL_SECONDS = 10 * 60;

/**
 * Second half of the presence-based AFK removal (see the
 * PresenceAfkRemovalListener in listeners/afk). Runs a minute after the user
 * came back online and only removes the AFK status if they're still online —
 * a brief mobile check-in shouldn't wipe it.
 */
export class ConfirmAfkPresenceRemoval extends ScheduledTask {
  public constructor(
    context: ScheduledTask.LoaderContext,
    options: ScheduledTask.Options,
  ) {
    super(context, {
      ...options,
    });
  }

  public async run(payload: { userId: string }) {
    const { userId } = payload;
    // Free the claim so a later online transition can schedule a new check.
    await this.container.redis.del(`${AFK_PRESENCE_CLAIM_PREFIX}${userId}`);

    const settings = await this.container.redis.jsonGet(
      userId,
      "UserSettings",
    );
    if (!settings?.autoAfkRemoval) return;

    const afkData = await this.container.redis.jsonGet(userId, "Afk");
    if (!afkData) return;
    if (afkData.eventId) return;
    if (!afkData.wentOffline) return;

    // Still online somewhere? Offline (or no cached presence at all) means
    // they left again, so the AFK status stays.
    const stillBack = this.container.client.guilds.cache.some((guild) => {
      const presence = guild.presences.cache.get(userId);
      return presence !== undefined && presence.status !== "offline";
    });
    if (!stillBack) return;

    await deleteAFKData(userId);
    await restoreAfkNicknames(userId, afkData);
    await removeAutomod(userId);

    // DM a welcome-back note with the persistent revert button. Closed DMs
    // just mean a silent removal.
    const user = await this.container.client.users
      .fetch(userId)
      .catch(() => null);
    if (!user) return;

    const t = await fetchT(userId);
    const sessionId = nanoid();
    await saveComponentSession(
      AFK_REVERT_FEATURE,
      sessionId,
      // Revert restores an unarmed AFK so a later idle→online flap can't
      // instantly re-remove it.
      { userId, afk: { ...afkData, wentOffline: undefined } },
      REVERT_SESSION_TTL_SECONDS,
    );
    const revertButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
      new ButtonBuilder()
        .setCustomId(createComponentId(AFK_REVERT_FEATURE, sessionId))
        .setEmoji(Emojis.Undo)
        .setStyle(ButtonStyle.Secondary),
    );

    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(t(LanguageKeys.Commands.Utility.Afk.removeTitle))
      .setDescription(
        t(LanguageKeys.Commands.Utility.Afk.autoRemoveDescription, {
          time: ms(Date.now() - new Date(afkData.startedAt).getTime(), {
            long: true,
          }),
        }),
      )
      .setColor(Colors.Success);

    await user
      .send({
        embeds: [embed],
        components: [revertButton],
      })
      .catch(() => null);
  }
}

declare module "@sapphire/plugin-scheduled-tasks" {
  interface ScheduledTasks {
    confirmAfkPresenceRemoval: {
      userId: string;
    };
  }
}
