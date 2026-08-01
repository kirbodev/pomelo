import { Args, Command } from "@sapphire/framework";
import { Subcommand } from "@sapphire/plugin-subcommands";
import { applyLocalizedBuilder, fetchT } from "@sapphire/plugin-i18next";
import {
  ApplicationIntegrationType,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  GuildMember,
} from "discord.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";
import { getOptionLocalizations } from "../../lib/i18n/utils.js";
import { modActionService } from "../../lib/moderation/actions.js";
import { handleWarnResult } from "../../lib/moderation/warnReply.js";
import { Colors } from "../../lib/colors.js";
import { db } from "../../db/index.js";
import { warns } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import EmbedUtils from "../../utilities/embedUtils.js";

export class WarnsCommand extends CommandUtils.PomeloSubcommand {
  public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
    super(context, {
      ...options,
      description: "Look through, remove, and manage warns.",
      requiredClientPermissions: [PermissionFlagsBits.EmbedLinks],
      requiredUserPermissions: [PermissionFlagsBits.ModerateMembers],
      preconditions: ["GuildOnly"],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const userLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Warn.userFieldName,
      LanguageKeys.Commands.Moderation.Warn.userFieldDescription,
    );
    const reasonLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Warn.reasonFieldName,
      LanguageKeys.Commands.Moderation.Warn.reasonFieldDescription,
    );
    const amountLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Warn.amountFieldName,
      LanguageKeys.Commands.Moderation.Warn.amountFieldDescription,
    );
    const usersLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Warn.usersFieldName,
      LanguageKeys.Commands.Moderation.Warn.usersFieldDescription,
    );
    const levelLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Warn.levelFieldName,
      LanguageKeys.Commands.Moderation.Warn.levelFieldDescription,
    );
    const caseIdLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Warn.caseIdFieldName,
      LanguageKeys.Commands.Moderation.Warn.caseIdFieldDescription,
    );
    const listUserLocs = getOptionLocalizations(
      LanguageKeys.Commands.Moderation.Warn.userFieldName,
      LanguageKeys.Commands.Moderation.Warn.userFieldDescription,
    );

    registry.registerChatInputCommand((builder) => {
      applyLocalizedBuilder(
        builder,
        LanguageKeys.Commands.Moderation.Warn.warnsCommandName,
        LanguageKeys.Commands.Moderation.Warn.warnsCommandDescription,
      )
        .setName(this.name)
        .setDescription(this.description)
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])

        .addSubcommand((sub) =>
          applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.Warn.subcommandListName, LanguageKeys.Commands.Moderation.Warn.subcommandListDescription)
            .setName("list")
            .addUserOption((option) =>
              option.setName(listUserLocs.englishName).setNameLocalizations(listUserLocs.names).setDescription(listUserLocs.englishDescription).setDescriptionLocalizations(listUserLocs.descriptions).setRequired(true),
            ),
        )

        .addSubcommand((sub) =>
          applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.Warn.subcommandRemoveName, LanguageKeys.Commands.Moderation.Warn.subcommandRemoveDescription)
            .setName("remove")
            .addIntegerOption((option) =>
              option.setName(caseIdLocs.englishName).setNameLocalizations(caseIdLocs.names).setDescription(caseIdLocs.englishDescription).setDescriptionLocalizations(caseIdLocs.descriptions).setRequired(true),
            ),
        )

        .addSubcommandGroup((group) =>
          applyLocalizedBuilder(group, LanguageKeys.Commands.Moderation.Warn.subcommandLevelName, LanguageKeys.Commands.Moderation.Warn.subcommandLevelDescription)
            .setName("level")
            .addSubcommand((sub) =>
              applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.Warn.subcommandSetName, LanguageKeys.Commands.Moderation.Warn.subcommandSetDescription)
                .setName("set")
                .addUserOption((option) =>
                  option.setName(userLocs.englishName).setNameLocalizations(userLocs.names).setDescription(userLocs.englishDescription).setDescriptionLocalizations(userLocs.descriptions).setRequired(true),
                )
                .addIntegerOption((option) =>
                  option.setName(levelLocs.englishName).setNameLocalizations(levelLocs.names).setDescription(levelLocs.englishDescription).setDescriptionLocalizations(levelLocs.descriptions).setRequired(true).setMinValue(1).setMaxValue(10),
                )
                .addStringOption((option) =>
                  option.setName(reasonLocs.englishName).setNameLocalizations(reasonLocs.names).setDescription(reasonLocs.englishDescription).setDescriptionLocalizations(reasonLocs.descriptions).setRequired(false),
                ),
            ),
        )

        .addSubcommand((sub) =>
          applyLocalizedBuilder(sub, LanguageKeys.Commands.Moderation.Warn.subcommandMultiName, LanguageKeys.Commands.Moderation.Warn.subcommandMultiDescription)
            .setName("multi")
            .addStringOption((option) =>
              option.setName(usersLocs.englishName).setNameLocalizations(usersLocs.names).setDescription(usersLocs.englishDescription).setDescriptionLocalizations(usersLocs.descriptions).setRequired(true),
            )
            .addStringOption((option) =>
              option.setName(reasonLocs.englishName).setNameLocalizations(reasonLocs.names).setDescription(reasonLocs.englishDescription).setDescriptionLocalizations(reasonLocs.descriptions).setRequired(false),
            )
            .addIntegerOption((option) =>
              option.setName(amountLocs.englishName).setNameLocalizations(amountLocs.names).setDescription(amountLocs.englishDescription).setDescriptionLocalizations(amountLocs.descriptions).setRequired(false).setMinValue(1).setMaxValue(10),
            ),
        );

      return builder;
    });
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const subcommand = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup();

    if (group === "level" && subcommand === "set") {
      const user = interaction.options.getUser("user", true);
      const level = interaction.options.getInteger("level", true);
      const reason = interaction.options.getString("reason");
      const member = interaction.guild?.members.cache.get(user.id);
      if (!member) {
        const t = await fetchT(interaction);
        const embed = new EmbedUtils.EmbedConstructor().setColor(Colors.Error).setDescription(t(LanguageKeys.Commands.Moderation.Errors.targetNotInGuild));
        await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Error });
        return;
      }
      const moderator = interaction.member instanceof GuildMember ? interaction.member : null;
      if (!moderator || !interaction.guild) return;
      const result = await modActionService.setWarnLevel(interaction.guild, moderator, member, level, reason ?? undefined);
      await handleWarnResult(this, interaction, result, member);
    } else if (subcommand === "list") {
      const user = interaction.options.getUser("user", true);
      const t = await fetchT(interaction);
      const activeWarns = await db
        .select()
        .from(warns)
        .where(and(eq(warns.guildId, interaction.guildId!), eq(warns.userId, user.id), eq(warns.revoked, false)))
        .limit(20);

      if (activeWarns.length === 0) {
        const embed = new EmbedUtils.EmbedConstructor().setColor(Colors.Info).setDescription(t(LanguageKeys.Commands.Moderation.Warn.listEmpty));
        await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
      }

      const descLines = [t(LanguageKeys.Commands.Moderation.Warn.listTitle, { user: user.tag })];

      for (const w of activeWarns) {
        const expires = w.expiresAt ? `<t:${Math.floor(new Date(w.expiresAt).getTime() / 1000)}:R>` : "Never";
        descLines.push(t(LanguageKeys.Commands.Moderation.Warn.listEntry, { id: String(w.id), reason: "No reason", expiry: expires }));
      }

      const embed = new EmbedUtils.EmbedConstructor().setColor(Colors.Info).setDescription(descLines.join("\n"));
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
    } else if (subcommand === "remove") {
      const caseId = interaction.options.getInteger("case-id", true);
      const moderator = interaction.member instanceof GuildMember ? interaction.member : null;
      if (!moderator) return;
      const t = await fetchT(interaction);
      const result = await modActionService.unwarn(caseId, moderator.id);

      if (!result.success) {
        const errText = result.error === "caseNotFound"
          ? t(LanguageKeys.Commands.Moderation.Errors.caseNotFound)
          : t(LanguageKeys.Commands.Moderation.Errors.warnAlreadyRevoked);
        const embed = new EmbedUtils.EmbedConstructor().setColor(Colors.Error).setDescription(errText);
        await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Error });
      }

      const embed = new EmbedUtils.EmbedConstructor().setColor(Colors.Success).setDescription("Warn removed.");
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
    } else if (subcommand === "multi") {
      const usersStr = interaction.options.getString("users", true);
      const reason = interaction.options.getString("reason");
      const amount = interaction.options.getInteger("amount") ?? 1;
      const t = await fetchT(interaction);

      const userIds = usersStr.split(",").map(s => s.trim().replace(/[<@!>]/g, "")).filter(Boolean);
      if (userIds.length === 0) {
        const embed = new EmbedUtils.EmbedConstructor().setColor(Colors.Error).setDescription(t(LanguageKeys.Commands.Moderation.Errors.multiWarnParseError));
        await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Error });
      }

      let successCount = 0;
      const moderator = interaction.member instanceof GuildMember ? interaction.member : null;
      if (!moderator) return;

      for (const uid of userIds) {
        const member = interaction.guild?.members.cache.get(uid);
        if (!member) continue;
        if (!interaction.guild) continue;
        const result = await modActionService.warn(interaction.guild, moderator, member, reason ?? undefined, amount);
        if (result.success) successCount++;
      }

      const embed = new EmbedUtils.EmbedConstructor().setColor(Colors.Success).setDescription(`Warned ${successCount} user(s).`);
      await this.reply(interaction, { embeds: [embed] }, { type: PomeloReplyType.Success });
    }
  }

  public override async messageRun(message: Message, _args: Args) {
    await message.reply("Use the slash command /warns.");
  }
}
