/**
 * @file Unit tests for `catalogCopy.ts` and the `sourceKey` catalog
 * invariants it depends on: every catalog entry has a unique `sourceKey`,
 * copying a catalog entry carries it over, and a custom (player-authored)
 * entry never receives one.
 */

import { describe, expect, it } from "vitest";
import type { CharacterAction, InventoryItem } from "../types/character";
import { BASE_SPELLS } from "../data/spells";
import { BASIC_EQUIPMENTS } from "../data/equipment";
import {
  copySpellFromCatalog,
  createCustomSpell,
  copyItemFromCatalog,
  createCustomItem,
  isOutdated,
  resetSpellToCatalog,
  resetItemToCatalog,
  type CustomSpellForm,
  type CustomItemForm,
} from "./catalogCopy";

describe("sourceKey — catalog invariants", () => {
  it("every BASE_SPELLS entry has a non-empty sourceKey", () => {
    const offenders = BASE_SPELLS.filter((s) => !s.sourceKey).map((s) => s.name);
    expect(offenders).toEqual([]);
  });

  it("every BASIC_EQUIPMENTS entry has a non-empty sourceKey", () => {
    const offenders = BASIC_EQUIPMENTS.filter((e) => !e.sourceKey).map((e) => e.name);
    expect(offenders).toEqual([]);
  });

  it("every BASE_SPELLS sourceKey is unique", () => {
    const keys = BASE_SPELLS.map((s) => s.sourceKey);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it("every BASIC_EQUIPMENTS sourceKey is unique", () => {
    const keys = BASIC_EQUIPMENTS.map((e) => e.sourceKey);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it("sourceKey values are lowercase and hyphenated, not raw names", () => {
    // Not a strict format validator — just enough to catch someone pasting
    // a raw `name` in as `sourceKey` (defeats the whole point: sourceKey
    // must survive a name change unchanged).
    const offenders = [...BASE_SPELLS, ...BASIC_EQUIPMENTS]
      .filter((e) => e.sourceKey && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.sourceKey))
      .map((e) => `${e.name} :: sourceKey="${e.sourceKey}"`);
    expect(offenders).toEqual([]);
  });
});

describe("catalogVersion — catalog invariants", () => {
  it("every BASE_SPELLS entry has a catalogVersion of at least 1", () => {
    const offenders = BASE_SPELLS.filter(
      (s) => s.catalogVersion === undefined || s.catalogVersion < 1,
    ).map((s) => `${s.name} :: catalogVersion=${s.catalogVersion}`);
    expect(offenders).toEqual([]);
  });

  it("every BASIC_EQUIPMENTS entry has a catalogVersion of at least 1", () => {
    const offenders = BASIC_EQUIPMENTS.filter(
      (e) => e.catalogVersion === undefined || e.catalogVersion < 1,
    ).map((e) => `${e.name} :: catalogVersion=${e.catalogVersion}`);
    expect(offenders).toEqual([]);
  });
});

describe("copySpellFromCatalog", () => {
  it("carries sourceKey and catalogVersion from the template for every real spell", () => {
    for (const template of BASE_SPELLS) {
      const copy = copySpellFromCatalog(template);
      expect(copy.sourceKey).toBe(template.sourceKey);
      expect(copy.catalogVersion).toBe(template.catalogVersion);
      expect(copy.isCustom).toBe(false);
    }
  });

  it("defaults manaCost to the spell's tier when the template doesn't set one, and 0 for cantrips", () => {
    const cantrip = BASE_SPELLS.find((s) => s.spellTier === 0 && s.manaCost === undefined);
    const tiered = BASE_SPELLS.find((s) => (s.spellTier ?? 0) > 0 && s.manaCost === undefined);
    if (cantrip) expect(copySpellFromCatalog(cantrip).manaCost).toBe(0);
    if (tiered) expect(copySpellFromCatalog(tiered).manaCost).toBe(tiered.spellTier);
  });

  it("mints a fresh id on every call, not reusing the template", () => {
    const template = BASE_SPELLS[0];
    const a = copySpellFromCatalog(template);
    const b = copySpellFromCatalog(template);
    expect(a.id).not.toBe(b.id);
  });
});

describe("createCustomSpell", () => {
  const form: CustomSpellForm = {
    name: "Homebrew Zap",
    tier: 2,
    manaCost: 3,
    school: "lightning",
    range: "6",
    formula: "1d6+INT",
    description: "A player-authored spell.",
  };

  it("never sets sourceKey or catalogVersion, even though the shape allows both", () => {
    const custom = createCustomSpell(form);
    expect(custom.sourceKey).toBeUndefined();
    expect("sourceKey" in custom).toBe(false);
    expect(custom.catalogVersion).toBeUndefined();
    expect("catalogVersion" in custom).toBe(false);
  });

  it("always sets isCustom: true", () => {
    expect(createCustomSpell(form).isCustom).toBe(true);
  });

  it("still never sets sourceKey or catalogVersion when the custom name collides with a real catalog entry", () => {
    // A player naming their homebrew spell identically to an official one
    // must not accidentally borrow that entry's sourceKey/catalogVersion —
    // this path never even looks at BASE_SPELLS, so there's nothing to
    // borrow from.
    const collidingForm: CustomSpellForm = { ...form, name: BASE_SPELLS[0].name };
    const custom = createCustomSpell(collidingForm);
    expect(custom.sourceKey).toBeUndefined();
    expect(custom.catalogVersion).toBeUndefined();
  });
});

describe("BASIC_EQUIPMENTS.category — catalog invariant", () => {
  const VALID_CATEGORIES = ["weapon", "armor", "consumable", "gear"];

  it("every BASIC_EQUIPMENTS entry has one of the four valid categories", () => {
    const offenders = BASIC_EQUIPMENTS.filter(
      (e) => !VALID_CATEGORIES.includes(e.category),
    ).map((e) => `${e.name} :: category=${e.category}`);
    expect(offenders).toEqual([]);
  });

  it("Medical Kit (1 use) and Torch are consumable, not gear (regression: the old heuristic missed both)", () => {
    const medicalKit = BASIC_EQUIPMENTS.find((e) => e.sourceKey === "medical-kit-1-use");
    const torch = BASIC_EQUIPMENTS.find((e) => e.sourceKey === "torch");
    expect(medicalKit?.category).toBe("consumable");
    expect(torch?.category).toBe("consumable");
  });

  it("a representative armor, weapon, and gear entry each carry the expected category", () => {
    const garb = BASIC_EQUIPMENTS.find((e) => e.sourceKey === "adventurers-garb");
    const dagger = BASIC_EQUIPMENTS.find((e) => e.sourceKey === "dagger");
    const rope = BASIC_EQUIPMENTS.find((e) => e.sourceKey === "rope-50-ft");
    expect(garb?.category).toBe("armor");
    expect(dagger?.category).toBe("weapon");
    expect(rope?.category).toBe("gear");
  });
});

describe("copyItemFromCatalog", () => {
  it("carries sourceKey, catalogVersion, and category from the template for every real equipment entry", () => {
    for (const template of BASIC_EQUIPMENTS) {
      const copy = copyItemFromCatalog(template);
      expect(copy.sourceKey).toBe(template.sourceKey);
      expect(copy.catalogVersion).toBe(template.catalogVersion);
      expect(copy.category).toBe(template.category);
      expect(copy.isCustom).toBe(false);
    }
  });

  it("always sets isEquipped: false, even for a template that defaults to equipped (Unarmed Strikes)", () => {
    const unarmed = BASIC_EQUIPMENTS.find((e) => e.name === "Unarmed Strikes");
    expect(unarmed?.isEquipped).toBe(true); // sanity check on the fixture itself
    if (unarmed) expect(copyItemFromCatalog(unarmed).isEquipped).toBe(false);
  });

  it("mints a fresh id on every call, not reusing the template", () => {
    const template = BASIC_EQUIPMENTS[0];
    const a = copyItemFromCatalog(template);
    const b = copyItemFromCatalog(template);
    expect(a.id).not.toBe(b.id);
  });
});

describe("createCustomItem", () => {
  const form: CustomItemForm = {
    name: "Homebrew Trinket",
    description: "A player-authored item.",
    slots: 1,
    formula: "",
    isFavorite: false,
    isArmor: false,
    category: "gear",
  };

  it("never sets sourceKey or catalogVersion, even though the shape allows both", () => {
    const custom = createCustomItem(form);
    expect(custom.sourceKey).toBeUndefined();
    expect("sourceKey" in custom).toBe(false);
    expect(custom.catalogVersion).toBeUndefined();
    expect("catalogVersion" in custom).toBe(false);
  });

  it("always sets isCustom: true", () => {
    expect(createCustomItem(form).isCustom).toBe(true);
  });

  it("still never sets sourceKey or catalogVersion when the custom name collides with a real catalog entry", () => {
    const collidingForm: CustomItemForm = { ...form, name: BASIC_EQUIPMENTS[0].name };
    const custom = createCustomItem(collidingForm);
    expect(custom.sourceKey).toBeUndefined();
    expect(custom.catalogVersion).toBeUndefined();
  });

  it("stores an empty formula as undefined, not an empty string", () => {
    expect(createCustomItem(form).formula).toBeUndefined();
  });

  it("carries category from the form, unlike sourceKey/catalogVersion which are never set on a custom item", () => {
    expect(createCustomItem({ ...form, category: "consumable" }).category).toBe(
      "consumable",
    );
  });
});

describe("isOutdated", () => {
  const template = { sourceKey: "test-key", catalogVersion: 3 };
  const catalog = [template, { sourceKey: "other-key", catalogVersion: 1 }];

  it("true when the copy's catalogVersion is behind the current catalog entry's", () => {
    expect(isOutdated({ sourceKey: "test-key", catalogVersion: 1 }, catalog)).toBe(true);
    expect(isOutdated({ sourceKey: "test-key", catalogVersion: 2 }, catalog)).toBe(true);
  });

  it("false when the copy's catalogVersion matches or is ahead of the catalog's (never happens in practice, but not flagged as an error either)", () => {
    expect(isOutdated({ sourceKey: "test-key", catalogVersion: 3 }, catalog)).toBe(false);
    expect(isOutdated({ sourceKey: "test-key", catalogVersion: 4 }, catalog)).toBe(false);
  });

  it("false for a custom entry (no sourceKey)", () => {
    expect(isOutdated({ catalogVersion: 1 }, catalog)).toBe(false);
  });

  it("false for a copy with no catalogVersion (predates the system entirely)", () => {
    expect(isOutdated({ sourceKey: "test-key" }, catalog)).toBe(false);
  });

  it("false, not an error, when sourceKey no longer exists in the catalog (e.g. a removed entry like Greater Shadow)", () => {
    expect(
      isOutdated({ sourceKey: "greater-shadow", catalogVersion: 1 }, catalog),
    ).toBe(false);
  });

  it("real catalogs: every current, non-custom copy of a real entry is never outdated against its own catalog", () => {
    // Sanity check tying isOutdated to the real data: copying an entry
    // fresh and immediately checking it against the same catalog it came
    // from must never report outdated.
    for (const template of BASE_SPELLS) {
      expect(isOutdated(copySpellFromCatalog(template), BASE_SPELLS)).toBe(false);
    }
    for (const template of BASIC_EQUIPMENTS) {
      expect(isOutdated(copyItemFromCatalog(template), BASIC_EQUIPMENTS)).toBe(false);
    }
  });
});

describe("resetSpellToCatalog", () => {
  it("overwrites every field from the catalog except id and isFavorite", () => {
    const template = BASE_SPELLS.find((s) => s.sourceKey === "flame-dart")!;
    const stale: CharacterAction = {
      ...copySpellFromCatalog(template),
      id: "kept-id",
      isFavorite: true,
      catalogVersion: 0,
      description: "A player edit that should be discarded on reset.",
    };

    const reset = resetSpellToCatalog(stale, BASE_SPELLS);
    expect(reset.id).toBe("kept-id");
    expect(reset.isFavorite).toBe(true);
    expect(reset.description).toBe(template.description);
    expect(reset.catalogVersion).toBe(template.catalogVersion);
    expect(reset.formula).toBe(template.formula);
  });

  it("is a no-op (returns the entry unchanged) when sourceKey matches nothing in the catalog", () => {
    const orphan: CharacterAction = {
      id: "a1",
      name: "Greater Shadow",
      type: "spell",
      range: "adjacent",
      formula: "5d12",
      description: "Frozen copy of a removed spell.",
      isFavorite: false,
      isCustom: false,
      sourceKey: "greater-shadow",
      catalogVersion: 0,
    };
    expect(resetSpellToCatalog(orphan, BASE_SPELLS)).toBe(orphan);
  });
});

describe("resetItemToCatalog", () => {
  it("overwrites every field from the catalog except id and isFavorite — including isEquipped and quantity, per the documented 'plain overwrite' contract", () => {
    const template = BASIC_EQUIPMENTS.find((e) => e.sourceKey === "longsword")!;
    const stale: InventoryItem = {
      ...copyItemFromCatalog(template),
      id: "kept-id",
      isFavorite: true,
      isEquipped: true,
      quantity: 3,
      catalogVersion: 0,
      description: "A player edit that should be discarded on reset.",
    };

    const reset = resetItemToCatalog(stale, BASIC_EQUIPMENTS);
    expect(reset.id).toBe("kept-id");
    expect(reset.isFavorite).toBe(true);
    expect(reset.isEquipped).toBe(false);
    expect(reset.quantity).toBe(1);
    expect(reset.description).toBe(template.description);
    expect(reset.catalogVersion).toBe(template.catalogVersion);
  });

  it("is a no-op (returns the entry unchanged) when sourceKey matches nothing in the catalog", () => {
    const orphan: InventoryItem = {
      id: "i1",
      name: "Some Retired Item",
      description: "Frozen copy of a removed item.",
      slots: 1,
      quantity: 1,
      isEquipped: false,
      isFavorite: false,
      isCustom: false,
      category: "gear",
      sourceKey: "does-not-exist",
      catalogVersion: 0,
    };
    expect(resetItemToCatalog(orphan, BASIC_EQUIPMENTS)).toBe(orphan);
  });
});
