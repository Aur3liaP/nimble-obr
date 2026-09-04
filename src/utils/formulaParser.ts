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
 *  - Dice notation: NdX (e.g. 1d8, 2d6), or implicit-count dN (e.g. a bare
 *    `d20`), normalized to 1dN — averaged for display/modifier math; actual
 *    random rolling is done separately by {@link rollFormula}
 *  - Positional dice (Nimble Core Rules 2nd printing, p.?): `d44`/`d66`/`d88`
 *    each roll 2 dice of the single repeated digit's size (d66 → 2 d6 dice,
 *    NOT one 66-sided die) and read them positionally (tens, ones) rather
 *    than summing — see {@link rollPositionalDice}. An advantage variant
 *    (`d44a`/`d66a`/`d88a`) rolls 3 of that same die size, drops the
 *    lowest, and reads the remaining 2 positionally in their original roll
 *    order. Per the glossary, these (and flat damage values) never miss or
 *    crit — see {@link RollFormulaResult.canCritOrFumble}.
 *  - Math: + - * / floor() ceil() min() max()
 *  - Custom helpers: incrementdice(base, level), stepdice(level, d1, d2, d3, d4[, d5])
 *  - Parentheses
 *
 * Deliberately avoids eval() — uses a small hand-written recursive descent
 * parser instead, so formulas typed by players/GMs can never execute
 * arbitrary JS.
 */

import type { NimbleCharacter, Skills, Stats } from "../types/character";
import { formatModifier } from "./formatModifier";

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
 * `1dstepdice(level,4,6,8,10,12)`), roughly 80x below this limit.
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

