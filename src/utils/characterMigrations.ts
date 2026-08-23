/**
 * @file Schema versioning and migration for `NimbleCharacter` records
 * persisted in OBR item metadata.
 *
 * Pure TypeScript, no OBR dependency, like `formulaParser.ts` — testable in
 * isolation, same discipline (`characterMigrations.test.ts`).
 *
 * ## Procedure to add a migration
 *
 * 1. Change `NimbleCharacter` in `types/character.ts`.
 * 2. Bump `CURRENT_SCHEMA_VERSION` in `types/character.ts` by exactly 1.
 * 3. Append exactly one function to `MIGRATIONS` below that transforms a
 *    record from the old shape to the new one. `MIGRATIONS[i]` must
 *    transform version `i` to version `i + 1` — `migrateCharacter` applies
 *    them in order, one step at a time, from a record's own `schemaVersion`
 *    up to `CURRENT_SCHEMA_VERSION`. Never write a migration that jumps more
 *    than one version.
 * 4. Leave every earlier migration function alone. A migration function is
 *    a permanent, append-only record of what changed between two versions,
 *    not something to go back and edit — a record still sitting at that old
 *    version needs it to keep doing exactly what it always did.
 *
 * `MIGRATIONS.length === CURRENT_SCHEMA_VERSION` is enforced by a test.
 * Forgetting step 2 or step 3 fails the suite immediately, instead of
 * silently shipping a record that can never reach `CURRENT_SCHEMA_VERSION`
 * (array too short) or a version bump with no transform to get there (array
 * too long).
 */

import {
  createDefaultCharacter,
  CURRENT_SCHEMA_VERSION,
  type NimbleCharacter,
} from "../types/character";
import { BASIC_EQUIPMENTS } from "../data/equipment";
import { BASE_SPELLS } from "../data/spells";

/**
 * Transforms a character record one schema version forward: from the
 * version at array index `i` to `i + 1`. Operates on loosely-typed data on
 * purpose — the input is whatever shape actually got persisted at that old
 * version, which by definition does not match the current
 * `NimbleCharacter` interface (that's exactly why it needs migrating).
 */
type Migration = (character: Record<string, unknown>) => Record<string, unknown>;

/**
 * Type guard for a plain data object (not `null`, not an array) — the
 * shape {@link fillMissingFields} recurses into.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges `record` onto `template`, field by field: every key present
 * in `record` is kept exactly as-is — presence is checked with `in`, never
 * by truthiness, so a legitimate `0`, `""`, `false`, or already-present
 * `null` survives this merge instead of being mistaken for "missing" and
 * overwritten by the default — and only a key genuinely absent from
 * `record` is filled in from `template`. Descends into matching
 * plain-object sub-trees on both sides (`hp`, `stats`, `skills`, `defense`,
 * `combat`, ...) so a sub-object missing just one field doesn't lose the
 * rest of its real data to the default. Arrays and primitives are never
 * merged piecewise: if the key is present at all, `record`'s value for it
 * is taken wholesale.
 *
 * `template` is expected to be {@link createDefaultCharacter}'s own return
 * value, cast loosely — same reasoning as {@link validateCharacterShape}:
 * every field that function returns is forced to exist by the compiler, so
 * this can't fall out of sync with `NimbleCharacter`'s required fields the
 * way a hand-written list of "fields that might be missing" could.
 *
 * @remarks Deliberately used only by the v0 -> v1 migration below. See the
 * comment on `MIGRATIONS[0]` for why a fully generic backfill is
 * legitimate there specifically, and not a pattern to reuse for later
 * migrations.
 */
function fillMissingFields(
  record: Record<string, unknown>,
  template: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...record };
  for (const key of Object.keys(template)) {
    if (!(key in record)) {
      result[key] = template[key];
      continue;
    }
    const recordValue = record[key];
    const templateValue = template[key];
    if (isPlainObject(recordValue) && isPlainObject(templateValue)) {
      result[key] = fillMissingFields(recordValue, templateValue);
    }
    // else: key already present on record — keep it exactly as-is, falsy
    // or not, rather than falling through to template's value.
  }
  return result;
}

/**
 * `damage` values that mean "no formula", carried over verbatim from an old
 * `CharacterAction.damage` field now removed from the schema (see
 * `MIGRATIONS[1]` below): `""` (never set), `"0"` (no damage, e.g. True
 * Strike, Ice Disk), `"Special"` (damage too situational to express as a
 * formula, e.g. Dragonform before part 1b blanked it). None of these are
 * real formula text — merging one into `formula` would make a
 * non-rollable spell rollable and show a bogus 0, a direct regression.
 */
