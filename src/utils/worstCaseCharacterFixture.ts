/**
 * @file Builds a realistic worst-case {@link NimbleCharacter} for the
 * room-metadata sizing study (see `scripts/measure-room-metadata.ts` and the
 * accompanying report).
 *
 * "Worst case" here means the heaviest sheet a table is reasonably likely to
 * produce, not an adversarial one: a level 10 character (near the level cap),
 * a full inventory (`10 + STR` slots, all spent), a realistic spell/action
 * list for that level, and every free-text field filled in — including a
 * few GM-authored custom entries and a few catalog entries a player has
 * edited away from the book text. Built from the real {@link BASE_SPELLS}/
 * {@link BASIC_EQUIPMENTS} catalogs and the real `catalogCopy.ts` copy
 * functions, not a hand-typed object, so the measurement reflects the actual
 * shape `NimbleCharacter` records take in production, not an idealization of
 * it — same reasoning as the real-armor-formula fix documented in
 * `computeDefense.test.ts` (CLAUDE.md).
 *
 * Free-text fields (notes, custom descriptions, ability blurbs) are written
 * in French with accented characters on purpose: this extension's actual
 * players write their notes in French, and accented characters cost 2 UTF-8
 * bytes each where plain ASCII costs 1 — a real, measurable effect on the
 * budget that an all-ASCII lorem-ipsum fixture would hide.
 */

import type { CharacterAction, InventoryItem, NimbleCharacter } from "../types/character";
import { CURRENT_SCHEMA_VERSION } from "../types/character";
import { BASE_SPELLS } from "../data/spells";
import { BASIC_EQUIPMENTS } from "../data/equipment";
import {
  copyItemFromCatalog,
  copySpellFromCatalog,
  createCustomItem,
  createCustomSpell,
} from "./catalogCopy";

/** Looks up a catalog entry by `sourceKey`, throwing loudly if it's gone missing (catalog drift). */
function findSpell(sourceKey: string): (typeof BASE_SPELLS)[number] {
  const entry = BASE_SPELLS.find((s) => s.sourceKey === sourceKey);
  if (!entry) throw new Error(`Fixture error: no spell with sourceKey "${sourceKey}" in BASE_SPELLS`);
  return entry;
}

function findItem(sourceKey: string): (typeof BASIC_EQUIPMENTS)[number] {
  const entry = BASIC_EQUIPMENTS.find((i) => i.sourceKey === sourceKey);
  if (!entry) throw new Error(`Fixture error: no item with sourceKey "${sourceKey}" in BASIC_EQUIPMENTS`);
  return entry;
}

/** Spell sourceKeys chosen for school/tier spread, not for a specific class's real spell list. */
const SPELL_SOURCE_KEYS = [
  "flame-dart",
  "ignite",
  "enchant-weapon",
  "ice-lance",
  "frost-shield",
  "zap",
  "arc-lightning",
  "razor-wind",
  "heal",
  "withering-touch",
];

/** Equipment sourceKeys chosen to spend exactly 11 of the fixture's 13 inventory slots (see {@link buildWorstCaseCharacter}). */
const EQUIPMENT_SOURCE_KEYS_1_SLOT = [
  "chain-shirt",
  "wooden-buckler",
  "rapier",
  "longbow",
  "dagger",
  "camping-supplies",
  "rope-50-ft",
  "lock-pick",
  "weapon-of-animosity",
  "wand-of-firestep",
];

/**
 * Builds the worst-case-realistic character used throughout the room-metadata
 * sizing study.
 *
 * @remarks Two catalog entries (the "Ignite" spell and the "Chain Shirt"
 * armor) are deliberately given a `description` that no longer matches their
 * catalog entry, simulating a player who edited the book text after adding
 * it — this is what strategy (a)'s "diverged copies must keep their stored
 * description" exception exercises. Every other non-custom entry keeps its
 * catalog description verbatim.
 */
