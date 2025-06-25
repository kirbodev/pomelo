import { FT, T, type CapitalizedObjectKeys } from "../types/utils.js";
import errors from "../../languages/en-US/errors.json" with { type: "json" };

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
  InvalidBoolean: {
    desc: T("errors:invalidBoolean.desc"),
    title: T("errors:invalidBoolean.title"),
    desc_detailed: T("errors:invalidBoolean.desc_detailed"),
  },
  InvalidNumber: {
    desc: T("errors:invalidNumber.desc"),
    title: T("errors:invalidNumber.title"),
    desc_detailed: T("errors:invalidNumber.desc_detailed"),
  },
  InvalidString: {
    desc: T("errors:invalidString.desc"),
    title: T("errors:invalidString.title"),
    desc_detailed: T("errors:invalidString.desc_detailed"),
  },
  InvalidOption: {
    desc: T("errors:invalidOption.desc"),
    title: T("errors:invalidOption.title"),
    desc_detailed: FT<{ option: string }>("errors:invalidOption.desc_detailed"),
  },
  InvalidChannel: {
    desc: T("errors:invalidChannel.desc"),
    title: T("errors:invalidChannel.title"),
    desc_detailed: FT<{ length: number }>(
      "errors:invalidChannel.desc_detailed"
    ),
  },
  InvalidRole: {
    desc: T("errors:invalidRole.desc"),
    title: T("errors:invalidRole.title"),
    desc_detailed: FT<{ length: number }>("errors:invalidRole.desc_detailed"),
  },
  InvalidMention: {
    desc: T("errors:invalidMention.desc"),
    title: T("errors:invalidMention.title"),
    desc_detailed: FT<{ length: number }>(
      "errors:invalidMention.desc_detailed"
    ),
  },
  InvalidDuration: {
    desc: T("errors:invalidDuration.desc"),
    title: T("errors:invalidDuration.title"),
    desc_detailed: T("errors:invalidDuration.desc_detailed"),
  },
  StringTooLong: {
    desc: T("errors:stringTooLong.desc"),
    title: T("errors:stringTooLong.title"),
    desc_detailed: FT<{ length: number }>("errors:stringTooLong.desc_detailed"),
  },
  StringTooShort: {
    desc: T("errors:stringTooShort.desc"),
    title: T("errors:stringTooShort.title"),
    desc_detailed: FT<{ length: number }>(
      "errors:stringTooShort.desc_detailed"
    ),
  },
  DurationTooLong: {
    desc: T("errors:durationTooLong.desc"),
    title: T("errors:durationTooLong.title"),
    desc_detailed: FT<{ length: number }>(
      "errors:durationTooLong.desc_detailed"
    ),
  },
  DurationTooShort: {
    desc: T("errors:durationTooShort.desc"),
    title: T("errors:durationTooShort.title"),
    desc_detailed: FT<{ length: number }>(
      "errors:durationTooShort.desc_detailed"
    ),
  },
  NumberTooLarge: {
    desc: T("errors:numberTooLarge.desc"),
    title: T("errors:numberTooLarge.title"),
    desc_detailed: FT<{ length: number }>(
      "errors:numberTooLarge.desc_detailed"
    ),
  },
  NumberTooSmall: {
    desc: T("errors:numberTooSmall.desc"),
    title: T("errors:numberTooSmall.title"),
    desc_detailed: FT<{ length: number }>(
      "errors:numberTooSmall.desc_detailed"
    ),
  },
  InvalidType: {
    desc: T("errors:invalidType.desc"),
    title: T("errors:invalidType.title"),
    desc_detailed: T("errors:invalidType.desc_detailed"),
  },
  InvalidAttachment: {
    desc: T("errors:invalidAttachment.desc"),
    title: T("errors:invalidAttachment.title"),
    desc_detailed: T("errors:invalidAttachment.desc_detailed"),
  },
  FileTooLarge: {
    desc: T("errors:fileTooLarge.desc"),
    title: T("errors:fileTooLarge.title"),
    desc_detailed: T("errors:fileTooLarge.desc_detailed"),
  },
  NoEmail: {
    desc: T("errors:noEmail.desc"),
    title: T("errors:noEmail.title"),
    desc_detailed: T("errors:noEmail.desc_detailed"),
  },
  AuthError: {
    desc: T("errors:authError.desc"),
    title: T("errors:authError.title"),
    desc_detailed: T("errors:authError.desc_detailed"),
  },
  NoneFound: {
    desc: T("errors:noneFound.desc"),
    title: T("errors:noneFound.title"),
    desc_detailed: T("errors:noneFound.desc_detailed"),
  },
  MissingScopes: {
    desc: T("errors:missingScopes.desc"),
    title: T("errors:missingScopes.title"),
    desc_detailed: T("errors:missingScopes.desc_detailed"),
  },
} as CapitalizedObjectKeys<typeof errors>;