const PLACEHOLDER_DAMAGE = new Set(["", "0", "Special"]);

/**
 * Drops the old `damage` field from one `actions` array element, preferring
 * the existing `formula` when present. Part of `MIGRATIONS[1]` — see its
 * comment for the full rationale.
 *
 * A real character's `actions` are frozen copies of whatever spell/action
 * data existed when they were added, not live references to
 * `src/data/spells.ts` — so a character who added a spell before `damage`
 * was removed from the schema still has both fields sitting in their
 * persisted metadata, independent of what the current game data looks
 * like. `damage` is only ever used here as a fallback, and only when
 * `formula` is empty AND `damage` is not one of {@link PLACEHOLDER_DAMAGE}
 * — the "game data guard" test in `formulaParser.test.ts` (removed
 * alongside `damage` itself) already confirmed no entry in `spells.ts`
 * ships in that shape, so this branch should never fire for official
 * content; it exists only to not silently drop a real formula from a
 * hand-edited or otherwise unusual character record, logging loudly if it
 * ever does.
 *
 * @param action - One raw `actions` array element, of unknown shape.
 */
function migrateActionDamageField(action: unknown): unknown {
  if (!isPlainObject(action)) return action; // not our problem — validateCharacterShape reports it
  const { damage, ...rest } = action;
  const existingFormula = typeof action.formula === "string" ? action.formula : "";
  if (existingFormula) return { ...rest, formula: existingFormula };

  const damageText = typeof damage === "string" ? damage : "";
  if (damageText && !PLACEHOLDER_DAMAGE.has(damageText)) {
    console.warn(
      `[migrateCharacter] action "${String(action.name ?? "?")}" has an empty formula but a ` +
        `non-placeholder damage ("${damageText}") — using damage as formula. This should not ` +
        `happen for official content (see the removed "game data guard" test); if you see this ` +
        `for real, the character's data is unusual and worth investigating.`,
    );
    return { ...rest, formula: damageText };
  }
  return { ...rest, formula: existingFormula }; // "" — genuinely not rollable
}

/**
 * Re-applies `manualResolution` to one `inventory` array element by
 * matching its `name` against {@link BASIC_EQUIPMENTS}, for non-custom
 * items only. Part of `MIGRATIONS[1]` — see its comment for why this
 * backfill is needed at all.
 *
 * Driven off `BASIC_EQUIPMENTS` itself, not a hardcoded name list — same
 * reasoning as the reflective test in `formulaParser.test.ts` that
 * verifies the flag is honored: a future equipment entry that sets
 * `manualResolution` is covered automatically, nothing here needs updating
 * when the data changes.
 *
 * @remarks Latent hazard, not yet a real bug: `name` is the only key this
 * (and the item picker) matches on. This step only runs once per record,
 * the moment it crosses from schemaVersion 1 to 2 — but that moment can
 * happen long after this code shipped (a character claimed and migrated
 * for the first time much later), against whatever `BASIC_EQUIPMENTS`
 * looks like AT THAT TIME, not what it looked like when the item was
 * originally added to the character. If a `BASIC_EQUIPMENTS` entry is
 * renamed and the OLD name is reused for a mechanically different item —
 * exactly what the 2nd-printing content batch does: "Spear" (1d10+STR)
 * renamed to "Great Spear", then a new, unrelated "Spear" (1d6+STR)
 * added — a character whose inventory has an old-shaped "Spear" (really a
 * Great Spear) migrates through this step matching the NEW, unrelated
 * "Spear" template instead. Harmless today only because neither template
 * in that specific collision sets `manualResolution: true`; this WILL
 * silently misapply the flag the day a rename or name-reuse collides with
 * a `manualResolution: true` entry. If that happens, match on something
 * more stable than `name`, or stop reusing a retired item name at all.
 *
 * @param item - One raw `inventory` array element, of unknown shape.
 */
function migrateInventoryManualResolution(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  if (item.isCustom === true) return item; // never touch custom items
  const name = typeof item.name === "string" ? item.name : undefined;
  const template = name !== undefined
    ? BASIC_EQUIPMENTS.find((e) => e.name === name)
    : undefined;
  if (!template) return item; // no matching official entry — leave manualResolution as-is

  const rest: Record<string, unknown> = { ...item };
  delete rest.manualResolution;
  return template.manualResolution === true
    ? { ...rest, manualResolution: true }
    : rest; // omit the key entirely, matching BASIC_EQUIPMENTS' own convention (unset, never false)
}

