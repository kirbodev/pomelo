import { container } from "@sapphire/framework";
import { fetchT } from "@sapphire/plugin-i18next";
import { MessageFlags, type RepliableInteraction } from "discord.js";
import type { z } from "zod";
import { Colors } from "../colors.js";
import { LanguageKeys } from "../i18n/languageKeys.js";
import EmbedUtils from "../../utilities/embedUtils.js";

/**
 * Redis-backed session storage for persistent message components.
 *
 * Components routed through Sapphire interaction handlers can't keep state in
 * memory (the process may restart between the message being sent and the user
 * clicking), so the state lives in Redis under a TTL and the custom ID only
 * carries an opaque routing key: `pm:<feature>:1:<...parts>`.
 */

const opaquePart = /^[A-Za-z0-9_-]{1,90}$/;

const sessionKey = (feature: string, id: string) =>
  `component-session:${feature}:${id}`;

export function createComponentId(
  feature: string,
  ...parts: string[]
): string {
  return ["pm", feature, "1", ...parts].join(":");
}

/**
 * Parses a `pm:<feature>:1:<...parts>` custom ID and returns the trailing
 * parts, or null when the value doesn't belong to the feature or is malformed.
 */
export function parseComponentId(
  feature: string,
  value: string,
): string[] | null {
  const parts = value.split(":");
  if (
    parts.length < 4 ||
    parts[0] !== "pm" ||
    parts[1] !== feature ||
    parts[2] !== "1"
  )
    return null;
  const rest = parts.slice(3);
  if (rest.some((part) => !opaquePart.test(part))) return null;
  return rest;
}

export async function saveComponentSession(
  feature: string,
  id: string,
  data: unknown,
  ttlSeconds: number,
): Promise<void> {
  await container.redis.set(
    sessionKey(feature, id),
    JSON.stringify(data),
    "EX",
    ttlSeconds,
  );
}

export async function getComponentSession<T>(
  feature: string,
  id: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const raw = await container.redis.get(sessionKey(feature, id));
  if (!raw) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    await container.redis.del(sessionKey(feature, id));
    return null;
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    await container.redis.del(sessionKey(feature, id));
    return null;
  }
  return parsed.data;
}

/**
 * Atomically reads and deletes a session so single-use controls (e.g.
 * confirmations) can't be replayed, even across concurrent clicks.
 */
export async function claimComponentSession<T>(
  feature: string,
  id: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const raw = (await container.redis.eval(
    `
      local value = redis.call("GET", KEYS[1])
      if value then redis.call("DEL", KEYS[1]) end
      return value
    `,
    1,
    sessionKey(feature, id),
  )) as string | null;
  if (!raw) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

export async function deleteComponentSession(
  feature: string,
  id: string,
): Promise<void> {
  await container.redis.del(sessionKey(feature, id));
}

/** Localized "these controls expired" ephemeral reply for stale components. */
export async function replyInteractionExpired(
  interaction: RepliableInteraction,
): Promise<void> {
  const t = await fetchT(interaction);
  await interaction
    .reply({
      embeds: [
        new EmbedUtils.EmbedConstructor()
          .setTitle(t(LanguageKeys.Errors.InteractionExpired.title))
          .setDescription(t(LanguageKeys.Errors.InteractionExpired.desc))
          .setColor(Colors.Error),
      ],
      flags: MessageFlags.Ephemeral,
    })
    .catch(() => null);
}

/** Localized "that's not for you" ephemeral reply for wrong-user clicks. */
export async function replyWrongTarget(
  interaction: RepliableInteraction,
): Promise<void> {
  const t = await fetchT(interaction);
  await interaction
    .reply({
      embeds: [
        new EmbedUtils.EmbedConstructor()
          .setTitle(t(LanguageKeys.Errors.WrongTarget.title))
          .setDescription(t(LanguageKeys.Errors.WrongTarget.desc))
          .setColor(Colors.Error),
      ],
      flags: MessageFlags.Ephemeral,
    })
    .catch(() => null);
}
