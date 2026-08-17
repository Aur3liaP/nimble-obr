/**
 * @file useSearchFilter — local search-box state plus case-insensitive
 * substring filtering over one or more text fields of a list.
 *
 * Shared by the 4 search boxes in InventoryTab and SpellsTab as of this
 * writing: the "add from list" pickers (over `BASIC_EQUIPMENTS`/
 * `BASE_SPELLS`) and the main list views (over the character's own
 * inventory/spells). Each call site ANDs this hook's `filtered` result
 * with its own additional filters (category, spell school, spell tier)
 * locally in its own `useMemo` — those differ per call site and are
 * deliberately NOT part of this hook, to avoid forcing every future
 * search box into one rigid shape.
 */

import { useMemo, useState } from "react";

/**
 * Whether `search` matches any of `fields`, case-insensitively. A blank
 * (empty or whitespace-only) `search` always matches.
 *
 * @remarks Exported standalone so this is unit-testable without rendering
 * a component or hook.
 * @param fields - Text fields to search, e.g. an item's name and
 * description. `undefined` entries are skipped rather than matching.
 * @param search - Current search box text.
 */
export function matchesSearch(
  fields: (string | undefined)[],
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

/**
 * @property search - Current search box text.
 * @property setSearch - Wire directly to the search input's `onChange`.
 * @property filtered - `items` narrowed to those matching `search`.
 */
export interface UseSearchFilterResult<T> {
  search: string;
  setSearch: (v: string) => void;
  filtered: T[];
}

/**
 * @param items - The full list to filter.
 * @param getFields - Returns the text fields of one item to search against
 * (e.g. `(item) => [item.name, item.description]`). Called for every item
 * on every recompute, so keep it cheap; declare it outside the component
 * body (or wrap in `useCallback`) if it needs a stable identity to avoid
 * recomputing `filtered` on every render.
 * @returns See {@link UseSearchFilterResult}.
 */
export function useSearchFilter<T>(
  items: T[],
  getFields: (item: T) => (string | undefined)[],
): UseSearchFilterResult<T> {
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () => items.filter((item) => matchesSearch(getFields(item), search)),
    [items, search, getFields],
  );
  return { search, setSearch, filtered };
}