/**
 * Renames the `armor` top-level field to `defense` (Nimble Core Rules 2nd
 * printing renames the hero stat "Armor" to "Defense" — "Armor" now refers
 * exclusively to worn equipment, unaffected by this rename). Part of
 * `MIGRATIONS[1]` — see its comment for why this is folded into the same
 * step as `initiativeAdvantage` rather than its own version bump.
 *
 * If `armor` is absent from the record entirely (a genuinely ancient
 * record that never had the field at all — nothing shipped `defense` at
 * any earlier version, so a record with `defense` already present but no
 * `armor` isn't a real-world case), whatever `MIGRATIONS[0]` already
 * backfilled onto `defense` (from the current, already-renamed
 * `createDefaultCharacter()` template) is left untouched rather than
 * overwritten with an empty object.
 *
 * @param character - The record being migrated, still keyed by `armor` if
 * it has one at all.
 */
function migrateArmorToDefense(
  character: Record<string, unknown>,
): Record<string, unknown> {
  const { armor, ...rest } = character;
  if (armor === undefined) return character;

  const armorObj: Record<string, unknown> = isPlainObject(armor) ? armor : {};
  return {
    ...rest,
    defense: {
      equippedItemId: armorObj.equippedItemId,
      defenseBonus: typeof armorObj.defenseBonus === "number" ? armorObj.defenseBonus : 0,
    },
  };
}

/**
 * Known rename-collisions where matching a persisted item purely by `name`
 * against the CURRENT catalog would resolve to the WRONG entry, because
 * the old name has been reused for a mechanically different item since the
 * character's copy was made. Part of `MIGRATIONS[2]` (`sourceKey`
 * backfill) — see {@link resolveEquipmentTemplate}.
 *
 * Each row: the `name` an existing item might still carry, the `formula`
 * that confirms it's really the OLD, renamed entry (not the new item that
 * now owns that name — a plain name match can't tell the two apart, but
 * their formulas differ), and the `sourceKey` to resolve to instead of
 * whatever currently owns that name.
 *
 * Currently one entry: the 2nd-printing equipment content batch renamed
 * "Spear" (`1d10 + STR`, Reach 2) to "Great Spear" and introduced a new,
 * unrelated, lighter "Spear" (`1d6 + STR`). An existing character's
 * "Spear" item with the OLD formula is really a Great Spear.
 *
 * Append-only, like `sourceKey` itself: a future rename that reuses a
 * retired name gets its own row here, never edits or removes this one.
 */
const KNOWN_EQUIPMENT_NAME_COLLISIONS: { name: string; formula: string; sourceKey: string }[] = [
  { name: "Spear", formula: "1d10 + STR", sourceKey: "great-spear" },
];

/**
 * Resolves a non-custom inventory item's catalog template for the
 * `sourceKey`/`manualResolution` backfill in `MIGRATIONS[2]`: the known
 * rename-collision table first (formula-verified, so a plain name match
 * that would land on the wrong, name-reusing entry is caught), a plain
 * name lookup otherwise.
 *
 * @returns The matching `BASIC_EQUIPMENTS` template, or `undefined` if
 * nothing matches — a valid "cannot be traced to the catalog" outcome the
 * caller must not paper over with a guess.
 */
function resolveEquipmentTemplate(
  name: string,
  formula: string | undefined,
): (typeof BASIC_EQUIPMENTS)[number] | undefined {
  const collision = KNOWN_EQUIPMENT_NAME_COLLISIONS.find(
    (c) => c.name === name && c.formula === formula,
  );
  if (collision) {
    console.warn(
      `[migrateCharacter] inventory item "${name}" (formula "${formula}") matched a known ` +
        `rename collision — resolving to sourceKey "${collision.sourceKey}" instead of ` +
        `whichever catalog entry is currently named "${name}".`,
    );
    return BASIC_EQUIPMENTS.find((e) => e.sourceKey === collision.sourceKey);
  }
  return BASIC_EQUIPMENTS.find((e) => e.name === name);
}

/**
 * Backfills `sourceKey` (see `equipment.ts`'s file header for what it is
 * and why) on one non-custom `inventory` array element, using
 * {@link resolveEquipmentTemplate}. Also re-applies `manualResolution`
 * using that SAME, collision-safe resolution — superseding, for any
 * record reaching this step, whatever `migrateInventoryManualResolution`
 * (`MIGRATIONS[1]`, name-only, frozen and left untouched per this file's
 * append-only rule) got wrong on a name collision it had no way to detect.
 * Part of `MIGRATIONS[2]` — see its own comment for the full picture.
 *
 * @param item - One raw `inventory` array element, of unknown shape.
 */
