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
import { WARN_SETTINGS_FEATURE } from "../commands/mod/modSettings.js";
import { db } from "../db/index.js";
import { warnSettings } from "../db/schema.js";

/**
 * Persistent modal-submit handler for the /warnsettings roles config modal.
 * The guild and permissions are re-validated on submit.
 */
export class WarnSettingsModalHandler extends InteractionHandler {
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
    const parts = parseComponentId(WARN_SETTINGS_FEATURE, interaction.customId);
    if (!parts || parts.length !== 2 || parts[1] !== "roles")
      return this.none();
    return this.some({ userId: parts[0] });
  }

  public override async run(
    interaction: Interaction,
    parsed: { userId: string },
  ): Promise<void> {
    if (!interaction.isModalSubmit()) return;
    if (interaction.user.id !== parsed.userId)
      return replyWrongTarget(interaction);
    const guildId = interaction.guildId;
    if (!guildId) return replyInteractionExpired(interaction);
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return replyWrongTarget(interaction);

    const configStr = interaction.fields.getTextInputValue("config").trim();

    await db
      .insert(warnSettings)
      .values({ guildId, roleApply: configStr || null })
      .onConflictDoUpdate({
        target: warnSettings.guildId,
        set: { roleApply: configStr || null },
      });

    const t = await fetchT(interaction);
    await interaction.reply({
      components: [
        new ContainerBuilder()
          .setAccentColor(Colors.Success)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              t(LanguageKeys.Commands.Moderation.WarnSettings.roleConfigSaved),
            ),
          ),
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }
}
