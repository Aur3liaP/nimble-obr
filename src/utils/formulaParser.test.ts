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
  buildContext,
  diceToAverage,
  evalFormula,
  parseDamageFormula,
  resolveFormulaDisplay,
  rollFormula,
  safeEval,
  validateFormula,
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

  it("throws when dice count exceeds the safety limit", () => {
    const ctx = buildContext(makeCharacter());
    expect(() => parseDamageFormula("101d6", ctx)).toThrow();
  });

  it("throws when dice sides exceed the safety limit", () => {
    const ctx = buildContext(makeCharacter());
    expect(() => parseDamageFormula("1d1001", ctx)).toThrow();
  });

  it("throws when incrementdice resolves to a dice count beyond the safety limit", () => {
    const ctx = buildContext(makeCharacter({ level: 500 }));
    // incrementdice(1, LEVEL) -> 1 + floor(500/5) = 101 dice, over MAX_DICE_COUNT
    expect(() =>
      parseDamageFormula("incrementdice(1,LEVEL)d6", ctx),
    ).toThrow();
  });

  it("throws when stepdice resolves to a die size beyond the safety limit", () => {
    const ctx = buildContext(makeCharacter({ level: 20 }));
    // level >= 15 picks the 4th die size; 1001 is over MAX_DICE_SIDES
    expect(() =>
      parseDamageFormula("1dstepdice(LEVEL,4,6,8,1001)", ctx),
    ).toThrow();
  });

  it("does not throw for dice count/sides exactly at the safety limit", () => {
    const ctx = buildContext(makeCharacter());
    expect(parseDamageFormula("100d6", ctx).diceNotation).toBe("100d6");
    expect(parseDamageFormula("1d1000", ctx).diceNotation).toBe("1d1000");
  });
});

describe("resolveFormulaDisplay", () => {
  it("keeps dice notation but resolves the modifier", () => {
    const char = makeCharacter();
    expect(resolveFormulaDisplay("1d8 + STR + 2", char).display).toBe(
      "1d8+5",
    );
  });

  it("omits a zero modifier", () => {
    const char = makeCharacter({ stats: { str: 0, dex: 0, int: 0, wil: 0 } });
    expect(resolveFormulaDisplay("1d8 + STR", char).display).toBe("1d8");
  });

  it("resolves to a plain number when there is no dice notation", () => {
    const char = makeCharacter();
    expect(resolveFormulaDisplay("STR + 2", char).display).toBe("5");
  });

  it("falls back to the raw formula and reports an error instead of crashing the row, for a formula already stored beyond the safety limit", () => {
    // Simulates a scene that already has an oversized formula persisted on
    // an action/spell/item (e.g. saved before write-time validation existed,
    // or edited directly in metadata) — rendering that row must degrade
    // gracefully rather than throw during render.
    const char = makeCharacter();
    const result = resolveFormulaDisplay("101d6", char);
    expect(result.display).toBe("101d6");
    expect(result.error).toMatch(/out of range/i);
  });

  it("rethrows anything that isn't a FormulaError instead of masking it as an invalid formula", () => {
    const char = makeCharacter();
    // A non-string formula reaching substituteVariables (e.g. corrupted
    // metadata) throws a plain TypeError, not a FormulaError — a genuine
    // bug that must keep its stack instead of being reported to the user
    // as "invalid formula" like a safety-limit violation would be.
    const notAString = null as unknown as string;
    expect(() => resolveFormulaDisplay(notAString, char)).toThrow(TypeError);
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
    // With 1d1 every roll is forced to be the max face.
    const result = rollFormula("1d1", char);
    expect(result.isCritical).toBe(true);
    expect(result.isFumble).toBe(true); // 1 is also the min face on a d1
  });

  it("rejects a dice count over the safety limit instead of rolling it", () => {
    const char = makeCharacter();
    const result = rollFormula("101d6", char);
    expect(result.rolls).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.error).toMatch(/out of range/i);
  });

  it("rejects dice sides over the safety limit instead of rolling them", () => {
    const char = makeCharacter();
    const result = rollFormula("1d1001", char);
    expect(result.rolls).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.error).toMatch(/out of range/i);
  });

  it("rejects dynamically-resolved dice (incrementdice) that exceed the safety limit, instead of freezing on a huge roll", () => {
    const char = makeCharacter({ level: 500 });
    // incrementdice(1, LEVEL) -> 1 + floor(500/5) = 101 dice, over MAX_DICE_COUNT.
    // This is the exact DoS shape the fix closes: a dynamic formula that
    // only becomes oversized after resolution, previously never checked
    // on the rollFormula path (only on the diceToAverage display path).
    const result = rollFormula("incrementdice(1,LEVEL)d6", char);
    expect(result.rolls).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.error).toMatch(/out of range/i);
  });

  it("still rolls dynamically-resolved dice exactly at the safety limit", () => {
    const char = makeCharacter({ level: 495 });
    // incrementdice(1, LEVEL) -> 1 + floor(495/5) = 100 dice, exactly at MAX_DICE_COUNT.
    const result = rollFormula("incrementdice(1,LEVEL)d6", char);
    expect(result.rolls).toHaveLength(100);
    expect(result.error).toBeUndefined();
  });

  it("rejects a formula where only the second of two dice tokens exceeds the limit", () => {
    // parseDamageFormula only ever extracts the *leading* NdX as the roll's
    // diceNotation, but the choke point in resolveDynamicDice scans every
    // NdX token in the formula, not just the leading one — this proves a
    // limit violation buried past the first token isn't missed.
    const char = makeCharacter();
    const result = rollFormula("2d6 + 101d6", char);
    expect(result.rolls).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.error).toMatch(/out of range/i);
  });

  it("leaves a well-formed multi-token formula alone when both tokens are within the limit", () => {
    const char = makeCharacter();
    const result = rollFormula("2d6 + 3d4", char);
    expect(result.diceNotation).toBe("2d6"); // leading token only, by design
    expect(result.error).toBeUndefined();
  });

  it("only reaches modest dice counts/sides for a legal max-level character on the project's real dynamic-dice spells, nowhere near the safety limits", () => {
    // Level 20 is the highest level this app's UI lets a player reach
    // (no MAX_LEVEL constant enforces this in code — flagged separately).
    // These are real formulas from src/data/spells.ts, not synthetic ones.
    const char = makeCharacter({ level: 20 });

    // Shadow Blast: "incrementdice(1,level)d12+KEY" -> 1 + floor(20/5) = 5 dice of d12.
    const shadowBlast = rollFormula("incrementdice(1,level)d12+KEY", char);
    expect(shadowBlast.rolls).toHaveLength(5);
    expect(shadowBlast.error).toBeUndefined();

    // Entice: "1dstepdice(level,4,8,10,12)" -> level >= 15 picks the d12 tier.
    const entice = rollFormula("1dstepdice(level,4,8,10,12)", char);
    expect(entice.rolls).toHaveLength(1);
    entice.rolls.forEach((r) => expect(r).toBeLessThanOrEqual(12));
    expect(entice.error).toBeUndefined();

    // 5 dice and d12 sides are nowhere near MAX_DICE_COUNT (100) or
    // MAX_DICE_SIDES (1000): the margin is roughly 20x on count and 80x on
    // sides. These limits protect against a hand-typed/malicious custom
    // formula, not against anything a legally-built level-20 character's
    // real spell list can produce.
  });
});

