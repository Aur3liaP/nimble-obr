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

describe("game data validation (point 4)", () => {
  // Iterates every formula in src/data/spells.ts and src/data/equipment.ts
  // through validateFormula, and additionally requires a non-empty
  // diceNotation (via parseDamageFormula) for any formula whose raw text
  // looks like it should roll dice — this is what originally caught
  // d66/d88/d44 evaluating to a flat 0 instead of rolling.
  //
  // No hardcoded list of "known-bad" formulas: entries meant to be resolved
  // by a human rather than the engine (e.g. "WeaponDamage + 1d4" on a magic
  // item, referencing a weapon this app has no variable for) are marked in
  // the DATA with `manualResolution: true` and excluded here. Everything
  // else must resolve cleanly — a newly added broken formula fails this
  // test on its own, nothing to remember to update by hand.
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
    ...BASE_SPELLS.filter((s) => !s.manualResolution).map((s) => ({
      name: s.name,
      formula: s.formula,
    })),
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

  it("validates every non-manualResolution spell/equipment formula, with dice-shaped formulas producing real dice notation", () => {
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
});
