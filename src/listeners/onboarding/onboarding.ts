import { Events, Listener } from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import {
  ChannelType,
  Collection,
  PermissionFlagsBits,
  Role,
  type Guild,
  type GuildTextBasedChannel,
  type NonThreadGuildBasedChannel,
} from "discord.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import { Colors } from "../../lib/colors.js";
import { GuildSettings } from "../../db/redis/schema.js";
import { fallbackLanguage } from "../../lib/i18n/utils.js";
import type z from "zod";

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

    const newSettings = GuildSettings.parse({
      locale: fallbackLanguage(guild.preferredLocale),
    } as z.infer<typeof GuildSettings>);
    await this.container.redis.jsonSet(guild.id, "GuildSettings", newSettings);

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
    const modChannels = filterChannels(textChannels, modRoles);
    if (modChannels.length === 0) {
      return createOnboardingChannel(guild);
    }
    return modChannels[0];
  }
}

function filterChannels(
  channels: Collection<string, NonThreadGuildBasedChannel | null>,
  modRoles: Collection<string, Role>
) {
  const textChannels = channels.filter(
    (c) => c !== null && c.type === ChannelType.GuildText
  );
  const categoryChannels = channels.filter(
    (c) => c !== null && c.type === ChannelType.GuildCategory
  );
  const modChannels = textChannels.filter((c) => {
    const permissionsMap = c.permissionOverwrites.cache;
    const permissions = Array.from(permissionsMap.entries());
    return permissions.some((p) => {
      return modRoles.some((r) => {
        return p[0] === r.id && p[1].allow.has(PermissionFlagsBits.ViewChannel);
      });
    });
  });
  const modCategories = categoryChannels.filter((c) => {
    const permissionsMap = c.permissionOverwrites.cache;
    const permissions = Array.from(permissionsMap.entries());
    return permissions.some((p) => {
      return modRoles.some((r) => {
        return p[0] === r.id && p[1].allow.has(PermissionFlagsBits.ViewChannel);
      });
    });
  });
  const modCategoryChannels = modCategories.flatMap((c) => {
    const children = c.children.cache.filter(
      (c) => c.type === ChannelType.GuildText
    );
    return children.filter((c) => {
      const permissionsMap = c.permissionOverwrites.cache;
      const permissions = Array.from(permissionsMap.entries());
      return permissions.some((p) => {
        return modRoles.some((r) => {
          return (
            p[0] === r.id && p[1].allow.has(PermissionFlagsBits.ViewChannel)
          );
        });
      });
    });
  });

  return [...modChannels.values(), ...modCategoryChannels.values()];
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
