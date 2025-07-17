import { Events, Listener } from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildTextBasedChannel,
} from "discord.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import { Colors } from "../../lib/colors.js";

export class OnboardingListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options
  ) {
    super(context, {
      ...options,
      event: Events.GuildCreate,
    });
  }

  public async run(guild: Guild) {
    if (!guild.available) return;

    const settings = await this.container.redis.jsonGet(
      guild.id,
      "GuildSettings"
    );
    if (settings) return;

    const t = await fetchT(guild);
    const updateChannel = await OnboardingListener.findModChannel(guild);
    if (!updateChannel) return;
    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(t(LanguageKeys.Messages.Onboarding.title))
      .setDescription(t(LanguageKeys.Messages.Onboarding.desc))
      .setColor(Colors.Default);
    await updateChannel.send({ embeds: [embed] });
  }

  static async findModChannel(guild: Guild) {
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) return;
    const textChannels = channels.filter(
      (c) => c !== null && c.type === ChannelType.GuildText
    );
    const modRoles = getModRoles(guild);
    if (modRoles.size === 0) return createOnboardingChannel(guild);
    const modChannels = textChannels.filter((c) => {
      const permissionsMap = c.permissionOverwrites.cache;
      const permissions = Array.from(permissionsMap.keys());
      return permissions.some((p) => {
        return modRoles.some((r) => {
          return p === r.id;
        });
      });
    });
    if (modChannels.size === 0) {
      return createOnboardingChannel(guild);
    }
    return modChannels.first();
  }
}

function getModRoles(guild: Guild) {
  const modRoles = guild.roles.cache.filter((r) => {
    if (r.managed) return false;
    return r.permissions.has(PermissionFlagsBits.ManageGuild);
  });
  return modRoles;
}

async function createOnboardingChannel(
  guild: Guild
): Promise<GuildTextBasedChannel> {
  const existingChannel = guild.channels.cache.find(
    (c) => c.name === "pomelo-onboarding"
  );
  if (existingChannel) return existingChannel as GuildTextBasedChannel;
  return await guild.channels.create({
    name: "pomelo-onboarding",
    type: ChannelType.GuildText,
    position: 0,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: PermissionFlagsBits.ViewChannel,
      },
      {
        id: guild.client.user.id,
        allow: PermissionFlagsBits.ViewChannel,
      },
      ...getModRoles(guild).map((r) => {
        return {
          id: r.id,
          allow: PermissionFlagsBits.ViewChannel,
        };
      }),
    ],
  });
}