describe("validateFormula (write-time safety gate)", () => {
  it("does not throw for a well-formed formula within all limits", () => {
    const ctx = buildContext(makeCharacter());
    expect(() => validateFormula("1d8 + STR + 2", ctx)).not.toThrow();
  });

  it("throws for dice count/sides beyond the safety limits", () => {
    const ctx = buildContext(makeCharacter());
    expect(() => validateFormula("101d6", ctx)).toThrow();
    expect(() => validateFormula("1d1001", ctx)).toThrow();
  });

  it("throws for dynamically-resolved dice beyond the safety limits", () => {
    const ctx = buildContext(makeCharacter({ level: 500 }));
    expect(() => validateFormula("incrementdice(1,LEVEL)d6", ctx)).toThrow();
  });

  it("throws for an over-length formula", () => {
    const ctx = buildContext(makeCharacter());
    expect(() => validateFormula("1+".repeat(150) + "1", ctx)).toThrow();
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
    const char = makeCharacter();
    mockRolls([1, 20], 20);
    const result = rollFormula("1d20", char, "disadvantage", 1);
    expect(result.isFumble).toBe(true);
    expect(result.isCritical).toBe(false);
  });

  it("crits but does not fumble on advantage when rolls are [1, 20]", () => {
    const char = makeCharacter();
    mockRolls([1, 20], 20);
    const result = rollFormula("1d20", char, "advantage", 1);
    expect(result.isCritical).toBe(true);
    expect(result.isFumble).toBe(false);
  });

  it("keeps the top 2 of 3 on a multi-dice advantage roll, crit off the highest", () => {
    // 2d6 in advantage with one bonus die: kept[0] is the highest of the
    // pool (not just of the base count), which is the intentional Nimble
    // primary-die rule documented on rollFormula's isCritical/isFumble.
    const char = makeCharacter();
    mockRolls([6, 2, 4], 6);
    const result = rollFormula("2d6", char, "advantage", 1);
    expect(result.kept).toEqual([6, 4]);
    expect(result.isCritical).toBe(true);
  });
});
