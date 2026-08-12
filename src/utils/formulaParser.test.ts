/**
 * @file Unit tests for the safe formula evaluator.
 *
 * Focused on `formulaParser.ts` because it is pure (no OBR SDK dependency)
 * and security-sensitive: it hand-rolls a parser specifically to avoid
 * `eval()`, so the safety limits and grammar edge cases are worth locking
 * down with tests rather than relying on manual verification.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultCharacter, type NimbleCharacter } from "../types/character";
import {
  diceToAverage,
  evalFormula,
  parseDamageFormula,
  resolveFormulaDisplay,
  rollFormula,
  safeEval,
} from "./formulaParser";

function makeCharacter(overrides: Partial<NimbleCharacter> = {}): NimbleCharacter {
  const char = createDefaultCharacter("token-1", "owner-1");
  return {
    ...char,
    level: 5,
    stats: { str: 3, dex: 2, int: 1, wil: 0 },
    keyStat: "str",
    flawStat: "wil",
    skills: { ...char.skills, stealth: 4, might: 2 },
    hp: { current: 8, max: 12, temp: 0 },
    ...overrides,
  };
}

/**
 * Pins `Math.random` to a fixed sequence so `rollDie`/`rollDice` (which
 * compute `Math.floor(Math.random() * sides) + 1`) produce exactly `values`,
 * in order, for dice of size `sides`. Mocking at this level (rather than
 * `rollDice` itself) is necessary because `rollFormula`'s internal call to
 * `rollDice` is a same-module reference that `vi.spyOn` cannot intercept.
 */
function mockRolls(values: number[], sides: number) {
  const seq = values.map((v) => (v - 1) / sides);
  let i = 0;
  return vi.spyOn(Math, "random").mockImplementation(() => seq[i++]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safeEval", () => {
  it("evaluates basic arithmetic with correct precedence", () => {
    expect(safeEval("2 + 3 * 4")).toBe(14);
    expect(safeEval("(2 + 3) * 4")).toBe(20);
    expect(safeEval("10 / 4")).toBe(2.5);
  });

  it("treats division by zero as zero instead of Infinity/NaN", () => {
    expect(safeEval("5 / 0")).toBe(0);
  });

  it("supports floor/ceil/min/max helpers", () => {
    expect(safeEval("floor(7 / 2)")).toBe(3);
    expect(safeEval("ceil(7 / 2)")).toBe(4);
    expect(safeEval("min(3, 8)")).toBe(3);
    expect(safeEval("max(3, 8)")).toBe(8);
  });

  it("never executes unknown identifiers, just resolves them to 0", () => {
    // "alert(1)" only contains letters/digits/parens, all of which pass the
    // character whitelist — safety here comes from the parser never
    // recognizing "alert(" as a known token, not from the whitelist.
    expect(safeEval("alert(1)")).toBe(0);
  });

  it("rejects input containing disallowed characters", () => {
    expect(safeEval("1; console.log(1)")).toBeNaN();
  });
});

describe("evalFormula", () => {
  it("substitutes stats, key, flaw, level, skills and HP", () => {
    const char = makeCharacter();
    expect(evalFormula("STR", char)).toBe(3);
    expect(evalFormula("KEY", char)).toBe(3); // keyStat = str
    expect(evalFormula("FLAW", char)).toBe(0); // flawStat = wil
    expect(evalFormula("LEVEL", char)).toBe(5);
    expect(evalFormula("STEALTH", char)).toBe(4);
    expect(evalFormula("HP", char)).toBe(8);
    expect(evalFormula("MAXHP", char)).toBe(12);
  });

  it("is case-insensitive on variable names", () => {
    const char = makeCharacter();
    expect(evalFormula("str + dex", char)).toBe(5);
  });

  it("averages dice notation instead of rolling", () => {
    const char = makeCharacter();
    // 1d8 averages to round(1 * (1+8)/2) = 5
    expect(evalFormula("1d8", char)).toBe(5);
    expect(evalFormula("1d8 + STR", char)).toBe(8);
  });

  it("resolves incrementdice/stepdice helpers before averaging", () => {
    const char = makeCharacter({ level: 10 });
    // incrementdice(1, 10) -> 1 + floor(10/5) = 3 dice of d6 -> avg round(3*3.5)=11
    expect(evalFormula("incrementdice(1,10)d6", char)).toBe(11);
  });

  it("returns 0 and records an error for an over-length formula", () => {
    const char = makeCharacter();
    const longFormula = "1+".repeat(150) + "1";
    expect(evalFormula(longFormula, char)).toBe(0);
  });

  it("returns 0 for dice counts/sides beyond the safety limits", () => {
    const char = makeCharacter();
    expect(evalFormula("101d6", char)).toBe(0);
    expect(evalFormula("1d1001", char)).toBe(0);
  });
});

