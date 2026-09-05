# Formula parser: diagnostic history

Bug-hunting record behind several display/formatting rules in
`src/utils/formulaParser.ts`, `src/utils/computeDefense.ts`, and
`src/utils/formatModifier.ts`. The still-binding rules these incidents
produced are in CLAUDE.md's "Formula parser" section — this document is the
"why," kept for anyone re-touching this area who needs the full story
rather than just the rule.

## `resolveFormulaDisplay`: the audit that found every place it was skipped

Every tab that shows a formula is supposed to show the resolved display
string, never the raw formula. `InventoryTab`'s `ItemRow` didn't (fixed in
part 1c) — it showed `item.formula` raw (e.g. "6 + Math.min(DEX, 2)"
instead of "6+3"), unlike `CombatTab`'s `ActionRow` and `SpellsTab`'s
`SpellRow`. `CombatTab.InventoryFavoriteRow` (the Favorites-section
shortcut row for a starred inventory item) had the exact same gap — fixed
in part 1d, same treatment: `ItemRowBase` (shared by both rows) gained an
optional `formulaError` prop, styled the same red-text-plus-⚠-tooltip way
`ActionRow`/`SpellRow` handle a broken formula.

Getting the "browsing the catalog" vs. "browsing what's owned" distinction
backwards happened once, in part 1d, on the Defense section's armor
`<select>`: it looks like the "Add Item" picker (both are a list of
formula-bearing items) but is actually the opposite case, since it lists
armor the character already owns. When auditing this pattern, check every
place a tab renders an item or action formula, not just the obvious list —
the defense block's equipped-armor line had the identical "shows a
half-substituted formula string" problem hiding in a completely different
shape (see `computeDefense`, below), caught only by an explicit audit, not
by grepping for `resolveFormulaDisplay` itself.

## `formatModifier`: two independent reimplementations

`n >= 0 ? "+"+n : String(n)`-shaped code was independently reimplemented —
and independently got the negative case wrong as `"+ -2"` — at least twice:
the initiative "Base" display (part 1b) and the defense-bonus line (part
1d). `formatModifier` was wired into every site that displays or
constructs a signed modifier: `StatBox` (the stat-box bonus, and the
`1d20${...}` save-roll formula), `SummaryTab` (hit-die roll formula, the
hit-die-formula preview text, the read-only skill-value display, the
`1d20${...}` skill-check formula), `DicePanel` (the free-roll modifier
suffix/label and the modifier stepper's display), `RollLog` (the
roll-breakdown modifier), `CombatTab` (the initiative "Base" display, the
`1d20${...}` initiative-modal formula preview, and the defense-bonus
breakdown), and `useOBR.rollInitiative` (the actual initiative formula
rolled — not user-visible, since `DiceRollResult.formula` is never
displayed post-roll, but kept consistent with the preview rather than left
as a second, differently-styled construction of the same value).
`formulaParser.resolveFormulaDisplay` itself also calls it internally for
its own modifier suffix, instead of a third near-duplicate of the same
ternary — one of these was already correct before this cleanup, but
"already correct" and "not reimplemented a third time" are different
properties, and only the second one prevents the next call site from
getting it wrong again.

## `computeDefense`: from a half-substituted string to a real breakdown

`computeDefense` was extracted out of `CombatTab.tsx` in part 1f
specifically so its `breakdown` return value would be unit-testable — same
reasoning/pattern as `initiative.ts`. Before the extraction, the defense
block's breakdown text read `"Formula: 3+DEX + -2 bonus"` — DEX
unsubstituted, the bonus glued on with the double-sign bug (see below), and
the word "bonus" embedded in what looked like a formula. The fix (still the
current, binding shape) is documented in CLAUDE.md's "Formula parser"
section.

## The `substituteVariables` vs. normalization split

Two mechanisms handle a formula's "glued sign" shape in this codebase —
`Parser.parseUnary` (part 1c, makes a chained sign evaluate correctly) and
`normalizeSubstitutedSignsForDisplay` (part 1f, makes an unevaluated
display string read correctly) — and they were briefly merged into one,
incorrectly.

Part 1e briefly put the sign-collapsing logic *inside* `substituteVariables`
itself. This (a) mixed a presentation concern into a semantic pipeline
stage that `evalFormula`/`rollFormula`/`resolveFormulaDisplay` all depend
on, and more importantly (b) wasn't even a complete fix: `computeDefense`'s
breakdown concatenates `substituteVariables`'s output (the armor term) with
a *separately* formatted bonus term, appended *after* normalization would
already have run — the bonus's own sign, and the join between the two
terms, were never covered, so the bug (still reproducible in OBR) outlived
part 1e's own passing tests, which only exercised `substituteVariables` in
isolation and never asserted on `computeDefense`'s actual assembled output.

