/**
 * @file Pure array helpers behind the delete-undo affordance (see
 * `useDeleteUndo`). Kept free of React and the OBR SDK, like
 * `formulaParser.ts`/`characterMigrations.ts`, so they're covered by the
 * same plain-function Vitest suite instead of needing an OBR-mocked test.
 *
 * `character.actions` (spells and combat actions share this one array,
 * filtered by `type` at display time in SpellsTab/CombatTab) and
 * `character.inventory` are both plain arrays of objects with a stable
 * `id`, so "find it, remove it, remember where it was" and "put it back"
 * are generic over both rather than duplicated per array.
 */

/**
 * @property entry - The removed element itself.
 * @property index - The index the element held in the array passed to
 * {@link removeEntryById} — the FULL underlying array (e.g.
 * `character.actions`), never a filtered/displayed subset (e.g.
 * SpellsTab's spells-only list, CombatTab's non-spell list). Reinserting at
 * an index computed against a filtered view would land in the wrong slot
 * of the real array — see {@link reinsertEntry}.
 */
export interface RemovedEntry<T> {
  entry: T;
  index: number;
}

/**
 * Finds the element with the given `id` in `array`, and returns both it
 * (with its index) and the array with it removed.
 *
 * @param array - The full source array. Must be the actual stored array
 * (`character.actions`/`character.inventory`), not a filtered view built
 * for display — see {@link RemovedEntry.index}.
 * @param id - The `id` of the element to remove.
 * @returns `null` if no element with that `id` exists — the caller's
 * signal to no-op rather than act on a stale or already-deleted target
 * (e.g. a duplicate delete click racing the first one).
 */
export function removeEntryById<T extends { id: string }>(
  array: T[],
  id: string,
): { removed: RemovedEntry<T>; next: T[] } | null {
  const index = array.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const next = [...array.slice(0, index), ...array.slice(index + 1)];
  return { removed: { entry: array[index], index }, next };
}

/**
 * Reinserts `entry` at `index` into `array`.
 *
 * @param array - The array to insert into. Callers should pass the array's
 * *current* value, read fresh at call time rather than a snapshot taken
 * when the entry was removed, so concurrent edits from other clients since
 * then aren't clobbered (see `useDeleteUndo.undo`).
 * @param entry - The element to reinsert, as previously returned by
 * {@link removeEntryById}.
 * @param index - The position to reinsert at, clamped into
 * `[0, array.length]` so a stale index (the array shrank due to unrelated
 * concurrent edits since the entry was removed) still produces a valid
 * insert instead of throwing or silently dropping the entry.
 */
export function reinsertEntry<T>(array: T[], entry: T, index: number): T[] {
  const clamped = Math.min(Math.max(index, 0), array.length);
  return [...array.slice(0, clamped), entry, ...array.slice(clamped)];
}
