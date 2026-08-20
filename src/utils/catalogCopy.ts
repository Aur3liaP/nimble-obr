/**
 * @file Pure "construct an owned record" helpers for the Spells/Inventory
 * "Add" modals, plus the catalog-versioning helpers that build on the same
 * copy/template relationship — extracted out of `SpellsTab.tsx`/
 * `InventoryTab.tsx`/`CombatTab.tsx` specifically so this logic (notably,
 * that `sourceKey`/`catalogVersion` carry over from a catalog template and
 * are NEVER present on a custom entry, and that "outdated" is a version
 * comparison, never a text comparison) is unit-testable without rendering
 * React, same pattern/reasoning as `computeDefense.ts`/`initiative.ts`.
 *
 * Copy/create, one pair per (tab × mode) combination:
 * - {@link copySpellFromCatalog} / {@link createCustomSpell} — SpellsTab's
 *   `AddSpellModal`, "from list" vs "custom" mode.
 * - {@link copyItemFromCatalog} / {@link createCustomItem} — InventoryTab's
 *   `AddItemModal`, "from list" vs "custom" mode.
 *
 * `CombatTab`'s `AddActionModal` (melee/ranged/ability/item-type actions)
 * is NOT here: it has no catalog to copy from at all (see its own file
 * header, "Spells are added separately via the Spells tab's own modal") —
 * every action it creates is `isCustom: true` by construction, with no
 * template ever in scope to leak a `sourceKey`/`catalogVersion` from, so
 * there is no "copy" half to extract and nothing this file's contract
 * adds for it.
 *
 * Catalog-versioning ("outdated" badge / "reset to book version"), one
 * pair per catalog:
 * - {@link isOutdated} — shared by both catalogs (structurally typed, no
 *   construction involved, so genericizing it doesn't risk the
 *   "hand-copied logic drifts apart" failure mode the way duplicating a
 *   *construction* function would).
 * - {@link resetSpellToCatalog} / {@link resetItemToCatalog} — one per
 *   catalog, since each has to call its own type-specific copy function.
 */

import type { CharacterAction, InventoryItem, SpellSchool } from "../types/character";
import type { BASE_SPELLS } from "../data/spells";
import type { BASIC_EQUIPMENTS } from "../data/equipment";

type SpellTemplate = (typeof BASE_SPELLS)[number];
type ItemTemplate = (typeof BASIC_EQUIPMENTS)[number];

/**
 * Converts a {@link BASE_SPELLS} template into a concrete, non-custom
 * {@link CharacterAction}. Mana cost defaults to the spell's tier when not
 * explicitly set on the template (cantrips are always free). Carries
 * `sourceKey` AND `catalogVersion` from the template — this is the one and
 * only place a `CharacterAction` legitimately gets either.
 */
export function copySpellFromCatalog(template: SpellTemplate): CharacterAction {
  return {
    id: `sp-${crypto.randomUUID()}`,
    name: template.name,
    type: "spell",
    range: template.range,
    formula: template.formula,
    description: template.description,
    isFavorite: false,
    isCustom: false,
    sourceKey: template.sourceKey,
    catalogVersion: template.catalogVersion,
    spellTier: template.spellTier,
    spellSchool: template.spellSchool as SpellSchool | undefined,
    manaCost: template.manaCost ?? (template.spellTier === 0 ? 0 : template.spellTier),
    actionCost: template.actionCost,
  };
}

/** Local shape of `AddSpellModal`'s custom-form state. */
export interface CustomSpellForm {
  name: string;
  tier: number;
  manaCost: number;
  school: SpellSchool | "";
  range: string;
  formula: string;
  description: string;
}

/**
 * Builds a fully custom, player-authored {@link CharacterAction} from
 * `AddSpellModal`'s custom-form state. Never references a catalog template
 * — `sourceKey` is never set here, by construction, not by an explicit
 * omission that could be forgotten later.
 */
export function createCustomSpell(form: CustomSpellForm): CharacterAction {
  return {
    id: `sp-${crypto.randomUUID()}`,
    name: form.name,
    type: "spell",
    range: form.range,
    formula: form.formula,
    description: form.description,
    isFavorite: false,
    isCustom: true,
    spellTier: form.tier,
    spellSchool: (form.school as SpellSchool) || undefined,
    manaCost: form.tier === 0 ? 0 : form.manaCost,
  };
}

/**
 * Converts a {@link BASIC_EQUIPMENTS} template into a concrete, non-custom
 * {@link InventoryItem}. `isEquipped` is always freshly `false` regardless
 * of the template's own value (e.g. "Unarmed Strikes" defaults to
 * equipped in the catalog; a newly ADDED copy should not auto-equip).
 * Carries `sourceKey` AND `catalogVersion` from the template — the one and
 * only place an `InventoryItem` legitimately gets either.
 *
 * #12 — `crypto.randomUUID()`, same as {@link createCustomItem} below, so
 * IDs are uniformly collision-safe regardless of which mode an item was
 * added through (the "custom" form previously used `Date.now()`, which
 * could collide on a fast double-click).
 */
export function copyItemFromCatalog(template: ItemTemplate): InventoryItem {
  return {
    id: `i-${crypto.randomUUID()}`,
    name: template.name,
    description: template.description ?? "",
    slots: template.slots,
    quantity: 1,
    isEquipped: false,
    isFavorite: false,
    isCustom: false,
    isArmor: template.isArmor ?? false,
    formula: template.formula,
    manualResolution: template.manualResolution,
    sourceKey: template.sourceKey,
    catalogVersion: template.catalogVersion,
    actionCost: template.actionCost,
  };
}

