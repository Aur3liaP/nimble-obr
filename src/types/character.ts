/**
 * @file Core domain types for the Nimble character sheet.
 *
 * Defines the full shape of a character (`NimbleCharacter`) as stored in
 * OBR item metadata under {@link METADATA_KEY}, along with supporting
 * types for dice rolls, actions, and inventory.
 *
 * This file has no dependencies on React or the OBR SDK — it is pure
 * data modeling, shared by the formula parser, the `useOBR` hook, and
 * every tab component.
 */

export type DiceType = "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "d100";
export type ActionType = "melee" | "ranged" | "spell" | "ability" | "item";
export type SaveAdvantage = "advantage" | "disadvantage" | "none";
export type SpellSchool =
  | "fire"
  | "ice"
  | "lightning"
  | "wind"
  | "radiant"
  | "necrotic"
  | "terramancy"
  | "utility";

export interface HitPoints {
  current: number;
  max: number;
  temp: number;
}
export interface HitDice {
  current: number;
  max: number;
  dice: DiceType;
}

export interface Stats {
  str: number;
  dex: number;
  int: number;
  wil: number;
}
export interface SaveMods {
  str: SaveAdvantage;
  dex: SaveAdvantage;
  int: SaveAdvantage;
  wil: SaveAdvantage;
}
export interface Skills {
  arcana: number;
  examination: number;
  finesse: number;
  influence: number;
  insight: number;
  lore: number;
  might: number;
  naturecraft: number;
  perception: number;
  stealth: number;
}

/**
 * Defense configuration for a character.
 *
 * Nimble Core Rules 2nd printing renames the hero stat "Armor" to
 * "Defense" — "Armor" now refers exclusively to worn equipment
 * ({@link InventoryItem.isArmor}). This interface (renamed from `Armor` in
 * the schema v2 migration, see `characterMigrations.ts`) carries
 * `defenseBonus`, which comes from traits that are not armor at all
 * (Dragonborn +1 Defense, Turtlefolk +4 Defense, Fearless -1 Defense,
 * Ratfolk +2 Defense) — `character.armor.defenseBonus` was semantically
 * wrong even before the printing renamed the stat.
 *
 * Defense is derived from whichever inventory item (with `isArmor: true`)
 * is referenced by `equippedItemId`, plus the flat `defenseBonus` above —
 * see `computeDefense` in `src/utils/computeDefense.ts`.
 */
export interface Defense {
  /** ID of the equipped armor InventoryItem */
  equippedItemId?: string;
  /** Flat bonus from class ability, racial trait, etc. */
  defenseBonus?: number;
}

/**
 * Turn-scoped combat state: the action economy tracker and the last
 * initiative roll.
 *
 * @remarks Lives on {@link NimbleCharacter} (item metadata) rather than a
 * separate metadata key, deliberately: it rides the same per-token write
 * path, the same `canEdit` gate (`updateCharacter` in `useOBR.ts`), and the
 * same real-time sync as HP/wounds, so the GM sees it with no extra
 * listener wiring. Previously this was `CombatTab`-local `useState`, which
 * was lost every time the tab unmounted (switching tabs); moving it here
 * fixes that by construction.
 */
export interface CombatState {
  /**
   * Actions left to spend this turn, out of the fixed 3-action budget
   * (0-3). Named for what the player is actually tracking at the table
   * ("how many do I have left"), not what's been spent — an earlier
   * `actionsUsed` version had a decrement direction that read backwards
   * against real usage (rolling 1 action set the counter to 2 instead of
   * 1). A single counter rather than 3 independent booleans, so a "gap"
   * state (e.g. action 3 available but not action 2) can't be represented.
   * See `CombatTab`'s pip click handler for how a click maps to this
   * value.
   */
  actionsRemaining: number;
  /** Most recent initiative roll total, or null if none rolled yet (or the 5s display window has elapsed). */
  initiativeResult: number | null;
}

