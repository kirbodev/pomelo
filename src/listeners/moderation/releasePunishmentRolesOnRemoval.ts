import { Events, Listener } from "@sapphire/framework";
import type { GuildMember } from "discord.js";
import {
  PUNISHMENT_ROLE_MANUAL_ACTOR,
  releasePunishmentRoles,
} from "../../lib/moderation/punishmentRoles.js";

/**
 * When staff strip a persisted punishment role straight through Discord,
 * stop tracking it — otherwise the bot would fight them by reapplying it on
 * the next rejoin. Releases done by the bot itself are already marked
 * removed before the role comes off, so this is a no-op for those.
 */
export class ReleasePunishmentRolesOnRemovalListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: Events.GuildMemberUpdate,
    });
  }

  public async run(oldMember: GuildMember, member: GuildMember) {
    const removedRoleIds = [...oldMember.roles.cache.keys()].filter(
      (roleId) => !member.roles.cache.has(roleId),
    );
    if (removedRoleIds.length === 0) return;

    await releasePunishmentRoles({
      guildId: member.guild.id,
      userId: member.id,
      roleIds: removedRoleIds,
      removedBy: PUNISHMENT_ROLE_MANUAL_ACTOR,
    });
  }
}
