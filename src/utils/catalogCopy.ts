/**
 * @file Pure "construct an owned record" helpers for the Spells/Inventory
 * "Add" modals — extracted out of `SpellsTab.tsx`/`InventoryTab.tsx`
 * specifically so the shape of what gets constructed (notably, that
 * `sourceKey` carries over from a catalog template, and is NEVER present
 * on a custom entry) is unit-testable without rendering React, same
 * pattern/reasoning as `computeDefense.ts`/`initiative.ts`.
 *
 * Four functions, one per (tab × mode) combination:
 * - {@link copySpellFromCatalog} / {@link createCustomSpell} — SpellsTab's
 *   `AddSpellModal`, "from list" vs "custom" mode.
 * - {@link copyItemFromCatalog} / {@link createCustomItem} — InventoryTab's
 *   `AddItemModal`, "from list" vs "custom" mode.
 *
 * `CombatTab`'s `AddActionModal` (melee/ranged/ability/item-type actions)
 * is NOT here: it has no catalog to copy from at all (see its own file
 * header, "Spells are added separately via the Spells tab's own modal") —
 * every action it creates is `isCustom: true` by construction, with no
 * template ever in scope to leak a `sourceKey` from, so there is no
 * "copy" half to extract and nothing this file's contract adds for it.
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
 * `sourceKey` from the template — this is the one and only place a
 * `CharacterAction` legitimately gets one.
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
 * Carries `sourceKey` from the template — the one and only place an
 * `InventoryItem` legitimately gets one.
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
