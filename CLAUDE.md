# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Owlbear Rodeo (OBR) extension: a real-time-synced character sheet panel for the **Nimble** TTRPG. React 19 + TypeScript + Vite + Tailwind CSS v4, using `@owlbear-rodeo/sdk` v3.1.0. Single project (no monorepo), pure static SPA, no backend, no env vars.

## Commands

- `npm run dev` : Vite dev server on `https://localhost:5173` (HTTPS via self-signed cert; register the manifest at `https://localhost:5173/manifest.json` in OBR's Extensions panel to test)
- `npm run build` : `tsc -b && vite build`
- `npm run type-check` : `tsc --noEmit`
- `npm run lint` : `eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0`
- `npm run test` : Vitest suite on `src/utils/formulaParser.test.ts` (113 tests),
  `src/utils/characterMigrations.test.ts` (25 tests), and
  `src/utils/entryUndo.test.ts` (7 tests), 145 total. Pure functions only, no
  OBR dependency. Deterministic dice via a `Math.random` spy (`mockRolls`
  helper), not by mocking `rollDice` (ESM mocking limitations in Vitest, and
  mocking it would leak into the public API signature).
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

### Structural constraints (do not refactor away)

These exist because of bugs already diagnosed and fixed. Changing them reintroduces the bug.

- **`App.tsx` is a single JSX tree, not multiple early-return branches.** `DicePanel` must never unmount, or in-progress dice state is lost whenever `selectionState` changes. Consolidating the tree is the fix; "improving readability" with early returns undoes it.
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

### Formula parser (`src/utils/formulaParser.ts`)

Hand-rolled recursive-descent parser. **Never use `eval()` or `Function()`**
here, by design, to avoid arbitrary code execution from a player- or GM-typed
formula.

Syntax: dice (`1d8`, or implicit-count `d66`), stats (`STR/DEX/INT/WIL`),
`KEY`/`FLAW`, skills, `LEVEL`/`LVL`, arithmetic, `floor()`/`ceil()`/`min()`/
`max()`, and dynamic dice (`incrementdice(1, level)d12`, `1dstepdice(...)`).

#### Decisions (do not "fix" these)

Each of these was a real bug or a deliberate trade-off, diagnosed and settled.
Reverting one reintroduces the bug.

- **The rulebook's notation is the spec, not the parser's.** Three separate
  bugs came from data being "wrong" when the parser was too strict: `d66`
  (implicit count), `KEYd20` (variable glued to a die), `LVL` (book shorthand).
  When game data doesn't parse, fix the parser, don't rewrite `spells.ts`.
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
- **`parseUnary` handles unary `+` explicitly.** Flat bonuses (`+8`) and
  stripped formula tails (`+3+2`) previously worked only by accident, via the
  unknown-token fallback that returned 0.
- **`manualResolution: true` marks flavour-text formulas** (e.g. equipment
  reading `WeaponDamage + ...`, resolved by the GM by hand). The exhaustive
  data test filters on this field, so exclusions live in the data, never as a
  hardcoded list in the test.
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
- Implicit dice count (`d66`, `d44`, `d88`) is rulebook notation for a single
  die with N faces, normalized to `1dN`. Not a two-digit table roll.
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
- Code and documentation are in English. Conversation with the maintainer is in French.
- **In user-facing prose (README, `docs/store.md`, UI copy): do not use em dashes or en dashes.** Use commas, colons, or parentheses. Em dashes read as AI-generated.
- `docs/store.md` is the OBR extension store listing (front matter + markdown for the marketplace), not internal docs. Its `tags` must stay within the store's allowed vocabulary, and `manifest`/`image`/`icon` URLs must stay in sync with the deployed URL (`nimble-obr.vercel.app`).