# Character vault: incidents and design history

Diagnostic record behind the schema-v6 character vault (`characterStore.ts`,
`characterVault.ts`, `useOBR.ts`). The still-binding constraints these
incidents produced are listed in CLAUDE.md's "Character vault" section —
this document is the "why," kept for anyone re-touching this area who needs
the full story rather than just the rule.

## Room metadata: measured and rejected

Before scene metadata was chosen as the vault's home, room metadata was
seriously considered — it would have let a character follow a player across
scenes automatically. It was measured and rejected instead.

A realistic, half-filled real character (`worstCaseCharacterFixture.ts`,
built from the actual `BASE_SPELLS`/`BASIC_EQUIPMENTS` catalogs and
`catalogCopy.ts`, not a hand-typed idealization) weighs 7.44 KB. OBR's room
metadata has a 16 KB budget **shared across every extension installed in
the room**, not a per-extension allowance — a single non-trivial character
would already consume most of that shared ceiling by itself, before
counting any other extension's own data or a second character. Scene
metadata has no such cross-extension sharing concern for this app's
purposes, which is why it was chosen instead.

The measurement tooling (`src/utils/metadataSizing.ts`,
`scripts/measure-room-metadata.ts`, and the report they produced) stays in
the repo as the record of that decision, even though nothing in the app
actually writes to room metadata.

## Two rate-limit incidents

Both found via real multi-client OBR testing, not reproducible in this
project's Vitest suite (which doesn't mock the OBR SDK).

**1. Continuous-edit controls committing once per tick instead of once per
gesture.** `DraggableBar`'s keyboard-arrow path (OS key-repeat) and
`InlineNumberField`'s native spinner/mouse-wheel both fired a real OBR write
on every single tick. Tolerable before the vault change doubled write
volume per save (vault + fan-out); enough on its own to trip OBR's rate
limit once it was. Fixed with `useDebouncedCommit`
(`src/hooks/useDebouncedCommit.ts`) — its actual timing logic lives in a
plain, non-React `DebouncedCommit` class specifically so it's unit-testable
with fake timers, since this project has no hook-rendering test utility.
`InlineEditField`'s plain text fields are deliberately NOT debounced —
per-keystroke commit for prose is an existing, deliberate design choice
(see CLAUDE.md's "Structural constraints" section), unrelated to this fix.

**2. A stale-snapshot repair retriggering itself during a sustained burst of
edits.** The repair (fired unconditionally every time `resolveCharacterRead`
detected a stale snapshot) kept re-attempting: the vault moved to a newer
`updatedAt` faster than a single repair round trip could land, so every
subsequent `items.onChange` tick during the burst attempted another repair.
Fixed with `maybeRunRepair`'s guard (`useOBR.ts`): at most one repair in
flight per token, plus an exponential backoff after a failure (base 3s,
doubling, capped at 60s) — both required, neither alone was enough in
testing.

## Recovery UI (`NoSheetPanel.tsx`)

"Create a sheet" always shows; "Retrieve a lost soul" shows only when the
vault holds a character this viewer is allowed to recover.

`orphanedCharacters` (`useOBR.ts` state) is `"player"`-kind vault characters
with no linking token, filtered by ownership
(`visibleRecoverableCharacters`/`filterRecoverableCharacters` in
`characterVault.ts`, tested): a non-GM player sees only their own
(`ownerId` exact match); the GM sees everything, including a character with
no valid `ownerId` at all — a direct, deliberate consequence of the
exact-match filter (an empty `ownerId` can never match a real player id),
not a special case handled separately, which is what keeps a genuinely
ownerless record (possible after the legacy migration, if neither the old
record nor `item.createdUserId` had an owner) recoverable by the GM rather
than permanently invisible to everyone.

Refreshed in full the moment the no-sheet screen appears, and kept live two
different ways while it's showing: `onMetadataChange` (a vault change
anywhere) and `items.onChange`'s own linked-id-set signature check (catches
a token being deleted/relinked elsewhere, which touches no vault key at all
and so never reaches `onMetadataChange`) — this second path costs nothing
when nobody's looking at this screen, since it's the same listener CLAUDE.md's
"Character vault" section already documents a short-circuit for. Known,
accepted residual gap: a pure token deletion with no accompanying vault
write (the common case for a `"player"`-kind token) is covered by the
`items.onChange` path specifically, not `onMetadataChange` — item metadata
and scene metadata are genuinely separate OBR channels.

The recovery list itself: a name filter above 10 entries (`useSearchFilter`,
the same hook already shared by Inventory/Spells, not a new one), a
height-capped, internally-scrolling list, and a Back button pinned above it
rather than below — a trailing Back button was unreachable without
scrolling through the whole list first once a real test vault had enough
entries. No delete action in this list: a destructive button with no
confirmation, no undo, and entries that can be visually indistinguishable
(two same-named, same-level characters — a real case, not hypothetical) is
deferred to its own batch, ideally alongside the JSON export this project
doesn't have yet.

## The tokenId copy-paste bug

Before schema v6, `NimbleCharacter` carried a `tokenId` field recording
which token the character belonged to. It could drift out of sync with the
item it actually lived on — a token gets copy-pasted, or a sheet gets
reassigned, and the stored `tokenId` stops matching the token actually
holding that metadata. Because writes were targeted using that stored
field, a drifted `tokenId` meant a write could silently land on, or be
attributed to, the wrong token.

`performWrite`'s debounced post-write existence check
(`scheduleExistenceCheck`, since removed) existed largely because of the
consequences of this class of bug — before v6, a vanished or mismatched
token meant vanished or misdirected data, and OBR gives no rejection when
`OBR.scene.items.updateItems` silently no-ops. Schema v6 closes the bug at
the root: `tokenId` is gone from `NimbleCharacter` entirely (see
`docs/schema-migrations.md`'s "Version history: v2 to v6", v6 entry) — a
character no longer stores which token it belongs to at all, so there is no
longer a field that can drift. `performWrite` itself was deliberately left
otherwise intact when v6 shipped (pending/offline/sticky-error/retry
mechanics unchanged) rather than restructured, specifically because it was
the layer that had caught this bug's symptoms and a wider rewrite risked
degrading it.

The same underlying shape — an identity read from a source that isn't
fresh yet — recurred once more after v6, in `switchToMonster`/
`switchToPlayer`; see CLAUDE.md's "Character vault" section, "Recurring bug
shape," for that constraint.