describe("parseDamageFormula", () => {
  it("splits leading dice notation from the modifier", () => {
    const char = makeCharacter();
    const ctx = {
      level: char.level,
      stats: char.stats,
      key: char.stats.str,
      flaw: char.stats.wil,
      skills: char.skills,
      hp: char.hp.current,
      maxHp: char.hp.max,
    };
    const result = parseDamageFormula("1d8+STR+2", ctx);
    expect(result.diceNotation).toBe("1d8");
    expect(result.modifier).toBe(5); // STR(3) + 2
  });

  it("treats a formula with no dice as a pure modifier", () => {
    const char = makeCharacter();
    const ctx = {
      level: char.level,
      stats: char.stats,
      key: char.stats.str,
      flaw: char.stats.wil,
      skills: char.skills,
    };
    const result = parseDamageFormula("STR + 2", ctx);
    expect(result.diceNotation).toBe("");
    expect(result.modifier).toBe(5);
  });
});

describe("resolveFormulaDisplay", () => {
  it("keeps dice notation but resolves the modifier", () => {
    const char = makeCharacter();
    expect(resolveFormulaDisplay("1d8 + STR + 2", char)).toBe("1d8+5");
  });

  it("omits a zero modifier", () => {
    const char = makeCharacter({ stats: { str: 0, dex: 0, int: 0, wil: 0 } });
    expect(resolveFormulaDisplay("1d8 + STR", char)).toBe("1d8");
  });

  it("resolves to a plain number when there is no dice notation", () => {
    const char = makeCharacter();
    expect(resolveFormulaDisplay("STR + 2", char)).toBe("5");
  });
});

describe("diceToAverage", () => {
  it("replaces NdX with its rounded average", () => {
    expect(diceToAverage("2d6")).toBe("7"); // round(2 * 3.5) = 7
  });

  it("throws a FormulaError for dice beyond the safety limits", () => {
    expect(() => diceToAverage("101d6")).toThrow();
    expect(() => diceToAverage("1d1001")).toThrow();
  });
});

describe("rollFormula", () => {
  it("rolls the correct number of dice and sums with the modifier", () => {
    const char = makeCharacter();
    const result = rollFormula("2d6+STR", char);
    expect(result.rolls).toHaveLength(2);
    expect(result.kept).toHaveLength(2);
    result.rolls.forEach((r) => {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    });
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(result.kept.reduce((a, b) => a + b, 0) + 3);
  });

  it("returns modifier-only result with no dice when formula is flat", () => {
    const char = makeCharacter();
    const result = rollFormula("STR + 2", char);
    expect(result.diceNotation).toBe("");
    expect(result.rolls).toEqual([]);
    expect(result.total).toBe(5);
  });

  it("keeps the highest dice on advantage", () => {
    const char = makeCharacter();
    const result = rollFormula("1d20", char, "advantage", 1);
    expect(result.rolls).toHaveLength(2);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]).toBe(Math.max(...result.rolls));
  });

  it("keeps the lowest dice on disadvantage", () => {
    const char = makeCharacter();
    const result = rollFormula("1d20", char, "disadvantage", 1);
    expect(result.rolls).toHaveLength(2);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]).toBe(Math.min(...result.rolls));
  });

  it("flags a critical when the kept die shows its max face", () => {
    const char = makeCharacter();
    // Run many times; with 1d1 every roll is forced to be the max face.
    const result = rollFormula("1d1", char);
    expect(result.isCritical).toBe(true);
    expect(result.isFumble).toBe(true); // 1 is also the min face on a d1
  });
});

describe("rollFormula (pinned rolls via mocked Math.random)", () => {
  // Deterministic regression coverage for the disadvantage-was-keeping-
  // highest bug: each case pins an exact, otherwise-improbable roll
  // combination instead of relying on Math.max/min over real random rolls.
  it("keeps the lowest die on disadvantage", () => {
    mockRolls([2, 17], 20);
    const char = makeCharacter();
    const result = rollFormula("1d20", char, "disadvantage", 1);
    expect(result.kept).toEqual([2]);
  });

  it("keeps the highest die on advantage", () => {
    mockRolls([2, 17], 20);
    const char = makeCharacter();
    const result = rollFormula("1d20", char, "advantage", 1);
    expect(result.kept).toEqual([17]);
  });

  it("ignores extraDice in standard mode and only rolls the base count", () => {
    const spy = mockRolls([10], 20);
    const char = makeCharacter();
    const result = rollFormula("1d20", char, "standard", 3);
    expect(result.rolls).toHaveLength(1);
    // Guards against a regression where extra dice are requested even in
    // standard mode: if rollDice asked Math.random for more than the one
    // pinned value, this would fail rather than silently reading undefined.
    expect(spy.mock.calls.length).toBe(1);
  });

  it("fumbles but does not crit on disadvantage when rolls are [1, 20]", () => {
    mockRolls([1, 20], 20);
    const char = makeCharacter();
    const result = rollFormula("1d20", char, "disadvantage", 1);
    expect(result.isFumble).toBe(true);
    expect(result.isCritical).toBe(false);
  });

  it("crits but does not fumble on advantage when rolls are [1, 20]", () => {
    mockRolls([1, 20], 20);
    const char = makeCharacter();
    const result = rollFormula("1d20", char, "advantage", 1);
    expect(result.isCritical).toBe(true);
    expect(result.isFumble).toBe(false);
  });
});