function backfillInventorySourceKey(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  if (item.isCustom === true) return item; // never touch custom items
  const name = typeof item.name === "string" ? item.name : undefined;
  if (name === undefined) return item;
  const formula = typeof item.formula === "string" ? item.formula : undefined;

  const template = resolveEquipmentTemplate(name, formula);
  if (!template) return item; // no match at all — sourceKey stays undefined, a valid state

  const rest: Record<string, unknown> = { ...item };
  delete rest.manualResolution;
  return {
    ...rest,
    sourceKey: template.sourceKey,
    ...(template.manualResolution === true ? { manualResolution: true } : {}),
  };
}

/**
 * Backfills `sourceKey` on one non-custom `actions` array element, by
 * matching `name` against {@link BASE_SPELLS}. Part of `MIGRATIONS[2]`.
 *
 * No known rename-collision exists among spells today (unlike equipment's
 * Spear/Great Spear) — a plain name match is enough for now. If a future
 * printing renames a spell and reuses the old name, this needs the same
 * collision-table treatment as {@link resolveEquipmentTemplate}.
 *
 * A non-custom `actions` entry that ISN'T a spell (melee/ranged/ability/
 * item — always custom-authored via `CombatTab`'s `AddActionModal`, which
 * has no catalog to copy from) never matches `BASE_SPELLS` by name and
 * correctly keeps `sourceKey` undefined here — that's not a bug, it's
 * "this action was never catalog-sourced to begin with."
 *
 * @param action - One raw `actions` array element, of unknown shape.
 */
function backfillActionSourceKey(action: unknown): unknown {
  if (!isPlainObject(action)) return action;
  if (action.isCustom === true) return action; // never touch custom actions
  const name = typeof action.name === "string" ? action.name : undefined;
  if (name === undefined) return action;

  const template = BASE_SPELLS.find((s) => s.name === name);
  if (!template) return action; // no match — sourceKey stays undefined, a valid state

  return { ...action, sourceKey: template.sourceKey };
}

/**
 * Backfills `catalogVersion` (see `equipment.ts`/`spells.ts` file headers
 * for the contract) on one non-custom `inventory` array element, to `0` —
 * deliberately lower than every real catalog entry's `1`, not "whatever
 * the current catalog entry's version is" — see `MIGRATIONS[3]`'s own
 * comment for why `0` is correct here, not a placeholder.
 *
 * Only backfills when `sourceKey` is already present (set either by this
 * same pass's `MIGRATIONS[2]` immediately above, or by an earlier v2 -> v3
 * migration already applied to this record) — an entry with no
 * `sourceKey` can never be matched to a catalog entry, so it gets no
 * `catalogVersion` either, same "nothing to compare against" reasoning as
 * `isOutdated` in `catalogCopy.ts`.
 *
 * @param item - One raw `inventory` array element, of unknown shape.
 */
function backfillInventoryCatalogVersion(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  if (item.isCustom === true) return item; // never touch custom items
  if (typeof item.sourceKey !== "string") return item; // untraceable — no catalogVersion either
  return { ...item, catalogVersion: 0 };
}

/**
 * Same contract as {@link backfillInventoryCatalogVersion}, for one raw
 * `actions` array element.
 *
 * @param action - One raw `actions` array element, of unknown shape.
 */
function backfillActionCatalogVersion(action: unknown): unknown {
  if (!isPlainObject(action)) return action;
  if (action.isCustom === true) return action;
  if (typeof action.sourceKey !== "string") return action;
  return { ...action, catalogVersion: 0 };
}

/**
 * Backfills `category` ({@link EquipmentCategory}, `types/character.ts`)
 * on one raw `inventory` array element. Part of `MIGRATIONS[4]` (v4 -> v5).
 *
 * Unlike `sourceKey`/`catalogVersion`, `category` is REQUIRED on
 * `InventoryItem` — every item must end up with one, not just
 * catalog-traceable ones:
 * - A non-custom entry with a `sourceKey` matching a current
 *   `BASIC_EQUIPMENTS` entry takes THAT entry's current `category`
 *   (matched by `sourceKey`, never by `name` — same reasoning as
 *   `resolveEquipmentTemplate`, and the reason this doesn't need its own
 *   collision table: it reuses `sourceKey`, which the v2 -> v3 migration
 *   already resolved collision-safely).
 * - Everything else (a custom item, a non-custom item with no `sourceKey`,
 *   or a `sourceKey` that no longer matches anything — e.g. a retired
 *   catalog entry) defaults to `"gear"`, the same catch-all the old
 *   `guessCategory` UI heuristic fell back to for anything it couldn't
 *   otherwise classify — now made an explicit, permanent decision instead
 *   of a guess re-computed on every render.
 *
 * @param item - One raw `inventory` array element, of unknown shape.
 */
