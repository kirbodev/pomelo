import { Command } from "@sapphire/framework";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import {
  ApplicationIntegrationType,
  Message,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { modActionService } from "../../lib/moderation/actions.js";
import { Colors } from "../../lib/colors.js";
import EmbedUtils from "../../utilities/embedUtils.js";
import ComponentUtils from "../../utilities/componentUtils.js";
import { db } from "../../db/index.js";
import { caseNotes } from "../../db/schema.js";
import { eq, count } from "drizzle-orm";
import type { ActionType } from "../../lib/moderation/types.js";
import { userMention } from "../../lib/helpers/stringUtils.js";

export class CaseCommand extends CommandUtils.ModCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: "View moderation history for a user.",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      requiredUserPermissions: [PermissionFlagsBits.ModerateMembers],
      preconditions: ["GuildOnly"],
      detailedDescription: {
        syntax: "<user> [action_type]",
        examples: ["@user", "@user ban"],
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const userLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Case.userFieldName,
      LanguageKeys.Commands.Moderation.Case.userFieldDescription,
    );
    const typeLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Case.actionTypeFieldName,
      LanguageKeys.Commands.Moderation.Case.actionTypeFieldDescription,
    );

    registry.registerChatInputCommand((builder) =>
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Moderation.Case.commandName,
        LanguageKeys.Commands.Moderation.Case.commandDescription,
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .addUserOption((option) =>
          option
            .setName(userLocs.englishName)
            .setNameLocalizations(userLocs.names)
            .setDescription(userLocs.englishDescription)
            .setDescriptionLocalizations(userLocs.descriptions)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName(typeLocs.englishName)
            .setNameLocalizations(typeLocs.names)
            .setDescription(typeLocs.englishDescription)
            .setDescriptionLocalizations(typeLocs.descriptions)
            .setRequired(false)
            .addChoices(
              { name: "All", value: "all" },
              { name: "Ban", value: "ban" },
              { name: "Unban", value: "unban" },
              { name: "Kick", value: "kick" },
              { name: "Mute", value: "mute" },
              { name: "Unmute", value: "unmute" },
              { name: "Warn", value: "warn" },
              { name: "Unwarn", value: "unwarn" },
              { name: "Note", value: "note" },
            ),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const user = interaction.options.getUser("user", true);
    const actionType = interaction.options.getString("action-type") ?? "all";

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.showCases(interaction, user, actionType);
  }

  public override async messageRun(
    message: Message,
    args: import("@sapphire/framework").Args,
  ) {
    const user = await args.pick("user");
    await this.showCases(message, user, "all");
  }

  private async showCases(
    interaction: Command.ChatInputCommandInteraction | Message,
    user: import("discord.js").User,
    filterType: string,
  ) {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const t = await fetchT(interaction);

    const { cases, total } = await modActionService.getCasesForUser(
      guildId,
      user.id,
      filterType as ActionType,
      100,
      0,
    );

    if (total === 0) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(
          t(LanguageKeys.Commands.Moderation.Case.title, {
            user: userMention(user),
          }),
        )
        .setDescription(t(LanguageKeys.Commands.Moderation.Case.empty))
        .setColor(Colors.Info);
      return this.reply(
        interaction,
        { embeds: [embed] },
        { type: PomeloReplyType.Success },
      );
    }

    // Get note counts for all cases
    const noteCounts = new Map<number, number>();
    for (const c of cases) {
      if (c.id) {
        const [result] = await db
          .select({ c: count() })
          .from(caseNotes)
          .where(eq(caseNotes.caseId, c.id));
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        noteCounts.set(c.id, result.c ?? 0);
      }
    }

    // Build pages: 5 cases per page
    const pageSize = 5;
    const totalPages = Math.ceil(cases.length / pageSize);
    const pages: Array<{ embeds: [import("discord.js").EmbedBuilder] }> = [];

    for (let page = 0; page < totalPages; page++) {
      const start = page * pageSize;
      const pageCases = cases.slice(start, start + pageSize);

      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(
          t(LanguageKeys.Commands.Moderation.Case.title, {
            user: userMention(user),
          }),
        )
        .setColor(Colors.Info)
        .setFooter({
          text: t(LanguageKeys.Commands.Moderation.Case.page, {
            page: String(page + 1),
            total: String(totalPages),
          }),
        });

      for (const c of pageCases) {
        const dateStr = c.createdAt
          ? `<t:${Math.floor(new Date(c.createdAt).getTime() / 1000).toString()}:R>`
          : t(LanguageKeys.Commands.Moderation.Fields.unknown);
        const nCount = noteCounts.get(c.id) ?? 0;

        embed.addFields({
          name: t(LanguageKeys.Commands.Moderation.Case.caseHeader, {
            id: String(c.id),
            action: c.actionType.toUpperCase(),
          }),
          value: [
            `**${t(LanguageKeys.Commands.Moderation.Case.fields.moderator)}:** <@${c.moderatorId}>`,
            `**${t(LanguageKeys.Commands.Moderation.Case.fields.reason)}:** ${c.reason || t(LanguageKeys.Commands.Moderation.Fields.noReason)}`,
            `**${t(LanguageKeys.Commands.Moderation.Case.fields.dmStatus)}:** ${c.dmSent ? ":white_check_mark:" : ":x:"}`,
            `**${t(LanguageKeys.Commands.Moderation.Case.fields.date)}:** ${dateStr}`,
            `**${t(LanguageKeys.Commands.Moderation.Case.fields.notes)}:** ${t(LanguageKeys.Commands.Moderation.Fields.notesCount, { count: nCount })}`,
          ].join("\n"),
          inline: false,
        });
      }

      pages.push({ embeds: [embed] });
    }

    const paginated = new ComponentUtils.PomeloPaginatedMessage().addPages(
      pages,
    );
    await paginated.run(interaction);
  }
}
