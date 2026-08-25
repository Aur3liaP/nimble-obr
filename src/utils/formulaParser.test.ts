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
  evalFormulaWithContext,
  formulaSyntaxError,
  FormulaError,
  type FormulaContext,
  isEngineRollableItem,
  normalizeSubstitutedSignsForDisplay,
  parseDamageFormula,
  resolveFormulaDisplay,
  rollFormula,
  rollFormulaWithContext,
  safeEval,
  substituteVariables,
  validateFormula,
  validateFormulaSyntax,
  VARIABLE_TABLE,
} from "./formulaParser";

/**
 * A context with no real character behind it, shaped like the one
 * `useOBR.ts`'s `handleFreeRoll` passes to `rollFormulaWithContext` for the
 * standalone free-roll widget: every stat/skill/HP field is 0 (not a
 * fabricated neutral value), only `level` is 1, matching Nimble's actual
 * minimum level. Defined locally rather than imported from `useOBR.ts`,
 * which pulls in the OBR SDK and would break this file's "pure, no OBR
 * dependency" test contract.
 */
const NO_CHARACTER_CTX: FormulaContext = {
  level: 1,
  key: 0,
  flaw: 0,
  stats: { str: 0, dex: 0, int: 0, wil: 0 },
  skills: {
    arcana: 0,
    examination: 0,
    finesse: 0,
    influence: 0,
    insight: 0,
    lore: 0,
    might: 0,
    naturecraft: 0,
    perception: 0,
    stealth: 0,
  },
};

function makeCharacter(overrides: Partial<NimbleCharacter> = {}): NimbleCharacter {
  const char = createDefaultCharacter("owner-1");
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

  it("handles a leading unary minus and chained signs ('+-', '--', '-+', '++')", () => {
    // Bug: a negative stat substituted right after the formula's own
    // operator produces a CHAINED sign — "1d8+STR" with STR=-1 substitutes
    // to "1d8+-1", and once the dice part is split off, the remainder
    // handed to safeEval starts with "+-1". parseUnary used to consume the
    // outer sign and hand the rest straight to parsePrimary, which has no
    // idea what to do with the second sign character still sitting at the
    // front and threw "Unrecognized token in formula: \"-1\"." — reported
    // in the wild via initiative (`1d20+${dex+bonus}`, e.g. "1d20+-2" for
    // a total of -2), but not initiative-specific: any formula whose
    // trailing modifier ends up glued to a negative substituted value hits
    // this, including the stock stat arrays (+2/+2/+0/-1, +3/+1/-1/-1).
    expect(safeEval("-2")).toBe(-2);
    expect(safeEval("+-2")).toBe(-2);
    expect(safeEval("--2")).toBe(2);
    expect(safeEval("-+2")).toBe(-2);
    expect(safeEval("++2")).toBe(2);
    expect(safeEval("0+-2")).toBe(-2);
    expect(safeEval("0--2")).toBe(2);
  });

  it("rejects a bare '.' with no digits instead of silently treating it as 0", () => {
    // parsePrimary's digit/dot scan matches "." on its own (it passes the
    // /[\d.]/ character check), but parseFloat(".") is NaN. The old
    // `parseFloat(...) || 0` turned that into a legitimate-looking 0
    // instead of rejecting the malformed number — the exact silent-success
    // shape fixed everywhere else, just spelled with `|| 0` instead of
    // `isNaN(...) ? 0 : ...`.
    expect(() => safeEval("1+.")).toThrow(FormulaError);
  });

  it("rejects a number with two decimal points instead of silently truncating it", () => {
    // The old scan consumed the *entire* run of digits/dots in one go
    // (e.g. all of "1..2") and handed it to parseFloat, which stops at the
    // first invalid character and quietly returns just the valid prefix —
    // parseFloat("1..2") is 1, not NaN, so the "||0" fallback never even
    // fired here; the ".2" tail just vanished with nothing to catch it.
    // The fix stops the scan at the second "." instead, so the leftover
    // ".2" surfaces as trailing input.
    expect(() => safeEval("1..2")).toThrow(FormulaError);
  });

  it("still parses a well-formed decimal correctly (non-regression)", () => {
    expect(safeEval("1.5 + 1.5")).toBe(3);
  });
});

