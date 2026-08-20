/**
 * @file Pure conversion from an initiative roll result to the number of
 * actions granted on the first combat turn.
 *
 * Extracted out of `CombatTab.tsx` so it's directly unit-testable without a
 * React/OBR dependency, same discipline as `formulaParser.ts` and
 * `characterMigrations.ts`.
 */

/**
 * Converts an initiative roll into the number of actions available on the
 * first combat turn, per Nimble Core Rules 2nd printing (p.15): a
 * single-digit result grants 1 action, two digits grant 2, and a result of
 * 20+ (or a natural 20) grants all 3.
 *
 * @param total - The resolved initiative roll total (dice + modifiers).
 * @param naturalRoll - The kept d20 face itself, after advantage/
 * disadvantage resolution (not the raw first die rolled — with advantage,
 * this is whichever of the 2d20 was kept). A natural 20 always grants 3
 * actions even if `initiativeBonus`/DEX are negative enough to bring
 * `total` below 20.
 * @returns The number of actions (1-3) granted for the first turn.
 */
export function initiativeToActions(total: number, naturalRoll: number): number {
  if (total >= 20 || naturalRoll === 20) return 3;
  if (total >= 10) return 2;
  return 1;
}
