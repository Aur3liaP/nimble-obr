/**
 * @file matchKeptDice — best-effort reconstruction, from VALUES alone, of
 * which rolled die survived advantage/disadvantage elimination.
 *
 * FALLBACK ONLY. The authoritative source is
 * `RollFormulaResult.droppedIndices` (`formulaParser.ts`), carried through
 * onto `DiceRollResult` and read directly by `RollLog` — that field names
 * the eliminated die by INDEX, straight from the elimination algorithm
 * itself, so there is nothing to reconstruct once it's present. This
 * function exists only because a roll-log entry already sitting in scene
 * metadata from before `droppedIndices` existed doesn't have it (the
 * field is optional precisely for that reason — see its own doc); `RollLog`
 * falls back to this for such an entry until the shared log's 20-entry cap
 * evicts it. No migration backfills old entries.
 *
 * APPROXIMATE ON DUPLICATE VALUES, unavoidably — a two-pointer walk over
 * `rolls`/`kept` finds *a* left-to-right subsequence alignment, but when a
 * duplicate value straddles the kept/dropped boundary, more than one
 * alignment is numerically valid and there's no way to tell from values
 * alone which one actually happened. E.g. disadvantage on rolls
 * `[5, 5, 3]` (kept `[5, 3]`) really eliminates index 0, but this function
 * has no way to distinguish that from eliminating index 1 — both produce
 * the same `kept` array — so it picks the first alignment it finds
 * left-to-right, which is not always the correct one. This is a known,
 * accepted limitation of the fallback path only; it does not apply to
 * `droppedIndices`, which is exact because it comes from the elimination
 * itself rather than being guessed afterward from values.
 */

/**
 * @param rolls - Every die rolled, in original roll order.
 * @param kept - The surviving dice, in the same relative order they were
 * rolled in (a subsequence of `rolls` by position, never re-sorted).
 * @returns One boolean per entry of `rolls`, in the same order, `true`
 * where that die is guessed to have survived. See this file's header for
 * why "guessed" — exact only when no duplicate value straddles the
 * kept/dropped boundary.
 */
export function matchKeptDice(rolls: number[], kept: number[]): boolean[] {
  let nextKeptIndex = 0;
  return rolls.map((v) => {
    if (nextKeptIndex < kept.length && kept[nextKeptIndex] === v) {
      nextKeptIndex++;
      return true;
    }
    return false;
  });
}

/**
 * Resolves, for every rolled die, whether it survived — the single
 * decision `RollLog` renders from. Reads `droppedIndices` directly (exact,
 * by index — the whole point of that field, see its own doc on
 * `DiceRollResult`) whenever it's present; only calls the approximate,
 * value-based {@link matchKeptDice} as a fallback for a roll-log entry
 * that predates that field. Deliberately does not itself re-derive
 * eliminated dice from `rolls`/`kept` in any other way (by sorting, by
 * value, or otherwise) — the elimination rule lives in exactly one place
 * (`rollFormulaWithContext` in `formulaParser.ts`); duplicating any part
 * of it here would be the same "hand-copied logic drifts apart" mistake
 * CLAUDE.md already warns about elsewhere in this codebase.
 *
 * @param rolls - Every die rolled, in original roll order.
 * @param kept - The surviving dice (see {@link matchKeptDice}'s doc).
 * @param droppedIndices - Index into `rolls` of every eliminated die, from
 * `DiceRollResult.droppedIndices` — `undefined` for a pre-existing log
 * entry that predates the field.
 */
export function resolveKeptFlags(
  rolls: number[],
  kept: number[],
  droppedIndices: number[] | undefined,
): boolean[] {
  if (droppedIndices) {
    const dropped = new Set(droppedIndices);
    return rolls.map((_, i) => !dropped.has(i));
  }
  return matchKeptDice(rolls, kept);
}
