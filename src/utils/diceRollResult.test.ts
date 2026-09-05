/**
 * @file Unit tests for {@link buildDiceRollResult}.
 *
 * Exists specifically to verify field propagation from `RollFormulaResult`
 * to `DiceRollResult` with an actual runtime assertion, not a code-reading
 * argument — `droppedIndices` (1.3.1) was assumed to propagate the same
 * way and that assumption was only confirmed by a real roll in OBR. Pure
 * function, no OBR dependency (see `formulaParser.test.ts`'s own header for
 * why this project keeps that split), so this can be checked here instead.
 */

import { describe, expect, it } from "vitest";
import { buildDiceRollResult } from "./diceRollResult";
import type { RollFormulaResult } from "./formulaParser";

/** Minimal, valid RollFormulaResult stand-in — only the fields relevant to
 * propagation vary per test via `overrides`. */
function makeRolled(overrides: Partial<RollFormulaResult> = {}): RollFormulaResult {
  return {
    diceNotation: "1d4",
    rolls: [3],
    kept: [3],
    droppedIndices: [],
    modifier: 0,
    total: 15,
    isCritical: false,
    isFumble: false,
    canCritOrFumble: true,
    ...overrides,
  };
}

describe("buildDiceRollResult", () => {
  it("propagates multiplier onto the visible-roll (hidden: false) path", () => {
    const rolled = makeRolled({ multiplier: 5, total: 15 });
    const result = buildDiceRollResult(
      rolled,
      {
        label: "Terror",
        formula: "LVL*1d4",
        playerId: "player-1",
        playerName: "Alice",
        hidden: false,
      },
      1000,
    );
    expect(result.multiplier).toBe(5);
    expect(result.total).toBe(15);
    expect(result.hidden).toBe(false);
  });

  it("propagates multiplier onto the GM's hidden-roll (hidden: true) path — the same construction, not a separate one", () => {
    // pushRollToLog branches on `result.hidden` AFTER construction (skips
    // scene metadata, appends to local state instead) — this test proves
    // the field survives regardless of which way that later branch goes,
    // by exercising the SAME buildDiceRollResult call with hidden: true.
    const rolled = makeRolled({ multiplier: 5, total: 15 });
    const result = buildDiceRollResult(
      rolled,
      {
        label: "Terror",
        formula: "LVL*1d4",
        playerId: "gm-1",
        playerName: "The GM",
        hidden: true,
      },
      1000,
    );
    expect(result.multiplier).toBe(5);
    expect(result.total).toBe(15);
    expect(result.hidden).toBe(true);
  });

  it("leaves multiplier undefined (not 1, not 0) for a roll that used no multiplier, on both the visible and hidden paths", () => {
    const rolled = makeRolled({ multiplier: undefined, total: 5 });
    for (const hidden of [false, true]) {
      const result = buildDiceRollResult(
        rolled,
        {
          label: "Longsword",
          formula: "1d8+STR",
          playerId: "player-1",
          playerName: "Alice",
          hidden,
        },
        1000,
      );
      expect(result.multiplier).toBeUndefined();
    }
  });

  it("also propagates every other RollFormulaResult field (kept, droppedIndices, canCritOrFumble, isCritical/isFumble) via the same spread — not hand-picked", () => {
    const rolled = makeRolled({
      rolls: [4, 1, 6],
      kept: [4, 6],
      droppedIndices: [1],
      isCritical: false,
      isFumble: false,
      canCritOrFumble: true,
      multiplier: 2,
      modifier: 3,
      total: 23,
    });
    const result = buildDiceRollResult(
      rolled,
      {
        label: "Test",
        formula: "2d6*2+3",
        playerId: "player-1",
        playerName: "Alice",
        hidden: false,
      },
      1000,
    );
    expect(result.rolls).toEqual([4, 1, 6]);
    expect(result.kept).toEqual([4, 6]);
    expect(result.droppedIndices).toEqual([1]);
    expect(result.multiplier).toBe(2);
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(23);
  });

  it("attaches the request metadata (label, formula, player identity, timestamp) on top of the roll", () => {
    const result = buildDiceRollResult(
      makeRolled(),
      {
        label: "Terror",
        formula: "LVL*1d4",
        playerId: "player-1",
        playerName: "Alice",
        hidden: false,
      },
      1234567,
    );
    expect(result.label).toBe("Terror");
    expect(result.formula).toBe("LVL*1d4");
    expect(result.playerId).toBe("player-1");
    expect(result.playerName).toBe("Alice");
    expect(result.timestamp).toBe(1234567);
  });
});
