/**
 * @file Pure sizing and slimming-strategy logic for the room-metadata
 * migration feasibility study (`scripts/measure-room-metadata.ts` and the
 * accompanying report — see the study's own session notes for scope: this
 * is measurement only, no change to how the app actually persists data).
 *
 * Node-only: {@link gzipBase64Size} uses `node:zlib`. This module must never
 * be imported from application/browser code — only from the measurement
 * script and this file's own test. The runtime audit tool that DOES ship in
 * the app is `metadataBudget.ts`, which depends only on the browser-safe
 * `byteSize.ts` and is deliberately kept separate from this file.
 *
 * Every "strategy" function here returns a NEW character/value rather than
 * mutating its input, so a strategy's effect can be measured by comparing
 * `byteSize` before and after without the two calls interfering with each
 * other.
 */

import { gzipSync } from "node:zlib";
import type { CharacterAction, InventoryItem, NimbleCharacter } from "../types/character";
import { SKILL_STAT_MAP } from "../types/character";
import { BASE_SPELLS } from "../data/spells";
import { BASIC_EQUIPMENTS } from "../data/equipment";
import { byteSize } from "./byteSize";

// ─────────────────────────────────────────────────────────────────────────
// Field-group breakdown
// ─────────────────────────────────────────────────────────────────────────

/** One row of the per-field-group breakdown produced by {@link measureCharacterWeight}. */
export interface FieldGroupWeight {
  group: string;
  bytes: number;
}

export interface CharacterWeightReport {
  /** Byte size of the character serialized as a single JSON value — the authoritative total. */
  totalBytes: number;
  /**
   * Sum of every group's own (independently serialized) byte size. Slightly
   * exceeds `totalBytes` by a small, constant amount: each group is
   * serialized as its own standalone object (`{...}`), so every group pays
   * for its own `{`/`}` and inter-key commas, bytes the single combined
   * object doesn't pay for once per field. Reported so the discrepancy is
   * visible rather than silently absorbed into rounding.
   */
  groupedBytes: number;
  groups: FieldGroupWeight[];
}

type GroupSpec =
  | { group: string; kind: "keys"; keys: (keyof NimbleCharacter)[] }
  | { group: string; kind: "nonSpellActions" }
  | { group: string; kind: "spellActions" };

/**
 * Exhaustive partition of every {@link NimbleCharacter} field into one of 8
 * groups. "actions"/"spells" split the single `actions` array by
 * `type === "spell"` rather than listing a key, since both groups draw from
 * the same field. Order here is display order in the report, not significant
 * otherwise.
 */
const GROUP_SPECS: GroupSpec[] = [
  { group: "identity", kind: "keys", keys: ["name", "ancestry", "class", "level", "size", "speed"] },
  { group: "stats", kind: "keys", keys: ["stats", "keyStat", "flawStat", "saveMods"] },
  { group: "skills", kind: "keys", keys: ["skills"] },
  {
    group: "vitalsAndCombat",
    kind: "keys",
    keys: [
      "hp",
      "wounds",
      "maxWounds",
      "mana",
      "maxMana",
      "hitDice",
      "defense",
      "initiativeBonus",
      "initiativeAdvantage",
      "combat",
    ],
  },
  { group: "actions", kind: "nonSpellActions" },
  { group: "spells", kind: "spellActions" },
  { group: "inventory", kind: "keys", keys: ["inventory", "inventorySlots", "gold", "silver"] },
  { group: "notes", kind: "keys", keys: ["languages", "abilities", "notes", "battleNotes", "spellNotes", "inventoryNotes"] },
  { group: "schemaMeta", kind: "keys", keys: ["id", "ownerId", "updatedAt", "kind", "schemaVersion"] },
];

/** Every {@link NimbleCharacter} key covered by {@link GROUP_SPECS} — used by a reflective test to guard against a field silently falling outside every group. */
export const GROUPED_CHARACTER_KEYS: (keyof NimbleCharacter)[] = GROUP_SPECS.flatMap((spec) =>
  spec.kind === "keys" ? spec.keys : ["actions"],
);

