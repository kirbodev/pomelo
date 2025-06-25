import { Command } from "@sapphire/framework";
import EmbedUtils from "../../utilities/embedUtils.js";
import { config } from "../../config.js";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  Message,
  MessageFlags,
} from "discord.js";
import qrcode from "qrcode";
import { Colors } from "../../lib/colors.js";
import ComponentUtils from "../../utilities/componentUtils.js";
import { db } from "../../db/index.js";
import { devs } from "../../db/schema.js";
import { TOTP, Secret } from "otpauth";
import { nanoid } from "nanoid";
import CommandUtils, { PomeloReplyType } from "../../utilities/commandUtils.js";

export class UserCommand extends CommandUtils.DevCommand {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description:
        "Set your OTP code, you will need this to run dev commands. This is a one-time setup.",
      detailedDescription: {
        examples: [""],
        syntax: "",
      },
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder //
          .setName(this.name)
          .setDescription(this.description),
      {
        guildIds: config.testServers,
      }
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    await this.execute(interaction);
  }

  public override async messageRun(message: Message) {
    await this.execute(message);
  }

  private async confirmAction(
    interaction: Command.ChatInputCommandInteraction | Message
  ): Promise<ButtonInteraction | null> {
    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle("OTP | Confirm")
      .setDescription(
        "Are you sure you want to set your OTP code? This action is irreversible and you will need database access to reset your code."
      )
      .setColor(Colors.Warning)
      .setFooter({
        text: "This action is irreversible.",
      })
      .setTimestamp();

    const confirmation = new ComponentUtils.ButtonConfirmationConstructor();
    const confirmed = await confirmation.waitForResponse(interaction, {
      embeds: [embed],
      ...(interaction instanceof ChatInputCommandInteraction && {
        flags: MessageFlags.Ephemeral
      }),
    });
    if (!confirmed.response) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle("OTP | Cancelled")
        .setDescription("The OTP setup has been cancelled.")
        .setColor(Colors.Error)
        .setTimestamp();
      if (interaction instanceof ChatInputCommandInteraction) {
        await interaction
          .fetchReply()
          .then((reply) => reply.delete())
          .catch(() => {
            interaction
              .reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => { });
          });
      } else {
        await interaction.delete().catch(() => {
          interaction
            .reply({
              embeds: [embed],
            })
            .catch(() => { });
        });
      }
      return null;
    }
    return confirmed.interaction;
  }

  private async execute(
    interaction: Command.ChatInputCommandInteraction | Message
  ) {
    const user =
      interaction instanceof Message ? interaction.author : interaction.user;
    if (
      (await this.container.utilities.commandUtils.confirmOTPStatus(user)).dev
    ) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle("OTP | Error")
        .setDescription(
          "You have already set an OTP code. If you need to reset it, contact a developer."
        )
        .setColor(Colors.Error)
        .setTimestamp();
      await this.reply(
        interaction,
        {
          embeds: [embed],
        },
        {
          type: PomeloReplyType.Sensitive,
        }
      );
      return;
    }
    const intentButton = await this.confirmAction(interaction);
    if (!intentButton) return;
    const secret = new Secret({
      size: 20,
    });
    const totp = new TOTP({
      label: "Pomelo",
      issuer: "Pomelo",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: secret,
    });
    const buffer = await qrcode.toBuffer(totp.toString());
    const attachment = new AttachmentBuilder(buffer, {
      name: "qr.png",
    });
    const embed = new EmbedUtils.EmbedConstructor()
      .setTitle("OTP | Setup")
      .setDescription(
        'Your secret has been generated. Use an app like [Google Authenticator](https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2) to scan the QR code or enter the secret manually by pressing "+" > "Enter a setup key". On mobile, you can touch and hold on a field to copy its contents. **Do not share this code with anyone.**'
      )
      .setColor(Colors.Info)
      .addField("Secret", secret.base32)
      .setImage("attachment://qr.png")
      .setFooter({
        text: "This code is required to run dev commands.",
      })
      .setTimestamp();
    const id = nanoid();
    const confirmButton = new ActionRowBuilder<ButtonBuilder>().setComponents([
      new ButtonBuilder()
        .setCustomId(id)
        .setLabel("Confirm")
        .setStyle(ButtonStyle.Success),
    ]);
    const intentReply = await intentButton
      .reply({
        embeds: [embed],
        files: [attachment],
        ...(interaction instanceof ChatInputCommandInteraction && {
          flags: MessageFlags.Ephemeral,
        }),
        components: [confirmButton],
        fetchReply: true,
      })
      .catch(() => null);
    if (!intentReply) return;
    const buttonInteraction = await intentReply
      .awaitMessageComponent({
        time: 1000 * 60 * 10,
        filter: (i) => i.customId === id,
        componentType: ComponentType.Button,
      })
      .catch(() => null);
    if (!buttonInteraction) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle("OTP | Error")
        .setDescription("The OTP setup has been cancelled.")
        .setColor(Colors.Error)
        .setTimestamp();
      await intentButton.followUp({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const modalInteraction = await this.showOTPModal(buttonInteraction, {
      lastVerified: null,
      secret: secret.base32,
      userId: intentButton.user.id,
      timestamp: null,
    });
    if (!modalInteraction) return;
    if (!modalInteraction.verified) {
      const embed = new EmbedUtils.EmbedConstructor()
        .setTitle("OTP | Error")
        .setDescription("Your OTP code was invalid. Setup has been cancelled.")
        .setColor(Colors.Error)
        .setTimestamp();
      await this.reply(
        modalInteraction.interaction,
        {
          embeds: [embed],
        },
        {
          type: PomeloReplyType.Sensitive,
        }
      );
      return;
    }
    await db.insert(devs).values({
      userId: intentButton.user.id,
      secret: secret.base32,
    });
    const modalEmbed = new EmbedUtils.EmbedConstructor()
      .setTitle("OTP | Success")
      .setDescription(
        "Your OTP code has been set. You can now run dev commands."
      )
      .setColor(Colors.Success)
      .setTimestamp();
    await this.reply(
      modalInteraction.interaction,
      {
        embeds: [modalEmbed],
      },
      {
        type: PomeloReplyType.Sensitive,
      }
    );
  }
}
