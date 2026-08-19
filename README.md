# 🎲 Nimble Character Sheet: OBR Extension

*Read this in [French / Français](README.fr.md).*

Owlbear Rodeo extension for playing the **Nimble** TTRPG. Interactive character sheet in a side panel, synced in real time for every player at the table.

---

## Tech Stack

- **React 19** + **TypeScript**
- **Vite** (dev server + build)
- **Tailwind CSS v4** (configured in CSS, no `tailwind.config.js`)
- **@owlbear-rodeo/sdk** (v3.1.0)
- **Vitest** for unit tests

---

## 🤖 AI-Augmented Engineering

This project was built with an **AI-Augmented Engineering** approach (LLM-assisted development), and also serves as a personal training ground for advanced AI use in a professional context. It happened in two clearly distinct phases, with two different working methods.

### Phase 1: Claude in conversation (the bulk of the project)

Overall architecture, data schema, design mockup, and every game-design decision were made by hand. The React/Tailwind component code was generated iteratively with Claude in conversation, from detailed specs and manually injected context: OBR SDK documentation, official Nimble rules extracted from the reference PDF so the generated spells/items stayed faithful to the book. Control was exercised naturally: every line went through a manual review and integration before entering the repo.

### Phase 2: Claude Code as an agent (picking the project back up)

The method changed when the project was picked back up: Claude Code writes directly into the repo (new features, refactors, tests), and the developer's role shifts to critical review rather than line-by-line reading. The lever is no longer reviewing every diff as it's written, but instead:

- precise prompts and a structured project context (`CLAUDE.md`, at the repo root, which documents decisions not to "fix" and the reasoning behind them);
- reviewing the produced output, not just the code but the reasoning given;
- automated guardrails: a test suite (see [Tests and CI](#tests-and-ci)), invariants that deliberately break when a step is forgotten (e.g. the `MIGRATIONS invariant` test in the [schema versioning](#schema-versioning) system).

What doesn't change between the two phases: nothing is accepted without being manually reviewed and tested. In phase 2, several of the agent's proposals were rejected or corrected after verification, and several bugs were found through manual multi-client testing in OBR, not by the automated suite. Three concrete examples of what this review caught, none of which would have been caught by a test or a type-check:

- **`LVL`**: the agent proposed fixing the data in `spells.ts` by rewriting `LVL` to `LEVEL`, treating the book's notation as a typo. The right fix was to add `LVL` as an alias in the parser (see `VARIABLE_TABLE` in `formulaParser.ts`): rewriting the data would have left the same trap for the next GM writing a custom formula with that official abbreviation.
- **`actionsUsed` renamed to `actionsRemaining`**: the field counted actions spent, when what a player actually tracks at the table is what's left. The counting direction was inverted (spending 1 action set the counter to 2 instead of 1). Found by playing with the sheet, not by reading the code.
- **The action tracker's reset**: the agent proposed tying it to the initiative roll, based on an inaccurate rule (initiative is rolled once per combat in Nimble, not every round). Rejected on game-knowledge grounds, not code.

### What phase 2 revealed about phase 1

The most interesting takeaway of the project: phase 2's rigor (systematic tests, CLAUDE.md documenting every guardrail, JSDoc requiring the "why" to be justified) surfaced several silent bugs introduced in phase 1, present in the code for weeks with no red test or type-check error flagging them:

- **The formula parser's anti-DoS guardrail only protected the display path.** A limit on dice count and sides (`assertDiceWithinLimits`) had been added on the display path (`diceToAverage`) but not on the dynamic-dice resolution path (`resolveDynamicDice`), which feeds both the display *and* the real roll. A real roll was therefore not protected by the limit meant to cover it.
- **Three of the book's official notations were silently rejected.** `d66` (implicit-count die, with no leading "1"), `KEYd20` (a variable glued to dice notation: the regex `\b` boundary doesn't detect a break between "Y" and "D", both word characters), and `LVL` (an abbreviation the book itself uses) all three failed to parse, even though the content was correct: the parser was too strict.
- **The `FLAW` variable was documented but never wired up.** It appeared in the README and in `buildContext`, with no substitution line anywhere in the parser: a formula using it would never have evaluated correctly.
- **Several silent degradations to 0 masked errors.** An unknown formula token, a `NaN` result, a dice count of 0: all of them returned a plausible-looking `0` instead of failing loudly, which is particularly dangerous for a dice roller broadcast to the whole table.
- **A resolved `updateItems` doesn't prove the table received the change.** The OBR SDK talks to its host exclusively through `window.postMessage` between the extension's iframe and the parent window, a mechanism that never touches the network layer. `updateItems`/`setMetadata` resolve as soon as the host has applied the change to its own local scene state, which is not the same thing as the change actually being relayed to the multiplayer server over the host's WebSocket. With the network cut, `updateItems` keeps resolving normally while the host's WebSocket sits closed. This is a real blind spot of the extension (see `SyncStatus` in `useOBR.ts`), not a supposition.
- **Claims about synchronization had drifted from what the code actually guaranteed.** This very README used to claim that a write "propagates instantly to every connected client"; true for the common case, but false in the absolute sense the sentence implied, for the reason above.

The common thread across all these bugs: none of them was visible in green tests or a clean type-check, and several came from a safety measure placed somewhere plausible but ineffective. This is a real limit of phase 1's method (manually injected context, but no test suite to verify invariants over time), and documenting it strengthens this section rather than weakening it: it's exactly what phase 2's rigor (automated guardrails, JSDoc that must justify every decision) was put in place to prevent going forward.

### Acknowledged limits

Control is exercised over structuring decisions (architecture, data schema, game design, permissions) and over reviewing output, not over every internal implementation choice: several technical details were indeed decided autonomously by the agent and validated after the fact rather than before, for example the choice to re-write a schema migration in a dedicated effect rather than at load time (see `useOBR.ts`), or an internal counter (`armIdRef` in `useDeleteUndo.ts`) to invalidate an undo timer that's gone stale. Every change touching **permissions** (`canEdit`, `ownerId`) or multiplayer sync, on the other hand, was manually tested by hand in OBR with several simultaneous accounts (a GM + several players) before being accepted: `type-check` + `lint` + green tests is the bar for "done" on the code side, but not sufficient proof for anything touching multiplayer, where there's no automated substitute.

---

## Prerequisites

- **Node.js ≥ 18** (LTS recommended)
- **npm ≥ 9** (or pnpm / yarn if you prefer)
- An [Owlbear Rodeo](https://www.owlbear.rodeo/) account to test the extension

---

## Quick start

```bash
npm install
npm run dev
```

The terminal prints a URL like `https://localhost:5173`. That's the one to register in OBR (see below). The project doesn't need to be scaffolded from scratch: this command is enough. For the history of how the project was originally scaffolded (Vite + React + TS + Tailwind), see [docs/dev-setup-from-scratch.md](docs/dev-setup-from-scratch.md).

---

## Registering the extension in Owlbear Rodeo

1. Open [owlbear.rodeo](https://www.owlbear.rodeo/) and create a game (or open an existing one).
2. In the left-side menu, click the **Extensions** icon (puzzle piece).
3. Click **"Add Extension"**.
4. Enter the manifest URL:
   - for local development, `https://localhost:5173/manifest.test.json` (`public/manifest.test.json`, named "[DEV]" to stand out from the production-installed version in the extensions list);
   - to use the published version, `https://nimble-obr.vercel.app/manifest.json` (deployed from the `main` branch).
5. Locally, accept the HTTPS certificate if your browser prompts for it (visit `https://localhost:5173` directly once).
6. The extension appears in the menu; click it to open the panel.

> **After updating an already-installed extension**, reload the OBR page (F5) before reopening the panel. The sheet's schema is versioned (see [Schema versioning](#schema-versioning)): a tab left open since before the update can end up facing a sheet migrated by a newer client, and will then show a message asking to reload rather than guessing at a field it doesn't know about yet.

---

## Production build

```bash
npm run build
```

The static files land in `dist/`. The published version is deployed on **Vercel** from the `main` branch, at `https://nimble-obr.vercel.app`. Other static hosts would work too (Netlify via drag & drop of `dist/`, GitHub Pages with `base: '/nimble-obr/'` in `vite.config.ts`), but would mean changing the `manifest`/`image`/`icon` URLs in [docs/store.md](docs/store.md), which must stay in sync with the actually deployed URL.

---

## Project structure

```
nimble-obr/
├── public/
│   ├── manifest.json          ← production manifest
│   ├── manifest.test.json      ← "[DEV]" manifest for local development
│   └── icon.svg                ← extension icon
├── docs/
│   ├── schema-migrations.md    ← sheet schema versioning and migration
│   ├── dev-setup-from-scratch.md
│   └── store.md                 ← OBR extension store listing
├── src/
│   ├── types/
│   │   └── character.ts        ← domain types (NimbleCharacter, etc.)
│   ├── utils/
│   │   ├── formulaParser.ts    ← formula parser + dice engine
│   │   ├── characterMigrations.ts  ← schema migrations
│   │   └── entryUndo.ts        ← pure delete-undo logic
│   ├── data/
│   │   ├── spells.ts           ← official spells (BASE_SPELLS)
│   │   └── equipment.ts        ← official equipment (BASIC_EQUIPMENTS)
│   ├── hooks/
│   │   ├── useOBR.ts           ← OBR SDK integration (state, permissions, sync, rolls)
│   │   ├── useDeleteUndo.ts    ← delete undo (spells/items/actions)
│   │   ├── useDraggableValue.ts
│   │   ├── useFormulaField.ts  ← deferred-commit formula field
│   │   └── useSearchFilter.ts
│   ├── components/
│   │   ├── ui/
│   │   │   ├── common/          ← reusable components (BentoSection, FormField, FormulaHelp…)
│   │   │   ├── StatBox.tsx
│   │   │   ├── DiceRollModal.tsx
│   │   │   ├── DicePanel.tsx
│   │   │   ├── RollLog.tsx
│   │   │   ├── SyncStatusBanner.tsx
│   │   │   ├── DeleteUndoToast.tsx
│   │   │   └── LanguageSelector.tsx
│   │   └── tabs/
│   │       ├── SummaryTab.tsx
│   │       ├── CombatTab.tsx
│   │       ├── SpellsTab.tsx
│   │       └── InventoryTab.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Data architecture

The sheet is stored in the OBR token's **metadata** under the key:

```
com.nimble-obr.nimble/character_sheet
```

This unique namespace avoids collisions with other extensions' metadata. Every change calls `OBR.scene.items.updateItems()`.

The dice roll history (visible to the whole table) is stored separately in the **scene metadata**, under a key derived from the same namespace, capped at 20 entries.

### Schema versioning

The sheet (`NimbleCharacter`) carries a `schemaVersion`. A single choke point (`migrateCharacter`) brings an old record up to the current version, refuses a record written by a newer client (`"unsupported"`, "reload the page" message), and refuses a record that's corrupted even after migration (`"invalid"`). The full procedure for adding a field, what happens client-side at deploy time, and the known limits of shape validation are documented in [docs/schema-migrations.md](docs/schema-migrations.md).

### Who can edit what?

| Role | Can edit |
|------|--------------|
| Player, token owner (`ownerId`) | Their own sheet |
| GM | Any sheet, regardless of `ownerId` |
| Player, another token | Read-only (edit buttons hidden, not just disabled) |

This permission is centralized in a `permissions` object (`{ canEdit, isGM, isOwner, isUnclaimed }`), computed once in `useOBR` and passed explicitly as props to every interactive component: it never propagates "automatically" through React context, which requires a systematic check for every newly added component.

**Write-side guard**: `updateCharacter` (in `useOBR`) re-checks `canEdit` before every call to `OBR.scene.items.updateItems`, and silently gives up (with a `console.warn`) if the caller doesn't have rights. This isn't a real security boundary, OBR has no server-side ACL on metadata, so a determined player could still write via devtools, but it avoids accidental writes triggered by stale UI state.

**Rolling dice stays possible read-only**: rolling a die is deliberately not gated by `canEdit`, a player looking at someone else's sheet can still roll a die using that character's stats. Only persisting changes to the sheet itself goes through `updateCharacter`'s guard.

**"Claim" / "Take over"**: claiming or taking over a sheet isn't gated by `canEdit` either, since that's precisely the entry point that grants edit rights. Currently, any player can take over another player's already-claimed sheet (a deliberate choice for a table of trusted friends); if this needs to be restricted to the GM, the guard should be added at the button call site in `App.tsx`/`CharacterHeader.tsx`.

### Sync feedback

Every write to OBR is tracked (`SyncStatus` in `useOBR`) and surfaces in a discreet banner at the top of the panel:
- nothing is shown for a normal write (the "idle" state is the common case, a successful write shouldn't display anything);
- a "Saving…" indicator appears if a write is in flight longer than expected;
- an "offline" banner shows if `navigator.onLine` is false; the sheet stays usable locally (rolls, formula drafts) but nothing is broadcast to the table until the connection comes back;
- a failed write shows a persistent banner with a "Retry" button, which stays displayed until a successful retry or an explicit dismiss.

This mechanism covers errors reported by the OBR host and total loss of network interface. It does not cover the OBR host's WebSocket relay to the multiplayer server dropping while the network stays up: see the note on `updateItems` above, in the AI-Augmented Engineering section.

---

## Supported formulas

The formula parser (`src/utils/formulaParser.ts`) supports:

| Syntax | Example | Result |
|---------|---------|----------|
| Dice | `1d8`, `2d6` | random roll |
| Implicit-count die | `d20`, `d12`… | book notation with no explicit count, normalized to `1dN` |
| Positional dice | `d44`, `d66`, `d88`, advantage variant `d66a` | 2nd printing: two dice (three for `a`, keeping the 2 highest without resorting them) read positionally (tens/ones), e.g. 4 then 5 → 45. Never miss or crit. |
| Stats | `STR`, `DEX`, `INT`, `WIL` | character's value |
| Key / flaw stat | `KEY`, `FLAW` | value of the stat marked key/flaw |
| Skills | `MIGHT`, `STEALTH`, `ARCANA`… | skill's value |
| Level | `LEVEL`, `LVL` (book alias) | current level |
| HP | `HP`, `MAXHP` | current / max hit points |
| Math | `+`, `-`, `*`, `/` | basic operations |
| Rounding | `floor(LEVEL/5)`, `ceil(...)` | round down/up |
| Min/Max | `min(a, b)`, `max(a, b)` | min/max value |
| Dynamic dice | `incrementdice(1, level)d12`, `stepdice(level, 4, 8, 10, 12)` | dice that scale with level |
| Combined | `1d10 + STR + floor(LEVEL/5) * 5` | advanced formula |

A built-in help panel (the "?" button next to every formula field) documents this same list plus real worked examples pulled from the game's spells/items. This list is never hand-copied into the UI: it's generated by reflecting over the parser's own internal tables, precisely to avoid a documented variable ever ending up unwired (see `FLAW` above).

**Safety limits**: a formula is capped at 200 characters and 30 nesting levels; a roll is capped at 100 dice maximum, each with 1000 sides maximum. These are guardrails against a malformed or malicious formula, not balance limits: a legal level-20 character's spell is nowhere close to them.

> `eval()` is **never** used, the parser is a hand-written recursive descent parser, to avoid any risk of arbitrary code execution via a formula typed by a player or the GM.

---

## Tests and CI

```bash
npm run type-check   # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run
```

A Vitest suite covers the project's pure functions (no dependency on the OBR SDK): the formula parser, schema migrations, delete-undo logic, and the search-filter logic shared between the Inventory and Spells tabs. It runs in `.github/workflows/ci.yml` on every pull request and on push to `main`/`dev` (type-check + lint + tests).

What the suite does not cover, by construction: anything touching real multi-client sync, permissions in practice (several simultaneous OBR accounts), and the UI itself. Those changes go through manual verification with several accounts in OBR; there's no automated substitute for that in this project.

---

## Accessibility

Visible keyboard focus indicators on interactive elements (HP/Mana bar sliders, action buttons), and `aria-label`s on buttons that only show an icon (row actions, banner dismiss, removing a language). This is not a full accessibility audit, only the targeted fixes made so far.

---

## Delete undo

Deleting a spell, item, or action is immediate and broadcast to the table, with no confirmation. As a counterbalance, a local toast (visible only to the client who deleted it) allows undoing for a few seconds. Only one level of undo at a time: a new deletion while the toast is showing replaces the pending undo rather than stacking a history.

---

## Next steps (roadmap)

- [ ] FR/EN translation tab
- [ ] Class selection with starting-stat pre-fill
- [ ] Repositionable / detachable extension panel (researching the OBR SDK)
- [ ] Optional light "parchment" theme
- [ ] JSON import/export of the sheet
- [ ] Keyboard shortcuts for frequent rolls

---

## License

Nimble OBR is an independent product published under the Nimble 3rd Party Creator License. Nimble TTRPG (c) Nimble Co.

---

## Resources

- [OBR SDK docs](https://extensions.owlbear.rodeo/docs)
- [Vite docs](https://vitejs.dev)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Nimble TTRPG](https://nimble-ttrpg.com)