/** Local shape of `AddItemModal`'s custom-form state. */
export interface CustomItemForm {
  name: string;
  description: string;
  slots: number;
  formula: string;
  isFavorite: boolean;
  isArmor: boolean;
}

/**
 * Builds a fully custom, player-authored {@link InventoryItem} from
 * `AddItemModal`'s custom-form state. Never references a catalog template
 * — `sourceKey` is never set here, by construction.
 */
export function createCustomItem(form: CustomItemForm): InventoryItem {
  return {
    id: `i-${crypto.randomUUID()}`,
    name: form.name,
    description: form.description,
    slots: form.slots,
    quantity: 1,
    isEquipped: false,
    isFavorite: form.isFavorite,
    isCustom: true,
    isArmor: form.isArmor,
    formula: form.formula || undefined,
  };
}

/**
 * True if a non-custom entry (spell or item — structurally typed, shared
 * by both catalogs) is outdated relative to the catalog: it has BOTH a
 * `sourceKey` and a `catalogVersion`, and the catalog entry currently
 * matching that `sourceKey` has a HIGHER `catalogVersion`.
 *
 * Deliberately never compares text. Descriptions are freely editable on
 * non-custom entries (a player's own note), so a text diff can't tell "the
 * book changed" apart from "the player wrote something" — only the DEV
 * declaring a version bump can. See `equipment.ts`/`spells.ts`'s file
 * headers for the `catalogVersion` contract.
 *
 * `false` (never an error) whenever there's nothing to compare:
 * - No `sourceKey` at all — a custom entry, or a copy that predates
 *   `sourceKey` and could never be traced back to the catalog (the v2 ->
 *   v3 migration's name-match backfill found nothing).
 * - No `catalogVersion` — predates this system entirely. Shouldn't happen
 *   for any entry that DOES have a `sourceKey` after the v3 -> v4
 *   migration backfills it, but checked anyway rather than assumed.
 * - `sourceKey` no longer exists in the CURRENT catalog (e.g. Greater
 *   Shadow, removed in the 2nd-printing spells batch) — there is no newer
 *   version to offer, so this is not "outdated," it's "gone." Not an
 *   error: a removed catalog entry is an expected, valid state, not a
 *   data-integrity problem to throw over.
 *
 * @param entry - A `CharacterAction` or `InventoryItem` (or any object
 * with the same two fields) to check.
 * @param catalog - `BASE_SPELLS` or `BASIC_EQUIPMENTS` — whichever catalog
 * `entry` was (or claims to have been) copied from.
 */
export function isOutdated(
  entry: { sourceKey?: string; catalogVersion?: number },
  catalog: readonly { sourceKey?: string; catalogVersion?: number }[],
): boolean {
  if (!entry.sourceKey || entry.catalogVersion === undefined) return false;
  const current = catalog.find((c) => c.sourceKey === entry.sourceKey);
  if (!current || current.catalogVersion === undefined) return false;
  return entry.catalogVersion < current.catalogVersion;
}

/**
 * Rebuilds a non-custom {@link CharacterAction} from its current catalog
 * template ("Reset to book version"): a plain overwrite, no diff view, no
 * attempt to preserve player edits — as decided, simplicity over
 * cleverness here. Only `id` and `isFavorite` are preserved (those belong
 * to the copy, not the template); everything else, including a fresh
 * `catalogVersion`, comes from {@link copySpellFromCatalog}.
 *
 * Callers are responsible for confirming with the player first (this
 * function does the overwrite, not the confirmation) and for only
 * offering this action when {@link isOutdated} is true.
 *
 * @param entry - The character's current copy, about to be overwritten.
 * @param catalog - `BASE_SPELLS`, searched by `entry.sourceKey`.
 * @returns The reset entry, or `entry` UNCHANGED if `sourceKey` doesn't
 * match anything in `catalog` — shouldn't happen if the caller only offers
 * this action when `isOutdated` is true (that already requires a match),
 * but this never throws or silently corrupts data if it's called anyway.
 */
export function resetSpellToCatalog(
  entry: CharacterAction,
  catalog: readonly SpellTemplate[],
): CharacterAction {
  const template = catalog.find((t) => t.sourceKey === entry.sourceKey);
  if (!template) return entry;
  return { ...copySpellFromCatalog(template), id: entry.id, isFavorite: entry.isFavorite };
}

/**
 * Same contract as {@link resetSpellToCatalog}, for a non-custom
 * {@link InventoryItem} against {@link BASIC_EQUIPMENTS}. Note that
 * "everything but `id`/`isFavorite` comes from the catalog" also resets
 * `isEquipped` (always `false` on a fresh copy, see
 * {@link copyItemFromCatalog}) and `quantity` (always `1`) — a deliberate
 * reading of "plain overwrite", not an oversight; the confirmation the
 * caller shows before calling this must say so.
 */
export function resetItemToCatalog(
  entry: InventoryItem,
  catalog: readonly ItemTemplate[],
): InventoryItem {
  const template = catalog.find((t) => t.sourceKey === entry.sourceKey);
  if (!template) return entry;
  return { ...copyItemFromCatalog(template), id: entry.id, isFavorite: entry.isFavorite };
}
