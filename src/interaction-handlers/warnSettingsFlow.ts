import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type Interaction,
} from "discord.js";
import { Colors } from "../lib/colors.js";
import {
  parseComponentId,
  replyInteractionExpired,
  replyWrongTarget,
} from "../lib/helpers/componentSessions.js";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import { PRESETS } from "../lib/moderation/presets.js";
import { WARN_SETTINGS_FEATURE } from "../commands/mod/modSettings.js";
import { db } from "../db/index.js";
import { warnSettings } from "../db/schema.js";

/**
 * Persistent preset picker for /modsettings preset. Permissions are
 * re-validated on every selection — the custom ID is only routing.
 */
export class WarnSettingsFlowHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.SelectMenu,
    });
  }

  public override parse(interaction: Interaction) {
    if (!interaction.isStringSelectMenu()) return this.none();
    const parts = parseComponentId(WARN_SETTINGS_FEATURE, interaction.customId);
    if (!parts || parts.length !== 2 || parts[1] !== "preset")
      return this.none();
    return this.some({ userId: parts[0] });
  }

  public override async run(
    interaction: Interaction,
    parsed: { userId: string },
  ): Promise<void> {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.user.id !== parsed.userId)
      return replyWrongTarget(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return replyInteractionExpired(interaction);
    if (
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    )
      return replyWrongTarget(interaction);

    const presetEntry = Object.entries(PRESETS).find(
      ([key]) => key === interaction.values[0],
    );
    if (!presetEntry) return replyInteractionExpired(interaction);
    const actionsJson = JSON.stringify(presetEntry[1].levels);

    await db
      .insert(warnSettings)
      .values({ guildId, actions: actionsJson })
      .onConflictDoUpdate({
        target: warnSettings.guildId,
        set: { actions: actionsJson },
      });

    const t = await fetchT(interaction);
    await interaction.reply({
      components: [
        new ContainerBuilder()
          .setAccentColor(Colors.Success)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              t(LanguageKeys.Commands.Moderation.WarnSettings.updated),
            ),
          ),
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }
}