export type FormulaContext = {
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
  // Explicit guard on the empty-array case: Math.max() with no arguments
  // returns -Infinity, not 0 — calling it unconditionally on an empty
  // `keyStats` would silently turn every KEY-referencing formula on a
  // character with no key stat selected into garbage instead of the
  // documented, deliberately noisy "key: 0" failure (see the dice
  // lower-bound bullet in CLAUDE.md's Formula parser section).
  const keyValue = char.keyStats.length
    ? Math.max(...char.keyStats.map((stat) => char.stats[stat]))
    : 0;
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
 * One row of the substitution table {@link substituteVariables} walks, in
 * order. This table is the single source of truth for every variable
 * token the formula language accepts: it is not a description of the
 * substitution logic, it *is* the substitution logic, and also what
 * {@link listFormulaVariables} reflects over to drive the in-app formula
 * help panel. A variable that isn't in this table cannot substitute and
 * cannot appear in the help panel, and vice versa — the two can't drift
 * apart the way FLAW (documented in prose, never wired up) once did; see
 * the @file header.
 */
interface VariableEntry {
  /** Uppercase token as it appears in a formula, e.g. "STR", "LVL". */
  name: string;
  /** Resolves this token's numeric value from a context. */
  value: (ctx: FormulaContext) => number;
  /**
   * Set when this token is a pure alias for another entry's `name`
   * (identical resolution, different spelling the rulebook or a GM might
   * use) — e.g. LVL for LEVEL. Purely descriptive, read only by
   * {@link listFormulaVariables}; the substitution loop below applies
   * every row identically regardless of this field.
   */
  aliasOf?: string;
}

/**
 * @remarks MAXHP is kept ordered before HP as defense in depth: "HP" is a
 * trailing substring of "MAXHP", but the left `\b` in
 * {@link variablePattern} already prevents `\bHP` from matching inside
 * "MAXHP" on its own (no boundary between "X" and "H", both word
 * characters). Ordering MAXHP first means correctness doesn't depend on
 * that boundary reasoning continuing to hold — verified by test (both the
 * substitution outcome and the table order itself), not just asserted.
 * Every other entry is independent of order.
 *
 * Exported (read-only in spirit, not enforced by the type) so tests can
 * assert directly on this ordering and on `aliasOf` integrity, rather than
 * on {@link listFormulaVariables}'s output — which, being derived from this
 * same table, would silently reflect the same bug instead of catching it.
 */
export const VARIABLE_TABLE: VariableEntry[] = [
  { name: "STR", value: (ctx) => ctx.stats.str },
  { name: "DEX", value: (ctx) => ctx.stats.dex },
  { name: "INT", value: (ctx) => ctx.stats.int },
  { name: "WIL", value: (ctx) => ctx.stats.wil },

  { name: "KEY", value: (ctx) => ctx.key },
  // FLAW is documented (see @file header) and already computed by
  // buildContext, but had no substitution line at all — not a boundary
  // bug like KEY/LEVEL, just never wired up. No real formula uses it yet,
  // but it's intended, supported syntax.
  { name: "FLAW", value: (ctx) => ctx.flaw },

  // LVL is a deliberate alias for LEVEL, not a typo to remove; see the
  // @file header for why.
  { name: "LEVEL", value: (ctx) => ctx.level },
  { name: "LVL", value: (ctx) => ctx.level, aliasOf: "LEVEL" },

  { name: "ARCANA", value: (ctx) => ctx.skills.arcana },
  { name: "EXAMINATION", value: (ctx) => ctx.skills.examination },
  { name: "FINESSE", value: (ctx) => ctx.skills.finesse },
  { name: "INFLUENCE", value: (ctx) => ctx.skills.influence },
  { name: "INSIGHT", value: (ctx) => ctx.skills.insight },
  { name: "LORE", value: (ctx) => ctx.skills.lore },
  { name: "MIGHT", value: (ctx) => ctx.skills.might },
  { name: "NATURECRAFT", value: (ctx) => ctx.skills.naturecraft },
  { name: "PERCEPTION", value: (ctx) => ctx.skills.perception },
  { name: "STEALTH", value: (ctx) => ctx.skills.stealth },

  // MAXHP before HP — see the @remarks above the table.
  { name: "MAXHP", value: (ctx) => ctx.maxHp ?? 0 },
  { name: "HP", value: (ctx) => ctx.hp ?? 0 },
];

/**
 * Describes one formula variable for display purposes (e.g. the in-app
 * formula help panel): its canonical token plus any aliases that resolve
 * identically.
 */
export interface FormulaVariableInfo {
  /** Canonical uppercase token, e.g. "STR", "LEVEL". */
  name: string;
  /** Other uppercase tokens that resolve identically, e.g. ["LVL"] for "LEVEL". */
  aliases: string[];
}

/**
 * Lists every variable token the formula language accepts, grouped by
 * canonical name with aliases attached (e.g. LEVEL with alias LVL).
 *
 * @remarks Reflects over {@link VARIABLE_TABLE} — the exact table
 * {@link substituteVariables} walks to perform substitution, not a
 * hand-copied list — so this can never advertise a variable that doesn't
 * actually substitute, or omit one that does. This is the mechanism the
 * in-app formula help panel relies on to avoid the FLAW bug (a variable
 * documented in prose but never wired up; see the @file header) ever
 * happening again for any variable, aliases included.
 */
export function listFormulaVariables(): FormulaVariableInfo[] {
  const byName = new Map<string, FormulaVariableInfo>();
  for (const entry of VARIABLE_TABLE) {
    if (!entry.aliasOf) byName.set(entry.name, { name: entry.name, aliases: [] });
  }
  for (const entry of VARIABLE_TABLE) {
    if (entry.aliasOf) byName.get(entry.aliasOf)?.aliases.push(entry.name);
  }
  return [...byName.values()];
}

/**
 * Replaces all known variable tokens (STR, DEX, LEVEL, skill names, HP…)
 * in a formula string with their numeric values from the given context.
 * Also normalizes `Math.floor(`/`Math.ceil(`/`Math.min(`/`Math.max(` to the
 * lowercase tokens the parser understands.
 *
 * Purely semantic: this is a substitution step, one stage of the pipeline
 * every formula (rolled or merely displayed) passes through — it does NOT
 * also clean up the resulting string for human display. A substituted
 * negative value can legitimately produce a glued-together sign (`"3+DEX"`
 * at DEX -2 → `"3+-2"`); that's expected output here, not a bug in this
 * function. `Parser.parseUnary` already parses that correctly (the
 * chained-sign fix from part 1c), so every caller that evaluates this
 * output via `safeEval` — which is every caller in this file — gets the
 * right VALUE regardless. A caller that instead DISPLAYS this string
 * directly, without evaluating it first, is responsible for running it
 * through {@link normalizeSubstitutedSignsForDisplay} itself — seePart 1e
 * tried normalizing here, inside this function, which briefly worked but
 * mixed a presentation concern into a semantic one; part 1f split it back
 * out. Do not re-inline it — see that function's own doc for why the two
 * are not redundant.
 *
 * Exported for one additional use beyond the internal pipeline: a caller
 * that wants a substituted-but-NOT-arithmetically-collapsed formula string
 * for display (e.g. `computeDefense`'s breakdown, showing armor "3+DEX"
 * at DEX 2 as "3+2" rather than collapsing straight to "5" the way
 * {@link resolveFormulaDisplay}'s no-dice branch does) — deliberately not
 * duplicated as a second substitution implementation elsewhere, per the
 * "VARIABLE_TABLE is the logic, not a description of it" rule this file
 * already follows for every other consumer.
 *
 * @remarks HAS AN EXTERNAL CONSUMER outside this module (`computeDefense`
 * in `src/utils/computeDefense.ts`, see above) — do not treat this as a
 * private pipeline-internal helper and "clean it up" back to unexported,
 * and do not change its output shape (lowercased, arithmetic-preserving,
 * dice notation untouched, signs NOT normalized for display) without
 * checking that call site too. Every other function in this file that
 * external code relies on (`resolveFormulaDisplay`, `evalFormula`,
 * `validateFormulaSyntax`, `buildContext`, `VARIABLE_TABLE` itself) is
 * exported for the exact same reason: a hand-duplicated reimplementation
 * elsewhere is exactly the "documented but not actually the source of
 * truth" failure mode this file's own header warns about.
 *
 * @param formula - Raw formula string as typed by the user (e.g. "1d8+STR").
 * @param ctx - Context built by {@link buildContext}.
 * @returns The formula with variables replaced, lowercased, ready for
 * dice/arithmetic parsing. May contain a glued `"+-"`/`"--"` sign pair —
 * see the remarks above.
 */
export function substituteVariables(formula: string, ctx: FormulaContext): string {
  if (formula.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(
      `Formula too long (${formula.length} chars, max ${MAX_FORMULA_LENGTH}).`,
    );
  }

  let f = formula.trim().toUpperCase();

  for (const entry of VARIABLE_TABLE) {
    f = f.replace(variablePattern(entry.name), String(entry.value(ctx)));
  }

  // floor / ceil shorthands → keep as tokens for the parser
  f = f.replace(/MATH\.FLOOR\(/g, "floor(");
  f = f.replace(/MATH\.CEIL\(/g, "ceil(");
  f = f.replace(/MATH\.MIN\(/g, "min(");
  f = f.replace(/MATH\.MAX\(/g, "max(");
  f = f.toLowerCase(); // parser works in lowercase

  return f;
}

/**
 * Collapses a sign glued directly onto a negative value into a single
 * sign, for DISPLAY only: `"+-2"` → `"-2"`, `"--2"` → `"+2"`, and the same
 * with arbitrary whitespace around either sign (`"+ -2"`, `"+  -2"`,
 * `"- -2"` → `"-2"`, `"-2"`, `"+2"` respectively — see the part 1g note
 * below for why whitespace tolerance is required). Not part of
 * {@link substituteVariables}'s own pipeline — call this explicitly at
 * whatever display call site shows a substituted-but-unevaluated formula
 * string (currently `computeDefense`'s breakdown; any future one showing
 * a substituted string directly needs the same call).
 *
 * @remarks TWO mechanisms handle a formula's chained/glued signs in this
 * codebase, and neither is redundant with the other — they serve
 * different needs at different pipeline stages:
 * - `Parser.parseUnary` (part 1c) makes `"1d8+-1"` EVALUATE to the right
 *   number. Mandatory, load-bearing: every roll and every resolved value
 *   in this app depends on it. Do not touch it here.
 * - This function makes a string that's shown WITHOUT evaluation (no
 *   `safeEval` in between) READ correctly. Purely cosmetic — nothing
 *   downstream depends on this function's output being further parsed or
 *   evaluated, it exists only for a human reading the string.
 *
 * Part 1e put this same collapsing logic INSIDE `substituteVariables`
 * itself, reasoning that a single choke point would cover every current
 * and future consumer "for free." Two problems with that, not one: first,
 * it mixed a presentation concern into a semantic pipeline stage that
 * `evalFormula`/`rollFormula`/`resolveFormulaDisplay` depend on and should
 * be able to trust stays purely semantic. Second — and this is what
 * actually kept the bug alive — it wasn't even a complete fix:
 * `computeDefense`'s breakdown builds its final string by concatenating
 * `substituteVariables`'s (by-then-normalized) armor term with a
 * SEPARATELY formatted bonus term (`formatModifier`), appended AFTER
 * normalization already ran. The bonus's own sign, and the join between
 * the two terms, were never covered — normalizing inside
 * `substituteVariables` only ever normalized the armor term in isolation.
 * Part 1f moved normalization out to here, applied explicitly to the
 * FULLY ASSEMBLED breakdown string (armor term + bonus term + total) in
 * `computeDefense`, which is what actually fixes it — see that function's
 * own comment.
 *
 * Only these two sequences arise from substitution in practice: a literal
 * `+`/`-` operator immediately followed by a substituted value that
 * happens to be negative (contributing its own leading `-`). A substituted
 * positive value never contributes a leading `+` (`String(3)` is `"3"`,
 * not `"+3"`), so `"-+"`/`"++"` never arise this way and aren't handled
 * here.
 *
 * Part 1g: part 1f's regex (`/\+-/`, `/--/`) matched only sign characters
 * glued with zero whitespace between them, and its own test used an
 * idealized armor formula (`"3+DEX"`, no space) as input. Real armor data
 * in `equipment.ts` is written with spaces (`"3 + DEX"`), so
 * `substituteVariables` actually produces `"3 + -2"` — a space between the
 * literal `+` and the substituted `-2` — which the old regex never
 * matched, leaving the bug reproducible in OBR despite the part 1f test
 * suite being green. Fixed by swallowing arbitrary whitespace around both
 * signs and re-emitting a tight, space-free join; every existing zero-
 * whitespace case still collapses the same way. Always verify a
 * regex-over-a-string fix like this against the actual data the app
 * produces, not a hand-typed idealization of it.
 *
 * @param s - A substituted (and, for a fully-assembled display string like
 * `computeDefense`'s breakdown, further composed) formula string.
 */
export function normalizeSubstitutedSignsForDisplay(s: string): string {
  return s.replace(/\s*\+\s*-\s*/g, "-").replace(/\s*-\s*-\s*/g, "+");
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
 * returns `key: 0` whenever `char.keyStats` is empty, which is the
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
 * @param enforceLimits - Whether to run {@link assertDiceWithinLimits} on
 * each token. Defaults to `true` for every existing caller; only
 * {@link validateFormulaSyntax} passes `false`, deliberately, since it
 * validates syntax against a synthetic character and dice-count/sides
 * bounds are a roll-time concern against the real one. See
 * {@link validateFormulaSyntax}'s doc comment. Positional dice
 * (`d44`/`d66`/`d88`, see below) are never subject to this check either
 * way — they're always exactly 2-3 fixed-size dice, well inside any limit.
 */
export function diceToAverage(
  formula: string,
  rawFormula: string = formula,
  enforceLimits: boolean = true,
): string {
  // Positional dice first — they resolve to an exact expected value, not a
  // summed NdX, so they can't go through the generic replace below. Same
  // preceded-char skip convention as normalizeImplicitDiceCount: only a
  // bare (unprefixed) token is positional notation.
  let result = formula.replace(
    positionalDicePattern(),
    (match, precedingChar: string, sides: string, advantageSuffix?: string) => {
      if (precedingChar) return match;
      return String(
        positionalDiceAverage(positionalDieFaceSize(sides), !!advantageSuffix),
      );
    },
  );

  // e.g.  2d6  →  7   (average of 2×(1+6)/2)
  result = result.replace(/(\d+)d(\d+)/gi, (match, count, sides) => {
    const n = parseInt(count, 10);
    const s = parseInt(sides, 10);
    if (enforceLimits) assertDiceWithinLimits(n, s, match, rawFormula);
    const avg = Math.round(n * ((1 + s) / 2));
    return String(avg);
  });
  return result;
}

/**
 * Splits a formula into its leading dice notation and its numeric modifier.
 *
 * Also the choke point for this codebase's "where is dice notation allowed
 * to appear" constraint: dice must be the substituted formula's very first
 * token (or absent entirely, or positional) — anything else, dice-shaped
 * text included, is handed to {@link safeEval} as-is and rejected the same
 * way any other malformed arithmetic is. {@link validateFormulaSyntax}
 * reuses this exact function (rather than a separate position check) so a
 * write-time-accepted formula is, by construction, one this function can
 * actually split — see that function's own doc for why a second,
 * independent definition of "valid dice position" used to exist and
 * disagree with this one.
 *
 * @example parseDamageFormula("1d8+STR+2", ctx) // → { diceNotation: "1d8", modifier: <STR+2> }
 *
 * @param formula - Raw formula (may contain variables and dice).
 * @param ctx - Context used to resolve variables before splitting.
 * @param enforceLimits - Passed straight through to the internal
 * {@link resolveDynamicDice} call. Defaults to `true`, unchanged for this
 * function's only production caller (`rollFormulaWithContext`). Only
 * {@link validateFormulaSyntax} passes `false`, for the same reason it
 * already passes `false` to `resolveDynamicDice`/`diceToAverage` directly
 * elsewhere in this file: dice bounds are a roll-time concern, checked
 * against a real character, not a write-time one — see that function's own
 * doc for the full reasoning. This parameter changes nothing for any
 * existing caller; it exists solely so `validateFormulaSyntax` can reuse
 * this function's position constraint without also inheriting its bounds
 * enforcement.
 * @returns The dice part (e.g. "1d8") and the resolved numeric modifier.
 * If there is no leading dice notation, `diceNotation` is empty and the
 * whole formula is evaluated as the modifier. `positional` is set instead
 * of a plain `NdX` when the formula leads with positional dice notation
 * (`d44`/`d66`/`d88`, optional `a` suffix) — see {@link rollPositionalDice}.
 */
export function parseDamageFormula(
  formula: string,
  ctx: FormulaContext,
  enforceLimits: boolean = true,
): { diceNotation: string; modifier: number; positional?: { sides: number; advantage: boolean } } {
  // Substitute variables first, then split dice from modifiers
  let subbed = substituteVariables(formula, ctx);
  subbed = resolveDynamicDice(subbed, formula, enforceLimits);

  // Positional dice (d44/d66/d88, optional advantage "a") — checked before
  // the plain NdX match below, since normalizeImplicitDiceCount deliberately
  // leaves a bare positional token untouched (see its doc comment) rather
  // than normalizing it to "1dNN".
  const positionalMatch = subbed.match(/^d(44|66|88)(a)?(?![a-z0-9])/i);
  if (positionalMatch) {
    const rest = subbed.slice(positionalMatch[0].length);
    const modifier = rest.trim() ? safeEval(rest) : 0;
    if (isNaN(modifier)) {
      throw new FormulaError(
        `Could not evaluate the modifier in formula: "${formula}" (resolved to "${subbed}").`,
      );
    }
    return {
      diceNotation: positionalMatch[0].toLowerCase(),
      modifier,
      positional: {
        sides: positionalDieFaceSize(positionalMatch[1]),
        advantage: !!positionalMatch[2],
      },
    };
  }

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
 * One entry of the arithmetic-helper table {@link Parser.parsePrimary}
 * dispatches through, in the same spirit as {@link VARIABLE_TABLE}: this
 * table *is* the function's definition (name, arity, and what it computes),
 * not a separate description of one living elsewhere. A hand-copied catalog
 * of function names sitting only in the formula help UI would carry the
 * exact same drift risk that once let FLAW go documented-but-dead — a
 * function added straight into the parser's dispatch wouldn't show up in
 * the help panel, and one added only to a UI catalog wouldn't actually
 * work. {@link listFormulaFunctions} reflects over this same table to
 * close both gaps, the same way {@link listFormulaVariables} does for
 * variables.
 *
 * Deliberately limited to the fixed-arity, side-effect-free case (a
 * function of 1 or 2 already-evaluated arguments). `incrementdice`/
 * `stepdice` are not folded in here: their argument counts and branching
 * logic vary per helper (see {@link Parser.parsePrimary}), so forcing them
 * into this shape would either lose that logic or make the table
 * misleadingly generic. They're documented separately, via worked examples
 * in the formula help UI instead of a signature line.
 */
interface MathFunctionEntry {
  /** Lowercase token as it appears in a formula, e.g. "floor", "min". */
  name: string;
  /** Number of comma-separated arguments this function takes. */
  arity: 1 | 2;
  /** Applies the function to its already-evaluated, in-order arguments. */
  apply: (...args: number[]) => number;
  /** One-line, human-readable description for the formula help panel. */
  description: string;
}

const MATH_FUNCTIONS: MathFunctionEntry[] = [
  { name: "floor", arity: 1, apply: (x) => Math.floor(x), description: "Rounds down" },
  { name: "ceil", arity: 1, apply: (x) => Math.ceil(x), description: "Rounds up" },
  { name: "min", arity: 2, apply: (a, b) => Math.min(a, b), description: "Smaller of the two" },
  { name: "max", arity: 2, apply: (a, b) => Math.max(a, b), description: "Larger of the two" },
];

/** Describes one arithmetic helper function for display purposes (e.g. the in-app formula help panel). */
export interface FormulaFunctionInfo {
  /** Display signature, e.g. "floor(x)" or "min(a, b)". */
  signature: string;
  /** One-line, human-readable description. */
  description: string;
}

/**
 * Lists every fixed-arity arithmetic helper the parser accepts.
 *
 * @remarks Reflects over {@link MATH_FUNCTIONS} — the exact table
 * {@link Parser.parsePrimary} dispatches through — so this can never
 * advertise a function that doesn't actually work, or omit one that does.
 * `incrementdice`/`stepdice` aren't included: see the remarks on
 * {@link MATH_FUNCTIONS} for why they're documented via worked examples
 * instead.
 */
export function listFormulaFunctions(): FormulaFunctionInfo[] {
  return MATH_FUNCTIONS.map((fn) => ({
    signature: fn.arity === 1 ? `${fn.name}(x)` : `${fn.name}(a, b)`,
    description: fn.description,
  }));
}

/**
 * Picks a step-dice size for `stepdice(level, ...)`/`1dstepdice(level,
 * ...)`, given the caster's level and an ordered list of die sizes
 * (smallest/lowest-level first). Shared by the two places that resolve
 * this helper — {@link Parser}'s `parsePrimary` (bare `stepdice(...)`) and
 * {@link resolveDynamicDice}'s regex path (`1dstepdice(...)`) — so a
 * future change to the breakpoint scheme can't be applied to one and
 * forgotten in the other. That exact failure mode (two hand-copied
 * implementations of the same logic silently drifting apart) is why this
 * project extracts shared tables/logic instead of duplicating it — see
 * `VARIABLE_TABLE`/`MATH_FUNCTIONS`'s own reasoning elsewhere in this file.
 *
 * Two supported arities:
 * - **4 sizes** (the original shape): 3 breakpoints (5/10/15) → 4 bands.
 *   Kept working for backward compatibility — nothing in this codebase
 *   currently calls it this way (`stepdice`'s only real caller, Entice,
 *   now uses 5), but nothing stops a future formula from doing so.
 * - **5 sizes** (added for Entice's 2nd-printing die progression — Core
 *   Rules 2nd printing: base d4, "Increment the die size 1 step every 5
 *   levels (d6 → d8 → d10 → d12)"): 4 breakpoints (5/10/15/20), the last
 *   one matching {@link MAX_LEVEL} exactly, so the final size is reachable
 *   at all. The original 4-size/3-breakpoint shape could never express
 *   this 5-tier progression — it's one band short by construction, not a
 *   bug in the breakpoint values themselves.
 *
 * @param level - Caster level.
 * @param sizes - 4 or 5 die sizes, in ascending level-band order.
 * @throws {FormulaError} If `sizes` isn't length 4 or 5 — a different
 * count means the caller's formula is malformed, not that the breakpoint
 * scheme should silently guess.
 */
function pickStepDiceSize(level: number, sizes: number[]): number {
  if (sizes.length !== 4 && sizes.length !== 5) {
    throw new FormulaError(
      `stepdice expects 4 or 5 die sizes, got ${sizes.length}.`,
    );
  }
  const breakpoints = sizes.length === 5 ? [5, 10, 15, 20] : [5, 10, 15];
  let tier = 0;
  for (const breakpoint of breakpoints) {
    if (level >= breakpoint) tier++;
  }
  return sizes[tier];
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
 *          | incrementdice(base, level)
 *          | stepdice(level, d1, d2, d3, d4[, d5])
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
   * unary = ('-' | '+') unary | primary
   *
   * The explicit '+' branch matters now that {@link parsePrimary} throws
   * instead of returning 0 on an unrecognized token: a leading '+' in
   * formulas like "+2" (a flat armor bonus) or "+STR+2" (the tail of
   * "1d8+STR+2" once its dice part is stripped) used to reach 0 only
   * because parsePrimary silently ignored the unmatched '+' and returned
   * 0, which parseExpr's own '+' handling then happened to add onto. That
   * accidental path is gone, so '+' needs real unary handling, symmetric
   * with '-', instead of relying on the unknown-token fallback.
   *
   * Both branches recurse into `parseUnary()`, not `parsePrimary()` — a
   * negative stat substituted into a formula produces a CHAINED sign right
   * after the formula's own operator: "1d8+STR" with STR=-1 substitutes to
   * "1d8+-1", and once the dice part is split off, `safeEval` sees the
   * remainder as a leading "+-1". The old `parsePrimary()`-only version
   * consumed the outer sign and handed the *rest* straight to
   * `parsePrimary`, which has no idea what to do with the second sign
   * character still sitting at the front ("-1") and threw "Unrecognized
   * token". Recursing into `parseUnary` lets each sign consume itself and
   * hand off to the next, so any run of leading signs ("+-1", "--1",
   * "-+1", ...) resolves correctly instead of only tolerating exactly one.
   * This is not initiative-specific: any formula whose trailing modifier
   * ends up glued to a negative substituted value hits the same case — the
   * standard array (+2/+2/+0/-1) and Min-Max (+3/+1/-1/-1) both put a
   * negative stat in play for most parties.
   */
  private parseUnary(): number {
    this.enterDepth();
    try {
      if (this.peek() === "-") {
        this.consume();
        return -this.parseUnary();
      }
      if (this.peek() === "+") {
        this.consume();
        return this.parseUnary();
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
      // floor(x) / ceil(x) / min(a, b) / max(a, b) — dispatched from
      // MATH_FUNCTIONS (see its own doc comment for why it's the single
      // source of truth shared with the formula help UI). Checked before
      // the parenthesised-expression and number branches below; safe to
      // do so since every one of these names starts with a letter, so it
      // can never match a bare "(" or a digit.
      for (const fn of MATH_FUNCTIONS) {
        if (this.input.startsWith(`${fn.name}(`, this.pos)) {
          this.pos += fn.name.length + 1;
          const plural = fn.arity === 1 ? "argument" : "arguments";
          const args: number[] = [];
          for (let i = 0; i < fn.arity; i++) {
            // Every argument after the first must be preceded by a comma.
            // Anything else here (most commonly the closing ")" of a call
            // with too few arguments, e.g. "min(1)") means an argument is
            // missing — reported with the function name and expected
            // arity, not left to fall through to parseExpr(), which would
            // otherwise hit the ")" and throw the generic "unrecognized
            // token" error instead.
            if (i > 0) {
              if (this.peek() !== ",") {
                throw new FormulaError(
                  `${fn.name}() takes ${fn.arity} ${plural}, got only ${i}.`,
                );
              }
              this.consume();
            }
            args.push(this.parseExpr());
          }
          // A "," immediately after the last expected argument means more
          // arguments were supplied than the function takes (e.g.
          // "min(1,2,3)"), and is reported explicitly rather than left as
          // unconsumed trailing input for the generic error in parse().
          // Anything else here — notably a missing ")" — is tolerated the
          // same as every other call in this parser (see the "(" branch
          // and incrementdice/stepdice below), not treated as an arity
          // error: an unbalanced paren isn't an argument-count problem.
          if (this.peek() === ",") {
            throw new FormulaError(
              `${fn.name}() takes ${fn.arity} ${plural}, got too many.`,
            );
          }
          if (this.peek() === ")") this.consume();
          return fn.apply(...args);
        }
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

      // stepdice(level, d1, d2, d3, d4[, d5]) — see pickStepDiceSize for
      // the 4-vs-5-size breakpoint scheme.
      if (this.input.startsWith("stepdice(", this.pos)) {
        this.pos += "stepdice(".length;
        const level = this.parseExpr();

        const sizes: number[] = [];
        while (this.peek() === ",") {
          this.consume();
          sizes.push(this.parseExpr());
        }

        if (this.peek() === ")") this.consume();

        return pickStepDiceSize(level, sizes);
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
 * Positional dice sizes recognized by the rulebook (Nimble Core Rules 2nd
 * printing): `d44`, `d66`, `d88`. Rolled and read positionally by
 * {@link rollPositionalDice}/{@link positionalDiceAverage}, never summed
 * like a normal `NdX` — see the @file header.
 */
const POSITIONAL_DICE_SIDES = [44, 66, 88] as const;

/**
 * Normalizes implicit-count dice notation (`dN`, e.g. a bare `d20`) to
 * explicit `1dN` so it reads as real dice notation everywhere downstream
 * (the safety-limit check right below, then `parseDamageFormula`'s
 * leading-dice match, then `rollDice`).
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
 * Deliberately excludes {@link POSITIONAL_DICE_SIDES} (44/66/88): a bare
 * `d66` is Nimble's positional-dice notation (2nd printing), not a literal
 * 66-sided die, and is resolved separately — see
 * {@link parseDamageFormula}/{@link diceToAverage}/{@link resolveFormulaDisplay}.
 * Left untouched here (not rewritten to "1d66") so those callers can still
 * recognize the bare form after this function runs.
 *
 * @param formula - Formula with `incrementdice`/`stepdice` already expanded.
 * @returns The formula with every bare `dN` (other than a positional size)
 * rewritten to `1dN`.
 */
function normalizeImplicitDiceCount(formula: string): string {
  return formula.replace(
    /([a-z0-9]?)d(\d+)/gi,
    (match, precedingChar: string, sides: string) => {
      if (precedingChar) return match;
      if ((POSITIONAL_DICE_SIDES as readonly number[]).includes(Number(sides))) {
        return match;
      }
      return `1d${sides}`;
    },
  );
}

/**
 * Extracts the individual die's face count from a positional-dice token's
 * captured digits ("44", "66", or "88"). Each is the same digit written
 * twice — d66 means "roll 2 (or 3, for advantage) d6 dice and read them
 * positionally", NOT "roll a die with 66 faces" — so the actual die to roll
 * is sized off a single digit of the token, not the token's numeric value
 * as a whole.
 */
function positionalDieFaceSize(sidesToken: string): number {
  return Number(sidesToken[0]);
}

/**
 * Shared "leftmost among ties" extremum scan behind both
 * {@link indexOfLowestValue} and {@link indexOfHighestValue} — one
 * implementation so their tie-break rule can't drift apart into two
 * subtly different conventions (see CLAUDE.md's note on hand-copied logic
 * drifting apart). `idx` only moves to a later index when `values[i]` is
 * STRICTLY more extreme than the current candidate (never on a tie), which
 * is exactly what makes an equal value resolve to the earlier position.
 */
function indexOfExtremeValue(
  values: number[],
  isMoreExtreme: (candidate: number, current: number) => boolean,
): number {
  let idx = 0;
  for (let i = 1; i < values.length; i++) {
    if (isMoreExtreme(values[i], values[idx])) idx = i;
  }
  return idx;
}

/**
 * Index of the (first, on a tie) lowest value in `values`. Used to pick
 * which die to drop for advantage (drop the worst = lowest) and by
 * {@link rollPositionalDice}/{@link positionalDiceAverage} (drop the
 * lowest of 3 rolled dice for the "a" advantage variant).
 *
 * @example indexOfLowestValue([4, 2, 5]) // → 1 (drops the 2)
 * @example indexOfLowestValue([3, 3, 6]) // → 0 (drops the FIRST 3, not the second)
 */
function indexOfLowestValue(values: number[]): number {
  return indexOfExtremeValue(values, (a, b) => a < b);
}

/**
 * Index of the (first, on a tie) highest value in `values` — mirror of
 * {@link indexOfLowestValue}, sharing its tie-break rule via
 * {@link indexOfExtremeValue}. Used to pick which die to drop for
 * disadvantage (drop the worst = highest).
 *
 * @example indexOfHighestValue([4, 6, 2]) // → 1 (drops the 6)
 * @example indexOfHighestValue([6, 3, 6]) // → 0 (drops the FIRST 6, not the second)
 */
function indexOfHighestValue(values: number[]): number {
  return indexOfExtremeValue(values, (a, b) => a > b);
}

/**
 * Reads a set of rolled positional dice into their two-digit value —
 * `kept[0]` as the tens place, `kept[1]` as the ones place — without
 * sorting. Position is preserved exactly as rolled: `[4, 5]` reads as 45,
 * not resorted to the numerically larger 54. Shared by
 * {@link rollPositionalDice} (real rolls) and {@link positionalDiceAverage}'s
 * exact enumeration (hypothetical rolls), so both agree on what "reading
 * positionally" means.
 */
function readPositionalValue(kept: [number, number]): number {
  return kept[0] * 10 + kept[1];
}

/**
 * Exact expected value of a positional-dice roll (`dNN` or `dNNa`), used by
 * {@link diceToAverage} for display/modifier math (the same role
 * {@link diceToAverage}'s plain-NdX branch plays for ordinary dice).
 *
 * Non-advantage: straightforward — the tens and ones dice are independent,
 * so the average is just the average face value read into both positions.
 *
 * Advantage (roll 3, drop lowest — leftmost on a tie — keep the remaining 2
 * positionally in original roll order): there's no simple closed form,
 * because which of the 3 original positions survives depends on the values
 * rolled, not just their ranks. `sides` is always small (4, 6, or 8 —
 * {@link POSITIONAL_DICE_SIDES}), so this exhaustively enumerates all
 * `sides^3` equally-likely outcomes (at most 512) and averages the exact
 * result — cheap, and exact rather than approximated.
 *
 * @param sides - Size of each individual die (4, 6, or 8).
 * @param advantage - Whether this is the "a" (roll-3-drop-lowest) variant.
 */
function positionalDiceAverage(sides: number, advantage: boolean): number {
  const faceAverage = (sides + 1) / 2;
  if (!advantage) return Math.round(readPositionalValue([faceAverage, faceAverage]));

  let sum = 0;
  let count = 0;
  for (let a = 1; a <= sides; a++) {
    for (let b = 1; b <= sides; b++) {
      for (let c = 1; c <= sides; c++) {
        const rolled = [a, b, c];
        const dropIndex = indexOfLowestValue(rolled);
        const kept = rolled.filter((_, i) => i !== dropIndex) as [number, number];
        sum += readPositionalValue(kept);
        count++;
      }
    }
  }
  return Math.round(sum / count);
}

/**
 * Matches a bare positional-dice token (`d44`/`d66`/`d88`, optionally
 * suffixed `a` for the advantage variant) not already prefixed with an
 * explicit count or embedded in another identifier — same
 * capture-and-skip-if-preceded convention as {@link normalizeImplicitDiceCount},
 * and the same trailing exclusion so "d668" (not real notation) doesn't
 * false-match "d66". Callers check `match[1]` (the optional preceding
 * character) themselves; this is a plain, reusable pattern object, not a
 * one-shot regex literal, since several functions below need their own
 * `matchAll`/`match`/`replace` over it.
 */
function positionalDicePattern(): RegExp {
  return /([a-z0-9]?)d(44|66|88)(a)?(?![a-z0-9])/gi;
}

/**
 * Resolves the project's two custom dynamic-dice helpers into plain NdX
 * notation before the rest of the pipeline (averaging / rolling) runs.
 *
 * - `1dstepdice(level, d1, d2, d3, d4[, d5])` → picks the die size based on
 *   level breakpoints; see {@link pickStepDiceSize} for the 4-vs-5-size
 *   breakpoint scheme.
 * - `incrementdice(base, level)dSIDES` → increases dice count by
 *   `floor(level / 5)` on top of `base`.
 *
 * @param formula - Formula string with variables already substituted.
 * @param rawFormula - Original pre-substitution formula, for error
 * messages only; defaults to `formula` for direct callers (e.g. tests)
 * that have no separate "raw" version.
 * @param enforceLimits - Whether the choke-point loop below runs
 * {@link assertDiceWithinLimits}. Defaults to `true` for every existing
 * caller (`parseDamageFormula`/`rollFormula`, `evalFormulaWithContext`,
 * `resolveFormulaDisplay`, `validateFormula`) — none of them pass `false`,
 * so this change is behaviorally inert for all of them. Only
 * {@link validateFormulaSyntax} passes `false`: see its doc comment for
 * why dice bounds are deliberately not a write-time concern.
 * @returns The formula with custom dice helpers expanded to plain `NdX`.
 */
function resolveDynamicDice(
  formula: string,
  rawFormula: string = formula,
  enforceLimits: boolean = true,
): string {
  formula = formula.replace(/1dstepdice\(([^)]+)\)/gi, (_match, args) => {
    const [level, ...sizes] = args
      .split(",")
      .map((v: string) => Number(v.trim()));

    return `1d${pickStepDiceSize(level, sizes)}`;
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
  if (enforceLimits) {
    for (const match of formula.matchAll(/(\d+)d(\d+)/gi)) {
      assertDiceWithinLimits(
        Number(match[1]),
        Number(match[2]),
        match[0],
        rawFormula,
      );
    }
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
 * @remarks Status as of 1.5.1: this is currently NOT wired into any write
 * path in the app — grep confirms zero production callers, only tests.
 * `validateFormulaSyntax` (context-free, see its own doc) is the actual
 * write-time gate in production today, via `useFormulaField`. Whether to
 * wire this one in too (it additionally needs a real character context,
 * which not every write site has to hand) or remove it is a decision for
 * a future batch, not made here.
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
 * Synthetic {@link FormulaContext} used only by {@link validateFormulaSyntax},
 * never by anything that resolves a formula to a value shown or rolled for
 * a real character.
 *
 * @remarks Every field is `1`, deliberately not `0`. This project's own bug
 * history (`KEYd20` resolving to `0d20` for a character with no `keyStats`
 * selected) is what {@link validateFormulaSyntax} exists to stop happening at
 * write time instead of roll time — reusing `0` here would just relocate
 * the exact same trap into the neutral context itself, for KEY and for
 * every other variable that can legitimately be `0` on a real character
 * (FLAW, HP). `1` avoids that for any directly-glued variable (`KEYd20`,
 * `STRd6`, `LEVELd8`, `FLAWd6`) without being large enough to risk the
 * upper bound either.
 *
 * That said, dice-count/sides bounds are not actually enforced by
 * `validateFormulaSyntax` at all (see its doc comment) — bounds are a
 * roll-time concern, checked against the real character. So today,
 * nothing here strictly depends on these values being nonzero. They're
 * `1` anyway as defense in depth, on the same reasoning already applied
 * to `VARIABLE_TABLE`'s MAXHP/HP ordering: correctness shouldn't depend
 * on `enforceLimits: false` staying that way forever if this ever changes.
 */
const NEUTRAL_VALIDATION_CONTEXT: FormulaContext = {
  level: 1,
  key: 1,
  flaw: 1,
  stats: { str: 1, dex: 1, int: 1, wil: 1 },
  skills: {
    arcana: 1,
    examination: 1,
    finesse: 1,
    influence: 1,
    insight: 1,
    lore: 1,
    might: 1,
    naturecraft: 1,
    perception: 1,
    stealth: 1,
  },
  hp: 1,
  maxHp: 1,
};

/**
 * Write-time syntax gate for a formula, independent of any specific
 * character. Intended for the UI's formula input fields (spell/item/action
 * create-and-edit forms): a formula the parser can't read at all must
 * never be persisted to OBR scene metadata and broadcast to the table,
 * where it would only fail later, at roll time, for whoever tries to use
 * it — possibly a different person, possibly a different session.
 *
 * @remarks Deliberately validates SYNTAX, not resolved VALUES: substitutes
 * against {@link NEUTRAL_VALIDATION_CONTEXT} rather than a real character,
 * and does not enforce `MAX_DICE_COUNT`/`MAX_DICE_SIDES`/the dice lower
 * bound at all (passes `enforceLimits: false` to `resolveDynamicDice`/
 * `diceToAverage`) — uniformly, including for a formula with no variables
 * in it whatsoever (e.g. a hand-typed "99999d6"). Two concrete reasons,
 * not just caution:
 *
 * - A real character's numeric fields (KEY before any `keyStats` entry is
 *   set, FLAW, HP) can legitimately be outside whatever range a synthetic
 *   context picks, in either direction. `KEYd20` saved by a GM whose
 *   character sheet has an empty `keyStats` resolves to `0d20` against the
 *   real character right now, and would be wrongly rejected at save time
 *   if this gate substituted with that same real, incomplete context.
 * - Bounds are inherently level/context-dependent for dynamic dice (e.g.
 *   `incrementdice(1,LEVEL)d6` is 1 die at level 1 and 5 dice at level
 *   20): no single neutral context, and no pair of "extremes," makes a
 *   bound check here mean anything about every level in between. Bounds
 *   are checked once, correctly, at roll time — by this exact same
 *   `assertDiceWithinLimits` choke point, against the real character
 *   actually rolling (see `rollFormula` → `parseDamageFormula` →
 *   `resolveDynamicDice`). Write-time validation only needs to confirm
 *   the formula is well-formed enough to be evaluated at all: recognized
 *   tokens, correct function arity, balanced/bounded nesting depth
 *   (`MAX_PARSE_DEPTH`, still enforced — that's a parser-shape concern,
 *   not a resolved-value one), and dice notation shaped like `NdX`.
 *
 * @remarks Second gate, added in 1.5.1: a formula can pass the arithmetic
 * check above and still be unrollable, because that check (via
 * {@link diceToAverage}) finds dice notation ANYWHERE in the formula and
 * replaces it with its average before checking the rest as ordinary
 * arithmetic — so `"LVL*1d4"` averages to `"1*3"` (fine, arithmetically)
 * even though {@link rollFormula} (via {@link parseDamageFormula}, which
 * only recognizes dice notation as the formula's leading token) can never
 * actually roll it. Rather than inventing a second, independent
 * definition of "where dice are allowed to appear" here, this gate calls
 * `parseDamageFormula` itself, against the same neutral context and with
 * `enforceLimits: false` (see its own `@param enforceLimits` doc) — a
 * formula this function accepts is therefore one `parseDamageFormula` can
 * actually split, by construction, not by two definitions happening to
 * agree. Deliberately run as a SEPARATE, second step after the arithmetic
 * check above (not a replacement for it): the arithmetic check's errors
 * (unrecognized token, wrong arity, malformed number, over-length,
 * over-depth) are specific and already GM-legible; only once a formula
 * has already passed all of that do we know for certain that a
 * `parseDamageFormula` failure here can only mean one thing — dice
 * notation sitting somewhere this app's roll engine can't reach it — so
 * the message below can be equally specific instead of reusing whatever
 * internal parser wording `parseDamageFormula` happened to throw.
 *
 * @param formula - Raw formula as a player/GM is about to save it.
 * @throws {FormulaError} if the formula is too long, too deeply nested,
 * uses an unrecognized token or wrong function arity, fails to parse to a
 * real number once substituted against the neutral context, or places
 * dice notation somewhere `parseDamageFormula` can't roll it from (see
 * the second `@remarks` block above).
 */
export function validateFormulaSyntax(formula: string): void {
  if (formula.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(
      `Formula too long (${formula.length} chars, max ${MAX_FORMULA_LENGTH}).`,
    );
  }
  const substituted = substituteVariables(formula, NEUTRAL_VALIDATION_CONTEXT);
  const resolved = resolveDynamicDice(substituted, formula, false);
  const averaged = diceToAverage(resolved, formula, false);
  const result = safeEval(averaged);
  if (isNaN(result)) {
    throw new FormulaError(
      `Could not evaluate formula: "${formula}" (resolved to "${averaged}").`,
    );
  }

  // Second gate — see the @remarks block above for why this is a
  // deliberate, separate step rather than folded into the check above.
  try {
    parseDamageFormula(formula, NEUTRAL_VALIDATION_CONTEXT, false);
  } catch (err) {
    if (!(err instanceof FormulaError)) throw err;
    throw new FormulaError(
      `This formula can't be rolled: dice notation must come at the very ` +
        `start, optionally followed by a flat +/- bonus (e.g. "1d6+STR"). ` +
        `A multiplier before dice, dice inside parentheses, or dice ` +
        `anywhere but the start of the formula isn't supported yet.`,
    );
  }
}

/**
 * Non-throwing wrapper around {@link validateFormulaSyntax}, matching the
 * `{ value, error? }`-shaped return convention used by {@link evalFormula}/
 * {@link rollFormula}/{@link resolveFormulaDisplay} elsewhere in this file,
 * for UI code (e.g. `useFormulaField`) that wants a value to render rather
 * than a `try`/`catch`.
 *
 * @param formula - Raw formula as currently typed.
 * @returns `undefined` if the formula is blank (an empty/optional formula
 * is not an error) or syntactically valid; otherwise the {@link FormulaError}
 * message.
 */
export function formulaSyntaxError(formula: string): string | undefined {
  if (formula.trim() === "") return undefined;
  try {
    validateFormulaSyntax(formula);
    return undefined;
  } catch (err) {
    if (!(err instanceof FormulaError)) throw err;
    return err.message;
  }
}

/**
 * Whether an inventory item's `formula` is meant to be evaluated or rolled
 * by this engine at all.
 *
 * `false` for an item with no formula (nothing to roll), `false` for
 * `manualResolution: true` — the formula there is flavor-text shorthand
 * for the GM to interpret by hand (e.g. "WeaponDamage + 1d4" on a magic
 * weapon, referencing whatever weapon it's enchanting, a concept this
 * parser has no variable for) — and `false` for `isArmor: true`. Armor's
 * `formula` (e.g. "2 + DEX") isn't a rollable value at all, it's the input
 * `computeDefense` (`computeDefense.ts`) evaluates to derive Defense; a
 * roll button on an armor row invited rolling "damage" for a piece of
 * clothing. `computeDefense` doesn't go through this function (it reads
 * `armorItem.formula` directly via `evalFormula`/`substituteVariables`),
 * so excluding armor here only removes the roll button/display path, not
 * Defense computation.
 *
 * This is the single choke point a call site checks before offering a roll
 * button or calling `resolveFormulaDisplay` on an `InventoryItem` — see the
 * CLAUDE.md note on this being the fifth instance of a field documented in
 * prose (`manualResolution`'s own JSDoc) that nothing actually read. A new
 * call site that forgets to check this flag directly and instead only
 * checks `formula` truthiness would silently regain the bug; route through
 * here instead.
 *
 * @param item - An inventory item or item template — only `formula`/
 * `manualResolution`/`isArmor` are read, so this also accepts
 * `BASIC_EQUIPMENTS` template entries directly.
 */
export function isEngineRollableItem(item: {
  formula?: string;
  manualResolution?: boolean;
  isArmor?: boolean;
}): boolean {
  return !!item.formula && !item.manualResolution && !item.isArmor;
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
    // Positional dice (bare d44/d66/d88, optional "a") shown as-is too, same
    // as plain NdX — never resolved to a number for display.
    const diceMatch = f.match(/\d+d\d+|d(?:44|66|88)a?(?![a-z0-9])/i);
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
    return { display: `${dicePart}${formatModifier(modifier)}` };
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
 * Advantage/disadvantage works on the WHOLE dice pool, not on a single
 * designated die: `extraDice` more dice of the same size are rolled and
 * appended to whatever the base formula already called for, then that many
 * dice are eliminated from the combined pool, one at a time — the current
 * worst die (lowest on advantage, highest on disadvantage) each time,
 * recomputed against whatever's still left after the previous elimination.
 * Eliminating one at a time (rather than a single sort-and-slice over the
 * whole pool) is what makes the tie-break rule below hold up correctly
 * when more than one die is eliminated. Whichever dice survive keep their
 * original left-to-right roll order in `kept` — they are never re-sorted
 * by value.
 *
 * Tie-break: when two or more remaining dice are equal at the extreme
 * being eliminated, the EARLIEST-rolled one of them goes, not the later
 * one. Counter-intuitive consequence worth knowing, not a bug: the extra
 * advantage/disadvantage dice are appended after the base dice, so a tie
 * between a base die and an extra die always eliminates the base die
 * first — the extra die "wins" the tie and survives.
 *
 * The PRIMARY die is `kept[0]`, the leftmost surviving die — and it alone
 * decides both outcomes: the roll is a critical hit if it shows the
 * maximum face, and a fumble if it shows a 1. The other kept dice (when
 * `count` > 1) never affect either check, no matter their own values.
 *
 * @param formula - Raw formula, e.g. "2d6+STR".
 * @param char - Character providing variable values.
 * @param mode - "standard" | "advantage" | "disadvantage".
 * @param extraDice - Number of extra dice to roll for advantage/disadvantage.
 * Ignored (forced to 0) when `mode` is "standard", regardless of sign or
 * value, since `mode` is the sole source of truth for how many dice are
 * rolled and kept.
 * @returns Full breakdown: dice notation, all rolls, kept rolls (original
 * roll order preserved — see above), modifier, total, and critical/fumble
 * flags read off the primary die (`kept[0]`). If the formula has no dice
 * (a flat modifier), `rolls`/`kept` are empty and `total` equals the
 * modifier. If the formula failed to parse or violated a safety limit,
 * `error` carries the message and every numeric field is zeroed rather
 * than clamped — the caller must not treat that as "rolled a 0".
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
): RollFormulaResult {
  return rollFormulaWithContext(formula, buildContext(char), mode, extraDice);
}

/** Return shape shared by {@link rollFormula} and {@link rollFormulaWithContext}. */
export interface RollFormulaResult {
  diceNotation: string;
  rolls: number[];
  /**
   * The dice that survived advantage/disadvantage elimination (or, in
   * standard mode, all of `rolls`), in their ORIGINAL roll order — never
   * re-sorted by value. `kept[0]` is the primary die: the leftmost
   * survivor, and the one `isCritical`/`isFumble` read. See
   * {@link rollFormula}'s own doc for the full elimination/tie-break rule
   * this ordering comes from.
   */
  kept: number[];
  /**
   * Index into `rolls` of every die eliminated by advantage/disadvantage
   * (empty for a standard roll, or a flat/positional-no-advantage roll
   * that never eliminates anything). Elimination order, not necessarily
   * ascending. Exists specifically so a display like `RollLog` can show
   * exactly which physical die was dropped WITHOUT re-deriving it from
   * `rolls`/`kept` by value — a value-based re-derivation can't
   * distinguish two equal-valued dice when only one of them was actually
   * eliminated (see `matchKeptDice.ts`'s header, kept as a fallback for
   * older log entries that predate this field).
   */
  droppedIndices: number[];
  modifier: number;
  total: number;
  isCritical: boolean;
  isFumble: boolean;
  /**
   * Whether the "1 = miss / max face = crit" rule can apply to this roll at
   * all. `false` for a flat, dice-less formula (nothing to crit/fumble on)
   * and for positional dice (`d44`/`d66`/`d88`, glossary: "these attacks do
   * not miss or crit") — `true` for a genuine `NdX` roll. This is a property
   * of the notation itself, not of any particular roll's outcome, which is
   * why it lives on the result rather than being inferred by a caller from
   * `kept` being empty (true for both "no dice" and "positional dice with
   * their rolls collapsed", but only the former is coincidental).
   * `isCritical`/`isFumble` are already forced `false` whenever this is
   * `false`, so this exists to let a caller distinguish "didn't crit this
   * roll" from "this notation can never crit", not to change that logic.
   */
  canCritOrFumble: boolean;
  error?: string;
}

/**
 * Same as {@link rollFormula} but takes a pre-built {@link FormulaContext}
 * directly, for call sites with no full `NimbleCharacter` to build one from
 * (e.g. the standalone {@link DicePanel} free-roll widget, which rolls with
 * no character selected at all). Mirrors {@link evalFormulaWithContext}'s
 * relationship to {@link evalFormula}.
 *
 * @param formula - Raw formula, e.g. "2d6+3".
 * @param ctx - Context used to resolve any variable the formula references.
 * @param mode - "standard" | "advantage" | "disadvantage".
 * @param extraDice - See {@link rollFormula}.
 * @returns See {@link rollFormula}.
 */
export function rollFormulaWithContext(
  formula: string,
  ctx: FormulaContext,
  mode: "standard" | "advantage" | "disadvantage" = "standard",
  extraDice = 0,
): RollFormulaResult {
  let sides = 20;
  let count = 1;
  let diceNotation: string;
  let modifier: number;

  try {
    const parsed = parseDamageFormula(formula, ctx);
    diceNotation = parsed.diceNotation;
    modifier = parsed.modifier;

    if (parsed.positional) {
      // Positional dice roll their own fixed 2 (or 3, for the "a" variant)
      // dice regardless of `mode`/`extraDice` — that's a property of the
      // notation itself (see rollPositionalDice), not something the
      // standard advantage/disadvantage-extra-dice mechanic below applies
      // to.
      return rollPositionalDice(parsed.positional, modifier, diceNotation);
    }

    if (!diceNotation) {
      // No dice in formula, e.g. flat "+3" — return immediately,
      // there's nothing to roll.
      return {
        diceNotation: "",
        rolls: [],
        kept: [],
        droppedIndices: [],
        modifier,
        total: modifier,
        isCritical: false,
        isFumble: false,
        canCritOrFumble: false,
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
      droppedIndices: [],
      modifier: 0,
      total: 0,
      isCritical: false,
      isFumble: false,
      canCritOrFumble: false,
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

  // Eliminate `extraCount` dice from the pool, ONE AT A TIME, recomputing
  // the drop position against whatever's still left each time — see
  // rollFormula's own doc for why this (rather than a single sort+slice)
  // is required for the tie-break rule to hold on a second-or-later
  // elimination, and why it leaves the survivors in their original
  // left-to-right roll order (a splice never reorders what it doesn't
  // remove). `extraCount` is 0 outside advantage/disadvantage, so the loop
  // is a no-op and `kept` is just `rolls` unchanged in standard mode.
  //
  // `keptOriginalIndices` is spliced in lockstep with `kept` so that, at
  // each step, `keptOriginalIndices[pos]` still names which slot of the
  // ORIGINAL `rolls` array a given surviving value came from — needed to
  // record `droppedIndices` by index rather than by value. A display
  // (RollLog) that instead tried to re-derive "which die was dropped" by
  // matching `rolls`/`kept` VALUES can't tell apart two equal-valued dice
  // when only one of them was actually eliminated — see
  // `matchKeptDice.ts`'s header for that exact bug.
  const kept = [...rolls];
  const keptOriginalIndices = rolls.map((_, i) => i);
  const droppedIndices: number[] = [];
  const dropIndexOf =
    mode === "disadvantage" ? indexOfHighestValue : indexOfLowestValue;
  for (let i = 0; i < extraCount; i++) {
    const pos = dropIndexOf(kept);
    droppedIndices.push(keptOriginalIndices[pos]);
    kept.splice(pos, 1);
    keptOriginalIndices.splice(pos, 1);
  }

  const diceSum = kept.reduce((a, b) => a + b, 0);
  const total = diceSum + modifier;

  // The primary die is kept[0] — the leftmost surviving die, in original
  // roll order, per rollFormula's own doc above. It alone decides crit
  // and fumble; the other kept dice (when count > 1) are irrelevant to
  // both checks.
  const isCritical = kept[0] === sides;
  const isFumble = kept[0] === 1;

  return {
    diceNotation,
    rolls,
    kept,
    droppedIndices,
    modifier,
    total,
    isCritical,
    isFumble,
    canCritOrFumble: true,
  };
}

/**
 * Rolls positional dice (`d44`/`d66`/`d88`, optional advantage variant) and
 * reads them into a single two-digit value — see the @file header and
 * {@link readPositionalValue}. Never critical or fumble (glossary: "these
 * attacks do not miss or crit"), regardless of what individual faces come
 * up, so `canCritOrFumble` is always `false` here.
 *
 * Non-advantage: rolls exactly 2 dice, both kept, read in roll order (first
 * = tens, second = ones) — `[4, 5]` reads as 45, never resorted to 54.
 *
 * Advantage (`spec.advantage`): rolls 3, drops the single lowest (leftmost
 * among ties — {@link indexOfLowestValue}), and reads the remaining 2
 * *positionally in their original roll order*, not sorted. `[4, 2, 5]` drops
 * the 2 and reads the remaining `[4, 5]` as 45, not 54.
 *
 * @param spec - Die size (4, 6, or 8) and whether this is the "a" variant.
 * @param modifier - Flat modifier already resolved by {@link parseDamageFormula}.
 * @param diceNotation - Display-ready notation (e.g. "d66a"), passed through unchanged.
 */
function rollPositionalDice(
  spec: { sides: number; advantage: boolean },
  modifier: number,
  diceNotation: string,
): RollFormulaResult {
  const { sides, advantage } = spec;
  const rolls = rollDice(advantage ? 3 : 2, sides);
  const droppedIndices = advantage ? [indexOfLowestValue(rolls)] : [];
  const kept = advantage
    ? rolls.filter((_, i) => !droppedIndices.includes(i))
    : rolls;
  const total = readPositionalValue(kept as [number, number]) + modifier;

  return {
    diceNotation,
    rolls,
    kept,
    droppedIndices,
    modifier,
    total,
    isCritical: false,
    isFumble: false,
    canCritOrFumble: false,
  };
}