export function measureCharacterWeight(character: NimbleCharacter): CharacterWeightReport {
  const groups: FieldGroupWeight[] = GROUP_SPECS.map((spec) => {
    if (spec.kind === "nonSpellActions") {
      // Wrapped in a labeled object, like every other group below, so this
      // group's bytes include the "actions" field label itself, not just
      // its array contents — otherwise this group would silently omit the
      // ~10 bytes the label costs inside the real, single-object character,
      // making `groupedBytes` undercount `totalBytes` instead of the small
      // constant OVERcount every other group's own `{`/`}` wrapper causes.
      return { group: spec.group, bytes: byteSize({ actions: character.actions.filter((a) => a.type !== "spell") }) };
    }
    if (spec.kind === "spellActions") {
      return { group: spec.group, bytes: byteSize({ spells: character.actions.filter((a) => a.type === "spell") }) };
    }
    const slice = Object.fromEntries(spec.keys.map((key) => [key, character[key]]));
    return { group: spec.group, bytes: byteSize(slice) };
  });

  return {
    totalBytes: byteSize(character),
    groupedBytes: groups.reduce((sum, g) => sum + g.bytes, 0),
    groups,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Strategy (a): drop descriptions for non-custom, non-diverged entries
// ─────────────────────────────────────────────────────────────────────────

/**
 * Strategy (a): for a non-custom action/item whose stored `description`
 * still matches its catalog template's CURRENT description, drop the stored
 * description (it would be read from `BASE_SPELLS`/`BASIC_EQUIPMENTS` via
 * `sourceKey` at render time instead). An entry whose description has
 * DIVERGED (player-edited, or the catalog moved on since this copy was
 * made) keeps its stored text — this is the "handle the divergence" cost
 * the strategy has to pay, and the reason it can't be a blanket "never
 * store descriptions for non-custom entries" rule.
 *
 * A custom entry, or one with no `sourceKey` at all (untraceable to any
 * catalog), is never touched — there is nothing to read back from a
 * catalog for it.
 */
export function withCatalogDescriptionsStripped(character: NimbleCharacter): NimbleCharacter {
  const strippedActions: CharacterAction[] = character.actions.map((action) => {
    if (action.isCustom || !action.sourceKey) return action;
    const template = BASE_SPELLS.find((s) => s.sourceKey === action.sourceKey);
    if (!template || template.description !== action.description) return action;
    return { ...action, description: "" };
  });

  const strippedInventory: InventoryItem[] = character.inventory.map((item) => {
    if (item.isCustom || !item.sourceKey) return item;
    const template = BASIC_EQUIPMENTS.find((e) => e.sourceKey === item.sourceKey);
    if (!template || template.description !== item.description) return item;
    return { ...item, description: "" };
  });

  return { ...character, actions: strippedActions, inventory: strippedInventory };
}

// ─────────────────────────────────────────────────────────────────────────
// Strategy (b): stop storing derived values
// ─────────────────────────────────────────────────────────────────────────

/**
 * Strategy (b), part 1: drop the cached last initiative roll total
 * (`combat.initiativeResult`) — a transient, 5-second-display value, not
 * something that needs to survive a reload.
 */
export function withoutTransientInitiativeResult(character: NimbleCharacter): NimbleCharacter {
  return { ...character, combat: { ...character.combat, initiativeResult: null } };
}

export interface SkillsStorageComparison {
  /** Bytes for `skills` as currently stored: 10 final totals. */
  totalsBytes: number;
  /** Bytes for a hypothetical `skills` storing 10 invested-point deltas instead (total minus the relevant stat). */
  investedPointsBytes: number;
  /** `investedPointsBytes - totalsBytes`. Negative means storing points would be smaller. */
  deltaBytes: number;
}

/**
 * Strategy (b), part 2: measures whether replacing the 10 stored skill
 * TOTALS with 10 stored invested-POINT deltas (`total - stats[statForSkill]`,
 * the number of points actually spent, which is what "store the entry, not
 * the result" would mean for skills) is worth doing, size-wise.
 *
 * @remarks `NimbleCharacter.skills` today already stores exactly one number
 * per skill — there is no second, redundant "total" field alongside a
 * "points invested" field to remove. Both representations are 10 numbers in
 * `[-5, 12]`-ish ranges; JSON encodes a small integer in 1-3 bytes either
 * way, so this comparison is expected to show a near-zero difference. It's
 * measured rather than assumed specifically to confirm that "skills are
 * derived, don't store them" — true in spirit, in Nimble's own rules — is
 * NOT a real size lever in this app's current data shape, and to make that
 * an explicit, checked finding rather than something asserted from memory.
 */
export function compareSkillsStorage(character: NimbleCharacter): SkillsStorageComparison {
  const totalsBytes = byteSize(character.skills);
  const investedPoints = Object.fromEntries(
    Object.entries(character.skills).map(([skill, total]) => {
      const stat = SKILL_STAT_MAP[skill as keyof typeof SKILL_STAT_MAP];
      return [skill, total - character.stats[stat]];
    }),
  );
  const investedPointsBytes = byteSize(investedPoints);
  return { totalsBytes, investedPointsBytes, deltaBytes: investedPointsBytes - totalsBytes };
}

// ─────────────────────────────────────────────────────────────────────────
// Strategy (c): shorten serialized key names
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every distinct field name that can appear anywhere in a serialized
 * {@link NimbleCharacter} (top-level, or in any nested object/array element
 * type: `HitPoints`, `HitDice`, `Stats`, `SaveMods`, `Skills`, `Defense`,
 * `CombatState`, `CharacterAction`, `InventoryItem`). Listed once each
 * (deduplicated below) even though several names are reused across more
 * than one of those shapes (e.g. `name` on the character, on every action,
 * and on every item) — a real key-shortening scheme would ship one global
 * codebook exactly like this, not a different one per shape.
 */
const ALL_CHARACTER_FIELD_NAMES = [
  "name", "ancestry", "class", "level", "size", "speed",
  "hp", "wounds", "maxWounds", "mana", "maxMana", "hitDice",
  "stats", "keyStat", "flawStat", "saveMods", "skills",
  "defense", "initiativeBonus", "initiativeAdvantage", "combat",
  "languages", "abilities", "notes", "battleNotes", "spellNotes", "inventoryNotes",
  "actions", "inventory", "inventorySlots", "gold", "silver",
  "id", "ownerId", "updatedAt", "kind", "schemaVersion",
  "current", "temp", "max", "dice",
  "str", "dex", "int", "wil",
  "arcana", "examination", "finesse", "influence", "insight", "lore", "might", "naturecraft", "perception", "stealth",
  "equippedItemId", "defenseBonus",
  "actionsRemaining", "initiativeResult",
  "id", "type", "range", "formula", "description", "isFavorite", "manaCost", "spellTier", "spellSchool",
  "slots", "isCustom", "actionCost", "sourceKey", "catalogVersion",
  "quantity", "isEquipped", "isArmor", "manualResolution", "category",
];

/**
 * Builds a deterministic key -> short-code table for every name in
 * {@link ALL_CHARACTER_FIELD_NAMES}: the first 2 letters of the key, with a
 * numeric suffix appended on collision (`initiativeBonus` -> `"in"`,
 * `insight` already having claimed `"in"` means `initiativeBonus` becomes
 * `"in1"`, etc.) — generated rather than hand-assigned so there is no risk
 * of a silent duplicate short code from manual bookkeeping.
 */
export function buildKeyShorteningMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const key of new Set(ALL_CHARACTER_FIELD_NAMES)) {
    const base = key.slice(0, 2);
    let code = base;
    let suffix = 0;
    while (used.has(code)) {
      suffix += 1;
      code = `${base}${suffix}`;
    }
    used.add(code);
    map[key] = code;
  }
  return map;
}

