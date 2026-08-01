// Tests for the Redis backup helpers
import { test, expect } from "bun:test";
import {
  decodeDirtyMember,
  encodeDirtyMember,
  hashValue,
  isBackupTopic,
  TOMBSTONE_HASH,
} from "../../src/lib/helpers/backup.js";

test("hashValue is independent of object key order", () => {
  const a = { locale: "en-US", preferEphemeral: true, allowUrgentPings: false };
  const b = { allowUrgentPings: false, preferEphemeral: true, locale: "en-US" };
  expect(hashValue(a)).toBe(hashValue(b));
});

test("hashValue sorts keys recursively in nested objects", () => {
  const a = { d: { e: "x", f: 1, g: ["y"] }, a: "test" };
  const b = { a: "test", d: { g: ["y"], f: 1, e: "x" } };
  expect(hashValue(a)).toBe(hashValue(b));
});

test("hashValue preserves array order", () => {
  expect(hashValue({ c: ["a", "b"] })).not.toBe(hashValue({ c: ["b", "a"] }));
});

test("hashValue changes when a value changes", () => {
  expect(hashValue({ prefix: "," })).not.toBe(hashValue({ prefix: "!" }));
});

test("hashValue treats a Date and its JSON round-trip as equal", () => {
  const date = new Date("2026-07-27T12:00:00.000Z");
  const original = { startedAt: date, endsAt: null };
  const roundTripped = JSON.parse(JSON.stringify(original)) as unknown;
  expect(hashValue(original)).toBe(hashValue(roundTripped));
});

test("TOMBSTONE_HASH matches hashing null", () => {
  expect(TOMBSTONE_HASH).toBe(hashValue(null));
});

test("dirty member round-trips topic and key", () => {
  const member = encodeDirtyMember("UserSettings", "695228246966534255");
  expect(decodeDirtyMember(member)).toEqual({
    topic: "UserSettings",
    key: "695228246966534255",
  });
});

test("dirty member decoding splits on the first separator only", () => {
  const member = encodeDirtyMember("Afk", "user:with:colons");
  expect(decodeDirtyMember(member)).toEqual({
    topic: "Afk",
    key: "user:with:colons",
  });
});

test("decodeDirtyMember rejects unknown topics and malformed members", () => {
  expect(decodeDirtyMember("Test:123")).toBeNull();
  expect(decodeDirtyMember("no-separator")).toBeNull();
  expect(decodeDirtyMember("UserSettings:")).toBeNull();
});

test("isBackupTopic only allows the backup allowlist", () => {
  expect(isBackupTopic("UserSettings")).toBe(true);
  expect(isBackupTopic("GuildSettings")).toBe(true);
  expect(isBackupTopic("Afk")).toBe(true);
  expect(isBackupTopic("Test")).toBe(false);
});
