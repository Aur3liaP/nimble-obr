/**
 * @file Unit tests for `NimbleCharacter` schema versioning and migration.
 *
 * Focused on `characterMigrations.ts` because, like `formulaParser.ts`, it
 * is pure (no OBR SDK dependency) and correctness-sensitive: a mistake here
 * either corrupts a real character sheet on load, or silently accepts one
 * it shouldn't have.
 */

import { describe, expect, it, vi } from "vitest";
import { createDefaultCharacter, CURRENT_SCHEMA_VERSION } from "../types/character";
import { BASIC_EQUIPMENTS } from "../data/equipment";
import { BASE_SPELLS } from "../data/spells";
import {
  applyMigrations,
  migrateCharacter,
  MIGRATIONS,
  validateCharacterShape,
} from "./characterMigrations";

/** Shallow-omits `keys` from `obj` without triggering unused-destructured-var lint warnings. */
function omit(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj };
  for (const key of keys) delete copy[key];
  return copy;
}

function makeV0Character(): Record<string, unknown> {
  const full = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
  return omit(full, ["combat", "schemaVersion"]);
}

describe("MIGRATIONS invariant", () => {
  it("has exactly one entry per schema version increment", () => {
    // If this fails, either CURRENT_SCHEMA_VERSION was bumped with no
    // matching migration appended, or a migration was appended without
    // bumping CURRENT_SCHEMA_VERSION — see the procedure in
    // characterMigrations.ts's file header.
    expect(MIGRATIONS.length).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe("migrateCharacter — versionless and v0 records", () => {
  it("treats a record with no schemaVersion field as v0 and migrates it", () => {
    const result = migrateCharacter(makeV0Character());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.migrated).toBe(true);
    expect(result.character.combat).toEqual({ actionsRemaining: 3, initiativeResult: null });
    expect(result.character.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("treats an explicit schemaVersion: 0 the same as a missing field", () => {
    const result = migrateCharacter({ ...makeV0Character(), schemaVersion: 0 });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.migrated).toBe(true);
    expect(result.character.combat).toEqual({ actionsRemaining: 3, initiativeResult: null });
  });

  it("does not touch an already-present combat field", () => {
    const base = createDefaultCharacter("token-1", "owner-1");
    const v0WithCombat = {
      ...omit(base as unknown as Record<string, unknown>, ["schemaVersion"]),
      combat: { actionsRemaining: 1, initiativeResult: 17 },
    };
    const result = migrateCharacter(v0WithCombat);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.character.combat).toEqual({ actionsRemaining: 1, initiativeResult: 17 });
  });

  it("backfills several missing top-level fields and a missing field inside a sub-object", () => {
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const brokenDefense = omit(base.defense as unknown as Record<string, unknown>, ["defenseBonus"]);
    const v0 = omit(
      { ...base, defense: brokenDefense },
      ["schemaVersion", "inventoryNotes", "battleNotes", "combat"],
    );

    const result = migrateCharacter(v0);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.migrated).toBe(true);
    // Missing top-level fields backfilled from createDefaultCharacter().
    expect(result.character.inventoryNotes).toBe("");
    expect(result.character.battleNotes).toBe("");
    expect(result.character.combat).toEqual({ actionsRemaining: 3, initiativeResult: null });
    // Missing field inside a present sub-object backfilled too, without
    // dropping the rest of that sub-object.
    expect(result.character.defense).toEqual({ equippedItemId: undefined, defenseBonus: 0 });
  });

  it("does not replace an existing falsy value (0 or empty string) with the default", () => {
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const v0 = omit(
      {
        ...base,
        name: "",
        gold: 0,
        speed: 0,
        stats: { ...(base.stats as Record<string, unknown>), str: 0 },
      },
      ["schemaVersion"],
    );

    const result = migrateCharacter(v0);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.character.name).toBe("");
    expect(result.character.gold).toBe(0);
    expect(result.character.speed).toBe(0);
    expect(result.character.stats.str).toBe(0);
  });
});

describe("migrateCharacter — v1 -> v2 (initiativeAdvantage)", () => {
  it("defaults initiativeAdvantage to 'none' for a v1 record that predates the field", () => {
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const v1 = omit({ ...base, schemaVersion: 1 }, ["initiativeAdvantage"]);
    const result = migrateCharacter(v1);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.migrated).toBe(true);
    expect(result.character.initiativeAdvantage).toBe("none");
    expect(result.character.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("does not overwrite an already-present initiativeAdvantage", () => {
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const v1 = { ...base, schemaVersion: 1, initiativeAdvantage: "advantage" };
    const result = migrateCharacter(v1);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.character.initiativeAdvantage).toBe("advantage");
  });
});

describe("migrateCharacter — v1 -> v2 (armor -> defense rename)", () => {
  // Nimble Core Rules 2nd printing renames the hero stat "Armor" to
  // "Defense". These fixtures simulate genuine old-on-disk data: a v1
  // record keyed by `armor` (the old field name), never `defense`.

  it("renames a fully-populated armor field to defense", () => {
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const v1 = {
      ...omit(base, ["defense"]),
      schemaVersion: 1,
      armor: { equippedItemId: "item-1", defenseBonus: 3 },
    };
    const result = migrateCharacter(v1);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.character.defense).toEqual({ equippedItemId: "item-1", defenseBonus: 3 });
    expect(result.character).not.toHaveProperty("armor");
  });

  it("backfills a missing defenseBonus to 0 while renaming, preserving equippedItemId", () => {
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const v1 = {
      ...omit(base, ["defense"]),
      schemaVersion: 1,
      armor: { equippedItemId: "item-1" }, // defenseBonus missing entirely — genuinely old/incomplete data
    };
    const result = migrateCharacter(v1);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.character.defense).toEqual({ equippedItemId: "item-1", defenseBonus: 0 });
  });

  it("still produces a valid default defense for a record with neither armor nor defense at all", () => {
    // A genuinely ancient record predating the armor/defense field
    // entirely. v0 -> v1's fillMissingFields backfills a default `defense`
    // (from the current, already-renamed createDefaultCharacter template);
    // v1 -> v2's rename step must leave that alone rather than clobber it
    // with an empty object because it saw no `armor` key to rename.
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const v0 = omit(base, ["defense", "schemaVersion", "combat"]);
    const result = migrateCharacter(v0);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.character.defense).toEqual({ equippedItemId: undefined, defenseBonus: 0 });
  });
});

