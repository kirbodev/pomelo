import { FT, T, type CapitalizedObjectKeys } from "../../types/utils.js";
import utility from "../../../languages/en-US/commands/utility.json" assert { type: "json" };

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
} as CapitalizedObjectKeys<typeof utility>;
