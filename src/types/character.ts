// ─────────────────────────────────────────────────────────────────
// Nimble Character Sheet – Core Types
// ─────────────────────────────────────────────────────────────────

export type DiceType = "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "d100";
export type ActionType = "melee" | "ranged" | "spell" | "ability" | "item";
export type SaveAdvantage = "advantage" | "disadvantage" | "none";
export type SpellSchool =
  | "fire" | "ice" | "lightning" | "wind"
  | "radiant" | "necrotic" | "terramancy" | "utility";

export interface HitPoints { current: number; max: number; temp: number; }
export interface HitDice { current: number; max: number; dice: DiceType; }

export interface Stats { str: number; dex: number; int: number; wil: number; }
export interface SaveMods {
  str: SaveAdvantage; dex: SaveAdvantage;
  int: SaveAdvantage; wil: SaveAdvantage;
}
export interface Skills {
  arcana: number; examination: number; finesse: number;
  influence: number; insight: number; lore: number;
  might: number; naturecraft: number; perception: number; stealth: number;
}
export interface Armor {
  name: string; value: number; proficient: boolean; equipped: boolean;
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
  /** If true, this item is treated as armor and can set the armor value */
  isArmor?: boolean;
  armorValue?: number;
  // ActionCost for weapons & potions
  actionCost?: number;
}

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
  saveMods: SaveMods;
  skills: Skills;

  armor: Armor;
  initiativeBonus: number;

  languages: string[];
  abilities: string[];
  notes: string;

  actions: CharacterAction[];
  inventory: InventoryItem[];
  inventorySlots: number;
  gold: number;
  silver: number;

  tokenId: string;
  ownerId: string;
  updatedAt: number;
}

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
  arcana: "int", examination: "int", finesse: "dex",
  influence: "wil", insight: "wil", lore: "int",
  might: "str", naturecraft: "wil", perception: "wil", stealth: "dex",
};

export function createDefaultCharacter(tokenId: string, ownerId: string): NimbleCharacter {
  return {
    name: "New Hero", ancestry: "", class: "", level: 1,
    size: "Medium", speed: 6,
    hp: { current: 10, max: 10, temp: 0 },
    wounds: 0, maxWounds: 5, mana: 0, maxMana: 0,
    hitDice: { current: 1, max: 1, dice: "d8" },
    stats: { str: 0, dex: 0, int: 0, wil: 0 },
    saveMods: { str: "none", dex: "none", int: "none", wil: "none" },
    skills: {
      arcana: 0, examination: 0, finesse: 0, influence: 0, insight: 0,
      lore: 0, might: 0, naturecraft: 0, perception: 0, stealth: 0,
    },
    armor: { name: "Unarmored", value: 0, proficient: true, equipped: false },
    initiativeBonus: 0,
    languages: ["Common"],
    abilities: [], notes: "",
    actions: [], inventory: [],
    inventorySlots: 10, gold: 0, silver: 0,
    tokenId, ownerId, updatedAt: Date.now(),
  };
}
