# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Owlbear Rodeo (OBR) extension: a real-time-synced character sheet panel for the **Nimble** TTRPG. React 19 + TypeScript + Vite + Tailwind CSS v4, using `@owlbear-rodeo/sdk` v3.1.0. Single project (no monorepo), pure static SPA, no backend, no env vars.

## Commands

- `npm run dev` : Vite dev server on `https://localhost:5173` (HTTPS via self-signed cert; register the manifest at `https://localhost:5173/manifest.json` in OBR's Extensions panel to test)
- `npm run build` : `tsc -b && vite build`
- `npm run type-check` : `tsc --noEmit`
- `npm run lint` : `eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0`
- `npm run test` : Vitest suite covering the formula parser
  (`src/utils/formulaParser.test.ts`), schema migrations
  (`src/utils/characterMigrations.test.ts`), delete-undo logic
  (`src/utils/entryUndo.test.ts`), and the shared search-filter hook
  (`src/hooks/useSearchFilter.test.ts`). Pure functions only, no OBR
  dependency. Deterministic dice via a `Math.random` spy (`mockRolls`
  helper), not by mocking `rollDice` (ESM mocking limitations in Vitest, and
  mocking it would leak into the public API signature). Don't hardcode a
  test count here or in the README: it drifts every time a test file is
  added, run `npm test` for the current number.
- `type-check` + `lint` + `test` passing is the bar for "done". Changes touching
  permissions, sync, or roll flow still need manual multiplayer verification in
  OBR (multiple accounts, multiple clients). There is no automated substitute.
  Flag this rather than claiming it's tested.
- After writing a test, reintroduce the bug it targets by hand and confirm the
  test goes red. A test that stays green on the known bug isn't doing its job.

## Architecture

- **No backend.** Persistence is entirely via the OBR SDK:
  - Character sheet: per-token item metadata, key `com.nimble-obr.nimble/character_sheet` (`METADATA_KEY` in `src/types/character.ts`), written via `OBR.scene.items.updateItems()`.
  - Shared roll log: scene metadata (`ROLL_LOG_KEY = ${METADATA_KEY}/roll_log`), capped at 20 entries.
  - Write-failure detection (`useOBR.ts`'s `performWrite`/`SyncStatus`) covers errors the OBR host reports and total loss of network interface (`navigator.onLine`). It does NOT cover the OBR host's own WebSocket relay to the multiplayer server dropping while the network interface stays up: `updateItems`/`setMetadata` resolve successfully either way, since the extension-host handshake is `window.postMessage` between iframe and parent frame, never the network. This residual gap is undetectable from the extension — see the `"idle"` case in `SyncStatus`'s JSDoc.
- HTTPS is mandatory even for local dev (OBR loads extensions in an iframe requiring HTTPS). `@vitejs/plugin-basic-ssl` is loaded only when `command === 'serve'` in `vite.config.ts`, never in production builds.
- `OBR.isAvailable` is checked before `OBR.onReady(...)` since the app also runs fine outside an OBR host during plain `vite dev`/build.
- Only items with `layer === "CHARACTER"` are treated as valid character tokens (selection filtering in `useOBR.ts`).
- `useOBR` is the single integration point with the SDK and central state hook. It exposes both a `permissions` object and deprecated top-level `canEdit`/`isGM` fields kept only for incremental migration. Read from `permissions.canEdit`/`permissions.isGM` in new code, not the deprecated fields.
- IDs are always generated with `crypto.randomUUID()`.
- Mutually exclusive row states use the `expandedId` / `editingId` pattern.
- **`CombatTab`'s HP block does not let you edit `hp.max` — this is
  original, longstanding design, not a regression.** Investigated in part
  1e via `git log -p --follow` on the whole file history: `hp.max` has
  rendered as a plain, non-editable `<span>` in `CombatTab` since the tab's
  very first HP implementation, predating every batch in this series by a
  wide margin. `hp.current` and `hp.temp` are editable there (matching the
  file's own framing, "HP/wounds quick view"); full editing, including
  `hp.max`, lives in `SummaryTab`. Don't "restore" this without a real
  design decision to add it — it was never removed. Re-confirmed in part
  1f (this note had been queried a second time) — nothing changed, the
  finding stands; if it comes up a third time, that's a request for a new
  feature, not a bug report.
- **Every tab that shows a formula shows the resolved display string
  (`resolveFormulaDisplay`), never the raw formula.** `InventoryTab`'s
  `ItemRow` didn't (fixed in part 1c) — it showed `item.formula` raw (e.g.
  "6 + Math.min(DEX, 2)" instead of "6+3"), unlike `CombatTab`'s
  `ActionRow` and `SpellsTab`'s `SpellRow`. `CombatTab.InventoryFavoriteRow`
  (the Favorites-section shortcut row for a starred inventory item) had the
  exact same gap — fixed in part 1d, same treatment: `ItemRowBase` (shared
  by both rows) takes an optional `formulaError` prop, styled the same
  red-text-plus-⚠-tooltip way `ActionRow`/`SpellRow` handle a broken
  formula — a formula that fails to resolve must render as an error, never
  as if it were a valid value (same concern as `computeDefense`'s `error`
  return in `CombatTab.tsx`, and the same concern that drove the defense
  block's own breakdown display below). `manualResolution: true` items are
  the deliberate exception in both rows: raw text, no `resolveFormulaDisplay`
  call at all, no error styling — that text was never a formula the parser
  could evaluate, so reporting it as "invalid" would be exactly as wrong as
  rolling it (see the "InventoryItem.manualResolution" bullet elsewhere in
  this file). The "Add Item" picker (browsing `BASIC_EQUIPMENTS` book
  content) deliberately still shows the raw formula — it mirrors the
  book's own notation, which helps recognition while browsing something the
  character doesn't own yet, matching what `AddSpellModal` already does;
  don't "fix" that one to match the item rows. The Defense section's armor
  `<select>` is NOT the same case despite living next to it structurally —
  it lists armor the character already owns, exactly like an inventory
  row, so it resolves through `resolveFormulaDisplay` too (a native
  `<option>` can't carry `formulaError`'s red/⚠ styling, but
  `resolveFormulaDisplay` already falls back to the raw formula string on
  error, so it degrades sensibly without that styling). Getting this
  distinction backwards once already happened in part 1d: "browsing
  book content" and "browsing what you own" look similar (both are a list
  of formula-bearing items) but are opposite cases for this rule — check
  which one a new list actually is, not just whether it resembles a picker.
  When auditing this pattern, check every place a tab renders an item or
  action formula, not just the obvious list — the defense block's
  equipped-armor line had the identical "shows a half-substituted formula
  string" problem hiding in a completely different shape (see the
  `formatModifier`/defense-breakdown bullet below), caught only by an
  explicit audit, not by grepping for `resolveFormulaDisplay` itself.
- **Signed-modifier display goes through `formatModifier`
  (`src/utils/formatModifier.ts`), never a hand-rolled sign ternary.**
  `n >= 0 ? "+"+n : String(n)`-shaped code was independently reimplemented
  — and independently got the negative case wrong as `"+ -2"` — at least
  twice: the initiative "Base" display (part 1b) and the defense-bonus line
  (part 1d). `formatModifier(n)` always includes a sign, including `"+0"`
  for zero (zero is still a real modifier); a caller that wants to omit a
  zero modifier entirely decides that itself (`modifier !== 0 &&
  formatModifier(modifier)`), the function's only job is the sign. Wired
  into every site that displays or constructs a signed modifier: `StatBox`
  (the stat-box bonus, and the `1d20${...}` save-roll formula),
  `SummaryTab` (hit-die roll formula, the hit-die-formula preview text, the
  read-only skill-value display, the `1d20${...}` skill-check formula),
  `DicePanel` (the free-roll modifier suffix/label and the modifier
  stepper's display), `RollLog` (the roll-breakdown modifier), `CombatTab`
  (the initiative "Base" display, the `1d20${...}` initiative-modal formula
  preview, and the defense-bonus breakdown), and `useOBR.rollInitiative`
  (the actual initiative formula rolled — not user-visible, since
  `DiceRollResult.formula` is never displayed post-roll, but kept
  consistent with the preview rather than left as a second, differently-
  styled construction of the same value). `formulaParser.resolveFormulaDisplay`
  itself now also calls it internally for its own modifier suffix, instead
  of a third near-duplicate of the same ternary — one of these was already
  correct before this batch, but "already correct" and "not reimplemented a
  third time" are different properties, and only the second one prevents
  the next call site from getting it wrong again.
- **`computeDefense` (`src/utils/computeDefense.ts`, extracted out of
  `CombatTab.tsx` in part 1f specifically so its `breakdown` return value
  is unit-testable — same reasoning/pattern as `initiative.ts`) shows a
  resolved arithmetic breakdown, not a half-substituted formula string.**
  It used to read `"Formula: 3+DEX + -2 bonus"` — DEX unsubstituted, the
  bonus glued on with the double-sign bug below, and the word "bonus"
  embedded in what looked like a formula. `computeDefense` returns
  `breakdown`: the armor formula (or the raw DEX value, unarmored) run
  through `substituteVariables` (exported from `formulaParser.ts`) so
  variables resolve but the arithmetic stays unevaluated ("3+DEX" at DEX 2
  → "3+2", not collapsed to "5" the way `resolveFormulaDisplay`'s no-dice
  branch would), then the flat bonus via `formatModifier` (omitted
  entirely when it's 0), THEN the whole assembled string — armor term +
  bonus term + total — is passed through
  `normalizeSubstitutedSignsForDisplay` (see the dedicated bullet below) as
  the very last step, giving e.g. `"3-2-2 = -1"` for armor "3+DEX" at DEX
  -2 and a -2 bonus. `breakdown` is `undefined` whenever `error` is set —
  same "not a trustworthy number, show it distinctly" contract
  `computeDefense` already had; the caller shows the error message (now
  visibly, not just in a tooltip) instead of any breakdown text.
- **Two mechanisms handle a formula's "glued sign" shape in this codebase
  — `Parser.parseUnary` and `normalizeSubstitutedSignsForDisplay` — and
  neither is redundant with the other; they solve different problems at
  different pipeline stages.** `parseUnary` (part 1c) makes `"1d8+-1"`
  EVALUATE to the right number — mandatory, load-bearing, every roll and
  every resolved value in this app depends on it, do not touch it for a
  display concern. `normalizeSubstitutedSignsForDisplay`
  (`formulaParser.ts`, part 1f) makes a string that's shown WITHOUT
  evaluation READ correctly — purely cosmetic, nothing downstream depends
  on its output being further parsed. `substituteVariables` itself stays
  purely semantic and does NOT normalize signs — part 1e briefly put this
  same collapsing logic INSIDE `substituteVariables`, which (a) mixed a
  presentation concern into a semantic pipeline stage that
  `evalFormula`/`rollFormula`/`resolveFormulaDisplay` depend on, and more
  importantly (b) wasn't even a complete fix: `computeDefense`'s breakdown
  concatenates `substituteVariables`'s output (the armor term) with a
  SEPARATELY formatted bonus term, appended AFTER normalization would have
  already run — the bonus's own sign, and the join between the two terms,
  were never covered, so the bug (still reproducible in OBR) outlived
  part 1e's own passing tests, which only exercised `substituteVariables`
  in isolation and never asserted on `computeDefense`'s actual assembled
  output. Part 1f moved normalization back out and applies it explicitly,
  once, to the FULLY ASSEMBLED breakdown string in `computeDefense` — the
  only point that sees every join that can produce a glued sign. If a
  future call site shows a substituted-but-unevaluated formula string, it
  must call `normalizeSubstitutedSignsForDisplay` itself; `substituteVariables`
  will not do it implicitly.
- **`normalizeSubstitutedSignsForDisplay` must tolerate whitespace around
  the signs, not just a zero-whitespace glued pair — part 1f's fix passed
  its own tests and was STILL reproducible in OBR.** Root cause: part 1f's
  regex (`/\+-/`, `/--/`) only matched a sign glued with no whitespace
  (`"3+-2"`), and its test used an idealized `"3+DEX"` armor formula (no
  space) as input. Every REAL armor formula in `equipment.ts` is written
  with spaces (`"3 + DEX"`, `"6 + Math.min(DEX, 2)"`, …), so
  `substituteVariables` actually produces `"3 + -2"` — a space between the
  literal `+` and the substituted `-2` — which the old regex never matched.
  OBR showed `"3 + -2-2 = -1"` (the bonus join, with no space, DID collapse
  correctly; the armor term's own `"+ -"`, spaced, did not). Fixed (part
  1g) by making both regexes swallow arbitrary surrounding whitespace and
  re-emit a tight join: `s.replace(/\s*\+\s*-\s*/g, "-").replace(/\s*-\s*-\s*/g, "+")`.
  `computeDefense.test.ts` now asserts against a real `BASIC_EQUIPMENTS`
  entry (`"Garb Minor Enchantment"`, formula `"3 + DEX"`), not a hand-typed
  idealization — that mismatch between test input and real data shape is
  exactly what let the part 1f regression ship in the first place. When
  testing a regex-over-a-string display fix like this one, always verify
  against the actual string the app produces (read the source data), not a
  hand-typed stand-in for it.
- **The Nimble 3rd Party Creator License v2.0 notices are a legal
  requirement**, not a design choice, and live in `RollLog.tsx` (see its
  `@file` header) — NOT a standalone panel-footer component, and, as of
  part 1e, INLINE MODE ONLY (not the floating pill). They used to be a
  permanent `LicenseNotice` footer (removed: it ate vertical space on an
  already-cramped laptop screen); the license accepts "a banner, sidebar,
  welcome message" as prominent placement, so the full VTT notice is
  pinned at the top of the inline roll log and the short attribution line
  (component `LicenseAttribution`, renamed from the unhelpfully generic
  `Attribution` in part 1f) at its foot — present from the empty state
  onward, neither dismissible, neither able to be interleaved with entries;
  the notices are the first/last items in the flex column, structurally
  outside the entries list's own scroll container (added part 1g, see
  below) so they never scroll away with it. Both notices were briefly ALSO
  in the floating popup (part 1c/1d) — removed in part 1e: no room for a
  full paragraph plus attribution without the popup becoming awkward, and
  the inline rendering is already reachable via the no-token "welcome"
  state, which recurs on every deselection rather than being a one-time
  dismissal — see `App.tsx`'s `showNoToken` condition on the inline
  `RollLog`. Do not reintroduce a panel-level footer for this.
- **The inline roll log's attribution line reaching the panel's true
  bottom needed a fix in the PARENT CHAIN, not another rule on the
  attribution itself — the third and fourth attempts (part 1c's `mt-auto`,
  part 1d's added `min-h-56` floor, part 1e's `flex-1` on the entries area
  alone) all still read as "floating" in real OBR testing, because none of
  them addressed the actual gap.** Root cause, found in part 1f by walking
  the DOM chain from the panel root down: `App.tsx`'s `<main>` receives a
  correctly constrained height from being a `flex-1` item of the panel
  root's `flex flex-col h-full` — but `<main>` itself had no `flex`/
  `flex-col` class of its own, so it was never a flex CONTAINER for its
  OWN children. Its children (including the DicePanel/RollLog wrapper
  `<div>`) just stacked in normal block flow at natural content height,
  and `<main>`'s leftover space became blank area below all of them,
  undistributable to any one child — no amount of `flex-1`/`mt-auto`
  *inside* `RollLog`'s own subtree could reach space that was never handed
  down to it in the first place. (Concrete evidence this was a real gap,
  not just a hypothesis: the no-token header `<div>` already carried a
  `shrink-0` class — meaningless without a flex parent — presumably added
  on the assumption `<main>` already was one.) Fixed at that level: `<main>`
  is now `flex flex-col`; the DicePanel/RollLog wrapper `<div>` and
  `RollLog`'s own inline root both carry `flex-1 min-h-0` (the `min-h-0`
  defeats the flex-item default `min-height: auto`, which would otherwise
  partially block the `flex-1` from taking effect); `RollLog`'s internal
  entries-area `flex-1` (unchanged from part 1e) still does the final,
  innermost push. `min-h-56` is gone — the floor was a leaf-level band-aid
  for a parent-chain problem, no longer needed once real available space
  flows down correctly. This is INLINE-mode-only; the floating popup is
  `position: absolute` and self-contained (`max-h-80`), unaffected by any
  of this chain.
- **SUPERSEDED (part 1h) — see the part 1h bullet below for the current
  design. Kept for the mechanism explanation (still accurate) and as a
  record of what didn't work, per this file's own convention of not
  deleting diagnosed history.** Part 1g's OWN fix (tab content gets its own
  independent `overflow-y-auto` scroll region) turned out to violate a
  requirement nobody had written down until part 1h's "Panel layout
  contract": `DicePanel` must scroll WITH the sheet, not sit pinned below a
  separately-scrolling tab content box. Do not re-derive this "split scroll
  region" approach again — it was already tried and already reverted.