/** Recursively renames every object key in `value` using `keyMap`, leaving unmapped keys and all values untouched. */
export function shortenKeysDeep(value: unknown, keyMap: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => shortenKeysDeep(item, keyMap));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[keyMap[key] ?? key] = shortenKeysDeep(val, keyMap);
    }
    return out;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────
// Strategy (d): gzip + base64
// ─────────────────────────────────────────────────────────────────────────

export interface GzipBase64Sizing {
  /** Raw JSON byte size, before compression. */
  jsonBytes: number;
  /** Gzip-compressed byte size (binary, not yet base64). */
  gzipBytes: number;
  /**
   * Byte size once base64-encoded — what would actually be stored, since
   * OBR metadata values are JSON (no binary payloads). Base64 encodes 3
   * bytes as 4 ASCII characters, rounded up to the next multiple of 4.
   */
  base64Bytes: number;
}

/**
 * Measures the strategy (d) pipeline: JSON -> gzip -> base64, using Node's
 * `zlib` (default compression level) for the offline measurement script.
 * The app itself would use the browser's `CompressionStream("gzip")`, which
 * is also DEFLATE-based gzip — the two are expected to produce byte counts
 * within a few percent of each other (see the report for why that's close
 * enough at this budget's KB-scale granularity), never bit-identical
 * output, so this function is not meant to predict the browser's exact byte
 * count, only gzip's achievable ratio on this data.
 */
