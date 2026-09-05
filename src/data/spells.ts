/**
 * @file Official spell catalog.
 *
 * ## `sourceKey` is append-only
 *
 * Every entry's `sourceKey` is a stable, immutable identifier, independent
 * of `name` — see `equipment.ts`'s own file header for the full rationale
 * (same contract, shared with this file). Once an entry ships, its
 * `sourceKey` **must never be edited or reused**, even if the spell's
 * `name` changes later — an existing character's frozen `CharacterAction`
 * copy references it. A brand-new spell gets a brand-new, never-before-used
 * `sourceKey`.
 *
 * Content verified against the Nimble Core Rules 2nd printing, pp. 46-53
 * ("second printing content, spells" batch). `Greater Shadow`'s
 * `sourceKey` ("greater-shadow") is retired — the spell was removed (it's
 * now a Shadowmancer class ability, not a spell) — and must never be
 * reused for anything else.
 *
 * The Terramancy, Hexbinder, and Afflictions sections are official Nimble
 * content by the same author as the Core Rules, distributed separately
 * (alpha reference sheets, not yet laid out in the main book) and licensed
 * under the Nimble 3rd Party Creator License v2.0, same as the rest of
 * this catalog — see `RollLog.tsx`'s `@file` header for where that
 * license's required notices live in the app.
 *

 * ## `catalogVersion` — bump it when players should know something changed
 *
 * Every entry also carries `catalogVersion: number`, starting at 1. See
 * `equipment.ts`'s own file header for the full contract (shared with this
 * file): bump it by 1 whenever a spell's mechanics or text change in a way
 * a player should know about; cosmetic-only edits don't require a bump,
 * at the author's judgment. `isOutdated`/`resetSpellToCatalog` in
 * `catalogCopy.ts` are what actually use this.
 */
import type { CharacterAction, SpellSchool } from "../types/character";

type SpellTemplate = Omit<CharacterAction, "id" | "isFavorite" | "isCustom">;

