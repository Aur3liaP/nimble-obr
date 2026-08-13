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
import { BASE_SPELLS } from "../data/spells";
import { BASIC_EQUIPMENTS } from "../data/equipment";
import {
  buildContext,
  diceToAverage,
  evalFormula,
  FormulaError,
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

  it("never executes unknown identifiers — rejects them with a FormulaError instead of silently resolving to 0", () => {
    // "alert(1)" only contains letters/digits/parens, all of which pass the
    // character whitelist — safety here comes from the parser never
    // recognizing "alert(" as a known token, not from the whitelist. It
    // used to silently fall back to 0 for this; that's exactly the kind of
    // silent failure this app can't afford for a formula rolled to a table,
    // so an unrecognized token is now a thrown FormulaError instead.
    expect(() => safeEval("alert(1)")).toThrow(FormulaError);
  });

  it("rejects input containing disallowed characters", () => {
    expect(safeEval("1; console.log(1)")).toBeNaN();
  });

  it("treats a leading unary '+' as a no-op, same as no sign at all", () => {
    // Regression guard: before parsePrimary threw on unknown tokens, a
    // leading '+' only "worked" because parsePrimary silently returned 0
    // for the unrecognized '+' and parseExpr's own '+' handling patched
    // over it. Real formulas depend on this shape — e.g. armor items in
    // src/data/equipment.ts store flat bonuses as a bare "+8", and
    // parseDamageFormula feeds a leading-'+' modifier tail (e.g. "+3+2")
    // to safeEval for any "NdX+STR+2"-style formula. This must keep
    // working now that unary '+' is handled explicitly instead of by
    // accident.
    expect(safeEval("+2")).toBe(2);
    expect(safeEval("+3+2")).toBe(5);
    expect(safeEval("8")).toBe(safeEval("+8"));
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

  it("still returns 0 (not a thrown error) for a typo'd/unrecognized variable — the remaining silent-failure gap", () => {
    // "LVL" instead of "LEVEL" is an actual bug in src/data/spells.ts
    // ("Tooth & Claw (Dragonform)": formula "1d20+LVL"). The parser now
    // raises a FormulaError for the unrecognized "LVL" token internally
    // (see the Parser tests), but evalFormulaWithContext's contract is a
    // plain `number`, so it still catches FormulaError and returns 0 —
    // same as before, just via an explicit catch instead of an accidental
    // fallback. Any UI feeding evalFormula's return straight into a
    // displayed stat (e.g. CombatTab's computeDefense, which evaluates an
    // equipped armor's formula) still can't tell "legitimately 0" apart
    // from "formula is broken" without a return-shape change, which is
    // out of scope here — flagged, not fixed, in this batch.
    const char = makeCharacter();
    expect(evalFormula("1d20+LVL", char)).toBe(0);
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

  it("rejects a second dice token in the modifier position instead of silently dropping it", () => {
    // Only the *leading* NdX is ever treated as real, rollable dice notation
    // (parseDamageFormula's diceNotation) — "3d4" here lands in the flat
    // modifier text, which is arithmetic-only. Before the parser required
    // full input consumption, "3d4" silently parsed as just "3" with "d4"
    // dropped, so this formula looked "well-formed" (modifier 3, no error)
    // while quietly discarding half of what was typed. It must now fail
    // loudly instead.
    const char = makeCharacter();
    const result = rollFormula("2d6 + 3d4", char);
    expect(result.rolls).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.error).toMatch(/trailing input/i);
  });

  it("rolls a leading dice token normally when the rest of the formula is plain arithmetic", () => {
    const char = makeCharacter();
    const result = rollFormula("2d6 + 3 + 4", char);
    expect(result.diceNotation).toBe("2d6");
    expect(result.modifier).toBe(7);
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

describe("resolveDynamicDice parity fixes (point 3)", () => {
  it("tolerates whitespace after the comma in incrementdice(...), which a GM naturally types", () => {
    // 3a: incrementdice(1, LEVEL) with a space after the comma used to fall
    // straight through resolveDynamicDice's regex (no \s* allowance),
    // leaving "incrementdice(...)d6" for the Parser's own (different!)
    // standalone incrementdice implementation, which computes a flat
    // number and ignores the trailing "d6" entirely.
    const char = makeCharacter({ level: 20 });
    const spaced = rollFormula("incrementdice(1, LEVEL)d6", char);
    const tight = rollFormula("incrementdice(1,LEVEL)d6", char);
    expect(spaced.error).toBeUndefined();
    expect(spaced.rolls).toHaveLength(tight.rolls.length);
    expect(spaced.diceNotation).toBe(tight.diceNotation);
  });

  it("rejects a stepdice dice-count other than 1 instead of silently truncating", () => {
    // 3b: resolveDynamicDice only ever matches "1dstepdice(...)" — stepdice
    // is conceptually a single die whose *size* steps with level, not a
    // count of stepped dice, and no real formula in src/data uses anything
    // but "1d". A typo'd "2dstepdice(...)" doesn't match that regex, so it
    // used to fall through to the Parser, which read the leading "2" as a
    // complete expression and silently discarded "dstepdice(...)" — this is
    // the "returns 2" bug reported. The general full-consumption check
    // added to Parser.parse() now catches that leftover instead, so this
    // fails loudly rather than rolling a nonsense flat "2".
    const char = makeCharacter({ level: 20 });
    const result = rollFormula("2dstepdice(15,4,6,8,1001)", char);
    expect(result.rolls).toEqual([]);
    expect(result.error).toMatch(/trailing input/i);
  });

  it("rejects a nested function call inside stepdice's argument list instead of silently mis-parsing it", () => {
    // 3c: resolveDynamicDice's stepdice regex captures args with `[^)]+`,
    // which stops at the *first* ")" — a nested call like
    // "floor(LEVEL/2)" closes early on floor's own ")", corrupting the
    // capture. No real formula in src/data nests a call there (level/base
    // are always plain values), so this is intentionally not special-cased
    // with a balanced-paren parser; the general full-consumption check
    // catches the resulting garbage and throws instead of producing a
    // wrong result.
    const char = makeCharacter({ level: 20 });
    const result = rollFormula("1dstepdice(floor(LEVEL/2),4,6,8,10)", char);
    expect(result.rolls).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe("implicit-count dice notation (dN -> 1dN)", () => {
  // Confirmed against the Nimble rulebook: d44/d66/d88 are single dice with
  // that many faces (progression by spell tier), not two-digit roll tables
  // — consistent with Nimble's crit rule (max face value crits), which
  // wouldn't make sense on a table roll. So src/data/spells.ts's use of
  // "d66"/"d88"/"d44" is correct game data; the parser was too strict.

  it("normalizes a bare dN with nothing before it to 1dN and rolls one die", () => {
    const char = makeCharacter();
    mockRolls([50], 66);
    const result = rollFormula("d66", char);
    expect(result.rolls).toEqual([50]);
    expect(result.diceNotation).toBe("1d66");
    expect(result.error).toBeUndefined();
  });

  it("rolls the project's real d44/d66/d88 spell formulas without error", () => {
    // Real formulas from src/data/spells.ts (Entice's sibling spells use
    // stepdice instead; these four use a bare implicit die directly).
    const char = makeCharacter();
    for (const formula of ["d44", "d66", "d66", "d88"]) {
      const result = rollFormula(formula, char);
      expect(result.rolls).toHaveLength(1);
      expect(result.error).toBeUndefined();
    }
  });

  it("does not touch an already-explicit count — non-regression for 2d6", () => {
    const char = makeCharacter();
    const result = rollFormula("2d6", char);
    expect(result.diceNotation).toBe("2d6");
    expect(result.rolls).toHaveLength(2);
  });

  it("does not re-prefix a digit that arrived via substitution rather than being typed literally", () => {
    // normalizeImplicitDiceCount runs on the post-substitution string and
    // only cares whether a digit/letter precedes "d" *in that string* — it
    // can't tell a literal count from one produced by variable
    // substitution, which is exactly what makes it safe for both. Proven
    // here with a hand-substituted count standing in for what a resolved
    // variable would leave behind.
    const char = makeCharacter();
    const result = rollFormula("12d20", char);
    expect(result.diceNotation).toBe("12d20");
    expect(result.rolls).toHaveLength(12);
  });

  it("found: KEYd20 (src/data/spells.ts, 'Immolating Breath (Dragonform)') never substitutes KEY, for an unrelated pre-existing reason", () => {
    // \bKEY\b requires a non-word boundary right after "KEY", but "d20" is
    // glued directly on with no separator — "KEYD20" is all word
    // characters, so there's no boundary between "Y" and "D" and the
    // substitution silently never fires (same root cause would affect any
    // stat/skill/LEVEL glued directly to a die suffix, e.g. "LEVELd6").
    // Before this batch, the un-substituted "keyd20" hit the old
    // unknown-token fallback and silently evaluated to 0 — this spell's
    // damage has always been a silent no-op. It now throws instead, which
    // is strictly better, but the root substitution bug is a separate,
    // pre-existing issue not fixed here — flagged, not fixed.
    const char = makeCharacter({ keyStat: "str", stats: { str: 3, dex: 0, int: 0, wil: 0 } });
    expect(() => rollFormula("KEYd20", char)).not.toThrow(); // rollFormula itself never throws...
    const result = rollFormula("KEYd20", char);
    expect(result.rolls).toEqual([]); // ...it reports failure via `.error` instead
    expect(result.error).toMatch(/unrecognized token/i);
  });

  it("does not touch stepdice(/incrementdice( — non-regression for the letter-preceded exclusion", () => {
    // Both function names contain a "d" that isn't immediately followed by
    // a digit ("stepDIce", "incrementDIce"), so they're already safe on
    // that basis alone. This test instead proves the *letter-precededness*
    // exclusion itself, using a synthetic unrecognized token ("Xd6") that
    // has a letter directly before a digit-followed "d" — if the exclusion
    // were missing or buggy, this would be silently normalized into a
    // rollable "1d6" and quietly succeed instead of correctly failing as
    // an unrecognized token.
    const char = makeCharacter();
    const result = rollFormula("Xd6", char);
    expect(result.rolls).toEqual([]);
    expect(result.error).toMatch(/unrecognized token/i);
  });

  it("still resolves real incrementdice/stepdice spell formulas correctly alongside the implicit-dice normalization", () => {
    const char = makeCharacter({ level: 20 });
    const shadowBlast = rollFormula("incrementdice(1,level)d12+KEY", char);
    expect(shadowBlast.rolls).toHaveLength(5);
    expect(shadowBlast.error).toBeUndefined();

    const entice = rollFormula("1dstepdice(level,4,8,10,12)", char);
    expect(entice.rolls).toHaveLength(1);
    expect(entice.error).toBeUndefined();
  });
});

describe("game data validation (point 4)", () => {
  // Iterates every formula in src/data/spells.ts and src/data/equipment.ts
  // through validateFormula, and additionally requires a non-empty
  // diceNotation (via parseDamageFormula) for any formula whose raw text
  // looks like it should roll dice — this is what originally caught
  // d66/d88/d44 evaluating to a flat 0 instead of rolling.
  //
  // A level-20 character is used throughout: level feeds incrementdice/
  // stepdice, and this project's actual dynamic-dice spells only reach a
  // handful of dice/low sides at that level (see the MAX_DICE_COUNT/
  // MAX_DICE_SIDES comments), so this doesn't risk tripping the safety
  // limits on legitimate content.
  const char = makeCharacter({
    level: 20,
    stats: { str: 3, dex: 2, int: 1, wil: 0 },
    keyStat: "str",
    flawStat: "wil",
  });
  const ctx = buildContext(char);

  /** True if the raw formula text contains dice notation (explicit, implicit, or dynamic). */
  function looksLikeDice(formula: string): boolean {
    return /\d*d\d+/i.test(formula) || /stepdice|incrementdice/i.test(formula);
  }

  const entries: { name: string; formula: string }[] = [
    ...BASE_SPELLS.map((s) => ({ name: s.name, formula: s.formula })),
    ...BASIC_EQUIPMENTS.map((e) => ({ name: e.name, formula: e.formula ?? "" })),
  ].filter((e) => e.formula);

  /**
   * Known-bad formulas as of this batch, keyed by item/spell name — found
   * by running this exact validation over every entry. Each is a distinct,
   * pre-existing data issue, not something introduced or fixed here:
   *
   * - "Tooth & Claw (Dragonform)" (spell): formula "1d20+LVL" — typo for
   *   LEVEL. The level bonus has always silently evaluated to +0.
   * - "Immolating Breath (Dragonform)" (spell): formula "KEYd20" — KEY is
   *   glued directly to "d20" with no separator, so `\bKEY\b` never
   *   matches (no word-boundary between "Y" and "D") and KEY is never
   *   substituted. Same root cause would hit any stat/skill/LEVEL glued
   *   directly to a die suffix. Damage has always silently evaluated to 0.
   * - "Weapon of Animosity", "Weapon of Wounding", "Vindication"
   *   (equipment): formulas reference "WeaponDamage", a token the engine
   *   has no concept of (there's no "currently equipped weapon's damage"
   *   variable) — these read as flavor-text shorthand for a GM to
   *   interpret manually, not as formulas meant to be rolled as-is.
   *
   * If this list needs to shrink, it means one of these was actually
   * fixed — update it alongside the fix, don't just delete entries to
   * make the test pass. If it needs to grow, a *newly added* formula is
   * broken and should be fixed instead of allowlisted.
   */
  const KNOWN_BAD_FORMULAS = new Set([
    "Tooth & Claw (Dragonform)",
    "Immolating Breath (Dragonform)",
    "Weapon of Animosity",
    "Weapon of Wounding",
    "Vindication",
  ]);

  it("has formula entries to check (sanity check that the data imports resolved)", () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it("validates every spell/equipment formula except the known pre-existing data bugs above", () => {
    const unexpectedFailures: string[] = [];
    const unexpectedPasses: string[] = [];

    for (const { name, formula } of entries) {
      let validationError: string | null = null;
      try {
        validateFormula(formula, ctx);
      } catch (err) {
        validationError = err instanceof Error ? err.message : String(err);
      }

      let missingDice = false;
      if (!validationError && looksLikeDice(formula)) {
        const { diceNotation } = parseDamageFormula(formula, ctx);
        missingDice = diceNotation === "";
      }

      const isBroken = validationError !== null || missingDice;
      const isKnownBad = KNOWN_BAD_FORMULAS.has(name);

      if (isBroken && !isKnownBad) {
        unexpectedFailures.push(
          `${name} :: "${formula}" :: ${validationError ?? "no dice extracted from a dice-shaped formula"}`,
        );
      } else if (!isBroken && isKnownBad) {
        unexpectedPasses.push(`${name} :: "${formula}" (listed as known-bad but now validates fine)`);
      }
    }

    expect(unexpectedFailures).toEqual([]);
    expect(unexpectedPasses).toEqual([]);
  });
});
