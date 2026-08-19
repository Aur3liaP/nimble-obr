/**
 * @file Formats a numeric modifier with an explicit sign, for every place
 * this app displays one: initiative, defense/armor bonuses, stat modifiers,
 * skill modifiers, roll breakdowns.
 *
 * Extracted because the "+ -2" shape (a hardcoded "+" glued in front of an
 * already-negative number) was independently reimplemented — and
 * independently got wrong — at least twice in this codebase: the
 * initiative "Base" display (fixed in part 1b) and the defense-bonus line
 * (fixed in part 1d, alongside this extraction). Two unrelated call sites
 * hitting the same formatting mistake means each one was reimplementing it
 * instead of sharing it. Route every signed-modifier display through here.
 */

/**
 * Renders a numeric modifier with an explicit leading sign: `"+3"`,
 * `"-2"`, `"+0"`.
 *
 * Zero is not a special case: a modifier of 0 is still a real modifier,
 * and always showing its sign is what a caller gets for free by using this
 * instead of hand-rolling the same ternary. A caller that wants to omit a
 * zero modifier entirely (e.g. a roll breakdown that only shows a modifier
 * suffix when there is one, or a dice-formula string like `"3d6"` with no
 * `"+0"` tacked on) decides that at the call site — `modifier !== 0 &&
 * formatModifier(modifier)` — this function's only job is turning a number
 * into its signed string form, not deciding whether to render anything.
 *
 * @param n - The modifier value.
 * @returns The signed string form, e.g. `formatModifier(3)` → `"+3"`,
 * `formatModifier(-2)` → `"-2"`, `formatModifier(0)` → `"+0"`.
 */
export function formatModifier(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}