function backfillInventoryCategory(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  const sourceKey = typeof item.sourceKey === "string" ? item.sourceKey : undefined;
  const template = sourceKey
    ? BASIC_EQUIPMENTS.find((e) => e.sourceKey === sourceKey)
    : undefined;
  return { ...item, category: template?.category ?? "gear" };
}

/**
 * Ordered migrations, one function per schema version transition.
 * `MIGRATIONS[i]` moves a record from version `i` to version `i + 1`. See
 * the file header for the procedure to append to this list.
 */
const MIGRATIONS: Migration[] = [
  // v0 -> v1: "v0" doesn't name one known, fixed shape — it means
  // "everything written before schemaVersion existed at all", an
  // open-ended range covering every shape NimbleCharacter has ever had.
  // `combat` was the only KNOWN gap (formerly patched ad hoc, with no
  // versioning, in useOBR.ts's loadCharacterFromItem), but the type
  // changed several times before versioning existed without that ever
  // being visible anywhere: JS silently accepts a missing field right up
  // until something reads it. So the only useful definition of "v0" is
  // "whatever is missing relative to v1" — which is exactly what
  // createDefaultCharacter() already encodes, and reusing it here keeps
  // this migration and validateCharacterShape's template walk consistent
  // by construction.
  //
  // This is why — and ONLY why — this one migration is a full, generic
  // deep-fill rather than a small targeted patch. Every migration added
  // AFTER this one knows exactly which fields changed between two fixed,
  // already-shipped versions, and must stay a small, explicit, deliberate
  // transform of just those fields, the way this one used to be for
  // `combat` alone. A future migration reusing this same blanket fill
  // would silently paper over a real shape bug (a field missing because
  // of an actual mistake introduced between two versioned releases, not
  // because the record predates versioning) instead of surfacing it as
  // "invalid" — and would also erase the changelog value of this file,
  // where each migration function is a record of exactly what changed at
  // that version.
  (character) =>
    fillMissingFields(
      character,
      createDefaultCharacter("") as unknown as Record<string, unknown>,
    ),

  // v1 -> v2: FOUR changes folded into this single step, not one each —
  // see the note at the end of this comment for why.
  //
  // 1. Adds `initiativeAdvantage`, the default roll mode pre-selected in
  //    the initiative DiceRollModal (Nimble Core Rules 2nd printing, p.15).
  //    A record from before this field existed has no opinion on it —
  //    default to "none" (no advantage/disadvantage), matching
  //    createDefaultCharacter. This was the original, sole content of this
  //    migration step.
  // 2. Renames `armor` -> `defense` (see migrateArmorToDefense above): the
  //    2nd printing renames the hero stat "Armor" to "Defense".
  // 3. Drops the old `damage` field from every `actions` entry (see
  //    migrateActionDamageField above): `formula` is now the single source
  //    of truth for what's rollable, and `damage` was display-only flavor
  //    text kept in sync by hand across ~80 spells.
  // 4. Re-applies `manualResolution` to every non-custom `inventory` entry
  //    by matching its name against BASIC_EQUIPMENTS (see
  //    migrateInventoryManualResolution above): items added to a
  //    character's sheet before that flag existed carry
  //    `manualResolution: undefined` in their frozen metadata even though
  //    the current game data has it set, which otherwise leaves them
  //    stuck showing a working-looking roll button that throws.
  //
  // Folded into ONE existing step, deliberately breaking this file's own
  // "leave every earlier migration function alone, append a new one
  // instead" rule (see the file header): this is safe ONLY because v1 -> v2
  // has never shipped — no build in circulation has ever written
  // schemaVersion 2, so there is no real persisted record anywhere whose
  // correctness depends on this step's old, narrower behavior. Folding
  // avoids bumping CURRENT_SCHEMA_VERSION to 3 for a version transition
  // that would look, from outside this codebase, like it never existed.
  // A local test scene may already hold an old v2 shape (armor unrenamed,
  // damage/manualResolution untouched) from before this change — since it's
  // already stamped schemaVersion 2, it will NOT be re-migrated (migration
  // only runs for schemaVersion < CURRENT_SCHEMA_VERSION); reset it by hand.
  // This exception does not generalize: the NEXT migration after this one
  // must go back to appending a new step, never editing this one or any
  // other again once it's shipped.
  (character) => {
    const withDefense = migrateArmorToDefense(character);
    const actions = Array.isArray(withDefense.actions)
      ? withDefense.actions.map(migrateActionDamageField)
      : withDefense.actions;
    const inventory = Array.isArray(withDefense.inventory)
      ? withDefense.inventory.map(migrateInventoryManualResolution)
      : withDefense.inventory;

    return {
      ...withDefense,
      actions,
      inventory,
      initiativeAdvantage:
        "initiativeAdvantage" in withDefense ? withDefense.initiativeAdvantage : "none",
    };
  },

  // v2 -> v3: backfills `sourceKey` (see equipment.ts/spells.ts file
  // headers for the append-only contract) onto every non-custom
  // actions/inventory entry, by matching `name` against the current
  // catalogs — see backfillActionSourceKey/backfillInventorySourceKey
  // above. THE LAST TIME this codebase matches by name: sourceKey exists
  // specifically so nothing has to again after this step. Also re-applies
  // `manualResolution` on inventory items using the same, collision-safe
  // resolution (see resolveEquipmentTemplate) — MIGRATIONS[1]'s own
  // manualResolution backfill is name-only and stays exactly as it was
  // (frozen, per this file's append-only rule); this step is what
  // actually corrects it going forward for any record that reaches v3.
  //
  // A record whose name matches nothing in the relevant catalog keeps
  // sourceKey undefined — a valid state ("cannot be traced to the
  // catalog": renamed then hand-edited past recognition, or never
  // catalog-sourced to begin with), never guessed at.
  (character) => {
    const actions = Array.isArray(character.actions)
      ? character.actions.map(backfillActionSourceKey)
      : character.actions;
    const inventory = Array.isArray(character.inventory)
      ? character.inventory.map(backfillInventorySourceKey)
      : character.inventory;

    return { ...character, actions, inventory };
  },

  // v3 -> v4: backfills `catalogVersion` (see equipment.ts/spells.ts file
  // headers for the contract) onto every non-custom actions/inventory
  // entry that has a sourceKey — see backfillActionCatalogVersion/
  // backfillInventoryCatalogVersion above.
  //
  // Backfilled to 0, not to "whatever the catalog currently says" and not
  // skipped: every copy that exists before this migration predates
  // catalogVersion entirely, and 0 is deliberately LOWER than every real
  // catalog entry's starting version of 1. That means every one of them
  // is immediately flagged outdated (isOutdated in catalogCopy.ts) the
  // moment this migration runs. This is correct, not a bug to "fix" by
  // matching the current version instead: the 2nd-printing spells/
  // equipment batches changed most of the catalog's mechanics and text,
  // and this migration is the FIRST time any player is told their copy
  // might be stale. Setting catalogVersion to the current value instead
  // would silently hide exactly the staleness this whole system exists to
  // surface.
  //
  // An entry with no sourceKey (custom, or untraceable even after
  // MIGRATIONS[2]'s backfill) gets no catalogVersion either — it can never
  // be matched to a catalog entry, so there is nothing to flag it against
  // or reset it from.
  (character) => {
    const actions = Array.isArray(character.actions)
      ? character.actions.map(backfillActionCatalogVersion)
      : character.actions;
    const inventory = Array.isArray(character.inventory)
      ? character.inventory.map(backfillInventoryCatalogVersion)
      : character.inventory;

    return { ...character, actions, inventory };
  },

  // v4 -> v5: backfills `category` (EquipmentCategory — types/character.ts)
  // onto every `inventory` entry — see backfillInventoryCategory above for
  // the full contract (catalog-matched by sourceKey for a traceable
  // non-custom item, "gear" for everything else).
  //
  // This replaces a UI-only heuristic (`guessCategory`, formerly in
  // `InventoryTab.tsx`) that inferred a display category from proxy
  // signals (isArmor, slots === 0.5, "potion" in the name, actionCost +
  // formula) instead of storing one. That heuristic, and a second,
  // independently-ordered copy of the same checks in the "Add Item" icon
  // picker, disagreed with each other: a potion is shaped like both a
  // weapon (actionCost + formula) and a consumable (slots === 0.5), so
  // whichever check happened to run first won — the icon picker checked
  // the weapon shape first, so potions rendered a sword icon in the
  // consumables list. The heuristic also had no way to classify a
  // slots=1, formula-less single-use item like "Medical Kit (1 use)" at
  // all, so it fell through to "gear". `category` is now authored per
  // catalog entry instead (see equipment.ts's file header), so an
  // existing character's frozen inventory copies need this migration to
  // catch up — same "frozen copy, catalog moved on" situation as every
  // other backfill in this file.
  //
  // Only `inventory` needed this: `CharacterAction` (spells/actions) has
  // no equivalent display-category concept and was never affected by the
  // heuristic this replaces.
  (character) => {
    const inventory = Array.isArray(character.inventory)
      ? character.inventory.map(backfillInventoryCategory)
      : character.inventory;

    return { ...character, inventory };
  },

  // v5 -> v6: drops `tokenId`, adds `id` and `kind` — the shape half of the
  // vault-decoupling change (see `characterVault.ts`'s file header for the
  // OTHER half: moving a legacy record's storage LOCATION from item
  // metadata to the scene-metadata vault plus a token-side CharacterLink,
  // which needs an Item to read `createdUserId` from and isn't something a
  // pure Migration function can do — this step only fixes the character
  // record's own shape, wherever it ends up living).
  //
  // `id` is generated only if missing (presence-checked with `in`, never by
  // truthiness — same discipline as fillMissingFields) so re-running this
  // step never mints a second id for a record that already has one; a
  // record's id must stay stable for its entire life, since it's the vault
  // key and the value every CharacterLink.characterId compares against.
  // `kind` defaults to `"player"` — nothing before this version had an
  // opinion on it, and every character that existed before "monster" had a
  // meaning was, definitionally, someone's player character.
  (character) => {
    const rest: Record<string, unknown> = { ...character };
    delete rest.tokenId;
    return {
      ...rest,
      id: "id" in character && typeof character.id === "string" && character.id
        ? character.id
        : crypto.randomUUID(),
      kind: "kind" in character ? character.kind : "player",
    };
  },
];

