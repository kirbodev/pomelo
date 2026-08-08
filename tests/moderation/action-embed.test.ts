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

const fakeT = ((key: string) => key) as unknown as TFunction;

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
    "commands/moderation:warn.punishmentMuteFor",
  );
  expect(punishmentLabel({ type: "kick" }, fakeT)).toBe(
    "commands/moderation:warnSettings.quickstart.punishmentKick",
  );
  expect(punishmentLabel({ type: "ban", duration: 604_800_000 }, fakeT)).toBe(
    "commands/moderation:warn.punishmentBanFor",
  );
  expect(punishmentLabel({ type: "ban" }, fakeT)).toBe(
    "commands/moderation:warnSettings.quickstart.punishmentBanPerm",
  );
  expect(punishmentLabel({ type: "role", roleId: "1" }, fakeT)).toBe(
    "commands/moderation:warnSettings.quickstart.punishmentRole",
  );
});

test("warnHistoryFieldValue renders counts plus one line per recent warn", () => {
  const history: WarnHistory = {
    active: 2,
    expired: 1,
    total: 3,
    recent: [
      { id: 12, reason: "spam", expiresAt: 1_700_000_100_000 },
      { id: 8, reason: null, expiresAt: null },
    ],
  };
  const lines = warnHistoryFieldValue(history, fakeT).split("\n");
  expect(lines[0]).toBe(LanguageKeys.Commands.Moderation.Warn.historyCounts);
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain(
    LanguageKeys.Commands.Moderation.Warn.historyEntry,
  );
  expect(lines[2]).toContain(
    LanguageKeys.Commands.Moderation.Warn.historyEntryNoExpiry,
  );
  expect(lines[2]).toContain(LanguageKeys.Commands.Moderation.Fields.noReason);
});
