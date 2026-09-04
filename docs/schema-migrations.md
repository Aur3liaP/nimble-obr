# Schema migrations

How `NimbleCharacter`'s stored shape is versioned and migrated. For the
mechanical rules (dos and don'ts for an agent editing this code), see
CLAUDE.md's "Schema versioning" section and the JSDoc in
`src/utils/characterMigrations.ts`. This document explains how the system
works and why, for a human reading the codebase.

## The problem

A character sheet (`NimbleCharacter`, `src/types/character.ts`) is stored
as-is, with no expiry — as of schema v6, in the scene-metadata vault
(`characterStore.ts`), keyed by the character's own `id`; before v6, directly
under a token's item metadata, where it existed for as long as that token did
(see CLAUDE.md's "vault-decoupling" notes for why that changed, and the
`prepareLegacySheetMigration`/`loadCharacterForToken` path in `useOBR.ts` for
how an old token still on that storage location is migrated the first time
it's loaded). Either way, the shape of `NimbleCharacter` has already changed
more than once and will keep changing. Before this system existed, nothing
recorded which shape a given stored record was written against: JavaScript
accepts a missing field silently until something reads it, so an old record
with an outdated shape would only fail once the app tried to use the field it
lacked. Everything below (`MIGRATIONS`, `migrateCharacter`,
`validateCharacterShape`) is about the character record's own SHAPE, and
applies identically regardless of which of the two storage locations it's
read from.

## Adding a field to `NimbleCharacter`

There are five steps. Four are checked automatically, one is not.

1. **Add the field to the `NimbleCharacter` interface** (`types/character.ts`).
2. **Give it a value in `createDefaultCharacter()`** (same file). For a
   *required* field, `tsc --noEmit` fails if you forget this: the function's
   return type is `NimbleCharacter`, so a required property missing from the
   returned object literal is a compile error, and a property that isn't on
   the interface at all is also a compile error (excess property check).
   For an **optional** field (`field?: type`), neither check fires. Nothing
   breaks if you forget to set it. `validateCharacterShape` walks
   `createDefaultCharacter()`'s own return value as its template
   (`findShapeMismatch` in `characterMigrations.ts`), so a field the
   template never sets is a field the validator never asks a stored record
   to have either. This is a documented gap, not a bug: see
   `validateCharacterShape`'s JSDoc.
3. **Bump `CURRENT_SCHEMA_VERSION` by exactly 1** (`types/character.ts`).
4. **Append exactly one migration function to `MIGRATIONS`**
   (`characterMigrations.ts`), transforming a record from the old shape to
   the new one. `MIGRATIONS[i]` must transform version `i` to version
   `i + 1`, never more than one version at a time.
5. **Leave every earlier migration function alone.** A migration is a
   permanent, append-only record of what changed at that version, not
   something to revisit.

Steps 3 and 4 are checked together by one test: `MIGRATIONS.length ===
CURRENT_SCHEMA_VERSION` (`"MIGRATIONS invariant"` in
`characterMigrations.test.ts`). Bumping the version without adding a
migration, or adding a migration without bumping the version, fails that
test immediately.

Step 5 has no automated guard. Nothing currently stops someone from editing
a migration that already shipped. It is a convention stated in the file
header, not an enforced one.

## What happens at deploy time

A deploy changes the code (and `CURRENT_SCHEMA_VERSION`), not any data
already sitting in OBR scene metadata. Three situations coexist right after
a deploy, until every open tab has reloaded:

- **A client that reloads** picks up the new code. The next time it selects
  a token, `loadCharacterForToken` (`useOBR.ts`) resolves the character
  (from the vault, or from a legacy token payload — see above), running it
  through `migrateCharacter` either way, and if the caller currently holds
  `canEdit`, a dedicated effect writes the migrated record back so the
  stored `schemaVersion` catches up.
- **A client that has not reloaded** (an old tab left open) can encounter a
  record that another, already-reloaded client just migrated and wrote back
  at a newer `schemaVersion` than the old tab's build understands. There is
  no downward migration: the old tab cannot know what a newer field means.
  `migrateCharacter` returns `"unsupported"`, the selection state becomes
  `"unsupported-version"`, and the panel shows: "This character sheet was
  saved by a newer version of this extension. Reload the page to get the
  latest version." (`App.tsx`).
- **A sheet nobody with `canEdit` opens** is never written back. It stays
  at its old `schemaVersion` in storage indefinitely; every read still
  migrates it in memory for whoever views it, but nothing persists that.
  This is accepted, not solved.

Practical consequence: deploying in the middle of a live session risks a
player's still-open tab hitting the "reload" block as soon as anyone else's
already-reloaded client writes a migrated sheet back. Deploying between
sessions, when every tab gets a fresh load before the table plays again,
avoids that.

## Worked example: v0 to v1

The only migration that exists today, `MIGRATIONS[0]` in
`characterMigrations.ts`:

```ts
(character) =>
  fillMissingFields(
    character,
    createDefaultCharacter("") as unknown as Record<string, unknown>,
  ),
```

`fillMissingFields` deep-merges a stored record onto a fresh
`createDefaultCharacter()` template: every key already present in the
record (checked with `in`, not truthiness, so a real `0`, `""`, `false`, or
existing `null` is kept, not mistaken for "missing") is kept as-is, and only
a key genuinely absent is filled in from the template, recursing into
matching sub-objects (`hp`, `stats`, `defense`, `combat`, ...).

This blanket approach is legitimate for v0 specifically, and only for v0.
"v0" does not name one fixed shape: it means "everything written before
`schemaVersion` existed at all," an open-ended range covering every shape
`NimbleCharacter` has had over time. `combat` was the one *known* gap
(formerly patched ad hoc, with no versioning, directly in
`useOBR.ts`'s `loadCharacterFromItem`), but the type changed more than once
before versioning existed without that ever being visible anywhere, so
there is no way to know every field an actual v0 record might be missing.
The only workable definition of "what v0 needs" is "whatever
`createDefaultCharacter()` says v1 has that this record doesn't," which is
exactly what `fillMissingFields` computes.

Every migration added after this one is different: it knows exactly which
fields changed between two fixed, already-shipped versions, and must stay a
small, explicit, deliberate transform of just those fields, the way this
migration used to be when it only patched `combat`. Reusing the same
blanket fill for a later version would silently paper over a real shape bug
(a field missing because of an actual mistake between two versioned
releases) instead of surfacing it as `"invalid"`, and would erase the
changelog value of this file, where each migration function is a record of
exactly what changed at that version.

## Version history: v2 to v6

Chronological detail for every schema bump between the generic v0 -> v1 fill
above and the v6 -> v7 worked example below. This is the historical record;
the constraints these versions established that still bind any *new*
migration (sourceKey being append-only, catalogVersion being dev-declared,
etc.) are listed in CLAUDE.md's "Schema versioning" section, not repeated
here.

### v2: `Armor` renamed to `Defense`, `CharacterAction.damage` removed, `InventoryItem.armorValue` removed, `manualResolution` backfilled

All of this was folded into the existing v1 -> v2 migration step, not a new
v2 -> v3 step — a deliberate, one-time exception to "leave every earlier
migration function alone" (see "Adding a field" above): safe only because
v1 -> v2 had never shipped at the time — no build in circulation had ever
written `schemaVersion: 2`, so no real persisted record's correctness
depended on that step's old, narrower (`initiativeAdvantage`-only) behavior.
A local test scene that already held an old v2 shape from before this change
was NOT re-migrated (its `schemaVersion` was already current) and needed a
manual reset. This does not generalize — every migration after this one goes
back to appending a new step, never editing an existing one.

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
  exactly these numbers), the same category of mistake as the
  `formatModifier`/defense-breakdown and `ItemRowBase`/`formulaError`
  traps documented in CLAUDE.md's Architecture section: something that
  LOOKS like "the worn-item sense of armor" on first read is actually
  "the stat, just inside a longer sentence." Fixed to "Standard clothes.
  Defense: 2+DEX." etc., across all 20 armor/shield descriptions (Cloth,
  Leather, Mail, Plate, Shields) — done via a line-scoped script matching
  only `description: "..."` lines containing the literal `"Armor: "`
  label, specifically to avoid also matching `isArmor: true` (whose field
  name contains that exact substring too — a blind global find-and-replace
  across the file would have silently renamed the `isArmor` field itself).
  The item's own name/category and its "Old plate armor."-style prose (no
  colon, naming the gear, not a value) still correctly say "armor" and
  were left alone. **Not retroactive**: a character's inventory items are
  frozen copies of these description strings (matching how
  `manualResolution` needed its own backfill below) — an already-added
  armor item still shows the old "Armor: X+DEX" wording until/unless a
  future migration explicitly refreshes descriptions on non-custom items,
  which has been discussed but is not yet implemented. UI labels
  ("Defense", "Armor (from inventory)" in `CombatTab`) were already
  correct going in and needed no change — the armor `<select>` genuinely
  lists worn armor the character owns, a different sense of the word from
  the renamed stat, sitting right next to it structurally. Migrated by
  `migrateArmorToDefense` in `characterMigrations.ts`: if `armor` is
  present, its fields are moved to `defense` (missing `defenseBonus`
  backfilled to 0, same as `createDefaultCharacter`'s default); if `armor`
  is absent entirely (record predates the field), whatever `defense` the
  v0 -> v1 step already backfilled is left alone rather than clobbered
  with an empty object.
- **`InventoryItem.armorValue` deleted, not renamed.** Verified unused
  before removing: defense is computed from `formula` in
  `computeDefense.ts`; `armorValue` was only ever written (in
  `equipment.ts`'s data and `InventoryTab.handleAddFromList`'s copy from a
  template), never read anywhere. Confirmed dead, not a live field needing
  a rename.
- **`CharacterAction.damage` removed entirely** — `formula` was already
  the single source of truth for what's rollable; `damage` was
  display-only book notation kept in sync by hand across ~80 spells,
  strictly less useful than `resolveFormulaDisplay`'s resolved value.
  Removed from the type, from `spells.ts` (66 entries), and from every
  remaining read/write site: the custom-add forms in `SpellsTab`/
  `CombatTab` (their local form state field was renamed from `damage` to
  `formula` in the same pass, since it was always really editing the
  formula, just mis-named after an earlier fallback removal), and the
  inline-edit `onUpdate` calls that used to mirror `formula: v, damage:
  v`. The "Damage" / "Damage / Formula" UI labels on those forms are
  unchanged — book-notation wording aimed at the player, unrelated to the
  data field that got removed underneath it.
  - **Migration care: a naive `formula: formula || damage` merge is
    wrong.** `damage` used placeholder values meaning "no damage", not
    "no formula": `"0"` (True Strike, Ice Disk, 19 entries total),
    `"Special"` (pre-fix Dragonform/Living Inferno/Sacrifice/Shield of
    Justice, blanked to `""` since), and plain `""`. Naively merging one
    of these into `formula` would make a non-rollable spell rollable and
    show a bogus 0 or throw on "Special" — a direct regression, not a
    fix. `migrateActionDamageField` treats `{"", "0", "Special"}`
    (`PLACEHOLDER_DAMAGE`) as "no formula": `formula` wins whenever it's
    already non-empty; a placeholder `damage` with empty `formula` leaves
    `formula` empty; only a genuinely non-placeholder `damage` with an
    empty `formula` gets promoted to `formula` — and that branch logs a
    warning, since the "game data guard" test (see CLAUDE.md's Formula
    parser section) already confirmed no entry in `spells.ts` ships in
    that shape. This also matters for characters, not just game data:
    `actions` are frozen copies of whatever a spell looked like when
    added, so a character who added a spell before this removal still has
    both fields sitting in their persisted metadata regardless of what
    current `spells.ts` contains — `characterMigrations.test.ts` exercises
    all six raw shapes (formula only, damage only, both, damage `"0"`,
    damage `"Special"`, both empty) plus the logged fallback case.
- **`InventoryItem.manualResolution` backfilled on existing characters.**
  Confirmed by manual OBR testing: an item added to a character's sheet
  before the `manualResolution` read-path fix (see CLAUDE.md's Formula
  parser section) carries `manualResolution: undefined` in its frozen
  metadata forever, showing a working-looking roll button that throws —
  newly-added items were already correct, only pre-existing ones on
  already-claimed sheets were affected (Weapon of Animosity, Weapon of
  Wounding, Vindication, currently). `migrateInventoryManualResolution`
  re-applies the flag by matching `name` against `BASIC_EQUIPMENTS`, for
  `isCustom !== true` items only — custom items are never touched, even
  if a player happened to name one identically to an official entry.
  Driven off `BASIC_EQUIPMENTS` itself (`.find` by name), not a hardcoded
  item list, so a future equipment entry that sets the flag is covered
  automatically.

### v3: `sourceKey` — stable, immutable catalog identity, independent of `name`

A `CharacterAction`/`InventoryItem` copied from `BASE_SPELLS`/
`BASIC_EQUIPMENTS` is a FROZEN copy; the only link back to the template used
to be `name`, and `name` is not stable — the 2nd-printing equipment batch
renamed "Spear" to "Great Spear" and introduced an unrelated NEW "Spear"
(1d6+STR vs the old 1d10+STR), and "Mithril Plate" to "Adamantine Plate".
`sourceKey` (append-only per `equipment.ts`/`spells.ts`'s own file headers —
never edited or reused once shipped, since existing records reference it)
exists so template matching survives a rename. Introduced for a real
near-future need: the "outdated" badge and "reset to book text" action (see
v4 below) both require reliably tracing a character's copy back to its
template across a printing that renames things, which `name` alone cannot
do.

- **`sourceKey` values are `name`-derived slugs AT THE TIME OF
  INTRODUCTION, not at introduction of the entry itself.** "Great Spear"
  (originally shipped as plain "Spear") is keyed `"great-spear"`, not
  `"spear"` — since `sourceKey` didn't exist before this version, what
  matters is that it never changes AFTER this version, not that it
  matches the entry's own history.
- **`catalogCopy.ts`** (`src/utils/catalogCopy.ts`) extracts the "build a
  `CharacterAction`/`InventoryItem` from a template or from custom form
  state" logic out of `SpellsTab`/`InventoryTab`'s "Add" modals — same
  "extract for testability" pattern as `computeDefense.ts`/`initiative.ts`
  — specifically so "a catalog copy carries `sourceKey`, a custom entry
  never does" is a real, run unit test (`catalogCopy.test.ts`) instead of
  something only verified by reading component code. Four functions:
  `copySpellFromCatalog`/`copyItemFromCatalog` (the "from list" path —
  carry `sourceKey` from the template) and `createCustomSpell`/
  `createCustomItem` (the "custom" path — never reference a template at
  all, so there is nothing to leak `sourceKey` from). `CombatTab`'s
  `AddActionModal` (melee/ranged/ability/item-type actions) is NOT here:
  it has no catalog to copy from in the first place, so it was already,
  structurally, incapable of leaking a `sourceKey` — confirmed by grep,
  not assumed, before leaving it untouched.
- **Migration (`MIGRATIONS[2]`, v2 -> v3): backfills `sourceKey` on
  existing non-custom entries by matching `name` against the catalogs —
  THE LAST TIME this codebase matches by name.** Unlike the v1 -> v2
  exception above, this is a genuine new, appended migration step, not
  folded into an existing one.
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
    formula-search fallback would trade one wrong-match risk for another,
    more frequent one. The collision table is scoped and explicit
    instead: one row per known (old `name`, confirming `formula`) pair,
    append-only exactly like `sourceKey` itself. Logs via `console.warn`
    whenever the fallback actually fires.
  - **Also re-applies `manualResolution` using the SAME collision-safe
    resolution**, correcting anything the v2 migration's name-only pass
    could have gotten wrong on a collision it had no way to detect — that
    function itself is left completely untouched, per the append-only
    rule; this step's more precise resolution is what actually fixes it
    for any record that reaches v3. Harmless no-op on today's actual data
    (the Spear collision doesn't involve `manualResolution` on either
    side), but load-bearing the day a future collision does.
  - **A name matching nothing in the catalog keeps `sourceKey` undefined
    — a valid, deliberate state**, not a bug: it means "this entry cannot
    be traced back to the catalog" (renamed then hand-edited past
    recognition, or never catalog-sourced at all), which the "outdated"
    badge (v4 below) needs to be able to distinguish from "confirmed
    still matches the book." Never guessed at.