describe("migrateCharacter — v1 -> v2 (CharacterAction.damage removal)", () => {
  // `damage` was display-only flavor text, kept in sync with `formula` by
  // hand across ~80 spells; removed from the schema once formula's
  // resolved display made it strictly less useful. A real character's
  // `actions` are frozen copies, so a character who added a spell before
  // this removal still has both fields in their persisted metadata —
  // these fixtures simulate every shape that data can take.

  function migrateOneAction(action: Record<string, unknown>): Record<string, unknown> {
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const v1 = { ...base, schemaVersion: 1, actions: [action] };
    const result = migrateCharacter(v1);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected migration to succeed");
    return (result.character.actions as unknown as Record<string, unknown>[])[0];
  }

  it("formula only: keeps formula, drops damage (never had one)", () => {
    const migrated = migrateOneAction({ id: "a1", name: "Test", type: "melee", formula: "1d8+STR" });
    expect(migrated.formula).toBe("1d8+STR");
    expect(migrated).not.toHaveProperty("damage");
  });

  it("damage only (no formula key at all): promotes damage to formula", () => {
    const migrated = migrateOneAction({ id: "a1", name: "Test", type: "melee", damage: "2d6+STR" });
    expect(migrated.formula).toBe("2d6+STR");
    expect(migrated).not.toHaveProperty("damage");
  });

  it("both set: formula wins, damage is dropped without being consulted", () => {
    const migrated = migrateOneAction({
      id: "a1",
      name: "Test",
      type: "melee",
      formula: "1d8+STR",
      damage: "1d8+STR (book notation, possibly stale)",
    });
    expect(migrated.formula).toBe("1d8+STR");
    expect(migrated).not.toHaveProperty("damage");
  });

  it("damage '0' with empty formula: treated as a placeholder, formula stays empty (e.g. True Strike, Ice Disk)", () => {
    const migrated = migrateOneAction({ id: "a1", name: "True Strike", type: "spell", formula: "", damage: "0" });
    expect(migrated.formula).toBe("");
    expect(migrated).not.toHaveProperty("damage");
  });

  it("damage 'Special' with empty formula: treated as a placeholder, formula stays empty (e.g. pre-part-1b Dragonform)", () => {
    const migrated = migrateOneAction({
      id: "a1",
      name: "Dragonform",
      type: "spell",
      formula: "",
      damage: "Special",
    });
    expect(migrated.formula).toBe("");
    expect(migrated).not.toHaveProperty("damage");
  });

  it("both empty: formula stays empty, genuinely not rollable", () => {
    const migrated = migrateOneAction({ id: "a1", name: "Test", type: "spell", formula: "", damage: "" });
    expect(migrated.formula).toBe("");
    expect(migrated).not.toHaveProperty("damage");
  });

  it("the should-never-happen shape (non-placeholder damage, empty formula) prefers damage and logs a warning", () => {
    // Mirrors the removed "game data guard" test from formulaParser.test.ts,
    // which confirmed no BASE_SPELLS entry ships in this shape — this
    // covers the same concern at the migration level, for a character's
    // own (possibly hand-edited or otherwise unusual) frozen data.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const migrated = migrateOneAction({
      id: "a1",
      name: "Weird Entry",
      type: "spell",
      formula: "",
      damage: "3d6",
    });
    expect(migrated.formula).toBe("3d6");
    expect(migrated).not.toHaveProperty("damage");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("Weird Entry");
    warnSpy.mockRestore();
  });
});

