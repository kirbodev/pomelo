import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  type Guild,
  type GuildMember,
  type Interaction,
  type MessageComponentInteraction,
  type Role,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { container } from "@sapphire/framework";
import { db } from "../db/index.js";
import {
  warnPunishmentBatches,
  warnPunishmentItems,
  type WarnPunishmentBatch,
  type WarnPunishmentItem,
} from "../db/schema.js";
import { Colors } from "../lib/colors.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import {
  ModActionService,
  type PunishmentCapabilityAdapter,
} from "../lib/moderation/actions.js";
import {
  WarnWorkflowRepository,
  authorizePendingSelection,
  createApprovalCustomId,
  parseApprovalCustomId,
  type ApprovalCustomId,
} from "../lib/moderation/workflowRepository.js";
import type { PunishmentItemState } from "../lib/moderation/types.js";

const PendingStates: PunishmentItemState[] = ["pending", "retryable_failed"];

const requiredPermission = {
  ban: PermissionFlagsBits.BanMembers,
  kick: PermissionFlagsBits.KickMembers,
  mute: PermissionFlagsBits.ModerateMembers,
  role: PermissionFlagsBits.ManageRoles,
} as const;

const toPermission = (
  type: WarnPunishmentItem["punishmentType"],
): keyof typeof requiredPermission | null => (type === "message" ? null : type);

function displayItem(
  item: WarnPunishmentItem,
  t: Awaited<ReturnType<typeof fetchT>>,
): string {
  const key = LanguageKeys.Commands.Moderation.WarnSettings.Quickstart;
  if (item.punishmentType === "role")
    return item.roleId ? `<@&${item.roleId}>` : t(key.punishmentRole);
  if (item.punishmentType === "mute" && item.duration)
    return t(key.approvalTimedPunishment, {
      punishment: t(key.punishmentMute),
      duration: String(item.duration),
    });
  if (item.punishmentType === "mute") return t(key.punishmentMute);
  if (item.punishmentType === "kick") return t(key.punishmentKick);
  if (item.punishmentType === "ban") return t(key.punishmentBan);
  return t(key.approvalMessage);
}

async function resolveMember(
  guild: Guild,
  userId: string,
): Promise<GuildMember> {
  return guild.members.fetch(userId);
}

function hasAuthority(
  guild: Guild,
  actor: GuildMember,
  target: GuildMember,
  bot: GuildMember,
  item: WarnPunishmentItem,
  role: Role | null,
): boolean {
  const permission = toPermission(item.punishmentType);
  if (
    !permission ||
    !actor.permissions.has(requiredPermission[permission]) ||
    !bot.permissions.has(requiredPermission[permission])
  )
    return false;
  if (
    guild.ownerId !== actor.id &&
    actor.roles.highest.comparePositionTo(target.roles.highest) <= 0
  )
    return false;
  if (bot.roles.highest.comparePositionTo(target.roles.highest) <= 0)
    return false;
  return !role || bot.roles.highest.comparePositionTo(role) > 0;
}

function createCapabilityAdapter(guild: Guild): PunishmentCapabilityAdapter {
  return {
    resolve: async ({ actorId, targetId, roleId }) => {
      const actor = await resolveMember(guild, actorId);
      const target = await resolveMember(guild, targetId);
      const clientUser = container.client.user;
      if (!clientUser) throw new Error("warnApprovalBotUnavailable");
      const bot =
        guild.members.me ?? (await resolveMember(guild, clientUser.id));
      const role = roleId ? await guild.roles.fetch(roleId) : null;
      const permissions = Object.entries(requiredPermission).reduce(
        (set, [type, permission]) => {
          if (actor.permissions.has(permission))
            set.add(type as keyof typeof requiredPermission);
          return set;
        },
        new Set<keyof typeof requiredPermission>(),
      );
      const botPermissions = Object.entries(requiredPermission).reduce(
        (set, [type, permission]) => {
          if (bot.permissions.has(permission))
            set.add(type as keyof typeof requiredPermission);
          return set;
        },
        new Set<keyof typeof requiredPermission>(),
      );
      return {
        actorId,
        targetId,
        actorPosition: actor.roles.highest.position,
        targetPosition: target.roles.highest.position,
        botPosition: bot.roles.highest.position,
        actorPermissions: permissions,
        botPermissions,
        actorIsOwner: guild.ownerId === actorId,
        targetIsAdministrator: target.permissions.has(
          PermissionFlagsBits.Administrator,
        ),
        rolePosition: role?.position,
      };
    },
    apply: async ({ targetId, punishmentType, duration, roleId, reason }) => {
      try {
        if (punishmentType === "ban") {
          await guild.members.ban(targetId, { reason });
        } else {
          const target = await resolveMember(guild, targetId);
          if (punishmentType === "kick") await target.kick(reason);
          if (punishmentType === "mute" && duration)
            await target.timeout(duration, reason);
          if (punishmentType === "role" && roleId) {
            const role = await guild.roles.fetch(roleId);
            if (!role)
              return { success: false, failureCode: "warnRoleNotFound" };
            await target.roles.add(role, reason);
          }
        }
        return { success: true };
      } catch {
        return { success: false, failureCode: "discordPunishmentRejected" };
      }
    },
    scheduleAutoUnban: async ({ id, delay, payload }) => {
      await container.tasks.create({
        name: "autoUnban",
        payload,
        options: { jobId: id, delay },
      });
    },
    unban: () =>
      Promise.resolve({
        success: false,
        failureCode: "warnApprovalCannotUnban",
      }),
  };
}

