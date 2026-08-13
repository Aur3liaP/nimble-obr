/**
 * @file Safe formula evaluator for the Nimble character sheet.
 *
 * Supports:
 *  - Stat references: STR, DEX, INT, WIL (case-insensitive)
 *  - Skill references: MIGHT, STEALTH, etc.
 *  - LEVEL, KEY (key stat value), FLAW (flaw stat value)
 *  - LVL as a deliberate alias for LEVEL: the Nimble rulebook itself uses
 *    "LVL" (e.g. official formula shorthand like "+5/5lvl"), and the game
 *    data in src/data/spells.ts has at least one real spell formula written
 *    as "LVL" rather than "LEVEL" — both are genuine, supported notation,
 *    not a typo to "fix" by rewriting the data. Do not remove this as
 *    "redundant" with LEVEL.
 *  - Dice notation: NdX (e.g. 1d8, 2d6), or implicit-count dN (e.g. Nimble's
 *    single-die d44/d66/d88), normalized to 1dN — averaged for display/
 *    modifier math; actual random rolling is done separately by
 *    {@link rollFormula}
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
// Safety limits — prevent pathological input from a player/GM-typed
// formula from freezing or crashing a client (theirs or anyone else's
// who later views the same character/spell/item).
// ─────────────────────────────────────────────────────────────────

/** Maximum accepted length for any raw formula string before parsing. */
const MAX_FORMULA_LENGTH = 200;

/** Maximum recursion depth allowed in the parser (guards against deeply nested parentheses/functions). */
const MAX_PARSE_DEPTH = 30;

/**
 * Maximum number of dice allowed in a single NdX roll.
 *
 * @remarks Sanity bound against a hand-typed/malicious formula, not a game
 * balance bound: a legal level-20 character rolling this project's own
 * dynamic-dice spells (e.g. Shadow Blast's `incrementdice(1,level)d12`)
 * only ever reaches ~5 dice, roughly 20x below this limit. Tightening it
 * further wouldn't protect against real spell content, only against
 * formulas nobody's build can actually produce.
 */
const MAX_DICE_COUNT = 100;

/**
 * Maximum number of sides allowed on a single die.
 *
 * @remarks Same caveat as {@link MAX_DICE_COUNT}: a legal level-20
 * character's dynamic-dice spells top out around d12 (e.g. Entice's
 * `1dstepdice(level,4,8,10,12)`), roughly 80x below this limit.
 */
const MAX_DICE_SIDES = 1000;

/**
 * Thrown internally when a formula violates a safety limit (too long,
 * too deeply nested, dice count/sides out of range). Callers that want
 * to surface this to the user should catch it explicitly; the public
 * `evalFormula`/`rollFormula` functions catch it themselves and fall back
 * to a safe default. `rollFormula` and `resolveFormulaDisplay` also carry
 * the resulting message on their own return value (`error`/`.error`) so
 * the UI can show it right where the failing formula lives, rather than
 * through module-level state shared across every render.
 */
