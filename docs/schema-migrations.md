# Schema migrations

How `NimbleCharacter`'s stored shape is versioned and migrated. For the
mechanical rules (dos and don'ts for an agent editing this code), see
CLAUDE.md's "Schema versioning" section and the JSDoc in
`src/utils/characterMigrations.ts`. This document explains how the system
works and why, for a human reading the codebase.

## The problem

A character sheet is stored as-is in a single OBR scene item's metadata
(`NimbleCharacter`, `src/types/character.ts`), with no expiry: it exists for
as long as the token does, which can be months. The shape of
`NimbleCharacter` has already changed more than once and will keep changing.
Before this system existed, nothing recorded which shape a given stored
record was written against: JavaScript accepts a missing field silently
until something reads it, so an old record with an outdated shape would only
fail once the app tried to use the field it lacked.

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
  a token, `loadCharacterFromItem` (`useOBR.ts`) reads the stored record,
  runs it through `migrateCharacter`, and if the caller currently holds
  `canEdit`, a dedicated effect writes the migrated record back to the
  item's metadata so the stored `schemaVersion` catches up.
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
    createDefaultCharacter("", "") as unknown as Record<string, unknown>,
  ),
```

`fillMissingFields` deep-merges a stored record onto a fresh
`createDefaultCharacter()` template: every key already present in the
record (checked with `in`, not truthiness, so a real `0`, `""`, `false`, or
existing `null` is kept, not mistaken for "missing") is kept as-is, and only
a key genuinely absent is filled in from the template, recursing into
matching sub-objects (`hp`, `stats`, `armor`, `combat`, ...).

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
  the handful of fields that are legitimately nullable (`keyStat`,
  `flawStat`, `combat.initiativeResult`).
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
