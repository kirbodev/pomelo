import {
  InteractionHandler,
  InteractionHandlerTypes,
  container,
} from "@sapphire/framework";
import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { TFunction } from "@sapphire/plugin-i18next";
import {
  parseComponentId,
  claimComponentSession,
  replyInteractionExpired,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";
import { modActionService } from "../lib/moderation/actions.js";
import type { ModActionResult } from "../lib/moderation/types.js";
import { fetchT } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { z } from "zod";
import { Colors } from "../lib/colors.js";
import EmbedUtils from "../utilities/embedUtils.js";

const QUICK_ACTION_FEATURE = "qa";

const SubActionSchema = z.object({
  type: z.enum(["warn", "mute", "addRole", "sendDm", "kick", "ban"]),
  warnAmount: z.number().min(1).max(10).optional(),
  warnReason: z.string().optional(),
  muteDuration: z.number().positive().optional(),
  roleId: z.string().optional(),
  dmMessage: z.string().optional(),
  kickReason: z.string().optional(),
  banReason: z.string().optional(),
  banDuration: z.number().positive().optional(),
  banDeleteMessageDays: z
    .union([
      z.literal(0),
      z.literal(3600),
      z.literal(21600),
      z.literal(86400),
      z.literal(259200),
      z.literal(604800),
    ])
    .optional(),
});

const BuiltinSessionSchema = z.object({
  guildId: z.string(),
  moderatorId: z.string(),
  targetId: z.string(),
  channelId: z.string(),
  kind: z.literal("builtin"),
  action: z.enum(["mute", "kick", "ban", "warn"]),
});

const CustomSessionSchema = z.object({
  guildId: z.string(),
  moderatorId: z.string(),
  targetId: z.string(),
  channelId: z.string(),
  kind: z.literal("custom"),
  label: z.string(),
  subactions: z.array(SubActionSchema).min(1),
});

const QuickActionSessionSchema = z.discriminatedUnion("kind", [
  BuiltinSessionSchema,
  CustomSessionSchema,
]);

const ACTION_LABEL_KEYS: Record<string, string> = {
  mute: LanguageKeys.Commands.Moderation.QuickActions.mute,
  kick: LanguageKeys.Commands.Moderation.QuickActions.kick,
  ban: LanguageKeys.Commands.Moderation.QuickActions.ban,
  warn: LanguageKeys.Commands.Moderation.QuickActions.warn,
};

function actionLabel(key: string, t: TFunction): string {
  return t(ACTION_LABEL_KEYS[key] ?? key);
}

const SUBACTION_LABEL_KEYS: Record<string, string> = {
  warn: LanguageKeys.Commands.Moderation.QuickActions.subWarn,
  mute: LanguageKeys.Commands.Moderation.QuickActions.subMute,
  addRole: LanguageKeys.Commands.Moderation.QuickActions.subAddRole,
  sendDm: LanguageKeys.Commands.Moderation.QuickActions.subSendDm,
  kick: LanguageKeys.Commands.Moderation.QuickActions.subKick,
  ban: LanguageKeys.Commands.Moderation.QuickActions.subBan,
};

function subactionLabel(type: string, t: TFunction): string {
  return t(SUBACTION_LABEL_KEYS[type] ?? type);
}

export class QuickActionHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.Button,
    });
  }

  public override parse(interaction: ButtonInteraction) {
    const parts = parseComponentId(QUICK_ACTION_FEATURE, interaction.customId);
    if (!parts || parts.length < 2) return this.none();
    const [sessionId, actionKey] = parts;
    return this.some({ sessionId, actionKey });
  }

  public override async run(
    interaction: ButtonInteraction,
    parsed: { sessionId: string; actionKey: string },
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return replyInteractionExpired(interaction);

    const session = await claimComponentSession(
      QUICK_ACTION_FEATURE,
      parsed.sessionId,
      QuickActionSessionSchema,
    );
    if (!session || session.guildId !== guild.id)
      return replyInteractionExpired(interaction);

    if (interaction.user.id !== session.moderatorId)
      return replyWrongTarget(interaction);

    const t = await fetchT(interaction);
    const moderator = await guild.members
      .fetch(session.moderatorId)
      .catch(() => null);
    if (!moderator) return replyInteractionExpired(interaction);

    if (session.kind === "builtin") {
      await this.handleBuiltin(interaction, session, moderator, t);
    } else {
      await this.handleCustom(interaction, session, moderator, t);
    }

    await container.utilities.componentUtils
      .disableButtons(interaction.message)
      .catch(() => null);
  }

  private async handleBuiltin(
    interaction: ButtonInteraction,
    session: z.infer<typeof BuiltinSessionSchema>,
    moderator: import("discord.js").GuildMember,
    t: TFunction,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return replyInteractionExpired(interaction);
    const target = await guild.members
      .fetch(session.targetId)
      .catch(() => null);

    if (!target) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setDescription(
          t(LanguageKeys.Commands.Moderation.QuickActions.actionFailed, {
            action: actionLabel(session.action, t),
          }),
        )
        .setColor(Colors.Error);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [embed],
      });
      return;
    }

    try {
      let result: ModActionResult;
      switch (session.action) {
        case "mute":
          result = await modActionService.mute(
            guild,
            moderator,
            target,
            600000,
            undefined,
          );
          break;
        case "kick":
          result = await modActionService.kick(
            guild,
            moderator,
            target,
            undefined,
          );
          break;
        case "ban":
          result = await modActionService.ban(
            guild,
            moderator,
            target,
            undefined,
            undefined,
          );
          break;
        case "warn":
          result = await modActionService.warn(
            guild,
            moderator,
            target,
            undefined,
            1,
          );
          break;
      }

      if (!result.success) {
        const embed = new EmbedUtils.EmbedConstructor()
          .setDescription(
            t(LanguageKeys.Commands.Moderation.QuickActions.actionFailed, {
              action: actionLabel(session.action, t),
            }),
          )
          .setColor(Colors.Error);
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          embeds: [embed],
        });
        return;
      }

      const embed = new EmbedUtils.EmbedConstructor()
        .setDescription(
          t(LanguageKeys.Commands.Moderation.QuickActions.actionSuccess, {
            action: actionLabel(session.action, t),
          }),
        )
        .setColor(Colors.Success);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [embed],
      });
    } catch {
      const embed = new EmbedUtils.EmbedConstructor()
        .setDescription(
          t(LanguageKeys.Commands.Moderation.QuickActions.actionFailed, {
            action: actionLabel(session.action, t),
          }),
        )
        .setColor(Colors.Error);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [embed],
      });
    }
  }

  private async handleCustom(
    interaction: ButtonInteraction,
    session: z.infer<typeof CustomSessionSchema>,
    moderator: import("discord.js").GuildMember,
    t: TFunction,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return replyInteractionExpired(interaction);
    const target = await guild.members
      .fetch(session.targetId)
      .catch(() => null);
    const results: string[] = [];
    let failed = false;

    for (const sub of session.subactions) {
      if (sub.type === "kick" || sub.type === "ban") {
        if (!target) {
          results.push(`✗ ${subactionLabel(sub.type, t)}`);
          failed = true;
          break;
        }
      }

      try {
        switch (sub.type) {
          case "warn": {
            if (!target) {
              results.push(`✗ ${subactionLabel("warn", t)}`);
              failed = true;
              break;
            }
            const result = await modActionService.warn(
              guild,
              moderator,
              target,
              sub.warnReason,
              sub.warnAmount ?? 1,
            );
            if (result.success) results.push(`✓ ${subactionLabel("warn", t)}`);
            else {
              results.push(`✗ ${subactionLabel("warn", t)}`);
              failed = true;
            }
            break;
          }
          case "mute": {
            if (!target) {
              results.push(`✗ ${subactionLabel("mute", t)}`);
              failed = true;
              break;
            }
            if (!sub.muteDuration) {
              results.push(`✗ ${subactionLabel("mute", t)}`);
              failed = true;
              break;
            }
            const result = await modActionService.mute(
              guild,
              moderator,
              target,
              sub.muteDuration,
              undefined,
            );
            if (result.success) results.push(`✓ ${subactionLabel("mute", t)}`);
            else {
              results.push(`✗ ${subactionLabel("mute", t)}`);
              failed = true;
            }
            break;
          }
          case "addRole":
            if (!target || !sub.roleId) {
              results.push(`✗ ${subactionLabel("addRole", t)}`);
              failed = true;
              break;
            }
            await target.roles.add(sub.roleId);
            results.push(`✓ ${subactionLabel("addRole", t)}`);
            break;
          case "sendDm":
            if (!sub.dmMessage) {
              results.push(`✗ ${subactionLabel("sendDm", t)}`);
              failed = true;
              break;
            }
            try {
              const user =
                target ?? (await guild.client.users.fetch(session.targetId));
              await user.send(sub.dmMessage);
              results.push(`✓ ${subactionLabel("sendDm", t)}`);
            } catch {
              results.push(`✗ ${subactionLabel("sendDm", t)}`);
            }
            break;
          case "kick": {
            if (!target) {
              results.push(`✗ ${subactionLabel("kick", t)}`);
              failed = true;
              break;
            }
            const result = await modActionService.kick(
              guild,
              moderator,
              target,
              sub.kickReason,
            );
            if (result.success) results.push(`✓ ${subactionLabel("kick", t)}`);
            else {
              results.push(`✗ ${subactionLabel("kick", t)}`);
              failed = true;
            }
            break;
          }
          case "ban": {
            const banTarget =
              target ??
              (await guild.client.users
                .fetch(session.targetId)
                .catch(() => null));
            if (!banTarget) {
              results.push(`✗ ${subactionLabel("ban", t)}`);
              failed = true;
              break;
            }
            const result = await modActionService.ban(
              guild,
              moderator,
              banTarget,
              sub.banReason,
              {
                duration: sub.banDuration,
                deleteMessageDays: sub.banDeleteMessageDays,
              },
            );
            if (result.success) results.push(`✓ ${subactionLabel("ban", t)}`);
            else {
              results.push(`✗ ${subactionLabel("ban", t)}`);
              failed = true;
            }
            break;
          }
        }
      } catch {
        results.push(`✗ ${subactionLabel(sub.type, t)}`);
        failed = true;
        if (sub.type === "kick" || sub.type === "ban") break;
      }

      if (sub.type === "kick" || sub.type === "ban") break;
    }

    const color =
      failed && results.every((r) => r.startsWith("✗"))
        ? Colors.Error
        : failed
          ? Colors.Warning
          : Colors.Success;

    const embed = new EmbedUtils.EmbedConstructor()
      .setDescription(`**${session.label}**\n${results.join("\n")}`)
      .setColor(color);
    await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
  }
}
