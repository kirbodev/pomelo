import {
  getLocalizedData,
  i18next,
  type TFunction,
} from "@sapphire/plugin-i18next";
import { Locale } from "discord.js";
import type Locales from "./locales.js";
import { LanguageKeys } from "./languageKeys.js";

export function extractVariables(str: string) {
  const matches = Array.from(str.matchAll(/\{\{(.+)\}\}/g)).map(
    (sub) => sub[1]
  );
  if (matches.length === 0) return null;
  return matches;
}

export function getT(locale: string) {
  const supportedLocales = Array.isArray(i18next.options.supportedLngs)
    ? i18next.options.supportedLngs.filter((lang) => lang !== "cimode")
    : [];
  if (supportedLocales.includes(locale)) return i18next.getFixedT(locale);
  return i18next.getFixedT("en-US");
}

export function fetchT(user: string) {
  //STUB implement db logic later
  user;
  return getT("en-US");
}

export function fallbackLanguage(locale: keyof typeof Locales) {
  const supportedLocales = Array.isArray(i18next.options.supportedLngs)
    ? i18next.options.supportedLngs.filter((lang) => lang !== "cimode")
    : [];
  if (supportedLocales.includes(locale)) return locale;
  if (locale === Locale.EnglishGB) return Locale.EnglishUS;
  if (locale === Locale.SpanishLATAM) return Locale.SpanishES;
  return Locale.EnglishUS;
}

export function getBoolean(t: TFunction, value: boolean) {
  return (
    value
      ? t(LanguageKeys.Arguments.BooleanTrueOptions)
      : t(LanguageKeys.Arguments.BooleanFalseOptions)
  ).split(",")[0];
}

export function getOptionLocalizations(
  nameKey: string,
  descriptionKey: string
) {
  const rawNames = getLocalizedData(nameKey).localizations;
  const rawDescriptions = getLocalizedData(descriptionKey).localizations;

  // filter out nullish values
  const names = Object.fromEntries(
    Object.entries(rawNames).filter(([_, v]) => v !== null && v !== undefined)
  );
  const descriptions = Object.fromEntries(
    Object.entries(rawDescriptions).filter(
      ([_, v]) => v !== null && v !== undefined
    )
  );

  const englishName = rawNames["en-US"]!;
  const englishDescription = rawDescriptions["en-US"]!;

  return {
    names,
    descriptions,
    englishName,
    englishDescription,
  };
}