export function buildWorstCaseCharacter(): NimbleCharacter {
  const spells: CharacterAction[] = SPELL_SOURCE_KEYS.map((key) => copySpellFromCatalog(findSpell(key)));

  const ignite = spells.find((s) => s.sourceKey === "ignite");
  if (ignite) {
    ignite.description =
      "Version maison : dégâts à un allié Ardent (relance le statut) et +2 dégâts si la cible est déjà Ardente. Note du MJ : ne pas oublier le bonus lors des combats de nuit.";
  }

  const customSpells: CharacterAction[] = [
    createCustomSpell({
      name: "Éclat Runique",
      tier: 3,
      manaCost: 3,
      school: "lightning",
      range: "6",
      formula: "3d8 + KEY",
      description:
        "Sort maison de Maître Aldebrand. Une volée de runes crépitantes explose au contact. Sur critique, la cible est Étourdie jusqu'à la fin de son prochain tour. Coûte 1 mana supplémentaire si lancé sous la pluie.",
    }),
    createCustomSpell({
      name: "Voile des Cendres",
      tier: 2,
      manaCost: 2,
      school: "necrotic",
      range: "4",
      formula: "2d10 + KEY",
      description:
        "Concentration (1 min). Un voile de cendres grises enveloppe la cible, la rendant Aveuglée face aux attaques venant de plus de 2 cases. Se dissipe si la cible subit des dégâts radiants.",
    }),
  ];

  const customActions: CharacterAction[] = [
    {
      id: "ac-fixture-melee-1",
      name: "Frappe du Bouclier Runique",
      type: "melee",
      range: "1",
      formula: "1d6 + STR",
      description:
        "Capacité de classe (Tempétueux, niveau 6). Un coup de bouclier chargé d'électricité statique. Sur touche, la cible est Repoussée d'une case et subit Choqué jusqu'au début de son prochain tour.",
      isFavorite: true,
      isCustom: true,
      actionCost: 1,
    },
    {
      id: "ac-fixture-ranged-1",
      name: "Tir Perçant des Cimes",
      type: "ranged",
      range: "10",
      formula: "1d8 + DEX",
      description:
        "Talent d'ancêtre elfique. Une flèche tirée avec une précision surnaturelle ignore le premier point de Défense de la cible issu d'un bouclier. Ne fonctionne qu'à l'extérieur, sous un ciel dégagé.",
      isFavorite: false,
      isCustom: true,
      actionCost: 1,
    },
    {
      id: "ac-fixture-ability-1",
      name: "Rugissement de Tempête",
      type: "ability",
      range: "4",
      formula: "",
      description:
        "1/combat. Action bonus. Tous les alliés dans le Rayon gagnent Avantage sur leur prochain jet de Sauvegarde de Force. Les ennemis dans le Rayon doivent réussir un jet de Sauvegarde de Volonté ou être Effrayés jusqu'à la fin de leur prochain tour.",
      isFavorite: false,
      isCustom: true,
      actionCost: 0,
    },
  ];

  const actions: CharacterAction[] = [...spells, ...customSpells, ...customActions];

  const catalogItems: InventoryItem[] = EQUIPMENT_SOURCE_KEYS_1_SLOT.map((key) =>
    copyItemFromCatalog(findItem(key)),
  );

  const chainShirt = catalogItems.find((i) => i.sourceKey === "chain-shirt");
  if (chainShirt) {
    chainShirt.description =
      "Cotte de maille rafistolée par le forgeron du village. Grince un peu au niveau de l'épaule gauche mais tient toujours le coup après trois campagnes.";
  }
  if (chainShirt) chainShirt.isEquipped = true;

  const healingPotions = { ...copyItemFromCatalog(findItem("healing-potion")), quantity: 4 };
  const torches = { ...copyItemFromCatalog(findItem("torch")), quantity: 2 };

  const customItems: InventoryItem[] = [
    createCustomItem({
      name: "Amulette du Vieux Sage",
      description:
        "Trouvée dans les ruines sous Val-Corbeau. Chaude au toucher lorsqu'un sort de nécromancie est lancé à moins de 10 cases. Le MJ garde le reste de ses propriétés secret pour l'instant.",
      slots: 1,
      formula: "",
      isFavorite: true,
      isArmor: false,
      category: "gear",
    }),
    createCustomItem({
      name: "Carnet de Croquis Ensorcelé",
      description:
        "Un carnet relié de cuir dont les pages se remplissent seules d'esquisses de ce que le porteur a vu en rêve la nuit précédente. Purement narratif, aucun effet mécanique connu à ce jour.",
      slots: 1,
      formula: "",
      isFavorite: false,
      isArmor: false,
      category: "gear",
    }),
  ];

  const inventory: InventoryItem[] = [...catalogItems, healingPotions, torches, ...customItems];

  const totalSlots = inventory.reduce((sum, item) => sum + item.slots * item.quantity, 0);
  const inventorySlots = 15; // 10 + STR(5), see `stats.str` below
  if (totalSlots !== inventorySlots) {
    throw new Error(
      `Fixture error: inventory uses ${totalSlots} slots but inventorySlots is ${inventorySlots} — the fixture must stay exactly full to represent the "full inventory" worst case.`,
    );
  }

  return {
    name: "Aldrick Cœur-de-Tempête",
    ancestry: "Demi-Elfe",
    class: "Tempétueux",
    level: 10,
    size: "Moyenne",
    speed: 6,

    hp: { current: 52, max: 68, temp: 5 },
    wounds: 1,
    maxWounds: 6,
    mana: 8,
    maxMana: 12,
    hitDice: { current: 7, max: 10, dice: "d8" },

    stats: { str: 5, dex: -1, int: 2, wil: 4 },
    keyStat: "wil",
    flawStat: "dex",
    saveMods: { str: "none", dex: "disadvantage", int: "none", wil: "advantage" },
    skills: {
      arcana: 8,
      examination: 3,
      finesse: 2,
      influence: 5,
      insight: 9,
      lore: 4,
      might: 1,
      naturecraft: 2,
      perception: 6,
      stealth: 0,
    },

    defense: { equippedItemId: chainShirt?.id, defenseBonus: 1 },
    initiativeBonus: 2,
    initiativeAdvantage: "advantage",
    combat: { actionsRemaining: 2, initiativeResult: 14 },

    languages: ["Commun", "Elfique", "Draconique", "Sylvestre"],
    abilities: [
      "Résistance des Tempêtes : avantage sur les jets de sauvegarde contre les effets de foudre et de vent.",
      "Sang-mêlé : compte comme Humain et Elfe pour toute condition d'ascendance.",
      "Œil de l'Orage : ignore le désavantage au tir à distance causé par une tempête ou de fortes pluies.",
      "Frappe Chargée : une fois par repos, la prochaine attaque au corps à corps réussie inflige Choqué.",
    ],
    notes:
      "Aldrick a grandi sur les falaises de Val-Tonnerre, où les tempêtes hivernales sont vénérées comme des messagères des anciens dieux du ciel. Il porte toujours autour du cou une pierre de foudre trouvée sur le corps de son père, mort en mer. Objectif de la campagne : retrouver le sanctuaire englouti mentionné dans son journal.",
    battleNotes:
      "Ouvrir le combat avec Éclat Runique si 3+ ennemis groupés. Garder Rugissement de Tempête pour les rencontres avec un boss. Éviter de s'engager en mêlée sans Frappe du Bouclier Runique disponible : sa Défense chute vite sans elle. Se replier derrière Elenya si Sauvegarde de Volonté ratée deux fois de suite.",
    spellNotes:
      "Le MJ a confirmé qu'Enchant Weapon peut cibler l'arc long d'Elenya en combat, pas seulement sa propre arme. Withering Touch ne fonctionne pas sur les constructs (confirmé lors de la session du donjon de fer). Toujours upcast Heal en cas de Blessure plutôt qu'un simple point de vie.",
    inventoryNotes:
      "La cotte de maille a été réparée deux fois déjà, envisager un remplacement avant la prochaine incursion en montagne. Le Carnet de Croquis Ensorcelé s'est rempli d'une image d'une tour brisée trois nuits de suite : à montrer au MJ hors session.",

    actions,
    inventory,
    inventorySlots,
    gold: 42,
    silver: 15,

    id: "fixture-character-0000-0000-0000-000000000000",
    ownerId: "fixture-player-0000-0000-0000-000000000000",
    updatedAt: Date.UTC(2026, 7, 20),
    kind: "player",

    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}
