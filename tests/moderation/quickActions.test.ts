import { describe, it, expect } from "bun:test";
import {
  QuickActionsConfigSchema,
  QuickActionDefinitionSchema,
  SubActionSchema,
} from "../../src/db/redis/schema.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// SubActionSchema
// ---------------------------------------------------------------------------
describe("SubActionSchema", () => {
  it("should accept warn subaction with amount", () => {
    const result = SubActionSchema.parse({ type: "warn", warnAmount: 3 });
    expect(result.type).toBe("warn");
    expect(result.warnAmount).toBe(3);
  });

  it("should accept mute subaction with duration", () => {
    const result = SubActionSchema.parse({ type: "mute", muteDuration: 600000 });
    expect(result.type).toBe("mute");
    expect(result.muteDuration).toBe(600000);
  });

  it("should accept addRole subaction with roleId", () => {
    const result = SubActionSchema.parse({ type: "addRole", roleId: "123456789012345678" });
    expect(result.type).toBe("addRole");
    expect(result.roleId).toBe("123456789012345678");
  });

  it("should accept sendDm subaction with message", () => {
    const result = SubActionSchema.parse({ type: "sendDm", dmMessage: "Read the rules." });
    expect(result.type).toBe("sendDm");
    expect(result.dmMessage).toBe("Read the rules.");
  });

  it("should accept kick subaction", () => {
    const result = SubActionSchema.parse({ type: "kick" });
    expect(result.type).toBe("kick");
  });

  it("should accept ban subaction with optional fields", () => {
    const result = SubActionSchema.parse({ type: "ban", banReason: "Spam", banDuration: 86400000 });
    expect(result.type).toBe("ban");
    expect(result.banReason).toBe("Spam");
    expect(result.banDuration).toBe(86400000);
  });

  it("should reject unknown type", () => {
    expect(() => SubActionSchema.parse({ type: "unknown" })).toThrow(z.ZodError);
  });

  it("should reject warn amount > 10", () => {
    expect(() => SubActionSchema.parse({ type: "warn", warnAmount: 11 })).toThrow(z.ZodError);
  });

  it("should reject negative mute duration", () => {
    expect(() => SubActionSchema.parse({ type: "mute", muteDuration: -1 })).toThrow(z.ZodError);
  });

  it("should reject dm message > 2000 chars", () => {
    expect(() => SubActionSchema.parse({ type: "sendDm", dmMessage: "x".repeat(2001) })).toThrow(z.ZodError);
  });
});

