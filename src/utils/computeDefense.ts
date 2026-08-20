/**
 * @file Pure defense computation for a character — extracted out of
 * `CombatTab.tsx` in part 1f specifically so it's unit-testable (same
 * pattern/reasoning as `initiative.ts`'s extraction: a function that lives
 * inside a `.tsx` component file can't be unit-tested under this project's
 * "pure functions only, no OBR/React dependency" test convention).
 */

import type { NimbleCharacter } from "../types/character";
import {
  evalFormula,
  substituteVariables,
  buildContext,
  normalizeSubstitutedSignsForDisplay,
} from "./formulaParser";
import { formatModifier } from "./formatModifier";

/**
 * Renders the arithmetic breakdown that sums to a resolved defense value:
 * an already variable-substituted armor term, plus the flat bonus if it's
 * nonzero, plus the total — e.g. `"3+2-2 = 3"` for armor "3+DEX" at DEX 2
 * and a -2 bonus, or `"2 = 2"` for unarmored DEX 2 with no bonus.
 *
 * `substituteVariables` (armor term) and `formatModifier` (bonus term) are
 * each individually correct in isolation, but neither knows about the
 * other — concatenating them can still glue a "+"/"-" operator directly
 * onto a value that's itself negative (e.g. armor term "3+-2" at DEX -2,
 * or a "-2" armor term immediately followed by a "-2" bonus term). Part 1e
 * tried normalizing inside `substituteVariables` itself, which only ever
 * touched the armor term and missed the bonus/join entirely — the actual
 * bug. `normalizeSubstitutedSignsForDisplay` is applied here, once, to the
 * FULLY ASSEMBLED string (armor term + bonus term + total), which is the
 * only point that sees every join that can produce a glued sign.
 *
 * @param armorTerm - The substituted armor expression (e.g. "3+2"), or the
 * raw DEX value as a string when unarmored (nothing to substitute).
 * @param bonus - The flat `defenseBonus`, already resolved to a number.
 * @param total - The final defense value the terms above must sum to.
 */
function formatDefenseBreakdown(
  armorTerm: string,
  bonus: number,
  total: number,
): string {
  const bonusTerm = bonus !== 0 ? formatModifier(bonus) : "";
  return normalizeSubstitutedSignsForDisplay(`${armorTerm}${bonusTerm} = ${total}`);
}

/**
 * Derives the character's current defense value, plus a human-readable
 * arithmetic breakdown of how it was reached.
 *
 * If an inventory item is equipped as armor (`character.defense.equippedItemId`
 * pointing at an item with `isArmor: true`), its formula is evaluated and
 * the flat `defenseBonus` is added on top. Otherwise, defense falls back to
 * DEX + the flat bonus (unarmored).
 *
 * @param character - The character to compute defense for.
 * @returns `value`: the resolved defense number. `error` is set when the
 * equipped armor's formula is broken — in that case `value` is *not* a
 * trustworthy defense number (just `defenseBonus` with no armor
 * contribution) and the caller must show that distinctly rather than
 * rendering it as if the character really has that little defense.
 * `breakdown`: readable arithmetic that sums to `value` (see
 * {@link formatDefenseBreakdown}) — variables substituted but not
 * collapsed to a single number, unlike `resolveFormulaDisplay`'s no-dice
 * branch, so the reader can see where each term came from instead of a
 * half-substituted formula string ("3 + DEX + -2 bonus"). Absent when
 * `error` is set — a broken armor formula has no trustworthy breakdown to
 * show either.
 */
export function computeDefense(character: NimbleCharacter): {
  value: number;
  error?: string;
  breakdown?: string;
} {
  const bonus = character.defense.defenseBonus ?? 0;
  const armorItem = character.inventory.find(
    (i) => i.id === character.defense.equippedItemId && i.isArmor,
  );

  if (armorItem?.formula) {
    const { value, error } = evalFormula(armorItem.formula, character);
    const total = value + bonus;
    if (error) return { value: total, error };
    // Safe to substitute without its own try/catch: evalFormula above
    // already ran this exact formula through the same substitution step
    // (as its first pipeline stage) without throwing, for the same
    // formula and context — substituteVariables is deterministic and has
    // no side effects, so it cannot fail here having already succeeded
    // there.
    const armorTerm = substituteVariables(
      armorItem.formula,
      buildContext(character),
    );
    return { value: total, breakdown: formatDefenseBreakdown(armorTerm, bonus, total) };
  }

  const total = character.stats.dex + bonus;
  return {
    value: total,
    breakdown: formatDefenseBreakdown(String(character.stats.dex), bonus, total),
  };
}
