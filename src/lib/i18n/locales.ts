import { i18next } from "@sapphire/plugin-i18next";
import type { Locale } from "discord.js";

type LocaleMap = {
  [k in Locale]: {
    name: string;
    emoji: string;
    discordName: keyof typeof Locale;
  };
};

const Locales: LocaleMap = {
  id: {
    name: "Bahasa Indonesia",
    emoji: "🇮🇩",
    discordName: "Indonesian",
  },
  "en-US": {
    name: "English (US)",
    emoji: "🇺🇸",
    discordName: "EnglishUS",
  },
  "en-GB": {
    name: "English (UK)",
    emoji: "🇬🇧",
    discordName: "EnglishGB",
  },
  bg: {
    name: "български",
    emoji: "🇧🇬",
    discordName: "Bulgarian",
  },
  "zh-CN": {
    name: "汉语",
    emoji: "🇨🇳",
    discordName: "ChineseCN",
  },
  "zh-TW": {
    name: "中文",
    emoji: "🇹🇼",
    discordName: "ChineseTW",
  },
  hr: {
    name: "Hrvatski",
    emoji: "🇭🇷",
    discordName: "Croatian",
  },
  cs: {
    name: "Čeština",
    emoji: "🇨🇿",
    discordName: "Czech",
  },
  da: {
    name: "Dansk",
    emoji: "🇩🇰",
    discordName: "Danish",
  },
  nl: {
    name: "Nederlands",
    emoji: "🇳🇱",
    discordName: "Dutch",
  },
  fi: {
    name: "Suomi",
    emoji: "🇫🇮",
    discordName: "Finnish",
  },
  fr: {
    name: "Français",
    emoji: "🇫🇷",
    discordName: "French",
  },
  de: {
    name: "Deutsch",
    emoji: "🇩🇪",
    discordName: "German",
  },
  el: {
    name: "Ελληνικά",
    emoji: "🇬🇷",
    discordName: "Greek",
  },
  hi: {
    name: "हिन्दी",
    emoji: "🇮🇳",
    discordName: "Hindi",
  },
  hu: {
    name: "Magyar",
    emoji: "🇭🇺",
    discordName: "Hungarian",
  },
  it: {
    name: "Italiano",
    emoji: "🇮🇹",
    discordName: "Italian",
  },
  ja: {
    name: "日本語",
    emoji: "🇯🇵",
    discordName: "Japanese",
  },
  ko: {
    name: "한국어",
    emoji: "🇰🇷",
    discordName: "Korean",
  },
  lt: {
    name: "Lietuvių",
    emoji: "🇱🇹",
    discordName: "Lithuanian",
  },
  no: {
    name: "Norsk",
    emoji: "🇳🇴",
    discordName: "Norwegian",
  },
  pl: {
    name: "Polski",
    emoji: "🇵🇱",
    discordName: "Polish",
  },
  "pt-BR": {
    name: "Português do Brasil",
    emoji: "🇧🇷",
    discordName: "PortugueseBR",
  },
  ro: {
    name: "Română",
    emoji: "🇷🇴",
    discordName: "Romanian",
  },
  ru: {
    name: "Русский",
    emoji: "🇷🇺",
    discordName: "Russian",
  },
  "es-ES": {
    name: "Español",
    emoji: "🇪🇸",
    discordName: "SpanishES",
  },
  "es-419": {
    name: "Español (Latinoamérica)",
    emoji: "🇲🇽",
    discordName: "SpanishLATAM",
  },
  "sv-SE": {
    name: "Svenska",
    emoji: "🇸🇪",
    discordName: "Swedish",
  },
  th: {
    name: "ไทย",
    emoji: "🇹🇭",
    discordName: "Thai",
  },
  tr: {
    name: "Türkçe",
    emoji: "🇹🇷",
    discordName: "Turkish",
  },
  uk: {
    name: "Українська",
    emoji: "🇺🇦",
    discordName: "Ukrainian",
  },
  vi: {
    name: "Tiếng Việt",
    emoji: "🇻🇳",
    discordName: "Vietnamese",
  },
};

const supportedLangs = Array.isArray(i18next.options.supportedLngs)
  ? // cimode is a special "language" that is used for testing, returns the key as the value
    i18next.options.supportedLngs.filter((lang) => lang !== "cimode")
  : [];
const supportedLocales: Partial<typeof Locales> = {};
for (const key in Locales) {
  if (supportedLangs.includes(key)) {
    // @ts-expect-error supported locales is a subset of all locales
    supportedLocales[key] = Locales[key];
  }
}
export { supportedLocales };

export default Locales;
