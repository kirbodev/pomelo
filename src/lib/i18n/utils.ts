import { i18next } from "@sapphire/plugin-i18next";

export function extractVariables(str: string) {
  const matches = Array.from(str.matchAll(/\{\{(.+)\}\}/g)).map(
    (sub) => sub[1]
  );
  if (matches.length === 0) return null;
  return matches;
}

export function getT(locale: string) {
  if (i18next.languages.includes(locale)) return i18next.getFixedT(locale);
  return i18next.getFixedT("en");
}

export function fetchT(user: string) {
  //STUB implement db logic later
  user;
  return getT("en");
}