- **Other name-based catalog lookups found (grepped, not assumed) and
  deliberately left alone:** `FormulaHelp.tsx`'s `realSpellFormula`/
  `realItemFormula` also do `BASE_SPELLS.find(s => s.name === name)`/
  `BASIC_EQUIPMENTS.find(i => i.name === name)` — but these look up a name
  that's a LITERAL STRING WRITTEN IN THAT FILE'S OWN SOURCE (e.g.
  `realItemFormula("Rusty Mail")`), always edited in the same commit as
  whatever renamed the target entry, never a persisted, potentially stale
  character record. `sourceKey` solves staleness in FROZEN COPIES
  drifting away from a catalog that keeps changing after the copy was
  made — a problem that doesn't exist for a hardcoded lookup string that
  lives right next to the data it queries. Not migrated to `sourceKey`;
  would add a lookup indirection with no real problem behind it.

### v4: `catalogVersion` — dev-declared staleness, never a text diff

Characters store FROZEN COPIES of catalog entries (same root cause as
`sourceKey` above); when the catalog is updated (as the 2nd-printing batch
did to ~50 spells), existing sheets keep the old text and nobody is told.
Comparing the copy's text against the catalog does not work: descriptions
are freely editable on non-custom entries, so a player's own note would
make an entry look "outdated" when nothing actually changed — text
comparison cannot tell "the book changed" apart from "the player wrote
something." Instead every `BASE_SPELLS`/`BASIC_EQUIPMENTS` entry carries
`catalogVersion: number` (contract documented in both file headers, next to
the `sourceKey` contract): bump it by 1 whenever an entry's mechanics or
text change in a way a player should know about; purely cosmetic edits
(typos, formatting) don't require a bump, and that judgment call is the
author's, made at edit time — there is no mechanical test for "did this
edit count" the way there is for `sourceKey` presence/uniqueness. All
entries started at `1`. `CharacterAction.catalogVersion?`/
`InventoryItem.catalogVersion?` are optional copies of the template's
version, set alongside `sourceKey` in `catalogCopy.ts`'s
`copySpellFromCatalog`/`copyItemFromCatalog` — never set by
`createCustomSpell`/`createCustomItem`, same invariant as `sourceKey`.