describe("migrateCharacter — v1 -> v2 (InventoryItem.manualResolution backfill)", () => {
  // Items added to a character's sheet before manualResolution's read path
  // was wired up carry manualResolution: undefined in their frozen
  // metadata, showing a working-looking roll button that throws — even
  // though the current BASIC_EQUIPMENTS data has the flag set. Driven off
  // BASIC_EQUIPMENTS itself (see migrateInventoryManualResolution's own
  // comment), not a hardcoded name list.

  function migrateOneItem(item: Record<string, unknown>): Record<string, unknown> {
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const v1 = { ...base, schemaVersion: 1, inventory: [item] };
    const result = migrateCharacter(v1);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected migration to succeed");
    return (result.character.inventory as unknown as Record<string, unknown>[])[0];
  }

  it("backfills manualResolution: true on a non-custom item matching a manualResolution BASIC_EQUIPMENTS entry by name", () => {
    const migrated = migrateOneItem({
      id: "i1",
      name: "Weapon of Animosity",
      description: "",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isCustom: false,
    });
    expect(migrated.manualResolution).toBe(true);
  });

  it("does not set manualResolution on a non-custom item matching a normal (non-manualResolution) entry", () => {
    const migrated = migrateOneItem({
      id: "i1",
      name: "Longsword",
      description: "",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isCustom: false,
    });
    expect(migrated).not.toHaveProperty("manualResolution");
  });

  it("never touches a custom item, even if its name happens to match a manualResolution entry", () => {
    const migrated = migrateOneItem({
      id: "i1",
      name: "Weapon of Animosity",
      description: "",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isCustom: true,
    });
    expect(migrated).not.toHaveProperty("manualResolution");
  });

  it("leaves a non-custom item with no matching BASIC_EQUIPMENTS entry untouched", () => {
    const migrated = migrateOneItem({
      id: "i1",
      name: "Homebrew Trinket",
      description: "",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isCustom: false,
    });
    expect(migrated).not.toHaveProperty("manualResolution");
  });
});

