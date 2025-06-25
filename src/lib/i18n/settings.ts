import { FT, T, type CapitalizedObjectKeys } from "../types/utils.js";
import settings from "../../languages/en-US/settings.json" assert { type: "json" };

export default {
  Default: {
    name: T("settings:default.name"),
    description: FT<{ default: string }>("settings:default.description"),
  },
  Current: T("settings:current"),
  Change: T("settings:change"),
  Override: {
    name: T("settings:override.name"),
    description: T("settings:override.description"),
  },
  User: {
    locale: {
      name: T("settings:user.locale.name"),
      description: T("settings:user.locale.description"),
    },
    preferEphemeral: {
      name: T("settings:user.preferEphemeral.name"),
      description: T("settings:user.preferEphemeral.description"),
    },
  },
  Guild: {
    locale: {
      name: T("settings:guild.locale.name"),
      description: T("settings:guild.locale.description"),
    },
    forceLocale: {
      name: T("settings:guild.forceLocale.name"),
      description: T("settings:guild.forceLocale.description"),
    },
    prefix: {
      name: T("settings:guild.prefix.name"),
      description: T("settings:guild.prefix.description"),
    },
    features: {
      name: T("settings:guild.features.name"),
      description: T("settings:guild.features.description"),
    },
    logChannel: {
      name: T("settings:guild.logChannel.name"),
      description: T("settings:guild.logChannel.description"),
    },
    forceEphemeral: {
      name: T("settings:guild.forceEphemeral.name"),
      description: T("settings:guild.forceEphemeral.description"),
    },
    ephemeralDeletionTimeout: {
      name: T("settings:guild.ephemeralDeletionTimeout.name"),
      description: T("settings:guild.ephemeralDeletionTimeout.description"),
    },
  },
} as CapitalizedObjectKeys<typeof settings>;
