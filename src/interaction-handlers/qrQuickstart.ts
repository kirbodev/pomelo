import { container, InteractionHandler, InteractionHandlerTypes } from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import type { TFunction } from "@sapphire/plugin-i18next";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  type Interaction,
} from "discord.js";
import { Colors } from "../lib/colors.js";
import { parseComponentId, replyInteractionExpired, replyWrongTarget } from "../lib/helpers/componentSessions.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { QrScanner, type QrScannerSettings } from "../db/redis/schema.js";
import EmbedUtils from "../utilities/embedUtils.js";

export const QR_QUICKSTART_FEATURE = "qrqs";

export interface QrQuickstartState {
  id: string;
  ownerId: string;
  guildId: string;
  messageId: string;
  step: number;
  settings: QrScannerSettings;
}

export function createQrQuickstartState(overrides: Partial<QrQuickstartState> & { id: string; ownerId: string; guildId: string; messageId: string }): QrQuickstartState {
  return {
    step: 0,
    settings: QrScanner.parse({
      mode: "blocklist",
      unsafeAction: { enabled: true, deleteMessage: true },
    }),
    ...overrides,
  };
}

const stateKey = (id: string) => `qr-quickstart:${id}`;

class QrQuickstartRepository {
  async save(state: QrQuickstartState): Promise<void> {
    await container.redis.set(stateKey(state.id), JSON.stringify(state), "EX", 600);
  }
  async get(id: string): Promise<QrQuickstartState | null> {
    const raw = await container.redis.get(stateKey(id));
    if (!raw) return null;
    try { return JSON.parse(raw) as QrQuickstartState; } catch { return null; }
  }
  async del(id: string): Promise<void> {
    await container.redis.del(stateKey(id));
  }
}

export const qrQuickstartRepository = new QrQuickstartRepository();

function boolLabel(value: boolean, t: TFunction): string {
  const sk = LanguageKeys.Commands.Moderation.SecuritySettings;
  return value ? t(sk.enabled) : t(sk.disabled);
}

function modeLabel(mode: string, t: TFunction): string {
  const sk = LanguageKeys.Commands.Moderation.SecuritySettings;
  if (mode === "allowlist") return t(sk.qrModeAllowlist);
  if (mode === "blocklist") return t(sk.qrModeBlocklist);
  return t(sk.qrModeOff);
}

export function renderQrQuickstart(state: QrQuickstartState, t: TFunction): (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[] {
  const sk = LanguageKeys.Commands.Moderation.SecuritySettings;
  const components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[] = [];
  const container_ = new ContainerBuilder().setAccentColor(Colors.Info);

  if (state.step === 0) {
    container_.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t(sk.qrQuickstartTitle)}`),
    );
    container_.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(t(sk.qrQuickstepMode)),
    );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`pm:${QR_QUICKSTART_FEATURE}:1:${state.id}:next`)
        .setLabel(String(t(sk.qrQuickstartNext)))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`pm:${QR_QUICKSTART_FEATURE}:1:${state.id}:skip`)
        .setLabel(String(t(sk.qrQuickstartSkip)))
        .setStyle(ButtonStyle.Secondary),
    );
    components.push(container_, row);
    return components;
  }

  if (state.step === 1) {
    container_.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t(sk.qrQuickstepDeleteToggle)}`),
    );
    container_.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${t(sk.qrDeleteOnUnsafe)}:** ${boolLabel(state.settings.unsafeAction.deleteMessage, t)}`,
      ),
    );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`pm:${QR_QUICKSTART_FEATURE}:1:${state.id}:back`)
        .setLabel(String(t(sk.qrQuickstartBack)))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`pm:${QR_QUICKSTART_FEATURE}:1:${state.id}:toggle-delete`)
        .setLabel(`${t(sk.qrDeleteOnUnsafe)}: ${boolLabel(state.settings.unsafeAction.deleteMessage, t)}`)
        .setStyle(state.settings.unsafeAction.deleteMessage ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`pm:${QR_QUICKSTART_FEATURE}:1:${state.id}:next`)
        .setLabel(String(t(sk.qrQuickstartNext)))
        .setStyle(ButtonStyle.Primary),
    );
    components.push(container_, row);
    return components;
  }

  if (state.step === 2) {
    const s = state.settings;
    container_.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t(sk.qrQuickstepSummary)}`),
    );
    const summaryLines = [
      `**${t(sk.qrMode)}:** ${modeLabel(s.mode, t)}`,
      `**${t(sk.qrUnsafeActionLabel)}:** ${boolLabel(s.unsafeAction.enabled, t)}`,
      `**${t(sk.qrDeleteOnUnsafe)}:** ${boolLabel(s.unsafeAction.deleteMessage, t)}`,
      `**${t(sk.qrSafeActionLabel)}:** ${boolLabel(s.safeAction.enabled, t)}`,
    ];
    container_.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(summaryLines.join("\n")),
    );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`pm:${QR_QUICKSTART_FEATURE}:1:${state.id}:back`)
        .setLabel(String(t(sk.qrQuickstartBack)))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`pm:${QR_QUICKSTART_FEATURE}:1:${state.id}:finish`)
        .setLabel(String(t(sk.qrQuickstartFinish)))
        .setStyle(ButtonStyle.Success),
    );
    components.push(container_, row);
    return components;
  }

  container_.setAccentColor(Colors.Success);
  container_.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${t(sk.qrQuickstartDone)}`),
  );
  components.push(container_);
  return components;
}

function renderModeStep(state: QrQuickstartState, t: TFunction): (ContainerBuilder | ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>)[] {
  const sk = LanguageKeys.Commands.Moderation.SecuritySettings;
  const components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>)[] = [];
  const container_ = new ContainerBuilder().setAccentColor(Colors.Info);
  container_.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${t(sk.qrQuickstepMode)}`),
  );
  container_.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**${t(sk.qrMode)}:** ${modeLabel(state.settings.mode, t)}`),
  );

  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId(`pm:${QR_QUICKSTART_FEATURE}:1:${state.id}:set-mode`)
    .setPlaceholder(String(t(sk.qrChangeMode)))
    .addOptions([
      { label: String(t(sk.qrModeAllowlist)), value: "allowlist", default: state.settings.mode === "allowlist" },
      { label: String(t(sk.qrModeBlocklist)), value: "blocklist", default: state.settings.mode === "blocklist" },
      { label: String(t(sk.qrModeOff)), value: "off", default: state.settings.mode === "off" },
    ]);

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pm:${QR_QUICKSTART_FEATURE}:1:${state.id}:back`)
      .setLabel(String(t(sk.qrQuickstartBack)))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`pm:${QR_QUICKSTART_FEATURE}:1:${state.id}:next`)
      .setLabel(String(t(sk.qrQuickstartNext)))
      .setStyle(ButtonStyle.Primary),
  );

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeSelect);
  components.push(container_, selectRow, navRow);
  return components;
}

