import {
  InteractionHandler,
  InteractionHandlerTypes,
  container,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import { z } from "zod";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
} from "discord.js";
import { nanoid } from "nanoid";
import { Colors } from "../lib/colors.js";
import {
  createComponentId,
  parseComponentId,
  getComponentSession,
  deleteComponentSession,
  replyInteractionExpired,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { QA_CONFIG_FEATURE } from "../commands/mod/modSettings.js";
import { QuickActionDefinitionSchema } from "../db/redis/schema.js";
import type { SubAction, SubActionType } from "../lib/moderation/types.js";
import EmbedUtils from "../utilities/embedUtils.js";

const QA_WIZARD_FEATURE = "qa-wiz";
const QA_TRIGGERS_FEATURE = "qa-triggers";
const MAX_SUBACTIONS = 5;
const SINGLE_USE_TYPES = new Set<SubActionType>([
  "mute",
  "sendDm",
  "kick",
  "ban",
]);
const ALL_SUB_TYPES: SubActionType[] = [
  "warn",
  "mute",
  "addRole",
  "sendDm",
  "kick",
  "ban",
];

const TriggersDraftSchema = z.object({
  userId: z.string(),
  guildId: z.string(),
  triggers: z.array(z.string()).min(1),
});

const SubActionDraftSchema = z.object({
  type: z.enum(["warn", "mute", "addRole", "sendDm", "kick", "ban"]),
  warnAmount: z.number().optional(),
  warnReason: z.string().optional(),
  muteDuration: z.number().optional(),
  roleId: z.string().optional(),
  dmMessage: z.string().optional(),
  kickReason: z.string().optional(),
  banReason: z.string().optional(),
  banDuration: z.number().optional(),
  banDeleteMessageDays: z.number().optional(),
});

const WizardSessionSchema = z.object({
  userId: z.string(),
  guildId: z.string(),
  sessionId: z.string(),
  draft: z.object({
    triggers: z.array(z.string()).min(1),
    label: z.string().min(1).max(80),
    subactions: z.array(SubActionDraftSchema),
  }),
});

const SUBACTION_TYPE_KEYS: Record<string, string> = {
  warn: LanguageKeys.Commands.Moderation.QuickActions.subWarn,
  mute: LanguageKeys.Commands.Moderation.QuickActions.subMute,
  addRole: LanguageKeys.Commands.Moderation.QuickActions.subAddRole,
  sendDm: LanguageKeys.Commands.Moderation.QuickActions.subSendDm,
  kick: LanguageKeys.Commands.Moderation.QuickActions.subKick,
  ban: LanguageKeys.Commands.Moderation.QuickActions.subBan,
};

function availableSubTypes(subactions: SubAction[]): SubActionType[] {
  if (subactions.length >= MAX_SUBACTIONS) return [];
  const last = subactions[subactions.length - 1];
  if (subactions.length > 0 && (last.type === "kick" || last.type === "ban"))
    return [];
  const existing = new Set(subactions.map((s) => s.type));
  return ALL_SUB_TYPES.filter(
    (t) => !SINGLE_USE_TYPES.has(t) || !existing.has(t),
  );
}

function subactionLine(sub: SubAction, t: (key: string) => string): string {
  const label = t(SUBACTION_TYPE_KEYS[sub.type] ?? sub.type);
  switch (sub.type) {
    case "warn":
      return `${label} (${String(sub.warnAmount ?? 1)}x${sub.warnReason ? `, ${sub.warnReason}` : ""})`;
    case "mute": {
      if (!sub.muteDuration) return label;
      const mins = Math.round(sub.muteDuration / 60000);
      const dur =
        mins >= 1440
          ? `${String(Math.round(mins / 1440))}d`
          : mins >= 60
            ? `${String(Math.round(mins / 60))}h`
            : `${String(mins)}m`;
      return `${label} (${dur})`;
    }
    case "addRole":
      return sub.roleId ? `${label} (<@&${sub.roleId}>)` : label;
    case "sendDm":
      return label;
    case "kick":
      return `${label}${sub.kickReason ? ` (${sub.kickReason})` : ""}`;
    case "ban": {
      const dur = sub.banDuration
        ? (() => {
            const m = Math.round(sub.banDuration / 60000);
            return m >= 1440
              ? `${String(Math.round(m / 1440))}d`
              : m >= 60
                ? `${String(Math.round(m / 60))}h`
                : `${String(m)}m`;
          })()
        : "permanent";
      return `${label} (${dur})`;
    }
    default:
      return label;
  }
}

export class QuickActionsAddFlowHandler extends InteractionHandler {
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
    let parts = parseComponentId(QA_CONFIG_FEATURE, interaction.customId);
    if (parts && parts.length === 2 && parts[1] === "add") {
      return this.some({ route: "start", userId: parts[0], sessionId: "" });
    }

    parts = parseComponentId(QA_TRIGGERS_FEATURE, interaction.customId);
    if (parts && parts.length === 2) {
      if (parts[1] === "continue")
        return this.some({
          route: "triggersContinue",
          userId: parts[0],
          sessionId: "",
        });
      if (parts[1] === "cancel")
        return this.some({
          route: "triggersCancel",
          userId: parts[0],
          sessionId: "",
        });
    }

    parts = parseComponentId(QA_WIZARD_FEATURE, interaction.customId);
    if (parts && parts.length >= 3) {
      const [sessionId, action] = parts;
      if (["addSub", "back", "done", "cancel"].includes(action)) {
        return this.some({ route: action, userId: "", sessionId: sessionId });
      }
    }

    return this.none();
  }

  public override async run(
    interaction: ButtonInteraction,
    parsed: { route: string; userId: string; sessionId: string },
  ): Promise<void> {
    switch (parsed.route) {
      case "start":
        return this.handleStart(interaction, parsed.userId);
      case "triggersContinue":
        return this.handleTriggersContinue(interaction, parsed.userId);
      case "triggersCancel":
        return this.handleTriggersCancel(interaction, parsed.userId);
      case "addSub":
        return this.handleAddSub(interaction, parsed.sessionId);
      case "back":
        return this.handleBack(interaction, parsed.sessionId);
      case "done":
        return this.handleDone(interaction, parsed.sessionId);
      case "cancel":
        return this.handleCancel(interaction, parsed.sessionId);
    }
  }

  private async handleStart(interaction: ButtonInteraction, userId: string) {
    if (interaction.user.id !== userId) return replyWrongTarget(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return replyInteractionExpired(interaction);
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return replyWrongTarget(interaction);

    const t = await fetchT(interaction);

    const select = new StringSelectMenuBuilder()
      .setCustomId(createComponentId(QA_TRIGGERS_FEATURE, userId, "select"))
      .setMinValues(1)
      .setMaxValues(2)
      .setPlaceholder(
        t(LanguageKeys.Commands.Moderation.QuickActions.triggersPlaceholder),
      )
      .addOptions([
        {
          label: t(LanguageKeys.Commands.Moderation.QuickActions.mute),
          value: "mute",
        },
        {
          label: t(LanguageKeys.Commands.Moderation.QuickActions.warn),
          value: "warn",
        },
      ]);

    const continueBtn = new ButtonBuilder()
      .setCustomId(createComponentId(QA_TRIGGERS_FEATURE, userId, "continue"))
      .setLabel(t(LanguageKeys.Commands.Moderation.QuickActions.wizardContinue))
      .setStyle(ButtonStyle.Primary);

    const cancelBtn = new ButtonBuilder()
      .setCustomId(createComponentId(QA_TRIGGERS_FEATURE, userId, "cancel"))
      .setLabel(t(LanguageKeys.Commands.Moderation.QuickActions.wizardCancel))
      .setStyle(ButtonStyle.Secondary);

    const ctr = new ContainerBuilder()
      .setAccentColor(Colors.Info)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(LanguageKeys.Commands.Moderation.QuickActions.wizardTitle)}\n**${t(LanguageKeys.Commands.Moderation.QuickActions.wizardStep1)}**\n${t(LanguageKeys.Commands.Moderation.QuickActions.triggersDescription)}`,
        ),
      );

    await interaction.reply({
      components: [
        ctr,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          continueBtn,
          cancelBtn,
        ),
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }

  private async handleTriggersContinue(
    interaction: ButtonInteraction,
    userId: string,
  ) {
    if (interaction.user.id !== userId) return replyWrongTarget(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return replyInteractionExpired(interaction);

    const triggersDraft = await getComponentSession(
      QA_TRIGGERS_FEATURE,
      userId,
      TriggersDraftSchema,
    );
    if (!triggersDraft || triggersDraft.guildId !== guildId) {
      const t = await fetchT(interaction);
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Warning)
        .setDescription(
          t(LanguageKeys.Commands.Moderation.QuickActions.selectTriggersFirst),
        );
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await deleteComponentSession(QA_TRIGGERS_FEATURE, userId);

    const t = await fetchT(interaction);
    const modal = new ModalBuilder()
      .setCustomId(
        `qa-name-modal:${userId}:${triggersDraft.triggers.join(",")}`,
      )
      .setTitle(
        t(LanguageKeys.Commands.Moderation.QuickActions.wizardNameTitle),
      )
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("label")
            .setLabel(
              t(LanguageKeys.Commands.Moderation.QuickActions.actionLabelLabel),
            )
            .setPlaceholder(
              t(
                LanguageKeys.Commands.Moderation.QuickActions
                  .customActionNamePlaceholder,
              ),
            )
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(80)
            .setRequired(true),
        ),
      );

    await interaction.showModal(modal);
  }

  private async handleTriggersCancel(
    interaction: ButtonInteraction,
    userId: string,
  ) {
    if (interaction.user.id !== userId) return replyWrongTarget(interaction);
    await deleteComponentSession(QA_TRIGGERS_FEATURE, userId);
    const t = await fetchT(interaction);
    const ctr = new ContainerBuilder()
      .setAccentColor(Colors.Warning)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          t(LanguageKeys.Commands.Moderation.QuickActions.wizardCancelled),
        ),
      );
    await interaction.update({ components: [ctr] });
  }

  private async handleAddSub(
    interaction: ButtonInteraction,
    sessionId: string,
  ) {
    const session = await getComponentSession(
      QA_WIZARD_FEATURE,
      sessionId,
      WizardSessionSchema,
    );
    if (!session) return replyInteractionExpired(interaction);
    if (interaction.user.id !== session.userId)
      return replyWrongTarget(interaction);

    const t = await fetchT(interaction);
    const available = availableSubTypes(session.draft.subactions);
    if (available.length === 0) return;

    const select = new StringSelectMenuBuilder()
      .setCustomId(createComponentId(QA_WIZARD_FEATURE, sessionId, "selectSub"))
      .setPlaceholder(
        t(LanguageKeys.Commands.Moderation.QuickActions.selectSubactionType),
      )
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        available.map((type) => ({
          label: t(SUBACTION_TYPE_KEYS[type] ?? type),
          value: type,
        })),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId(createComponentId(QA_WIZARD_FEATURE, sessionId, "back"))
      .setLabel(t(LanguageKeys.Commands.Moderation.QuickActions.wizardBack))
      .setStyle(ButtonStyle.Secondary);

    const ctr = new ContainerBuilder()
      .setAccentColor(Colors.Info)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(LanguageKeys.Commands.Moderation.QuickActions.wizardTitle)}\n**${t(LanguageKeys.Commands.Moderation.QuickActions.wizardStep3)}**\n${t(LanguageKeys.Commands.Moderation.QuickActions.selectSubactionType)}`,
        ),
      );

    await interaction.update({
      components: [
        ctr,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn),
      ],
    });
  }

  private async handleBack(interaction: ButtonInteraction, sessionId: string) {
    const session = await getComponentSession(
      QA_WIZARD_FEATURE,
      sessionId,
      WizardSessionSchema,
    );
    if (!session) return replyInteractionExpired(interaction);
    if (interaction.user.id !== session.userId)
      return replyWrongTarget(interaction);

    await this.showBuildStep(interaction, session, sessionId);
  }

  private async handleDone(interaction: ButtonInteraction, sessionId: string) {
    const session = await getComponentSession(
      QA_WIZARD_FEATURE,
      sessionId,
      WizardSessionSchema,
    );
    if (!session) return replyInteractionExpired(interaction);
    if (interaction.user.id !== session.userId)
      return replyWrongTarget(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return replyInteractionExpired(interaction);

    const t = await fetchT(interaction);
    const { draft } = session;

    if (draft.subactions.length === 0) {
      const ctr = new ContainerBuilder()
        .setAccentColor(Colors.Error)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            t(
              LanguageKeys.Commands.Moderation.QuickActions
                .needAtLeastOneSubaction,
            ),
          ),
        );
      await interaction.reply({
        components: [ctr],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    const settings = await container.redis.jsonGet(guildId, "GuildSettings");
    const current = settings?.quickActions ?? { actions: [] };

    const newAction = {
      id: nanoid(),
      label: draft.label,
      triggers: draft.triggers,
      subactions: draft.subactions,
    };

    const parsed = QuickActionDefinitionSchema.safeParse(newAction);
    if (!parsed.success) {
      const ctr = new ContainerBuilder()
        .setAccentColor(Colors.Error)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${t(LanguageKeys.Commands.Moderation.QuickActions.validationFailed)}: ${parsed.error.message}`,
          ),
        );
      await interaction.reply({
        components: [ctr],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    await container.redis.jsonUpdate(guildId, "GuildSettings", {
      quickActions: { ...current, actions: [...current.actions, parsed.data] },
    });

    await deleteComponentSession(QA_WIZARD_FEATURE, sessionId);

    const ctr = new ContainerBuilder()
      .setAccentColor(Colors.Success)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${t(LanguageKeys.Commands.Moderation.QuickActions.quickActionSaved)} — **${draft.label}**`,
        ),
      );
    await interaction.update({ components: [ctr] });
  }

  private async handleCancel(
    interaction: ButtonInteraction,
    sessionId: string,
  ) {
    await deleteComponentSession(QA_WIZARD_FEATURE, sessionId);
    const t = await fetchT(interaction);
    const ctr = new ContainerBuilder()
      .setAccentColor(Colors.Warning)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          t(LanguageKeys.Commands.Moderation.QuickActions.wizardCancelled),
        ),
      );
    await interaction.update({ components: [ctr] });
  }

  async showBuildStep(
    interaction: ButtonInteraction,
    session: z.infer<typeof WizardSessionSchema>,
    sessionId: string,
  ) {
    const t = await fetchT(interaction);
    const { draft } = session;

    const subLines =
      draft.subactions.length > 0
        ? draft.subactions
            .map(
              (s, i) => `${String(i + 1)}. ${subactionLine(s as SubAction, t)}`,
            )
            .join("\n")
        : t(LanguageKeys.Commands.Moderation.QuickActions.noSubactionsYet);

    const triggersStr = draft.triggers
      .map((tr) =>
        tr === "mute"
          ? t(LanguageKeys.Commands.Moderation.QuickActions.mute)
          : t(LanguageKeys.Commands.Moderation.QuickActions.warn),
      )
      .join(", ");

    const ctr = new ContainerBuilder()
      .setAccentColor(Colors.Info)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            `# ${t(LanguageKeys.Commands.Moderation.QuickActions.wizardTitle)}`,
            `**${t(LanguageKeys.Commands.Moderation.QuickActions.wizardStep3)}**`,
            `**${t(LanguageKeys.Commands.Moderation.QuickActions.wizardNameLabel)}:** ${draft.label}`,
            `**${t(LanguageKeys.Commands.Moderation.QuickActions.triggersLabel)}:** ${triggersStr}`,
            ``,
            `**${t(LanguageKeys.Commands.Moderation.QuickActions.subactionsLabel)}:**`,
            subLines,
          ].join("\n"),
        ),
      );

    const available = availableSubTypes(draft.subactions);
    const buttons: ButtonBuilder[] = [];

    if (available.length > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(
            createComponentId(QA_WIZARD_FEATURE, sessionId, "addSub"),
          )
          .setLabel(
            t(LanguageKeys.Commands.Moderation.QuickActions.addSubaction),
          )
          .setStyle(ButtonStyle.Primary),
      );
    }

    if (draft.subactions.length > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(createComponentId(QA_WIZARD_FEATURE, sessionId, "done"))
          .setLabel(t(LanguageKeys.Commands.Moderation.QuickActions.wizardDone))
          .setStyle(ButtonStyle.Success),
      );
    }

    buttons.push(
      new ButtonBuilder()
        .setCustomId(createComponentId(QA_WIZARD_FEATURE, sessionId, "cancel"))
        .setLabel(t(LanguageKeys.Commands.Moderation.QuickActions.wizardCancel))
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({
      components: [
        ctr,
        new ActionRowBuilder<ButtonBuilder>().addComponents(buttons),
      ],
    });
  }
}
