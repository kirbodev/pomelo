// Tests for the backup consistency diff
import { test, expect } from "bun:test";
import {
  diffBackupState,
  type BackupRowState,
} from "../../src/lib/helpers/backup.js";

const row = (
  key: string,
  contentHash: string,
  deleted = false,
): BackupRowState => ({ key, contentHash, deleted });

test("matching rows produce no work", () => {
  const diff = diffBackupState(
    new Map([
      ["a", "hash-a"],
      ["b", "hash-b"],
    ]),
    [row("a", "hash-a"), row("b", "hash-b")],
  );
  expect(diff.staleKeys).toEqual([]);
  expect(diff.suspectedLossKeys).toEqual([]);
  expect(diff.matching).toBe(2);
});

test("keys in Redis but missing from the backup are stale", () => {
  const diff = diffBackupState(new Map([["a", "hash-a"]]), []);
  expect(diff.staleKeys).toEqual(["a"]);
  expect(diff.suspectedLossKeys).toEqual([]);
});

test("hash mismatches are stale", () => {
  const diff = diffBackupState(new Map([["a", "hash-new"]]), [
    row("a", "hash-old"),
  ]);
  expect(diff.staleKeys).toEqual(["a"]);
  expect(diff.matching).toBe(0);
});

test("tombstoned rows whose key is alive again are stale", () => {
  const diff = diffBackupState(new Map([["a", "hash-a"]]), [
    row("a", "hash-a", true),
  ]);
  expect(diff.staleKeys).toEqual(["a"]);
  expect(diff.suspectedLossKeys).toEqual([]);
});

test("live backup rows missing from Redis are suspected loss", () => {
  const diff = diffBackupState(new Map(), [row("a", "hash-a")]);
  expect(diff.staleKeys).toEqual([]);
  expect(diff.suspectedLossKeys).toEqual(["a"]);
});

test("tombstoned rows missing from Redis are a legit deletion, not loss", () => {
  const diff = diffBackupState(new Map(), [row("a", "hash-a", true)]);
  expect(diff.staleKeys).toEqual([]);
  expect(diff.suspectedLossKeys).toEqual([]);
});

test("mixed states are categorized independently", () => {
  const diff = diffBackupState(
    new Map([
      ["ok", "hash-ok"],
      ["drifted", "hash-new"],
      ["unbacked", "hash-u"],
    ]),
    [
      row("ok", "hash-ok"),
      row("drifted", "hash-old"),
      row("lost", "hash-l"),
      row("deleted", "hash-d", true),
    ],
  );
  expect(diff.staleKeys.sort()).toEqual(["drifted", "unbacked"]);
  expect(diff.suspectedLossKeys).toEqual(["lost"]);
  expect(diff.matching).toBe(1);
});