- **REGRESSION (part 1g), introduced by the very fix directly above: giving
  `<main>`'s two children EQUAL competing `flex-1` treatment collapsed the
  DicePanel/RollLog wrapper to 0px height whenever a sheet tab was open.**
  Confirmed as a purely CSS layout collapse, NOT the JSX-early-return
  unmount failure mode documented under "Structural constraints" below —
  this tree was already a single, unconditional return with `DicePanel`
  always mounted; that failure mode does not apply here. Mechanism: tab
  content has `flex: 0 1 auto` (default, content-based basis); the
  DicePanel/RollLog wrapper below it had `flex-1` (`flex: 1 1 0%`, zero
  basis). Whenever tab content's natural height exceeded `<main>`'s
  available space (routine — spell/inventory lists routinely do), flexbox's
  negative-space shrink pass divides the deficit by each item's SCALED
  shrink factor (`shrink × basis`); the wrapper's scaled factor is
  `1 × 0 = 0`, so it absorbed none of the deficit, got none of the leftover
  growth either (there was none), and rendered at its bare 0% basis: 0px.
  Fixed by no longer letting the two children compete for the same space at
  all: the tab content itself is now the scroll region
  (`flex-1 min-h-0 overflow-y-auto`, wrapping the `activeTab === ...`
  blocks), so an arbitrarily tall tab scrolls internally instead of
  starving its sibling; the DicePanel/RollLog wrapper is `shrink-0`
  (natural content height, always rendered in full) whenever a sheet tab is
  present. In the no-token/no-sheet/unsupported/invalid states the wrapper
  is `<main>`'s ONLY child (no competing sibling) and still needs
  `flex-1 min-h-0` to reach `<main>`'s real bottom and pin the license
  attribution there — so `App.tsx` picks the wrapper's class conditionally
  on `showSheet`. **Do not go back to giving both of `<main>`'s children
  `flex-1`** — that is this exact regression. Any future change to this
  region must re-walk all four tabs plus every no-sheet-open state, not
  just the one being edited: this is the SECOND layout regression the
  `<main>` flex change alone has produced, so treat that flex context as a
  blast radius, not a self-contained local edit.
