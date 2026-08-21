/**
 * @file Unit tests for `computeDefense`. Extracted out of `CombatTab.tsx`
 * in part 1f specifically so its `breakdown` string is directly testable
 * — see that file's own header.
 */

import { describe, expect, it } from "vitest";
import { createDefaultCharacter, type NimbleCharacter } from "../types/character";
import { BASIC_EQUIPMENTS } from "../data/equipment";
import { computeDefense } from "./computeDefense";

function makeCharacter(overrides: Partial<NimbleCharacter> = {}): NimbleCharacter {
  const char = createDefaultCharacter("token-1", "owner-1");
  return { ...char, ...overrides };
}

// Part 1g: the armored-case tests below use a REAL entry from
// `BASIC_EQUIPMENTS` rather than a hand-typed formula. Part 1f's test used
// the idealized, zero-whitespace `"3+DEX"`, which is not what this app's
// own data actually contains — every real armor formula in `equipment.ts`
// is written with spaces (`"3 + DEX"`). That mismatch is exactly why part
// 1f's fix passed its own test suite while the bug it claimed to fix was
// still reproducible in OBR: `substituteVariables("3 + DEX", ctx)` at
// DEX -2 yields `"3 + -2"` (space before the glued sign), which part 1f's
// non-whitespace-tolerant regex never matched. Asserting against real data
// here is what would have caught that.
const GARB_MINOR_ENCHANTMENT = BASIC_EQUIPMENTS.find(
  (item) => item.name === "Garb Minor Enchantment",
);
if (!GARB_MINOR_ENCHANTMENT) {
  throw new Error(
    "Fixture setup: \"Garb Minor Enchantment\" not found in BASIC_EQUIPMENTS — did equipment.ts rename or remove it?",
  );
}

describe("computeDefense — breakdown string with a negative stat and a negative bonus (part 1f, part 1g)", () => {
  // Part 1e added sign normalization inside substituteVariables and
  // mutation-tested it — the unit tests for that passed, but the bug was
  // still reproducible in OBR. Root cause: computeDefense builds
  // `breakdown` by concatenating substituteVariables' output (the armor
  // term) with a SEPARATELY formatted bonus term. Normalization applied to
  // the armor term alone; the bonus was appended afterward and never went
  // through it. This test targets computeDefense's actual return value
  // directly — the level the bug lives at — rather than substituteVariables
  // in isolation, which is why part 1e's tests didn't catch it.

  it("renders a breakdown with no glued '+-'/'--' sign, for a negative-DEX armored character with a negative bonus (real armor formula, spaced notation)", () => {
    const char = makeCharacter({
      stats: { str: 0, dex: -2, int: 0, wil: 0 },
      inventory: [{ ...GARB_MINOR_ENCHANTMENT, id: "armor-1", isEquipped: true }],
      defense: { equippedItemId: "armor-1", defenseBonus: -2 },
    });

    const result = computeDefense(char);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(-1); // (3 + -2) + -2 = -1
    expect(result.breakdown).toBe("3-2-2 = -1");
    expect(result.breakdown).not.toMatch(/\+\s*-|-\s*-/);
  });

  it("renders a clean breakdown for the unarmored case with negative DEX and a negative bonus", () => {
    const char = makeCharacter({
      stats: { str: 0, dex: -2, int: 0, wil: 0 },
      defense: { equippedItemId: undefined, defenseBonus: -2 },
    });

    const result = computeDefense(char);
    expect(result.value).toBe(-4);
    expect(result.breakdown).toBe("-2-2 = -4");
    expect(result.breakdown).not.toMatch(/\+-|--/);
  });

  it("renders a positive-DEX, positive-bonus breakdown unchanged (non-regression, real armor formula)", () => {
    const char = makeCharacter({
      stats: { str: 0, dex: 2, int: 0, wil: 0 },
      inventory: [{ ...GARB_MINOR_ENCHANTMENT, id: "armor-1", isEquipped: true }],
      defense: { equippedItemId: "armor-1", defenseBonus: 2 },
    });

    const result = computeDefense(char);
    expect(result.value).toBe(7); // (3 + 2) + 2 = 7
    expect(result.breakdown).toBe("3 + 2+2 = 7");
  });

  it("omits the bonus term entirely when it's zero, rather than showing '+0'", () => {
    const char = makeCharacter({
      stats: { str: 0, dex: 2, int: 0, wil: 0 },
      defense: { equippedItemId: undefined, defenseBonus: 0 },
    });

    const result = computeDefense(char);
    expect(result.value).toBe(2);
    expect(result.breakdown).toBe("2 = 2");
  });

  it("keeps the existing error contract: a broken armor formula reports the error and no breakdown, value falls back to the bonus alone", () => {
    const char = makeCharacter({
      inventory: [
        {
          id: "armor-1",
          name: "Broken Armor",
          description: "",
          slots: 1,
          quantity: 1,
          isEquipped: true,
          isArmor: true,
          category: "armor",
          formula: "3+NOTAREALVARIABLE",
        },
      ],
      defense: { equippedItemId: "armor-1", defenseBonus: -2 },
    });

    const result = computeDefense(char);
    expect(result.error).toBeTruthy();
    expect(result.value).toBe(-2); // 0 (failed armor eval) + bonus
    expect(result.breakdown).toBeUndefined();
  });
});
