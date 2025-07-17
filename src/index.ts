#!/usr/bin/env bun
import "dotenv/config";
import "@sapphire/plugin-logger/register";
import "@sapphire/plugin-i18next/register";
import "@sapphire/plugin-utilities-store/register";
import "@sapphire/plugin-scheduled-tasks/register";
import * as Sentry from "@sentry/bun";
import { container, LogLevel, SapphireClient } from "@sapphire/framework";
import { GatewayIntentBits, Locale, Message, Partials } from "discord.js";
import { config } from "./config.js";
import { PostHog } from "posthog-node";
import packageJson from "../package.json" with { type: "json" };
import { db } from "./db/index.js";
import redis from "./db/redis/index.js";
import { i18next } from "@sapphire/plugin-i18next";
import { fallbackLanguage } from "./lib/i18n/utils.js";

// Init sentry

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  // debug: !!process.env.DEV,
  enabled: !process.env.DEV,
  environment: process.env.DEV ? "development" : "production",
  integrations: [
    Sentry.captureConsoleIntegration({
      levels: ["error"],
    }),
    Sentry.consoleIntegration(),
    Sentry.contextLinesIntegration(),
    Sentry.dedupeIntegration(),
    Sentry.extraErrorDataIntegration(),
    Sentry.functionToStringIntegration(),
    Sentry.modulesIntegration(),
    Sentry.onUncaughtExceptionIntegration(),
    Sentry.onUnhandledRejectionIntegration(),
    Sentry.requestDataIntegration(),
  ],
});

// Modify container

container.version = packageJson.version;

container.analytics = new PostHog(process.env.POSTHOG_KEY, {
  host: "https://eu.i.posthog.com",
  disabled: !!process.env.DEV,
});

container.db = db;

container.redis = redis;

declare module "@sapphire/framework" {
  interface Container {
    version: string;
    analytics: PostHog;
    db: typeof db;
    redis: typeof redis;
  }
}

declare module "@sapphire/framework" {
  export interface DetailedDescriptionCommandObject {
    syntax: string;
    examples: string[];
  }
}

// Start client
const defaultPrefix = ",";
const client = new SapphireClient({
  intents: [
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessagePolls,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.DirectMessagePolls,
    GatewayIntentBits.AutoModerationExecution,
    GatewayIntentBits.AutoModerationConfiguration,
  ],
  partials: [Partials.Channel],
  loadMessageCommandListeners: true,
  caseInsensitiveCommands: true,
  defaultPrefix: defaultPrefix,
  defaultCooldown: {
    delay: 1000,
    filteredUsers: config.owners,
    limit: 2,
  },
  i18n: {
    fetchLanguage: async (context) => {
      // Locale is determined by the following order:
      // 1. Forced locale in guild settings
      // 2. Locale in user settings
      // 3. Interaction locale
      // 4. Guild locale
      // 5. Default locale (en-US)

      const userSettings =
        context.user &&
        (await container.redis.jsonGet(context.user.id, "UserSettings"));
      const guildSettings =
        context.guild &&
        (await container.redis.jsonGet(context.guild.id, "GuildSettings"));

      if (guildSettings?.locale && guildSettings.forceLocale)
        return fallbackLanguage(guildSettings.locale);
      if (userSettings?.locale) return fallbackLanguage(userSettings.locale);

      const { interactionLocale, interactionGuildLocale } = context;
      const locale = interactionLocale ?? interactionGuildLocale;
      // Recalculate instead of using supportedLocales because the import will make it undefined
      const supportedLocales = Array.isArray(i18next.options.supportedLngs)
        ? i18next.options.supportedLngs.filter((lang: string) => lang !== "cimode")
        : [];
      if (locale && locale in supportedLocales) return locale;

      if (guildSettings?.locale && guildSettings.locale in supportedLocales)
        return guildSettings.locale;

      // Fallback to English, just uses function in case of language like spanishLATAM
      return locale ? fallbackLanguage(locale) : Locale.EnglishUS;
    },
    i18next: (_: string[], languages: string[]) => {
      return {
        supportedLngs: languages,
        preload: languages,
        returnObjects: true,
        returnEmptyString: false,
        load: "all",
        fallbackLng: {
          "es-419": ["es-ES"],
          uk: ["ru"],
          default: ["en-US"],
        },
      };
    },
  },
  logger: {
    level: process.env.DEV ? LogLevel.Debug : LogLevel.Info,
  },
  tasks: {
    bull: {
      connection: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT),
        password: process.env.REDIS_PASSWORD,
      },
    },
  },
  fetchPrefix: async (msg: Message) => {
    if (!msg.guildId) return defaultPrefix;
    const guildSettings = await container.redis.jsonGet(
      msg.guildId,
      "GuildSettings"
    );
    return guildSettings?.prefix ?? defaultPrefix;
  },
});

await client.login(process.env.DISCORD_TOKEN).catch(async (error: unknown) => {
  console.error(error);
  await client.destroy();
  process.exit(1);
});

// Error logging

process.on("unhandledRejection", (error) => {
  console.error(error);
});

process.on("uncaughtException", (error) => {
  console.error(error);
});

client.on("error", (error) => {
  console.error(error);
});