Part 1f moved normalization back out and applied it explicitly, once, to
the fully assembled breakdown string in `computeDefense` — the only point
that sees every join that can produce a glued sign. This is the shape
CLAUDE.md's "Formula parser" section now documents as binding.

## `normalizeSubstitutedSignsForDisplay`: the whitespace regression

Part 1f's fix passed its own tests and was still reproducible in OBR.
Root cause: part 1f's regex (`/\+-/`, `/--/`) only matched a sign glued
with no whitespace (`"3+-2"`), and its test used an idealized `"3+DEX"`
armor formula (no space) as input. Every real armor formula in
`equipment.ts` is written with spaces (`"3 + DEX"`, `"6 + Math.min(DEX,
2)"`, …), so `substituteVariables` actually produced `"3 + -2"` — a space
between the literal `+` and the substituted `-2` — which the old regex
never matched. OBR showed `"3 + -2-2 = -1"` (the bonus join, with no space,
DID collapse correctly; the armor term's own `"+ -"`, spaced, did not).

Fixed in part 1g by making both regexes swallow arbitrary surrounding
whitespace and re-emit a tight join (the current, binding regex is in
CLAUDE.md's "Formula parser" section). `computeDefense.test.ts` was updated
to assert against a real `BASIC_EQUIPMENTS` entry ("Garb Minor
Enchantment", formula `"3 + DEX"`), not a hand-typed idealization — that
mismatch between test input and real data shape is exactly what let the
part 1f regression ship in the first place.

## `manualResolution`: the flag that went unwired

`InventoryItem.manualResolution: true` marks flavour-text formulas (e.g.
equipment reading `WeaponDamage + 1d4`, referencing whatever weapon it's
enchanting — a concept the formula language has no variable for — resolved
by the GM by hand; currently set on 3 entries: Weapon of Animosity, Weapon
of Wounding, Vindication). This flag went unwired for a while — the fifth
instance of the same failure mode in this codebase (d66, `KEYd20`, `LVL`,
`FLAW`, then this one): a field documented in prose that nothing actually
reads. `manualResolution`'s own JSDoc claimed "not a formula meant to be
evaluated or rolled by the engine," but nothing checked it: all three
equipment entries rendered a working-looking roll button that threw a
formula error on click.

Fixed via the single choke point CLAUDE.md's "Formula parser" section
documents (`isEngineRollableItem`), wired into `InventoryTab.ItemRow`'s
roll trigger and formula display, and both `CombatTab`'s inventory-favorites
filter and its `favorites.length` gate. `InventoryTab.handleAddFromList`
also wasn't copying `manualResolution` from the `BASIC_EQUIPMENTS` template
onto the new `InventoryItem` at all — fixed alongside the read side, since
the read fix is inert without it (an item added via the picker would still
have carried `manualResolution: undefined` forever). Guarded by a
reflective test (`formulaParser.test.ts`, "InventoryItem.manualResolution
is honored by the roll path") that drives off `BASIC_EQUIPMENTS` itself,
not a hardcoded item-name list — mirrors the "FormulaContext contract"
test's reasoning for exactly the same reason: a future entry that sets the
flag is covered automatically, and removing the check from any call site
turns the test red.

Two side notes from this fix, not restated as ongoing rules but worth
knowing if this area comes up again: `CharacterAction.manualResolution`
(spells/actions) does not exist — it was removed in part 1c, having never
been set on any spell, since `formula: ""` already fully covers
"not engine-rollable" for actions. And `InventoryItem` is the only holder
of the `manualResolution` flag (confirmed by grep) — if a second holder is
ever added, it needs the same `isEngineRollableItem`-style wiring, not a
copy-pasted assumption that setting the field alone does anything.

## `useFormulaField`'s `discardedWarning`: the touched-at-mount mechanism

The residual gap CLAUDE.md's "Formula parser" section flags (the warning
can fire even when nothing was actually lost) comes from how `touched` is
initialized: a formula field starts `touched: true` from mount whenever its
`serverValue` is non-empty (i.e., the field already held a formula when the
edit panel opened), not only once the player has actually typed into it.
`closeEdit()` fires `discardedWarning` on any close where the current draft
fails `validateFormulaSyntax` and `touched` is true — so a formula that was
already invalid before the panel was ever opened satisfies both conditions
immediately, without the player having touched anything. Fixed by neither
this batch nor a planned one yet; tracked for 1.6.0 alongside the regex
unification noted in CLAUDE.md's "Formula parser" section.