describe("migrateCharacter — v2 -> v3 (sourceKey backfill)", () => {
  // Fixtures start at schemaVersion 2 (not 1, unlike the v1 -> v2 blocks
  // above) specifically to isolate MIGRATIONS[2] — a v1 fixture would also
  // run MIGRATIONS[1] first, which is a different concern already covered
  // above.

  function migrateOneItemV2(item: Record<string, unknown>): Record<string, unknown> {
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const v2 = { ...base, schemaVersion: 2, inventory: [item] };
    const result = migrateCharacter(v2);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected migration to succeed");
    return (result.character.inventory as unknown as Record<string, unknown>[])[0];
  }

  function migrateOneActionV2(action: Record<string, unknown>): Record<string, unknown> {
    const base = createDefaultCharacter("token-1", "owner-1") as unknown as Record<string, unknown>;
    const v2 = { ...base, schemaVersion: 2, actions: [action] };
    const result = migrateCharacter(v2);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected migration to succeed");
    return (result.character.actions as unknown as Record<string, unknown>[])[0];
  }

  it("backfills sourceKey on a non-custom inventory item matching a catalog entry by name", () => {
    const template = BASIC_EQUIPMENTS.find((e) => e.name === "Longsword");
    if (!template) throw new Error("fixture setup: Longsword missing from BASIC_EQUIPMENTS");
    const migrated = migrateOneItemV2({
      id: "i1",
      name: "Longsword",
      description: "",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isCustom: false,
      formula: template.formula,
    });
    expect(migrated.sourceKey).toBe(template.sourceKey);
  });

  it("never touches a custom inventory item, even if its name matches a catalog entry", () => {
    const migrated = migrateOneItemV2({
      id: "i1",
      name: "Longsword",
      description: "",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isCustom: true,
    });
    expect(migrated.sourceKey).toBeUndefined();
  });

  it("leaves sourceKey undefined for an inventory item matching nothing in the catalog", () => {
    const migrated = migrateOneItemV2({
      id: "i1",
      name: "Homebrew Trinket",
      description: "",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isCustom: false,
    });
    expect(migrated.sourceKey).toBeUndefined();
  });

  it("KNOWN COLLISION: an old 'Spear' item (1d10+STR, really a Great Spear) resolves to great-spear, not the new light Spear, and logs", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const migrated = migrateOneItemV2({
      id: "i1",
      name: "Spear",
      description: "2-handed, Reach 2. Piercing damage.",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isCustom: false,
      formula: "1d10 + STR",
      actionCost: 1,
    });
    expect(migrated.sourceKey).toBe("great-spear");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("Spear");
    warnSpy.mockRestore();
  });

  it("a genuinely new light Spear item (1d6+STR) resolves to the current 'spear' entry, no collision log", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const migrated = migrateOneItemV2({
      id: "i1",
      name: "Spear",
      description: "2-handed, Reach 2. Piercing damage.",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isCustom: false,
      formula: "1d6 + STR",
      actionCost: 1,
    });
    expect(migrated.sourceKey).toBe("spear");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("re-derives manualResolution using the same collision-safe resolution as sourceKey", () => {
    const template = BASIC_EQUIPMENTS.find((e) => e.name === "Weapon of Animosity");
    if (!template) throw new Error("fixture setup: Weapon of Animosity missing from BASIC_EQUIPMENTS");
    const migrated = migrateOneItemV2({
      id: "i1",
      name: "Weapon of Animosity",
      description: "",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isCustom: false,
      formula: template.formula,
    });
    expect(migrated.sourceKey).toBe("weapon-of-animosity");
    expect(migrated.manualResolution).toBe(true);
  });

  it("backfills sourceKey on a non-custom action (spell) matching BASE_SPELLS by name", () => {
    const template = BASE_SPELLS.find((s) => s.name === "Ignite");
    if (!template) throw new Error("fixture setup: Ignite missing from BASE_SPELLS");
    const migrated = migrateOneActionV2({
      id: "a1",
      name: "Ignite",
      type: "spell",
      range: "8",
      formula: template.formula,
      description: "",
      isFavorite: false,
      isCustom: false,
    });
    expect(migrated.sourceKey).toBe(template.sourceKey);
  });

  it("never touches a custom action, even if its name matches a spell", () => {
    const migrated = migrateOneActionV2({
      id: "a1",
      name: "Ignite",
      type: "spell",
      range: "8",
      formula: "",
      description: "",
      isFavorite: false,
      isCustom: true,
    });
    expect(migrated.sourceKey).toBeUndefined();
  });

  it("leaves sourceKey undefined for a non-spell combat action, never catalog-sourced", () => {
    const migrated = migrateOneActionV2({
      id: "a1",
      name: "Cleave",
      type: "melee",
      range: "1",
      formula: "1d8+STR",
      description: "",
      isFavorite: false,
      isCustom: false,
    });
    expect(migrated.sourceKey).toBeUndefined();
  });
});

describe("migrateCharacter — already current", () => {
  it("reports no migration for a record already at CURRENT_SCHEMA_VERSION", () => {
    const character = createDefaultCharacter("token-1", "owner-1");
    const result = migrateCharacter(character);
    expect(result).toEqual({ status: "ok", character, migrated: false });
  });
});

describe("migrateCharacter — idempotence", () => {
  it("re-migrating an already-migrated record yields the same result and migrated: false", () => {
    const first = migrateCharacter(makeV0Character());
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;

    const second = migrateCharacter(first.character);
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.migrated).toBe(false);
    expect(second.character).toEqual(first.character);
  });
});

