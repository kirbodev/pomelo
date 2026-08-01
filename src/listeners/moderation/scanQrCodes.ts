import { Listener } from "@sapphire/framework";
import { fetchT, type TFunction } from "@sapphire/plugin-i18next";
import {
  Events,
  type Attachment,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { downloadAttachment } from "../../lib/helpers/qrImageDownload.js";
import {
  scanImage,
  evaluateQrSafety,
  parseQrData,
  type QRDecodeResult,
  type ParsedQrData,
} from "../../lib/moderation/qr-scanner.js";
import type { QrScannerSettings } from "../../db/redis/schema.js";
import { Colors } from "../../lib/colors.js";
import { LanguageKeys } from "../../lib/i18n/languageKeys.js";

export class ScanQrCodesListener extends Listener {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, {
      ...options,
      event: Events.MessageCreate,
    });
  }

  public override async run(message: Message) {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.attachments.size) return;

    const imageAttachments = message.attachments.filter((a) =>
      a.contentType?.startsWith("image/") ?? false,
    );
    if (!imageAttachments.size) return;

    let settings: QrScannerSettings | null;
    try {
      settings = (await this.container.redis.jsonGet(
        message.guildId!,
        "QrScanner",
      ));
    } catch (error) {
      this.container.logger.error(
        "[QRScanner] Failed to fetch settings for guild %s: %s",
        message.guildId,
        error,
      );
      return;
    }
    if (!settings || settings.mode === "off") return;

    const t = await fetchT(message);

    try {
      for (const attachment of imageAttachments.values()) {
        await this.processAttachment(attachment, message, settings, t);
      }
    } catch (error) {
      this.container.logger.error(
        "[QRScanner] Unexpected error processing attachments: %s",
        error,
      );
    }
  }

  private async processAttachment(
    attachment: Attachment,
    message: Message,
    settings: QrScannerSettings,
    t: TFunction,
  ): Promise<void> {
    if (!attachment) return;

    let buffer: Buffer | null;
    try {
      buffer = await downloadAttachment(attachment.url);
    } catch (error) {
      this.container.logger.error(
        "[QRScanner] Failed to download attachment %s: %s",
        attachment.id,
        error,
      );
      return;
    }
    if (!buffer) return;

    let results: QRDecodeResult[];
    try {
      results = await scanImage(buffer);
    } catch (error) {
      this.container.logger.error(
        "[QRScanner] Failed to scan attachment %s: %s",
        attachment.id,
        error,
      );
      return;
    }
    if (!results.length) return;

    const evaluations: Array<{ parsed: ParsedQrData; safety: "safe" | "unsafe" }> = [];
    for (const result of results) {
      try {
        const parsed = parseQrData(result.raw, result.contentType);
        const safety = evaluateQrSafety(parsed, {
          mode: settings.mode,
          customAllowlist: settings.customAllowlist,
          customBlocklist: settings.customBlocklist,
          defaultAllowlistEnabled: settings.defaultAllowlistEnabled,
          defaultBlocklistEnabled: settings.defaultBlocklistEnabled,
        });
        evaluations.push({ parsed, safety });
      } catch (error) {
        this.container.logger.error(
          "[QRScanner] Error evaluating QR result: %s",
          error,
        );
      }
    }

    const hasUnsafe = evaluations.some((e) => e.safety === "unsafe");

    if (hasUnsafe) {
      const firstUnsafe = evaluations.find((e) => e.safety === "unsafe")!;
      await this.handleUnsafe(firstUnsafe.parsed, message, settings, t);
    } else {
      const firstSafe = evaluations.find((e) => e.safety === "safe");
      if (firstSafe && settings.safeAction.enabled) {
        await this.handleSafe(firstSafe.parsed, message, settings, t);
      }
    }
  }

  private async handleUnsafe(
    data: ParsedQrData,
    message: Message,
    settings: QrScannerSettings,
    t: TFunction,
  ): Promise<void> {
    if (!settings.unsafeAction.enabled) return;

    const alertChannelId = settings.unsafeAction.channelId;
    if (alertChannelId) {
      try {
        const channel = message.client.channels.cache.get(alertChannelId);
        if (channel && "send" in channel) {
          const sk = LanguageKeys.Commands.Moderation.SecuritySettings;
          const truncated = data.raw.length > 1000 ? `${data.raw.slice(0, 1000)}…` : data.raw;

          const container = new ContainerBuilder()
            .setAccentColor(Colors.Error)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                [
                  `## ⚠️ ${t(sk.qrUnsafeAlertTitle)}`,
                  "",
                  `**${t(sk.qrUnsafeAlertAuthor)}:** ${message.author}`,
                  `**${t(sk.qrUnsafeAlertChannel)}:** ${message.channel}`,
                  `**${t(sk.qrUnsafeAlertContentType)}:** ${data.contentType}`,
                  "",
                  "```",
                  truncated,
                  "```",
                ].join("\n"),
              ),
            );

          const components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[] = [container];

          if (!settings.unsafeAction.deleteMessage) {
            const deleteBtn = new ButtonBuilder()
              .setCustomId(`pm:qrscan:1:delete:${message.id}`)
              .setLabel(String(t(sk.qrDeleteMessage)))
              .setStyle(ButtonStyle.Danger);
            components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(deleteBtn));
          }

          await (channel as any).send({
            components,
            flags: MessageFlags.IsComponentsV2,
          });
        }
      } catch (error) {
        this.container.logger.error(
          "[QRScanner] Failed to send unsafe alert: %s",
          error,
        );
      }
    }

    if (settings.unsafeAction.deleteMessage) {
      try {
        if (message.guild?.members.me?.permissionsIn(message.channelId).has(PermissionFlagsBits.ManageMessages)) {
          const sk = LanguageKeys.Commands.Moderation.SecuritySettings;
          await message.delete();

          try {
            const sendableChannel = message.channel as { send: (options: any) => Promise<any> };
            const notice = await sendableChannel.send({
              content: t(sk.qrAutoDeletedNotice, { user: message.author.toString() }),
              flags: MessageFlags.SuppressNotifications,
            });
            setTimeout(() => { void notice.delete(); }, 8000).unref();
          } catch (error) {
            this.container.logger.error(
              "[QRScanner] Failed to send auto-delete notice: %s",
              error,
            );
          }
        }
      } catch (error) {
        this.container.logger.error(
          "[QRScanner] Failed to delete message with unsafe QR: %s",
          error,
        );
      }
    }
  }

  private async handleSafe(
    data: ParsedQrData,
    message: Message,
    settings: QrScannerSettings,
    t: TFunction,
  ): Promise<void> {
    if (!settings.safeAction.enabled) return;
    if (!settings.safeAction.channelId) return;

    try {
      const channel = message.client.channels.cache.get(settings.safeAction.channelId);
      if (!channel || !("send" in channel)) return;

      const sk = LanguageKeys.Commands.Moderation.SecuritySettings;
      const truncated = data.raw.length > 1000 ? `${data.raw.slice(0, 1000)}…` : data.raw;

      const container = new ContainerBuilder()
        .setAccentColor(Colors.Success)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            [
              `## ✅ ${t(sk.qrSafeAlertTitle)}`,
              "",
              `**${t(sk.qrSafeAlertAuthor)}:** ${message.author}`,
              `**${t(sk.qrSafeAlertChannel)}:** ${message.channel}`,
              `**${t(sk.qrSafeAlertContentType)}:** ${data.contentType}`,
              "",
              "```",
              truncated,
              "```",
            ].join("\n"),
          ),
        );

      await (channel as any).send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (error) {
      this.container.logger.error(
        "[QRScanner] Failed to send safe alert: %s",
        error,
      );
    }
  }
}
