/**
 * @file Unit tests for `catalogCopy.ts` and the `sourceKey` catalog
 * invariants it depends on: every catalog entry has a unique `sourceKey`,
 * copying a catalog entry carries it over, and a custom (player-authored)
 * entry never receives one.
 */

import { describe, expect, it } from "vitest";
import { BASE_SPELLS } from "../data/spells";
import { BASIC_EQUIPMENTS } from "../data/equipment";
import {
  copySpellFromCatalog,
  createCustomSpell,
  copyItemFromCatalog,
  createCustomItem,
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

describe("copySpellFromCatalog", () => {
  it("carries sourceKey from the template for every real spell", () => {
    for (const template of BASE_SPELLS) {
      const copy = copySpellFromCatalog(template);
      expect(copy.sourceKey).toBe(template.sourceKey);
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

  it("never sets sourceKey, even though the shape allows it", () => {
    const custom = createCustomSpell(form);
    expect(custom.sourceKey).toBeUndefined();
    expect("sourceKey" in custom).toBe(false);
  });

  it("always sets isCustom: true", () => {
    expect(createCustomSpell(form).isCustom).toBe(true);
  });

  it("still never sets sourceKey when the custom name collides with a real catalog entry", () => {
    // A player naming their homebrew spell identically to an official one
    // must not accidentally borrow that entry's sourceKey — this path
    // never even looks at BASE_SPELLS, so there's nothing to borrow from.
    const collidingForm: CustomSpellForm = { ...form, name: BASE_SPELLS[0].name };
    const custom = createCustomSpell(collidingForm);
    expect(custom.sourceKey).toBeUndefined();
  });
});

describe("copyItemFromCatalog", () => {
  it("carries sourceKey from the template for every real equipment entry", () => {
    for (const template of BASIC_EQUIPMENTS) {
      const copy = copyItemFromCatalog(template);
      expect(copy.sourceKey).toBe(template.sourceKey);
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
  };

  it("never sets sourceKey, even though the shape allows it", () => {
    const custom = createCustomItem(form);
    expect(custom.sourceKey).toBeUndefined();
    expect("sourceKey" in custom).toBe(false);
  });

  it("always sets isCustom: true", () => {
    expect(createCustomItem(form).isCustom).toBe(true);
  });

  it("still never sets sourceKey when the custom name collides with a real catalog entry", () => {
    const collidingForm: CustomItemForm = { ...form, name: BASIC_EQUIPMENTS[0].name };
    const custom = createCustomItem(collidingForm);
    expect(custom.sourceKey).toBeUndefined();
  });

  it("stores an empty formula as undefined, not an empty string", () => {
    expect(createCustomItem(form).formula).toBeUndefined();
  });
});