- **`isOutdated` (`catalogCopy.ts`)** — one function, shared structurally
  by both catalogs (no generics needed; it only reads two fields and
  constructs nothing, so genericizing it doesn't risk the "hand-copied
  logic drifts apart" failure mode a duplicated *construction* function
  would). An entry is outdated only when it has BOTH a `sourceKey` and a
  `catalogVersion`, AND the catalog entry currently matching that
  `sourceKey` has a strictly higher `catalogVersion`. Returns `false`
  (never throws) for: a custom entry (no `sourceKey`); a copy that
  predates `sourceKey`/`catalogVersion` entirely and could never be traced
  back to the catalog; and — explicitly, this is not an error case — a
  `sourceKey` that no longer exists in the CURRENT catalog (e.g. "Greater
  Shadow," removed in the 2nd-printing spells batch). There is no newer
  version to offer for something that's gone, so it shows nothing rather
  than a false "outdated."
- **`OutdatedBadge` (`src/components/ui/common/OutdatedBadge.tsx`)** — a
  small amber "Updated" pill, purely informational, no `onClick`; must
  never block rolling or editing, so it's additive next to existing
  school/tier/type badges, never a replacement or a gate. Wired into
  `SpellsTab.SpellRow`'s existing badge row, `InventoryTab.ItemRow` (via
  `ItemRowBase`'s `nameExtra` prop), and `CombatTab.ActionRow`'s
  type-badge row. **Deliberately NOT wired into
  `CombatTab.InventoryFavoriteRow`** (the Favorites section's minimal,
  explicitly read-only favorited-item shortcut row — full edit/delete
  lives in the Inventory tab's own `ItemRow`): that row is a deliberately
  minimal shortcut, not a fourth editable surface. `ItemRowBase` gained a
  `nameExtra?: ReactNode` prop (rendered right after `name`, generic — not
  a boolean flag — so the shared row shell doesn't need to know what
  `isOutdated`/`catalogVersion` even are) specifically so
  `InventoryTab.ItemRow` could pass the badge through without
  `InventoryFavoriteRow` (which also builds on `ItemRowBase`, but never
  passes `nameExtra`) picking it up for free.
- **`CombatTab.ActionRow` shows the badge but NEVER a reset button, by
  construction, not by an extra guard.** `ActionRow` renders both the main
  "Actions" list (`character.actions.filter(a => a.type !== "spell")` —
  always non-spell, always custom, so `sourceKey` is never set and
  `isOutdated` is always `false` there) and the Favorites section's
  favorited spell-type actions (read-only shortcuts: rendered with
  `isEditing={false}` and no `onUpdate`/`onEditToggle`, so no edit panel —
  where a reset button would live — is ever rendered for them regardless).
  The badge computation runs unconditionally in `ActionRow` (harmless —
  `isOutdated` is cheap and just returns `false` for the main list) rather
  than special-cased per call site.
- **"Reset to book version" (`resetSpellToCatalog`/`resetItemToCatalog`,
  `catalogCopy.ts`)** — a plain overwrite from the current catalog entry,
  as decided: no diff view, no attempt to preserve player edits. Preserves
  only `id` and `isFavorite` (those belong to the copy, not the template);
  everything else, including a fresh `catalogVersion`, is rebuilt via
  `copySpellFromCatalog`/`copyItemFromCatalog` — for `InventoryItem` this
  also means `isEquipped`/`quantity` reset to the template's defaults
  (`false`/`1`), a deliberate reading of "everything else comes from the
  catalog," not an oversight; the confirmation dialog says so. Returns the
  entry UNCHANGED (never throws) if `sourceKey` doesn't match anything in
  the catalog — defensive; the UI only ever offers this action when
  `isOutdated` already confirmed a match exists. Confirmation is a plain
  `window.confirm()` (no existing confirm-dialog component in this
  codebase) stating plainly that edits will be lost, wired into
  `SpellsTab.SpellRow` and `InventoryTab.ItemRow`'s edit-panel footers as
  a `TextAction variant="neutral"`, shown only when `outdated` — same
  `canEdit`-gated footer the delete button already lives in.
- **Migration (`MIGRATIONS[3]`, v3 -> v4): backfills `catalogVersion: 0`
  on existing non-custom entries that already have a `sourceKey`.**
  Deliberately `0`, not `1` — lower than every real catalog entry's `1`,
  so every copy a player currently holds is immediately flagged outdated.
  This is correct, not a bug: the 2nd-printing rewrite changed most of the
  catalog, and this migration is the first time anyone is told, for
  entries added before this system existed. Entries with no `sourceKey`
  (custom, or untraceable after the v3 backfill) get no `catalogVersion`
  either — they can never be reset, matching `isOutdated`'s own "no
  sourceKey -> false" rule. Runs after `MIGRATIONS[2]` (the `sourceKey`
  backfill) in the same chained `migrateCharacter` pass, so it correctly
  sees `sourceKey` values that migration only just set, not ones already
  persisted from a prior load.

### v5: `InventoryItem.category` — authored, never guessed, and required

Replaces `guessCategory`, a UI-only heuristic that used to live in
`InventoryTab.tsx` and infer a display category (for the "Add Item" filter
pills and icon) from proxy signals: `isArmor`, `slots === 0.5`, `"potion"`
in the name, `actionCost && formula`. Two bugs came from that: (1) a potion
is shaped like both a weapon (`actionCost` + `formula`) and a consumable
(`slots === 0.5`) — `guessCategory` checked consumable first so the
category filter was right, but the "Add Item" icon picker (a second,
independently-ordered copy of the same checks) checked the weapon shape
first, so potions rendered a sword icon in the consumables list; (2) a
`slots: 1`, formula-less single-use item like "Medical Kit (1 use)" or
"Torch" matched none of the proxy signals at all and fell through to
"gear", with no way to fix that short of changing what the item's
`slots`/`formula` actually are. `EquipmentCategory` (`"weapon" | "armor" |
"consumable" | "gear"`, `types/character.ts`) is now a required field on
`InventoryItem`, authored per entry in `BASIC_EQUIPMENTS` (see
`equipment.ts`'s file header for the contract, right next to
`sourceKey`/`catalogVersion`) instead of derived at a read site.
`InventoryTab.tsx` now has a single `CATEGORY_ICON` map
(`Record<EquipmentCategory, string>`) read directly off `item.category` for
both the filter and the icon — same source, so the two can no longer
disagree with each other the way the two heuristics did.
`copyItemFromCatalog`/`createCustomItem` (`catalogCopy.ts`) carry
`category` through the same way they already carry
`sourceKey`/`catalogVersion`/`isArmor`, except `category` is also set on a
CUSTOM item (via a "Category" `<select>` on `AddItemModal`'s custom-item
form, defaulting to `"gear"`) — unlike `sourceKey`/`catalogVersion`, which
are catalog-exclusive, `category` is required on every `InventoryItem`
regardless of where it came from.

- **Migration (`MIGRATIONS[4]`, v4 -> v5): backfills `category` on every
  `inventory` entry.** A non-custom entry with a `sourceKey` matching a
  current `BASIC_EQUIPMENTS` entry takes that entry's current `category`
  (matched by `sourceKey`, never by `name`, reusing the same
  collision-safe identity the v2 -> v3 migration already established — no
  new collision table needed). Everything else — a custom item, a
  non-custom item with no `sourceKey`, or a `sourceKey` that no longer
  matches anything (a retired catalog entry) — defaults to `"gear"`, the
  same catch-all `guessCategory` used to fall back to, now made an
  explicit, permanent decision instead of a guess recomputed on every
  render. Only `inventory` needed this migration: `CharacterAction`
  (spells/actions) has no equivalent display-category concept.
- **`catalogVersion` bumped on "Medical Kit (1 use)", "Torch", "Vial of
  Pitch", and "Ball of Spiders"** (1 → 2) when this field was added — the
  four entries whose authored `category` (`"consumable"`) differs from
  what the OLD heuristic would have produced (`"gear"` for all four, since
  none of them carry a `formula`, so neither the `slots === 0.5`/
  potion-name check nor the `actionCost && formula` weapon check ever
  matched). A player already holding one of these sees the "outdated"
  badge once. No other entry's heuristic-guessed category would have
  differed from its authored one, so no other `catalogVersion` was bumped
  for this change.

### Content batch: `spells.ts` rewritten for the 2nd printing (no schema bump)

`src/data/spells.ts` was fully rewritten against the Nimble Core Rules 2nd
printing, pp. 46-53, not just patched — every entry verified against the
book, not only the changes called out ahead of time. This didn't bump
`CURRENT_SCHEMA_VERSION` (it's a data-content change, not a shape change),
but it's recorded here because it happened in the same run of work as v4/v5
and produced two notable fixes:

- **`Entice`'s `1dstepdice(...)` die progression** was one size slot short
  of the book's 5-tier progression (base d4, then 4 named steps to
  d6/d8/d10/d12) — a level-20 Entice landed on d10, not the book's d12.
  `pickStepDiceSize` (`formulaParser.ts`) now supports either a 4-argument
  or a 5-argument size list; the 4-argument form stays supported for
  backward compatibility with anything already written against it.
  Entice's formula is now `1dstepdice(level,4,6,8,10,12)`.
- **`Updraft` lost its roll button.** The book's "Damage: 20 minus a DEX
  save" isn't a formula the caster rolls at all — it depends on the
  TARGET's own save result, which this app's character-centric formula
  engine (rolls are always computed from the roller's own stats) cannot
  express. `formula` is now `""` (was `"1d6"`, a previous-printing
  mechanic entirely replaced by this one). Its description states the
  full mechanic in prose since that's now the only place a player can
  read it.
- **`formula: ""` covers two genuinely different cases**, worth telling
  apart when reading this data even though both render identically (no
  roll button): (1) genuinely no damage/rollable value at all — the
  common case (e.g. Boisterous Winds, a pure buff, or any Utility
  cantrip); (2) a real mechanic the formula engine cannot express —
  currently only Updraft (above). Nothing in the data shape distinguishes
  the two; if that distinction ever needs to be surfaced in the UI, it
  needs a real signal (e.g. a flag next to `manualResolution`), not an
  inference from prose.

### v6 (shape half): `id` and `kind` added, `tokenId` removed

The full architectural story (why the vault exists, where it lives, the
recovery UI) is in CLAUDE.md's "Character vault" section and
`docs/vault-incidents.md`; this entry is scoped to the migration mechanics
alone, following this document's own established pattern.

- `id: string` (`crypto.randomUUID()`) is the character's new stable
  identity, independent of any token — it's the vault key and the value
  every token's `CharacterLink.characterId` points at.
- `kind: CharacterKind` (`"player" | "monster"`) defaults to `"player"` —
  nothing before this version had an opinion on it, and every character
  that existed before "monster" had a meaning was, definitionally,
  someone's player character.
- `tokenId` is gone. A character no longer knows which token(s) display
  it — this is also what permanently closes the copy-paste
  write-targeting bug (see `docs/vault-incidents.md`'s "The tokenId
  copy-paste bug"; a stored `tokenId` drifting out of sync with the item
  it actually lived on): the field simply doesn't exist anymore to drift.
- **This is the first migration in this chain that isn't just a shape
  transform.** `MIGRATIONS[5]` (`characterMigrations.ts`, pure, no OBR
  access) only fixes the character record's own shape — generates `id` if
  missing, defaults `kind`, drops `tokenId` — exactly like every migration
  before it. It does NOT, and structurally CANNOT, move a record's storage
  location (legacy per-token `METADATA_KEY` payload -> vault entry + token
  `CharacterLink`): a pure `Migration` function has no OBR access at all,
  and the storage move additionally needs `item.createdUserId` (an
  `ownerId` fallback) that only exists on the real `Item`, never in the
  stored data. That move is a separate, OBR-orchestrated step —
  `prepareLegacySheetMigration` (`characterVault.ts`, still pure —
  computes what to write) plus `useOBR.ts`'s `loadCharacterForToken`/
  `applyTokenLoadResult` (impure — performs the actual writes). See
  CLAUDE.md's "Character vault" section for why that step is the one
  background write in that whole subsystem still routed through
  `performWrite` instead of fired-and-logged like every other one there.

## Worked example: v6 to v7 (`keyStat` -> `keyStats`)

A second worked example, contrasted with v0 -> v1 above: this one is a
small, explicit, single-field transform — the shape every migration after
v0 -> v1 is supposed to be, per this document's own procedure.

Nimble's rulebook (Core Rules 2nd printing, p.55) gives every class TWO
"KEY" stats, and only the higher-valued one is ever actually used wherever
a formula references KEY. Before schema v7, `NimbleCharacter.keyStat` was
`keyof Stats | null` — a single slot that could only ever record one of
the two stats the rulebook actually grants. `MIGRATIONS[6]`:

```ts
(character) => {
  const rest: Record<string, unknown> = { ...character };
  delete rest.keyStat;
  return {
    ...rest,
    keyStats: typeof character.keyStat === "string" ? [character.keyStat] : [],
  };
},
```

Three cases, all handled by that one ternary: a record with `keyStat` set
to a real stat becomes a one-element `keyStats` array; a record with
`keyStat: null` (the default, unset state) becomes `[]`; a record that
predates `keyStat` entirely (never had the field) also becomes `[]`,
since `character.keyStat` is simply `undefined` there and `typeof
undefined === "string"` is `false`. `keyStats` is derived wholesale from
`keyStat`, never merged with anything already present — legitimate here
specifically because no record reaching this step could ever have had a
`keyStats` field before (it didn't exist until this version), unlike
`fillMissingFields`'s job at v0 -> v1, which has to cope with a genuinely
unbounded range of prior shapes.

`buildContext` (`formulaParser.ts`) resolves the new field with an
explicit empty-array guard rather than calling `Math.max()` unconditionally
— `Math.max()` with no arguments returns `-Infinity`, not `0`, which would
have silently broken the deliberate "KEY resolves to 0 when unset" contract
this project relies on elsewhere (see CLAUDE.md's Formula parser section on
why that failure must stay loud). The resolved max is never stored back
onto the character: stats change on level-up, and a cached max would
silently go stale the moment the previously-lower stat overtakes the other.

## Known limits of `validateCharacterShape`

Documented in that function's own JSDoc (`characterMigrations.ts`); repeated
here because they matter when deciding whether a change is safe:

- **No deep validation of array elements.** Fields like `actions` and
  `inventory` are only checked for being arrays, not for the shape of each
  entry. Their elements are polymorphic per `type`, and validating that
  generically from one template instance is exactly the problem this
  function exists to avoid.
- **No validation of enum-like values.** String fields with a fixed set of
  allowed values (`hitDice.dice`, `saveMods.str`, ...) are checked as
  `string`, not against their specific allowed values.
- **Nullable fields are not checked strictly.** `null` is accepted at any
  key regardless of what the template holds there, rather than hand-listing
  the handful of fields that are legitimately nullable (`flawStat`,
  `combat.initiativeResult`).
- **Optional fields absent from the template are not covered**, as noted
  above under step 2.

This is good enough for what it actually validates: the output of this
project's own migration chain, not arbitrary external data. If
`NimbleCharacter` grows substantially, or a sheet ever needs to come from
outside this app's own migration chain (a file import, a copy pasted
between scenes), the natural next step is a real schema library (Zod or
equivalent), deriving `NimbleCharacter` from the schema (`z.infer`) instead
of maintaining an interface and a template walk by hand. Two hand-maintained
descriptions of the same shape is exactly how `FLAW` (see the formula
parser section of CLAUDE.md) went undetected.

**This condition is no longer hypothetical as of schema v6.**
`resolveCharacterRead`'s `"rehydrate"` path (`characterVault.ts`) is exactly
"a sheet entering from outside this app's own migration chain" — a token's
`CharacterLink.snapshot`, copy-pasted between scenes, arriving at a vault
that has never validated it before.