export interface CharacterAction {
  id: string;
  name: string;
  type: ActionType;
  range: string;
  /**
   * The actual rollable formula, and the single source of truth for what's
   * rollable. Empty means not rollable — no roll button, by design (e.g.
   * Dragonform).
   *
   * There used to also be a `damage` field: display-only flavor text (e.g.
   * "2d6+STR", "Special") carrying the book's own notation, kept in sync
   * with `formula` by hand across ~80 spells. Removed in the schema v2
   * migration (`characterMigrations.ts`) once `resolveFormulaDisplay`'s
   * resolved value made it strictly less useful than `formula` itself —
   * see that migration for how existing characters' frozen action copies
   * (which may still have both fields in their persisted metadata) are
   * handled on load.
   */
  formula: string;
  description: string;
  isFavorite: boolean;
  manaCost?: number;
  spellTier?: number;
  spellSchool?: SpellSchool;
  slots?: number;
  isCustom?: boolean;
  actionCost?: number;
  /**
   * Stable, immutable identifier of the {@link BASE_SPELLS} catalog entry
   * this action was copied from — set only when copied from the catalog
   * (never on a custom action, `isCustom: true`), and NEVER the same thing
   * as `name` (which can and does change across printings). See
   * `spells.ts`'s file header for the append-only contract. Undefined
   * means either a custom entry, or a catalog copy predating this field
   * (backfilled by name where possible in the schema v3 migration —
   * `undefined` after that backfill genuinely means "cannot be traced back
   * to the catalog", not a bug to fix by guessing).
   */
  sourceKey?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  slots: number;
  quantity: number;
  isEquipped: boolean;
  formula?: string;
  isFavorite?: boolean;
  isCustom?: boolean;
  /** If true, this item can be selected as worn armor in the defense calculation */
  isArmor?: boolean;
  actionCost?: number;
  /**
   * If true, `formula` is flavor-text shorthand for the GM to interpret
   * manually (e.g. "WeaponDamage + 1d4" on a magic weapon, referencing
   * whatever weapon it's enchanting — a concept this app has no variable
   * for), not a formula meant to be evaluated or rolled by the engine.
   * Content-validation tests exclude these instead of treating them as bugs.
   */
  manualResolution?: boolean;
  /**
   * Stable, immutable identifier of the {@link BASIC_EQUIPMENTS} catalog
   * entry this item was copied from — same contract as
   * {@link CharacterAction.sourceKey}: set only when copied from the
   * catalog, never on a custom item, never the same thing as `name`. See
   * `equipment.ts`'s file header for the append-only contract.
   */
  sourceKey?: string;
}

/**
 * Full persisted state of a single Nimble character sheet.
 *
 * This entire object is stored as-is in the OBR item metadata under
 * {@link METADATA_KEY} and is read/written via `OBR.scene.items.updateItems`.
 * Any player or the GM with edit rights can trigger an update; OBR then
 * syncs the change to every connected client in real time.
 *
 * @see createDefaultCharacter for the initial state given to a fresh token.
 */
export interface NimbleCharacter {
  name: string;
  ancestry: string;
  class: string;
  level: number;
  size: string;
  speed: number;

  hp: HitPoints;
  wounds: number;
  maxWounds: number;
  mana: number;
  maxMana: number;
  hitDice: HitDice;

  stats: Stats;
  keyStat: keyof Stats | null;
  flawStat: keyof Stats | null;
  saveMods: SaveMods;
  skills: Skills;

  defense: Defense;
  initiativeBonus: number;
  /**
   * Default roll mode pre-selected in the initiative {@link DiceRollModal}
   * (Nimble Core Rules 2nd printing, p.15 grants advantage/disadvantage on
   * initiative from certain sources) — the player can still override it,
   * exactly like {@link SaveMods}' per-stat advantage does for stat saves
   * (see `SummaryTab.confirmRoll`).
   */
  initiativeAdvantage: SaveAdvantage;
  combat: CombatState;

  languages: string[];
  abilities: string[];
  notes: string;
  battleNotes: string;
  spellNotes: string;
  inventoryNotes: string;

  actions: CharacterAction[];
  inventory: InventoryItem[];
  inventorySlots: number;
  gold: number;
  silver: number;

  tokenId: string;
  ownerId: string;
  updatedAt: number;

  /**
   * Schema version this record was written at. Used by `migrateCharacter`
   * (`src/utils/characterMigrations.ts`) to bring older records up to
   * {@link CURRENT_SCHEMA_VERSION} on load, and to refuse a record whose
   * version is newer than this build understands, rather than guessing at
   * fields it doesn't know about. See that file's header for the procedure
   * to follow when `NimbleCharacter`'s shape changes.
   */
  schemaVersion: number;
}

/**
 * Namespaced metadata key under which the character sheet is stored on
 * an OBR scene item. Using a reverse-domain-style namespace avoids
 * collisions with metadata written by other OBR extensions.
 */
export const METADATA_KEY = "com.nimble-obr.nimble/character_sheet";

/**
 * Current schema version of {@link NimbleCharacter}. Bump this by exactly 1,
 * and add a matching entry to `MIGRATIONS` in
 * `src/utils/characterMigrations.ts`, every time `NimbleCharacter`'s shape
 * changes in a way that a record already persisted in OBR item metadata
 * needs transforming to match. See that file's header for the full
 * procedure.
 */
export const CURRENT_SCHEMA_VERSION = 3;

/**
 * Highest level a character can be set to.
 *
 * @remarks `level` feeds directly into the formula parser's dynamic-dice
 * helpers (`incrementdice(base, level)dSIDES`, `stepdice(level, ...)`). An
 * unbounded level lets a large-enough value push a *legitimate* spell's
 * dice count past `MAX_DICE_COUNT` in formulaParser.ts (e.g. level 500
 * pushes `incrementdice(1,level)d12` to 101 dice), which turns a normal
 * spell into one that always fails its own safety-limit check. Clamped at
 * write time in `useOBR.ts`'s `updateCharacter`, not just as an input
 * hint — an HTML `max` attribute doesn't stop a typed value from being
 * committed.
 */
