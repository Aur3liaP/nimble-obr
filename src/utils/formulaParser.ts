/**
 * @file Safe formula evaluator for the Nimble character sheet.
 *
 * Supports:
 *  - Stat references: STR, DEX, INT, WIL (case-insensitive)
 *  - Skill references: MIGHT, STEALTH, etc.
 *  - LEVEL, KEY (key stat value), FLAW (flaw stat value)
 *  - Dice notation: NdX (e.g. 1d8, 2d6) — averaged for display/modifier math;
 *    actual random rolling is done separately by {@link rollFormula}
 *  - Math: + - * / floor() ceil() min() max()
 *  - Custom helpers: incrementdice(base, level), stepdice(level, d1, d2, d3, d4)
 *  - Parentheses
 *
 * Deliberately avoids eval() — uses a small hand-written recursive descent
 * parser instead, so formulas typed by players/GMs can never execute
 * arbitrary JS.
 */

import type { NimbleCharacter, Skills, Stats } from "../types/character";

// ─────────────────────────────────────────────────────────────────
// Variable substitution
// ─────────────────────────────────────────────────────────────────

type FormulaContext = {
  level: number;
  stats: Stats;
  key: number;
  flaw: number;
  skills: Skills;
  hp?: number;
  maxHp?: number;
};

/**
 * Flattens a character into the variable map used by formula substitution.
 *
 * @param char - The character to build a formula context from.
 * @returns A {@link FormulaContext} exposing level, stats, key/flaw stat
 * values, skills, and current/max HP for variable substitution.
 */
export function buildContext(char: NimbleCharacter): FormulaContext {
  const keyValue = char.keyStat ? char.stats[char.keyStat] : 0;
  const flawValue = char.flawStat ? char.stats[char.flawStat] : 0;

  return {
    level: char.level,
    stats: char.stats,
    key: keyValue,
    flaw: flawValue,
    skills: char.skills,
    hp: char.hp.current,
    maxHp: char.hp.max,
  };
}

/**
 * Replaces all known variable tokens (STR, DEX, LEVEL, skill names, HP…)
 * in a formula string with their numeric values from the given context.
 * Also normalizes `Math.floor(`/`Math.ceil(`/`Math.min(`/`Math.max(` to the
 * lowercase tokens the parser understands.
 *
 * @param formula - Raw formula string as typed by the user (e.g. "1d8+STR").
 * @param ctx - Context built by {@link buildContext}.
 * @returns The formula with variables replaced, lowercased, ready for
 * dice/arithmetic parsing.
 */