export class FormulaError extends Error {}

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
 * Builds the substitution regex for a single variable name, operating on
 * the uppercase, not-yet-lowercased string `substituteVariables` works on.
 *
 * The right boundary is deliberately not a plain `\b`: `\b` requires a
 * transition between a word character and a non-word character, but
 * digits count as word characters, so `\bKEY\b` never matches inside
 * "KEYD20" — there's no boundary between "Y" and "D". That silently broke
 * every "COUNTd20"-per-stat scaling formula the game actually uses (e.g.
 * `spells.ts`'s "KEYd20", meaning "one dN per point of KEY").
 *
 * This custom right boundary instead requires what immediately follows to
 * be one of: end of string, a non-alphanumeric character (operator, paren,
 * comma, space), or specifically "D" followed by a digit (the dice-suffix
 * shape) — so "KEY" substitutes in "KEYD20" but not in "KEYSTONE", and a
 * bare trailing digit with no "D" (e.g. "KEY2", not a documented pattern
 * anywhere in this project's data) is still left alone rather than
 * silently concatenating into a wrong number.
 *
 * @param name - Uppercase variable name (e.g. "KEY", "MAXHP").
 */
function variablePattern(name: string): RegExp {
  return new RegExp(`\\b${name}(?=$|[^A-Z0-9]|D\\d)`, "g");
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
  if (formula.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(
      `Formula too long (${formula.length} chars, max ${MAX_FORMULA_LENGTH}).`,
    );
  }

  let f = formula.trim().toUpperCase();

  // Stats
  f = f.replace(variablePattern("STR"), String(ctx.stats.str));
  f = f.replace(variablePattern("DEX"), String(ctx.stats.dex));
  f = f.replace(variablePattern("INT"), String(ctx.stats.int));
  f = f.replace(variablePattern("WIL"), String(ctx.stats.wil));

  f = f.replace(variablePattern("KEY"), String(ctx.key));
  // FLAW is documented (see @file header) and already computed by
  // buildContext, but had no substitution line at all — not a boundary
  // bug like KEY/LEVEL, just never wired up. No real formula uses it yet,
  // but it's intended, supported syntax.
  f = f.replace(variablePattern("FLAW"), String(ctx.flaw));

  // Level — LVL is a deliberate alias, not a typo to remove; see the
  // @file header for why.
  f = f.replace(variablePattern("LEVEL"), String(ctx.level));
  f = f.replace(variablePattern("LVL"), String(ctx.level));

  // Skills
  f = f.replace(variablePattern("ARCANA"), String(ctx.skills.arcana));
  f = f.replace(variablePattern("EXAMINATION"), String(ctx.skills.examination));
  f = f.replace(variablePattern("FINESSE"), String(ctx.skills.finesse));
  f = f.replace(variablePattern("INFLUENCE"), String(ctx.skills.influence));
  f = f.replace(variablePattern("INSIGHT"), String(ctx.skills.insight));
  f = f.replace(variablePattern("LORE"), String(ctx.skills.lore));
  f = f.replace(variablePattern("MIGHT"), String(ctx.skills.might));
  f = f.replace(variablePattern("NATURECRAFT"), String(ctx.skills.naturecraft));
  f = f.replace(variablePattern("PERCEPTION"), String(ctx.skills.perception));
  f = f.replace(variablePattern("STEALTH"), String(ctx.skills.stealth));

  // HP — MAXHP must be replaced before HP. "HP" is a trailing substring of
  // "MAXHP" (not a prefix of it), and the left `\b` in variablePattern
  // already prevents `\bHP` from matching inside "MAXHP" on its own (no
  // boundary between "X" and "H", both word characters) — verified by
  // test, not just asserted. Ordering the longer/more-specific name first
  // removes any need to rely on that reasoning holding forever.
  f = f.replace(variablePattern("MAXHP"), String(ctx.maxHp ?? 0));
  f = f.replace(variablePattern("HP"), String(ctx.hp ?? 0));

  // floor / ceil shorthands → keep as tokens for the parser
  f = f.replace(/MATH\.FLOOR\(/g, "floor(");
  f = f.replace(/MATH\.CEIL\(/g, "ceil(");
  f = f.replace(/MATH\.MIN\(/g, "min(");
  f = f.replace(/MATH\.MAX\(/g, "max(");
  f = f.toLowerCase(); // parser works in lowercase

  return f;
}

// ─────────────────────────────────────────────────────────────────
// Dice notation helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Throws if a resolved dice token's count or sides are out of range —
 * either above the upper safety limits, or below the lower bound of what a
 * die can even mean (a 0-count roll, or a die with fewer than 2 sides).
 * This is the shared guard behind every legitimate entry point that reads
 * final count/sides values — {@link diceToAverage} (direct display-path
 * callers) and {@link resolveDynamicDice} (the choke point all dice-rolling
 * paths pass through) — so the limit is defined once and cannot be
 * bypassed by going through one path instead of the other.
 *
 * The lower bound matters in practice, not just in theory: `buildContext`
 * returns `key: 0` whenever `char.keyStat` isn't set yet, which is the
 * normal state of a character sheet mid-creation — a very reachable way to
 * turn a real formula like "KEYd20" into "0d20". This must fail loudly, not
 * silently clamp to 1 die — a silent clamp is exactly the kind of
 * degradation the last two batches removed.
 *
 * In practice the lower bound only ever fires for `count === 0`: a
 * *negative* count (e.g. "-1d6" from a stat that went negative) is never
 * seen here at all. It's caught earlier, deliberately, by
 * {@link Parser.parse}'s full-consumption check instead — the choke-point
 * regex that reads count/sides never captures a leading "-", because that
 * "-" is ambiguous between "part of a negative number" and a subtraction
 * operator (e.g. "10-1d6", a flat 10 minus a legitimate 1d6 roll), and
 * treating it as always-negative would misdiagnose the subtraction case.
 * See rollFormula's tests for both.
 *
 * @param count - Resolved dice count.
 * @param sides - Resolved die size.
 * @param token - The specific `NdX` substring that resolved to `count`/`sides`.
 * @param rawFormula - The original, pre-substitution formula the caller
 * started from. Included in the error message alongside `token` so a
 * player/GM sees *why* a count went to 0 (e.g. `"KEYd20" resolved to
 * "0d20"`), not just the already-substituted number with no stat name left
 * in it to explain it.
 */
function assertDiceWithinLimits(
  count: number,
  sides: number,
  token: string,
  rawFormula: string,
): void {
  const source =
    token === rawFormula
      ? `"${token}"`
      : `"${rawFormula}" resolved to "${token}"`;
  if (count > MAX_DICE_COUNT || sides > MAX_DICE_SIDES) {
    throw new FormulaError(
      `Dice count/sides out of range (${source}, max ${MAX_DICE_COUNT}d${MAX_DICE_SIDES}).`,
    );
  }
  if (count < 1) {
    throw new FormulaError(
      `Dice count must be at least 1 (${source}, got count ${count}).`,
    );
  }
  if (sides < 2) {
    throw new FormulaError(
      `A die needs at least 2 sides (${source}, got ${sides}).`,
    );
  }
}

/**
 * Replace NdX tokens with their *average* value (for static display /
 * modifier computation).  Actual random rolling uses OBR dice or rollDice().
 *
 * @param formula - Formula to average, already variable-substituted.
 * @param rawFormula - Original pre-substitution formula, for error
 * messages only; defaults to `formula` for direct callers (e.g. tests)
 * that have no separate "raw" version.
 */
export function diceToAverage(
  formula: string,
  rawFormula: string = formula,
): string {
  // e.g.  2d6  →  7   (average of 2×(1+6)/2)
  return formula.replace(/(\d+)d(\d+)/gi, (match, count, sides) => {
    const n = parseInt(count, 10);
    const s = parseInt(sides, 10);
    assertDiceWithinLimits(n, s, match, rawFormula);
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
  subbed = resolveDynamicDice(subbed, formula);

  // Extract leading NdX
  const diceMatch = subbed.match(/^(\d+d\d+)/i);
  if (!diceMatch) {
    // No dice — pure modifier
    const mod = safeEval(subbed);
    // NaN is a parse failure (safeEval's whitelist rejected something left
    // after substitution), not a legitimate flat 0 — must not look like
    // one. rollFormula, the main caller, already wraps this call in a
    // try/catch and surfaces FormulaError via its `.error` field.
    if (isNaN(mod)) {
      throw new FormulaError(
        `Could not evaluate formula: "${formula}" (resolved to "${subbed}").`,
      );
    }
    return { diceNotation: "", modifier: mod };
  }

  const diceNotation = diceMatch[1];
  const rest = subbed.slice(diceNotation.length); // e.g.  "+2+3"
  const modifier = rest.trim() ? safeEval(rest) : 0;
  if (isNaN(modifier)) {
    throw new FormulaError(
      `Could not evaluate the modifier in formula: "${formula}" (resolved to "${subbed}").`,
    );
  }

  return { diceNotation, modifier };
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
  private depth = 0;

  constructor(input: string) {
    this.input = input;
  }

  private enterDepth() {
    this.depth++;
    if (this.depth > MAX_PARSE_DEPTH) {
      throw new FormulaError(
        `Formula nested too deeply (max depth ${MAX_PARSE_DEPTH}).`,
      );
    }
  }
  private exitDepth() {
    this.depth--;
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

  /**
   * Entry point. Requires the *entire* input to be consumed — without
   * this, a recognized prefix followed by garbage (e.g. "2dstepdice(…)",
   * where "2" parses fine and "dstepdice(…)" is silently dropped) returns
   * a plausible-looking number instead of surfacing the leftover text.
   */
  parse(): number {
    const result = this.parseExpr();
    this.skipWhitespace();
    if (this.pos < this.input.length) {
      throw new FormulaError(
        `Unexpected trailing input in formula: "${this.input.slice(this.pos, this.pos + 20)}${
          this.pos + 20 < this.input.length ? "…" : ""
        }".`,
      );
    }
    return result;
  }

  /** expr = term (('+' | '-') term)* */
  private parseExpr(): number {
    this.enterDepth();
    try {
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
    } finally {
      this.exitDepth();
    }
  }

  /** term = unary (('*' | '/') unary)* */
  private parseTerm(): number {
    this.enterDepth();
    try {
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
    } finally {
      this.exitDepth();
    }
  }

  /**
   * unary = ('-' | '+') primary | primary
   *
   * The explicit '+' branch matters now that {@link parsePrimary} throws
   * instead of returning 0 on an unrecognized token: a leading '+' in
   * formulas like "+2" (a flat armor bonus) or "+STR+2" (the tail of
   * "1d8+STR+2" once its dice part is stripped) used to reach 0 only
   * because parsePrimary silently ignored the unmatched '+' and returned
   * 0, which parseExpr's own '+' handling then happened to add onto. That
   * accidental path is gone, so '+' needs real unary handling, symmetric
   * with '-', instead of relying on the unknown-token fallback.
   */
  private parseUnary(): number {
    this.enterDepth();
    try {
      if (this.peek() === "-") {
        this.consume();
        return -this.parsePrimary();
      }
      if (this.peek() === "+") {
        this.consume();
        return this.parsePrimary();
      }
      return this.parsePrimary();
    } finally {
      this.exitDepth();
    }
  }

  /** primary = number | '(' expr ')' | 'floor' '(' expr ')' | 'ceil' '(' expr ')' */
  private parsePrimary(): number {
    this.skipWhitespace();
    this.enterDepth();
    try {
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
        // Only a single "." is consumed as part of the number — a second
        // one stops the scan here and is left for the caller, so it
        // surfaces as trailing input rather than being silently absorbed.
        // Without this, the old naive "any run of digits/dots" scan would
        // consume all of "1..2" in one go and quietly hand it to
        // parseFloat, which itself stops at the first invalid character
        // and returns just the valid prefix (parseFloat("1..2") === 1) —
        // the ".2" tail vanishes with no trailing-input error to catch it.
        let sawDot = false;
        while (this.pos < this.input.length) {
          const ch = this.input[this.pos];
          if (ch === ".") {
            if (sawDot) break;
            sawDot = true;
          } else if (!/\d/.test(ch)) {
            break;
          }
          this.pos++;
        }
        const text = this.input.slice(start, this.pos);
        const value = parseFloat(text);
        // A bare "." (no digits at all, e.g. the tail of "1d6+.") passes
        // the character scan above but isn't a valid number — parseFloat
        // returns NaN. The old `|| 0` here silently turned that into a
        // legitimate-looking 0 instead of rejecting the malformed input,
        // the same silent-success shape fixed everywhere else in this file.
        if (isNaN(value)) {
          throw new FormulaError(`Malformed number in formula: "${text}".`);
        }
        return value;
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

      // Unknown token — this used to `return 0` silently, which is exactly
      // the "rolled 0 without saying why" failure mode this app must not
      // have for a dice roller broadcast to a table. A typo'd variable, a
      // stray leftover identifier, or genuinely malformed input must be
      // reported, not disguised as a legitimate zero result.
      const remainder = this.input.slice(this.pos, this.pos + 20);
      throw new FormulaError(
        `Unrecognized token in formula: "${remainder}${
          this.pos + 20 < this.input.length ? "…" : ""
        }".`,
      );
    } finally {
      this.exitDepth();
    }
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
  const sanitised = expr.replace(/\s+/g, " ").trim();

  if (!/^[\d\s+\-*/().,a-z]+$/i.test(sanitised)) {
    return NaN;
  }

  // Let FormulaError propagate — callers decide how to handle it.
  // Only genuinely unexpected parse failures are swallowed here.
  try {
    return new Parser(sanitised).parse();
  } catch (err) {
    if (err instanceof FormulaError) throw err;
    return NaN;
  }
}

/**
 * Normalizes implicit-count dice notation (`dN`, e.g. Nimble's `d66`/`d44`/
 * `d88` single dice) to explicit `1dN` so it reads as real dice notation
 * everywhere downstream (the safety-limit check right below, then
 * `parseDamageFormula`'s leading-dice match, then `rollDice`).
 *
 * Only a `d` with no digit or letter immediately before it qualifies — this
 * is what keeps the already-explicit count in "2d6" untouched, and keeps
 * this from firing inside "stepdice(", "incrementdice(", or the "1d" this
 * function's own replacements above just produced (all of which have a
 * letter or digit directly before their "d…" position). Must run *after*
 * those replacements: normalizing first would insert a stray "1" between
 * the ")" and the trailing "d6" of "incrementdice(1,20)d6", breaking that
 * regex's own `\)d(\d+)` match.
 *
 * @param formula - Formula with `incrementdice`/`stepdice` already expanded.
 * @returns The formula with every bare `dN` rewritten to `1dN`.
 */
function normalizeImplicitDiceCount(formula: string): string {
  return formula.replace(
    /([a-z0-9]?)d(\d+)/gi,
    (match, precedingChar: string, sides: string) =>
      precedingChar ? match : `1d${sides}`,
  );
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
 * @param rawFormula - Original pre-substitution formula, for error
 * messages only; defaults to `formula` for direct callers (e.g. tests)
 * that have no separate "raw" version.
 * @returns The formula with custom dice helpers expanded to plain `NdX`.
 */
function resolveDynamicDice(formula: string, rawFormula: string = formula): string {
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
    /incrementdice\(\s*(\d+)\s*,\s*(\d+)\s*\)d(\d+)/gi,
    (_match, base, level, sides) => {
      const count = Number(base) + Math.floor(Number(level) / 5);

      return `${count}d${sides}`;
    },
  );

  formula = normalizeImplicitDiceCount(formula);

  // Choke point: validate every NdX token now present in the formula,
  // whether it was already there literally (a player/GM typing "50d6"
  // directly) or was just produced by the replacements above. Every
  // consumer of dice notation (parseDamageFormula → rollFormula,
  // evalFormulaWithContext, resolveFormulaDisplay) calls this function
  // before reading count/sides, so this single check guards all of them —
  // none of those callers do their own limit check on the result.
  for (const match of formula.matchAll(/(\d+)d(\d+)/gi)) {
    assertDiceWithinLimits(
      Number(match[1]),
      Number(match[2]),
      match[0],
      rawFormula,
    );
  }

  return formula;
}

// ─────────────────────────────────────────────────────────────────
// Main public API
// ─────────────────────────────────────────────────────────────────

/**
 * Evaluates a formula to a single number for a given character, treating
 * any dice notation as its statistical average (not a real roll).
 *
 * @example evalFormula("1d10 + STR + floor(LEVEL / 2)", char) // → { value: 7 }
 *
 * @param formula - Formula string (variables + optional dice notation).
 * @param char - Character providing stats/skills/level context.
 * @returns `value`: the resolved number, 0 if the formula violates a
 * safety limit or fails to parse. `error` is set only in that case — same
 * shape as {@link rollFormula}/{@link resolveFormulaDisplay}, so a caller
 * feeding this into a permanently-displayed stat (e.g. {@link computeDefense}
 * in CombatTab, evaluating an equipped armor's formula) can tell "formula
 * legitimately computes to 0" apart from "formula is broken" instead of
 * both silently looking like the same 0.
 * @throws Rethrows anything that isn't a {@link FormulaError} (a real bug,
 * not an invalid-formula case).
 */
export function evalFormula(
  formula: string,
  char: NimbleCharacter,
): { value: number; error?: string } {
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
): { value: number; error?: string } {
  try {
    let f = substituteVariables(formula, ctx);
    f = resolveDynamicDice(f, formula);
    f = diceToAverage(f, formula); // Replace NdX with average before arithmetic
    const result = safeEval(f);
    // A NaN result (safeEval's character-whitelist check failed on
    // whatever's left after substitution) is a genuine parse failure, not
    // a legitimate zero — reporting it as `value: 0` with no `error` would
    // be exactly the silent-success-that-isn't the last three batches
    // removed everywhere else, just reintroduced here.
    if (isNaN(result)) {
      throw new FormulaError(
        `Could not evaluate formula: "${formula}" (resolved to "${f}").`,
      );
    }
    return { value: result };
  } catch (err) {
    if (!(err instanceof FormulaError)) throw err;
    return { value: 0, error: err.message };
  }
}

/**
 * Validates a raw formula against every safety limit (length, recursion
 * depth, dice count/sides) without evaluating it to a final display or
 * roll value. Intended as a write-time gate: call this before persisting a
 * formula on an action/spell/item so an out-of-range formula is rejected
 * at save time instead of merely failing safely (but silently, from the
 * saver's point of view) the next time someone tries to roll or display it.
 *
 * @param formula - Raw formula as a player/GM is about to save it.
 * @param ctx - Context used to resolve variables/dynamic dice before checking limits.
 * @throws {FormulaError} if the formula violates any safety limit.
 */
export function validateFormula(formula: string, ctx: FormulaContext): void {
  // Explicit, first-line check on the raw string — this is what actually
  // gets persisted in scene metadata and broadcast to the table, so this
  // gate must not rely on substituteVariables' own length check (which
  // happens to run on this same raw string too) as an implementation detail.
  if (formula.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(
      `Formula too long (${formula.length} chars, max ${MAX_FORMULA_LENGTH}).`,
    );
  }
  const substituted = substituteVariables(formula, ctx);
  const resolved = resolveDynamicDice(substituted, formula);
  const averaged = diceToAverage(resolved, formula);
  const result = safeEval(averaged); // lets a MAX_PARSE_DEPTH violation propagate as FormulaError
  // A NaN result (safeEval's character whitelist rejected something left
  // after substitution) must reject the save the same way
  // evalFormulaWithContext/resolveFormulaDisplay reject it at read time —
  // otherwise a formula this write-time gate waves through can still fail
  // the moment someone actually rolls or displays it, which defeats the
  // point of having the gate.
  if (isNaN(result)) {
    throw new FormulaError(
      `Could not evaluate formula: "${formula}" (resolved to "${averaged}").`,
    );
  }
}

/**
 * Resolves a formula to a human-readable display string for the UI,
 * substituting variables but *keeping* dice notation intact (e.g.
 * "1d8 + STR + 2" → "1d8+5"), so players see what they're about to roll.
 *
 * @param formula - Raw formula as stored on the action/spell/item.
 * @param char - Character providing the variable values.
 * @returns `display`: a simplified display string, or the original formula
 * if nothing could be resolved or a safety limit was violated. `error` is
 * only set in the latter case, so the caller can decide whether/how to
 * surface it instead of a value silently looking legitimate.
 * @throws Rethrows anything that isn't a {@link FormulaError} — a genuine
 * bug (e.g. a `TypeError`) must not be reported to the user as "invalid
 * formula" and lose its stack.
 */
export function resolveFormulaDisplay(
  formula: string,
  char: NimbleCharacter,
): { display: string; error?: string } {
  const ctx = buildContext(char);
  try {
    let f = substituteVariables(formula, ctx);
    f = resolveDynamicDice(f, formula);
    // Evaluate non-dice parts but keep dice notation
    // e.g. "1d8 + 2 + 1" → "1d8+3"
    const diceMatch = f.match(/\d+d\d+/i);
    if (!diceMatch) {
      const val = safeEval(f);
      // NaN here means safeEval's character whitelist rejected whatever's
      // left after substitution — a genuine parse failure, not "nothing to
      // display". Previously fell back to silently showing the raw
      // formula with no error, the same silent-success shape removed
      // elsewhere; routed through the catch below instead, consistently.
      if (isNaN(val)) {
        throw new FormulaError(
          `Could not evaluate formula: "${formula}" (resolved to "${f}").`,
        );
      }
      return { display: String(val) };
    }

    const dicePart = diceMatch[0];
    const rest = f.replace(dicePart, "0");
    const modifier = safeEval(rest);
    // Same reasoning as above: a NaN modifier is a parse failure, not a
    // legitimate zero — keep those two outcomes visibly distinct instead
    // of both falling through to "just show the dice part".
    if (isNaN(modifier)) {
      throw new FormulaError(
        `Could not evaluate the modifier in formula: "${formula}" (resolved to "${f}").`,
      );
    }

    if (modifier === 0) return { display: dicePart };
    if (modifier > 0) return { display: `${dicePart}+${modifier}` };
    return { display: `${dicePart}${modifier}` }; // negative already has the sign
  } catch (err) {
    if (!(err instanceof FormulaError)) throw err;
    // A formula that violates a safety limit (dice count/sides, length)
    // must not crash the row it's displayed on — fall back to showing the
    // raw formula, with the reason attached for the caller to surface.
    return { display: formula, error: err.message };
  }
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
 * @param extraDice - Number of extra dice to roll for advantage/disadvantage.
 * Ignored (forced to 0) when `mode` is "standard", regardless of sign or
 * value, since `mode` is the sole source of truth for how many dice are
 * rolled and kept.
 * @returns Full breakdown: dice notation, all rolls, kept rolls, modifier,
 * total, and critical/fumble flags. If the formula has no dice (a flat
 * modifier), `rolls`/`kept` are empty and `total` equals the modifier. If
 * the formula failed to parse or violated a safety limit, `error` carries
 * the message and every numeric field is zeroed rather than clamped —
 * the caller must not treat that as "rolled a 0".
 *
 * @remarks `isCritical` and `isFumble` can never both be true today: that
 * would require `kept[0]` to equal both `sides` and `1`, i.e. a 1-sided
 * die, which `assertDiceWithinLimits`'s lower bound (`sides >= 2`) makes
 * unreachable. This isn't handled as a special case on purpose — if that
 * lower bound is ever relaxed, this simultaneous-crit-fumble state comes
 * back and will need an explicit decision (which one wins?), not a silent
 * "whichever check happens to run last".
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
  error?: string;
} {
  const ctx = buildContext(char);
  let sides = 20;
  let count = 1;
  let diceNotation: string;
  let modifier: number;

  try {
    const parsed = parseDamageFormula(formula, ctx);
    diceNotation = parsed.diceNotation;
    modifier = parsed.modifier;

    if (!diceNotation) {
      // No dice in formula, e.g. flat "+3" — return immediately,
      // there's nothing to roll.
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

    const m = diceNotation.match(/^(\d+)d(\d+)$/i);
    if (m) {
      count = parseInt(m[1], 10);
      sides = parseInt(m[2], 10);
    }
  } catch (err) {
    return {
      diceNotation: "",
      rolls: [],
      kept: [],
      modifier: 0,
      total: 0,
      isCritical: false,
      isFumble: false,
      error:
        err instanceof FormulaError
          ? err.message
          : `Could not evaluate formula: "${formula}"`,
    };
  }

  // Advantage/disadvantage adds extra dice, keep best/worst.
  // `mode` alone decides direction — the sign of `extraDice` is irrelevant,
  // since callers (DiceRollModal/DicePanel) always pass a positive count.
  const extraCount = mode === "standard" ? 0 : Math.abs(extraDice);
  const totalCount = count + extraCount;
  const rolls = rollDice(totalCount, sides);

  let kept: number[];
  if (mode === "advantage") {
    kept = [...rolls].sort((a, b) => b - a).slice(0, count);
  } else if (mode === "disadvantage") {
    kept = [...rolls].sort((a, b) => a - b).slice(0, count);
  } else {
    kept = rolls;
  }

  const diceSum = kept.reduce((a, b) => a + b, 0);
  const total = diceSum + modifier;

  // `kept` is sorted by mode: descending on advantage, ascending on
  // disadvantage, so `kept[0]` is the highest die on advantage and the
  // lowest on disadvantage. This is intentional — in Nimble, disadvantage
  // discards the highest roll, so the primary kept die is the low one, and
  // crit/fumble detection must read off that same die.
  const isCritical = kept[0] === sides;
  const isFumble = kept[0] === 1;

  return { diceNotation, rolls, kept, modifier, total, isCritical, isFumble };
}