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
  TextDisplayBuilder,
  type Interaction,
} from "discord.js";
import { nanoid } from "nanoid";
import { Colors } from "../lib/colors.js";
import {
  createComponentId,
  saveComponentSession,
  getComponentSession,
  replyInteractionExpired,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import type { SubAction, SubActionType } from "../lib/moderation/types.js";
import ms from "../lib/helpers/ms.js";

const QA_WIZARD_FEATURE = "qa-wiz";
const WIZARD_TTL = 900;
const NAME_MODAL_PREFIX = "qa-name-modal";
const SUB_MODAL_PREFIX = "qa-sub-modal";

const WizardSessionSchema = z.object({
  userId: z.string(),
  guildId: z.string(),
  sessionId: z.string(),
  draft: z.object({
    triggers: z.array(z.string()).min(1),
    label: z.string().min(1).max(80),
    subactions: z.array(z.object({
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
    })),
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

function subactionLine(sub: SubAction, t: (key: string) => string): string {
  const label = t(SUBACTION_TYPE_KEYS[sub.type] ?? sub.type);
  switch (sub.type) {
    case "warn": return `${label} (${sub.warnAmount ?? 1}x${sub.warnReason ? `, ${sub.warnReason}` : ""})`;
    case "mute": {
      if (!sub.muteDuration) return label;
      const mins = Math.round(sub.muteDuration / 60000);
      const dur = mins >= 1440 ? `${Math.round(mins / 1440)}d` : mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
      return `${label} (${dur})`;
    }
    case "addRole": return `${label} (<@&${sub.roleId}>)`;
    case "sendDm": return label;
    case "kick": return `${label}${sub.kickReason ? ` (${sub.kickReason})` : ""}`;
    case "ban": {
      const dur = sub.banDuration
        ? (() => { const m = Math.round(sub.banDuration / 60000); return m >= 1440 ? `${Math.round(m / 1440)}d` : m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`; })()
        : "permanent";
      return `${label} (${dur})`;
    }
    default: return label;
  }
}

export class QuickActionsAddModalHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
    });
  }

  public override parse(interaction: Interaction) {
    if (!interaction.isModalSubmit()) return this.none();

    if (interaction.customId.startsWith(`${NAME_MODAL_PREFIX}:`)) {
      const rest = interaction.customId.slice(NAME_MODAL_PREFIX.length + 1);
      const colonIdx = rest.indexOf(":");
      if (colonIdx === -1) return this.none();
      const userId = rest.slice(0, colonIdx);
      const triggersStr = rest.slice(colonIdx + 1);
      return this.some({ route: "name", userId, triggersStr });
    }

    if (interaction.customId.startsWith(`${SUB_MODAL_PREFIX}:`)) {
      const rest = interaction.customId.slice(SUB_MODAL_PREFIX.length + 1);
      const colonIdx = rest.indexOf(":");
      if (colonIdx === -1) return this.none();
      const sessionId = rest.slice(0, colonIdx);
      const subType = rest.slice(colonIdx + 1);
      return this.some({ route: "config", sessionId, subType });
    }

    return this.none();
  }

  public override async run(
    interaction: Interaction,
    parsed: { route: string; userId?: string; triggersStr?: string; sessionId?: string; subType?: string },
  ): Promise<void> {
    if (!interaction.isModalSubmit()) return;

    if (parsed.route === "name") {
      await this.handleNameModal(interaction, parsed.userId!, parsed.triggersStr!);
    } else if (parsed.route === "config") {
      await this.handleConfigModal(interaction, parsed.sessionId!, parsed.subType! as SubActionType);
    }
  }

  private async handleNameModal(
    interaction: Interaction,
    userId: string,
    triggersStr: string,
  ) {
    if (!interaction.isModalSubmit()) return;
    if (interaction.user.id !== userId) return replyWrongTarget(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return replyInteractionExpired(interaction);

    const t = await fetchT(interaction);
    const label = interaction.fields.getTextInputValue("label").trim();
    if (!label || label.length > 80) {
      const ctr = new ContainerBuilder()
        .setAccentColor(Colors.Error)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(t(LanguageKeys.Commands.Moderation.QuickActions.invalidName)),
        );
      await interaction.reply({ components: [ctr], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }

    const triggers = triggersStr.split(",").filter((t) => t === "mute" || t === "warn");
    if (triggers.length === 0) return replyInteractionExpired(interaction);

    const sessionId = nanoid();
    const session = {
      userId,
      guildId,
      sessionId,
      draft: {
        triggers,
        label,
        subactions: [] as SubAction[],
      },
    };

    await saveComponentSession(QA_WIZARD_FEATURE, sessionId, session, WIZARD_TTL);
    await this.replyBuildStep(interaction, session, sessionId, t);
  }

  private async handleConfigModal(
    interaction: Interaction,
    sessionId: string,
    subType: SubActionType,
  ) {
    if (!interaction.isModalSubmit()) return;
    const session = await getComponentSession(QA_WIZARD_FEATURE, sessionId, WizardSessionSchema);
    if (!session) return replyInteractionExpired(interaction);
    if (interaction.user.id !== session.userId) return replyWrongTarget(interaction);

    const t = await fetchT(interaction);

    const sub = this.parseSubactionFromModal(interaction, subType, t);
    if (!sub) return;

    session.draft.subactions.push(sub);
    await saveComponentSession(QA_WIZARD_FEATURE, sessionId, session, WIZARD_TTL);
    await this.replyBuildStep(interaction, session, sessionId, t);
  }

  private parseSubactionFromModal(
    interaction: Interaction,
    type: SubActionType,
    t: (key: string) => string,
  ): SubAction | null {
    if (!interaction.isModalSubmit()) return null;

    switch (type) {
      case "warn": {
        const amountStr = interaction.fields.getTextInputValue("warnAmount").trim() ?? "1";
        const amount = parseInt(amountStr, 10);
        if (isNaN(amount) || amount < 1 || amount > 10) {
          this.replyModalError(interaction, t(LanguageKeys.Commands.Moderation.QuickActions.invalidWarnAmount));
          return null;
        }
        const reason = interaction.fields.getTextInputValue("warnReason").trim() || undefined;
        return { type: "warn", warnAmount: amount, warnReason: reason };
      }
      case "mute": {
        const durationStr = interaction.fields.getTextInputValue("muteDuration").trim();
        const duration = ms(durationStr);
        if (typeof duration !== "number" || isNaN(duration) || duration <= 0) {
          this.replyModalError(interaction, t(LanguageKeys.Commands.Moderation.QuickActions.invalidDuration));
          return null;
        }
        return { type: "mute", muteDuration: duration };
      }
      case "addRole": {
        const roleId = interaction.fields.getTextInputValue("roleId").trim();
        if (!roleId || !/^\d{17,20}$/.test(roleId)) {
          this.replyModalError(interaction, t(LanguageKeys.Commands.Moderation.QuickActions.invalidRoleId));
          return null;
        }
        return { type: "addRole", roleId };
      }
      case "sendDm": {
        const message = interaction.fields.getTextInputValue("dmMessage").trim();
        if (!message || message.length > 2000) {
          this.replyModalError(interaction, t(LanguageKeys.Commands.Moderation.QuickActions.invalidDmMessage));
          return null;
        }
        return { type: "sendDm", dmMessage: message };
      }
      case "kick": {
        const reason = interaction.fields.getTextInputValue("kickReason").trim() || undefined;
        return { type: "kick", kickReason: reason };
      }
      case "ban": {
        const reason = interaction.fields.getTextInputValue("banReason").trim() || undefined;
        const durationStr = interaction.fields.getTextInputValue("banDuration").trim();
        let duration: number | undefined;
        if (durationStr) {
          const parsed = ms(durationStr);
          if (typeof parsed === "number" && !isNaN(parsed) && parsed > 0) {
            duration = parsed;
          }
        }
        return { type: "ban", banReason: reason, banDuration: duration };
      }
      default:
        return null;
    }
  }

  private async replyModalError(interaction: Interaction, message: string) {
    if (!interaction.isModalSubmit()) return;
    const ctr = new ContainerBuilder()
      .setAccentColor(Colors.Error)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
    await interaction.reply({ components: [ctr], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  }

  private async replyBuildStep(
    interaction: Interaction,
    session: z.infer<typeof WizardSessionSchema>,
    sessionId: string,
    t: (key: string) => string,
  ) {
    if (!interaction.isModalSubmit()) return;
    const { draft } = session;

    const subLines = draft.subactions.length > 0
      ? draft.subactions.map((s, i) => `${i + 1}. ${subactionLine(s as SubAction, t)}`).join("\n")
      : t(LanguageKeys.Commands.Moderation.QuickActions.noSubactionsYet);

    const triggersStr = draft.triggers
      .map((tr) => tr === "mute" ? t(LanguageKeys.Commands.Moderation.QuickActions.mute) : t(LanguageKeys.Commands.Moderation.QuickActions.warn))
      .join(", ");

    const SINGLE_USE = new Set(["mute", "sendDm", "kick", "ban"]);
    const ALL_TYPES = ["warn", "mute", "addRole", "sendDm", "kick", "ban"] as const;
    const MAX = 5;

    const available = (): string[] => {
      if (draft.subactions.length >= MAX) return [];
      const last = draft.subactions[draft.subactions.length - 1];
      if (last && (last.type === "kick" || last.type === "ban")) return [];
      const existing = new Set(draft.subactions.map((s) => s.type));
      return ALL_TYPES.filter((t) => !SINGLE_USE.has(t) || !existing.has(t)) as unknown as string[];
    };

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

    const buttons: ButtonBuilder[] = [];
    if (available().length > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(createComponentId(QA_WIZARD_FEATURE, sessionId, "addSub"))
          .setLabel(t(LanguageKeys.Commands.Moderation.QuickActions.addSubaction))
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

    await interaction.reply({
      components: [
        ctr,
        new ActionRowBuilder<ButtonBuilder>().addComponents(buttons),
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }
}
