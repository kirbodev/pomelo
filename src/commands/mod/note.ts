import { Command } from "@sapphire/framework";
import { Subcommand } from "@sapphire/plugin-subcommands";
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
import { db } from "../../db/index.js";
import { modCases, caseNotes, caseCounters } from "../../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import EmbedUtils from "../../utilities/embedUtils.js";

export class NoteCommand extends CommandUtils.PomeloSubcommand {
  public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
    super(context, {
      ...options,
      description: "Manage mod notes on users.",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      requiredUserPermissions: [PermissionFlagsBits.ModerateMembers],
      preconditions: ["GuildOnly"],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const userLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Note.userFieldName,
      LanguageKeys.Commands.Moderation.Note.userFieldDescription,
    );
    const noteLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Note.noteFieldName,
      LanguageKeys.Commands.Moderation.Note.noteFieldDescription,
    );
    const caseIdLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Note.caseIdFieldName,
      LanguageKeys.Commands.Moderation.Note.caseIdFieldDescription,
    );

    registry.registerChatInputCommand((builder) => {
      applyLocalizedBuilder(builder, LanguageKeys.Commands.Moderation.Note.commandName, LanguageKeys.Commands.Moderation.Note.commandDescription)
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])

        .addSubcommand((sub) =>
          applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.Note.subcommandAddName, LanguageKeys.Commands.Moderation.Note.subcommandAddDescription)
            .setName("add")
            .addUserOption((option) =>
              option.setName(userLocs.englishName).setNameLocalizations(userLocs.names).setDescription(userLocs.englishDescription).setDescriptionLocalizations(userLocs.descriptions).setRequired(true),
            )
            .addStringOption((option) =>
              option.setName(noteLocs.englishName).setNameLocalizations(noteLocs.names).setDescription(noteLocs.englishDescription).setDescriptionLocalizations(noteLocs.descriptions).setRequired(true),
            ),
        )

        .addSubcommand((sub) =>
          applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.Note.subcommandListName, LanguageKeys.Commands.Moderation.Note.subcommandListDescription)
            .setName("list")
            .addUserOption((option) =>
              option.setName(userLocs.englishName).setNameLocalizations(userLocs.names).setDescription(userLocs.englishDescription).setDescriptionLocalizations(userLocs.descriptions).setRequired(true),
            ),
        )

        .addSubcommand((sub) =>
          applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.Note.subcommandRemoveName, LanguageKeys.Commands.Moderation.Note.subcommandRemoveDescription)
            .setName("remove")
            .addIntegerOption((option) =>
              option.setName(caseIdLocs.englishName).setNameLocalizations(caseIdLocs.names).setDescription(caseIdLocs.englishDescription).setDescriptionLocalizations(caseIdLocs.descriptions).setRequired(true),
            ),
        );

      return builder;
    });
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "add") {
      const user = interaction.options.getUser("user", true);
      const note = interaction.options.getString("note", true);
      const guildId = interaction.guildId;
      if (!guildId) return;

      // Create a "note" type case first
      const now = Date.now();
      const [counter] = await db
        .insert(caseCounters)
        .values({ guildId, nextCaseNumber: 2, updatedAt: now })
        .onConflictDoUpdate({
          target: caseCounters.guildId,
          set: {
            nextCaseNumber: sql`${caseCounters.nextCaseNumber} + 1`,
            updatedAt: now,
          },
        })
        .returning({
          caseNumber: sql<number>`${caseCounters.nextCaseNumber} - 1`,
        });

      const [caseEntry] = await db.insert(modCases).values({
        guildId,
        caseNumber: counter.caseNumber,
        operationKey: crypto.randomUUID(),
        userId: user.id,
        moderatorId: interaction.user.id,
        actionType: "note",
        reason: note,
        dmSent: false,
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Then add the note
      await db.insert(caseNotes).values({
        guildId,
        caseId: caseEntry.id,
        operationKey: crypto.randomUUID(),
        moderatorId: interaction.user.id,
        note,
        createdAt: now,
      });

      const t = await fetchT(interaction);
      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Success)
        .setDescription(t(LanguageKeys.Commands.Moderation.Note.addedDesc, { user: user.tag }));
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
    }

    if (subcommand === "list") {
      const user = interaction.options.getUser("user", true);
      const guildId = interaction.guildId;
      if (!guildId) return;
      const t = await fetchT(interaction);

      // Get note-type cases
      const userNotes = await db
        .select({
          id: modCases.id,
          moderatorId: modCases.moderatorId,
          reason: modCases.reason,
          createdAt: modCases.createdAt,
        })
        .from(modCases)
        .where(and(eq(modCases.guildId, guildId), eq(modCases.userId, user.id), eq(modCases.actionType, "note")))
        .orderBy(desc(modCases.createdAt))
        .limit(50);

      if (userNotes.length === 0) {
        const embed = new EmbedUtils.EmbedConstructor()
          .setColor(Colors.Info)
          .setDescription(t(LanguageKeys.Commands.Moderation.Note.listEmpty));
        await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
      }

      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(t(LanguageKeys.Commands.Moderation.Note.listTitle, { user: user.tag }))
        .setColor(Colors.Info);

      for (const n of userNotes.slice(0, 10)) {
        const dateStr = n.createdAt ? `<t:${Math.floor(new Date(n.createdAt).getTime() / 1000)}:R>` : "";
        embed.addFields({
          name: `#${n.id} ${dateStr}`,
          value: `<@${n.moderatorId}>: ${n.reason}`,
          inline: false,
        });
      }

      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
    }

    if (subcommand === "remove") {
      const caseId = interaction.options.getInteger("case-id", true);
      const guildId = interaction.guildId;
      if (!guildId) return;
      const t = await fetchT(interaction);

      const [existing] = await db.select().from(modCases).where(eq(modCases.id, caseId)).limit(1);
      if (!existing || existing.actionType !== "note") {
        const embed = new EmbedUtils.EmbedConstructor()
          .setColor(Colors.Error)
          .setDescription(t(LanguageKeys.Commands.Moderation.Errors.caseNotFound));
        await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Error });
      }

      await db.delete(caseNotes).where(eq(caseNotes.caseId, caseId));
      await db.delete(modCases).where(eq(modCases.id, caseId));

      const embed = new EmbedUtils.EmbedConstructor()
        .setColor(Colors.Success)
        .setDescription(t(LanguageKeys.Commands.Moderation.Note.removedDesc, { id: String(caseId) }));
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
    }
  }
}
