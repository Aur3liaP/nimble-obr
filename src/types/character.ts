// ─────────────────────────────────────────────────────────────────
// Nimble Character Sheet – Core Types
// Namespace: com.nimble-obr.nimble/character_sheet
// ─────────────────────────────────────────────────────────────────

export type DiceType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

export type ActionType = 'melee' | 'ranged' | 'spell' | 'ability' | 'item';

export type SaveAdvantage = 'advantage' | 'disadvantage' | 'none';

export interface HitPoints {
  current: number;
  max: number;
  temp: number;
}

export interface HitDice {
  /** Number of hit dice available */
  current: number;
  /** Max hit dice (= character level) */
  max: number;
  /** Die type, e.g. "d10" */
  dice: DiceType;
}

export interface Stats {
  str: number; // Strength  [-1 to +5]
  dex: number; // Dexterity
  int: number; // Intelligence
  wil: number; // Willpower
}

/** Which save each stat has advantage/disadvantage on (class-defined) */
export interface SaveMods {
  str: SaveAdvantage;
  dex: SaveAdvantage;
  int: SaveAdvantage;
  wil: SaveAdvantage;
}

export interface Skills {
  arcana: number;      // INT
  examination: number; // INT
  finesse: number;     // DEX
  influence: number;   // WIL
  insight: number;     // WIL
  lore: number;        // INT
  might: number;       // STR
  naturecraft: number; // WIL
  perception: number;  // WIL
  stealth: number;     // DEX
}

export interface Armor {
  name: string;
  /** Base defence value. If 0 and no armor → use DEX */
  value: number;
  /** Whether the character is proficient with this armor */
  proficient: boolean;
  equipped: boolean;
}

export interface CharacterAction {
  id: string;
  name: string;
  type: ActionType;
  /** e.g. "1", "2", "reach 2", "range 6" */
  range: string;
  /** e.g. "1d8+STR" */
  damage: string;
  /** Evaluated formula string. Can reference level, stats, skills. */
  formula: string;
  description: string;
  isFavorite: boolean;
  /** Whether it costs mana and how much */
  manaCost?: number;
  /** Spell tier (0 = cantrip, no mana cost) */
  spellTier?: number;
  /** Item slot cost */
  slots?: number;
  /** Whether the item/spell was added by the GM */
  isCustom?: boolean;
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
}

export interface NimbleCharacter {
  // ── Identity ───────────────────────────────────────────────────
  name: string;
  ancestry: string;   // "Peuple" in French rules
  class: string;
  background: string;
  level: number;
  size: string;       // "Medium", "Small", etc.
  speed: number;      // default 6 squares

  // ── Core Resources ─────────────────────────────────────────────
  hp: HitPoints;
  wounds: number;           // 0-5 (dies at 6th wound)
  maxWounds: number;        // usually 5 (die at 6th), can vary
  mana: number;
  maxMana: number;
  hitDice: HitDice;

  // ── Characteristics ────────────────────────────────────────────
  stats: Stats;
  saveMods: SaveMods;

  // ── Skills ─────────────────────────────────────────────────────
  skills: Skills;

  // ── Combat ─────────────────────────────────────────────────────
  armor: Armor;
  initiativeBonus: number;  // any bonus on top of DEX

  // ── Languages ──────────────────────────────────────────────────
  languages: string[];      // Always includes "Common"

  // ── Abilities & Notes ──────────────────────────────────────────
  abilities: string[];      // Class/race/background abilities (free text)
  notes: string;

  // ── Actions (Attacks, Spells, Abilities) ───────────────────────
  actions: CharacterAction[];

  // ── Inventory ──────────────────────────────────────────────────
  inventory: InventoryItem[];
  inventorySlots: number;   // 10 + STR
  gold: number;

  // ── Meta ───────────────────────────────────────────────────────
  /** OBR item ID this sheet is attached to */
  tokenId: string;
  /** OBR player ID of the owner */
  ownerId: string;
  /** Last updated timestamp */
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────
// OBR Metadata key
// ─────────────────────────────────────────────────────────────────
export const METADATA_KEY = 'com.nimble-obr.nimble/character_sheet';

// ─────────────────────────────────────────────────────────────────
// Roll types
// ─────────────────────────────────────────────────────────────────
export type RollMode = 'standard' | 'advantage' | 'disadvantage';

export type AdvantageCount = number; // negative = disadvantage stacks

export interface DiceRollRequest {
  label: string;
  formula: string;
  mode: RollMode;
  advantageCount?: AdvantageCount; // how many extra dice
  hidden?: boolean; // GM-only roll
}

export interface DiceRollResult {
  label: string;
  formula?: string;
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

// ─────────────────────────────────────────────────────────────────
// Skill → Stat mapping
// ─────────────────────────────────────────────────────────────────
export const SKILL_STAT_MAP: Record<keyof Skills, keyof Stats> = {
  arcana: 'int',
  examination: 'int',
  finesse: 'dex',
  influence: 'wil',
  insight: 'wil',
  lore: 'int',
  might: 'str',
  naturecraft: 'wil',
  perception: 'wil',
  stealth: 'dex',
};

// ─────────────────────────────────────────────────────────────────
// Default character factory
// ─────────────────────────────────────────────────────────────────
export function createDefaultCharacter(
  tokenId: string,
  ownerId: string
): NimbleCharacter {
  return {
    name: 'New Hero',
    ancestry: '',
    class: '',
    background: '',
    level: 1,
    size: 'Medium',
    speed: 6,

    hp: { current: 10, max: 10, temp: 0 },
    wounds: 0,
    maxWounds: 5,
    mana: 0,
    maxMana: 0,
    hitDice: { current: 1, max: 1, dice: 'd8' },

    stats: { str: 0, dex: 0, int: 0, wil: 0 },
    saveMods: { str: 'none', dex: 'none', int: 'none', wil: 'none' },

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

    armor: { name: 'Unarmored', value: 0, proficient: true, equipped: true },
    initiativeBonus: 0,

    languages: ['Common'],
    abilities: [],
    notes: '',

    actions: [],
    inventory: [],
    inventorySlots: 10,
    gold: 0,

    tokenId,
    ownerId,
    updatedAt: Date.now(),
  };
}