export class WarnApprovalHandler extends InteractionHandler {
  private readonly workflows = new WarnWorkflowRepository(container.redis);

  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.MessageComponent,
    });
  }

  public override parse(interaction: Interaction) {
    if (!interaction.isMessageComponent()) return this.none();
    const parsed = parseApprovalCustomId(interaction.customId);
    return parsed ? this.some(parsed) : this.none();
  }

  public override async run(
    interaction: Interaction,
    parsed: ApprovalCustomId,
  ): Promise<void> {
    if (!interaction.isMessageComponent()) return;
    const guildId = interaction.guildId;
    const guild = interaction.guild;
    if (!guildId || !guild) return this.replyUnavailable(interaction);

    const record = await this.getRecord(guildId, parsed.batchPublicId);
    if (
      !record ||
      record.batch.revision !== parsed.revision ||
      record.batch.displayMessageId !== interaction.message.id ||
      record.batch.displayChannelId !== interaction.channelId
    )
      return this.replyUnavailable(interaction);

    if (parsed.action === "select") {
      if (!interaction.isStringSelectMenu())
        return this.replyUnavailable(interaction);
      await this.workflows.saveSelection({
        guildId,
        batchPublicId: record.batch.publicId,
        userId: interaction.user.id,
        revision: record.batch.revision,
        itemIds: interaction.values,
      });
      await interaction.deferUpdate();
      return;
    }

    const service = new ModActionService(
      db,
      Date.now,
      createCapabilityAdapter(guild),
    );
    if (parsed.action === "dismiss") {
      const permitted = await this.canDismiss(
        guild,
        interaction.user.id,
        record.items,
      );
      if (!permitted) return this.replyUnavailable(interaction);
      const dismissed = await service.dismissBatch({
        guildId,
        batchId: record.batch.id,
        actorId: interaction.user.id,
        expectedRevision: parsed.revision,
      });
      if (!dismissed) return this.replyUnavailable(interaction);
      await interaction.update({ components: [] });
      return;
    }

    if (parsed.action === "apply") {
      const item = record.items.find((candidate) =>
        PendingStates.includes(candidate.state),
      );
      if (item)
        await service.applyPunishmentItem({
          guildId,
          itemId: item.id,
          actorId: interaction.user.id,
          expectedBatchRevision: parsed.revision,
        });
    }
    if (parsed.action === "apply-selected") {
      const selected = await this.workflows.getSelection({
        guildId,
        batchPublicId: record.batch.publicId,
        userId: interaction.user.id,
        revision: parsed.revision,
      });
      const itemIds = authorizePendingSelection(selected, record.items);
      await service.applyEligibleItems({
        guildId,
        batchId: record.batch.id,
        actorId: interaction.user.id,
        automatic: false,
        expectedBatchRevision: parsed.revision,
        itemIds,
      });
    }
    if (parsed.action === "apply-all")
      await service.applyEligibleItems({
        guildId,
        batchId: record.batch.id,
        actorId: interaction.user.id,
        automatic: false,
        expectedBatchRevision: parsed.revision,
      });

    const current = await this.getRecord(guildId, record.batch.publicId);
    if (!current) return this.replyUnavailable(interaction);
    const t = await fetchT(interaction);
    await interaction.update({
      components: this.render(current.batch, current.items, t),
    });
  }

  private async getRecord(
    guildId: string,
    publicId: string,
  ): Promise<{
    batch: WarnPunishmentBatch;
    items: WarnPunishmentItem[];
  } | null> {
    const batches = await db
      .select()
      .from(warnPunishmentBatches)
      .where(
        and(
          eq(warnPunishmentBatches.guildId, guildId),
          eq(warnPunishmentBatches.publicId, publicId),
        ),
      )
      .limit(1);
    const batch = batches.at(0);
    if (!batch) return null;
    const items = await db
      .select()
      .from(warnPunishmentItems)
      .where(
        and(
          eq(warnPunishmentItems.guildId, guildId),
          eq(warnPunishmentItems.batchId, batch.id),
        ),
      )
      .orderBy(warnPunishmentItems.ordinal);
    return { batch, items };
  }

  private async canDismiss(
    guild: Guild,
    actorId: string,
    items: WarnPunishmentItem[],
  ): Promise<boolean> {
    const unresolved = items.filter((item) =>
      PendingStates.includes(item.state),
    );
    if (unresolved.length === 0) return false;
    const actor = await resolveMember(guild, actorId).catch(() => null);
    const bot =
      guild.members.me ??
      (container.client.user
        ? await resolveMember(guild, container.client.user.id).catch(() => null)
        : null);
    if (!actor || !bot) return false;
    for (const item of unresolved) {
      const batches = await db
        .select({ targetUserId: warnPunishmentBatches.targetUserId })
        .from(warnPunishmentBatches)
        .where(
          and(
            eq(warnPunishmentBatches.guildId, item.guildId),
            eq(warnPunishmentBatches.id, item.batchId),
          ),
        )
        .limit(1);
      const batch = batches.at(0);
      if (!batch) return false;
      const target = await resolveMember(guild, batch.targetUserId).catch(
        () => null,
      );
      const role = item.roleId
        ? await guild.roles.fetch(item.roleId).catch(() => null)
        : null;
      if (!target || !hasAuthority(guild, actor, target, bot, item, role))
        return false;
    }
    return true;
  }

  private render(
    batch: WarnPunishmentBatch,
    items: WarnPunishmentItem[],
    t: Awaited<ReturnType<typeof fetchT>>,
  ) {
    const pending = items.filter((item) => PendingStates.includes(item.state));
    const containerBuilder = new ContainerBuilder()
      .setAccentColor(Colors.Warning)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.confirmLevelTitle, { level: batch.threshold })}`,
        ),
        new TextDisplayBuilder().setContent(
          t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.confirmLevelDesc, {
            punishments:
              pending.map((item) => displayItem(item, t)).join(", ") ||
              t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.none),
          }),
        ),
      );
    if (pending.length === 0) return [containerBuilder];
    const components: Array<
      | ContainerBuilder
      | ActionRowBuilder<ButtonBuilder>
      | ActionRowBuilder<StringSelectMenuBuilder>
    > = [containerBuilder];
    if (pending.length === 1) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              createApprovalCustomId(batch.publicId, batch.revision, "apply"),
            )
            .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.confirmLevelConfirm))
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(
              createApprovalCustomId(batch.publicId, batch.revision, "dismiss"),
            )
            .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.approvalDismiss))
            .setStyle(ButtonStyle.Secondary),
        ),
      );
      return components;
    }
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            createApprovalCustomId(batch.publicId, batch.revision, "select"),
          )
          .setMinValues(1)
          .setMaxValues(pending.length)
          .addOptions(
            pending.map((item) => ({
              label: displayItem(item, t),
              value: String(item.id),
            })),
          ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            createApprovalCustomId(
              batch.publicId,
              batch.revision,
              "apply-selected",
            ),
          )
          .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.approvalApplySelected))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(
            createApprovalCustomId(batch.publicId, batch.revision, "apply-all"),
          )
          .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.approvalApplyAll))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(
            createApprovalCustomId(batch.publicId, batch.revision, "dismiss"),
          )
          .setLabel(t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.approvalDismiss))
          .setStyle(ButtonStyle.Secondary),
      ),
    );
    return components;
  }

  private async replyUnavailable(
    interaction: MessageComponentInteraction,
  ): Promise<void> {
    const t = await fetchT(interaction);
    const response = new ContainerBuilder()
      .setAccentColor(Colors.Warning)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          t(LanguageKeys.Commands.Moderation.WarnSettings.Quickstart.approvalUnavailable),
        ),
      );
    await interaction.reply({
      components: [response],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }
}
