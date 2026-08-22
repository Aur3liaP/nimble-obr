/**
 * @file Pure decision logic for the character vault (scene-metadata storage
 * of {@link NimbleCharacter} records, keyed by {@link NimbleCharacter.id} —
 * see `characterStore.ts` for the actual OBR reads/writes).
 *
 * Everything here is a plain function with no `@owlbear-rodeo/sdk`
 * dependency, exactly like `characterMigrations.ts` and `formulaParser.ts` —
 * testable in isolation (`characterVault.test.ts`), and deliberately kept
 * separate from `characterStore.ts` (which touches OBR and therefore can't
 * be unit tested without mocking the SDK, which this project does not do —
 * see CLAUDE.md).
 */

import { migrateCharacter, type MigrationResult } from "./characterMigrations";
import type { CharacterLink, NimbleCharacter } from "../types/character";

/**
 * Outcome of resolving a token's read path: given the {@link CharacterLink}
 * stored on a token and whatever the vault currently holds for
 * `link.characterId` (or `null` if nothing does), decide what the caller
 * should show and whether anything needs writing back in the background.
 *
 * - `"use-vault"` — the normal case. The vault is the source of truth
 *   whenever it has an answer at all; `needsSnapshotRepair` says whether
 *   this token's own `snapshot`/`updatedAt` has fallen behind the vault
 *   (e.g. it missed a fan-out write — see `useOBR.ts`'s `updateCharacter`)
 *   and should be quietly rewritten to match, purely so a FUTURE copy-paste
 *   of this same token carries current data instead of a stale copy. This
 *   never affects what's shown right now — the vault character is used
 *   either way.
 * - `"rehydrate"` — the vault has never seen this `characterId` (a token
 *   copy-pasted into a scene whose vault doesn't hold it yet, or one whose
 *   own {@link CharacterLink} was just created). The token's own `snapshot`
 *   is the only copy of the data that exists anywhere, so it's promoted:
 *   run through `migrateCharacter` (a snapshot is expected to already be at
 *   {@link NimbleCharacter.schemaVersion} = current, but defense in depth
 *   costs nothing here, same reasoning as `characterStore.ts`'s own reads),
 *   then the caller writes the result into the vault.
 */
export type CharacterReadResolution =
  | { action: "use-vault"; character: NimbleCharacter; needsSnapshotRepair: boolean }
  | { action: "rehydrate"; migration: MigrationResult };

/**
 * Resolves a token's read path — the "coffre puis snapshot" order the vault
 * decoupling design specifies: the vault wins whenever it has this
 * character at all, the token's own snapshot is only ever consulted when
 * the vault doesn't.
 *
 * @param link - The {@link CharacterLink} read from the token's metadata.
 * @param vaultCharacter - The result of looking `link.characterId` up in
 * the vault (`characterStore.ts`'s `loadCharacter`), or `null` if nothing is
 * stored there for that id.
 */
export function resolveCharacterRead(
  link: CharacterLink,
  vaultCharacter: NimbleCharacter | null,
): CharacterReadResolution {
  if (vaultCharacter) {
    return {
      action: "use-vault",
      character: vaultCharacter,
      needsSnapshotRepair: vaultCharacter.updatedAt > link.updatedAt,
    };
  }
  return { action: "rehydrate", migration: migrateCharacter(link.snapshot) };
}

/**
 * Outcome of {@link prepareLegacySheetMigration}.
 *
 * Mirrors {@link MigrationResult} exactly (`"ok" | "unsupported" | "invalid"`)
 * except the `"ok"` branch carries both the migrated character AND the
 * {@link CharacterLink} to write onto the token, since preparing one
 * necessarily prepares the other (the link's `snapshot` is just the
 * character itself).
 */
export type LegacySheetMigrationResult =
  | { status: "ok"; character: NimbleCharacter; link: CharacterLink }
  | { status: "unsupported"; foundVersion: number }
  | { status: "invalid"; reason: string };

/**
 * Prepares the one-time move of a character record OUT of the legacy
 * per-token `METADATA_KEY` storage location and into the vault-plus-link
 * shape, without performing any OBR write itself — see `useOBR.ts` for the
 * write side (token link written before the vault entry, deliberately; see
 * that call site's comment for why).
 *
 * Runs the raw stored value through the existing {@link migrateCharacter}
 * chain first, which — as of schema v6 — already generates `id` and
 * defaults `kind` to `"player"` as part of its normal v5 -> v6 step; this
 * function's own, additional job is only the `ownerId` fallback below, which
 * needs information (`fallbackOwnerId`) `migrateCharacter` itself has no
 * access to.
 *
 * @param rawSheet - The raw value found at `item.metadata[METADATA_KEY]`.
 * @param fallbackOwnerId - `item.createdUserId`, the OBR-native "who placed
 * this token" fact — the last moment this app can ever recover an owner for
 * a record whose own `ownerId` is empty (a genuinely ancient record that
 * predates the claim system), since leaving item metadata behind means this
 * app permanently loses the ability to ask an item who created it. Only
 * used when the migrated character's own `ownerId` is empty — a record that
 * already has one (the overwhelmingly common case, since `ownerId` has
 * existed since long before this migration) keeps it untouched.
 */
