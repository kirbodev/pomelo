import { expect, test } from "bun:test";
import type { TFunction } from "@sapphire/plugin-i18next";
import { LanguageKeys } from "../../src/lib/i18n/languageKeys.js";
import { userMention } from "../../src/lib/helpers/stringUtils.js";
import {
  punishmentLabel,
  warnCountDescKey,
  warnHistoryFieldValue,
} from "../../src/lib/moderation/actionEmbed.js";
import type { WarnHistory } from "../../src/lib/moderation/types.js";
import moderation from "../../src/languages/en-US/commands/moderation.json" with { type: "json" };

const fakeT = ((key: string, options?: Record<string, unknown>) => {
  const path = key.replace("commands/moderation:", "").split(".");
  let value: unknown = moderation;
  for (const part of path) {
    if (value && typeof value === "object" && part in value)
      value = (value as Record<string, unknown>)[part];
    else return key;
  }
  if (typeof value !== "string") return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(options?.[name] ?? ""),
  );
}) as unknown as TFunction;

test("userMention returns a mention with the username in parentheses", () => {
  expect(userMention({ id: "695228246966534255", username: "kdv_" })).toBe(
    "<@695228246966534255> (kdv_)",
  );
});

test("warnCountDescKey maps 1/2/3 to once/twice/thrice and 4+ to times", () => {
  expect(warnCountDescKey(1)).toBe(LanguageKeys.Commands.Moderation.Warn.desc);
  expect(warnCountDescKey(2)).toBe(
    LanguageKeys.Commands.Moderation.Warn.descTwice,
  );
  expect(warnCountDescKey(3)).toBe(
    LanguageKeys.Commands.Moderation.Warn.descThrice,
  );
  expect(warnCountDescKey(4)).toBe(
    LanguageKeys.Commands.Moderation.Warn.descTimes,
  );
  expect(warnCountDescKey(10)).toBe(
    LanguageKeys.Commands.Moderation.Warn.descTimes,
  );
});

test("punishmentLabel resolves the right key per punishment type", () => {
  expect(punishmentLabel({ type: "mute", duration: 3_600_000 }, fakeT)).toBe(
    "Mute for 1h",
  );
  expect(punishmentLabel({ type: "kick" }, fakeT)).toBe("Kick");
  expect(punishmentLabel({ type: "ban", duration: 604_800_000 }, fakeT)).toBe(
    "Ban for 7d",
  );
  expect(punishmentLabel({ type: "ban" }, fakeT)).toBe("Permanent ban");
  expect(punishmentLabel({ type: "role", roleId: "1" }, fakeT)).toBe("Role");
});

test("warnHistoryFieldValue renders counts plus one line per recent warn", () => {
  const history: WarnHistory = {
    active: 2,
    expired: 1,
    total: 3,
    recent: [
      { id: 12, reason: "spam", expiresAt: 1_700_000_100_000 },
      { id: 8, reason: null, expiresAt: null },
      { id: 5, reason: "spam again", expiresAt: null },
      { id: 3, reason: "oldest", expiresAt: null },
    ],
  };
  const lines = warnHistoryFieldValue(history, fakeT).split("\n");
  expect(lines[0]).toBe("**2** active · **1** expired · **3** total");
  expect(lines).toHaveLength(4);
  expect(lines[1]).toContain("#12 — spam (expires <t:1700000100:R>)");
  expect(lines[2]).toContain("#8 — No reason");
  expect(lines[3]).toContain("#5 — spam again");
  expect(lines.join("\n")).not.toContain("#3");
});