- **No-token welcome state: a roll landed below the fold (part 1g).** The
  inline `RollLog`'s entries list (newest-first) had `flex-1` but no
  `min-h-0`/`overflow-y-auto`, so it could only ever GROW to fill leftover
  space, never SHRINK below its own content height. In the no-token state,
  the free-roll panel plus the license notice already fill a typical laptop
  panel height with zero entries; adding one entry pushed the whole
  panel's content taller than the viewport, and `<main>`'s own
  `overflow-y-auto` made the PAGE scroll to reveal it — a roll read as
  though nothing had happened until the user scrolled. Fixed by bounding
  the entries list itself (`min-h-0 overflow-y-auto`) so it scrolls
  INTERNALLY instead of pushing its container taller. Because the list is
  newest-first, the just-added roll is always the first item and so is
  visible immediately, with no scrolling, regardless of how many older
  entries end up pushed below it inside this now self-contained region.
- **Part 1h: RESTORED `<main>` to a single, plain scroll region — no flex
  container, no split scroll regions — when a sheet tab is open, per the
  "Panel layout contract" below.** This is the third batch in a row to
  touch this exact area (1e implicitly, 1f, 1g), and the first written
  AFTER the contract existed, specifically so it could be checked against
  every state at once instead of just the one most recently reported
  broken — see the contract section for why that discipline exists now.
  `<main>`'s classes are conditional on `showSheet`:
  - **Sheet tab open:** `<main>` is plain `overflow-y-auto` (no `flex
    flex-col`). Tab content and the `DicePanel`/RollLog wrapper are two
    ordinary block-level children — no flex classes on either — so they
    simply stack, and `<main>`'s own scrollbar moves both together.
    `DicePanel` sits at the bottom of the tab content and scrolls away
    with it, per the contract, instead of being pinned below an
    independently-scrolling tab-content box (part 1g's mistake) or
    collapsing to 0px (part 1f's).
  - **No-sheet states (no-token/no-sheet/unsupported/invalid):** `<main>`
    IS `flex flex-col` here, and the wrapper is `flex-1 min-h-0` — this is
    genuinely still needed, and this is the direct answer to "if the
    license fix depended on `<main>` being flex, say so": it does, but
    ONLY in this branch, where the wrapper is `<main>`'s SOLE child. The
    part 1g collapse bug required TWO children with mismatched flex-basis
    fighting over shrink space; a lone child can't do that to itself, so
    stretching it here is safe. `RollLog`'s own inline root and entries
    area (parts 1f/1g) are unchanged and still do the last two steps of
    the same chain — see `RollLog.tsx`. Inline `RollLog` is never rendered
    in the sheet-open branch (see its call site a few lines below), so its
    dependency on this flex chain never needs the sheet-open branch to
    provide it.
  - **Auto-close (new in part 1h, not a restoration):** `DicePanel` now
    calls `setCollapsed(true)` at the end of its own `handleRoll`, in
    `DicePanel.tsx` — every roll, in every state it can be opened from,
    closes it. This is what makes "opening `DicePanel` must not hide the
    log" trivially true in the common case (the panel is only ever open
    for the brief moment before a roll), and is the mechanism the "state
    transitions" clause of the contract leans on.
  - This restore intentionally does NOT touch: the whitespace-tolerant
    `normalizeSubstitutedSignsForDisplay` fix (part 1g, unrelated to
    layout), the inline license notices living in `RollLog.tsx` instead of
    a separate `LicenseNotice` footer (part 1e, kept — see its own
    bullet), or `RollLog`'s entries-list internal scroll bound (part 1g,
    kept — still the right fix, still needed once the license text lives
    inline instead of in a separate persistent footer with its own
    reserved space).

### Panel layout contract

**Binding requirements for `App.tsx`'s `<main>`, the tab content area, and
the `DicePanel`/`RollLog` wrapper.** Written in part 1h after three
consecutive batches (1e, 1f, 1g) each adjusted flex rules in this exact
region and broke a different state — every fix was verified against
whichever state had just been reported broken, with no written statement
of what "correct" meant for every other state at the same time. This
section is that statement. A change to `<main>`'s classes, the tab content
wrapper's classes, or the `DicePanel`/`RollLog` wrapper's classes **must
not be made without re-reading this section and re-verifying every state
listed below** — not just the state the change was made for.