function substituteVariables(formula: string, ctx: FormulaContext): string {
  let f = formula.trim().toUpperCase();

  // Stats
  f = f.replace(/\bSTR\b/g, String(ctx.stats.str));
  f = f.replace(/\bDEX\b/g, String(ctx.stats.dex));
  f = f.replace(/\bINT\b/g, String(ctx.stats.int));
  f = f.replace(/\bWIL\b/g, String(ctx.stats.wil));

  f = f.replace(/\bKEY\b/g, String(ctx.key));

  // Level
  f = f.replace(/\bLEVEL\b/g, String(ctx.level));

  // Skills
  f = f.replace(/\bARCANA\b/g, String(ctx.skills.arcana));
  f = f.replace(/\bEXAMINATION\b/g, String(ctx.skills.examination));
  f = f.replace(/\bFINESSE\b/g, String(ctx.skills.finesse));
  f = f.replace(/\bINFLUENCE\b/g, String(ctx.skills.influence));
  f = f.replace(/\bINSIGHT\b/g, String(ctx.skills.insight));
  f = f.replace(/\bLORE\b/g, String(ctx.skills.lore));
  f = f.replace(/\bMIGHT\b/g, String(ctx.skills.might));
  f = f.replace(/\bNATURECRAFT\b/g, String(ctx.skills.naturecraft));
  f = f.replace(/\bPERCEPTION\b/g, String(ctx.skills.perception));
  f = f.replace(/\bSTEALTH\b/g, String(ctx.skills.stealth));

  // HP
  f = f.replace(/\bHP\b/g, String(ctx.hp ?? 0));
  f = f.replace(/\bMAXHP\b/g, String(ctx.maxHp ?? 0));

  // floor / ceil shorthands → keep as tokens for the parser
  f = f.replace(/MATH\.FLOOR\(/g, "floor(");
  f = f.replace(/MATH\.CEIL\(/g, "ceil(");
  f = f.replace(/MATH\.MIN\(/g, "min(");
  f = f.replace(/MATH\.MAX\(/g, "max(");
  f = f.toLowerCase(); // parser works in lowercase

  // Custom
  f = f.replace(/\bINCREMENTDICE\(/g, "incrementdice(");
  f = f.replace(/\bSTEPDICE\(/g, "stepdice(");

  return f;
}

// ─────────────────────────────────────────────────────────────────
// Dice notation helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Replace NdX tokens with their *average* value (for static display /
 * modifier computation).  Actual random rolling uses OBR dice or rollDice().
 */
export function diceToAverage(formula: string): string {
  // e.g.  2d6  →  7   (average of 2×(1+6)/2)
  return formula.replace(/(\d+)d(\d+)/gi, (_match, count, sides) => {
    const n = parseInt(count, 10);
    const s = parseInt(sides, 10);
    const avg = Math.round(n * ((1 + s) / 2));
    return String(avg);
  });
}

/**
 * Splits a formula into its leading dice notation and its numeric modifier.
 *
 * @example parseDamageFormula("1d8+STR+2", ctx) // → { diceNotation: "1d8", modifier: <STR+2> }
 *
 * @param formula - Raw formula (may contain variables and dice).
 * @param ctx - Context used to resolve variables before splitting.
 * @returns The dice part (e.g. "1d8") and the resolved numeric modifier.
 * If there is no leading dice notation, `diceNotation` is empty and the
 * whole formula is evaluated as the modifier.
 */
export function parseDamageFormula(
  formula: string,
  ctx: FormulaContext,
): { diceNotation: string; modifier: number } {
  // Substitute variables first, then split dice from modifiers
  let subbed = substituteVariables(formula, ctx);
  subbed = resolveDynamicDice(subbed);

  // Extract leading NdX
  const diceMatch = subbed.match(/^(\d+d\d+)/i);
  if (!diceMatch) {
    // No dice — pure modifier
    const mod = safeEval(subbed);
    return { diceNotation: "", modifier: isNaN(mod) ? 0 : mod };
  }

  const diceNotation = diceMatch[1];
  const rest = subbed.slice(diceNotation.length); // e.g.  "+2+3"
  const modifier = rest.trim() ? safeEval(rest) : 0;

  return { diceNotation, modifier: isNaN(modifier) ? 0 : modifier };
}

/**
 * Minimal recursive-descent arithmetic parser (no `eval`).
 *
 * Grammar (informal):
 * ```
 * expr    := term (('+' | '-') term)*
 * term    := unary (('*' | '/') unary)*
 * unary   := '-' primary | primary
 * primary := number | '(' expr ')' | floor(expr) | ceil(expr)
 *          | min(expr, expr) | max(expr, expr)
 *          | incrementdice(base, level) | stepdice(level, d1, d2, d3, d4)
 * ```
 *
 * Used internally by {@link safeEval}; not exported.
 */

class Parser {
  private readonly input: string;
  private pos = 0;
  constructor(input: string) {
    this.input = input;
  }

  private peek(): string {
    this.skipWhitespace();
    return this.input[this.pos] ?? "";
  }

  private consume(): string {
    this.skipWhitespace();
    return this.input[this.pos++] ?? "";
  }

  private skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  /** Entry point */
  parse(): number {
    const result = this.parseExpr();
    return result;
  }

  /** expr = term (('+' | '-') term)* */
  private parseExpr(): number {
    let left = this.parseTerm();
    while (true) {
      const ch = this.peek();
      if (ch === "+") {
        this.consume();
        left += this.parseTerm();
      } else if (ch === "-") {
        this.consume();
        left -= this.parseTerm();
      } else break;
    }
    return left;
  }

  /** term = unary (('*' | '/') unary)* */
  private parseTerm(): number {
    let left = this.parseUnary();
    while (true) {
      const ch = this.peek();
      if (ch === "*") {
        this.consume();
        left *= this.parseUnary();
      } else if (ch === "/") {
        this.consume();
        const right = this.parseUnary();
        left = right !== 0 ? left / right : 0;
      } else break;
    }
    return left;
  }

  /** unary = '-' primary | primary */
  private parseUnary(): number {
    if (this.peek() === "-") {
      this.consume();
      return -this.parsePrimary();
    }
    return this.parsePrimary();
  }

  /** primary = number | '(' expr ')' | 'floor' '(' expr ')' | 'ceil' '(' expr ')' */
  private parsePrimary(): number {
    this.skipWhitespace();

    // floor(
    if (this.input.startsWith("floor(", this.pos)) {
      this.pos += 6; // skip "floor("
      const val = this.parseExpr();
      if (this.peek() === ")") this.consume();
      return Math.floor(val);
    }

    // ceil(
    if (this.input.startsWith("ceil(", this.pos)) {
      this.pos += 5;
      const val = this.parseExpr();
      if (this.peek() === ")") this.consume();
      return Math.ceil(val);
    }

    // Parenthesised expression
    if (this.peek() === "(") {
      this.consume();
      const val = this.parseExpr();
      if (this.peek() === ")") this.consume();
      return val;
    }

    // Number (integer or float, possibly negative sign was already handled)
    const start = this.pos;
    this.skipWhitespace();
    if (/[\d.]/.test(this.input[this.pos] ?? "")) {
      while (
        this.pos < this.input.length &&
        /[\d.]/.test(this.input[this.pos])
      ) {
        this.pos++;
      }
      return parseFloat(this.input.slice(start, this.pos)) || 0;
    }

    // Min & Max
    if (this.input.startsWith("min(", this.pos)) {
      this.pos += 4;
      const a = this.parseExpr();
      if (this.peek() === ",") this.consume();
      const b = this.parseExpr();
      if (this.peek() === ")") this.consume();
      return Math.min(a, b);
    }

    if (this.input.startsWith("max(", this.pos)) {
      this.pos += 4;
      const a = this.parseExpr();
      if (this.peek() === ",") this.consume();
      const b = this.parseExpr();
      if (this.peek() === ")") this.consume();
      return Math.max(a, b);
    }

    // Custom
    // incrementdice(baseSides, level)
    if (this.input.startsWith("incrementdice(", this.pos)) {
      this.pos += "incrementdice(".length;
      const baseSides = this.parseExpr();

      if (this.peek() === ",") this.consume();
      const level = this.parseExpr();

      if (this.peek() === ")") this.consume();
      const increments = Math.floor(level / 5);

      return baseSides + increments * 2;
    }

    // stepdice(level, d1, d2, d3, d4)
    if (this.input.startsWith("stepdice(", this.pos)) {
      this.pos += "stepdice(".length;
      const level = this.parseExpr();

      if (this.peek() === ",") this.consume();
      const d1 = this.parseExpr();

      if (this.peek() === ",") this.consume();
      const d2 = this.parseExpr();

      if (this.peek() === ",") this.consume();
      const d3 = this.parseExpr();

      if (this.peek() === ",") this.consume();
      const d4 = this.parseExpr();

      if (this.peek() === ")") this.consume();

      if (level >= 15) return d4;
      if (level >= 10) return d3;
      if (level >= 5) return d2;
      return d1;
    }

    return 0; // Unknown token — return 0 gracefully
  }
}

/**
 * Safely evaluates a pure arithmetic expression (variables/dice must
 * already be substituted) using {@link Parser} instead of `eval`.
 *
 * @param expr - Arithmetic-only string (digits, `+ - * / ( ) , a-z`).
 * @returns The computed number, or `NaN` if the expression fails a basic
 * character whitelist check or otherwise fails to parse.
 */
export function safeEval(expr: string): number {
  try {
    const sanitised = expr.replace(/\s+/g, " ").trim();

    if (!/^[\d\s+\-*/().,a-z]+$/i.test(sanitised)) {
      return NaN;
    }

    return new Parser(sanitised).parse();
  } catch {
    return NaN;
  }
}

/**
 * Resolves the project's two custom dynamic-dice helpers into plain NdX
 * notation before the rest of the pipeline (averaging / rolling) runs.
 *
 * - `1dstepdice(level, d1, d2, d3, d4)` → picks the die size based on level
 *   breakpoints (5/10/15).
 * - `incrementdice(base, level)dSIDES` → increases dice count by
 *   `floor(level / 5)` on top of `base`.
 *
 * @param formula - Formula string with variables already substituted.
 * @returns The formula with custom dice helpers expanded to plain `NdX`.
 */
function resolveDynamicDice(formula: string): string {
  formula = formula.replace(/1dstepdice\(([^)]+)\)/gi, (_match, args) => {
    const [level, d1, d2, d3, d4] = args
      .split(",")
      .map((v: string) => Number(v.trim()));

    if (level >= 15) return `1d${d4}`;
    if (level >= 10) return `1d${d3}`;
    if (level >= 5) return `1d${d2}`;

    return `1d${d1}`;
  });

  formula = formula.replace(
    /incrementdice\((\d+),(\d+)\)d(\d+)/gi,
    (_match, base, level, sides) => {
      const count = Number(base) + Math.floor(Number(level) / 5);

      return `${count}d${sides}`;
    },
  );

  return formula;
}

// ─────────────────────────────────────────────────────────────────
// Main public API
// ─────────────────────────────────────────────────────────────────

/**
 * Evaluates a formula to a single number for a given character, treating
 * any dice notation as its statistical average (not a real roll).
 *
 * @example evalFormula("1d10 + STR + floor(LEVEL / 2)", char) // → 7
 *
 * @param formula - Formula string (variables + optional dice notation).
 * @param char - Character providing stats/skills/level context.
 * @returns The resolved numeric value, or 0 on any parse error.
 */
export function evalFormula(formula: string, char: NimbleCharacter): number {
  const ctx = buildContext(char);
  return evalFormulaWithContext(formula, ctx);
}

/**
 * Same as {@link evalFormula} but takes a pre-built {@link FormulaContext}
 * directly, useful for tests or call sites that don't have a full
 * `NimbleCharacter` (e.g. free rolls).
 */
export function evalFormulaWithContext(
  formula: string,
  ctx: FormulaContext,
): number {
  try {
    let f = substituteVariables(formula, ctx);
    f = resolveDynamicDice(f);
    f = diceToAverage(f); // Replace NdX with average before arithmetic
    const result = safeEval(f);
    return isNaN(result) ? 0 : result;
  } catch {
    return 0;
  }
}

/**
 * Resolves a formula to a human-readable display string for the UI,
 * substituting variables but *keeping* dice notation intact (e.g.
 * "1d8 + STR + 2" → "1d8+5"), so players see what they're about to roll.
 *
 * @param formula - Raw formula as stored on the action/spell/item.
 * @param char - Character providing the variable values.
 * @returns A simplified display string, or the original formula if nothing
 * could be resolved.
 */
export function resolveFormulaDisplay(
  formula: string,
  char: NimbleCharacter,
): string {
  const ctx = buildContext(char);
  let f = substituteVariables(formula, ctx);
  f = resolveDynamicDice(f);
  // Evaluate non-dice parts but keep dice notation
  // e.g. "1d8 + 2 + 1" → "1d8+3"
  const diceMatch = f.match(/\d+d\d+/i);
  if (!diceMatch) {
    const val = safeEval(f);
    return isNaN(val) ? formula : String(val);
  }

  const dicePart = diceMatch[0];
  const rest = f.replace(dicePart, "0");
  const modifier = safeEval(rest);

  if (isNaN(modifier) || modifier === 0) return dicePart;
  if (modifier > 0) return `${dicePart}+${modifier}`;
  return `${dicePart}${modifier}`; // negative already has the sign
}

// ─────────────────────────────────────────────────────────────────
// Dice rolling utilities (non-OBR, pure JS — for local instant rolls)
// ─────────────────────────────────────────────────────────────────

/** Rolls a single die with the given number of sides using `Math.random`. */
export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Rolls `count` independent dice with `sides` faces each.
 * @returns An array of individual results, e.g. `rollDice(2, 6)` → `[3, 5]`.
 */
export function rollDice(count: number, sides: number): number[] {
  return Array.from({ length: count }, () => rollDie(sides));
}

/**
 * Fully resolves and rolls a formula for a character, including
 * advantage/disadvantage handling and critical/fumble detection.
 *
 * Advantage adds `extraDice` additional dice and keeps the highest
 * `count` results; disadvantage keeps the lowest. A roll is critical if
 * the first kept die shows the maximum face value, and a fumble if it
 * shows 1.
 *
 * @param formula - Raw formula, e.g. "2d6+STR".
 * @param char - Character providing variable values.
 * @param mode - "standard" | "advantage" | "disadvantage".
 * @param extraDice - Number of extra dice to roll for advantage/disadvantage
 * (ignored in standard mode).
 * @returns Full breakdown: dice notation, all rolls, kept rolls, modifier,
 * total, and critical/fumble flags. If the formula has no dice (a flat
 * modifier), `rolls`/`kept` are empty and `total` equals the modifier.
 */
export function rollFormula(
  formula: string,
  char: NimbleCharacter,
  mode: "standard" | "advantage" | "disadvantage" = "standard",
  extraDice = 0,
): {
  diceNotation: string;
  rolls: number[];
  kept: number[];
  modifier: number;
  total: number;
  isCritical: boolean;
  isFumble: boolean;
} {
  const ctx = buildContext(char);
  const { diceNotation, modifier } = parseDamageFormula(formula, ctx);
  let sides = 20;
  let count = 1;

  if (diceNotation) {
    const m = diceNotation.match(/^(\d+)d(\d+)$/i);
    if (m) {
      count = parseInt(m[1], 10);
      sides = parseInt(m[2], 10);
    }
  } else {
    // No dice in formula, e.g. flat "+3"
    return {
      diceNotation: "",
      rolls: [],
      kept: [],
      modifier,
      total: modifier,
      isCritical: false,
      isFumble: false,
    };
  }

  // Advantage/disadvantage adds extra dice, keep best/worst
  const extraCount = Math.abs(extraDice);
  const totalCount = count + extraCount;
  const rolls = rollDice(totalCount, sides);

  let kept: number[];
  if (mode === "standard" && extraDice === 0) {
    kept = rolls;
  } else if (mode === "advantage" || extraDice > 0) {
    // Keep highest `count` dice
    const sorted = [...rolls].sort((a, b) => b - a);
    kept = sorted.slice(0, count);
  } else {
    // Disadvantage — keep lowest `count` dice
    const sorted = [...rolls].sort((a, b) => a - b);
    kept = sorted.slice(0, count);
  }

  const diceSum = kept.reduce((a, b) => a + b, 0);
  const total = diceSum + modifier;

  // Critical: primary die shows max value
  const isCritical = kept[0] === sides;
  // Fumble: primary die shows 1
  const isFumble = kept[0] === 1;

  return { diceNotation, rolls, kept, modifier, total, isCritical, isFumble };
}
