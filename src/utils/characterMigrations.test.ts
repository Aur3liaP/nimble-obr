/**
 * @file Unit tests for `NimbleCharacter` schema versioning and migration.
 *
 * Focused on `characterMigrations.ts` because, like `formulaParser.ts`, it
 * is pure (no OBR SDK dependency) and correctness-sensitive: a mistake here
 * either corrupts a real character sheet on load, or silently accepts one
 * it shouldn't have.
 */

import { describe, expect, it } from "vitest";
import { createDefaultCharacter, CURRENT_SCHEMA_VERSION } from "../types/character";
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
    const brokenArmor = omit(base.armor as unknown as Record<string, unknown>, ["defenseBonus"]);
    const v0 = omit(
      { ...base, armor: brokenArmor },
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
    expect(result.character.armor).toEqual({ equippedItemId: undefined, defenseBonus: 0 });
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
    const armorWithoutOptionalField = omit(character.armor as unknown as Record<string, unknown>, [
      "equippedItemId",
    ]);
    expect(
      validateCharacterShape({ ...character, armor: armorWithoutOptionalField }),
    ).toBeNull();
  });
});
