/**
 * Safe formula evaluator for Nimble character sheet.
 *
 * Supports:
 *  - Stat references: STR, DEX, INT, WIL (case-insensitive)
 *  - Skill references: MIGHT, STEALTH, etc.
 *  - Level: LEVEL
 *  - Dice notation: NdX (e.g. 1d8, 2d6) — returns avg for formula display,
 *    actual rolling is delegated to handleRoll / OBR dice
 *  - Math: +  -  *  /  floor()  ceil()  Math.floor()  Math.ceil()
 *  - Parentheses
 *
 * We deliberately avoid eval() and use a tiny recursive descent parser.
 */

import type { NimbleCharacter, Skills, Stats } from '../types/character';

// ─────────────────────────────────────────────────────────────────
// Variable substitution
// ─────────────────────────────────────────────────────────────────

type FormulaContext = {
  level: number;
  stats: Stats;
  skills: Skills;
  hp?: number;
  maxHp?: number;
};

/**
 * Build a flat variable map from a character (or partial context).
 */
export function buildContext(char: NimbleCharacter): FormulaContext {
  return {
    level: char.level,
    stats: char.stats,
    skills: char.skills,
    hp: char.hp.current,
    maxHp: char.hp.max,
  };
}

/**
 * Replace named variables in a formula string with numeric values.
 * Returns the substituted string ready for arithmetic parsing.
 */
