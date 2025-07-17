import { container, Events, Listener } from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import {
  AuditLogEvent,
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  Guild,
  type AutoModerationRule,
  type AutoModerationRuleCreateOptions,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import { URGENT_PING } from "../../lib/helpers/constants.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import { Colors } from "../../lib/colors.js";

export const recentReversions: Map<string, number> = new Map();

export class EditListener extends Listener {
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options
  ) {
    super(context, {
      ...options,
      event: Events.AutoModerationRuleUpdate,
    });
  }

  public async run(
    oldRule: AutoModerationRule | null,
    rule: AutoModerationRule
  ) {
    return EditListener.handler(rule, false);
  }

  static async handler(rule: AutoModerationRule, deleted = false) {
    if (rule.creatorId !== container.client.user?.id) return;
    if (recentReversions.has(rule.id)) return;
    const guildT = await fetchT(rule.guild);
    //NOTE - This will detect every automod rule from pomelo as the AFK rule, this may have to be updated if more rules are added in the future

    const guildSettings = await container.redis.jsonGet(
      rule.guild.id,
      "GuildSettings"
    );

    if (!guildSettings?.blockAfkMentions) return;

    const result = await EditListener.createRule(rule.guild, rule);
    if (!result) return;

    if (!guildSettings.logChannel) return;

    const audit = await rule.guild
      .fetchAuditLogs({
        limit: 10,
        type: deleted
          ? AuditLogEvent.AutoModerationRuleDelete
          : AuditLogEvent.AutoModerationRuleUpdate,
      })
      .catch(() => null);
    const culprit = audit?.entries.find(
      (e) =>
        e.targetId === rule.id && e.executorId !== container.client.user?.id
    )?.executorId;

    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle(guildT(LanguageKeys.Messages.AfkAutoModChanged.title))
      .setDescription(guildT(LanguageKeys.Messages.AfkAutoModChanged.desc))
      .setColor(Colors.Warning);

    await container.client.channels
      .fetch(guildSettings.logChannel)
      .then(async (channel) => {
        if (!channel) return;
        if (!channel.isTextBased()) return;
        if (!("guild" in channel)) return;
        await channel.send({
          content: culprit ? `<@${culprit}>` : undefined,
          embeds: [embed],
        });
      })
      .catch(() => null);
  }

  static async createRule(guild: Guild, existingRule?: AutoModerationRule) {
    const guildT = await fetchT(guild);
    const rule: AutoModerationRuleCreateOptions = {
      name: "AFK - Pomelo",
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      actions: [
        {
          type: AutoModerationActionType.BlockMessage,
          metadata: {
            ...existingRule?.actions[0].metadata,
            customMessage: guildT(LanguageKeys.Commands.Utility.Afk.blockedAfk),
          },
        },
      ],
      triggerMetadata: {
        ...existingRule?.triggerMetadata,
      },
    };
    const userIds = await container.redis.jsonKeys("Afk");
    const blockedAfks = userIds.map((u) => `<@${u}>`);

    const allowList: string[] = [];
    for (const userId of userIds) {
      const userSettings = await container.redis.jsonGet(
        userId,
        "UserSettings"
      );
      if (userSettings && !userSettings.allowUrgentPings) continue;
      allowList.push(`${URGENT_PING}<@${userId}>`);
    }

    rule.triggerMetadata = {
      ...rule.triggerMetadata,
      keywordFilter: blockedAfks,
      allowList,
    };

    if (existingRule) {
      recentReversions.set(existingRule.id, Date.now());
      setTimeout(() => {
        recentReversions.delete(existingRule.id);
      }, 5000).unref();
    }

    if (!existingRule) {
      return await guild.autoModerationRules
        .create(rule)
        .then(async (r) => {
          // sometimes it doesn't enable the rule, so imma js do it again
          return await r.setEnabled(true).catch(() => null);
        })
        .catch(() => null);
    } else {
      return await existingRule
        .edit({
          ...rule,
          enabled: true,
        })
        .catch(() => null);
    }
  }
}
