import { Events, Listener } from "@sapphire/framework";
import { PermissionFlagsBits, type GuildMember } from "discord.js";
import {
  PUNISHMENT_ROLE_SYSTEM_ACTOR,
  getActiveWarnExpiries,
  getPersistedPunishmentRoles,
  releasePunishmentRoles,
} from "../../lib/moderation/punishmentRoles.js";

/**
 * Reapplies persisted warn punishment roles when a member rejoins, so
 * leaving and rejoining can't be used to shed a role punishment. Every
 * record is revalidated against the warn ledger and the guild's role state
 * before anything is assigned.
 */
export class ReapplyPunishmentRolesListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: Events.GuildMemberAdd,
    });
  }

  public async run(member: GuildMember) {
    const guild = member.guild;
    const records = await getPersistedPunishmentRoles(guild.id, member.id);
    if (records.length === 0) return;

    // The stored record is routing, not authorization — check the user still
    // has enough active warns to justify each role.
    const activeCount = (await getActiveWarnExpiries(guild.id, member.id))
      .length;
    const unjustified = records.filter(
      (record) => record.warnLevel > activeCount,
    );
    if (unjustified.length > 0)
      await releasePunishmentRoles({
        guildId: guild.id,
        userId: member.id,
        roleIds: unjustified.map((record) => record.roleId),
        removedBy: PUNISHMENT_ROLE_SYSTEM_ACTOR,
      });

    const justified = records.filter(
      (record) => record.warnLevel <= activeCount,
    );
    if (justified.length === 0) return;

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return;

    const assignable: string[] = [];
    const deleted: string[] = [];
    for (const record of justified) {
      const role =
        guild.roles.cache.get(record.roleId) ??
        (await guild.roles.fetch(record.roleId).catch(() => null));
      if (!role) {
        deleted.push(record.roleId);
        continue;
      }
      if (role.managed || me.roles.highest.comparePositionTo(role) <= 0)
        continue;
      if (member.roles.cache.has(role.id)) continue;
      assignable.push(role.id);
    }

    if (deleted.length > 0)
      await releasePunishmentRoles({
        guildId: guild.id,
        userId: member.id,
        roleIds: deleted,
        removedBy: PUNISHMENT_ROLE_SYSTEM_ACTOR,
      });
    if (assignable.length === 0) return;

    await member.roles
      .add(assignable, "Reapplied warn punishment role after rejoin.")
      .catch(() => null);
  }
}