export function gzipBase64Size(value: unknown): GzipBase64Sizing {
  const json = JSON.stringify(value) ?? "";
  const jsonBytes = new TextEncoder().encode(json).length;
  const gzipBytes = gzipSync(json).length;
  const base64Bytes = Math.ceil(gzipBytes / 3) * 4;
  return { jsonBytes, gzipBytes, base64Bytes };
}

// ─────────────────────────────────────────────────────────────────────────
// Extrapolation across N characters
// ─────────────────────────────────────────────────────────────────────────

export interface ExtrapolationRow {
  characterCount: number;
  /** Total room-metadata bytes for this many characters, including the per-entry wrapper-key overhead. */
  totalBytes: number;
  overBudget: boolean;
}

/**
 * Extrapolates total room-metadata bytes for storing `characterCount`
 * independent characters, each under its own top-level metadata key.
 *
 * @remarks Models the JSON envelope a real room-metadata object would add
 * around each character, not just `characterCount * singleCharacterBytes`:
 * every entry pays for its own quoted key name plus a colon
 * (`perEntryKeyOverheadBytes`), entries after the first pay one comma, and
 * the whole metadata object pays two bytes for its own `{`/`}` — the same
 * "sum of parts vs. serialized whole" accounting used by
 * {@link measureCharacterWeight}, applied here across entries instead of
 * across fields. This still assumes each character is stored as its own
 * standalone JSON value under its own key (the simplest possible pointer
 * scheme); it is not a claim about the real key scheme a future migration
 * would use, which is out of scope for this measurement-only study.
 */
export function extrapolateRoomMetadataCost(
  singleCharacterBytes: number,
  counts: number[],
  budgetBytes: number,
  perEntryKeyOverheadBytes: number,
): ExtrapolationRow[] {
  return counts.map((characterCount) => {
    const totalBytes =
      2 +
      characterCount * (singleCharacterBytes + perEntryKeyOverheadBytes) +
      Math.max(0, characterCount - 1);
    return { characterCount, totalBytes, overBudget: totalBytes > budgetBytes };
  });
}

/** Byte cost of one entry's quoted key name plus its colon (`"key":`), for use as {@link extrapolateRoomMetadataCost}'s `perEntryKeyOverheadBytes`. */
export function perEntryKeyOverheadBytes(exampleKey: string): number {
  return byteSize(exampleKey) + 1; // quotes are included by byteSize(string); +1 for the colon
}
