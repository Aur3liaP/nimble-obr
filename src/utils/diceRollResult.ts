/**
 * @file Single choke point for turning a {@link RollFormulaResult} (the
 * pure, OBR-free output of `formulaParser.ts`'s roll functions) into a
 * {@link DiceRollResult} (the broadcast/persisted shape, carrying who
 * rolled it, when, and under what label/formula/hidden flag).
 *
 * Extracted out of `useOBR.ts`'s `handleRoll`/`handleFreeRoll` specifically
 * so both call sites share ONE construction instead of two independently
 * hand-written object literals that could silently drift apart — the exact
 * failure mode `droppedIndices` (1.3.1) and `multiplier` (1.6.0) both had
 * to be manually re-verified against, since both are OPTIONAL fields on
 * `DiceRollResult` that only propagate correctly if every construction
 * site actually spreads the full `RollFormulaResult` rather than picking
 * fields by hand. A pure function here means that propagation is provable
 * by a plain unit test (see `diceRollResult.test.ts`) instead of only by a
 * real roll in OBR, which is what caught the 1.3.1 gap.
 */

import type { RollFormulaResult } from "./formulaParser";
import type { DiceRollResult } from "../types/character";

/** Request-derived metadata a {@link RollFormulaResult} doesn't itself carry. */
export interface DiceRollResultMeta {
  label: string;
  formula: string;
  playerId: string;
  playerName: string;
  hidden: boolean;
}

/**
 * Builds the {@link DiceRollResult} broadcast to (or, for a hidden roll,
 * kept local to) the table, from a resolved {@link RollFormulaResult} plus
 * the requesting player's identity and the original request's label/
 * formula/hidden flag.
 *
 * The `...rolled` spread is deliberate and load-bearing: it's what makes
 * every field `RollFormulaResult` carries — including one added after this
 * function was last touched, e.g. `multiplier` in 1.6.0 — reach
 * `DiceRollResult` automatically, with no matching edit required here.
 * Both `handleRoll` and `handleFreeRoll` in `useOBR.ts` call this rather
 * than building their own object literal.
 *
 * @param rolled - The resolved roll (from `rollFormula`/`rollFormulaWithContext`).
 * @param meta - Everything the roll formula/dice engine itself doesn't know:
 * the request's label/formula text, who rolled it, and whether it's hidden.
 * @param timestamp - Defaults to `Date.now()`; overridable so callers (tests)
 * can pin a deterministic value instead of mocking the global clock.
 */
export function buildDiceRollResult(
  rolled: RollFormulaResult,
  meta: DiceRollResultMeta,
  timestamp: number = Date.now(),
): DiceRollResult {
  return {
    ...rolled,
    label: meta.label,
    formula: meta.formula,
    playerId: meta.playerId,
    playerName: meta.playerName,
    timestamp,
    hidden: meta.hidden,
  };
}