describe("migrateCharacter — future schema version", () => {
  it("refuses to load a record newer than CURRENT_SCHEMA_VERSION", () => {
    const character = createDefaultCharacter("token-1", "owner-1");
    const future = { ...character, schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    const result = migrateCharacter(future);
    expect(result).toEqual({ status: "unsupported", foundVersion: CURRENT_SCHEMA_VERSION + 1 });
  });

  it("reports 'unsupported', not 'invalid', even when the future record's shape is unrecognizable", () => {
    // A future record's shape is unknown by definition. The version check
    // must short-circuit before any shape check runs, or a legitimate
    // newer-client record would misreport as corrupted instead of "from
    // the future".
    const result = migrateCharacter({
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      someFieldThisBuildHasNeverHeardOf: true,
    });
    expect(result.status).toBe("unsupported");
  });
});

describe("migrateCharacter — invalid input", () => {
  it.each([
    ["a string", "not a character"],
    ["a number", 42],
    ["an array", []],
    ["null", null],
  ])("rejects %s as invalid rather than crashing", (_label, value) => {
    const result = migrateCharacter(value);
    expect(result.status).toBe("invalid");
  });

  it("rejects a record missing a required top-level field entirely", () => {
    const character = createDefaultCharacter("token-1", "owner-1");
    const broken = omit(character as unknown as Record<string, unknown>, ["hp"]);
    const result = migrateCharacter(broken);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.reason).toContain("hp");
  });

  it("rejects a record whose migrated shape has a top-level field of the wrong type", () => {
    const character = createDefaultCharacter("token-1", "owner-1");
    const corrupted = { ...character, hp: "not an object" };
    const result = migrateCharacter(corrupted);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.reason).toContain("hp");
  });

  it("rejects a record with a wrong-typed nested field", () => {
    const character = createDefaultCharacter("token-1", "owner-1");
    const corrupted = { ...character, stats: { ...character.stats, str: "3" } };
    const result = migrateCharacter(corrupted);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.reason).toContain("stats.str");
  });

  it("rejects when a migration itself throws", () => {
    const originalMigrations = [...MIGRATIONS];
    MIGRATIONS.length = 0;
    MIGRATIONS.push(() => {
      throw new Error("simulated migration failure");
    });
    try {
      const result = migrateCharacter({ schemaVersion: 0 });
      expect(result.status).toBe("invalid");
      if (result.status !== "invalid") return;
      expect(result.reason).toContain("simulated migration failure");
    } finally {
      MIGRATIONS.length = 0;
      MIGRATIONS.push(...originalMigrations);
    }
  });
});

describe("applyMigrations — chaining", () => {
  const tag =
    (label: string) =>
    (character: Record<string, unknown>): Record<string, unknown> => ({
      ...character,
      tags: [...((character.tags as string[]) ?? []), label],
    });

  it("applies more than one migration in order, threading each output into the next", () => {
    const chain = [tag("v0->v1"), tag("v1->v2"), tag("v2->v3")];
    const result = applyMigrations(chain, {}, 0);
    expect(result.tags).toEqual(["v0->v1", "v1->v2", "v2->v3"]);
  });

  it("starts partway through the chain when fromVersion is not 0", () => {
    const chain = [tag("v0->v1"), tag("v1->v2")];
    const result = applyMigrations(chain, {}, 1);
    expect(result.tags).toEqual(["v1->v2"]);
  });

  it("is a no-op when fromVersion already equals the chain length", () => {
    const chain = [tag("v0->v1")];
    const record = { schemaVersion: 1 };
    const result = applyMigrations(chain, record, 1);
    expect(result).toEqual(record);
  });
});

describe("validateCharacterShape", () => {
  it("accepts a freshly created default character", () => {
    expect(validateCharacterShape(createDefaultCharacter("t", "o"))).toBeNull();
  });

  it("flags a non-object", () => {
    expect(validateCharacterShape("nope")).not.toBeNull();
  });

  it("flags a missing top-level field", () => {
    const character = createDefaultCharacter("t", "o");
    const broken = omit(character as unknown as Record<string, unknown>, ["wounds"]);
    expect(validateCharacterShape(broken)).toContain("wounds");
  });

  it("flags a wrong-typed nested field", () => {
    const character = createDefaultCharacter("t", "o");
    const corrupted = { ...character, hitDice: { ...character.hitDice, current: "one" } };
    expect(validateCharacterShape(corrupted)).toContain("hitDice.current");
  });

  it("accepts null at any field regardless of the template's type there (documented gap)", () => {
    const character = createDefaultCharacter("t", "o");
    expect(validateCharacterShape({ ...character, name: null })).toBeNull();
  });

  it("does not flag a genuinely optional field left absent", () => {
    const character = createDefaultCharacter("t", "o");
    const defenseWithoutOptionalField = omit(
      character.defense as unknown as Record<string, unknown>,
      ["equippedItemId"],
    );
    expect(
      validateCharacterShape({ ...character, defense: defenseWithoutOptionalField }),
    ).toBeNull();
  });
});