/**
 * Outcome of {@link migrateCharacter}.
 *
 * - `"ok"` — the record is now a valid `NimbleCharacter` at
 *   `CURRENT_SCHEMA_VERSION`. `migrated` says whether any migration
 *   actually ran (`false` when the record was already current), which
 *   callers use to decide whether the migrated record is worth writing
 *   back to OBR.
 * - `"unsupported"` — the record's `schemaVersion` is newer than
 *   `CURRENT_SCHEMA_VERSION`. There is no downward migration: a client
 *   running older code cannot know what a newer field means. Callers
 *   should refuse to load rather than render partial or guessed data.
 * - `"invalid"` — the record is not a valid character even after
 *   migration: not an object, a migration threw, or the migrated result
 *   failed {@link validateCharacterShape}. `reason` is a short technical
 *   description for logs/debugging, not phrased for a player mid-game —
 *   callers should show a generic message and log `reason` separately
 *   (see `console.error` in `useOBR.ts`'s `loadCharacterFromItem`).
 */
export type MigrationResult =
  | { status: "ok"; character: NimbleCharacter; migrated: boolean }
  | { status: "unsupported"; foundVersion: number }
  | { status: "invalid"; reason: string };

/**
 * Recursively checks that `value` has every key `template` has, with a
 * matching `typeof` at each key, descending one level into plain nested
 * objects and requiring arrays to be arrays.
 *
 * @returns `null` if `value` matches, or a short `path: problem`
 * description of the first mismatch found otherwise.
 */