function substituteVariables(
  formula: string,
  ctx: FormulaContext
): string {
  let f = formula.trim().toUpperCase();

  // Stats
  f = f.replace(/\bSTR\b/g, String(ctx.stats.str));
  f = f.replace(/\bDEX\b/g, String(ctx.stats.dex));
  f = f.replace(/\bINT\b/g, String(ctx.stats.int));
  f = f.replace(/\bWIL\b/g, String(ctx.stats.wil));

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
  f = f.replace(/MATH\.FLOOR\(/g, 'floor(');
  f = f.replace(/MATH\.CEIL\(/g, 'ceil(');
  f = f.toLowerCase(); // parser works in lowercase

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
 * Extract the dice part and modifier separately from a formula like "1d8+STR".
 * Returns { diceNotation, modifier } where modifier is the numeric bonus.
 */
export function parseDamageFormula(
  formula: string,
  ctx: FormulaContext
): { diceNotation: string; modifier: number } {
  // Substitute variables first, then split dice from modifiers
  const subbed = substituteVariables(formula, ctx);

  // Extract leading NdX
  const diceMatch = subbed.match(/^(\d+d\d+)/i);
  if (!diceMatch) {
    // No dice — pure modifier
    const mod = safeEval(subbed);
    return { diceNotation: '', modifier: isNaN(mod) ? 0 : mod };
  }

  const diceNotation = diceMatch[1];
  const rest = subbed.slice(diceNotation.length); // e.g.  "+2+3"
  const modifier = rest.trim() ? safeEval(rest) : 0;

  return { diceNotation, modifier: isNaN(modifier) ? 0 : modifier };
}

// ─────────────────────────────────────────────────────────────────
// Tiny recursive descent arithmetic parser (no eval, no regex exec)
// Supports: numbers, +  -  *  /  (  )  floor(  ceil(
// ─────────────────────────────────────────────────────────────────

class Parser {
  private pos = 0;
  constructor(private readonly input: string) {}

  private peek(): string {
    this.skipWhitespace();
    return this.input[this.pos] ?? '';
  }

  private consume(): string {
    this.skipWhitespace();
    return this.input[this.pos++] ?? '';
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
      if (ch === '+') { this.consume(); left += this.parseTerm(); }
      else if (ch === '-') { this.consume(); left -= this.parseTerm(); }
      else break;
    }
    return left;
  }

  /** term = unary (('*' | '/') unary)* */
  private parseTerm(): number {
    let left = this.parseUnary();
    while (true) {
      const ch = this.peek();
      if (ch === '*') { this.consume(); left *= this.parseUnary(); }
      else if (ch === '/') {
        this.consume();
        const right = this.parseUnary();
        left = right !== 0 ? left / right : 0;
      } else break;
    }
    return left;
  }

  /** unary = '-' primary | primary */
  private parseUnary(): number {
    if (this.peek() === '-') {
      this.consume();
      return -this.parsePrimary();
    }
    return this.parsePrimary();
  }

  /** primary = number | '(' expr ')' | 'floor' '(' expr ')' | 'ceil' '(' expr ')' */
  private parsePrimary(): number {
    this.skipWhitespace();

    // floor(
    if (this.input.startsWith('floor(', this.pos)) {
      this.pos += 6; // skip "floor("
      const val = this.parseExpr();
      if (this.peek() === ')') this.consume();
      return Math.floor(val);
    }

    // ceil(
    if (this.input.startsWith('ceil(', this.pos)) {
      this.pos += 5;
      const val = this.parseExpr();
      if (this.peek() === ')') this.consume();
      return Math.ceil(val);
    }

    // Parenthesised expression
    if (this.peek() === '(') {
      this.consume();
      const val = this.parseExpr();
      if (this.peek() === ')') this.consume();
      return val;
    }

    // Number (integer or float, possibly negative sign was already handled)
    const start = this.pos;
    this.skipWhitespace();
    if (/[\d.]/.test(this.input[this.pos] ?? '')) {
      while (this.pos < this.input.length && /[\d.]/.test(this.input[this.pos])) {
        this.pos++;
      }
      return parseFloat(this.input.slice(start, this.pos)) || 0;
    }

    return 0; // Unknown token — return 0 gracefully
  }
}

/**
 * Safely evaluate a pure arithmetic string (no dice, no variables).
 * Returns NaN on parse failure.
 */
export function safeEval(expr: string): number {
  try {
    // Guard: only allow digits, operators, parens, dots, whitespace, and our
    // known function names. Reject anything else.
    const sanitised = expr.replace(/\s+/g, ' ').trim();
    if (!/^[\d\s\+\-\*\/\(\)\.\bfloor\bceil]+$/.test(sanitised.replace(/floor|ceil/g, ''))) {
      // If unknown chars remain after removing known identifiers, bail.
      const unknown = sanitised.replace(/[\d\s\+\-\*\/\(\)\.floor ceil]+/g, '');
      if (unknown.length > 0) return NaN;
    }
    return new Parser(sanitised).parse();
  } catch {
    return NaN;
  }
}

// ─────────────────────────────────────────────────────────────────
// Main public API
// ─────────────────────────────────────────────────────────────────

/**
 * Evaluate a formula that may contain variables (STR, DEX, LEVEL…)
 * and dice notation (treated as average).
 *
 * @example
 *   evalFormula("1d10 + STR + floor(LEVEL / 2)", char) → 7
 */
export function evalFormula(
  formula: string,
  char: NimbleCharacter
): number {
  const ctx = buildContext(char);
  return evalFormulaWithContext(formula, ctx);
}

/**
 * Same as evalFormula but accepts a raw context (useful in hooks/tests).
 */
export function evalFormulaWithContext(
  formula: string,
  ctx: FormulaContext
): number {
  try {
    let f = substituteVariables(formula, ctx);
    f = diceToAverage(f); // Replace NdX with average before arithmetic
    const result = safeEval(f);
    return isNaN(result) ? 0 : result;
  } catch {
    return 0;
  }
}

/**
 * Resolve a formula to a display string, e.g. "1d8+3".
 * Variables are substituted but dice are kept for display purposes.
 */
export function resolveFormulaDisplay(
  formula: string,
  char: NimbleCharacter
): string {
  const ctx = buildContext(char);
  let f = substituteVariables(formula, ctx);
  // Evaluate non-dice parts but keep dice notation
  // e.g. "1d8 + 2 + 1" → "1d8+3"
  const diceMatch = f.match(/\d+d\d+/i);
  if (!diceMatch) {
    const val = safeEval(f);
    return isNaN(val) ? formula : String(val);
  }

  const dicePart = diceMatch[0];
  const rest = f.replace(dicePart, '0');
  const modifier = safeEval(rest);

  if (isNaN(modifier) || modifier === 0) return dicePart;
  if (modifier > 0) return `${dicePart}+${modifier}`;
  return `${dicePart}${modifier}`; // negative already has the sign
}

// ─────────────────────────────────────────────────────────────────
// Dice rolling utilities (non-OBR, pure JS — for local instant rolls)
// ─────────────────────────────────────────────────────────────────

/** Roll a single die with N sides */
export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Roll NdX and return individual results.
 * e.g. rollDice(2, 6) → [3, 5]
 */
export function rollDice(count: number, sides: number): number[] {
  return Array.from({ length: count }, () => rollDie(sides));
}

/**
 * Parse and roll a formula like "2d6+STR", returning the full breakdown.
 */
export function rollFormula(
  formula: string,
  char: NimbleCharacter,
  mode: 'standard' | 'advantage' | 'disadvantage' = 'standard',
  extraDice = 0
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

  let rolls: number[] = [];
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
      diceNotation: '',
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
  rolls = rollDice(totalCount, sides);

  let kept: number[];
  if (mode === 'standard' && extraDice === 0) {
    kept = rolls;
  } else if (mode === 'advantage' || extraDice > 0) {
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