- **`DicePanel`, sheet tab open:**
  - Sits at the bottom of the tab content, in normal document flow.
  - Scrolls WITH the content: scrolling the sheet up moves `DicePanel` out
    of view along with it. It is never pinned/fixed relative to the
    panel's own bottom edge while a sheet is open.
  - When opened (expanded), the roll log stays visible at the same time —
    `DicePanel` must never take over the full available height or push the
    log out of the layout entirely.
  - Closes itself automatically once a roll is made (see "State
    transitions" below).
- **`DicePanel`, no-token / no-sheet / unsupported-version / invalid-sheet
  state:**
  - Same behavior: opening it must not hide the inline roll log.
  - A roll's result must be visible **without scrolling** — not merely
    reachable by scrolling, actually on-screen the instant the roll lands.
  - Closes itself automatically once a roll is made.
- **State transitions:** `DicePanel`'s open/closed state (`collapsed`,
  local `useState` inside the always-mounted component — see "Structural
  constraints" below for why it's always mounted) must never carry over in
  a way that hides or covers the sheet once a token is selected. The
  auto-close behavior above should make this moot in practice (a roll
  closes the panel before a token selection could even matter), but this
  must still be verified explicitly — a user who opens `DicePanel` and then
  selects a token *without* rolling first is a real path this contract
  covers too, not just the roll-then-select path.

Verifying this contract means walking every state above individually, not
running `type-check`/`lint`/`test` — none of them can see layout. See the
"Verification" note logged against each part-1h/i/… batch that touches
this region for what was actually checked and what could not be checked in
a non-OBR environment.

### Value ranges

Enforced both at the input layer (rejects/clamps in the component) and,
defense in depth, at the single write choke point (`updateCharacter` in
`useOBR.ts`) — same reasoning as `MAX_LEVEL`'s clamp: an HTML `min`/`max`
attribute doesn't stop a typed value from being committed.

| Field | Range | Source |
|---|---|---|
| `stats.{str,dex,int,wil}` | `[MIN_STAT, MAX_STAT]` = `[-5, +5]` | Rulebook p.6 |
| `skills.*` | `[MIN_SKILL, MAX_SKILL]` = `[-5, +12]` | Rulebook p.7, p.21 — the +12 ceiling is absolute, not "stat + points"; the floor mirrors the stat floor since invested points are never negative |
| `level` | `[1, MAX_LEVEL]` | dice-safety-limit driven, see `MAX_LEVEL`'s JSDoc |
| `maxWounds` | **not clamped** | deliberately a free field — see below |

- **`maxWounds` is intentionally NOT clamped to any fixed number (e.g. 6).**
  Ancestry (Dwarf +1, Planarbeing -2), background (Back Out of Retirement
  -1, Devoted Protector +3), and the optional Gritty Dying variant (down to
  2) all modify it in ways that can't be derived from other fields, so it's
  a free numeric field the player/GM sets directly. Folded into the
  existing `{wounds}/{maxWounds} wounds` counter in `SummaryTab`, under
  `canEdit` — not a separate labeled row. Rendered as a compact BOXED
  `<input>` (border, background, fixed `w-7`), the same treatment as the
  Hit Dice fields right below it, NOT `InlineNumberField` (tried first, in
  part 1c/1d): that component's underline style (`w-full`, no visible box)
  reads as a free text field in this tiny `text-[10px]` context, not a
  small stepper/box. `setWounds` still clamps *wounds* to `maxWounds + 1`
  (the fatal wound slot) — that behavior is unrelated and unchanged.

### Structural constraints (do not refactor away)

These exist because of bugs already diagnosed and fixed. Changing them reintroduces the bug.

- **`App.tsx` is a single JSX tree, not multiple early-return branches.** `DicePanel` must never unmount, or in-progress dice state is lost whenever `selectionState` changes. Consolidating the tree is the fix; "improving readability" with early returns undoes it. Two distinct failure modes have hit `DicePanel` visibility and must not be conflated: this bullet (JSX branching → real unmount, state loss) is one; the part 1g `<main>`-flex-collapse regression (see the "REGRESSION (part 1g)" bullet earlier in this Architecture section — DicePanel stayed mounted the whole time, its wrapper just rendered at 0px height) is a different, purely-CSS one. Before "fixing" a DicePanel-invisible report, determine which of the two it is (DOM inspector: is the node present at 0px, or absent entirely?) — the fix for one does nothing for the other.
- **The roll log has a single source of truth.** Pushing a visible roll writes to `OBR.scene.setMetadata` only; local `recentRolls` state is updated **only** by the `onMetadataChange` listener, never directly by the push function. The double update remounts conditional UI in `App.tsx`. Hidden (GM-only) rolls are the deliberate exception: they skip scene metadata and go straight to local state.
- **Drag interactions keep local state during the drag and commit once on release.** Writing to OBR on every `mousemove` floods the network. Resync protection when external changes arrive mid-drag is required, not optional.
- **Formula input fields keep local state and only commit when valid.** Every other text `FormField` in an edit-row panel (Name, Range, Description...) writes to `onUpdate`/OBR on every keystroke by design — that's fine, any string is a valid value. Formula fields are the deliberate exception: `useFormulaField` (mirroring `useDraggableValue`) buffers a local draft and only commits once it's syntactically valid or empty, so an in-progress, unparseable formula is never broadcast to the table. Unlike a drag (~2s), a formula edit can run long enough that an external change to the same field can arrive mid-edit; `useFormulaField`'s resync is skip-and-warn (`conflictWarning`), not skip-and-silent, specifically so that case doesn't quietly overwrite someone else's change on commit. See the write-time-syntax-only bullet under Formula parser below for why the commit gate checks syntax, not resolved values.
- **Tailwind cannot compile dynamic class names.** When `colorClass` is a function, use an inline `style` prop, not a computed class string.

### Permission model

| Role | Can edit |
|---|---|
| Token owner (player, matches `ownerId`) | Their own sheet |
| GM | Any sheet, regardless of `ownerId` |
| Other player | Read-only (edit controls hidden, not disabled) |

- `permissions` (`{ canEdit, isGM, isOwner, isUnclaimed }`) is computed once in `useOBR` and passed explicitly as **props** to every interactive component, deliberately not exposed via React context. Any new component needing it must have it threaded through manually.
- `updateCharacter` re-checks `canEdit` before every write and no-ops with `console.warn` if the caller lacks rights. This is **not a real security boundary** (OBR has no server-side ACL on metadata); it only guards against accidental stale-UI writes.
- Rolling dice is intentionally **not** gated by `canEdit`. A read-only viewer can roll using another character's stats. Only persisting sheet changes is guarded. This is a design decision, not an oversight.
- Claiming or taking over a sheet is also intentionally **not** gated. Any player can currently take over another player's claimed sheet (deliberate design for a trusted table). If GM-only claiming is ever wanted, add the guard at the call site (`App.tsx`/`CharacterHeader.tsx`), not in `useOBR`.

### Initiative (`CombatTab.tsx`, `src/utils/initiative.ts`)

- Initiative rolls through the shared `DiceRollModal`, same as every other
  roll (stat saves, skill checks, actions) — it does NOT roll immediately on
  click. `character.initiativeAdvantage` (a `SaveAdvantage`, defaulting to
  `"none"`) pre-selects the modal's default mode, overridden only if the
  modal is left on "standard" — same pattern as `SaveMods`' per-stat
  advantage in `SummaryTab.confirmRoll`, applied in
  `CombatTab.confirmInitiativeRoll`.
- `initiativeToActions(total, naturalRoll)` (`src/utils/initiative.ts`, pure
  and unit-tested — extracted out of `CombatTab.tsx` specifically so it's
  testable) implements the Nimble Core Rules 2nd printing (p.15) action
  grant: 1 digit → 1 action, 2 digits → 2 actions, **20+ OR a natural 20 →
  3 actions**. `naturalRoll` must be the KEPT d20 after advantage/
  disadvantage resolution (`RollFormulaResult.kept[0]`), not the raw first
  die rolled — with advantage, 2d20 are rolled and the higher one kept, and
  that kept die is what "natural 20" means. A natural 20 grants 3 actions
  even if a large negative DEX/`initiativeBonus` brings the total under 20.
- `character.combat.initiativeResult` still stores only the total (not
  `naturalRoll`) — the 5s-display banner in `CombatTab` reads
  `combat.actionsRemaining` (already set correctly by the roll) rather than
  recomputing `initiativeToActions` from the stored total alone, since that
  alone can't reconstruct whether it was a natural 20.

### Schema versioning (`src/utils/characterMigrations.ts`)

`NimbleCharacter` carries a `schemaVersion` field (`CURRENT_SCHEMA_VERSION` in
`types/character.ts`). `migrateCharacter` is the single choke point that
brings an old record up to date, refuses one from a newer, not-yet-reloaded
client (`"unsupported"`), and refuses one that's corrupted even after
migration (`"invalid"`) — `useOBR.ts`'s `loadCharacterFromItem` is the only
caller. To add a migration: change `NimbleCharacter`, bump
`CURRENT_SCHEMA_VERSION` by exactly 1, and append one `v(n) -> v(n+1)`
function to `MIGRATIONS`. Full procedure and the reasoning behind each
design choice (why `MIGRATIONS` is an ordered array of single-step
functions, why a versionless record is treated as v0, why there's no
downward migration, why shape validation is a template walk over
`createDefaultCharacter()` rather than a hand-written schema) are in that
file's header and JSDoc — read it before touching this, don't reinvent an
ad hoc patch in `loadCharacterFromItem` the way the old `combat` backfill
used to be. See `docs/schema-migrations.md` for the full picture (the
procedure to add a field, what deploy-time looks like across clients, and
why `MIGRATIONS[0]` is a generic fill legitimate only for v0).

`validateCharacterShape`'s template-walk approach is deliberately scoped to
validating this project's own migration output, not arbitrary external
data — see its JSDoc for the exact gaps (optional fields, array element
shape, enum values). If `NimbleCharacter` grows substantially, or a sheet
ever needs to come from outside this app's own migration chain (a file
import, a copy pasted between scenes), replace it with a real schema
library (Zod or equivalent) and derive `NimbleCharacter` from the schema
(`z.infer`) rather than maintaining both by hand — two hand-maintained
descriptions of the same shape is exactly how `FLAW` (see Formula parser
below) went undetected.

