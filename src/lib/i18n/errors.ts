import { FT, T, type CapitalizedObjectKeys } from "../types/utils.js";
import errors from "../../languages/en-US/errors.json" assert { type: "json" };

export default {
  Blocked: {
    desc: T("errors:blocked.desc"),
    title: T("errors:blocked.title"),
    desc_detailed: T("errors:blocked.desc_detailed"),
  },
  BotMissingPermission: {
    desc: T("errors:botMissingPermission.desc"),
    title: T("errors:botMissingPermission.title"),
    desc_detailed: FT<{ permission: string }>(
      "errors:botMissingPermission.desc_detailed"
    ),
  },
  DevOnly: {
    desc: T("errors:devOnly.desc"),
    title: T("errors:devOnly.title"),
    desc_detailed: T("errors:devOnly.desc_detailed"),
  },
  GenericError: {
    desc: T("errors:genericError.desc"),
    title: T("errors:genericError.title"),
    desc_detailed: T("errors:genericError.desc_detailed"),
    field1: {
      title: T("errors:genericError.field1.title"),
    },
  },
  GuildCooldown: {
    desc: T("errors:guildCooldown.desc"),
    title: T("errors:guildCooldown.title"),
    desc_detailed: FT<{ time: string }>("errors:guildCooldown.desc_detailed"),
  },
  InvalidLocation: {
    desc: T("errors:invalidLocation.desc"),
    title: T("errors:invalidLocation.title"),
    desc_detailed: FT<{ location: string }>(
      "errors:invalidLocation.desc_detailed"
    ),
  },
  MissingPermission: {
    desc: T("errors:missingPermission.desc"),
    title: T("errors:missingPermission.title"),
    desc_detailed: FT<{ permission: string }>(
      "errors:missingPermission.desc_detailed"
    ),
  },
  NotFound: {
    desc: T("errors:notFound.desc"),
    title: T("errors:notFound.title"),
    desc_detailed: FT<{ resource: string }>("errors:notFound.desc_detailed"),
  },
  ServerError: {
    desc: T("errors:serverError.desc"),
    title: T("errors:serverError.title"),
    desc_detailed: T("errors:serverError.desc_detailed"),
    field1: {
      title: T("errors:serverError.field1.title"),
    },
  },
  UserAuthority: {
    desc: T("errors:userAuthority.desc"),
    title: T("errors:userAuthority.title"),
    desc_detailed: FT<{ user: string }>("errors:userAuthority.desc_detailed"),
  },
  UserCooldown: {
    desc: T("errors:userCooldown.desc"),
    title: T("errors:userCooldown.title"),
    desc_detailed: FT<{ time: string }>("errors:userCooldown.desc_detailed"),
  },
  UserError: {
    desc: T("errors:userError.desc"),
    title: T("errors:userError.title"),
    desc_detailed: T("errors:userError.desc_detailed"),
    field1: {
      title: T("errors:userError.field1.title"),
    },
  },
  SyntaxError: {
    desc: T("errors:syntaxError.desc"),
    title: T("errors:syntaxError.title"),
    desc_detailed: T("errors:syntaxError.desc_detailed"),
    exampleFieldTitle: T("errors:syntaxError.exampleFieldTitle"),
    syntaxFieldTitle: T("errors:syntaxError.syntaxFieldTitle"),
  },
  MaintenanceMode: {
    desc: T("errors:maintainanceMode.desc"),
    title: T("errors:maintainanceMode.title"),
    desc_detailed: FT<{ reason: string }>(
      "errors:maintainanceMode.desc_detailed"
    ),
  },
  WrongTarget: {
    desc: T("errors:wrongTarget.desc"),
    title: T("errors:wrongTarget.title"),
    desc_detailed: FT<{ target: string }>("errors:wrongTarget.desc_detailed"),
  },
} as CapitalizedObjectKeys<typeof errors>;