export class QrQuickstartHandler extends InteractionHandler {
  public constructor(context: InteractionHandler.LoaderContext, options: InteractionHandler.Options) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.MessageComponent,
    });
  }

  public override parse(interaction: Interaction) {
    if (!interaction.isMessageComponent()) return this.none();
    const parts = parseComponentId(QR_QUICKSTART_FEATURE, interaction.customId);
    if (!parts || parts.length < 2) return this.none();
    return this.some({ stateId: parts[0], action: parts.slice(1).join(":") });
  }

  public override async run(interaction: Interaction, parsed: { stateId: string; action: string }): Promise<void> {
    if (!interaction.isMessageComponent()) return;
    const guildId = interaction.guildId;
    if (!guildId) return replyInteractionExpired(interaction);
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return replyWrongTarget(interaction);

    const state = await qrQuickstartRepository.get(parsed.stateId);
    if (!state) return replyInteractionExpired(interaction);
    if (state.ownerId !== interaction.user.id) return replyWrongTarget(interaction);

    const t = await fetchT(interaction);
    const { action } = parsed;

    if (action === "skip") {
      state.settings.mode = "blocklist";
      state.settings.unsafeAction.enabled = true;
      state.settings.unsafeAction.deleteMessage = true;
      await container.redis.jsonSet(guildId, "QrScanner", state.settings);
      state.step = 3;
      await qrQuickstartRepository.del(parsed.stateId);
      void interaction.update({ components: renderQrQuickstart(state, t), flags: MessageFlags.IsComponentsV2 });
      return;
    }

    if (action === "back") {
      state.step = Math.max(0, state.step - 1);
      await qrQuickstartRepository.save(state);
      if (state.step === 0) {
        void interaction.update({ components: renderModeStep(state, t), flags: MessageFlags.IsComponentsV2 });
      } else {
        void interaction.update({ components: renderQrQuickstart(state, t), flags: MessageFlags.IsComponentsV2 });
      }
      return;
    }

    if (action === "next") {
      if (state.step === 0) {
        void interaction.update({ components: renderModeStep(state, t), flags: MessageFlags.IsComponentsV2 });
        return;
      }
      if (state.step === 1) {
        state.step = 2;
        await qrQuickstartRepository.save(state);
        void interaction.update({ components: renderQrQuickstart(state, t), flags: MessageFlags.IsComponentsV2 });
        return;
      }
    }

    if (action === "toggle-delete") {
      state.settings.unsafeAction.deleteMessage = !state.settings.unsafeAction.deleteMessage;
      await qrQuickstartRepository.save(state);
      void interaction.update({ components: renderQrQuickstart(state, t), flags: MessageFlags.IsComponentsV2 });
      return;
    }

    if (action === "set-mode" && interaction.isStringSelectMenu()) {
      const mode = interaction.values[0];
      if (mode === "allowlist" || mode === "blocklist" || mode === "off") {
        state.settings.mode = mode;
        state.step = 1;
        await qrQuickstartRepository.save(state);
        void interaction.update({ components: renderQrQuickstart(state, t), flags: MessageFlags.IsComponentsV2 });
      }
      return;
    }

    if (action === "finish") {
      state.settings.unsafeAction.enabled = true;
      await container.redis.jsonSet(guildId, "QrScanner", state.settings);
      state.step = 3;
      await qrQuickstartRepository.del(parsed.stateId);
      void interaction.update({ components: renderQrQuickstart(state, t), flags: MessageFlags.IsComponentsV2 });
      return;
    }

    return replyInteractionExpired(interaction);
  }
}
