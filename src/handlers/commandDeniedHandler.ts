import {
  type ChatInputCommandDeniedPayload,
  type ChatInputCommandErrorPayload,
  type ContextMenuCommandDeniedPayload,
  type ContextMenuCommandErrorPayload,
  CorePreconditions,
  type MessageCommandDeniedPayload,
  type MessageCommandErrorPayload,
  Precondition,
  UserError,
  container,
} from "@sapphire/framework";
import { fetchT, type TFunction } from "@sapphire/plugin-i18next";
import EmbedUtils from "../utilities/embedUtils.js";
import { LanguageKeys, LanguageKeyValues } from "../lib/i18n/languageKeys.js";
import ms from "../lib/helpers/ms.js";
import { extractVariables } from "../lib/i18n/utils.js";
import { Message, MessageFlags, PermissionsBitField } from "discord.js";
import { Colors } from "../lib/colors.js";
import { trimTextSection } from "../lib/helpers/stringUtils.js";
import { EmbedLimits } from "@sapphire/discord-utilities";

type ErroredPayloads =
  | ChatInputCommandDeniedPayload
  | MessageCommandDeniedPayload
  | ContextMenuCommandDeniedPayload
  | MessageCommandErrorPayload
  | ChatInputCommandErrorPayload
  | ContextMenuCommandErrorPayload;

export default async function handler(
  error: UserError,
  payload: ErroredPayloads
) {
  const interaction =
    "message" in payload ? payload.message : payload.interaction;
  const t = await fetchT(interaction);
  const message = error.identifier;
  const internal = convertInternalToKnownError(error);
  const embed = new EmbedUtils.EmbedConstructor().setColor(Colors.Error);
  if (
    internal ||
    Object.keys(LanguageKeyValues.Errors).find((e) => e === message)
  ) {
    const err =
      internal ??
      LanguageKeys.Errors[message as keyof typeof LanguageKeyValues.Errors];
    const title = t(err.title);
    const description = fillVariables(payload, error, err, t);
    embed.setTitle(title).setDescription(description);
  } else {
    container.logger.warn(
      `Error not found in errors enum: ${error.identifier}`
    );
    embed.setTitle(t(LanguageKeys.Errors.GenericError.title));
    embed.setDescription(t(LanguageKeys.Errors.GenericError.desc));
    const msg = error.identifier || error.message || error.name || "???";
    embed.addField(
      t(LanguageKeys.Errors.GenericError.field1.title),
      `\`${trimTextSection(
        msg,
        0,
        msg.length,
        EmbedLimits.MaximumFieldValueLength - 12
      )}\``
    );
  }

  const options = {
    embeds: [embed],
  };

  if (interaction instanceof Message) {
    void interaction.reply(options);
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
  }

  void interaction.followUp({
    ...options,
    ...{
      flags: MessageFlags.Ephemeral,
    },
  });
}

function fillVariables(
  payload: ErroredPayloads,
  error: UserError,
  knownError: (typeof LanguageKeys.Errors)[keyof typeof LanguageKeys.Errors],
  t: TFunction
) {
  // fill in the variables based on the error and info from the command
  if (
    knownError === LanguageKeys.Errors.UserCooldown ||
    knownError === LanguageKeys.Errors.GuildCooldown
  ) {
    const remaining = ms(
      Math.ceil(Reflect.get(error.context as object, "remaining") as number)
    );
    return t(knownError.desc_detailed, { time: remaining });
  }
  const providedPermission = Reflect.get(
    error.context as object,
    "permission"
  ) as string;
  if (
    knownError === LanguageKeys.Errors.MissingPermission ||
    knownError === LanguageKeys.Errors.BotMissingPermission
  ) {
    if (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      (!payload.command?.options?.requiredUserPermissions ||
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        !payload.command?.options?.requiredClientPermissions) &&
      !providedPermission
    )
      return t(knownError.desc);
    const missing = providedPermission
      ? [providedPermission]
      : container.utilities.commandUtils.getPermissionNames(
          new PermissionsBitField(
            knownError === LanguageKeys.Errors.MissingPermission
              ? payload.command.options.requiredUserPermissions
              : payload.command.options.requiredClientPermissions
          )
        );
    if (!missing.length) return t(knownError.desc);
    return t(knownError.desc_detailed, {
      permission: missing.map((p) => `\`${p}\``).join(", "),
    });
  }
  // try to find the variables in the error context
  const variables = extractVariables(knownError.desc_detailed);
  if (!variables) return t(knownError.desc);
  const info: Record<string, string> = {};
  for (const variable of variables) {
    const varInfo = Reflect.get(error.context as object, variable) as
      | string
      | undefined;
    if (varInfo) info[variable] = varInfo;
  }
  if (info[0]) return t(knownError.desc_detailed, info);
  return t(knownError.desc);
}

function convertInternalToKnownError(
  error: UserError
): (typeof LanguageKeys.Errors)[keyof typeof LanguageKeys.Errors] | null {
  const pre = Reflect.get(error, "precondition") as Precondition | undefined;
  if (!pre) return null;
  if (pre.name in CorePreconditions) {
    const preName = pre.name as keyof typeof CorePreconditions;
    if (preName === "ClientPermissions")
      return LanguageKeys.Errors.BotMissingPermission;
    if (preName === "UserPermissions")
      return LanguageKeys.Errors.MissingPermission;
    if (preName === "Cooldown") return LanguageKeys.Errors.UserCooldown;
    if (
      preName === "GuildNewsOnly" ||
      preName === "GuildTextOnly" ||
      preName === "GuildNewsThreadOnly" ||
      preName === "GuildPrivateThreadOnly" ||
      preName === "GuildPublicThreadOnly" ||
      preName === "GuildThreadOnly" ||
      preName === "GuildVoiceOnly" ||
      preName === "GuildOnly" ||
      preName === "DMOnly" ||
      preName === "NSFW"
    )
      return LanguageKeys.Errors.InvalidLocation;
  }
  return null;
}
