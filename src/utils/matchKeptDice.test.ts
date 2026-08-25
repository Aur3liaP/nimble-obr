/**
 * @file Unit tests for {@link matchKeptDice} (the value-based fallback)
 * and {@link resolveKeptFlags} (the real entry point `RollLog` calls),
 * behind `RollLog`'s kept/dropped die highlighting.
 */

import { describe, expect, it } from "vitest";
import { matchKeptDice, resolveKeptFlags } from "./matchKeptDice";

describe("matchKeptDice", () => {
  it("marks all rolls as kept when nothing was eliminated", () => {
    expect(matchKeptDice([3, 5], [3, 5])).toEqual([true, true]);
  });

  it("marks the eliminated die as dropped, no duplicates involved", () => {
    // 2d6 advantage 1: rolls [4, 6, 2], the 2 (last) is eliminated.
    expect(matchKeptDice([4, 6, 2], [4, 6])).toEqual([true, true, false]);
  });

  it("correctly attributes a duplicate value to the die that actually survived (disadvantage keeps the LATER tied die)", () => {
    // 2d6 disadvantage 1: rolls [6, 1, 6], the FIRST 6 (index 0) is
    // eliminated per the leftmost-on-a-tie rule, so the SECOND 6
    // (index 2) is the one that's kept.
    expect(matchKeptDice([6, 1, 6], [1, 6])).toEqual([false, true, true]);
  });

  it("correctly attributes a duplicate value the other way round (advantage keeps the LATER tied die)", () => {
    // 2d6 advantage 1: rolls [1, 6, 1], the FIRST 1 (index 0) is
    // eliminated, so the SECOND 1 (index 2) is the one that's kept.
    expect(matchKeptDice([1, 6, 1], [6, 1])).toEqual([false, true, true]);
  });

  it("handles two eliminations out of four rolls, with a 3-way tie among them", () => {
    // 2d6 disadvantage 2: rolls [6, 6, 2, 6], kept [2, 6] — only the
    // LAST rolled 6 (index 3) survives; the two earlier 6s (indices 0, 1)
    // are both eliminated.
    expect(matchKeptDice([6, 6, 2, 6], [2, 6])).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  describe("mutation guard: matching by value alone (searching kept for each rolled value) mislabels duplicates", () => {
    it("regression: a value-search match would credit the FIRST-rolled die of a tie as kept, not the one that actually survived", () => {
      // Same setup as the disadvantage-tie test above. A value-search
      // implementation (searching `kept` for each rolled value and
      // consuming it on a match) finds rolls[0]'s "6" inside `kept`
      // first (kept still contains a 6 at this point, even though it's
      // really index 2's 6, not index 0's) and wrongly marks index 0 as
      // kept instead of index 2.
      const result = matchKeptDice([6, 1, 6], [1, 6]);
      expect(result).not.toEqual([true, true, false]);
      expect(result).toEqual([false, true, true]);
    });
  });

  describe("known limitation: cannot distinguish which of two LEADING duplicate values survived", () => {
    it("[5, 5, 3] disadvantage 1 actually drops index 0, but this value-only fallback guesses index 1 instead", () => {
      // Pinned deliberately, not a bug to fix here: `kept` alone ([5, 3])
      // is consistent with EITHER index 0 or index 1 being the one
      // eliminated — both are real 5s. This function has no way to know
      // which one it really was; that's exactly why `droppedIndices` (and
      // resolveKeptFlags, which prefers it) exists. See this file's
      // header.
      expect(matchKeptDice([5, 5, 3], [5, 3])).toEqual([true, false, true]);
    });
  });
});

describe("resolveKeptFlags", () => {
  it("with droppedIndices present, resolves the [5, 5, 3] duplicate case EXACTLY — unlike the value-only fallback above", () => {
    // Same rolls/kept as the "known limitation" test above, but this
    // time with the real droppedIndices ([0], from rollFormula's own
    // elimination — see formulaParser.test.ts's matching case). The
    // correct answer, unreachable from values alone, is now exact.
    expect(resolveKeptFlags([5, 5, 3], [5, 3], [0])).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("with droppedIndices present, resolves the real bug-report case ([6, 1, 6] disadvantage) exactly", () => {
    expect(resolveKeptFlags([6, 1, 6], [1, 6], [0])).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("falls back to matchKeptDice, without throwing, for a log entry with no droppedIndices", () => {
    expect(resolveKeptFlags([4, 6, 2], [4, 6], undefined)).toEqual([
      true,
      true,
      false,
    ]);
  });

  describe("mutation guard: droppedIndices must be read directly, not re-derived by value/sort", () => {
    it("regression: falling back to the value-only reconstruction even when droppedIndices is available reproduces the [5, 5, 3] bug report", () => {
      // Simulates a resolveKeptFlags that ignored the (available)
      // droppedIndices and always went through the approximate,
      // value-based path instead — exactly the class of bug just fixed.
      // The correct call (droppedIndices provided) and the buggy one
      // (droppedIndices withheld, forcing the fallback) must disagree on
      // this exact input.
      const correct = resolveKeptFlags([5, 5, 3], [5, 3], [0]);
      const ignoringDroppedIndices = resolveKeptFlags([5, 5, 3], [5, 3], undefined);
      expect(correct).toEqual([false, true, true]);
      expect(ignoringDroppedIndices).not.toEqual(correct);
    });
  });
});
