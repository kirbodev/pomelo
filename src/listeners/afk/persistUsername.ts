import { Events, Listener } from "@sapphire/framework";
import type { GuildMember } from "discord.js";

export class PersistUsernameListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options
  ) {
    super(context, {
      ...options,
      event: Events.GuildMemberUpdate,
    });
  }

  public async run(oldMember: GuildMember, member: GuildMember) {
    if (member.nickname === oldMember.nickname) return;
    if (!oldMember.nickname?.startsWith("[AFK] ")) return;
    if (member.nickname?.startsWith("[AFK] ")) return;

    const afkData = await this.container.redis.jsonGet(member.id, "Afk");
    if (!afkData) return;

    if (afkData.endsAt && afkData.endsAt.getTime() > Date.now()) return;

    await member
      .setNickname(`[AFK] ${member.nickname ?? member.displayName}`)
      .catch(() => null);
  }
}