- **Schema v2: `Armor` renamed to `Defense`, `CharacterAction.damage` removed,
  `InventoryItem.armorValue` removed, `manualResolution` backfilled — all
  FOLDED into the existing v1 -> v2 migration step, not a new v2 -> v3.**
  Deliberate, one-time exception to "leave every earlier migration function
  alone" (see this file's own procedure above): safe ONLY because v1 -> v2
  had never shipped at the time — no build in circulation had ever written
  `schemaVersion: 2`, so no real persisted record's correctness depends on
  that step's old, narrower (initiativeAdvantage-only) behavior. A local
  test scene that already held an old v2 shape from before this change will
  NOT be re-migrated (its `schemaVersion` is already current) and needs a
  manual reset. This does not generalize — the next migration after this
  one goes back to appending a new step, never editing an existing one.
  - **`Armor` -> `Defense`, `NimbleCharacter.armor` -> `.defense`.** Nimble
    Core Rules 2nd printing renames the hero stat "Armor" to "Defense" —
    "Armor" now means exclusively worn equipment
    (`InventoryItem.isArmor`/`isArmor: true` entries in `equipment.ts`,
    `character.defense.equippedItemId`). The interface carries
    `defenseBonus`, which comes from traits that are not armor at all
    (Dragonborn +1 Defense, Turtlefolk +4 Defense, Fearless -1 Defense,
    Ratfolk +2 Defense) — `character.armor.defenseBonus` was semantically
    wrong even before the printing renamed the stat, independent of the
    rename itself. **Only the hero stat was renamed** — every other sense
    of "armor" in this codebase is untouched: monster armor keywords
    ("ignoring armor" on Tooth & Claw, Monster Medium/Heavy Armor),
    `InventoryItem.isArmor`/`isArmor: true` (worn equipment), and
    equipment proficiency text. Two hero-stat mentions in `spells.ts`
    prose also needed the rename, since they describe the character's own
    stat while a spell is active, not a monster or worn item: Dragonform's
    "Level Armor" -> "Level Defense", Shield of Justice's "Upcast: +5
    Armor" -> "+5 Defense". **`equipment.ts`'s "Armor: X+DEX" description
    label was gotten WRONG in this same batch, then corrected in the very
    next one** — first pass reasoned "the item itself is still armor, so
    its description is unaffected," but the label isn't naming the item,
    it's naming the NUMERIC VALUE that follows the colon (the Defense the
    item grants — the book's own equivalent table has a DEFENSE column for
    exactly these numbers), same category of mistake as the
    `formatModifier`/defense-breakdown and ItemRowBase/formulaError traps
    already logged elsewhere in this file: something that LOOKS like "the
    worn-item sense of armor" on first read is actually "the stat, just
    inside a longer sentence." Fixed to "Standard clothes. Defense:
    2+DEX." etc., across all 20 armor/shield descriptions (Cloth, Leather,
    Mail, Plate, Shields) — done via a line-scoped script matching only
    `description: "..."` lines containing the literal `"Armor: "` label,
    specifically to avoid also matching `isArmor: true` (whose field name
    contains that exact substring too — a blind global find-and-replace
    across the file would have silently renamed the `isArmor` field
    itself). The item's own name/category and its "Old plate armor."-style
    prose (no colon, naming the gear, not a value) still correctly say
    "armor" and were left alone. **Not retroactive**: a character's
    inventory items are frozen copies of these description strings
    (matching how `manualResolution` needed its own backfill above) — an
    already-added armor item still shows the old "Armor: X+DEX" wording
    until/unless a future migration explicitly refreshes descriptions on
    non-custom items, which has been discussed but is not yet implemented
    (deliberately out of scope, see the batch that reported this gap).
    UI labels ("Defense", "Armor (from inventory)" in
    `CombatTab`) were already correct going in and needed no change — the
    armor `<select>` genuinely lists worn armor the character owns, a
    different sense of the word from the renamed stat, sitting right next
    to it structurally (see the ItemRowBase/formulaError bullet above for
    the same "looks similar, opposite case" trap in a different spot).
    Migrated by `migrateArmorToDefense` in `characterMigrations.ts`: if
    `armor` is present, its fields are moved to `defense` (missing
    `defenseBonus` backfilled to 0, same as `createDefaultCharacter`'s
    default); if `armor` is absent entirely (record predates the field),
    whatever `defense` the v0 -> v1 step already backfilled is left alone
    rather than clobbered with an empty object.
  - **`InventoryItem.armorValue` deleted, not renamed.** Verified unused
    before removing (per this batch's own instruction to check, not
    assume): defense is computed from `formula` in `computeDefense.ts`;
    `armorValue` was only ever written (in `equipment.ts`'s data and
    `InventoryTab.handleAddFromList`'s copy from a template), never read
    anywhere. Confirmed dead, not a live field needing a rename.
  - **`CharacterAction.damage` removed entirely** — `formula` was already
    the single source of truth for what's rollable (part 1c); `damage` was
    display-only book notation kept in sync by hand across ~80 spells,
    strictly less useful than `resolveFormulaDisplay`'s resolved value.
    Removed from the type, from `spells.ts` (66 entries), and from every
    remaining read/write site: the custom-add forms in `SpellsTab`/
    `CombatTab` (their local form state field was renamed from `damage` to
    `formula` in the same pass, since it was always really editing the
    formula, just mis-named after the fallback removal in part 1c), and
    the inline-edit `onUpdate` calls that used to mirror `formula: v,
    damage: v`. The "Damage" / "Damage / Formula" UI labels on those forms
    are unchanged — book-notation wording aimed at the player, unrelated
    to the data field that got removed underneath it.
    - **Migration care: a naive `formula: formula || damage` merge is
      wrong.** `damage` used placeholder values meaning "no damage", not
      "no formula": `"0"` (True Strike, Ice Disk, 19 entries total),
      `"Special"` (pre-part-1b Dragonform/Living Inferno/Sacrifice/Shield
      of Justice, blanked to `""` since), and plain `""`. Naively merging
      one of these into `formula` would make a non-rollable spell rollable
      and show a bogus 0 or throw on "Special" — a direct regression, not
      a fix. `migrateActionDamageField` treats `{"", "0", "Special"}`
      (`PLACEHOLDER_DAMAGE`) as "no formula": `formula` wins whenever it's
      already non-empty; a placeholder `damage` with empty `formula`
      leaves `formula` empty; only a genuinely non-placeholder `damage`
      with an empty `formula` gets promoted to `formula` — and that branch
      logs a warning, since part 1c's "game data guard" test (removed
      alongside `damage` itself; see `formulaParser.test.ts`) already
      confirmed no entry in `spells.ts` ships in that shape. This also
      matters for characters, not just game data: `actions` are frozen
      copies of whatever a spell looked like when added, so a character
      who added a spell before this removal still has both fields sitting
      in their persisted metadata regardless of what current `spells.ts`
      contains — `characterMigrations.test.ts` exercises all six raw
      shapes (formula only, damage only, both, damage `"0"`, damage
      `"Special"`, both empty) plus the logged fallback case.
  - **`InventoryItem.manualResolution` backfilled on existing characters.**
    Confirmed by manual OBR testing: an item added to a character's sheet
    before the `manualResolution` read-path fix (see the "manualResolution
    is honored" bullet above) carries `manualResolution: undefined` in its
    frozen metadata forever, showing a working-looking roll button that
    throws — newly-added items were already correct, only pre-existing
    ones on already-claimed sheets were affected (Weapon of Animosity,
    Weapon of Wounding, Vindication, currently). `migrateInventoryManualResolution`
    re-applies the flag by matching `name` against `BASIC_EQUIPMENTS`,
    for `isCustom !== true` items only — custom items are never touched,
    even if a player happened to name one identically to an official
    entry. Driven off `BASIC_EQUIPMENTS` itself (`.find` by name), not a
    hardcoded item list, so a future equipment entry that sets the flag is
    covered automatically — same reasoning as the reflective test that
    already covers the read path.

- **Schema v3: `sourceKey` — stable, immutable catalog identity, independent
  of `name`.** A `CharacterAction`/`InventoryItem` copied from
  `BASE_SPELLS`/`BASIC_EQUIPMENTS` is a FROZEN copy; the only link back to
  the template used to be `name`, and `name` is not stable — the 2nd-
  printing equipment batch renamed "Spear" to "Great Spear" and introduced
  an unrelated NEW "Spear" (1d6+STR vs the old 1d10+STR), and "Mithril
  Plate" to "Adamantine Plate". `sourceKey` (append-only per
  `equipment.ts`/`spells.ts`'s own file headers — never edited or reused
  once shipped, since existing records reference it) exists so template
  matching survives a rename. Introduced for a real near-future need: the
  spells batch's planned "outdated" badge and "reset to book text" action
  both require reliably tracing a character's copy back to its template
  across a printing that renames things, which `name` alone cannot do.
  - **`sourceKey` values are `name`-derived slugs AT THE TIME OF
    INTRODUCTION, not at introduction of the entry itself.** "Great Spear"
    (originally shipped as plain "Spear") is keyed `"great-spear"`, not
    `"spear"` — since `sourceKey` didn't exist before this batch, what
    matters is that it never changes AFTER this batch, not that it
    matches the entry's own history.
  - **`catalogCopy.ts`** (`src/utils/catalogCopy.ts`, new file) extracts
    the "build a `CharacterAction`/`InventoryItem` from a template or from
    custom form state" logic out of `SpellsTab`/`InventoryTab`'s "Add"
    modals — same "extract for testability" pattern as
    `computeDefense.ts`/`initiative.ts` — specifically so "a catalog copy
    carries `sourceKey`, a custom entry never does" is a real, run unit
    test (`catalogCopy.test.ts`) instead of something only verified by
    reading component code. Four functions: `copySpellFromCatalog`/
    `copyItemFromCatalog` (the "from list" path — carry `sourceKey` from
    the template) and `createCustomSpell`/`createCustomItem` (the "custom"
    path — never reference a template at all, so there is nothing to leak
    `sourceKey` from). `CombatTab`'s `AddActionModal` (melee/ranged/
    ability/item-type actions) is NOT here: it has no catalog to copy from
    in the first place (see its own file header), so it was already,
    structurally, incapable of leaking a `sourceKey` — confirmed by grep,
    not assumed, before leaving it untouched.
  - **Migration (`MIGRATIONS[2]`, v2 -> v3): backfills `sourceKey` on
    existing non-custom entries by matching `name` against the catalogs —
    THE LAST TIME this codebase matches by name.** Unlike the v1 -> v2
    exception, this is a genuine NEW, appended migration step, not folded
    into an existing one — v1 -> v2 is now treated as shipped/frozen policy
    (per its own comment: "the next migration after this one goes back to
    appending a new step"), and this is that next migration.
    - **Known name-reuse collision, handled explicitly:**
      `KNOWN_EQUIPMENT_NAME_COLLISIONS` in `characterMigrations.ts` — an
      existing `InventoryItem` named "Spear" predates the equipment batch
      and is mechanically a Great Spear (`1d10 + STR`, Reach 2); a plain
      name match against the CURRENT catalog would resolve it to the new,
      unrelated light Spear instead. Disambiguated on the item's own
      `formula` (which the two "Spear"-named things across time do NOT
      share), not on name alone — matching by formula ACROSS THE WHOLE
      catalog (not just same-named entries) was considered and rejected:
      most formulas are not unique (`"1d6 + STR"` alone matches Club/Mace,
      the new light Spear, AND Improvised Weapon), so a general
      formula-search fallback would trade one wrong-match risk for
      another, more frequent one. The collision table is scoped and
      explicit instead: one row per known (old `name`, confirming
      `formula`) pair, append-only exactly like `sourceKey` itself. Logs
      via `console.warn` whenever the fallback actually fires.
    - **Also re-applies `manualResolution` using the SAME collision-safe
      resolution**, correcting anything `MIGRATIONS[1]`'s name-only pass
      (`migrateInventoryManualResolution`, see above) could have gotten
      wrong on a collision it had no way to detect — that function itself
      is left completely untouched, per this file's append-only rule; this
      step's more precise resolution is what actually fixes it for any
      record that reaches v3. Harmless no-op on today's actual data (the
      Spear collision doesn't involve `manualResolution` on either side),
      but load-bearing the day a future collision does.
    - **A name matching nothing in the catalog keeps `sourceKey`
      undefined — a valid, deliberate state**, not a bug: it means "this
      entry cannot be traced back to the catalog" (renamed then hand-
      edited past recognition, or never catalog-sourced at all), which the
      spells batch's "outdated" badge needs to be able to distinguish from
      "confirmed still matches the book." Never guessed at.
  - **Other name-based catalog lookups found (grepped, not assumed) and
    deliberately left alone:** `FormulaHelp.tsx`'s `realSpellFormula`/
    `realItemFormula` also do `BASE_SPELLS.find(s => s.name === name)`/
    `BASIC_EQUIPMENTS.find(i => i.name === name)` — but these look up a
    name that's a LITERAL STRING WRITTEN IN THAT FILE'S OWN SOURCE (e.g.
    `realItemFormula("Rusty Mail")`), always edited in the same commit as
    whatever renamed the target entry, never a persisted, potentially
    stale character record. `sourceKey` solves staleness in FROZEN COPIES
    drifting away from a catalog that keeps changing after the copy was
    made — a problem that doesn't exist for a hardcoded lookup string that
    lives right next to the data it queries. Not migrated to `sourceKey`;
    would add a lookup indirection with no real problem behind it.