function findShapeMismatch(value: unknown, template: unknown, path: string): string | null {
  if (template === null || template === undefined) return null;
  if (value === null) return null; // see validateCharacterShape's "known gaps"
  if (value === undefined) return `${path}: missing`;

  if (Array.isArray(template)) {
    return Array.isArray(value) ? null : `${path}: expected array, got ${typeof value}`;
  }

  if (typeof template === "object") {
    if (typeof value !== "object") {
      return `${path}: expected object, got ${typeof value}`;
    }
    for (const key of Object.keys(template as Record<string, unknown>)) {
      const mismatch = findShapeMismatch(
        (value as Record<string, unknown>)[key],
        (template as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      );
      if (mismatch) return mismatch;
    }
    return null;
  }

  return typeof value === typeof template
    ? null
    : `${path}: expected ${typeof template}, got ${typeof value}`;
}

/**
 * Structural check run on the output of the migration chain, before it is
 * trusted as a real `NimbleCharacter`.
 *
 * Deliberately not a hand-written field-by-field schema — that would be a
 * second description of `NimbleCharacter`'s shape, maintained by hand and
 * free to drift from the interface (the `FLAW` bug documented in
 * `formulaParser.ts`/CLAUDE.md happened exactly this way: a field was
 * documented and computed but never wired into the one place that used a
 * hand-copied list). Instead this walks `createDefaultCharacter()`'s own
 * return value as a template: every field that function returns is already
 * forced to exist by the TypeScript compiler (a missing required field in
 * its return statement is a compile error), so the template can't silently
 * fall out of sync with `NimbleCharacter`'s required fields the way a
 * separate schema could.
 *
 * @remarks Known gaps, accepted rather than solved here:
 * - Fields genuinely optional on `NimbleCharacter` (`Defense.equippedItemId`,
 *   `Defense.defenseBonus`) are only checked when `createDefaultCharacter`
 *   happens to give them a concrete value; nothing forces the template to
 *   have an opinion about a field that's allowed to be absent, so this
 *   check cannot promise coverage of every field the interface declares.
 * - Array elements are only checked for being an array, not the shape of
 *   each element — `actions`/`inventory` entries are polymorphic per
 *   `type`, and validating that generically from one template instance
 *   would need per-type shapes hand-listed here, the exact problem this
 *   function exists to avoid.
 * - Enum-like string fields (`hitDice.dice`, `saveMods.str`, ...) are
 *   checked as `string`, not against their specific allowed values.
 * - `null` is accepted at any key regardless of the template's type there,
 *   rather than hand-listing the handful of fields that are legitimately
 *   nullable (`keyStat`, `flawStat`, `combat.initiativeResult`).
 *
 * Good enough for what this actually validates in practice: the output of
 * this project's own migration chain, not arbitrary external data. See
 * CLAUDE.md for when a real schema library becomes the right tool instead.
 *
 * @returns `null` if `value` matches the template's shape, or a short
 * description of the first mismatch found otherwise.
 */
export function validateCharacterShape(value: unknown): string | null {
  return findShapeMismatch(value, createDefaultCharacter(""), "character");
}

/**
 * Applies `migrations[fromVersion]`, `migrations[fromVersion + 1]`, ... in
 * order, up to (not including) `migrations.length`, threading each
 * function's output into the next. Extracted from {@link migrateCharacter}
 * so the chaining behavior itself — applying more than one migration in
 * sequence — is directly testable against a small local migrations array,
 * independent of `CURRENT_SCHEMA_VERSION` or the real `MIGRATIONS` array
 * (which today only has one entry).
 *
 * @param migrations - Ordered migrations; `migrations[i]` transforms
 * version `i` to `i + 1`.
 * @param record - The record to migrate, at `fromVersion`.
 * @param fromVersion - The record's own schema version to start from.
 * @returns The record after every applicable migration has run, still
 * untyped — `migrateCharacter` is the one that stamps `schemaVersion` and
 * validates the result.
 */
function applyMigrations(
  migrations: Migration[],
  record: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  let current = record;
  for (let v = fromVersion; v < migrations.length; v++) {
    current = migrations[v](current);
  }
  return current;
}

/**
 * Runs `value` (as read from OBR item metadata, of unknown shape) through
 * whatever migrations are needed to reach {@link CURRENT_SCHEMA_VERSION},
 * validates the result, and hands back a `NimbleCharacter` the rest of the
 * app can trust — or a typed reason it couldn't.
 *
 * A record with no `schemaVersion` field at all (nothing in production has
 * ever written one before this change) is treated as version 0 and run
 * through the full migration chain, same as an explicit `schemaVersion: 0`.
 *
 * @param value - Raw metadata value read from `item.metadata[METADATA_KEY]`.
 * Callers are expected to have already excluded `undefined` (no sheet
 * attached at all is a different case than a sheet with bad data — see
 * `loadCharacterFromItem` in `useOBR.ts`).
 * @returns See {@link MigrationResult}.
 */
export function migrateCharacter(value: unknown): MigrationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      status: "invalid",
      reason: `expected an object, got ${Array.isArray(value) ? "array" : typeof value}`,
    };
  }

  const record = value as Record<string, unknown>;
  const foundVersion = typeof record.schemaVersion === "number" ? record.schemaVersion : 0;

  if (foundVersion > CURRENT_SCHEMA_VERSION) {
    return { status: "unsupported", foundVersion };
  }

  try {
    // A negative foundVersion enters the loop and immediately throws
    // indexing an out-of-range MIGRATIONS entry (caught below, reported as
    // "invalid"). A NaN foundVersion never enters the loop at all (NaN
    // comparisons are always false) and falls through unchanged to the
    // shape check, which reports it as invalid instead.
    const current = applyMigrations(MIGRATIONS, record, foundVersion);
    const migrated = { ...current, schemaVersion: CURRENT_SCHEMA_VERSION };

    const mismatch = validateCharacterShape(migrated);
    if (mismatch) {
      return { status: "invalid", reason: `shape mismatch after migration: ${mismatch}` };
    }

    return {
      status: "ok",
      // Shape-checked immediately above; see validateCharacterShape's
      // "known gaps" for exactly how much that check does and doesn't cover.
      character: migrated as unknown as NimbleCharacter,
      migrated: foundVersion < CURRENT_SCHEMA_VERSION,
    };
  } catch (err) {
    return {
      status: "invalid",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Exposed for the invariant test (`MIGRATIONS.length === CURRENT_SCHEMA_VERSION`)
 * and for tests targeting the migration chain directly. Not meant to be
 * imported by application code — go through {@link migrateCharacter}.
 */
export { MIGRATIONS, applyMigrations };