describe("evalFormula", () => {
  it("substitutes stats, key, flaw, level, skills and HP", () => {
    const char = makeCharacter();
    expect(evalFormula("STR", char).value).toBe(3);
    expect(evalFormula("KEY", char).value).toBe(3); // keyStat = str
    expect(evalFormula("FLAW", char).value).toBe(0); // flawStat = wil
    expect(evalFormula("LEVEL", char).value).toBe(5);
    expect(evalFormula("STEALTH", char).value).toBe(4);
    expect(evalFormula("HP", char).value).toBe(8);
    expect(evalFormula("MAXHP", char).value).toBe(12);
  });

  it("is case-insensitive on variable names", () => {
    const char = makeCharacter();
    expect(evalFormula("str + dex", char).value).toBe(5);
  });

  it("averages dice notation instead of rolling", () => {
    const char = makeCharacter();
    // 1d8 averages to round(1 * (1+8)/2) = 5
    expect(evalFormula("1d8", char).value).toBe(5);
    expect(evalFormula("1d8 + STR", char).value).toBe(8);
  });

  it("resolves incrementdice/stepdice helpers before averaging", () => {
    const char = makeCharacter({ level: 10 });
    // incrementdice(1, 10) -> 1 + floor(10/5) = 3 dice of d6 -> avg round(3*3.5)=11
    expect(evalFormula("incrementdice(1,10)d6", char).value).toBe(11);
  });

  it("returns value 0 with an error for an over-length formula", () => {
    const char = makeCharacter();
    const longFormula = "1+".repeat(150) + "1";
    const result = evalFormula(longFormula, char);
    expect(result.value).toBe(0);
    expect(result.error).toMatch(/too long/i);
  });

  it("returns value 0 with an error for dice counts/sides beyond the safety limits", () => {
    const char = makeCharacter();
    expect(evalFormula("101d6", char).error).toMatch(/out of range/i);
    expect(evalFormula("1d1001", char).error).toMatch(/out of range/i);
  });

  it("carries the error instead of throwing, for a genuinely broken formula (e.g. an armor item's formula referencing an unknown token)", () => {
    // This is the shape computeDefense (CombatTab) relies on: a broken
    // equipped-armor formula must be distinguishable from one that
    // legitimately computes to 0, not just look like the same silent 0.
    const char = makeCharacter();
    const result = evalFormula("WeaponDamage + 1d4", char);
    expect(result.value).toBe(0);
    expect(result.error).toMatch(/unrecognized token/i);
  });

  it("resolves LVL exactly like LEVEL — both are supported Nimble notation, not a typo", () => {
    // "Tooth & Claw (Dragonform)" in src/data/spells.ts uses "1d20+LVL".
    // LVL is deliberately kept as the book's own shorthand, not "fixed"
    // into LEVEL in the data.
    const char = makeCharacter();
    expect(evalFormula("1d20+LVL", char).value).toBe(
      evalFormula("1d20+LEVEL", char).value,
    );
    expect(evalFormula("1d20+LVL", char).error).toBeUndefined();
  });

  it("reports an error instead of a silent 0 when safeEval's character whitelist rejects the resolved formula", () => {
    // ";" isn't a recognized variable, so it survives substitution
    // unchanged: "STR;2" becomes "3;2", which fails safeEval's character
    // whitelist and used to come back as `value: 0` with no `error` — a
    // success-shaped result for something that never actually evaluated.
    // This is the exact path computeDefense (CombatTab) reads from.
    const char = makeCharacter();
    const result = evalFormula("STR;2", char);
    expect(result.value).toBe(0);
    expect(result.error).toBeTruthy();
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

  it("throws instead of silently defaulting to a 0 modifier when there's no dice and safeEval can't parse the result", () => {
    const ctx = buildContext(makeCharacter());
    // ";" isn't a recognized variable, so "STR;2" survives substitution as
    // "3;2", which fails safeEval's character whitelist. rollFormula (the
    // real caller) already wraps this call in a try/catch, so this
    // surfaces as `.error` there instead of a silent flat 0.
    expect(() => parseDamageFormula("STR;2", ctx)).toThrow(FormulaError);
  });

  it("throws instead of silently defaulting to a 0 modifier when there IS dice but the modifier tail can't be parsed", () => {
    const ctx = buildContext(makeCharacter());
    expect(() => parseDamageFormula("1d8+STR;2", ctx)).toThrow(FormulaError);
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

  it("shows the raw formula with an error instead of silently displaying it as-is, when there's no dice and safeEval can't parse the result", () => {
    // ";" isn't a recognized variable, so "STR;2" survives substitution as
    // "3;2", which fails safeEval's character whitelist. Used to silently
    // fall back to showing the raw formula with no error — indistinguishable
    // from "nothing to resolve, showing it as typed".
    const char = makeCharacter();
    const result = resolveFormulaDisplay("STR;2", char);
    expect(result.display).toBe("STR;2");
    expect(result.error).toBeTruthy();
  });

  it("shows the raw formula with an error when there IS dice but the modifier tail can't be parsed", () => {
    const char = makeCharacter();
    const result = resolveFormulaDisplay("1d8+STR;2", char);
    expect(result.display).toBe("1d8+STR;2");
    expect(result.error).toBeTruthy();
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

  it("throws for dice below the lower bound (point 2)", () => {
    expect(() => diceToAverage("0d6")).toThrow(FormulaError);
    expect(() => diceToAverage("0d1000")).toThrow(FormulaError);
    expect(() => diceToAverage("1d1")).toThrow(FormulaError);
  });

  it("does not throw exactly at the lower bound", () => {
    expect(diceToAverage("1d2")).toBe("2"); // round(1 * (1+2)/2) = round(1.5) = 2
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
    // Level 20 is MAX_LEVEL, clamped at write time in useOBR's updateCharacter.
    // These are real formulas from src/data/spells.ts, not synthetic ones.
    const char = makeCharacter({ level: 20 });

    // Shadow Blast: "incrementdice(1,level)d12+KEY" -> 1 + floor(20/5) = 5 dice of d12.
    const shadowBlast = rollFormula("incrementdice(1,level)d12+KEY", char);
    expect(shadowBlast.rolls).toHaveLength(5);
    expect(shadowBlast.error).toBeUndefined();

    // Entice: "1dstepdice(level,4,6,8,10,12)" -> level >= 20 picks the d12 tier.
    const entice = rollFormula("1dstepdice(level,4,6,8,10,12)", char);
    expect(entice.rolls).toHaveLength(1);
    entice.rolls.forEach((r) => expect(r).toBeLessThanOrEqual(12));
    expect(entice.error).toBeUndefined();

    // 5 dice and d12 sides are nowhere near MAX_DICE_COUNT (100) or
    // MAX_DICE_SIDES (1000): the margin is roughly 20x on count and 80x on
    // sides. These limits protect against a hand-typed/malicious custom
    // formula, not against anything a legally-built level-20 character's
    // real spell list can produce.
  });

  it("rejects a dice count of 0, showing the raw formula and what it resolved to (point 2)", () => {
    // buildContext returns key: 0 whenever char.keyStat isn't set yet —
    // the normal state of a sheet mid-creation. Once point 1 lets "KEYd20"
    // substitute at all, this is exactly how it turns into "0d20". The
    // message must show *both* — "0d20" alone no longer has "KEY" in it
    // anywhere to explain why count is 0.
    const char = makeCharacter({ keyStat: null });
    const result = rollFormula("KEYd20", char);
    expect(result.rolls).toEqual([]);
    expect(result.error).toMatch(/at least 1/i);
    expect(result.error).toContain('"KEYd20"');
    expect(result.error).toContain('"0d20"');
  });

  it("shows the token alone, with no redundant \"resolved to\", when the raw formula and the resolved token are identical", () => {
    // A literally-typed "0d6" (no variable involved) has nothing to
    // resolve *from* — showing "resolved to" here would be noise.
    const result = rollFormula("0d6", makeCharacter());
    expect(result.error).toContain('"0d6"');
    expect(result.error).not.toMatch(/resolved to/i);
  });

  it("rejects a 1-sided die (point 2)", () => {
    const result = rollFormula("1d1", makeCharacter());
    expect(result.rolls).toEqual([]);
    expect(result.error).toMatch(/at least 2 sides/i);
  });

  it("still rolls normally at the lower bound (1 die, 2 sides)", () => {
    const result = rollFormula("1d2", makeCharacter());
    expect(result.rolls).toHaveLength(1);
    expect(result.error).toBeUndefined();
  });

  it("investigation: a negative stat glued to a dice suffix (e.g. \"-1d20\" from a negative KEY) already fails today, via the existing trailing-input check rather than the new lower bound", () => {
    // Substitution turns "KEYd20" into "-1d20" when KEY is negative. The
    // choke-point regex that reads count/sides is `(\d+)d(\d+)` — it never
    // captures a leading '-', so it sees "1d20" (count 1, in range) and
    // doesn't fire the new lower-bound check at all. What actually catches
    // this is parseDamageFormula's `^(\d+d\d+)` leading-dice match, which
    // requires the match to start at position 0 — "-1d20" starts with '-',
    // so it never matches there either, and the formula falls through to
    // the flat-modifier path, where the Parser reads the unary "-1" and
    // then hits the un-consumed "d20" as trailing input.
    //
    // I deliberately did NOT extend the choke-point regex to recognize a
    // leading '-' as part of the dice count (e.g. `(-?\d+)d(\d+)`): a bare
    // '-' immediately before a digit is ambiguous between "part of a
    // negative number" and "subtraction operator". Verified below —
    // ordinary subtraction before a dice roll (e.g. "10-1d6", meaning "ten
    // minus a 1d6 roll") already fails the same way for the same reason
    // (only the *leading* token is ever real dice notation; this project's
    // formulas don't support subtracting a die roll), so a regex change
    // wouldn't avoid ambiguity, it would just make the message actively
    // wrong for the subtraction case while barely improving it for the
    // negative-stat case.
    const char = makeCharacter({
      keyStat: "str",
      stats: { str: -1, dex: 0, int: 0, wil: 0 },
    });
    const negativeStat = rollFormula("KEYd20", char);
    const subtraction = rollFormula("10-1d6", makeCharacter());

    expect(negativeStat.rolls).toEqual([]);
    expect(negativeStat.error).toMatch(/trailing input/i);
    expect(subtraction.rolls).toEqual([]);
    expect(subtraction.error).toMatch(/trailing input/i);
  });

  it("rejects a malformed decimal in the modifier tail instead of quietly rolling it as +0", () => {
    // "1d6+." used to roll fine, with the "." silently contributing 0 to
    // the modifier — a real dice roll broadcast to the table with no sign
    // anything was wrong with what was typed.
    const result = rollFormula("1d6+.", makeCharacter());
    expect(result.rolls).toEqual([]);
    expect(result.error).toBeTruthy();
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

  it("throws when safeEval's character whitelist rejects the resolved formula, same as the read paths", () => {
    // Was previously passed through silently (the return value of the
    // final safeEval call was discarded): a formula accepted at save time
    // could still fail the moment someone actually rolled or displayed it.
    const ctx = buildContext(makeCharacter());
    expect(() => validateFormula("STR;2", ctx)).toThrow(FormulaError);
  });
});

describe("cross-path consistency: an invalid formula must be rejected identically everywhere (point 1)", () => {
  // The three read/write paths (validateFormula at save time,
  // evalFormulaWithContext and resolveFormulaDisplay at read time) must
  // agree on what counts as invalid. They diverged once already
  // (validateFormula discarded safeEval's return value while the other two
  // threw on NaN) — this test exists specifically to catch that class of
  // regression again, not just today's specific bug.
  it.each([
    ["STR;2", "character whitelist rejects a leftover unsubstituted symbol"],
    ["1d6+.", "a bare '.' with no digits is not a valid number"],
    ["KEYd0", "sides below the lower bound"],
  ])("rejects %s (%s) in validateFormula, evalFormulaWithContext, and resolveFormulaDisplay alike", (formula) => {
    const char = makeCharacter({ keyStat: "str", stats: { str: 3, dex: 0, int: 0, wil: 0 } });
    const ctx = buildContext(char);

    expect(() => validateFormula(formula, ctx)).toThrow(FormulaError);

    const evalResult = evalFormulaWithContext(formula, ctx);
    expect(evalResult.error).toBeTruthy();

    const displayResult = resolveFormulaDisplay(formula, char);
    expect(displayResult.error).toBeTruthy();
  });
});

describe("rollFormulaWithContext", () => {
  // Covers useOBR.ts's handleFreeRoll switching from a fake, cast-to-
  // NimbleCharacter stub to rollFormulaWithContext(formula, FREE_ROLL_CONTEXT, ...).

  it("rolls a plain dice+modifier formula given only a FormulaContext, no NimbleCharacter required", () => {
    mockRolls([4, 2], 6);
    const result = rollFormulaWithContext("2d6+3", NO_CHARACTER_CTX);
    expect(result.rolls).toEqual([4, 2]);
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(4 + 2 + 3);
    expect(result.error).toBeUndefined();
  });

  it("does not inject a value for a referenced variable the context sets to zero, so a free roll never gets a parasitic bonus", () => {
    mockRolls([3], 6);
    const zeroResult = rollFormulaWithContext("1d6+STR", NO_CHARACTER_CTX);
    expect(zeroResult.modifier).toBe(0);
    expect(zeroResult.total).toBe(3);

    // Same formula, a context where STR is actually non-zero: proves the
    // zero result above reflects the context's STR value, not a formula
    // that silently drops the "+STR" term.
    mockRolls([3], 6);
    const nonZeroResult = rollFormulaWithContext("1d6+STR", {
      ...NO_CHARACTER_CTX,
      stats: { ...NO_CHARACTER_CTX.stats, str: 5 },
    });
    expect(nonZeroResult.modifier).toBe(5);
    expect(nonZeroResult.total).toBe(8);
  });

  it("returns an error instead of throwing for an invalid formula, same contract as rollFormula", () => {
    const result = rollFormulaWithContext("101d6", NO_CHARACTER_CTX);
    expect(result.rolls).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.error).toMatch(/out of range/i);
  });

  it("matches rollFormula's result when given that same character's buildContext() output", () => {
    const char = makeCharacter();

    mockRolls([5, 10], 20);
    const viaChar = rollFormula("1d20+STR", char, "advantage", 1);

    mockRolls([5, 10], 20);
    const viaCtx = rollFormulaWithContext(
      "1d20+STR",
      buildContext(char),
      "advantage",
      1,
    );

    expect(viaCtx).toEqual(viaChar);
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

  it("keeps 2 of 3 dice on an advantage roll, in original roll order — the pool's highest value isn't automatically the primary die", () => {
    // 2d6 with one advantage die (3 rolled, 1 eliminated): the lowest (2,
    // the LAST roll) is the one eliminated, so the two survivors keep
    // their original left-to-right order: [4, 6] — the 6 stays SECOND,
    // it doesn't jump to the front just because it's the bigger number.
    // kept[0] (the primary die, here the first-rolled 4) is what decides
    // the crit, so this does NOT crit even though a 6 was rolled and
    // survived — a sort-then-slice implementation would wrongly put the
    // 6 first and report a crit here.
    const char = makeCharacter();
    mockRolls([4, 6, 2], 6);
    const result = rollFormula("2d6", char, "advantage", 1);
    expect(result.kept).toEqual([4, 6]);
    expect(result.isCritical).toBe(false);
  });

  it("keeps 2 of 3 dice on a disadvantage roll, in original roll order — the pool's lowest value isn't automatically the primary die", () => {
    // 2d6 with one disadvantage die (3 rolled, 1 eliminated): the highest
    // (6, the middle roll) is eliminated, so the survivors keep their
    // original order: [5, 1] — the 1 stays SECOND. kept[0] is the
    // first-rolled 5, so this does NOT fumble even though a 1 was rolled
    // and survived — this is the exact shape of the reported bug (a
    // formula like "2d12+4" on disadvantage showing a fumble icon because
    // the lowest-valued survivor was read as primary instead of the
    // leftmost one).
    const char = makeCharacter();
    mockRolls([5, 6, 1], 6);
    const result = rollFormula("2d6", char, "disadvantage", 1);
    expect(result.kept).toEqual([5, 1]);
    expect(result.isFumble).toBe(false);
  });

  it("disadvantage with a tied pair: eliminates the EARLIEST-rolled die of the tie, primary die is the survivor — [6, 1, 6] keeps [1, 6], primary is the 1, a fumble", () => {
    // 2d6 with one disadvantage die (3 rolled, 1 eliminated): the highest
    // value (6) appears twice, at index 0 and index 2. The tie-break
    // eliminates the EARLIER one (index 0), so the survivors are indices
    // 1 and 2, in that order: [1, 6]. The primary die is kept[0] = 1, a
    // fumble — not the second 6, even though it's numerically the same
    // value as the eliminated die.
    const char = makeCharacter();
    mockRolls([6, 1, 6], 6);
    const result = rollFormula("2d6", char, "disadvantage", 1);
    expect(result.kept).toEqual([1, 6]);
    expect(result.isFumble).toBe(true);
    expect(result.isCritical).toBe(false);
  });

  it("advantage with a tied pair: eliminates the EARLIEST-rolled die of the tie, primary die is the survivor — [1, 6, 1] keeps [6, 1], no fumble", () => {
    // 2d6 with one advantage die (3 rolled, 1 eliminated): the lowest
    // value (1) appears twice, at index 0 and index 2. The tie-break
    // eliminates the earlier one (index 0), leaving indices 1 and 2, in
    // that order: [6, 1]. The primary die is kept[0] = 6 — not a fumble,
    // even though the surviving pool still contains a 1.
    const char = makeCharacter();
    mockRolls([1, 6, 1], 6);
    const result = rollFormula("2d6", char, "advantage", 1);
    expect(result.kept).toEqual([6, 1]);
    expect(result.isFumble).toBe(false);
  });

  it("disadvantage 2 on 2d6 with three of the four rolled dice tied at the max: both eliminations start from the left", () => {
    // 2d6 with disadvantage 2 (4 rolled, 2 eliminated). Three of the four
    // rolls tie at the max value (6), at indices 0, 1, and 3; index 2 is
    // a 2. Eliminating the highest, leftmost-on-a-tie, twice in a row:
    // first pass sees [6, 6, 2, 6] and drops index 0 (the first of the
    // three 6s); second pass sees the remaining [6, 2, 6] and drops
    // index 0 again (the next-leftmost 6). What's left is [2, 6], in
    // original relative order — the LAST rolled 6 is the one that
    // survives, not either of the first two.
    const char = makeCharacter();
    mockRolls([6, 6, 2, 6], 6);
    const result = rollFormula("2d6", char, "disadvantage", 2);
    expect(result.kept).toEqual([2, 6]);
  });

  describe("mutation guard: tie-break must eliminate the leftmost extreme, not the rightmost", () => {
    it("regression: reversing the tie-break direction changes which die survives a disadvantage tie", () => {
      // Same setup as the disadvantage tie-break test above. Both tied
      // dice are 6s, so a reversed (rightmost-on-a-tie) tie-break can't
      // be caught by looking at a VALUE alone — it shows up as a
      // different kept SEQUENCE instead: correct (leftmost eliminated)
      // keeps indices 1,2 → [1, 6]; reversed (rightmost eliminated) keeps
      // indices 0,1 → [6, 1]. Same two numbers, different order, and a
      // different primary die (1 vs 6) — this is exactly why the earlier
      // test asserts the full ordered array, not just a value set.
      const char = makeCharacter();
      mockRolls([6, 1, 6], 6);
      const result = rollFormula("2d6", char, "disadvantage", 1);
      expect(result.kept).toEqual([1, 6]);
      expect(result.kept).not.toEqual([6, 1]);
    });
  });

  describe("droppedIndices", () => {
    it("names the eliminated die by INDEX, not by value — [5, 5, 3] disadvantage 1 drops index 0, even though index 1 has the identical value", () => {
      // This is the case matchKeptDice's value-based reconstruction gets
      // wrong (see its own file header): [5, 5, 3] and [5, 3] don't say
      // on their own WHICH 5 survived. droppedIndices removes that
      // ambiguity by naming the eliminated slot directly.
      const char = makeCharacter();
      mockRolls([5, 5, 3], 6);
      const result = rollFormula("2d6", char, "disadvantage", 1);
      expect(result.kept).toEqual([5, 3]);
      expect(result.droppedIndices).toEqual([0]);
    });

    it("matches the real bug report: [6, 1, 6] disadvantage 1 drops index 0", () => {
      const char = makeCharacter();
      mockRolls([6, 1, 6], 6);
      const result = rollFormula("2d6", char, "disadvantage", 1);
      expect(result.droppedIndices).toEqual([0]);
    });

    it("standard mode (nothing eliminated) reports an empty array", () => {
      const char = makeCharacter();
      const result = rollFormula("2d6", char, "standard");
      expect(result.droppedIndices).toEqual([]);
    });
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
  // A bare dN (nothing before the "d") normalizes to a single explicit die.
  // Nimble Core Rules 2nd printing carves out d44/d66/d88 from this general
  // rule — see the dedicated "positional dice notation" describe block
  // below — so d20 stands in here to prove the general mechanism still
  // works for every other size.

  it("normalizes a bare dN with nothing before it to 1dN and rolls one die", () => {
    const char = makeCharacter();
    mockRolls([15], 20);
    const result = rollFormula("d20", char);
    expect(result.rolls).toEqual([15]);
    expect(result.diceNotation).toBe("1d20");
    expect(result.error).toBeUndefined();
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

  it("resolves KEYd20 (src/data/spells.ts, 'Immolating Breath (Dragonform)') — fixed by the point-1 substitution boundary, see the dedicated describe block below", () => {
    const char = makeCharacter({
      keyStat: "str",
      stats: { str: 3, dex: 0, int: 0, wil: 0 },
    });
    const result = rollFormula("KEYd20", char);
    expect(result.rolls).toHaveLength(3);
    expect(result.error).toBeUndefined();
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

describe("stepdice — 4-size (legacy) and 5-size (2nd-printing Entice) breakpoints", () => {
  // pickStepDiceSize is shared by two call sites: resolveDynamicDice's
  // regex path (1dstepdice(...), exercised here via parseDamageFormula's
  // diceNotation — deterministic, no rolling needed) and Parser.parsePrimary's
  // bare stepdice(...) primitive (exercised via safeEval directly). Testing
  // both confirms they stay in sync through the shared helper instead of
  // silently drifting apart the way two hand-copied implementations would.

  it("5-size shape picks d4/d6/d8/d10/d12 across every level 1-20, matching the book's progression", () => {
    // Core Rules 2nd printing, Entice: "Increment the die size 1 step every
    // 5 levels (d6 -> d8 -> d10 -> d12)", base d4. Breakpoints 5/10/15/20.
    const ctxAt = (level: number) => buildContext(makeCharacter({ level }));
    const sizeAt = (level: number) =>
      level >= 20 ? 12 : level >= 15 ? 10 : level >= 10 ? 8 : level >= 5 ? 6 : 4;

    for (let level = 1; level <= 20; level++) {
      const { diceNotation } = parseDamageFormula(
        "1dstepdice(level,4,6,8,10,12)",
        ctxAt(level),
      );
      expect(diceNotation).toBe(`1d${sizeAt(level)}`);
    }
  });

  it("5-size shape reaches d12 exactly at level 20 (MAX_LEVEL) — the bug this batch fixes (previously capped at d10)", () => {
    const ctx = buildContext(makeCharacter({ level: 20 }));
    const { diceNotation } = parseDamageFormula("1dstepdice(level,4,6,8,10,12)", ctx);
    expect(diceNotation).toBe("1d12");
  });

  it("4-size shape (legacy, no real caller today, kept working for backward compatibility) still uses the original 3 breakpoints", () => {
    const cases: [level: number, size: number][] = [
      [1, 4],
      [4, 4],
      [5, 8],
      [9, 8],
      [10, 10],
      [14, 10],
      [15, 12],
      [20, 12], // no 4th breakpoint in this shape — level 20 stays at the 15+ tier
    ];
    for (const [level, size] of cases) {
      const ctx = buildContext(makeCharacter({ level }));
      const { diceNotation } = parseDamageFormula("1dstepdice(level,4,8,10,12)", ctx);
      expect(diceNotation).toBe(`1d${size}`);
    }
  });

  it("rejects a stepdice call with a size count other than 4 or 5, instead of guessing a breakpoint scheme", () => {
    const ctx = buildContext(makeCharacter({ level: 10 }));
    expect(() => parseDamageFormula("1dstepdice(level,4,6,8)", ctx)).toThrow(/4 or 5/i);
    expect(() =>
      parseDamageFormula("1dstepdice(level,4,6,8,10,12,14)", ctx),
    ).toThrow(/4 or 5/i);
  });

  it("the bare stepdice(...) primitive (Parser.parsePrimary, no 1d prefix) shares the same breakpoint logic", () => {
    // Not how any real spell formula is written (stepdice only supports
    // the 1d prefix in practice — see CLAUDE.md), but part of the parser's
    // own grammar; must stay consistent with the 1dstepdice(...) path above
    // through the shared helper.
    expect(safeEval("stepdice(1,4,6,8,10,12)")).toBe(4);
    expect(safeEval("stepdice(5,4,6,8,10,12)")).toBe(6);
    expect(safeEval("stepdice(10,4,6,8,10,12)")).toBe(8);
    expect(safeEval("stepdice(15,4,6,8,10,12)")).toBe(10);
    expect(safeEval("stepdice(20,4,6,8,10,12)")).toBe(12);
    expect(safeEval("stepdice(20,4,8,10,12)")).toBe(12); // 4-size shape, unchanged
  });
});

describe("positional dice notation (d44/d66/d88, Nimble Core Rules 2nd printing)", () => {
  // A bare d44/d66/d88 rolls 2 dice of that size and reads them
  // positionally (tens, ones) rather than summing — e.g. rolling a 4 then a
  // 5 on d66 reads as 45, not 9. The "a" suffix (d44a/d66a/d88a) is the
  // advantage variant: roll 3, drop the lowest (leftmost on a tie), and
  // read the remaining 2 positionally in their ORIGINAL roll order — never
  // sorted.

  it("rolls 2 dice and reads them positionally: [4, 5] -> 45, not 9 and not resorted", () => {
    const char = makeCharacter();
    mockRolls([4, 5], 6);
    const result = rollFormula("d66", char);
    expect(result.rolls).toEqual([4, 5]);
    expect(result.kept).toEqual([4, 5]);
    expect(result.total).toBe(45);
    expect(result.diceNotation).toBe("d66");
    expect(result.error).toBeUndefined();
  });

  it("preserves roll order even when it produces a smaller number: [5, 4] -> 54, not resorted to 45", () => {
    const char = makeCharacter();
    mockRolls([5, 4], 6);
    const result = rollFormula("d66", char);
    expect(result.kept).toEqual([5, 4]);
    expect(result.total).toBe(54);
  });

  it("works for d44 and d88 too", () => {
    const char = makeCharacter();
    mockRolls([3, 1], 4);
    expect(rollFormula("d44", char).total).toBe(31);

    mockRolls([7, 2], 8);
    expect(rollFormula("d88", char).total).toBe(72);
  });

  it("applies a trailing flat modifier on top of the positional value", () => {
    const char = makeCharacter();
    mockRolls([4, 5], 6);
    const result = rollFormula("d66+3", char);
    expect(result.total).toBe(48);
    expect(result.modifier).toBe(3);
  });

  it("advantage (d66a): rolls 3, drops the lowest, and reads the remaining 2 positionally without sorting — [4, 2, 5] drops the 2 and reads [4, 5] as 45, not 54", () => {
    const char = makeCharacter();
    mockRolls([4, 2, 5], 6);
    const result = rollFormula("d66a", char);
    expect(result.rolls).toEqual([4, 2, 5]);
    expect(result.kept).toEqual([4, 5]);
    expect(result.total).toBe(45);
  });

  it("advantage tie-break: [3, 3, 6] drops the FIRST 3 (leftmost among ties), reading [3, 6] as 36, not 63", () => {
    const char = makeCharacter();
    mockRolls([3, 3, 6], 6);
    const result = rollFormula("d66a", char);
    expect(result.kept).toEqual([3, 6]);
    expect(result.total).toBe(36);
  });

  it("advantage: dropping the last die still preserves the original order of the first two", () => {
    const char = makeCharacter();
    mockRolls([6, 5, 1], 6); // lowest is the 3rd die
    const result = rollFormula("d66a", char);
    expect(result.kept).toEqual([6, 5]);
    expect(result.total).toBe(65);
  });

  it("mutation guard: kept dice are never sorted — a differently-ordered but same-multiset roll produces a different total", () => {
    // If rollPositionalDice's kept array were ever sorted (the exact bug
    // this notation exists to avoid — see the @file header), these two
    // rolls (same 3 values, different roll order) would collapse to the
    // same total. They must not.
    const char = makeCharacter();
    mockRolls([4, 2, 5], 6);
    const a = rollFormula("d66a", char);
    mockRolls([5, 2, 4], 6);
    const b = rollFormula("d66a", char);
    expect(a.total).not.toBe(b.total);
    expect(a.total).toBe(45);
    expect(b.total).toBe(54);
  });

  it("never crits or fumbles, regardless of individual face values rolled", () => {
    const char = makeCharacter();
    // Both dice show their max face (6) — would be a critical on a normal
    // NdX roll, but positional dice never crit.
    mockRolls([6, 6], 6);
    const maxRoll = rollFormula("d66", char);
    expect(maxRoll.isCritical).toBe(false);
    expect(maxRoll.canCritOrFumble).toBe(false);

    // Both dice show their min face (1) — would be a fumble on a normal
    // NdX roll.
    mockRolls([1, 1], 6);
    const minRoll = rollFormula("d66", char);
    expect(minRoll.isFumble).toBe(false);
    expect(minRoll.canCritOrFumble).toBe(false);
  });

  it("a flat, dice-less formula also reports canCritOrFumble: false", () => {
    const char = makeCharacter();
    expect(rollFormula("+5", char).canCritOrFumble).toBe(false);
  });

  it("a genuine NdX roll reports canCritOrFumble: true", () => {
    const char = makeCharacter();
    mockRolls([4], 8);
    expect(rollFormula("1d8", char).canCritOrFumble).toBe(true);
  });

  it("ignores the roll mode (advantage/disadvantage) passed to rollFormula — positional dice always roll their own fixed 2 or 3 dice", () => {
    const char = makeCharacter();
    mockRolls([4, 5], 6);
    const result = rollFormula("d66", char, "advantage", 3);
    expect(result.rolls).toHaveLength(2);
    expect(result.total).toBe(45);
  });

  it("computes an exact average for display/eval math, not a rejection", () => {
    // Non-advantage: independent tens/ones dice, average face (6+1)/2=3.5
    // read into both positions -> 3.5*11 = 38.5, rounded to 39.
    const char = makeCharacter();
    expect(evalFormula("d66", char)).toEqual({ value: 39 });
    // Sanity: different sizes produce different averages, not a hardcoded 39.
    expect(evalFormula("d44", char).value).not.toBe(39);
  });

  it("resolveFormulaDisplay shows the positional notation itself, not a resolved number", () => {
    const char = makeCharacter();
    expect(resolveFormulaDisplay("d66", char).display).toBe("d66");
    expect(resolveFormulaDisplay("d66a", char).display).toBe("d66a");
    expect(resolveFormulaDisplay("d66+3", char).display).toBe("d66+3");
  });

  it("validateFormulaSyntax accepts positional dice notation, advantage variant included", () => {
    expect(() => validateFormulaSyntax("d66")).not.toThrow();
    expect(() => validateFormulaSyntax("d66a")).not.toThrow();
    expect(formulaSyntaxError("d44a")).toBeUndefined();
    expect(formulaSyntaxError("d88a")).toBeUndefined();
  });

  it("does not treat an explicit-count prefix as positional — 2d66 stays a literal (nonsensical but unambiguous) 2-dice NdX roll", () => {
    const char = makeCharacter();
    mockRolls([10, 20], 66);
    const result = rollFormula("2d66", char);
    expect(result.diceNotation).toBe("2d66");
    expect(result.rolls).toEqual([10, 20]);
    expect(result.total).toBe(30); // summed, not read positionally
  });
});

describe("substituteVariables word-boundary fix (point 1)", () => {
  // \bKEY\b never matched inside "KEYD20": \b requires a transition
  // between a word character and a non-word character, but digits count
  // as word characters too, so there's no boundary between "Y" and "D".
  // Same root cause for every variable, not just KEY. Fixed by replacing
  // the right `\b` with a custom lookahead (see variablePattern's JSDoc).

  it("matches: variable glued directly to a dice suffix substitutes correctly", () => {
    const base = makeCharacter({
      level: 8,
      stats: { str: 3, dex: 0, int: 0, wil: 2 },
      keyStat: "str",
    });
    const char = { ...base, skills: { ...base.skills, might: 4 } };
    expect(rollFormula("KEYd20", char).rolls).toHaveLength(3); // KEY = str = 3
    expect(rollFormula("STRd6", char).rolls).toHaveLength(3);
    expect(rollFormula("LEVELd8", char).rolls).toHaveLength(8); // level = 8
    expect(rollFormula("MIGHTd4", char).rolls).toHaveLength(4); // might = 4
    expect(rollFormula("WILd6", char).rolls).toHaveLength(2); // wil = 2
  });

  it("matches: MAXHP glued to a dice suffix substitutes to maxHp, not clobbered by the HP replacement", () => {
    const char = makeCharacter({ hp: { current: 8, max: 6, temp: 0 } });
    const result = rollFormula("MAXHPd6", char);
    expect(result.rolls).toHaveLength(6); // maxHp = 6, current hp = 8 would give a different count
  });

  it("non-regression: a word that continues past the variable name is left untouched", () => {
    // "KEYSTONE" must not have "KEY" substituted out from under it.
    const result = rollFormula("KEYSTONE", makeCharacter());
    expect(result.rolls).toEqual([]);
    expect(result.error).toMatch(/unrecognized token/i);
  });

  it("non-regression: same check for a skill name (STEALTHY)", () => {
    const result = rollFormula("STEALTHY", makeCharacter());
    expect(result.rolls).toEqual([]);
    expect(result.error).toMatch(/unrecognized token/i);
  });

  it("non-regression: a 'd' not followed by a digit does not trigger substitution (WILD)", () => {
    // "wil" + "d" with nothing (or a non-digit) after the "d" must not be
    // read as "WIL, followed by dice notation" — there's no die size to
    // even resolve to.
    const result = rollFormula("WILD", makeCharacter());
    expect(result.rolls).toEqual([]);
    expect(result.error).toMatch(/unrecognized token/i);
  });

  it("non-regression: HP and MAXHP alone still resolve to the right value (no cross-contamination from reordering)", () => {
    const char = makeCharacter({ hp: { current: 8, max: 12, temp: 0 } });
    expect(evalFormula("HP", char).value).toBe(8);
    expect(evalFormula("MAXHP", char).value).toBe(12);
  });

  it("no other variable name is a prefix of another (documented finding, not a fix)", () => {
    // Checked exhaustively: str/dex/int/wil/key/flaw/level/lvl, the 10
    // skill names, hp/maxhp — none is a prefix of another except the
    // hp/maxhp *substring* case above (hp is a suffix of maxhp, not a
    // prefix), which the left `\b` already protects against structurally.
    // This test just pins that MAXHP itself round-trips correctly since
    // it's replaced first.
    const char = makeCharacter({ hp: { current: 1, max: 20, temp: 0 } });
    expect(evalFormula("MAXHP - HP", char).value).toBe(19);
  });
});

describe("LVL alias for LEVEL, and the FLAW substitution gap (point 1 follow-ups)", () => {
  it("LVL and LEVEL resolve identically, alone and glued to a dice suffix", () => {
    const char = makeCharacter({ level: 8 });
    expect(evalFormula("LVL", char).value).toBe(evalFormula("LEVEL", char).value);
    expect(rollFormula("LEVELd8", char).rolls).toHaveLength(8);
    expect(rollFormula("LVLd20", char).rolls).toHaveLength(8);
  });

  it("FLAW now substitutes (previously had no substitution line at all, documented-but-dead)", () => {
    const char = makeCharacter({ flawStat: "wil", stats: { str: 3, dex: 0, int: 0, wil: 2 } });
    expect(evalFormula("FLAW", char).value).toBe(2);
    expect(rollFormula("FLAWd6", char).rolls).toHaveLength(2);
  });

  it("FLAW is 0 (not an error) when the character has no flaw stat set", () => {
    const char = makeCharacter({ flawStat: null });
    expect(evalFormula("FLAW", char).value).toBe(0);
    expect(evalFormula("FLAW", char).error).toBeUndefined();
  });
});

describe("Math.floor/ceil/min/max shorthand actually normalizes (point 5)", () => {
  // substituteVariables uppercases the raw formula, walks VARIABLE_TABLE,
  // *then* rewrites "MATH.FLOOR("/"MATH.CEIL("/"MATH.MIN("/"MATH.MAX(" to
  // the lowercase floor(/ceil(/min(/max( tokens the parser recognizes, and
  // only after that lowercases the whole string. That ordering is load
  // bearing: the four replace() calls are case-sensitive and rely on
  // running *before* the final toLowerCase() to still see the uppercase
  // "MATH.FLOOR(" shape they match against. Moving them after
  // toLowerCase() (the exact shape of bug that made the INCREMENTDICE/
  // STEPDICE dead code elsewhere in this file's history unreachable) would
  // make every "Math.foo(...)" formula throw an unrecognized-token
  // FormulaError instead of evaluating — this is a real, advertised
  // syntax (the formula help panel cites it), not a nice-to-have.
  const char = makeCharacter({ level: 3, stats: { str: 1, dex: 2, int: 3, wil: 4 } });

  it("normalizes Math.min/Math.max/Math.floor/Math.ceil regardless of case", () => {
    expect(evalFormula("Math.min(3, 8)", char).value).toBe(3);
    expect(evalFormula("MATH.MIN(3, 8)", char).value).toBe(3);
    expect(evalFormula("math.min(3, 8)", char).value).toBe(3);
    expect(evalFormula("Math.max(3, 8)", char).value).toBe(8);
    expect(evalFormula("Math.floor(7 / 2)", char).value).toBe(3);
    expect(evalFormula("Math.ceil(7 / 2)", char).value).toBe(4);
  });

  it("resolves the exact formulas cited in game data and the formula help panel, without error", () => {
    // Rusty Mail (src/data/equipment.ts): "6 + Math.min(DEX, 2)"
    const armor = evalFormula("6 + Math.min(DEX, 2)", char);
    expect(armor.error).toBeUndefined();
    expect(armor.value).toBe(6 + Math.min(char.stats.dex, 2));

    // Flame Dart (src/data/spells.ts): "1d10 + (Math.floor(level / 5) * 5)"
    const flameDart = evalFormula("1d10 + (Math.floor(level / 5) * 5)", char);
    expect(flameDart.error).toBeUndefined();
  });
});

describe("VARIABLE_TABLE structural invariants (point 6)", () => {
  // These assert directly on VARIABLE_TABLE's own shape, not on
  // listFormulaVariables()'s output. listFormulaVariables() is *derived*
  // from this table, so a bug in the table (wrong order, a typo'd
  // aliasOf) would silently reproduce in its output too — testing the
  // output alone couldn't tell "correct" from "consistently wrong". The
  // table's exported specifically so these two invariants can be checked
  // at their actual source (see VARIABLE_TABLE's own doc comment).

  it("orders MAXHP before HP", () => {
    // A type-check can't catch a reordering (e.g. an alphabetical sort)
    // that puts HP first — nothing about the table's type enforces this.
    // See the @remarks above VARIABLE_TABLE for why the order still
    // matters as defense in depth even though the `\b` boundary check
    // already prevents HP from matching inside MAXHP today.
    const names = VARIABLE_TABLE.map((entry) => entry.name);
    expect(names.indexOf("MAXHP")).toBeLessThan(names.indexOf("HP"));
  });

  it("every aliasOf points to an existing entry name in the table", () => {
    // listFormulaVariables() groups alias entries under `byName.get(entry.aliasOf)`,
    // and silently drops the alias via `?.push` if that lookup misses
    // (e.g. a typo'd aliasOf: "LEVELL"). The alias would keep working in
    // substituteVariables (which applies every row regardless of
    // aliasOf), while quietly vanishing from the help panel — the exact
    // "documented behavior the code doesn't actually have" shape this
    // table exists to prevent. Checking listFormulaVariables()'s output
    // wouldn't catch this: the bug's entire nature is that the alias just
    // doesn't show up, with nothing to assert against.
    const names = new Set(VARIABLE_TABLE.map((entry) => entry.name));
    for (const entry of VARIABLE_TABLE) {
      if (entry.aliasOf !== undefined) {
        expect(
          names.has(entry.aliasOf),
          `aliasOf "${entry.aliasOf}" on entry "${entry.name}" has no matching VARIABLE_TABLE entry`,
        ).toBe(true);
      }
    }
  });
});

describe("MATH_FUNCTIONS dispatch order regression (point 7)", () => {
  // parsePrimary now checks floor/ceil/min/max (via the MATH_FUNCTIONS
  // loop) before the bare-parenthesis and number branches; previously
  // min(/max( were checked *after* both. The comment on that loop argues
  // this reordering is safe because every function name starts with a
  // letter and can never collide with a bare "(" or a digit — true, but
  // not itself verified by anything. These exercise formulas that
  // combine several of the reordered branches in the same expression,
  // not just each branch in isolation, so a reordering mistake that only
  // shows up when branches interact wouldn't slip through.

  it("resolves a formula combining max(), floor(), a substituted variable, and a flat modifier", () => {
    const char = makeCharacter({ level: 7 });
    // floor(7/2) = 3, max(1, 3) = 3, + 2 = 5
    expect(evalFormula("max(1, floor(LEVEL/2)) + 2", char).value).toBe(5);
  });

  it("resolves a formula combining bare parentheses, numbers, and nested helpers", () => {
    // floor(9/2) = 4, min(4, 4) = 4, (2+3) * 4 = 20
    expect(safeEval("(2 + 3) * min(4, floor(9 / 2))")).toBe(20);
  });
});

describe("MATH_FUNCTIONS arity errors (point 7)", () => {
  // The dispatch loop reads exactly fn.arity arguments then expects a
  // ")". Before this fix, "min(1,2,3)" read 1 and 2, found "," instead of
  // ")", and left ",3)" as unconsumed trailing input — a loud failure
  // (the full-consumption check in Parser.parse), but with a misleading
  // message ("unexpected trailing input") instead of naming the actual
  // problem (wrong argument count). Same shape for too few arguments
  // (e.g. "min(1)"), which used to fall through to parseExpr() hitting
  // the closing ")" and throwing the generic "unrecognized token" error.

  it("reports too many arguments by function name and expected arity, for both arities", () => {
    expect(() => safeEval("min(1,2,3)")).toThrow(
      "min() takes 2 arguments, got too many.",
    );
    expect(() => safeEval("floor(1,2)")).toThrow(
      "floor() takes 1 argument, got too many.",
    );
  });

  it("reports too few arguments by function name and expected arity, not a generic unrecognized-token error", () => {
    expect(() => safeEval("min(1)")).toThrow(
      "min() takes 2 arguments, got only 1.",
    );
  });

  it("still tolerates a missing closing paren when the argument count is otherwise correct (non-regression)", () => {
    // Pre-existing leniency, shared with every other call form in this
    // parser (see the bare "(" branch and incrementdice/stepdice): an
    // unbalanced paren isn't an argument-count problem, so it must not
    // start throwing the new arity error instead of the old (lack of)
    // error.
    expect(safeEval("floor(3")).toBe(3);
  });
});

describe("FormulaContext contract: every field must actually substitute (point 4)", () => {
  // FLAW was documented (the @file header, README.md, and
  // FormulaContext.flaw itself, computed by buildContext) for who knows
  // how long without a single substituteVariables line wiring it up — the
  // fourth bug of this exact shape in three batches (d66, KEYd20, LVL,
  // FLAW). The common failure isn't a missing variable, it's that nothing
  // verifies a *documented* variable is actually *wired*.
  //
  // These tests iterate FormulaContext's own keys reflectively — via
  // Object.keys/Object.entries on a real built context, not a hardcoded
  // list of expected names — specifically so a field added to
  // FormulaContext tomorrow without a matching substituteVariables entry
  // fails here automatically, the same way FLAW should have.

  it("substitutes every top-level scalar field (level, key, flaw, hp, maxHp) under its own uppercase token", () => {
    const char = makeCharacter({
      level: 7,
      keyStat: "str",
      flawStat: "wil",
      stats: { str: 3, dex: 2, int: 1, wil: 4 },
      hp: { current: 9, max: 15, temp: 0 },
    });
    const ctx = buildContext(char);

    const scalarFields = (Object.keys(ctx) as (keyof typeof ctx)[]).filter(
      (key) => typeof ctx[key] === "number",
    );
    // Sanity check the reflection itself found something to iterate,
    // rather than silently passing on an empty list.
    expect(scalarFields.length).toBeGreaterThanOrEqual(5);

    for (const field of scalarFields) {
      const token = field.toUpperCase();
      const result = evalFormulaWithContext(token, ctx);
      expect(result.error).toBeUndefined();
      expect(result.value).toBe(ctx[field]);
    }
  });

  it("substitutes every stat under its own uppercase token", () => {
    const char = makeCharacter({ stats: { str: 3, dex: 2, int: 1, wil: 4 } });
    const ctx = buildContext(char);
    const statEntries = Object.entries(ctx.stats);
    expect(statEntries.length).toBeGreaterThanOrEqual(4);

    for (const [stat, value] of statEntries) {
      const token = stat.toUpperCase();
      const result = evalFormulaWithContext(token, ctx);
      expect(result.error).toBeUndefined();
      expect(result.value).toBe(value);
    }
  });

  it("substitutes every skill under its own uppercase token", () => {
    const char = makeCharacter();
    const ctx = buildContext(char);
    const skillEntries = Object.entries(ctx.skills);
    expect(skillEntries.length).toBeGreaterThanOrEqual(10);

    for (const [skill, value] of skillEntries) {
      const token = skill.toUpperCase();
      const result = evalFormulaWithContext(token, ctx);
      expect(result.error).toBeUndefined();
      expect(result.value).toBe(value);
    }
  });

  it("LVL resolves identically to LEVEL (documented alias, not a separate field)", () => {
    const char = makeCharacter({ level: 9 });
    const ctx = buildContext(char);
    expect(evalFormulaWithContext("LVL", ctx).value).toBe(ctx.level);
    expect(evalFormulaWithContext("LEVEL", ctx).value).toBe(ctx.level);
  });
});

describe("negative stat modifiers (chained-sign parser bug)", () => {
  // Reported via initiative going negative (`1d20+${dex+bonus}` becomes
  // e.g. "1d20+-2"), but the root cause (parseUnary's sign branches jumping
  // straight to parsePrimary instead of recursing) is generic: any formula
  // whose trailing modifier ends up glued to a negative substituted stat
  // hits the same case, initiative or not. Covers the formula shapes this
  // project's own game data actually uses.

  it("1d8+STR: negative STR rolls and displays correctly", () => {
    const char = makeCharacter({ stats: { str: -2, dex: 0, int: 0, wil: 0 } });
    mockRolls([5], 8);
    const result = rollFormula("1d8+STR", char);
    expect(result.error).toBeUndefined();
    expect(result.modifier).toBe(-2);
    expect(result.total).toBe(3);
    expect(resolveFormulaDisplay("1d8+STR", char).display).toBe("1d8-2");
  });

  it("1d6+DEX: negative DEX rolls and displays correctly", () => {
    const char = makeCharacter({ stats: { str: 0, dex: -3, int: 0, wil: 0 } });
    mockRolls([4], 6);
    const result = rollFormula("1d6+DEX", char);
    expect(result.error).toBeUndefined();
    expect(result.modifier).toBe(-3);
    expect(result.total).toBe(1);
    expect(resolveFormulaDisplay("1d6+DEX", char).display).toBe("1d6-3");
  });

  it("2d4+KEY: negative key stat rolls and displays correctly", () => {
    const char = makeCharacter({
      stats: { str: -1, dex: 0, int: 0, wil: 0 },
      keyStat: "str",
    });
    mockRolls([2, 3], 4);
    const result = rollFormula("2d4+KEY", char);
    expect(result.error).toBeUndefined();
    expect(result.modifier).toBe(-1);
    expect(result.total).toBe(4);
    expect(resolveFormulaDisplay("2d4+KEY", char).display).toBe("2d4-1");
  });

  it("10+STR: a flat (dice-less) formula with a negative stat", () => {
    const char = makeCharacter({ stats: { str: -2, dex: 0, int: 0, wil: 0 } });
    const result = rollFormula("10+STR", char);
    expect(result.error).toBeUndefined();
    expect(result.total).toBe(8);
    expect(resolveFormulaDisplay("10+STR", char).display).toBe("8");
  });

  it("plain '-2': a bare negative literal with no variables or dice", () => {
    const char = makeCharacter();
    const result = rollFormula("-2", char);
    expect(result.error).toBeUndefined();
    expect(result.total).toBe(-2);
    expect(resolveFormulaDisplay("-2", char).display).toBe("-2");
  });

  it("KEYd20 with a negative key stat still fails loudly (a negative dice count can't roll — documented, deliberate), not with the wrong 'unrecognized token' error the sign-chain bug caused", () => {
    // Distinct from the bug above: here KEY substitutes directly into the
    // dice COUNT position ("KEYd20" -> "-2d20"), not a trailing modifier.
    // Nimble has no notion of rolling a negative number of dice, and this
    // project deliberately never guesses one — see the "dice lower bound /
    // negative count" decisions in CLAUDE.md (a leading "-" is caught by
    // Parser.parse's full-consumption check, on purpose). Must still
    // reject, just not by way of the "Unrecognized token" bug fixed above.
    const char = makeCharacter({
      stats: { str: -2, dex: 0, int: 0, wil: 0 },
      keyStat: "str",
    });
    const result = rollFormula("KEYd20", char);
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/unrecognized token/i);
    expect(result.rolls).toEqual([]);
  });
});

describe("substituteVariables stays purely semantic — does NOT normalize signs for display (part 1f)", () => {
  // Part 1e put sign-normalization INSIDE substituteVariables itself.
  // Part 1f moved it back out (see normalizeSubstitutedSignsForDisplay
  // below) — this block pins the reverted behavior: a glued "+-"/"--" is
  // expected, legitimate output here, not something this function cleans
  // up. See that function's own doc for the two reasons the move happened
  // (a presentation concern was leaking into a semantic pipeline stage,
  // AND normalizing only the armor term in isolation didn't even fix
  // computeDefense's actual bug, which was in how the bonus term got
  // joined on afterward).

  it("leaves a glued '+' followed by a negative substituted value as-is", () => {
    const ctx = { ...NO_CHARACTER_CTX, stats: { ...NO_CHARACTER_CTX.stats, dex: -2 } };
    expect(substituteVariables("3+DEX", ctx)).toBe("3+-2");
  });

  it("leaves a glued '-' followed by a negative substituted value as-is", () => {
    const ctx = { ...NO_CHARACTER_CTX, stats: { ...NO_CHARACTER_CTX.stats, dex: -2 } };
    expect(substituteVariables("3-DEX", ctx)).toBe("3--2");
  });

  it("still evaluates to the correct value regardless — Parser.parseUnary (part 1c) handles the chained sign at eval time, independent of this function", () => {
    const char = makeCharacter({ stats: { str: 0, dex: -2, int: 0, wil: 0 } });
    expect(evalFormula("3+DEX", char)).toEqual({ value: 1 });
    expect(evalFormula("3-DEX", char)).toEqual({ value: 5 });
  });

  it("real game data is spaced ('3 + DEX'), not glued ('3+DEX') — the substituted output keeps that whitespace, which is exactly what part 1g's normalizeSubstitutedSignsForDisplay fix had to account for (see that describe block)", () => {
    const ctx = { ...NO_CHARACTER_CTX, stats: { ...NO_CHARACTER_CTX.stats, dex: -2 } };
    expect(substituteVariables("3 + DEX", ctx)).toBe("3 + -2");
  });

  it("resolveFormulaDisplay is not exposed to the glued-sign shape either — it always evaluates through safeEval before formatting a number", () => {
    const char = makeCharacter({ stats: { str: 0, dex: -2, int: 0, wil: 0 } });
    expect(resolveFormulaDisplay("1d8+DEX", char).display).toBe("1d8-2");
    expect(resolveFormulaDisplay("3+DEX", char).display).toBe("1");
  });
});

describe("normalizeSubstitutedSignsForDisplay (part 1f, display-only)", () => {
  // The display-only counterpart to substituteVariables staying semantic
  // above — a caller that shows a substituted-but-unevaluated string
  // directly (computeDefense's breakdown) calls this explicitly instead.

  it("collapses '+' followed by a negative value to a single '-'", () => {
    expect(normalizeSubstitutedSignsForDisplay("3+-2")).toBe("3-2");
  });

  it("collapses '-' followed by a negative value to a single '+'", () => {
    expect(normalizeSubstitutedSignsForDisplay("3--2")).toBe("3+2");
  });

  it("normalizes every occurrence in the string, not just the first", () => {
    expect(normalizeSubstitutedSignsForDisplay("-1+-2+3")).toBe("-1-2+3");
  });

  it("leaves an already-clean sign untouched — no false-positive collapse", () => {
    expect(normalizeSubstitutedSignsForDisplay("3+2")).toBe("3+2");
    expect(normalizeSubstitutedSignsForDisplay("3-2")).toBe("3-2");
  });
});

describe("normalizeSubstitutedSignsForDisplay tolerates whitespace around the signs (part 1g)", () => {
  // Part 1f's regex only matched a sign glued with zero whitespace
  // ("3+-2"). Real armor formulas in equipment.ts are written with spaces
  // ("3 + DEX"), so substitution actually produces "3 + -2" — a space
  // between the literal "+" and the substituted "-2" — which part 1f's
  // test never exercised and the old regex never matched. This is the
  // exact bug reported after part 1f shipped: OBR showed
  // "3 + -2-2 = -1" instead of the intended "3-2-2 = -1".

  it("collapses '+' then a space then '-' (single space, the real equipment.ts shape)", () => {
    expect(normalizeSubstitutedSignsForDisplay("3 + -2")).toBe("3-2");
  });

  it("collapses '+' then two spaces then '-'", () => {
    expect(normalizeSubstitutedSignsForDisplay("3 +  -2")).toBe("3-2");
  });

  it("collapses '-' then a space then '-' to a single '+'", () => {
    expect(normalizeSubstitutedSignsForDisplay("3 - -2")).toBe("3+2");
  });

  it("reproduces and fixes the exact reported regression string", () => {
    // Before this app's very first sign-normalization attempt (part 1e):
    // "3 + -2 -2 = -1". After part 1f's zero-whitespace-only fix (the
    // bonus join got collapsed, the armor term's own "+ -" did not):
    // "3 + -2-2 = -1". After this part 1g fix, both collapse.
    expect(normalizeSubstitutedSignsForDisplay("3 + -2-2 = -1")).toBe("3-2-2 = -1");
  });

  it("does not falsely collapse two separate, already-clean negative terms with no whitespace between them", () => {
    // "-2-2" is two legitimate terms ("-2" armor/DEX, "-2" bonus), not a
    // glued double-sign: the "-" between them is immediately followed by a
    // digit, not another "-", on either pass.
    expect(normalizeSubstitutedSignsForDisplay("-2-2")).toBe("-2-2");
  });

  it("leaves an already-clean, spaced sign untouched — no false-positive collapse", () => {
    expect(normalizeSubstitutedSignsForDisplay("3 + 2")).toBe("3 + 2");
    expect(normalizeSubstitutedSignsForDisplay("3 - 2")).toBe("3 - 2");
  });
});

describe("game data validation (point 4)", () => {
  // Iterates every formula in src/data/spells.ts and src/data/equipment.ts
  // through validateFormula, and additionally requires a non-empty
  // diceNotation (via parseDamageFormula) for any formula whose raw text
  // looks like it should roll dice — this is what originally caught
  // d66/d88/d44 evaluating to a flat 0 instead of rolling.
  //
  // No hardcoded list of "known-bad" formulas: entries meant to be resolved
  // by a human rather than the engine (e.g. equipment reading
  // "WeaponDamage + 1d4", referencing a weapon this app has no variable
  // for) are marked in the DATA with `manualResolution: true` and excluded
  // here. Everything else must resolve cleanly — a newly added broken
  // formula fails this test on its own, nothing to remember to update by
  // hand.
  //
  // Checks `formula` alone, for both spells and equipment — `formula` is
  // the single source of truth for what's rollable (`CharacterAction` no
  // longer has a `damage` field at all as of the schema v2 migration; see
  // the "action.formula || action.damage fallback" and "damage removal"
  // bullets in CLAUDE.md). `CharacterAction` also has no `manualResolution`
  // (never set on any spell — removed in part 1c); `InventoryItem.manualResolution`
  // is still real (3 equipment entries use it) and still excluded here.
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
    ...BASIC_EQUIPMENTS.filter((e) => !e.manualResolution).map((e) => ({
      name: e.name,
      formula: e.formula ?? "",
    })),
  ].filter((e) => e.formula);

  it("has formula entries to check (sanity check that the data imports resolved)", () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it("excludes at least the known manualResolution equipment (sanity check the flag isn't silently ignored)", () => {
    const manualCount = BASIC_EQUIPMENTS.filter((e) => e.manualResolution).length;
    expect(manualCount).toBe(3); // Weapon of Animosity, Weapon of Wounding, Vindication
  });

  it("validates every rollable spell/equipment formula, with dice-shaped formulas producing real dice notation", () => {
    const failures: string[] = [];

    for (const { name, formula } of entries) {
      let validationError: string | null = null;
      try {
        validateFormula(formula, ctx);
      } catch (err) {
        validationError = err instanceof Error ? err.message : String(err);
      }

      let missingDice = false;
      if (!validationError && looksLikeDice(formula)) {
        try {
          const { diceNotation } = parseDamageFormula(formula, ctx);
          missingDice = diceNotation === "";
        } catch (err) {
          validationError = err instanceof Error ? err.message : String(err);
        }
      }

      if (validationError !== null) {
        failures.push(`${name} :: "${formula}" :: ${validationError}`);
      } else if (missingDice) {
        failures.push(
          `${name} :: "${formula}" :: looks like a dice formula but produced no dice notation`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it("every rollable entry's formula also passes validateFormulaSyntax, independent of any one character's context", () => {
    // Distinct from the test above: validateFormula needs a real character
    // context (dice-count/sides bounds are checked against it, and dynamic
    // dice like incrementdice/stepdice resolve differently per level).
    // validateFormulaSyntax needs neither — it's a pure "does this even
    // parse" gate (see its own doc comment), which is exactly the class of
    // bug that shipped here: "Special" isn't a bounds problem or a
    // level-dependent problem, it's not a formula at all. Kept as its own
    // assertion, on the same `entries` list, so this specific gate is
    // traceable on its own rather than folded into the mixed failure list
    // above.
    const failures: string[] = [];
    for (const { name, formula } of entries) {
      try {
        validateFormulaSyntax(formula);
      } catch (err) {
        failures.push(
          `${name} :: "${formula}" :: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });
});

// Part 1c's "game data guard" (BASE_SPELLS.damage must not orphan a real
// formula) lived here — removed alongside CharacterAction.damage itself in
// the schema v2 migration: the field no longer exists on either the type
// or the data, so the shape this test guarded against can't occur anymore.
// The equivalent concern for an EXISTING character's frozen action data
// (which may still have both fields in persisted metadata) is now covered
// by `characterMigrations.test.ts`'s "CharacterAction.damage removal"
// describe block instead — see `migrateActionDamageField` there.

describe("InventoryItem.manualResolution is honored by the roll path (isEngineRollableItem)", () => {
  // manualResolution is the fifth instance of the same failure mode in this
  // codebase (d66, KEYd20, LVL, FLAW, now this one): a field documented in
  // prose — its own JSDoc claimed "not a formula meant to be evaluated or
  // rolled by the engine" — that nothing actually wired up. Weapon of
  // Animosity/Weapon of Wounding/Vindication all rendered a working-looking
  // roll button that threw a formula error the moment anyone clicked it.
  //
  // Mirrors the "FormulaContext contract" reflective test above (see its
  // comment): the common failure isn't a missing variable/field, it's that
  // nothing verifies a *documented* one is actually wired. Drives off the
  // DATA (BASIC_EQUIPMENTS), not a hardcoded list of item names, so a
  // future entry that sets `manualResolution: true` is covered
  // automatically — and removing the `isEngineRollableItem` check from a
  // UI call site (InventoryTab's roll button/favorites filter, CombatTab's
  // favorites filter) turns this test red.
  const manualEntries = BASIC_EQUIPMENTS.filter((e) => e.manualResolution);

  it("has at least the known manualResolution equipment to check (sanity check the flag isn't silently ignored)", () => {
    expect(manualEntries.length).toBe(3); // Weapon of Animosity, Weapon of Wounding, Vindication
  });

  it("every manualResolution equipment entry is treated as non-rollable by isEngineRollableItem", () => {
    const offenders = manualEntries
      .filter((e) => isEngineRollableItem(e))
      .map((e) => e.name);

    expect(offenders).toEqual([]);
  });

  it("a normal equipment entry with a real formula is still treated as rollable (sanity check the flag isn't over-broad)", () => {
    const normalRollable = BASIC_EQUIPMENTS.find(
      (e) => !e.manualResolution && !e.isArmor && e.formula,
    );
    expect(normalRollable).toBeDefined();
    expect(isEngineRollableItem(normalRollable!)).toBe(true);
  });

  it("an item with no formula at all is non-rollable regardless of manualResolution", () => {
    expect(isEngineRollableItem({ formula: "", manualResolution: false })).toBe(false);
    expect(isEngineRollableItem({ manualResolution: false })).toBe(false);
  });

  it("every isArmor equipment entry is treated as non-rollable, even though armor carries a real formula", () => {
    const armorEntries = BASIC_EQUIPMENTS.filter((e) => e.isArmor);
    expect(armorEntries.length).toBeGreaterThan(0);
    // Sanity check: armor entries do carry a formula (it's what
    // computeDefense evaluates) — the exclusion below must be driven by
    // isArmor, not by these entries happening to have no formula.
    expect(armorEntries.every((e) => !!e.formula)).toBe(true);

    const offenders = armorEntries
      .filter((e) => isEngineRollableItem(e))
      .map((e) => e.name);
    expect(offenders).toEqual([]);
  });
});

describe("validateFormulaSyntax: write-time gate validates syntax, not resolved values (point 8)", () => {
  // validateFormula (still used with a real character/context elsewhere)
  // enforces dice-count/sides bounds; validateFormulaSyntax deliberately
  // does not, against any context, including the synthetic one it
  // substitutes with internally — bounds are a roll-time concern. See the
  // doc comment on validateFormulaSyntax for the full reasoning.

  it("accepts KEYd20 regardless of any character's actual key stat", () => {
    // The motivating case: a GM whose character has no keyStat set yet
    // (KEY resolves to 0 for a real character in that state) must not
    // have "KEYd20" rejected at save time — it's valid notation for
    // whoever eventually uses it with a key stat set.
    expect(() => validateFormulaSyntax("KEYd20")).not.toThrow();
    expect(formulaSyntaxError("KEYd20")).toBeUndefined();
  });

  it("accepts a literal formula that would fail the dice-count/sides bounds, with no variables involved at all", () => {
    // Not KEY-specific: the decision is "bounds are never a write-time
    // concern", not "only when a variable happens to be involved".
    expect(formulaSyntaxError("99999d6")).toBeUndefined();
    expect(formulaSyntaxError("1d99999")).toBeUndefined();
    expect(formulaSyntaxError("0d20")).toBeUndefined();
  });

  it("accepts dynamic dice whose count only exceeds the limit at a level nowhere near the neutral context's", () => {
    // incrementdice(1, LEVEL)d6 is 1 die at level 1 (the neutral context)
    // but would be well over MAX_DICE_COUNT at a very high level. No
    // single neutral value, and no pair of "extremes", makes a bound
    // check here meaningful for every level in between — so it isn't
    // attempted at all. The real bound still applies at roll time; see
    // the "still enforces bounds against a real character" tests below.
    expect(formulaSyntaxError("incrementdice(1,LEVEL)d6")).toBeUndefined();

    // A base large enough to exceed MAX_DICE_COUNT even at the neutral
    // context's own level=1 (count = base + floor(level/5) = 150 + 0):
    // unlike the base=1 case just above (which stays in-bounds at level 1
    // either way), this one actually distinguishes "bounds are checked"
    // from "bounds are not checked", so it would catch enforceLimits
    // being wired back to true by mistake.
    expect(formulaSyntaxError("incrementdice(150,LEVEL)d6")).toBeUndefined();
  });

  it("still enforces bounds against a real character, via the unchanged validateFormula, at the same LEVEL that validateFormulaSyntax waves through", () => {
    const ctx = buildContext(makeCharacter({ level: 500 }));
    expect(() => validateFormula("incrementdice(1,LEVEL)d6", ctx)).toThrow();
    const charNoKey = makeCharacter({ keyStat: null });
    // KEYd20 -> "0d20" for this real character; validateFormula (the
    // context-bound gate, not validateFormulaSyntax) must still reject it.
    expect(() => validateFormula("KEYd20", buildContext(charNoKey))).toThrow();
  });

  it("still rejects genuine syntax problems: unrecognized tokens, wrong function arity, and over-length formulas", () => {
    expect(formulaSyntaxError("garbage(1)")).toBeDefined();
    expect(formulaSyntaxError("min(1,2,3)")).toContain("min() takes 2 arguments");
    expect(formulaSyntaxError("min(1)")).toContain("min() takes 2 arguments");
    expect(formulaSyntaxError("1+".repeat(150) + "1")).toBeDefined();
  });

  it("treats a blank or whitespace-only formula as valid, not an error (an optional formula is not a syntax problem)", () => {
    expect(formulaSyntaxError("")).toBeUndefined();
    expect(formulaSyntaxError("   ")).toBeUndefined();
  });

  it("formulaSyntaxError never throws for a FormulaError, matching evalFormula/rollFormula's non-throwing contract", () => {
    expect(() => formulaSyntaxError("garbage(1)")).not.toThrow();
  });
});