// ---------------------------------------------------------------------------
// QuickActionDefinitionSchema
// ---------------------------------------------------------------------------
describe("QuickActionDefinitionSchema", () => {
  it("should accept valid definition", () => {
    const result = QuickActionDefinitionSchema.parse({
      id: "abc123",
      label: "Mute + DM",
      triggers: ["mute", "warn"],
      subactions: [
        { type: "mute", muteDuration: 600000 },
        { type: "sendDm", dmMessage: "Read the rules." },
      ],
    });
    expect(result.label).toBe("Mute + DM");
    expect(result.triggers).toEqual(["mute", "warn"]);
    expect(result.subactions).toHaveLength(2);
  });

  it("should reject label > 80 characters", () => {
    expect(() =>
      QuickActionDefinitionSchema.parse({
        id: "abc",
        label: "x".repeat(81),
        triggers: ["warn"],
        subactions: [{ type: "warn" }],
      }),
    ).toThrow(z.ZodError);
  });

  it("should reject empty triggers", () => {
    expect(() =>
      QuickActionDefinitionSchema.parse({
        id: "abc",
        label: "Test",
        triggers: [],
        subactions: [{ type: "warn" }],
      }),
    ).toThrow(z.ZodError);
  });

  it("should reject empty subactions", () => {
    expect(() =>
      QuickActionDefinitionSchema.parse({
        id: "abc",
        label: "Test",
        triggers: ["warn"],
        subactions: [],
      }),
    ).toThrow(z.ZodError);
  });

  it("should reject more than 5 subactions", () => {
    expect(() =>
      QuickActionDefinitionSchema.parse({
        id: "abc",
        label: "Test",
        triggers: ["warn"],
        subactions: [
          { type: "warn" },
          { type: "warn" },
          { type: "warn" },
          { type: "warn" },
          { type: "warn" },
          { type: "warn" },
        ],
      }),
    ).toThrow(z.ZodError);
  });

  it("should accept exactly 5 subactions", () => {
    const result = QuickActionDefinitionSchema.parse({
      id: "abc",
      label: "Test",
      triggers: ["warn"],
      subactions: [
        { type: "warn" },
        { type: "mute", muteDuration: 600000 },
        { type: "addRole", roleId: "123" },
        { type: "sendDm", dmMessage: "Hi" },
        { type: "kick" },
      ],
    });
    expect(result.subactions).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// QuickActionsConfigSchema
// ---------------------------------------------------------------------------
describe("QuickActionsConfigSchema", () => {
  it("should default to empty actions array", () => {
    const result = QuickActionsConfigSchema.parse({});
    expect(result.actions).toEqual([]);
  });

  it("should accept config with actions", () => {
    const result = QuickActionsConfigSchema.parse({
      actions: [
        {
          id: "a1",
          label: "Mute + Warn",
          triggers: ["mute"],
          subactions: [{ type: "warn", warnAmount: 2 }],
        },
      ],
    });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.label).toBe("Mute + Warn");
  });

  it("should accept multiple actions", () => {
    const result = QuickActionsConfigSchema.parse({
      actions: [
        { id: "a1", label: "A", triggers: ["warn"], subactions: [{ type: "mute", muteDuration: 600000 }] },
        { id: "a2", label: "B", triggers: ["mute"], subactions: [{ type: "kick" }] },
      ],
    });
    expect(result.actions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Validation logic (pure functions extracted from the wizard)
// ---------------------------------------------------------------------------
const SINGLE_USE_TYPES = new Set(["mute", "sendDm", "kick", "ban"]);
const ALL_SUB_TYPES = ["warn", "mute", "addRole", "sendDm", "kick", "ban"] as const;
const MAX_SUBACTIONS = 5;

function availableSubTypes(subactions: { type: string }[]): string[] {
  if (subactions.length >= MAX_SUBACTIONS) return [];
  const last = subactions[subactions.length - 1];
  if (last && (last.type === "kick" || last.type === "ban")) return [];
  const existing = new Set(subactions.map((s) => s.type));
  return ALL_SUB_TYPES.filter((t) => !SINGLE_USE_TYPES.has(t) || !existing.has(t));
}

describe("Subaction availability rules", () => {
  it("should show all types when no subactions exist", () => {
    expect(availableSubTypes([])).toEqual(["warn", "mute", "addRole", "sendDm", "kick", "ban"]);
  });

  it("should hide mute after it has been used", () => {
    const subs = [{ type: "mute" }];
    expect(availableSubTypes(subs)).not.toContain("mute");
    expect(availableSubTypes(subs)).toContain("warn");
  });

  it("should hide all types after kick (terminal)", () => {
    const subs = [{ type: "kick" }];
    expect(availableSubTypes(subs)).toEqual([]);
  });

  it("should hide all types after ban (terminal)", () => {
    const subs = [{ type: "ban" }];
    expect(availableSubTypes(subs)).toEqual([]);
  });

  it("should return empty when max subactions reached", () => {
    const subs = [{ type: "warn" }, { type: "warn" }, { type: "warn" }, { type: "warn" }, { type: "warn" }];
    expect(availableSubTypes(subs)).toEqual([]);
  });

  it("should allow adding more after warn", () => {
    const subs = [{ type: "warn" }];
    const available = availableSubTypes(subs);
    expect(available.length).toBeGreaterThan(0);
    expect(available).toContain("mute");
    expect(available).toContain("kick");
  });

  it("should allow adding more after addRole", () => {
    const subs = [{ type: "addRole" }];
    const available = availableSubTypes(subs);
    expect(available.length).toBeGreaterThan(0);
  });

  it("should allow warn multiple times", () => {
    const subs = [{ type: "warn" }];
    const available = availableSubTypes(subs);
    expect(available).toContain("warn");
  });

  it("should allow addRole multiple times", () => {
    const subs = [{ type: "addRole" }];
    const available = availableSubTypes(subs);
    expect(available).toContain("addRole");
  });

  it("should show all types when 4 warns exist and 1 slot remains", () => {
    const subs = [{ type: "warn" }, { type: "warn" }, { type: "warn" }, { type: "warn" }];
    const available = availableSubTypes(subs);
    expect(available).toEqual(["warn", "mute", "addRole", "sendDm", "kick", "ban"]);
  });
});
