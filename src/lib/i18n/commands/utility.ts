import { FT, T, type CapitalizedObjectKeys } from "../../types/utils.js";
import utility from "../../../languages/en-US/commands/utility.json" with { type: "json" };

export default {
  Ping: {
    desc: FT<{ latency: string }>("commands/utility:ping.desc"),
    title: T("commands/utility:ping.title"),
    APILatencyFieldTitle: T("commands/utility:ping.APILatencyFieldTitle"),
    commandDescription: T("commands/utility:ping.commandDescription"),
    uptimeFieldTitle: T("commands/utility:ping.uptimeFieldTitle"),
    commandName: T("commands/utility:ping.commandName"),
  },
  CloneEmoji: {
    desc: FT<{ emoji: string }>("commands/utility:cloneEmoji.desc"),
    title: T("commands/utility:cloneEmoji.title"),
    commandName: T("commands/utility:cloneEmoji.commandName"),
    commandDescription: T("commands/utility:cloneEmoji.commandDescription"),
  },
  Help: {
    commandName: T("commands/utility:help.commandName"),
    commandDescription: T("commands/utility:help.commandDescription"),
  },
  BigEmoji: {
    commandName: T("commands/utility:bigEmoji.commandName"),
    commandDescription: T("commands/utility:bigEmoji.commandDescription"),
  },
  Settings: {
    commandName: T("commands/utility:settings.commandName"),
    commandDescription: T("commands/utility:settings.commandDescription"),
    subcommandGuildDescription: T(
      "commands/utility:settings.subcommandGuildDescription"
    ),
    subcommandGuildName: T("commands/utility:settings.subcommandGuildName"),
    subcommandUserDescription: T(
      "commands/utility:settings.subcommandUserDescription"
    ),
    subcommandUserName: T("commands/utility:settings.subcommandUserName"),
  },
  Afk: {
    commandName: T("commands/utility:afk.commandName"),
    commandDescription: T("commands/utility:afk.commandDescription"),
    messageFieldName: T("commands/utility:afk.messageFieldName"),
    messageFieldDescription: T("commands/utility:afk.messageFieldDescription"),
    durationFieldName: T("commands/utility:afk.durationFieldName"),
    durationFieldDescription: T(
      "commands/utility:afk.durationFieldDescription"
    ),
    attachmentFieldName: T("commands/utility:afk.attachmentFieldName"),
    attachmentFieldDescription: T(
      "commands/utility:afk.attachmentFieldDescription"
    ),
    title: T("commands/utility:afk.title"),
    desc: T("commands/utility:afk.desc"),
    desc_with_message: T("commands/utility:afk.desc_with_message"),
    desc_with_duration: T("commands/utility:afk.desc_with_duration"),
    desc_with_message_and_duration: T(
      "commands/utility:afk.desc_with_message_and_duration"
    ),
    overwriteNote: T("commands/utility:afk.overwriteNote"),
    activeDescription: FT<{
      user: string;
    }>("commands/utility:afk.activeDescription"),
    activeDescription_multiple: FT<{
      users: string;
      last_user: string;
    }>("commands/utility:afk.activeDescription_multiple"),
    activeTitle: T("commands/utility:afk.activeTitle"),
    activeReason: T("commands/utility:afk.activeReason"),
    activeUntil: T("commands/utility:afk.activeUntil"),
    removeTitle: T("commands/utility:afk.removeTitle"),
    removeDescription: T("commands/utility:afk.removeDescription"),
    removeTip: T("commands/utility:afk.removeTip"),
    blockedAfk: T("commands/utility:afk.blockedAfk")
  },
  Afklink: {
    commandName: T("commands/utility:afklink.commandName"),
    commandDescription: T("commands/utility:afklink.commandDescription"),
    title: T("commands/utility:afklink.title"),
    desc: T("commands/utility:afklink.desc"),
    button: T("commands/utility:afklink.button"),
    successTitle: T("commands/utility:afklink.successTitle"),
    successDesc: T("commands/utility:afklink.successDesc"),
    calendarsFieldTitle: T("commands/utility:afklink.calendarsFieldTitle"),
    linkId: T("commands/utility:afklink.linkId"),
    selectCalendars: T("commands/utility:afklink.selectCalendars"),
    selectCalendarsDescription: T("commands/utility:afklink.selectCalendarsDescription"),
  },
  Afkget: {
    commandName: T("commands/utility:afkget.commandName"),
    commandDescription: T("commands/utility:afkget.commandDescription"),
    contextName: T("commands/utility:afkget.contextName"),
    userFieldName: T("commands/utility:afkget.userFieldName"),
    userFieldDescription: T("commands/utility:afkget.userFieldDescription"),
  },
} as CapitalizedObjectKeys<typeof utility>;
