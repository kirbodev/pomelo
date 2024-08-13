import { Command, container, type Awaitable } from "@sapphire/framework";
import { Utility } from "@sapphire/plugin-utilities-store";
import {
  ActionRowBuilder,
  ButtonStyle,
  Message,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  ButtonInteraction,
  type User,
  PermissionsBitField,
  StringSelectMenuInteraction,
  GuildMember,
  type APIInteractionGuildMember,
} from "discord.js";
import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import { devs, type Dev } from "../db/schema.js";
import { nanoid } from "nanoid";
import EmbedUtils from "./embedUtils.js";
import ComponentUtils from "./componentUtils.js";
import { Colors } from "../lib/colors.js";
import type {
  Args,
  DetailedDescriptionCommandObject,
} from "@sapphire/framework";
import { TOTP } from "otpauth";
import { fetchT } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../lib/i18n/languageKeys.js";
import type { AnyInteractableInteraction } from "@sapphire/discord.js-utilities";
import { type UserSettings } from "../db/redis/schema.js";
import { config } from "../config.js";

export type OTPConfirmationResponse = {
  allowed: boolean;
  dev: Dev | null;
};

export default class CommandUtils extends Utility {
  OTP_VALID_TIME = 1000 * 60 * 60; // 1 hour

  public constructor(context: Utility.LoaderContext, options: Utility.Options) {
    super(context, {
      ...options,
      name: "commandUtils",
    });
  }

  /**
   * Get the current status of a user's OTP
   * @returns {boolean | null} - Dev object if the user is allowed/null if the user is no otp exists
   */
  public async confirmOTPStatus(user: User): Promise<OTPConfirmationResponse> {
    const otp = await db.query.devs.findFirst({
      where: eq(devs.userId, user.id),
    });
    if (!otp)
      return {
        allowed: false,
        dev: null,
      };
    if (!otp.lastVerified)
      return {
        allowed: false,
        dev: otp,
      };
    if (otp.lastVerified.getTime() + this.OTP_VALID_TIME < Date.now())
      return {
        allowed: false,
        dev: otp,
      };
    return {
      allowed: true,
      dev: otp,
    };
  }

  public async getCommandName(
    command:
      | Command.ChatInputCommandInteraction
      | Command.ContextMenuCommandInteraction
      | Message
  ) {
    if (command instanceof Message) {
      const prefix = [
        ...((await this.container.client.fetchPrefix(command)) ?? []),
      ];
      const prefixed = this.messageStartsWithArray(command.content, prefix);
      // We know that client.user exists at this point
      if (
        !prefixed &&
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        command.content.startsWith(`<@${this.container.client.user!.id}>`)
      )
        return;
      command.content
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        .replace(`<@${this.container.client.user!.id}>`, "")
        .trim()
        .split(" ")[0];
      if (!prefixed) return null;
      return command.content.replace(prefixed, "").split(" ")[0];
    }
  }

  private messageStartsWithArray(message: string, arr: string[]) {
    // Check if message starts with any string in array
    for (const item of arr) {
      if (message.startsWith(item)) return item;
    }
    return false;
  }

  public getPermissionNames(permissions: PermissionsBitField): string[] {
    const result = [];

    for (const perm of Object.keys(PermissionsBitField.Flags)) {
      //@ts-expect-error - TS doesn't like this but it's fine
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (permissions.has(PermissionsBitField.Flags[perm])) {
        result.push(perm);
      }
    }
    return result;
  }

