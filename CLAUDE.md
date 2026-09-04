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
  - Character sheet (schema v6+): lives in the scene-metadata vault, one root-level key per character (`characterStore.ts`) — a token only carries a pointer, `CharacterLink` (`LINK_KEY`). `METADATA_KEY` (`com.nimble-obr.nimble/character_sheet`) is now a legacy per-token key, migrated to the vault the first time such a token is read. See "Character vault" below for the full picture.
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
  (`resolveFormulaDisplay`), never the raw formula.** A formula that fails
  to resolve must render as an error (red text + ⚠ tooltip, via
  `ItemRowBase`'s `formulaError` prop), never silently as if it were a
  valid value — same concern as `computeDefense`'s `error` return, below.
  `manualResolution: true` items are the deliberate exception (see that
  bullet): raw text, no `resolveFormulaDisplay` call, no error styling.
  The "Add Item"/"Add Spell" pickers (browsing catalog content the
  character doesn't own yet) deliberately still show the raw formula,
  mirroring the book's own notation. The Defense section's armor
  `<select>` is NOT the same case despite sitting next to it structurally:
  it lists armor the character already owns, so it resolves through
  `resolveFormulaDisplay` too. These two — "browsing the catalog" vs.
  "browsing what's owned" — look alike but are opposite cases; check which
  one a new list actually is before assuming the rule applies. See
  `docs/parser-history.md` for the audit that found every place this rule
  was being violated.
- **Signed-modifier display goes through `formatModifier`
  (`src/utils/formatModifier.ts`), never a hand-rolled sign ternary.**
  `formatModifier(n)` always includes a sign, including `"+0"` for zero
  (zero is still a real modifier); a caller that wants to omit a zero
  modifier entirely decides that itself (`modifier !== 0 &&
  formatModifier(modifier)`) — the function's only job is the sign. Wired
  into every site that displays or constructs a signed modifier, including
  `resolveFormulaDisplay`'s own modifier suffix. See
  `docs/parser-history.md` for the two independent hand-rolled
  reimplementations this replaced (both got the negative case wrong).
- **`computeDefense` (`src/utils/computeDefense.ts`) returns a resolved
  arithmetic breakdown, never a half-substituted formula string.**
  `breakdown` is: the armor formula (or the raw DEX value, unarmored) run
  through `substituteVariables` (variables resolve, arithmetic stays
  unevaluated — "3+DEX" at DEX 2 becomes "3+2", not collapsed to "5"),
  plus the flat bonus via `formatModifier` (omitted entirely when it's 0)
  — then the WHOLE assembled string (armor term + bonus term + total),
  not each piece separately, is passed through
  `normalizeSubstitutedSignsForDisplay` as the very last step. `breakdown`
  is `undefined` whenever `error` is set; the caller shows the error
  message instead of any breakdown text.
- **`Parser.parseUnary` and `normalizeSubstitutedSignsForDisplay` both
  handle a formula's "glued sign" shape, and neither is redundant with the
  other — they solve different problems at different pipeline stages.**
  `parseUnary` makes a chained sign (`"1d8+-1"`) EVALUATE to the right
  number — mandatory, load-bearing, every roll and every resolved value in
  this app depends on it; do not touch it for a display concern.
  `normalizeSubstitutedSignsForDisplay` makes a string that's shown
  WITHOUT evaluation READ correctly — purely cosmetic, nothing downstream
  re-parses its output. `substituteVariables` itself stays purely semantic
  and must NOT normalize signs — it's a stage `evalFormula`/`rollFormula`/
  `resolveFormulaDisplay` all depend on. If a future call site shows a
  substituted-but-unevaluated formula string, it must call
  `normalizeSubstitutedSignsForDisplay` itself; `substituteVariables` will
  not do it implicitly. See `docs/parser-history.md` for why putting this
  logic inside `substituteVariables` was tried once and reverted.
- **`normalizeSubstitutedSignsForDisplay` must tolerate whitespace around
  the signs, not just a zero-whitespace glued pair** — every real armor
  formula in `equipment.ts` is written with spaces (`"3 + DEX"`), so
  `substituteVariables` produces `"3 + -2"`, not `"3+-2"`. The regex
  swallows arbitrary surrounding whitespace and re-emits a tight join:
  `s.replace(/\s*\+\s*-\s*/g, "-").replace(/\s*-\s*-\s*/g, "+")`. When
  testing a regex-over-a-string display fix like this one, always verify
  against the actual string the app produces (read the source data), not
  a hand-typed idealization — see `docs/parser-history.md` for the
  regression this exact gap caused.
- **The Nimble 3rd Party Creator License v2.0 notices are a legal
  requirement, not a design choice.** They live in `RollLog.tsx` (see its
  `@file` header) — NOT a standalone panel-footer component, and inline
  mode only, never the floating pill. The full VTT notice is pinned at the
  top of the inline roll log and the short attribution line
  (`LicenseAttribution`) at its foot — present from the empty state
  onward, neither dismissible nor able to be interleaved with entries;
  both are structurally OUTSIDE the entries list's own scroll container,
  so they never scroll away with it. Do not reintroduce a panel-level
  footer for this. See `docs/layout-history.md` for the placements already
  tried and rejected (a permanent footer, also showing both notices in the
  floating popup).

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

Approaches already tried and rejected while arriving at this contract —
don't re-attempt these; the mechanism behind each is in
`docs/layout-history.md`:

- Two `<main>` children (tab content + the `DicePanel`/`RollLog` wrapper)
  given equal, competing `flex-1` — collapsed the wrapper to 0px whenever a
  sheet tab was open.
- Tab content given its own independent `overflow-y-auto` scroll region
  with `DicePanel` pinned below it — `DicePanel` must scroll with the
  sheet, not sit pinned below a separately-scrolling box.
- `min-h-56` floor on the wrapper — band-aided a missing parent-chain
  height instead of fixing it.
- `mt-auto` on the attribution line alone — same parent-chain gap,
  unreachable from inside `RollLog`'s own subtree.
- `flex-1` on the entries area alone with nothing above it in the chain —
  same parent-chain gap again.
- Bare `flex-1` on the roll-log entries list with no
  `min-h-0 overflow-y-auto` — could only grow, never shrink, so a new roll
  pushed the whole panel taller instead of appearing without scrolling.

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
- **`DicePanel`, no-token / unsupported-version / invalid-sheet state:**
  - Same behavior: opening it must not hide the inline roll log.
  - A roll's result must be visible **without scrolling** — not merely
    reachable by scrolling, actually on-screen the instant the roll lands.
  - Closes itself automatically once a roll is made.
- **`DicePanel`/`RollLog`, no-sheet state (NOT VISIBLE — deliberate,
  different from every other state above):** this screen's one job is
  "create or recover a sheet" (`NoSheetPanel`) — free-rolling dice and
  browsing roll history are already reachable from the no-token state one
  click away (deselect), so this batch removed both from the no-sheet
  screen rather than fixing their layout there. `RollLog`'s inline render
  is conditioned on `showNoToken || showUnsupportedVersion ||
  showInvalidSheet` ONLY (no-sheet excluded) — it fully unmounts here,
  which is fine for `RollLog` (unlike `DicePanel`, it holds no in-progress
  state worth preserving; see "Structural constraints" below for why that
  distinction matters). `DicePanel` is different: it must stay MOUNTED
  per the single-JSX-tree rule below, so its wrapper `<div>` gets a
  `hidden` class instead of a `{condition && ...}` around `DicePanel`
  itself — `display: none` on an ancestor hides it without unmounting the
  component or losing its `collapsed`/mode/count state. The license
  notices (`VttNotice`/`LicenseAttribution`, normally carried by inline
  `RollLog` — see that file's own header) still need to appear on this
  screen despite `RollLog` being absent here; `NoSheetPanel` renders them
  directly (imported from `RollLog.tsx`, where they're the single source
  of that text) in its default (non-recovery-list) view only — not in the
  recovery list sub-view, which needs its vertical space for the list
  itself. Do not re-add `RollLog`/visible `DicePanel` to this state to
  "fix" a layout complaint here again without checking this bullet first —
  the fix for a no-sheet layout problem involving these two is more likely
  "does it still need to be here at all" than a flex adjustment.
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
| `keyStats.length` | `[0, MAX_KEY_STATS]` = `[0, 2]` | Rulebook p.55 (KEY) — only the higher-valued selected stat is used, see `buildContext`; schema v7 |
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

- **`App.tsx` is a single JSX tree, not multiple early-return branches.** `DicePanel` must never unmount, or in-progress dice state is lost whenever `selectionState` changes. Consolidating the tree is the fix; "improving readability" with early returns undoes it. Two distinct failure modes have hit `DicePanel` visibility and must not be conflated: this bullet (JSX branching → real unmount, state loss) is one; the part 1g `<main>`-flex-collapse regression (see `docs/layout-history.md` — DicePanel stayed mounted the whole time, its wrapper just rendered at 0px height) is a different, purely-CSS one. Before "fixing" a DicePanel-invisible report, determine which of the two it is (DOM inspector: is the node present at 0px, or absent entirely?) — the fix for one does nothing for the other.
- **The roll log has a single source of truth.** Pushing a visible roll writes to `OBR.scene.setMetadata` only; local `recentRolls` state is updated **only** by the `onMetadataChange` listener, never directly by the push function. The double update remounts conditional UI in `App.tsx`. Hidden (GM-only) rolls are the deliberate exception: they skip scene metadata and go straight to local state.
- **Drag interactions keep local state during the drag and commit once on release.** Writing to OBR on every `mousemove` floods the network. Resync protection when external changes arrive mid-drag is required, not optional.
- **Formula input fields keep local state and only commit when valid.** Every other text `FormField` in an edit-row panel (Name, Range, Description...) writes to `onUpdate`/OBR on every keystroke by design — that's fine, any string is a valid value. Formula fields are the deliberate exception: `useFormulaField` (mirroring `useDraggableValue`) buffers a local draft and only commits once it's syntactically valid or empty, so an in-progress, unparseable formula is never broadcast to the table. Unlike a drag (~2s), a formula edit can run long enough that an external change to the same field can arrive mid-edit; `useFormulaField`'s resync is skip-and-warn (`conflictWarning`), not skip-and-silent, specifically so that case doesn't quietly overwrite someone else's change on commit. See the write-time-syntax-only bullet under Formula parser below for why the commit gate checks syntax, not resolved values.
- **Numeric inline fields (`InlineNumberField` — HP, Level, Speed) keep local string-draft state and commit once, explicitly, on blur/Enter, never per keystroke.** `useEditableNumberField` (`src/hooks/useEditableNumberField.ts`) replaced a `number`-typed local draft that rejected (silently bounced back to the old value) any input that didn't parse — most notably an emptied field — so a player could never clear the field to retype a shorter number. Its resync policy is deliberately last-commit-wins, like `useDraggableValue`, NOT skip-and-warn like `useFormulaField` above: a numeric edit is short (a couple of keystrokes, further shortened by select-on-focus), so an external client's concurrent change to the same field is silently overwritten by the eventual commit — a trusted-table choice, not an oversight. Known residual gap: a field opened and then left focused for a long time without being touched or blurred still commits last-wins whenever it's eventually blurred — the guard that skips committing an *untouched* field only protects the "opened, never typed in, closed" case, not "opened, forgotten about, closed much later." Revisit if this surfaces from the store, not before.
- **Tailwind cannot compile dynamic class names.** When `colorClass` is a function, use an inline `style` prop, not a computed class string.

### Permission model

| Role | Can edit |
|---|---|
| Token owner (player, matches `ownerId`) | Their own sheet |
| GM | Any sheet, regardless of `ownerId` |
| Other player | Read-only (edit controls hidden, not disabled) |

- `permissions` (`{ canEdit, isGM, isOwner, isUnclaimed }`) is computed once in `useOBR` and passed explicitly as **props** to every interactive component, deliberately not exposed via React context. Any new component needing it must have it threaded through manually.
- `updateCharacter` re-checks `canEdit` before every write and no-ops with `console.warn` if the caller lacks rights. This is **not a real security boundary** (OBR has no server-side ACL on metadata); it only guards against accidental stale-UI writes.
- **As of schema v6 (vault decoupling — see the "Character vault" section below), `canEdit` is a plain application-level convention with no OBR backing whatsoever, not even a theoretical one.** Before v6, the character lived inside a specific item's own metadata, so "who owns this item" was at least a coherent question, even though CLAUDE.md already noted OBR enforces nothing server-side about it. Now the character lives in scene metadata, which isn't owned by anyone in OBR's model at all — any client in the room can write any key there. `ownerId` on `NimbleCharacter` is the entire mechanism; there is no fallback platform concept left to lean on even as a matter of intent. This changes nothing about how the app already behaved (the disclaimer above was already true), but it does mean a future "make this a real security boundary" idea has strictly less to build on than it might appear — there is no partial OBR enforcement to extend, only this one field.
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
migration (`"invalid"`) — every read path (vault reads, legacy per-token
reads, cross-scene snapshot rehydration) funnels through it rather than
reimplementing its own validation.

To add a migration: add the field to `NimbleCharacter` and
`createDefaultCharacter()`, bump `CURRENT_SCHEMA_VERSION` by exactly 1, and
append one `v(n) -> v(n+1)` function to `MIGRATIONS` — never edit a
migration that has already shipped. Full procedure, the deploy-time behavior
across clients, and the per-version changelog (v2 through v7) are in
`docs/schema-migrations.md` — read it before touching this, rather than
reinventing an ad hoc patch in one of `migrateCharacter`'s callers the way
the old `combat` backfill used to be.

`validateCharacterShape` validates this project's own migration output
only, not arbitrary external data (see `docs/schema-migrations.md`'s "Known
limits" section for the exact gaps and for why that's no longer a purely
hypothetical concern as of schema v6).

Constraints established by past schema versions that still bind any new
migration — the narrative behind each is in `docs/schema-migrations.md`'s
"Version history":

- **The v1 -> v2 exception does not set a precedent.** That's the only
  migration in this chain allowed to fold multiple unrelated field changes
  into an already-existing step, and only because v1 -> v2 had never
  shipped at the time (no persisted record's correctness depended on its
  old behavior). Every migration since is, and must stay, a new, appended,
  single-purpose step.
- **`sourceKey` (on catalog-sourced `CharacterAction`/`InventoryItem`
  entries) is append-only and immutable once shipped** — a slug derived
  from the catalog entry's `name` at the moment `sourceKey` was
  introduced, never updated to match a later rename. Matching a
  character's frozen copy back to its catalog template must always go
  through `sourceKey`, never through `name` — `name` is not stable across
  a rulebook printing. `KNOWN_EQUIPMENT_NAME_COLLISIONS`
  (`characterMigrations.ts`) is the append-only, explicit table for the
  known cases where a name was reused across a rename; disambiguated on
  each item's own `formula`, not name alone. Don't replace it with a
  catalog-wide formula search — most formulas aren't unique enough to be a
  safe fallback (`"1d6 + STR"` alone matches several unrelated items).
- **`catalogVersion` is bumped by the developer's own judgment at edit
  time, never computed from a text diff.** A catalog entry's description
  is freely editable by players on their own non-custom copies, so
  diffing a character's copy against the current catalog text cannot tell
  "the book changed" apart from "the player wrote a note."
- **`InventoryItem.category` is authored per catalog entry, never
  inferred.** A prior UI-only heuristic (`guessCategory`, inferring
  category from `isArmor`/`slots`/`formula`/name) produced two real,
  silent miscategorizations. Don't reintroduce a proxy-signal heuristic
  for this field.
- **A character's catalog-sourced entries are frozen copies.** Editing
  `equipment.ts`/`spells.ts` never changes what an existing character
  already holds — propagating a catalog change to already-persisted
  characters always needs its own explicit migration step, the same as
  any other schema change.
- **A `Migration` function must stay pure — no OBR access.** Moving a
  record's *storage location* (as opposed to its shape) can't be done
  inside a `Migration` step; it needs a separate, OBR-orchestrated step
  alongside it (see the "Character vault" section for the v5 -> v6
  example of this split).

### Character vault (schema v6 — storage location, not just shape)

Before this batch, a character sheet lived entirely inside its token's own
item metadata (`METADATA_KEY`) — deleting the token destroyed the sheet, no
exceptions. As of schema v6, the character record lives in the SCENE
metadata vault (`characterStore.ts`), keyed by its own `id`; the token only
carries a pointer (`CharacterLink`, key `LINK_KEY`). A `"player"`-kind
character now survives its token's deletion and can be recovered onto a
different (or the same) token later; a `"monster"`-kind one still doesn't,
deliberately (see below).

- **Room metadata is deliberately never used for character data.** Its 16 KB
  budget is shared across every extension installed in the room, not a
  per-extension allowance — a single non-trivial character would already
  consume most of it. Scene metadata has no such cross-extension sharing
  concern, which is why it was chosen instead. See
  `docs/vault-incidents.md` for the 7.44 KB measurement behind that call.
- **`characterStore.ts` is the only place in the codebase allowed to call
  `OBR.scene.setMetadata`/`getMetadata` for character data.** Every
  character gets its own root-level scene-metadata key
  (`com.nimble-obr.nimble/character/<id>`), never one shared object under a
  single key — a shared key would force a read-modify-write where whichever
  write lands last silently drops the other. Deletion sets the key to
  `undefined` in a `setMetadata` patch, never the `delete` operator (which
  would only remove it from a local object, not from the actual stored
  metadata).
- **`CharacterLink.snapshot` is a deliberate, transport-only duplicate of
  the character, not redundancy to remove.** The vault is always consulted
  first (`resolveCharacterRead`); `snapshot` is only promoted when the
  vault has never seen that `characterId` — its sole job is surviving a
  copy-paste into a scene whose vault has no record of the character yet
  (OBR copies a token's item metadata verbatim on paste). Without it, a
  token pasted into a new scene would point at nothing.
- **Character creation always writes the token's `CharacterLink` BEFORE the
  vault entry — this ordering is what makes the orphaned-monster cleanup
  (below) safe to run at any time.** A character's vault entry can never
  become visible to any client before its owning token already points at
  it, so a scene-load sweep can never mistake "still being created" for
  "genuinely orphaned." If the vault write fails after the link write
  succeeds, the token is simply left pointing at a `characterId` the vault
  doesn't have yet — the next selection of that token self-heals via the
  snapshot-rehydrate path above.
- **`fanOutSnapshot` fetches a fresh, confirmed-live list of target token
  ids immediately before every write, never reusing a previous list.**
  `OBR.scene.items.updateItems` silently writes NOTHING AT ALL for an
  entire batch of ids the moment even one of them no longer resolves to a
  live item — not a partial write skipping just the dead one. Its debounce
  is per `characterId`, never a single shared timer: a shared timer would
  let editing a second character cancel (not just delay) the first
  character's still-pending fan-out.
- **`kind: "monster"` has no existence independent of a token; `kind:
  "player"` does (survives token deletion by design).**
  `cleanupOrphanedMonsters` deletes every orphaned `"monster"`-kind vault
  character via an idempotent sweep run on scene load/ready, not a live
  deletion listener — a token-deletion event isn't reliably observable
  from every client, so a periodic sweep is what actually enforces this.
- **`items.onChange` hands the listener the scene's full current item list
  on every call, not a delta — never re-fetch it via a fresh SDK call
  downstream.** (`linkedCharacterIdsFromItems` computes the recovery list's
  comparison key directly from the `items` parameter it's already been
  given, rather than calling `getItems()` again.) Exit early, before doing
  any vault read: compare the incoming item's `CharacterLink` against the
  last one actually processed (`selectedTokenLinkRef`) and only call
  `loadCharacterForToken` when it changed — most calls are unrelated token
  drags/rotates that never touch `CharacterLink`, and this short-circuit is
  what keeps them cheap despite every character read now going through the
  vault instead of being free, as it was pre-v6.
- **Continuous-edit controls (keyboard-arrow repeat, mouse wheel) must
  debounce their OBR commit per gesture via `useDebouncedCommit`, not fire
  a write on every tick.** See `docs/vault-incidents.md` for the rate-limit
  incident this fixed.
- **Stale-snapshot repair (`maybeRunRepair`) needs both an
  at-most-one-repair-in-flight-per-token guard and an exponential backoff
  after failure — removing either reintroduces a rate-limit storm during a
  burst of edits.** See `docs/vault-incidents.md`.
- **Recurring bug shape: an identity read from a source that isn't fresh
  yet.** Any write that changes `character.id` while a sheet is already
  open (`useOBR.ts`'s `switchToMonster`/`switchToPlayer`) must set
  `characterRef.current` synchronously, before the OBR write, or
  `onMetadataChange`'s resync re-fetches by the OLD id and silently
  overwrites the switch with the stale record still sitting there unlinked.
  Same class of bug as the tokenId copy-paste issue closed by schema v6
  (`docs/vault-incidents.md`).
- **The no-sheet screen shows neither `DicePanel` nor `RollLog`, by
  design** — free-rolling dice and roll history are already one click away
  via the no-token state (just deselect). `DicePanel` still stays MOUNTED
  there (a `hidden` class on its wrapper `<div>`, never a conditional
  unmount) since the single-JSX-tree rule ("Structural constraints" below)
  still applies to it; the required Nimble license notices, normally
  carried by inline `RollLog`, are rendered directly by `NoSheetPanel`
  instead since `RollLog` is absent on this screen. See the "Panel layout
  contract" above for the binding layout rule.
- **`performWrite`'s pending/offline/sticky-error/retry mechanics should be
  touched minimally.** It's the layer that originally caught the tokenId
  copy-paste bug's symptoms (`docs/vault-incidents.md`); a broad rewrite
  risks degrading it.

For the full story behind several of these — the 7.44 KB measurement, the
two rate-limit incidents, the recovery UI's ownership-filtering and list
UX, and the tokenId copy-paste bug — see `docs/vault-incidents.md`.


Out of scope for this batch, deliberately, but the data shape already
accommodates all of it without another schema bump: a `kind` toggle in the
UI (and a simplified player-facing view for a monster's sheet), the
model/instance split (several tokens sharing one statblock), a cleanup
panel for characters with no token, and JSON export/import.

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
  `KEYd20` saved before any `keyStats` entry is set must not be rejected at save time
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
- **`stepdice`/`pickStepDiceSize` (`formulaParser.ts`) accepts either a
  4-argument or a 5-argument size list** — the 4-argument form is kept
  working for backward compatibility with anything already written
  against it; don't remove it when extending the 5-tier form.
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
- **`InventoryItem.manualResolution: true` marks flavour-text formulas not
  meant for the engine** (e.g. equipment referencing whatever weapon it's
  enchanting, a concept the formula language has no variable for — resolved
  by the GM by hand). Every call site that decides whether an
  `InventoryItem` gets a roll button / goes through `resolveFormulaDisplay`
  must route through `isEngineRollableItem(item)`, never check
  `item.formula` truthiness directly. `CharacterAction` has no equivalent
  field — do not add one, `formula: ""` already covers it there — and
  `InventoryItem` is currently the only holder of this flag, so a second
  holder would need the same `isEngineRollableItem`-style wiring, not just
  the field. See `docs/parser-history.md` for how this flag went unwired
  for a while and what fixed it.
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
- **An empty `formula` on a spell/action can mean two different things**:
  genuinely nothing to roll, or a real mechanic this character-centric
  formula engine cannot express (e.g. Updraft's damage depends on the
  target's own save, not the caster's stats). Check the description
  before treating an empty `formula` as a data gap to fill in.
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
- **Three paths must reject identically — but only one of them, plus a
  fourth, is actually wired into the app.** `validateFormula` (write-time,
  against a real context), `evalFormulaWithContext` (display value), and
  `resolveFormulaDisplay` (display string) are required to agree, enforced
  by a cross-consistency test: if you add a check to one, add it to all
  three. **`validateFormula` itself has zero production callers as of
  1.5.1 — confirmed by grep, only ever called from tests.** The actual
  write-time gate in the shipped app is `validateFormulaSyntax` (via
  `formulaSyntaxError`, via `useFormulaField`), a deliberate fourth,
  separate path (see above) NOT required to agree with the other three on
  dice bounds — only on syntax-level rejections (unknown tokens, wrong
  arity, over-length, over-depth). Whether to wire `validateFormula` into
  a real write path or remove it is an open decision (see its own JSDoc
  `@remarks`), not resolved by this note — the note exists so the
  "three paths" framing above isn't misread as describing what actually
  runs in production.
  - **Real gap this produced, found via `LVL*1d4` as a custom formula,
    fixed in 1.5.1:** `validateFormulaSyntax` accepted it at save time;
    the very first roll then threw `"Unexpected trailing input in
    formula: d4"`. Root cause: `validateFormulaSyntax` resolved dice via
    `diceToAverage`, whose `/(\d+)d(\d+)/gi` replace matches `NdX`
    **anywhere** in the string, so `"1*1d4"` (post-substitution) became
    `"1*3"` and passed. `parseDamageFormula` — the path `rollFormula`
    actually uses — only recognizes dice notation as the string's
    **leading** token (`^(\d+d\d+)`); anything else falls through to
    `safeEval` on the raw, un-stripped string, which doesn't know what to
    do with a `d` it never stripped out. A dice token anywhere but the
    very start was accepted by the lenient write-time check and rejected
    by the strict roll-time one — confirmed to affect 8 distinct malformed
    shapes (multiplier before dice, dice in parens, dice followed by a
    multiplier), not just the one reported formula.
    **Fix:** `validateFormulaSyntax` now runs a SECOND gate after its
    existing arithmetic check: it calls `parseDamageFormula` itself
    (against the same neutral context, with a new `enforceLimits: false`
    parameter threaded through to `parseDamageFormula`'s own
    `resolveDynamicDice` call — the one behavioral addition to
    `parseDamageFormula`, inert for its only production caller,
    `rollFormulaWithContext`, which keeps the `true` default) — reusing
    the SAME position constraint `rollFormula` already enforces, instead
    of inventing a third definition of "where dice may appear" to sit
    alongside `diceToAverage`'s and `resolveFormulaDisplay`'s own (still
    both unanchored — deliberately NOT unified in this batch, since 1.6.0's
    multiplier support will change what "valid position" even means, and
    unifying twice would be double the work). Independent of, and found
    alongside, the separate "`×` isn't `*`, and even `*` wouldn't help
    because a dice COUNT can't be a variable at all" gap — see the
    multiplier-before-dice item in the spell content batches' notes for
    that one; multiplier support itself is still not implemented, tracked
    for 1.6.0.
    **Known residual gap:** `useFormulaField`'s `discardedWarning` can fire
    on close even when the formula was already invalid before the edit
    panel was ever opened, not just one broken mid-edit — the stored
    formula is unaffected either way. Affects all 6 formula write sites
    (spell/item/action create-and-edit forms). Tracked for 1.6.0 alongside
    the regex unification above; see `docs/parser-history.md` for the
    mechanism.
- **A reflexive test iterates `FormulaContext`'s own keys** to verify every
  documented variable actually substitutes. `FLAW` was documented in the
  README and computed in `buildContext` but never wired up, and nothing caught
  it. Any field added to the context must be substituted or that test fails.
  **Current status, so a future session doesn't reread this as a still-open
  bug:** `FLAW` is now wired, covered by this reflexive test, consumed by
  zero entries in `spells.ts`/`equipment.ts`, and usable in a GM's own
  custom formula. Separately, `SaveMods` and `initiativeAdvantage` are both
  correctly typed and correctly read (`StatBox`'s advantage indicator/SAVE
  button, `CombatTab.confirmInitiativeRoll`) but have no write path
  anywhere in the UI, so both stay frozen at `"none"` for every character —
  the same FLAW-shaped gap, one type-check/lint/tests can't catch here
  either, since "always none" is itself a valid, correctly-typed state.
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
- **`docs/reference/CoreRules-v0.8.pdf` has no text layer the sandboxed
  `Read` tool can use.** Extract with `pdftotext`, cross-checking
  `-layout` mode (preserves column position) against plain mode
  (preserves stream order) at any ambiguous column boundary — the book's
  two-column card layout makes either mode alone unreliable. Each
  `\f`-delimited "page" in the extracted text is a printed two-page
  spread, not one page; use the trailing page-number text to know which
  book page the content actually belongs to.
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