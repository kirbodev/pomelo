// Convert a unix timestamp to a discord timestamp

import type { TimestampStylesString } from "discord.js";

export function convertToDiscordTimestamp(
  timestamp: number,
  style: TimestampStylesString
) {
  const dTimestamp = Math.floor(timestamp / 1000);
  return `<t:${dTimestamp.toString()}:${style}>`;
}