  static PomeloCommand = class PomeloCommand extends Command {
    public constructor(
      context: Command.LoaderContext,
      options: Command.Options
    ) {
      super(context, {
        ...options,
      });
    }

    public async getUserSettings(
      user: User | string
    ): Promise<UserSettings | null> {
      const userId = typeof user === "string" ? user : user.id;
      const settings = await this.container.redis.jsonGet(
        userId,
        "UserSettings"
      );
      return settings;
    }

    public isUserEligible(
      member: GuildMember | APIInteractionGuildMember
    ): boolean {
      return CommandUtils.isUserEligible(member, this.name);
    }

    public async sendSyntaxError(
      interaction: AnyInteractableInteraction | Message
    ) {
      const t = await fetchT(interaction);
      const desc = this.detailedDescription as DetailedDescriptionCommandObject;
      const prefix = this.container.client.options.defaultPrefix as string;
      const examples = desc.examples
        .map((ex) => `${prefix}${this.name} ${ex}`)
        .join("\n");
      const syntax = `${prefix}${this.name} ${desc.syntax}`;
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle(t(LanguageKeys.Errors.SyntaxError.title))
        .setDescription(t(LanguageKeys.Errors.SyntaxError.desc))
        .setFields([
          {
            name: t(LanguageKeys.Errors.SyntaxError.syntaxFieldTitle),
            value: `\`\`\`${syntax}\`\`\``,
          },
          {
            name: t(LanguageKeys.Errors.SyntaxError.exampleFieldTitle),
            value: examples,
          },
        ])
        .setColor(Colors.Error)
        .setTimestamp();

      // type issues in discord.js
      if (
        interaction instanceof ModalSubmitInteraction ||
        interaction instanceof ButtonInteraction ||
        interaction instanceof StringSelectMenuInteraction
      ) {
        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      } else if (interaction instanceof Message) {
        await interaction.reply({
          embeds: [embed],
        });
      } else {
        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      }
    }

    public getUser(interaction: AnyInteractableInteraction | Message) {
      if (interaction instanceof Message) return interaction.author;
      return interaction.user;
    }
  };

  static ModCommand = class ModCommand extends CommandUtils.PomeloCommand {};

  static isUserEligible(
    member: GuildMember | APIInteractionGuildMember,
    commandName: string
  ): boolean {
    // for now, only check the permissions
    const command = container.stores.get("commands").get(commandName);
    if (!command) throw new Error("Command not found");
    const devRequired = command.options.preconditions?.includes("OwnerOnly");
    if (devRequired && !config.owners.includes(member.user.id)) return false;
    const required = command.options.requiredUserPermissions;
    if (!required) return true;
    if (typeof member.permissions === "string") return false;
    return member.permissions.has(required);
  }

