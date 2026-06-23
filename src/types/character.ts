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
 * Defense/armor configuration for a character.
 *
 * Defense is derived from whichever inventory item (with `isArmor: true`)
 * is referenced by `equippedItemId`, plus a flat `defenseBonus` (class
 * features, racial traits, etc.) — see `computeDefense` in CombatTab.
 */
export interface Armor {
  /** ID of the equipped armor InventoryItem */
  equippedItemId?: string;
  /** Flat bonus from class ability, racial trait, etc. */
  defenseBonus?: number;
}

export interface CharacterAction {
  id: string;
  name: string;
  type: ActionType;
  range: string;
  damage: string;
  formula: string;
  description: string;
  isFavorite: boolean;
  manaCost?: number;
  spellTier?: number;
  spellSchool?: SpellSchool;
  slots?: number;
  isCustom?: boolean;
  actionCost?: number;
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
  armorValue?: number;
  actionCost?: number;
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

  armor: Armor;
  initiativeBonus: number;

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
}

/**
 * Namespaced metadata key under which the character sheet is stored on
 * an OBR scene item. Using a reverse-domain-style namespace avoids
 * collisions with metadata written by other OBR extensions.
 */
export const METADATA_KEY = "com.nimble-obr.nimble/character_sheet";

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
  hidden: boolean;
  playerId: string;
  playerName: string;
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
    armor: {
      equippedItemId: undefined,
      defenseBonus: 0,
    },
    initiativeBonus: 0,
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
  };
}
