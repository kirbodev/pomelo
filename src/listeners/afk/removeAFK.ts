import { Listener } from "@sapphire/framework";
import { Events } from "@sapphire/framework";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Message,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { fetchT } from "@sapphire/plugin-i18next";
import { Colors } from "../../lib/colors.js";
import { PomeloReplyType } from "../../utilities/commandUtils.js";
import { DEFAULT_EPHEMERAL_DELETION_TIMEOUT } from "../../lib/helpers/constants.js";
import ms from "ms";
import { deleteAFKData, getAFKData, restoreAfkNicknames } from "../../lib/helpers/afk.js";
import { Emojis } from "../../lib/emojis.js";
import { nanoid } from "nanoid";
import {
  createComponentId,
  saveComponentSession,
} from "../../lib/helpers/componentSessions.js";

export const AFK_REVERT_FEATURE = "ar";

const NO_REMOVE_AFK_PREFIXES = [
  "--afk",
  "-afk",
  "——afk",
  "—afk",
  "––afk",
  "–afk",
];

export class RemoveAFKListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: Events.MessageCreate,
    });
  }

  public async run(message: Message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const guildSettings = await this.container.redis.jsonGet(
      message.guild.id,
      "GuildSettings",
    );
    if (message.content.startsWith(guildSettings?.prefix ?? ",")) return;

    const t = await fetchT(message);
    const afkData = await getAFKData(message.author.id);
    if (!afkData) return;
    if (afkData.endsAt && new Date(afkData.endsAt) < new Date()) {
      await deleteAFKData(message.author.id);
    }
    if (afkData.eventId) return;
    if (
      NO_REMOVE_AFK_PREFIXES.some((prefix) =>
        message.content.toLowerCase().trim().endsWith(prefix),
      )
    )
      return;

    await deleteAFKData(message.author.id);

    if (
      message.member?.nickname &&
      message.member.nickname.startsWith("[AFK]")
    ) {
      await restoreAfkNicknames(message.author.id, afkData);
    }

    const deletionTimeoutSeconds =
      guildSettings?.ephemeralDeletionTimeout ??
      DEFAULT_EPHEMERAL_DELETION_TIMEOUT;

    // Persistent revert button — routed through the afkRevert interaction
    // handler with the previous AFK state stored in Redis until the reply is
    // deleted.
    const sessionId = nanoid();
    await saveComponentSession(
      AFK_REVERT_FEATURE,
      sessionId,
      { userId: message.author.id, afk: afkData },
      Math.max(deletionTimeoutSeconds, 1),
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
        t(LanguageKeys.Commands.Utility.Afk.removeDescription, {
          time: ms(Date.now() - new Date(afkData.startedAt).getTime(), {
            long: true,
          }),
        }),
      )
      .setFooter({
        text: t(LanguageKeys.Commands.Utility.Afk.removeTip),
      })
      .setColor(Colors.Success);

    await this.container.tasks.create({
      name: "guaranteeAFKRemoval",
      payload: {
        userId: message.author.id,
      },
    });

    const response = await this.container.utilities.commandUtils.reply(
      message,
      {
        embeds: [embed],
        components: [revertButton],
      },
      {
        type: PomeloReplyType.Success,
      },
    );
    setTimeout(() => {
      void response.delete().catch(() => null);
    }, deletionTimeoutSeconds * 1000);
  }
}
