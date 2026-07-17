import {
  container,
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
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js";
import { db } from "../db/index.js";
import { warnSettings } from "../db/schema.js";
import { Colors } from "../lib/colors.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { PRESETS } from "../lib/moderation/presets.js";
import {
  WarnWorkflowRepository,
  createQuickstartCustomId,
  parseQuickstartCustomId,
  type QuickstartCustomId,
} from "../lib/moderation/workflowRepository.js";
import type { WarnWorkflowState } from "../lib/moderation/types.js";

export const warnWorkflowRepository = new WarnWorkflowRepository(
  container.redis,
);

export function createWarnQuickstartState(input: {
  id: string;
  ownerId: string;
  guildId: string;
  messageId: string;
}): WarnWorkflowState {
  return {
    ...input,
    revision: 1,
    status: "active",
    expiresAt: Date.now() + 600_000,
    step: 1,
    config: { defaultExpiryDays: 3, dmOnWarn: true, levels: [] },
  };
}

export class WarnQuickstartHandler extends InteractionHandler {
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
    const parsed = parseQuickstartCustomId(interaction.customId);
    return parsed ? this.some(parsed) : this.none();
  }

  public override async run(
    interaction: Interaction,
    parsed: QuickstartCustomId,
  ): Promise<void> {
    if (!interaction.isMessageComponent()) return;
    const guildId = interaction.guildId;
    if (!guildId) return;
    const state = await warnWorkflowRepository.loadForInteraction({
      sessionId: parsed.sessionId,
      guildId,
      ownerId: interaction.user.id,
      messageId: interaction.message.id,
      revision: parsed.revision,
    });
    if (!state) return this.replyUnavailable(interaction);

    const next = await this.reduce(state, interaction, parsed);
    if (!next) return this.replyUnavailable(interaction);
    const stored = await warnWorkflowRepository.advance(next);
    if (!stored) return this.replyUnavailable(interaction);
    const t = await fetchT(interaction);
    await interaction.update({ components: renderWarnQuickstart(stored, t) });
  }

  private async reduce(
    state: WarnWorkflowState,
    interaction: MessageComponentInteraction,
    parsed: QuickstartCustomId,
  ): Promise<WarnWorkflowState | null> {
    if (parsed.action === "preset") return { ...state, step: 2 };
    if (parsed.action === "scratch") return { ...state, step: 3 };
    if (parsed.action === "select-preset" && interaction.isStringSelectMenu()) {
      const preset = Object.entries(PRESETS).find(
        ([name]) => name === interaction.values[0],
      )?.[1];
      if (!preset) return null;
      return {
        ...state,
        step: 3,
        config: {
          ...state.config,
          defaultExpiryDays: preset.defaultExpiryDays,
          levels: preset.levels,
        },
      };
    }
    if (parsed.action === "expiry" && interaction.isStringSelectMenu()) {
      const days = Number(interaction.values[0]);
      if (!Number.isInteger(days) || days < 0 || days > 365) return null;
      return { ...state, config: { ...state.config, defaultExpiryDays: days } };
    }
    if (parsed.action === "toggle-dm")
      return {
        ...state,
        config: { ...state.config, dmOnWarn: !state.config.dmOnWarn },
      };
    if (parsed.action === "levels") return { ...state, step: 4 };
    if (parsed.action === "back")
      return { ...state, step: Math.max(1, state.step - 1) };
    if (parsed.action === "review") return { ...state, step: 6 };
    if (parsed.action === "cancel") return { ...state, status: "cancelled" };
    if (parsed.action === "save") {
      await db
        .insert(warnSettings)
        .values({
          guildId: state.guildId,
          defaultExpiryDays: state.config.defaultExpiryDays,
          dmOnWarn: state.config.dmOnWarn,
          logChannelId: state.config.logChannelId ?? null,
          actions: JSON.stringify(state.config.levels),
        })
        .onConflictDoUpdate({
          target: warnSettings.guildId,
          set: {
            defaultExpiryDays: state.config.defaultExpiryDays,
            dmOnWarn: state.config.dmOnWarn,
            logChannelId: state.config.logChannelId ?? null,
            actions: JSON.stringify(state.config.levels),
          },
        });
      return { ...state, status: "completed" };
    }
    return null;
  }

  private async replyUnavailable(
    interaction: MessageComponentInteraction,
  ): Promise<void> {
    const t = await fetchT(interaction);
    await interaction.reply({
      components: [
        new ContainerBuilder()
          .setAccentColor(Colors.Warning)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              t(
                LanguageKeys.Commands.Moderation.WarnSettings.quickstart
                  .approvalUnavailable,
              ),
            ),
          ),
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }
}

export function renderWarnQuickstart(
  state: WarnWorkflowState,
  t: Awaited<ReturnType<typeof fetchT>>,
) {
  const key = LanguageKeys.Commands.Moderation.WarnSettings.quickstart;
  const container = new ContainerBuilder().setAccentColor(Colors.Info);
  const button = (
    action: QuickstartCustomId["action"],
    label: string,
    style: ButtonStyle,
  ) =>
    new ButtonBuilder()
      .setCustomId(createQuickstartCustomId(state.id, state.revision, action))
      .setLabel(label)
      .setStyle(style)
      .setDisabled(state.status !== "active");
  if (state.status === "completed") {
    return [
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(key.savedTitle)}\n${t(key.savedDescription)}`,
        ),
      ),
    ];
  }
  if (state.status === "cancelled") {
    return [
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${t(key.cancelledTitle)}\n${t(key.cancelledDescription)}`,
        ),
      ),
    ];
  }
  if (state.step === 1) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t(key.welcomeTitle)}\n${t(key.welcomeDescription)}`,
      ),
    );
    return [
      container,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("preset", t(key.startFromPreset), ButtonStyle.Primary),
        button("scratch", t(key.buildFromScratch), ButtonStyle.Secondary),
      ),
    ];
  }
  if (state.step === 2) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t(key.presetTitle)}\n${t(key.presetDescription)}`,
      ),
    );
    return [
      container,
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            createQuickstartCustomId(state.id, state.revision, "select-preset"),
          )
          .addOptions(
            Object.entries(PRESETS).map(([value]) => ({ label: value, value })),
          ),
      ),
    ];
  }
  if (state.step === 3) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t(key.generalOptionsTitle)}\n${t(key.generalOptionsDescription)}`,
      ),
    );
    return [
      container,
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            createQuickstartCustomId(state.id, state.revision, "expiry"),
          )
          .addOptions(
            [3, 7, 14, 30].map((days) => ({
              label: t(key.expiryDays, { days }),
              value: String(days),
              default: state.config.defaultExpiryDays === days,
            })),
          ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("toggle-dm", t(key.dmOnWarn), ButtonStyle.Secondary),
        button("levels", t(key.configureWarnLevels), ButtonStyle.Primary),
      ),
    ];
  }
  if (state.step === 4) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t(key.warnLevelsTitle)}\n${t(key.warnLevelsSummary, { count: state.config.levels.length })}`,
      ),
    );
    return [
      container,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("back", t(key.back), ButtonStyle.Secondary),
        button("review", t(key.continueToReview), ButtonStyle.Primary),
      ),
    ];
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${t(key.reviewTitle)}\n${t(key.warnLevelsSummary, { count: state.config.levels.length })}`,
    ),
  );
  return [
    container,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button("back", t(key.back), ButtonStyle.Secondary),
      button("save", t(key.saveConfiguration), ButtonStyle.Success),
      button("cancel", t(key.cancel), ButtonStyle.Secondary),
    ),
  ];
}
