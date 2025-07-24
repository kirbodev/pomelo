import { Listener } from "@sapphire/framework";
import { Events } from "@sapphire/framework";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type Message,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { fetchT, type TFunction } from "@sapphire/plugin-i18next";
import { Colors } from "../../lib/colors.js";
import { PomeloReplyType } from "../../utilities/commandUtils.js";
import { DEFAULT_EPHEMERAL_DELETION_TIMEOUT } from "../../lib/helpers/constants.js";
import ms from "ms";
import { recentReversions } from "./preventAutomodRuleEdit.js";
import {
  deleteAFKData,
  getAFKData,
  getAFKSetEmbed,
} from "../../lib/helpers/afk.js";
import { Emojis } from "../../lib/emojis.js";
import { nanoid } from "nanoid";
import type { Afk } from "../../db/redis/schema.js";

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
    options: Listener.Options
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
      "GuildSettings"
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
        message.content.toLowerCase().trim().endsWith(prefix)
      )
    )
      return;

    await deleteAFKData(message.author.id);

    if (message.member?.nickname && message.member.nickname.startsWith("[AFK]"))
      await message.member
        .setNickname(message.member.nickname.replace("[AFK] ", ""))
        .catch(() => null);

    const buttonId = nanoid();
    const revertButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
      new ButtonBuilder()
        .setCustomId(buttonId)
        .setEmoji(Emojis.Undo)
        .setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(t(LanguageKeys.Commands.Utility.Afk.removeTitle))
      .setDescription(
        t(LanguageKeys.Commands.Utility.Afk.removeDescription, {
          time: ms(Date.now() - new Date(afkData.startedAt).getTime(), {
            long: true,
          }),
        })
      )
      .setFooter({
        text: t(LanguageKeys.Commands.Utility.Afk.removeTip),
      })
      .setColor(Colors.Success);

    const autoModRules = await message.guild.autoModerationRules
      .fetch()
      .catch(() => null);
    if (autoModRules) {
      const afkRule = autoModRules.find(
        (r) => r.creatorId === message.client.id && r.name.includes("AFK")
      );
      if (afkRule) {
        const blockedAfks = [...afkRule.triggerMetadata.keywordFilter];
        const blockedIndex = blockedAfks.indexOf(message.author.id);
        if (blockedIndex > -1) blockedAfks.splice(blockedIndex, 1);

        const allowList = [...afkRule.triggerMetadata.allowList];
        const allowListIndex = allowList.indexOf(message.author.id);
        if (allowListIndex > -1) allowList.splice(allowListIndex, 1);

        recentReversions.set(afkRule.id, Date.now());
        setTimeout(() => {
          recentReversions.delete(afkRule.id);
        }, 5000).unref();

        await afkRule.edit({
          triggerMetadata: {
            keywordFilter: blockedAfks,
            allowList,
          },
        });
      }
    }

    const response = await this.container.utilities.commandUtils.reply(
      message,
      {
        embeds: [embed],
        components: [revertButton],
      },
      {
        type: PomeloReplyType.Success,
      }
    );
    setTimeout(() => {
      void response.delete().catch(() => null);
    }, (guildSettings?.ephemeralDeletionTimeout ?? DEFAULT_EPHEMERAL_DELETION_TIMEOUT) * 1000);

    void response
      .awaitMessageComponent({
        filter: (i) => i.customId === buttonId,
        componentType: ComponentType.Button,
        time:
          (guildSettings?.ephemeralDeletionTimeout ??
            DEFAULT_EPHEMERAL_DELETION_TIMEOUT) * 1000,
      })
      .catch(() => null)
      .then(async (i) => {
        if (!i) return;
        await this.handleButton(i, afkData, t, message.author.id);
        void this.container.utilities.componentUtils.disableButtons(response);
      });
  }

  public async handleButton(
    interaction: ButtonInteraction,
    afkData: Afk,
    t: TFunction,
    userId: string
  ) {
    if (interaction.user.id !== userId) return;
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    await this.container.redis.jsonSet(interaction.user.id, "Afk", afkData);

    const duration = afkData.endsAt
      ? new Date(afkData.endsAt).getTime() - Date.now()
      : undefined;
    const embed = getAFKSetEmbed(t, afkData.text, duration, afkData.attachment);

    return await this.container.utilities.commandUtils.reply(
      interaction,
      {
        embeds: [embed],
      },
      {
        type: PomeloReplyType.Sensitive,
      }
    );
  }
}