export const MAX_LEVEL = 20;

/**
 * Legal range for a stat bonus (STR/DEX/INT/WIL). Nimble Core Rules 2nd
 * printing, p.6: "The maximum a hero's stat can typically go is +5"; the
 * floor mirrors it symmetrically. Enforced both at the input layer
 * ({@link StatBox}) and, defense in depth, at the write choke point
 * (`updateCharacter` in `useOBR.ts`) — same reasoning as {@link MAX_LEVEL}.
 */
export const MIN_STAT = -5;
export const MAX_STAT = 5;

/**
 * Legal range for a skill's total bonus. Nimble Core Rules 2nd printing,
 * p.7 and p.21: the +12 ceiling is absolute (not "stat + invested points"),
 * and the floor is -5 because a skill is stat bonus + invested points,
 * invested points are never negative, so the worst case is a -5 stat with
 * nothing invested. Enforced at the write choke point (`updateCharacter` in
 * `useOBR.ts`), same reasoning as {@link MAX_LEVEL}.
 */
export const MIN_SKILL = -5;
export const MAX_SKILL = 12;

export type RollMode = "standard" | "advantage" | "disadvantage";
export type AdvantageCount = number;

export interface DiceRollRequest {
  label: string;
  formula: string;
  mode: RollMode;
  advantageCount?: AdvantageCount;
  hidden?: boolean;
}

/**
 * Result of a resolved dice roll, broadcast to the table via scene metadata
 * (or kept client-side only when `hidden` is true and the roller is the GM).
 *
 * When `error` is set, the roll failed a safety-limit or parse check and
 * every numeric field below is zeroed rather than a real result — a
 * `DiceRollResult` with `error` set is never pushed to the shared roll log
 * (see `pushRollToLog` in `useOBR.ts`); it only ever reaches the roller
 * themselves, to show what went wrong.
 */
export interface DiceRollResult {
  label: string;
  formula: string;
  rolls: number[];
  kept: number[];
  modifier: number;
  total: number;
  isCritical: boolean;
  isFumble: boolean;
  /**
   * Whether this roll's notation can crit/fumble at all — `false` for a
   * flat/dice-less formula and for positional dice (`d44`/`d66`/`d88`; see
   * {@link formulaParser.rollPositionalDice}), `true` for a genuine `NdX`
   * roll. See `RollFormulaResult.canCritOrFumble` in `formulaParser.ts` for
   * the full rationale; carried through unchanged onto the broadcast result.
   */
  canCritOrFumble: boolean;
  hidden: boolean;
  playerId: string;
  playerName: string;
  error?: string;
  timestamp: number;
}

export const SKILL_STAT_MAP: Record<keyof Skills, keyof Stats> = {
  arcana: "int",
  examination: "int",
  finesse: "dex",
  influence: "wil",
  insight: "wil",
  lore: "int",
  might: "str",
  naturecraft: "wil",
  perception: "wil",
  stealth: "dex",
};

/**
 * Builds a brand-new {@link NimbleCharacter} with sensible defaults,
 * used when a player or GM attaches a sheet to a token that doesn't have
 * one yet.
 *
 * @param tokenId - ID of the OBR scene item this sheet is attached to.
 * @param ownerId - OBR player ID who will own (and be able to edit) this sheet.
 * @returns A fresh character at level 1 with zeroed stats and empty inventory.
 */
export function createDefaultCharacter(
  tokenId: string,
  ownerId: string,
): NimbleCharacter {
  return {
    name: "New Hero",
    ancestry: "",
    class: "",
    level: 1,
    size: "Medium",
    speed: 6,
    hp: { current: 10, max: 10, temp: 0 },
    wounds: 0,
    maxWounds: 5,
    mana: 0,
    maxMana: 0,
    hitDice: { current: 1, max: 1, dice: "d8" },
    stats: { str: 0, dex: 0, int: 0, wil: 0 },
    keyStat: null,
    flawStat: null,
    saveMods: { str: "none", dex: "none", int: "none", wil: "none" },
    skills: {
      arcana: 0,
      examination: 0,
      finesse: 0,
      influence: 0,
      insight: 0,
      lore: 0,
      might: 0,
      naturecraft: 0,
      perception: 0,
      stealth: 0,
    },
    defense: {
      equippedItemId: undefined,
      defenseBonus: 0,
    },
    initiativeBonus: 0,
    initiativeAdvantage: "none",
    combat: { actionsRemaining: 3, initiativeResult: null },
    languages: ["Common"],
    abilities: [],
    notes: "",
    battleNotes: "",
    spellNotes: "",
    inventoryNotes: "",
    actions: [],
    inventory: [],
    inventorySlots: 10,
    gold: 0,
    silver: 0,
    tokenId,
    ownerId,
    updatedAt: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}
