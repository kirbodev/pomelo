import { container } from "@sapphire/framework";
import type { TFunction } from "@sapphire/plugin-i18next";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { nanoid } from "nanoid";
import { LanguageKeys } from "../i18n/languageKeys.js";
import {
  createComponentId,
  saveComponentSession,
} from "../helpers/componentSessions.js";
import type {
  QuickActionBuiltin,
  QuickActionDefinition,
  QuickActionSession,
  QuickActionTrigger,
} from "./types.js";

const ALL_BUILTINS: QuickActionBuiltin[] = ["mute", "kick", "ban", "warn"];

const BUILTIN_STYLES: Record<QuickActionBuiltin, ButtonStyle> = {
  mute: ButtonStyle.Secondary,
  kick: ButtonStyle.Danger,
  ban: ButtonStyle.Danger,
  warn: ButtonStyle.Secondary,
};

const MAX_ACTION_ROW_BUTTONS = 5;
const SESSION_TTL_SECONDS = 900;

const baseSession = (opts: {
  guildId: string;
  moderatorId: string;
  targetId: string;
  channelId: string;
}): Omit<QuickActionSession, "kind"> => ({
  guildId: opts.guildId,
  moderatorId: opts.moderatorId,
  targetId: opts.targetId,
  channelId: opts.channelId,
});

export async function buildQuickActionRow(opts: {
  guildId: string;
  moderatorId: string;
  targetId: string;
  channelId: string;
  executedAction: QuickActionBuiltin;
  t: TFunction;
}): Promise<{ row: ActionRowBuilder<ButtonBuilder> | null }> {
  const settings = await container.redis.jsonGet(opts.guildId, "GuildSettings");
  const config = settings?.quickActions ?? { actions: [] };

  const trigger = opts.executedAction as QuickActionTrigger;
  const matchingActions = config.actions.filter((a: QuickActionDefinition) =>
    a.triggers.includes(trigger),
  );

  const builtins = ALL_BUILTINS.filter(
    (action) => action !== opts.executedAction,
  );

  const totalSlots = MAX_ACTION_ROW_BUTTONS;
  const builtinSlots = builtins.slice(0, totalSlots);
  const remainingSlots = totalSlots - builtinSlots.length;
  const customSlots = matchingActions.slice(0, remainingSlots);

  if (builtinSlots.length + customSlots.length === 0) {
    return { row: null };
  }

  const buttons: ButtonBuilder[] = [];

  for (const action of builtinSlots) {
    const sessionId = nanoid();
    const session: QuickActionSession = {
      ...baseSession(opts),
      kind: "builtin",
      action,
    };
    await saveComponentSession("qa", sessionId, session, SESSION_TTL_SECONDS);

    buttons.push(
      new ButtonBuilder()
        .setCustomId(createComponentId("qa", sessionId, action))
        .setLabel(opts.t(LanguageKeys.Commands.Moderation.QuickActions[action]))
        .setStyle(BUILTIN_STYLES[action]),
    );
  }

  for (const qa of customSlots) {
    const sessionId = nanoid();
    const session: QuickActionSession = {
      ...baseSession(opts),
      kind: "custom",
      label: qa.label,
      subactions: qa.subactions,
    };
    await saveComponentSession("qa", sessionId, session, SESSION_TTL_SECONDS);

    buttons.push(
      new ButtonBuilder()
        .setCustomId(createComponentId("qa", sessionId, "custom"))
        .setLabel(qa.label)
        .setStyle(ButtonStyle.Primary),
    );
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  return { row };
}