- **Schema v4: `catalogVersion` — dev-declared staleness, never a text
  diff.** Characters store FROZEN COPIES of catalog entries (same root
  cause as `sourceKey` above); when the catalog is updated (as the 2nd-
  printing batch did to ~50 spells), existing sheets keep the old text and
  nobody is told. Comparing the copy's text against the catalog does not
  work: descriptions are freely editable on non-custom entries, so a
  player's own note would make an entry look "outdated" when nothing
  actually changed — text comparison cannot tell "the book changed" apart
  from "the player wrote something." Instead every `BASE_SPELLS`/
  `BASIC_EQUIPMENTS` entry carries `catalogVersion: number` (contract
  documented in both file headers, next to the `sourceKey` contract):
  bump it by 1 whenever an entry's mechanics or text change in a way a
  player should know about; purely cosmetic edits (typos, formatting)
  don't require a bump, and that judgment call is the author's, made at
  edit time — there is no mechanical test for "did this edit count" the
  way there is for `sourceKey` presence/uniqueness. All entries started at
  `1`. `CharacterAction.catalogVersion?`/`InventoryItem.catalogVersion?`
  are optional copies of the template's version, set alongside `sourceKey`
  in `catalogCopy.ts`'s `copySpellFromCatalog`/`copyItemFromCatalog` —
  never set by `createCustomSpell`/`createCustomItem`, same invariant as
  `sourceKey`, extended onto the same test.
  - **`isOutdated` (`catalogCopy.ts`)** — one function, shared structurally
    by both catalogs (no generics needed; it only reads two fields and
    constructs nothing, so genericizing it doesn't risk the "hand-copied
    logic drifts apart" failure mode a duplicated *construction* function
    would). An entry is outdated only when it has BOTH a `sourceKey` and a
    `catalogVersion`, AND the catalog entry currently matching that
    `sourceKey` has a strictly higher `catalogVersion`. Returns `false`
    (never throws) for: a custom entry (no `sourceKey`); a copy that
    predates `sourceKey`/`catalogVersion` entirely and could never be
    traced back to the catalog; and — explicitly, this is not an error
    case — a `sourceKey` that no longer exists in the CURRENT catalog
    (e.g. "Greater Shadow," removed in the 2nd-printing spells batch, see
    below). There is no newer version to offer for something that's gone,
    so it shows nothing rather than a false "outdated."
  - **`OutdatedBadge` (`src/components/ui/common/OutdatedBadge.tsx`)** — a
    small amber "Updated" pill, purely informational, no `onClick`; must
    never block rolling or editing, so it's additive next to existing
    school/tier/type badges, never a replacement or a gate. Wired into
    `SpellsTab.SpellRow`'s existing badge row, `InventoryTab.ItemRow` (via
    `ItemRowBase`'s new `nameExtra` prop — see below), and
    `CombatTab.ActionRow`'s type-badge row — the three surfaces the batch
    named. **Deliberately NOT wired into `CombatTab.InventoryFavoriteRow`**
    (the Favorites section's minimal, explicitly read-only favorited-item
    shortcut row — "full edit/delete lives in the Inventory tab's own
    `ItemRow`," per its own doc comment): the task named "SpellsTab,
    InventoryTab and CombatTab's action list," three surfaces, not
    "everywhere an item can appear," and this row is a deliberately
    minimal shortcut, not a fourth editable surface. `ItemRowBase` gained
    a `nameExtra?: ReactNode` prop (rendered right after `name`, generic —
    not a boolean flag — so the shared row shell doesn't need to know what
    `isOutdated`/`catalogVersion` even are; that decision is entirely the
    caller's) specifically so `InventoryTab.ItemRow` could pass the badge
    through without `InventoryFavoriteRow` (which also builds on
    `ItemRowBase`, but never passes `nameExtra`) picking it up for free.
  - **`CombatTab.ActionRow` shows the badge but NEVER a reset button, by
    construction, not by an extra guard.** `ActionRow` renders both the
    main "Actions" list (`character.actions.filter(a => a.type !==
    "spell")` — always non-spell, always custom, so `sourceKey` is never
    set and `isOutdated` is always `false` there) and the Favorites
    section's favorited spell-type actions (read-only shortcuts: rendered
    with `isEditing={false}` and no `onUpdate`/`onEditToggle`, so no edit
    panel — where a reset button would live — is ever rendered for them
    regardless). The badge computation runs unconditionally in `ActionRow`
    (harmless — `isOutdated` is cheap and just returns `false` for the
    main list) rather than special-cased per call site.
  - **"Reset to book version" (`resetSpellToCatalog`/`resetItemToCatalog`,
    `catalogCopy.ts`)** — a plain overwrite from the current catalog entry,
    as decided: no diff view, no attempt to preserve player edits.
    Preserves only `id` and `isFavorite` (those belong to the copy, not
    the template); everything else, including a fresh `catalogVersion`,
    is rebuilt via `copySpellFromCatalog`/`copyItemFromCatalog` — for
    `InventoryItem` this also means `isEquipped`/`quantity` reset to the
    template's defaults (`false`/`1`), a deliberate reading of "everything
    else comes from the catalog," not an oversight; the confirmation
    dialog says so. Returns the entry UNCHANGED (never throws) if
    `sourceKey` doesn't match anything in the catalog — defensive; the UI
    only ever offers this action when `isOutdated` already confirmed a
    match exists. Confirmation is a plain `window.confirm()` (no existing
    confirm-dialog component in this codebase, and the task's own "keep it
    simple, as decided" ruled out building one) stating plainly that edits
    will be lost, wired into `SpellsTab.SpellRow` and `InventoryTab.ItemRow`'s
    edit-panel footers as a `TextAction variant="neutral"`, shown only
    when `outdated` — same `canEdit`-gated footer the delete button
    already lives in, no separate permission check needed.
  - **Migration (`MIGRATIONS[3]`, v3 -> v4): backfills `catalogVersion: 0`
    on existing non-custom entries that already have a `sourceKey`.**
    Deliberately `0`, not `1` — lower than every real catalog entry's `1`,
    so every copy a player currently holds is immediately flagged
    outdated. This is correct, not a bug: the 2nd-printing rewrite changed
    most of the catalog, and this migration is the first time anyone is
    told, for entries added before this system existed. Entries with no
    `sourceKey` (custom, or untraceable after the v3 backfill) get no
    `catalogVersion` either — they can never be reset, matching
    `isOutdated`'s own "no sourceKey → false" rule. Runs after
    `MIGRATIONS[2]` (the `sourceKey` backfill) in the same chained
    `migrateCharacter` pass, so it correctly sees `sourceKey` values that
    migration only just set, not ones already persisted from a prior load.

- **`src/data/spells.ts` was fully rewritten against the Nimble Core Rules
  2nd printing, pp. 46-53** (the "second printing content, spells" batch),
  not just patched — every entry verified against the book, not only the
  changes called out ahead of time. `docs/reference/CoreRules-v0.8.pdf`
  has no embedded text layer readable by the sandboxed `Read` tool
  (`pdftoppm`/image rendering isn't installed); `pdftotext` (already present
  via the Git Bash / MSYS2 toolchain) extracts a text layer that DOES
  exist, but reading order across the book's multi-column card layout is
  unreliable at column boundaries — cross-check `-layout` mode (preserves
  column position) against plain mode (preserves stream order) before
  trusting an ambiguous boundary; don't rely on either alone. Each of this
  PDF's `\f`-delimited "pages" is actually a printed two-page SPREAD, not
  one page — map extraction-page-index to book page number via the
  trailing page-number text before assuming which content is on which
  page.
  - **`Entice`'s `1dstepdice(...)` die progression — flagged as a
    tool-vs-book gap in this batch, FIXED in the very next one.** `stepdice`
    originally had exactly 4 size slots across 3 fixed level breakpoints
    (5/10/15), one short of the book's 5-tier progression (base d4, then
    4 named steps to d6/d8/d10/d12) — a level-20 Entice landed on d10, not
    the book's d12. `stepdice` (`pickStepDiceSize` in `formulaParser.ts`)
    now supports 4 OR 5 size arguments — 5 sizes adds a 4th breakpoint at
    20 (matching `MAX_LEVEL`), so the top tier is actually reachable.
    Entice's formula is now `1dstepdice(level,4,6,8,10,12)`. The 4-size
    shape is kept working unchanged for backward compatibility (nothing
    else currently calls `stepdice` at all — confirmed by grep — but
    nothing stops a future formula from using the smaller shape). Both the
    regex path (`resolveDynamicDice`, for `1dstepdice(...)`) and the
    parser's own bare `stepdice(...)` primitive now share this logic
    through one function instead of two independently hand-copied
    breakpoint tables — see `pickStepDiceSize`'s own doc for why that
    sharing matters (this is the exact "hand-copied logic drifts apart"
    failure mode `VARIABLE_TABLE`/`MATH_FUNCTIONS` already guard against
    elsewhere in this file).
  - **`Updraft` lost its roll button.** The book's "Damage: 20 minus a DEX
    save" isn't a formula the caster rolls at all — it depends on the
    TARGET's own save result, which this app's character-centric formula
    engine (rolls are always computed from the roller's own stats) cannot
    express. `formula` is now `""` (was `"1d6"`, a previous-printing
    mechanic entirely replaced by this one) — a deliberate, book-driven
    removal of rollability, not an oversight. Its description states the
    full mechanic in prose ("Damage: 20 minus the target's DEX save. On
    10+ damage, they land Prone and Dazed.") since that's now the only
    place a player can read it — no roll button means no
    `resolveFormulaDisplay` value to fall back on either.
  - **`formula: ""` covers two genuinely different cases — worth telling
    apart when reading this data, even though both render identically (no
    roll button, per `isEngineRollableItem`/the `formula` truthiness check
    used throughout the tabs).** (1) Genuinely no damage/rollable value at
    all — the common case, e.g. Boisterous Winds (a pure buff, nothing to
    roll, ever) or any Utility cantrip. (2) A real mechanic that this
    app's formula engine cannot express — currently only Updraft (see
    above), where "no formula" doesn't mean "nothing happens," it means
    "this app can't compute it, read the description." Nothing in the data
    shape distinguishes the two today; if that distinction ever needs to
    be surfaced in the UI, it needs a real signal (e.g. a flag next to
    `manualResolution`), not an inference from prose.

### Formula parser (`src/utils/formulaParser.ts`)

Hand-rolled recursive-descent parser. **Never use `eval()` or `Function()`**
here, by design, to avoid arbitrary code execution from a player- or GM-typed
formula.

Syntax: dice (`1d8`, or implicit-count `d20`), positional dice (`d44`/`d66`/
`d88`, advantage variant `d66a`; Nimble Core Rules 2nd printing — see below),
stats (`STR/DEX/INT/WIL`), `KEY`/`FLAW`, skills, `LEVEL`/`LVL`, arithmetic,
`floor()`/`ceil()`/`min()`/`max()`, and dynamic dice (`incrementdice(1,
level)d12`, `1dstepdice(...)`).

#### Decisions (do not "fix" these)

Each of these was a real bug or a deliberate trade-off, diagnosed and settled.
Reverting one reintroduces the bug.

- **The rulebook's notation is the spec, not the parser's.** Three separate
  bugs came from data being "wrong" when the parser was too strict: `d66`
  (originally fixed as implicit-count `1d66`; the 2nd printing rulebook
  edition changed what `d66` itself *means* — see the positional-dice bullet
  below, this is a rules change, not a re-litigation of the same bug),
  `KEYd20` (variable glued to a die), `LVL` (book shorthand). When game data
  doesn't parse, fix the parser, don't rewrite `spells.ts`.
- **`LVL` is a deliberate alias for `LEVEL`.** The book uses it, so a GM
  writing a custom spell will too. Not redundant, do not remove.
- **Validation lives at the choke point.** `resolveDynamicDice` validates every
  `NdX` token after resolution; `assertDiceWithinLimits` is the single shared
  guard. The original DoS existed because limits were enforced on the display
  path (`diceToAverage`) only. Never add a dice path that skips it. The one
  narrow, explicit exception is `resolveDynamicDice`/`diceToAverage`'s
  `enforceLimits` parameter (default `true`, unchanged for every existing
  caller), which `validateFormulaSyntax` alone passes `false` — see the
  write-time-syntax-only bullet below for why, and don't read this as
  license to add a second one elsewhere.
- **`validateFormulaSyntax` validates syntax, not resolved values — dice
  bounds are a roll-time concern only.** It substitutes against a synthetic,
  all-`1`s context (`NEUTRAL_VALIDATION_CONTEXT`, never `0`s: reusing `0`
  would relocate the exact `KEYd20` trap below into the neutral context
  itself) and never enforces `MAX_DICE_COUNT`/`MAX_DICE_SIDES`/the lower
  bound, uniformly, even for a hand-typed literal with no variables at all
  (`99999d6`). Two reasons: (1) a real character's KEY/FLAW/HP can
  legitimately be outside any fixed neutral range in either direction —
  `KEYd20` saved before `keyStat` is set must not be rejected at save time
  for resolving to `0d20` against the *current, incomplete* character; (2)
  bounds are inherently level-dependent for dynamic dice
  (`incrementdice(1,LEVEL)d6` is 1 die at level 1, 5 at level 20) — no
  neutral context or pair of "extremes" makes a bound check here mean
  anything for every level in between. The bound is still enforced,
  correctly, once — at roll time, against the real character, by the same
  `assertDiceWithinLimits` choke point (`rollFormula` → `parseDamageFormula`
  → `resolveDynamicDice`, `enforceLimits` defaulted `true` as always).
- **Failures are loud, never a silent zero.** Unknown tokens throw; `NaN`
  throws; a 0 dice count throws. `rollFormula`, `evalFormula` and
  `resolveFormulaDisplay` all return `{ ..., error? }` and every caller must
  check `error` before writing to OBR or displaying a value. A roll that failed
  must never reach the shared log as a legitimate 0. This cost several rounds
  to clean up: do not reintroduce a `|| 0`, `?? 0` or `isNaN(x) ? 0 : x`
  fallback on a failure path.
- **Error state never lives in a module variable.** It travels on the return
  value. A previous `lastFormulaError` module-level variable was written during
  render (`resolveFormulaDisplay` is called from row components) and
  desynchronised. Module-level mutable state read during render is unsupported
  in React 19.
- **The lower dice bound only ever catches `count === 0`.** A negative count
  (`-1d6`) is caught earlier by `Parser.parse`'s full-consumption check, on
  purpose: the choke-point regex can't capture a leading `-` without
  misdiagnosing legitimate subtraction (`10-1d6`).
- **`stepdice` only supports the `1d` prefix, and no nested arguments.** Not an
  oversight: no real game content needs either, and any deviation now fails
  loudly rather than returning a wrong number.
- **`MAX_DICE_COUNT` / `MAX_DICE_SIDES` are sanity bounds, not balance
  bounds.** A legal level-20 character's real spells top out around 5 dice and
  d12, roughly 20x and 80x below the limits. They guard against a hand-typed
  formula, nothing more. Don't tighten them to "match the game".
- **`Parser.parse` requires full input consumption.** Without it, a recognised
  prefix followed by garbage returns a plausible number.
- **`parseUnary` handles unary `+` explicitly, and BOTH its `+`/`-` branches
  recurse into `parseUnary` itself, not `parsePrimary`.** Flat bonuses
  (`+8`) and stripped formula tails (`+3+2`) previously worked only by
  accident, via the unknown-token fallback that returned 0 — that's the `+`
  branch existing at all. The recursion (rather than jumping straight to
  `parsePrimary`) is a separate, later fix: a negative stat substituted
  right after the formula's own operator produces a CHAINED sign — `"1d8+STR"`
  with `STR=-1` substitutes to `"1d8+-1"`, and once the dice part is split
  off, the remainder handed to `safeEval` starts with a leading `"+-1"`.
  Reported via initiative going negative (`1d20+${dex+bonus}` → e.g.
  `"1d20+-2"`), but NOT initiative-specific — any formula whose trailing
  modifier ends up glued to a negative substituted value hits this,
  including the stock stat arrays (+2/+2/+0/-1, +3/+1/-1/-1). Do not "fix"
  this by special-casing initiative or forbidding negative stats; negative
  modifiers are legal and common. Pinned by `formulaParser.test.ts`'s
  "negative stat modifiers (chained-sign parser bug)" describe block, which
  covers the formula shapes this project's own data uses (`1d8+STR`,
  `1d6+DEX`, `2d4+KEY`, plain `-2`, ...) through both `rollFormula` and
  `resolveFormulaDisplay` — a bare leading `"-2"` and a single unary minus
  followed by a plain number (`"1d8-STR"` with a *positive* STR) already
  worked before this fix; only a CHAINED second sign broke. `KEYd20` with a
  negative key stat is a different, correct, pre-existing rejection (a
  negative dice COUNT, not a chained-sign modifier) — see the dice-lower-
  bound bullet just above; it must keep failing loudly, not be "fixed" to
  roll a negative number of dice.
- **`InventoryItem.manualResolution: true` marks flavour-text formulas**
  (e.g. equipment reading `WeaponDamage + 1d4`, referencing whatever weapon
  it's enchanting — a concept the formula language has no variable for —
  resolved by the GM by hand; currently set on 3 entries: Weapon of
  Animosity, Weapon of Wounding, Vindication). That text is neither valid
  nor broken; it's simply not for the engine. The exhaustive data test
  filters on this field, so exclusions live in the data, never as a
  hardcoded list in the test. `CharacterAction.manualResolution`
  (spells/actions) does NOT exist — it was removed in part 1c, having
  never been set on any spell; do not add it back. `formula: ""` already
  fully covers "not engine-rollable" for actions (see the next bullet), so
  there's no remaining gap it would fill. **`InventoryItem` is the only
  holder of this flag** (confirmed by grep, not assumption) — if a second
  holder is ever added, it needs the same wiring described below, not a
  copy-pasted assumption that setting the field alone does anything.
  - **The flag went unwired for a while — this was the fifth instance of
    the same failure mode in this codebase (d66, KEYd20, LVL, FLAW, then
    this one): a field documented in prose that nothing actually reads.**
    `manualResolution`'s own JSDoc claimed "not a formula meant to be
    evaluated or rolled by the engine," but nothing checked it: all three
    equipment entries rendered a working-looking roll button that threw a
    formula error on click. Fixed via a single choke point,
    `isEngineRollableItem(item)` in `formulaParser.ts` (`!!item.formula &&
    !item.manualResolution`) — every call site that decides "does this
    `InventoryItem` get a roll button / go through `resolveFormulaDisplay`"
    must route through it instead of checking `item.formula` truthiness
    directly: `InventoryTab.ItemRow`'s roll trigger and formula display
    (raw text when `manualResolution`, never `resolveFormulaDisplay` — that
    text is not a formula the parser can evaluate, so reporting it as
    "invalid" would be as wrong as rolling it), and both `CombatTab`'s
    inventory-favorites filter and its `favorites.length` gate (a
    `manualResolution` item must not surface as a "favorite" shortcut
    either). `InventoryTab.handleAddFromList` also wasn't copying
    `manualResolution` from the `BASIC_EQUIPMENTS` template onto the new
    `InventoryItem` at all — fixed alongside the read side, since the read
    fix is inert without it (an item added via the picker would still have
    carried `manualResolution: undefined` forever). Guarded by a reflective
    test (`formulaParser.test.ts`, "InventoryItem.manualResolution is
    honored by the roll path") that drives off `BASIC_EQUIPMENTS` itself,
    not a hardcoded item-name list — mirrors the "FormulaContext contract"
    test's reasoning (see its own comment) for exactly the same reason: a
    future entry that sets the flag is covered automatically, and removing
    the check from any call site turns the test red.
- **`CharacterAction.formula` is the single source of truth for what's
  rollable — there is no `formula || damage` fallback anywhere in the app.**
  `damage` is display-only flavor text (e.g. "2d6+STR", "Special"), never
  parsed. An empty `formula` means genuinely not rollable: no roll button
  (`onRoll` passed as `undefined`, or the button's own visibility gated on
  `spell.formula`/`item.formula`), not a button that fails when clicked.
  This was NOT always true: part 1b's fix for the "Special" class of bug
  (Living Inferno/Dragonform/Sacrifice/Shield of Justice, all shipped with
  `formula: ""` and `damage: "Special"`) blanked the affected `damage`
  fields but left the `action.formula || action.damage` fallback mechanism
  itself in place; part 1c removed the fallback everywhere it appeared
  (CombatTab's `ActionRow`/roll triggers, SpellsTab's `SpellRow`/roll
  triggers/`handleAddFromList`, `FormulaHelp.tsx`'s `realSpellFormula`) —
  don't reintroduce it at a new call site. `InventoryItem` has no `damage`
  field, so equipment never had this fallback to begin with.
- **Game-data guard: an entry with real formula text sitting in `damage`
  but an empty `formula` is silently non-rollable, and nothing else catches
  it.** `formulaParser.test.ts`'s "game data guard" describe block asserts
  every `BASE_SPELLS` entry whose `damage` is non-empty and not a
  placeholder (`"0"`, `"Special"`) has a matching `formula` — this is what
  the old `formula || damage` fallback used to rescue at runtime, and what
  quietly breaks the moment that fallback is gone. `InventoryItem` has no
  `damage` field, so this only applies to spells/actions. As of part 1c
  this test finds nothing (confirmed via a mutation test: temporarily give
  a spell a real `damage` formula with `formula: ""`, confirm it goes red,
  revert) — keep it that way; a newly-added spell that trips it needs its
  formula moved from `damage` into `formula`, not the test loosened.
- **The game-data validation test (`formulaParser.test.ts`, "game data
  validation") checks `formula` alone, for both spells and equipment** —
  mirroring the app's real (fallback-free, as of part 1c) behavior. The
  test runs both the original `validateFormula`+missing-dice check AND a
  dedicated `validateFormulaSyntax` pass on the same entry list — the
  latter needs no character context and is a pure "does this even parse"
  gate, which is exactly the class of bug "Special" was (not a bounds
  problem, not a level-dependent problem, not a formula at all).
- **Three paths must reject identically:** `validateFormula` (write-time,
  against a real context), `evalFormulaWithContext` (display value),
  `resolveFormulaDisplay` (display string). A cross-consistency test enforces
  this. If you add a check to one, add it to all three. `validateFormulaSyntax`
  is a deliberate fourth, separate path (see above) and is NOT required to
  agree with these three on dice bounds — only on syntax-level rejections
  (unknown tokens, wrong arity, over-length, over-depth).
- **A reflexive test iterates `FormulaContext`'s own keys** to verify every
  documented variable actually substitutes. `FLAW` was documented in the
  README and computed in `buildContext` but never wired up, and nothing caught
  it. Any field added to the context must be substituted or that test fails.
  - `VARIABLE_TABLE` and `MATH_FUNCTIONS` are the logic, not a description of it.
  `substituteVariables` and `Parser.parsePrimary` loop over these tables, and
  `listFormulaVariables()` / `listFormulaFunctions()` reflect over the same
  tables to build the in-app formula help. Never duplicate either list in the
  UI: a hand-copied catalog is how FLAW ended up documented but never wired up.
- `MAXHP` must stay before `HP` in `VARIABLE_TABLE`. Do not sort the table.
  Guarded by an explicit index-order test.
- The four `MATH.FLOOR(` / `MATH.CEIL(` / `MATH.MIN(` / `MATH.MAX(` replaces in
  `substituteVariables` must run BEFORE the final `toLowerCase()`. They are
  case-sensitive and match the uppercase shape. Moving them after is the exact
  bug that made the old `INCREMENTDICE` / `STEPDICE` lines dead code.
- `incrementdice` / `stepdice` are deliberately not in `MATH_FUNCTIONS`: their
  arity and branching differ per helper. They are documented via worked
  examples in the help panel instead.
- `LVL` is a deliberate alias for `LEVEL` (rulebook notation), not a typo.
- **Positional dice (`d44`/`d66`/`d88`, 2nd printing) are NOT implicit-count
  single dice.** A bare `d66` rolls 2d6 (the single repeated digit is the
  individual die's face count, e.g. `d66` → two d6, NOT one 66-sided die)
  and reads them positionally as tens/ones — `[4, 5]` → 45. The advantage
  variant (`d66a`) rolls 3, drops the lowest (leftmost on a tie —
  `indexOfLowestValue`), and reads the remaining 2 **in their original roll
  order, never sorted** — `[4, 2, 5]` drops the 2 and reads `[4, 5]` as 45,
  not resorted to 54; `[3, 3, 6]` drops the FIRST 3. Sorting the kept dice
  (even just for display) reintroduces exactly the bug this notation exists
  to avoid — pinned by a dedicated mutation-style test
  (`formulaParser.test.ts`'s "mutation guard" case, and the ordering/
  tie-break tests, all of which go red if a `.sort()` is reintroduced on
  `rollPositionalDice`'s kept array). Per the glossary, positional dice (and
  flat, dice-less formulas) never miss or crit — surfaced explicitly via
  `RollFormulaResult.canCritOrFumble`/`DiceRollResult.canCritOrFumble`
  (`false` for both; `true` only for a genuine `NdX` roll), not left to be
  inferred from `isCritical`/`isFumble` both being `false` (which is also
  true, coincidentally, whenever `kept` is empty for unrelated reasons).
  `normalizeImplicitDiceCount` deliberately excludes 44/66/88 from its
  general bare-`dN` → `1dN` rewrite so `parseDamageFormula`/`diceToAverage`/
  `resolveFormulaDisplay` can still recognize the bare positional form
  downstream. `positionalDiceAverage`'s advantage-variant average is exact
  (enumerates all `sides^3` ≤ 512 outcomes), not approximated — there's no
  simple closed form since which of the 3 rolled positions survives depends
  on the values rolled, not just their ranks.
- The dice lower bound only ever fires for `count === 0`. A negative count is
  caught upstream by the full-consumption check, on purpose, because a leading
  `-` is ambiguous with subtraction (`10-1d6`).
  - An unclosed paren (`floor(3`) is currently swallowed silently by `Parser.parsePrimary`. Known leniency, pinned by a non-regression test, not yet a deliberate decision. Revisit.

## Code style

- 2-space indentation, semicolons.
- `src/` app code uses **double quotes**; root config files (`vite.config.ts`, `eslint.config.js`) use single quotes. Match whichever file you're editing rather than applying one style everywhere.
- Functional components only, typed via `interface XProps { ... }` above the component, with defaults destructured in the signature.
- Every file has a substantial `@file` JSDoc header explaining its role; every exported function/type/interface has JSDoc (`@remarks`, `@param`, `@returns`, `@see`, `@deprecated`, `{@link Name}` as relevant). Preserve this convention in new files.
- Type-only imports use `import type { ... }` (enforced by `verbatimModuleSyntax: true`).
- `useRef` is used deliberately in `useOBR` to give callbacks access to latest state without stale closures (`characterRef`, `canEditRef`, `playerIdRef`). Callbacks otherwise close over values captured at effect-registration time.
- Tailwind v4 is configured via CSS in `src/index.css` (`@tailwindcss/vite` plugin). There is no `tailwind.config.js`.
- Shared UI primitives live in `src/components/ui/common/` and are re-exported via its `index.ts` barrel.
- Extract a shared component only when the pattern repeats in 3+ places. Avoid speculative abstraction.

## Conventions

- Commit messages use a `type: description` prefix. Use `feat`, `fix`, `refactor`, `chore`, `docs`. Avoid `update:`, which appears in older history but is not part of Conventional Commits.
- Code and documentation are in English. Conversation with the maintainer is in French. The one deliberate exception: `README.fr.md` is a full French translation of `README.md`, kept in sync by hand — `README.md` itself must stay English (it's what the Owlbear Rodeo store reviewers read on the extension's PR). Each file links to the other near the top. `README.md` uses `## License`; `README.fr.md` keeps the French spelling, `## Licence`. Don't merge them back into one bilingual file, and don't let `README.fr.md` silently drift out of sync with a `README.md` change without updating both.
- **In user-facing prose (README, `docs/store.md`, UI copy): do not use em dashes or en dashes.** Use commas, colons, or parentheses. Em dashes read as AI-generated. Applies to `README.fr.md` too.
- `docs/store.md` is the OBR extension store listing (front matter + markdown for the marketplace), not internal docs. Its `tags` must stay within the store's allowed vocabulary, and `manifest`/`image`/`icon` URLs must stay in sync with the deployed URL (`nimble-obr.vercel.app`).