export const BASE_SPELLS: SpellTemplate[] = [
  // ── FIRE SPELLS (Page 46) ───────────────────────────────────
  {
    name: "Flame Dart",
    sourceKey: "flame-dart",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "fire" as SpellSchool,
    actionCost: 1,
    range: "8",
    formula: "1d10 + (Math.floor(level / 5) * 5)",
    description: "On crit: Smoldering. High levels: +5 damage every 5 levels.",
    manaCost: 0,
  },
  {
    name: "Heart’s Fire",
    sourceKey: "hearts-fire",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "fire" as SpellSchool,
    actionCost: 1,
    range: "4 (+2 every 5 levels)",
    formula: "",
    description:
      "(1/round) Give an ally within Range an extra action. Cast as a Reaction for 1 mana.",
    manaCost: 0,
  },
  {
    name: "Ignite",
    sourceKey: "ignite",
    catalogVersion: 1,
    type: "spell",
    spellTier: 1,
    spellSchool: "fire" as SpellSchool,
    actionCost: 2,
    range: "8",
    formula: "4d10",
    description:
      "Deals damage to a Smoldering target, ending the condition on hit. Upcast: +10 damage.",
    manaCost: 1,
  },
  {
    name: "Enchant Weapon",
    sourceKey: "enchant-weapon",
    catalogVersion: 1,
    type: "spell",
    spellTier: 2,
    spellSchool: "fire" as SpellSchool,
    actionCost: 1,
    range: "8",
    formula: "KEY",
    description:
      "Concentration (1 min). A weapon you choose gains +KEY damage and inflicts Smoldering on crit. Upcast: +KEY damage.",
    manaCost: 2,
  },
  {
    name: "Flame Barrier",
    sourceKey: "flame-barrier",
    catalogVersion: 1,
    type: "spell",
    spellTier: 3,
    spellSchool: "fire" as SpellSchool,
    actionCost: 0,
    range: "1",
    formula: "KEY",
    description:
      "AoE. Castable only while Defending. Melee attackers this round take KEY damage and gain Smoldering. Upcast: +KEY damage OR +1 Reach.",
    manaCost: 3,
  },
  {
    name: "Pyroclasm",
    sourceKey: "pyroclasm",
    catalogVersion: 1,
    type: "spell",
    spellTier: 4,
    spellSchool: "fire" as SpellSchool,
    actionCost: 2,
    range: "3",
    formula: "2d20+10",
    description:
      "AoE. Failed DEX save (Smoldering creatures fail automatically); half on save. Upcast: Advantage 1, +1 Reach.",
    manaCost: 4,
  },
  {
    name: "Fiery Embrace",
    sourceKey: "fiery-embrace",
    catalogVersion: 1,
    type: "spell",
    spellTier: 5,
    spellSchool: "fire" as SpellSchool,
    actionCost: 2,
    range: "8",
    formula: "",
    description:
      "AoE, Concentration (1 min). Ally gains Enchant Weapon. Enemies gain Smoldering, lose damage resistance (immunity reduced to resistance). Upcast: +1 ally, +2 Reach.",
    manaCost: 5,
  },
  {
    name: "Living Inferno",
    sourceKey: "living-inferno",
    catalogVersion: 1,
    type: "spell",
    spellTier: 7,
    spellSchool: "fire" as SpellSchool,
    actionCost: 3,
    range: "self",
    formula: "",
    description:
      "Gain the effects of Flame Barrier until your next turn. At the end of this turn and your next, cast Pyroclasm for free. Upcast: Upcast Flame Barrier and Pyroclasm.",
    manaCost: 7,
  },
  {
    name: "Dragonform",
    sourceKey: "dragonform",
    catalogVersion: 1,
    type: "spell",
    spellTier: 9,
    spellSchool: "fire" as SpellSchool,
    actionCost: 5,
    range: "self",
    formula: "",
    description:
      "Transform into a Huge dragon: gain 3 actions, Fly 12, Level Defense, 10xLevel Temp HP. Includes Tooth & Claw and Immolating Breath. Lasts until the temp HP is gone (max 10 min); when it ends, drop to 0 HP.",
    manaCost: 9,
  },
  {
    name: "Tooth & Claw (Dragonform)",
    sourceKey: "tooth-claw-dragonform",
    catalogVersion: 1,
    type: "spell",
    spellTier: 9,
    spellSchool: "fire" as SpellSchool,
    actionCost: 1,
    range: "2",
    formula: "1d20+LVL",
    description: "During Dragonform. Damage (ignoring armor). Inflicts Smoldering.",
    manaCost: 0,
  },
  {
    name: "Immolating Breath (Dragonform)",
    sourceKey: "immolating-breath-dragonform",
    catalogVersion: 1,
    type: "spell",
    spellTier: 9,
    spellSchool: "fire",
    actionCost: 2,
    range: "cone 8",
    formula: "KEYd20",
    description:
      "During Dragonform. Cone 8, AoE. Half damage on save (Smoldering targets fail automatically).",
    manaCost: 0,
  },

  // ── ICE SPELLS (Page 47) ────────────────────────────────────
  {
    name: "Ice Lance",
    sourceKey: "ice-lance",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "ice" as SpellSchool,
    actionCost: 1,
    range: "12",
    formula: "1d6 + (Math.floor(level / 5) * 3)",
    description: "On hit: Slowed. High levels: +3 damage every 5 levels.",
    manaCost: 0,
  },
  {
    name: "Snowblind",
    sourceKey: "snowblind",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "ice" as SpellSchool,
    actionCost: 1,
    range: "1",
    formula: "1d6 + (Math.floor(level / 5) * 3)",
    description: "On hit: Blinded until end of next turn.",
    manaCost: 0,
  },
  {
    name: "Frost Shield",
    sourceKey: "frost-shield",
    catalogVersion: 1,
    type: "spell",
    spellTier: 1,
    spellSchool: "ice" as SpellSchool,
    actionCost: 0,
    range: "self",
    formula: "2*KEY",
    description:
      "Castable only while Defending. Gain 2×KEY temp HP, lost at the start of your next turn. Upcast: +2×KEY temp HP.",
    manaCost: 1,
  },
  {
    name: "Shatter",
    sourceKey: "shatter",
    catalogVersion: 1,
    type: "spell",
    spellTier: 2,
    spellSchool: "ice" as SpellSchool,
    actionCost: 2,
    range: "12",
    formula: "3d6",
    description:
      "Any die can crit against a Hampered target: +20 damage instead of rolling additional dice. Upcast: Increase a die roll by 1. +5 damage on crit.",
    manaCost: 2,
  },
  {
    name: "Cryosleep",
    sourceKey: "cryosleep",
    catalogVersion: 1,
    type: "spell",
    spellTier: 3,
    spellSchool: "ice" as SpellSchool,
    actionCost: 2,
    range: "12",
    formula: "",
    description:
      "AoE 2×2. Failed WIL save: Incapacitated for 2 of their turns (damage wakes them). On save: Dazed instead. Upcast: +1 area, +1 turn asleep.",
    manaCost: 3,
  },
  {
    name: "Rimeblades",
    sourceKey: "rimeblades",
    catalogVersion: 1,
    type: "spell",
    spellTier: 4,
    spellSchool: "ice" as SpellSchool,
    actionCost: 3,
    range: "12",
    formula: "2d6",
    description:
      "AoE, Concentration (1 min). Difficult terrain. 2d6 damage for each space touched. Upcast: +1 space, +1 damage.",
    manaCost: 4,
  },
  {
    name: "Arctic Blast",
    sourceKey: "arctic-blast",
    catalogVersion: 1,
    type: "spell",
    spellTier: 5,
    spellSchool: "ice" as SpellSchool,
    actionCost: 2,
    range: "cone 4",
    formula: "4d6+10",
    description:
      "AoE. Difficult terrain for 1 round. Already-Hampered creatures there are Restrained. Upcast: +1 Reach.",
    manaCost: 5,
  },
  {
    name: "Glacier Strike",
    sourceKey: "glacier-strike",
    catalogVersion: 1,
    type: "spell",
    spellTier: 8,
    spellSchool: "ice" as SpellSchool,
    actionCost: 3,
    range: "12",
    formula: "d66",
    description:
      "AoE 3×3. Adjacent creatures take half damage. Area becomes permanent difficult terrain. Upcast: +1 initial area.",
    manaCost: 8,
  },
  {
    name: "Arctic Annihilation",
    sourceKey: "arctic-annihilation",
    catalogVersion: 1,
    type: "spell",
    spellTier: 9,
    spellSchool: "ice" as SpellSchool,
    actionCost: 3,
    range: "12",
    formula: "d66",
    description:
      "Any targets you choose are encased in ice, immune to damage and negative effects until their next turn. Others take d66 damage and STR save or be Incapacitated their next turn. Must Safe Rest 1 week before using again.",
    manaCost: 9,
  },

  // ── LIGHTNING SPELLS (Page 48) ──────────────────────────────
  {
    name: "Zap",
    sourceKey: "zap",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "lightning" as SpellSchool,
    actionCost: 1,
    range: "12",
    formula: "2d8 + (Math.floor(level / 5) * 4)",
    description:
      "On miss: the lightning strikes YOU instead. High levels: on hit, +4 damage every 5 levels.",
    manaCost: 0,
  },
  {
    name: "Overload",
    sourceKey: "overload",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "lightning" as SpellSchool,
    actionCost: 1,
    range: "2",
    formula: "2d8 + (Math.floor(level / 5) * 4)",
    description:
      "AoE. Castable only if Charged, ending the condition. High levels: +4 damage every 5 levels.",
    manaCost: 0,
  },
  {
    name: "Arc Lightning",
    sourceKey: "arc-lightning",
    catalogVersion: 1,
    type: "spell",
    spellTier: 1,
    spellSchool: "lightning" as SpellSchool,
    actionCost: 2,
    range: "12",
    formula: "3d8",
    description:
      "Also hits the next closest creature (if you're the closest, that's you!). Upcast: +4 damage.",
    manaCost: 1,
  },
  {
    name: "Alacrity",
    sourceKey: "alacrity",
    catalogVersion: 1,
    type: "spell",
    spellTier: 2,
    spellSchool: "lightning" as SpellSchool,
    actionCost: 0,
    range: "self",
    formula: "",
    description:
      "(1/turn) Teleport up to your Speed and gain Charged. Castable on your turn, while Defending, or after taking damage. Upcast: +4 spaces.",
    manaCost: 2,
  },
  {
    name: "Stormlash",
    sourceKey: "stormlash",
    catalogVersion: 1,
    type: "spell",
    spellTier: 3,
    spellSchool: "lightning" as SpellSchool,
    actionCost: 2,
    range: "line 12",
    formula: "3d8+4",
    description:
      "AoE. Ignores metal armor. Failed STR save: Dazed (Incapacitated instead if failed by 5+). Metal-heavy creatures roll with disadvantage. Upcast: +4 damage.",
    manaCost: 3,
  },
  {
    name: "Electrickery",
    sourceKey: "electrickery",
    catalogVersion: 1,
    type: "spell",
    spellTier: 4,
    spellSchool: "lightning" as SpellSchool,
    actionCost: 3,
    range: "8",
    formula: "",
    description:
      "Castable when an ally is attacked (costs 1 Action instead if Charged, ending the condition). The ally teleports away; a creature that fails a WIL save teleports into their space and becomes the target instead. Upcast: +2 Range.",
    manaCost: 4,
  },
  {
    name: "Electrocharge",
    sourceKey: "electrocharge",
    catalogVersion: 1,
    type: "spell",
    spellTier: 5,
    spellSchool: "lightning" as SpellSchool,
    actionCost: 2,
    range: "4",
    formula: "",
    description:
      "Concentration (1 min). Target gains Charged, +1 max action, +5 Defense, 2× Speed, and advantage on DEX saves. Upcast: +4 Reach.",
    manaCost: 5,
  },
  {
    name: "Ride the Lightning",
    sourceKey: "ride-the-lightning",
    catalogVersion: 1,
    type: "spell",
    spellTier: 6,
    spellSchool: "lightning" as SpellSchool,
    actionCost: 3,
    range: "12",
    formula: "d88",
    description:
      "AoE. Teleport to a spot you can see (swap places with a willing creature there). Adjacent creatures take d88 damage and are knocked back 2 spaces; those moved 2+ spaces are also Prone, Dazed, and deafened for 1 day. Upcast: +1 Knockback.",
    manaCost: 6,
  },
  {
    name: "Seething Storm",
    sourceKey: "seething-storm",
    catalogVersion: 1,
    type: "spell",
    spellTier: 9,
    spellSchool: "lightning" as SpellSchool,
    actionCost: 3,
    range: "4",
    formula: "d88",
    description:
      "Concentration (1 min). Become a storm cloud: fly, move for free 1/round, attacks against you have disadvantage. At the end of each turn, strike up to 4 creatures within Reach 4 for d88 damage (each struck at most once per round). Costs 3 Actions each round to maintain. Upcast: +2 Reach, +2 bolts per round. Must Safe Rest 1 week before using again.",
    manaCost: 9,
  },

  // ── WIND SPELLS (Page 49) ───────────────────────────────────
  {
    name: "Razor Wind",
    sourceKey: "razor-wind",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "wind" as SpellSchool,
    actionCost: 1,
    range: "12",
    formula: "1d4 + (Math.floor(level / 5) * 3)",
    description:
      "Slashing (Vicious). Choose: roll with advantage, OR also damage 1 adjacent target. High levels: +3 damage every 5 levels.",
    manaCost: 0,
  },
  {
    name: "Breath of Life",
    sourceKey: "breath-of-life",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "wind" as SpellSchool,
    actionCost: 1,
    range: "6 (+2 every 5 levels)",
    formula: "1d4 + (Math.floor(level / 5) * 2)",
    description:
      "Restore HP to a Dying creature. If healed for 4+, they also regain 1 action. High levels: +2 Range and healing every 5 levels.",
    manaCost: 0,
  },
  {
    name: "Blustery Gale",
    sourceKey: "blustery-gale",
    catalogVersion: 1,
    type: "spell",
    spellTier: 1,
    spellSchool: "wind" as SpellSchool,
    actionCost: 2,
    range: "12",
    formula: "3d4",
    description:
      "Bludgeoning. Knockback 2 (roll with advantage vs flying/Small/Tiny targets). Forced movement deals +5 damage instead of rolling additional dice. Upcast: +1 knockback.",
    manaCost: 1,
  },
  {
    name: "Barrier of Wind",
    sourceKey: "barrier-of-wind",
    catalogVersion: 1,
    type: "spell",
    spellTier: 2,
    spellSchool: "wind" as SpellSchool,
    actionCost: 0,
    range: "self",
    formula: "",
    description:
      "Castable only while Defending vs Ranged attacks. Ranged attacks deal half damage against you this round. Upcast: extend this effect to creatures within +1 Reach.",
    manaCost: 2,
  },
  {
    name: "Fly",
    sourceKey: "fly",
    catalogVersion: 1,
    type: "spell",
    spellTier: 3,
    spellSchool: "wind" as SpellSchool,
    actionCost: 1,
    range: "1",
    formula: "",
    description:
      "Concentration (10 min). Grant a creature a flying Speed; they can move KEY spaces for free on their turn. Upcast: +1 target, +4 Reach.",
    manaCost: 3,
  },
  {
    name: "Eye of the Storm",
    sourceKey: "eye-of-the-storm",
    catalogVersion: 1,
    type: "spell",
    spellTier: 4,
    spellSchool: "wind" as SpellSchool,
    actionCost: 2,
    range: "3",
    formula: "4d4+10",
    description:
      "AoE. Bludgeoning damage to enemies. Failed STR save: relocated to within 1 space of the storm's Reach. Upcast: +1 Reach.",
    manaCost: 4,
  },
  {
    name: "Updraft",
    sourceKey: "updraft",
    catalogVersion: 1,
    type: "spell",
    spellTier: 5,
    spellSchool: "wind" as SpellSchool,
    actionCost: 2,
    range: "12",
    formula: "",
    description:
      "AoE 5×5. Damage: 20 minus the target's DEX save. On 10+ damage, they land Prone and Dazed. Upcast: +2 damage.",
    manaCost: 5,
  },
  {
    name: "Thousand Cuts",
    sourceKey: "thousand-cuts",
    catalogVersion: 1,
    type: "spell",
    spellTier: 6,
    spellSchool: "wind" as SpellSchool,
    actionCost: 3,
    range: "12",
    formula: "d44a",
    description:
      "AoE. Slashing, rolled with advantage. Also damages enemies within Reach 1 of your target. Upcast: +1 Reach.",
    manaCost: 6,
  },
  {
    name: "Boisterous Winds",
    sourceKey: "boisterous-winds",
    catalogVersion: 1,
    type: "spell",
    spellTier: 7,
    spellSchool: "wind" as SpellSchool,
    actionCost: 2,
    range: "12",
    formula: "",
    description:
      "Concentration (1 min). Reach 12. You and up to 12 allies gain: ranged attacks have disadvantage against you, a flying Speed of 12, and free movement 1/round. Upcast: +1 minute or +2 targets.",
    manaCost: 7,
  },
  {
    name: "Vicious Mockery",
    sourceKey: "vicious-mockery",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "wind" as SpellSchool,
    actionCost: 1,
    range: "12",
    formula: "1d4 + INT + (Math.floor(level / 5) * 2)",
    description:
      "Songweaver only. Psychic damage (ignores armor). On hit: target is Taunted during their next turn. High levels: +2 damage every 5 levels.",
    manaCost: 0,
  },

  // ── RADIANT SPELLS (Page 50) ────────────────────────────────
  {
    name: "Rebuke",
    sourceKey: "rebuke",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "radiant" as SpellSchool,
    actionCost: 1,
    range: "4",
    formula: "1d6 + (Math.floor(level / 5) * 2)",
    description:
      "Ignores armor. 2× damage against undead or cowardly (Frightened or behind Cover) targets. High levels: +2 damage every 5 levels.",
    manaCost: 0,
  },
  {
    name: "True Strike",
    sourceKey: "true-strike",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "radiant" as SpellSchool,
    actionCost: 1,
    range: "4",
    formula: "",
    description:
      "Target gains advantage (ignoring all sources of disadvantage) and +1 Reach on their next melee attack this encounter.",
    manaCost: 0,
  },
  {
    name: "Heal",
    sourceKey: "heal",
    catalogVersion: 1,
    type: "spell",
    spellTier: 1,
    spellSchool: "radiant" as SpellSchool,
    actionCost: 1,
    range: "1",
    formula: "1d6+KEY",
    description:
      "Heal a target 1d6+KEY HP. If 5+ mana spent, also heal a negative condition (e.g., Blind, 1 Wound). Upcast: choose 1 — +1d6, +1 target, OR +4 Reach.",
    manaCost: 1,
  },
  {
    name: "Warding Bond",
    sourceKey: "warding-bond",
    catalogVersion: 1,
    type: "spell",
    spellTier: 2,
    spellSchool: "radiant" as SpellSchool,
    actionCost: 0,
    range: "",
    formula: "",
    description:
      "Concentration (1 min). Make an ally your ward: they take half damage−2 from all attacks; you take the same amount. Upcast: +2 damage reduction.",
    manaCost: 2,
  },
  {
    name: "Shield of Justice",
    sourceKey: "shield-of-justice",
    catalogVersion: 1,
    type: "spell",
    spellTier: 3,
    spellSchool: "radiant" as SpellSchool,
    actionCost: 0,
    range: "self",
    formula: "",
    description:
      "Castable only while Defending. Enemies who attack you this round are Blinded until the end of their next turn, and you deal damage back (ignoring armor) equal to the damage you took. Upcast: +5 Damage OR +5 Defense.",
    manaCost: 3,
  },
  {
    name: "Condemn",
    sourceKey: "condemn",
    catalogVersion: 1,
    type: "spell",
    spellTier: 4,
    spellSchool: "radiant" as SpellSchool,
    actionCost: 2,
    range: "4",
    formula: "30",
    description:
      "Target an enemy that crit you or an ally this round. Damage cannot be reduced. The next attack made against that enemy gains advantage. Upcast: +1 Reach, +1 advantage.",
    manaCost: 4,
  },
  {
    name: "Vengeance",
    sourceKey: "vengeance",
    catalogVersion: 1,
    type: "spell",
    spellTier: 5,
    spellSchool: "radiant" as SpellSchool,
    actionCost: 2,
    range: "1 (+1 every 5 levels)",
    formula: "1d100",
    description:
      "Target a creature that attacked a Dying ally or reduced one to 0 HP this round. High levels: +1 Reach every 5 levels. Upcast: +1 Reach, roll with advantage.",
    manaCost: 5,
  },
  {
    name: "Sacrifice",
    sourceKey: "sacrifice",
    catalogVersion: 1,
    type: "spell",
    spellTier: 6,
    spellSchool: "radiant" as SpellSchool,
    actionCost: 1,
    range: "4",
    formula: "",
    description:
      "Reduce yourself to 0 HP (cannot rise above 0 until Safe Rest). Heal your max HP, divided among any other creatures. Revive a creature dead within the past minute by giving 20+ HP (also heals 2 Wounds), if never revived by this spell before. Upcast: +4 Reach.",
    manaCost: 6,
  },
  {
    name: "Redeem",
    sourceKey: "redeem",
    catalogVersion: 1,
    type: "spell",
    spellTier: 9,
    spellSchool: "radiant" as SpellSchool,
    range: "1 mile",
    formula: "",
    description:
      "AoE. Casting time: 1 Day. Requires and consumes a diamond worth 10,000 gp. Revive any number of creatures that died in the past year, provided they didn't die of old age or have been revived by this spell before.",
    manaCost: 9,
  },
  {
    name: "Lifebinding Spirit",
    sourceKey: "lifebinding-spirit",
    catalogVersion: 1,
    type: "spell",
    spellTier: 1,
    spellSchool: "radiant" as SpellSchool,
    actionCost: 1,
    range: "4",
    formula: "1d6+WIL",
    description:
      "Shepherd only. Summon a companion (immune to harm) that follows you until you recast this spell, Safe Rest, or it's healed a number of times equal to mana spent summoning it. Action: Reach 4, it attacks for 1d6+WIL (ignoring armor) or heals the same. Upcast: increment its die (max d12), +1 healing use.",
    manaCost: 1,
  },

  // ── NECROTIC SPELLS (Page 51) ───────────────────────────────
  {
    name: "Entice",
    sourceKey: "entice",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 1,
    range: "12",
    formula: "1dstepdice(level,4,6,8,10,12)",
    description:
      "Ignores armor. Target moves toward you a number of spaces equal to the Primary Die rolled. High levels: die size increments 1 step every 5 levels.",
    manaCost: 0,
  },
  {
    name: "Withering Touch",
    sourceKey: "withering-touch",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 1,
    range: "1",
    formula: "1d12 + (Math.floor(level / 5) * 6)",
    description: "On hit: Target is considered undead for 1 round.",
    manaCost: 0,
  },
  {
    name: "Shadow Trap",
    sourceKey: "shadow-trap",
    catalogVersion: 1,
    type: "spell",
    spellTier: 1,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 1,
    range: "1",
    formula: "3d12",
    description:
      "Concentration (1 min). Damages the next creature to move adjacent to you. Small/Tiny targets are also Restrained until you stop concentrating or they escape. Upcast: +1 size category, +1d12 damage on escape.",
    manaCost: 1,
  },
  {
    name: "Dread Visage",
    sourceKey: "dread-visage",
    catalogVersion: 1,
    type: "spell",
    spellTier: 2,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 0,
    range: "self",
    formula: "1d12",
    description:
      "Castable only while Defending. Melee attackers this round take 1d12 damage and are Frightened. Costs 2 mana less while Dying. Upcast: +2 damage, +2 Defense.",
    manaCost: 2,
  },
  {
    name: "Vampiric Greed",
    sourceKey: "vampiric-greed",
    catalogVersion: 1,
    type: "spell",
    spellTier: 3,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 2,
    range: "1",
    formula: "4d12",
    description:
      "AoE. Deal 4d12 to all adjacent creatures; heal HP equal to damage dealt, then gain 1 Wound (plus 1 more Wound per creature that survived). Upcast: +1 Reach OR +10 Damage.",
    manaCost: 3,
  },
  {
    name: "Vigor Mortis",
    sourceKey: "vigor-mortis",
    catalogVersion: 1,
    type: "spell",
    spellTier: 4,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 1,
    range: "8",
    formula: "",
    description:
      "Castable only when an ally drops to 0 HP. Concentration (1 min). Their max actions do not change, they skip STR saves to act, and taking damage while Dying causes 1 fewer Wound (min 1). Upcast: +10 temp HP.",
    manaCost: 4,
  },
  {
    name: "Gangrenous Burst",
    sourceKey: "gangrenous-burst",
    catalogVersion: 1,
    type: "spell",
    spellTier: 5,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 2,
    range: "8",
    formula: "3d20",
    description:
      "AoE, Reach up to 8. Damaged creatures make a STR save (disadvantage if Bloodied) or take 3d20 (ignoring armor); half on save. Upcast: +10 damage.",
    manaCost: 5,
  },
  {
    name: "Unspeakable Word",
    sourceKey: "unspeakable-word",
    catalogVersion: 1,
    type: "spell",
    spellTier: 6,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 2,
    range: "8",
    formula: "d66a",
    description:
      "Ignores armor. Failed INT save (disadvantage if Bloodied or Frightened) or take full damage; on a save, you both take half instead. Upcast: +1 DC, +10 damage.",
    manaCost: 6,
  },
  {
    name: "Creeping Death",
    sourceKey: "creeping-death",
    catalogVersion: 1,
    type: "spell",
    spellTier: 7,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 3,
    range: "8",
    formula: "4d20",
    description:
      "AoE. If this kills the creature, repeat the damage against another undamaged creature within Reach 8 of it; keep repeating until a target survives or none remain in Reach. Upcast: +10 damage.",
    manaCost: 7,
  },
  {
    name: "Shadow Blast",
    sourceKey: "shadow-blast",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 1,
    range: "8",
    formula: "incrementdice(1,level)d12+KEY",
    description: "Shadowmancer only. 1/round. High levels: +1d12 every 5 levels.",
    manaCost: 0,
  },
  {
    name: "Summon Shadow",
    sourceKey: "summon-shadow",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "necrotic" as SpellSchool,
    actionCost: 1,
    range: "1",
    formula: "1d12",
    description:
      "Shadowmancer only. Summon an adjacent shadow minion (max of INT or Level, whichever is lower); it follows the minion rules and vanishes immediately outside combat. Action (1/turn): all your minions move 6 then attack for 1d12 at Reach 1. High levels: +1 Reach every 5 levels.",
    manaCost: 0,
  },

  // ── UTILITY SPELLS (Pages 52-53) ────────────────────────────
  // "These spells are not learned as other cantrips; instead some classes
  // can choose from among these additional spells as they level up."
  // spellSchool is "utility" for all of them (matching this app's existing
  // convention), independent of the elemental flavor in their book tag
  // (FIRE/LIGHTNING/ICE/WIND/RADIANT/NECROTIC UTILITY CANTRIP) — that tag
  // is purely organizational in the book, not a mechanical restriction.

  // Fire
  {
    name: "Firebrand",
    sourceKey: "firebrand",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "touch",
    formula: "",
    description:
      "Touch a surface and secretly mark it with a symbol or brief message. Speaking a chosen command word while nearby reveals it.",
    manaCost: 0,
  },
  {
    name: "Fire Step",
    sourceKey: "fire-step",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    range: "sight",
    formula: "",
    description: "Casting time: 1 Minute. Teleport to a fire source you can see.",
    manaCost: 0,
  },
  {
    name: "Kindle",
    sourceKey: "kindle",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "6",
    formula: "",
    description:
      "Conjure a minor visual illusion. OR: ignite a small, unheld item within Reach 6.",
    manaCost: 0,
  },

  // Lightning
  {
    name: "Spark Buddy",
    sourceKey: "spark-buddy",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    range: "6",
    formula: "",
    description:
      "Casting time: 1 Minute. Conjure a Tiny (squirrel-sized) helper for up to 1 hour: it can fetch Tiny objects, open unlocked doors, illuminate a small area, or deliver a harmless shock. Dissipates if it takes damage or moves more than 6 spaces from you.",
    manaCost: 0,
  },
  {
    name: "Spark Step",
    sourceKey: "spark-step",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "4",
    formula: "",
    description: "Teleport to a metal object.",
    manaCost: 0,
  },
  {
    name: "Tempest’s Command",
    sourceKey: "tempests-command",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "",
    formula: "",
    description:
      "Dispel a minor magical effect, or temporarily suppress a stronger one (the more powerful the enchantment, the shorter the suppression). OR: Voice of Thunder — your eyes glow and your voice is amplified to a thunder-like volume for 1 minute.",
    manaCost: 0,
  },

  // Ice
  {
    name: "Chillcraft",
    sourceKey: "chillcraft",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "self",
    formula: "",
    description:
      "Chill: harmlessly freeze, thaw, or move a bath-sized amount of water near you. OR: Craft — conjure a sheet of opaque, mirror-like, or transparent ice the size of a window or door.",
    manaCost: 0,
  },
  {
    name: "Ice Disk",
    sourceKey: "ice-disk",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    range: "self",
    formula: "",
    description:
      "Casting time: 1 Minute. Conjure a floating ice disk that follows you and carries moderately heavy weight, for 1 hour or until you recast this spell.",
    manaCost: 0,
  },
  {
    name: "Wintry Scrying",
    sourceKey: "wintry-scrying",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    range: "water patch",
    formula: "",
    description:
      "Casting time: 1 Minute. Turn a small patch of water into a reflective icy mirror; looking through it grants vision of any location you desire near that water for 10 minutes.",
    manaCost: 0,
  },

  // Wind
  {
    name: "Wind Whisper",
    sourceKey: "wind-whisper",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "unlimited",
    formula: "",
    description:
      "Whisper a message into the wind; it is secretly carried to a specified target anywhere wind could reach.",
    manaCost: 0,
  },
  {
    name: "Helpful Gust",
    sourceKey: "helpful-gust",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "6",
    formula: "",
    description:
      "Gently move a Tiny unheld item in any direction. OR: generate an illusory scent.",
    manaCost: 0,
  },
  {
    name: "Feather Fall",
    sourceKey: "feather-fall",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1, // Reaction is essentially an action cost in Nimble
    range: "6",
    formula: "",
    description: "Reaction: cause a falling creature to gently float to the ground.",
    manaCost: 0,
  },

  // Radiant
  {
    name: "Light",
    sourceKey: "light",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "touch",
    formula: "",
    description: "Cause an item to brightly glow as a torch with radiant light for as long as you hold it.",
    manaCost: 0,
  },
  {
    name: "Beautify",
    sourceKey: "beautify",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "touch",
    formula: "",
    description:
      "Clean stains or repair a small tear/break in a non-magical item, or conjure tiny beautiful things: flowers, butterflies, etc.",
    manaCost: 0,
  },
  {
    name: "Bond of Peace",
    sourceKey: "bond-of-peace",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "sight",
    formula: "",
    description:
      "Bond: telepathically communicate simple thoughts or feelings with a friendly creature you can see. OR: Peace — imbue your spoken words with calming magic, granting advantage on any check made to soothe anger or fear in creatures who can hear you.",
    manaCost: 0,
  },

  // Necrotic
  {
    name: "Gravecraft",
    sourceKey: "gravecraft",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    range: "touch",
    formula: "",
    description:
      "Gravemark (1 Action): magically soil a surface with blood, filth, or other disgusting things. OR Gravework (1 Minute): shape or move a body-sized plot of earth.",
    manaCost: 0,
  },
  {
    name: "False Face",
    sourceKey: "false-face",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    range: "self",
    formula: "",
    description:
      "Casting time: 1 Minute. Change your appearance to look like someone else for 10 minutes. Requires a piece of them.",
    manaCost: 0,
  },
  {
    name: "Thought Leech",
    sourceKey: "thought-leech",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "utility" as SpellSchool,
    actionCost: 1,
    range: "6",
    formula: "",
    description:
      "Read the surface thoughts of a creature. They can sense you doing this and may not like it.",
    manaCost: 0,
  },

  // ── TERRAMANCY SPELLS (alpha reference sheet, 3rd Party Creator License) ──
  {
    name: "Bouldercast",
    sourceKey: "bouldercast",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "terramancy" as SpellSchool,
    actionCost: 2,
    range: "6",
    formula: "incrementdice(1,level)d12",
    description:
      "Deals half as much damage to a creature adjacent to your target. High Levels: +1d12 damage every 5 levels.",
  },
  {
    name: "Vinelash",
    sourceKey: "vinelash",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "terramancy" as SpellSchool,
    actionCost: 1,
    range: "8",
    formula: "1d4",
    description:
      "Single Target. You may move the target 1 space instead of damaging them. On crit: you may Blind them instead (until the end of their next turn). High Levels: +1d4 damage or +1 space every 5 levels.",
  },
  {
    name: "Pillar of Stone",
    sourceKey: "pillar-of-stone",
    catalogVersion: 1,
    type: "spell",
    spellTier: 1,
    spellSchool: "terramancy" as SpellSchool,
    actionCost: 2,
    range: "6",
    formula: "",
    description:
      "Concentration (1 min). A pillar of stone in 1 space shoots forth from the ground. Any creatures entirely in that space are lifted up to 20 ft. in the air. If there is a solid ceiling, you may Restrain the creature against it. Upcast: +10 ft. height or +1 space.",
  },
  {
    name: "Earthward",
    sourceKey: "earthward",
    catalogVersion: 1,
    type: "spell",
    spellTier: 2,
    spellSchool: "terramancy" as SpellSchool,
    actionCost: 2,
    range: "self",
    formula: "",
    description:
      "Reaction: When you would be damaged or moved against your will. Reduce ALL damage taken this round by 20 and you cannot be moved this round. Upcast: +5 damage reduction.",
  },
  {
    name: "Mendberry",
    sourceKey: "mendberry",
    catalogVersion: 1,
    type: "spell",
    spellTier: 3,
    spellSchool: "terramancy" as SpellSchool,
    actionCost: 1,
    range: "6",
    formula: "",
    description:
      "Summon a magical bush (max 1) within Reach 6, with KEY healing berries. Any creature adjacent to the bush can eat one or more healing berries to recover 5 HP per berry. Picking 1 berry per turn is free, each additional one costs 1 action. Upcast: +1 berry and +1 HP.",
  },
  {
    name: "Crush",
    sourceKey: "crush",
    catalogVersion: 1,
    type: "spell",
    spellTier: 4,
    spellSchool: "terramancy" as SpellSchool,
    actionCost: 2,
    range: "6",
    formula: "2d20+20",
    description: "2 Targets. Crush a Hampered target. Upcast: +10 damage.",
  },
  {
    name: "Sudden Pit",
    sourceKey: "sudden-pit",
    catalogVersion: 1,
    type: "spell",
    spellTier: 5,
    spellSchool: "terramancy" as SpellSchool,
    actionCost: 2,
    range: "6",
    formula: "",
    description:
      "Up to 1 minute. Open up a pit in a 2x2 area in the ground. Creatures entirely in the area fall 10 ft. landing Prone. Upcast: +10 ft. deeper, or +2 spaces.",
  },
  {
    name: "Stone’s Embrace",
    sourceKey: "stones-embrace",
    catalogVersion: 1,
    type: "spell",
    spellTier: 6,
    spellSchool: "terramancy" as SpellSchool,
    actionCost: 2,
    range: "6",
    formula: "",
    description:
      "AoE. Concentration (1 min). Friendly creatures gain +10 Defense. Upcast: +5 Defense.",
  },
  {
    name: "Bramblemaw",
    sourceKey: "bramblemaw",
    catalogVersion: 1,
    type: "spell",
    spellTier: 7,
    spellSchool: "terramancy" as SpellSchool,
    actionCost: 3,
    range: "6",
    formula: "",
    description:
      "AoE. Up to KEY enemies must make a DEX save or be Restrained. Each suffers 20 damage minus their save. Repeat this damage each time they attempt to escape. Upcast: +10 damage.",
  },

  // ── HEXBINDER SPELLS (alpha reference sheet, 3rd Party Creator License) ──
  {
    name: "Misery",
    sourceKey: "misery",
    catalogVersion: 1,
    type: "spell",
    spellTier: 1,
    spellSchool: "hexbinder" as SpellSchool,
    actionCost: 2,
    range: "8",
    formula: "1d8+LVL",
    description: "Single Target. On hit: apply an Affliction. On crit: apply 2 instead.",
  },
  {
    name: "Life Bloom",
    sourceKey: "life-bloom",
    catalogVersion: 1,
    type: "spell",
    spellTier: 1,
    spellSchool: "hexbinder" as SpellSchool,
    actionCost: 1,
    range: "8",
    formula: "",
    description:
      "Single Target+. Consume 1 of your own Hit Dice, and 1 more from a willing target. Heal your target and another creature within Reach the sum of those dice.",
  },
  {
    name: "Twitch Curse",
    sourceKey: "twitch-curse",
    catalogVersion: 1,
    type: "spell",
    spellTier: 2,
    spellSchool: "hexbinder" as SpellSchool,
    actionCost: 1,
    range: "8",
    formula: "",
    description:
      "Single Target. Reaction: When attacked by a creature within Reach, Defend for free. First move the attacker 1 space (+1 space for each Affliction they have). Opportunity attacks triggered this way are made with advantage instead of disadvantage. If you are no longer a valid target (e.g., the attacker is dead, you are out of line of sight/Reach/Range), the triggering attack misses.",
  },
  {
    name: "Bloodcurse",
    sourceKey: "bloodcurse",
    catalogVersion: 1,
    type: "spell",
    spellTier: 2,
    spellSchool: "hexbinder" as SpellSchool,
    actionCost: 2,
    range: "8",
    formula: "1d4+LVL",
    description:
      "Single Target. Increment the die size for each Affliction the target has. On hit: Target becomes secretly Bloodcursed, suffering 2x the next damage they deal (ignoring armor).",
  },
  {
    name: "Wyrding Strands",
    sourceKey: "wyrding-strands",
    catalogVersion: 1,
    type: "spell",
    spellTier: 3,
    spellSchool: "hexbinder" as SpellSchool,
    actionCost: 2,
    range: "8",
    formula: "2d6",
    description:
      "AoE. Move creatures in a 4x4 area a total of the rolled spaces, divided among them as you choose. Large or larger creatures move half as far.",
  },
  {
    name: "Frogify",
    sourceKey: "frogify",
    catalogVersion: 1,
    type: "spell",
    spellTier: 3,
    spellSchool: "hexbinder" as SpellSchool,
    actionCost: 2,
    range: "8",
    formula: "",
    description:
      "Single Target. On a failed WIL save, turn a creature into a harmless, armorless, tiny FROG for up to 1 min. It can still move but not attack (except for bugs). On a save, they are partially transformed, only reducing their armor to none instead. Damage or casting this again ends the effect.",
  },
  {
    name: "Malediction",
    sourceKey: "malediction",
    catalogVersion: 1,
    type: "spell",
    spellTier: 4,
    spellSchool: "hexbinder" as SpellSchool,
    actionCost: 2,
    range: "4",
    formula: "",
    description:
      "Multi-target. Roll KEYd4 Primary Dice. For each hit, deal LVL damage to a creature within Reach (ignoring armor). Max 1 die per creature.",
  },
  {
    name: "Circle of Thorns",
    sourceKey: "circle-of-thorns",
    catalogVersion: 1,
    type: "spell",
    spellTier: 4,
    spellSchool: "hexbinder" as SpellSchool,
    actionCost: 2,
    range: "8",
    formula: "",
    description:
      "Single Target. Fill every empty adjacent space around a creature with a growth of thorns. Creatures who enter the area must make a DEX save or take KEYd6 damage and become Restrained, half on save. Lasts up to 1 min or until it has dealt damage 3 times.",
  },
  {
    name: "Terror",
    sourceKey: "terror",
    catalogVersion: 2,
    type: "spell",
    spellTier: 5,
    spellSchool: "hexbinder" as SpellSchool,
    actionCost: 2,
    range: "8",
    formula: "LVL*1d4",
    description:
      "Single Target. Damage: LVL×1d4 (ignoring armor). Advantage for each Affliction on the target.",
  },

  // ── AFFLICTIONS (alpha reference sheet, 3rd Party Creator License) ──
  // Named "Affliction - <name>" deliberately, per the name they're catalog
  // entries for a status condition applied by another spell's effect (e.g.
  // Misery, Bloodcurse), not something cast on their own: `spellTier: 0`
  // is authored explicitly (the source sheet gives no tier at all — this
  // is a stand-in, not a transcribed value) rather than left to whichever
  // of the three "?? 0" fallbacks in SpellsTab.tsx happens to read it —
  // same rule as `InventoryItem.category`: authored in the data, never
  // guessed at a read site. It still sorts these under the "Cantrips"
  // filter, an imperfect fit accepted for now (the "Affliction - " prefix
  // is what actually groups/searches them); fixing that display grouping
  // is a separate batch. No actionCost either (RowMeta.tsx omits the
  // action-cost badge entirely when it's absent, which is correct here —
  // nothing is ever "spent" to have one of these active).
  //
  // Two page-level rules from the source sheet, deliberately NOT repeated
  // in each entry below (redundant boilerplate 8 times over):
  // - Affliction-specific: a creature can have at most INT different
  //   Afflictions on it at once.
  // - NOT Affliction-specific, repeated here only for context: an
  //   Affliction lasts as long as the caster maintains Concentration
  //   (broken on a DC 10 STR save when crit) — that's the same generic
  //   Concentration rule already in the Core Rules, not something unique
  //   to Afflictions.
  {
    name: "Affliction - Brittle",
    sourceKey: "affliction-brittle",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "hexbinder" as SpellSchool,
    range: "",
    formula: "",
    description:
      "Target suffers 1 damage for each space it moves (or is moved). Level 10: 2 damage/space.",
  },
  {
    name: "Affliction - Dimmed",
    sourceKey: "affliction-dimmed",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "hexbinder" as SpellSchool,
    range: "",
    formula: "",
    description: "Target has disadvantage 2 when attacking beyond Range/Reach 1.",
  },
  {
    name: "Affliction - Doomed",
    sourceKey: "affliction-doomed",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "hexbinder" as SpellSchool,
    range: "",
    formula: "",
    description: "1/encounter. Maximize the next roll against target.",
  },
  {
    name: "Affliction - Enfeebled",
    sourceKey: "affliction-enfeebled",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "hexbinder" as SpellSchool,
    range: "",
    formula: "",
    description: "Target falls Prone at the end of each of your turns.",
  },
  {
    name: "Affliction - Frenzied",
    sourceKey: "affliction-frenzied",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "hexbinder" as SpellSchool,
    range: "",
    formula: "",
    description:
      "Target's first attack each round MUST be against the nearest random creature (acts first amongst monsters).",
  },
  {
    name: "Affliction - Pestilent",
    sourceKey: "affliction-pestilent",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "hexbinder" as SpellSchool,
    range: "",
    formula: "",
    description:
      "On death of target: creatures within Reach 2 of it suffer LVL damage (ignoring armor).",
  },
  {
    name: "Affliction - Sundered",
    sourceKey: "affliction-sundered",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "hexbinder" as SpellSchool,
    range: "",
    formula: "",
    description: "Target's armor reduced 1 step.",
  },
  {
    name: "Affliction - Withered",
    sourceKey: "affliction-withered",
    catalogVersion: 1,
    type: "spell",
    spellTier: 0,
    spellSchool: "hexbinder" as SpellSchool,
    range: "",
    formula: "",
    description:
      "Target's first attack against a friendly creature each round is made with disadvantage.",
  },
];

export function getSpellsBySchool(school: SpellSchool) {
  return BASE_SPELLS.filter((s) => s.spellSchool === school);
}

export function getSpellsByTier(tier: number) {
  return BASE_SPELLS.filter((s) => s.spellTier === tier);
}