export function prepareLegacySheetMigration(
  rawSheet: unknown,
  fallbackOwnerId: string,
): LegacySheetMigrationResult {
  const migrated = migrateCharacter(rawSheet);
  if (migrated.status !== "ok") return migrated;

  const character = migrated.character.ownerId
    ? migrated.character
    : { ...migrated.character, ownerId: fallbackOwnerId };

  const link: CharacterLink = {
    characterId: character.id,
    snapshot: character,
    updatedAt: character.updatedAt,
  };
  return { status: "ok", character, link };
}

/**
 * Returns every character in `characters` that no token currently links to.
 *
 * Shared by two consumers that need the exact same computation for
 * different `kind`s: `useOBR.ts`'s orphaned-monster cleanup pass (filters
 * the result to `kind: "monster"` and deletes them — a monster has no
 * existence independent of a token) and the future "Recover a lost soul"
 * recovery UI (filters to `kind: "player"` and offers them for re-linking).
 * Kept kind-agnostic here so that shared computation can't drift between
 * the two call sites the way two independently hand-copied checks have
 * drifted before elsewhere in this codebase (see the `guessCategory`
 * history in CLAUDE.md) — each caller's own filter is the only thing that
 * differs.
 *
 * @param characters - Every character currently in the vault
 * (`characterStore.ts`'s `listCharacters`).
 * @param linkedCharacterIds - Every `characterId` currently referenced by a
 * token's {@link CharacterLink} in the scene.
 */
export function findOrphanedCharacters(
  characters: NimbleCharacter[],
  linkedCharacterIds: Iterable<string>,
): NimbleCharacter[] {
  const linked = new Set(linkedCharacterIds);
  return characters.filter((character) => !linked.has(character.id));
}

/**
 * Filters a list of orphaned characters down to the ones `viewerId` is
 * allowed to see in the "Retrieve a lost soul" recovery UI: their own
 * (`ownerId === viewerId`), or, for the GM, all of them — mirroring the
 * ownership rule `useOBR.ts`'s `canEdit`/`isOwner` already apply to an
 * already-selected sheet, applied here one step earlier, to the LISTING
 * itself, so a player never even sees another player's lost character to
 * begin with.
 *
 * @remarks A character with no valid `ownerId` (empty string — possible
 * after the schema v5 -> v6 legacy migration, when neither the old record
 * nor `item.createdUserId` had an owner to fall back to; see
 * `prepareLegacySheetMigration`) falls through to the GM ONLY, never to any
 * player — this is a direct, deliberate consequence of the exact-match
 * filter below (`ownerId === viewerId`; a real OBR player id is never an
 * empty string, so an empty `ownerId` can never match one), not a special
 * case handled separately. Keeps a genuinely ownerless record recoverable
 * by the GM rather than permanently invisible to everyone, without handing
 * it to whichever player happens to click first.
 *
 * @param characters - Orphaned characters to filter, e.g. the result of
 * {@link findOrphanedCharacters}.
 * @param viewerId - The current player's OBR id.
 * @param isGM - Whether the current player has the GM role.
 */
export function filterRecoverableCharacters(
  characters: NimbleCharacter[],
  viewerId: string,
  isGM: boolean,
): NimbleCharacter[] {
  if (isGM) return characters;
  return characters.filter((character) => character.ownerId === viewerId);
}

/**
 * The full "Retrieve a lost soul" list computation in one place: orphaned
 * (no linked token) AND `kind: "player"` AND visible to `viewerId`. Kept as
 * one function specifically because `useOBR.ts` needs to run this exact
 * pipeline from two different call sites (first entering the no-sheet
 * screen, and reacting to a live link-set change while it's already
 * showing) — combining `findOrphanedCharacters` + the `kind` filter +
 * `filterRecoverableCharacters` here means those two call sites can't
 * apply the three filters in a different order, or forget one, the way two
 * independently hand-copied checks have drifted before elsewhere in this
 * codebase (see the `guessCategory` history in CLAUDE.md).
 *
 * @param characters - Every character currently in the vault.
 * @param linkedCharacterIds - Every `characterId` currently referenced by a
 * token's {@link CharacterLink} in the scene.
 * @param viewerId - The current player's OBR id.
 * @param isGM - Whether the current player has the GM role.
 */
export function visibleRecoverableCharacters(
  characters: NimbleCharacter[],
  linkedCharacterIds: Iterable<string>,
  viewerId: string,
  isGM: boolean,
): NimbleCharacter[] {
  const orphans = findOrphanedCharacters(characters, linkedCharacterIds).filter(
    (character) => character.kind === "player",
  );
  return filterRecoverableCharacters(orphans, viewerId, isGM);
}

/**
 * Order-independent comparison key for a set of characterIds — lets
 * `useOBR.ts` cheaply detect "did the set of linked tokens actually
 * change" (a single, lightweight item read) before paying for a full
 * vault read to recompute {@link visibleRecoverableCharacters}. `items.
 * onChange` fires on every token move, not just a link change; without
 * this pre-check, a dragged token would trigger a vault read on every
 * single frame of the drag for anyone currently looking at the "no sheet"
 * screen.
 *
 * Deduplicated and sorted so the same underlying set always produces the
 * same key regardless of iteration/discovery order.
 */
export function linkedCharacterIdsSignature(characterIds: Iterable<string>): string {
  return [...new Set(characterIds)].sort().join(",");
}
