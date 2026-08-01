export interface SnipeEntry {
  content: string;
  authorId: string;
  authorUsername: string;
  authorAvatarURL: string | null;
  attachments: { url: string; proxyURL: string; name: string; contentType: string | null }[];
  createdAt: Date;
  deletedAt: Date;
}

const snipeCache = new Map<string, SnipeEntry>();
const snipeTimers = new Map<string, NodeJS.Timeout>();

const SNIPE_TTL = 3_600_000; // 1 hour

export function getSnipe(channelId: string): SnipeEntry | undefined {
  return snipeCache.get(channelId);
}

export function setSnipe(channelId: string, entry: SnipeEntry): void {
  // Truncate content to 4096 chars (Discord embed description limit)
  if (entry.content.length > 4096) {
    entry.content = entry.content.slice(0, 4096);
  }

  // Clear existing timer for this channel if present
  const existingTimer = snipeTimers.get(channelId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  snipeCache.set(channelId, entry);

  const timer = setTimeout(() => {
    snipeCache.delete(channelId);
    snipeTimers.delete(channelId);
  }, SNIPE_TTL);
  timer.unref();

  snipeTimers.set(channelId, timer);
}

export function clearSnipe(channelId: string): void {
  const existingTimer = snipeTimers.get(channelId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    snipeTimers.delete(channelId);
  }
  snipeCache.delete(channelId);
}