  /**
   * Utility class to add safety to dev commands
   * @extends Command
   */
  static DevCommand = class DevCommand extends CommandUtils.PomeloCommand {
    public constructor(
      context: Command.LoaderContext,
      options: Command.Options
    ) {
      super(context, {
        ...options,
        preconditions: ["OwnerOnly"],
      });
    }

    protected async showOTPModal(
      interaction:
        | ButtonInteraction
        | Command.ChatInputCommandInteraction
        | Command.ContextMenuCommandInteraction,
      dev: Dev
    ): Promise<{
      verified: boolean;
      interaction: ModalSubmitInteraction;
    } | null> {
      console.log("showOTPModal");
      const id = nanoid();
      const modal = new ModalBuilder()
        .setTitle("Verify your identity")
        .setCustomId(id)
        .setComponents([
          new ActionRowBuilder<TextInputBuilder>().setComponents([
            new TextInputBuilder()
              .setCustomId(`${id}-code`)
              .setLabel("OTP Code")
              .setMinLength(6)
              .setMaxLength(6)
              .setPlaceholder("123456")
              .setRequired(true)
              .setStyle(TextInputStyle.Short),
          ]),
        ]);
      await interaction.showModal(modal);
      const modalInteraction = await interaction
        .awaitModalSubmit({
          time: 1000 * 60 * 10,
          filter: (i) => i.customId === id,
        })
        .catch(() => null);
      if (!modalInteraction) return null;
      const code = modalInteraction.fields.getTextInputValue(`${id}-code`);
      if (!code) return null;
      const verify = new TOTP({
        secret: dev.secret,
        digits: 6,
        period: 30,
        algorithm: "SHA1",
      }).validate({
        token: code,
        window: 1,
      });
      return {
        verified: verify !== null,
        interaction: modalInteraction,
      };
    }

    protected async verifyDev(
      interaction:
        | Command.ChatInputCommandInteraction
        | Command.ContextMenuCommandInteraction
        | ButtonInteraction
    ): Promise<ModalSubmitInteraction | true | null> {
      const user = interaction.user;
      const otpStatus =
        await this.container.utilities.commandUtils.confirmOTPStatus(user);
      const otp = otpStatus.dev;
      if (!otp) {
        const embed = new EmbedUtils.EmbedConstructor()
          .setTitle("OTP | Error")
          .setDescription("You need to set up an OTP code first. Run `/otp`.")
          .setColor(Colors.Error)
          .setTimestamp();
        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
        return null;
      }
      if (!otpStatus.allowed) {
        const confirmed = await this.showOTPModal(interaction, otp);
        if (!confirmed) {
          const embed = new EmbedUtils.EmbedConstructor()
            .setTitle("OTP | Error")
            .setDescription("OTP code is invalid.")
            .setColor(Colors.Error)
            .setTimestamp();
          await interaction.reply({
            embeds: [embed],
            ephemeral: true,
          });
          return null;
        }
        await db
          .update(devs)
          .set({
            lastVerified: new Date(),
          })
          .where(eq(devs.userId, user.id));
        return confirmed.interaction;
      }
      return true;
    }

    private async messageToInteraction(
      interaction: Message
    ): Promise<ButtonInteraction | null> {
      const msgEmbed = new EmbedUtils.EmbedConstructor()
        .setTitle("Verify your identity")
        .setDescription(
          "You need to verify your identity to run this command. Click the button below to enter an OTP code."
        )
        .setTimestamp();
      const confirmation = new ComponentUtils.ButtonConfirmationConstructor({
        buttons: {
          confirm: {
            text: "Verify",
            style: ButtonStyle.Primary,
          },
          cancel: {
            text: "Dismiss",
            style: ButtonStyle.Secondary,
          },
        },
      });
      const confirmed = await confirmation.waitForResponse(interaction, {
        embeds: [msgEmbed],
      });
      if (!confirmed.response) {
        await confirmed.interaction?.message.delete();
        return null;
      }
      if (confirmed.interaction)
        void this.container.utilities.componentUtils.disableButtons(
          confirmed.interaction.message
        );
      return confirmed.interaction;
    }

    public override async chatInputRun(
      interaction: Command.ChatInputCommandInteraction
    ) {
      const verified = await this.verifyDev(interaction);
      if (!verified) return;
      if (verified === true)
        return this.verifiedChatInputRun(interaction, interaction);
      return this.verifiedChatInputRun(verified, interaction);
    } // This will run code without an OTP check first

    public override async contextMenuRun(
      interaction: Command.ContextMenuCommandInteraction
    ) {
      const verified = await this.verifyDev(interaction);
      if (!verified) return;
      if (verified === true)
        return this.verifiedContextMenuRun(interaction, interaction);
      return this.verifiedContextMenuRun(verified, interaction);
    } // This will run code without an OTP check first

    public override async messageRun(message: Message, args: Args) {
      const interaction = await this.messageToInteraction(message);
      if (!interaction) return;
      const verified = await this.verifyDev(interaction);
      if (!verified) return;
      if (verified === true) return this.verifiedMessageRun(interaction, args);
      return this.verifiedMessageRun(verified, args);
    } // This will run code without an OTP check first

    public verifiedChatInputRun(
      interaction: ModalSubmitInteraction | Command.ChatInputCommandInteraction,
      originalInteraction: Command.ChatInputCommandInteraction
    ): Awaitable<unknown>;

    public verifiedChatInputRun() {}

    public verifiedContextMenuRun(
      interaction:
        | ModalSubmitInteraction
        | Command.ContextMenuCommandInteraction,
      originalInteraction: Command.ContextMenuCommandInteraction
    ): Awaitable<unknown>;

    public verifiedContextMenuRun() {}

    public verifiedMessageRun(
      interaction: ModalSubmitInteraction | ButtonInteraction,
      args: Args
    ): Awaitable<unknown>;

    public verifiedMessageRun() {}
  };
}

declare module "@sapphire/plugin-utilities-store" {
  export interface Utilities {
    commandUtils: CommandUtils;
  }
}
