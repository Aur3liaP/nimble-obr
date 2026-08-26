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

/**
 * Whether a vault record ({@link NimbleCharacter} or {@link MonsterSheet}) is
 * a persistent player character or a disposable monster/NPC. Drives vault
 * cleanup: a `"monster"` record with no token pointing to it is deleted (see
 * `cleanupOrphanedMonsters` in `useOBR.ts`); a `"player"` record survives
 * token deletion and can be recovered (see `findOrphanedCharacters` in
 * `characterVault.ts`).
 *
 * Also the discriminant of {@link CharacterRecord} — see that type's doc for
 * why a monster is its own type rather than a `NimbleCharacter` with most
 * fields unused.
 */
export type CharacterKind = "player" | "monster";
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
/**
 * Per-stat save advantage/disadvantage (Nimble Core Rules 2nd printing,
 * p.9: every hero has exactly one advantaged save and one disadvantaged
 * save, both determined by class). Read correctly by `StatBox`'s
 * indicator and SAVE-roll mode, but has NO write path anywhere in this
 * codebase's UI — every character is stuck at `"none"` for all four stats.
 * Not the same concept as {@link NimbleCharacter.flawStat} — see that
 * field's own doc for the distinction.
 */
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
  /**
   * The {@link BASE_SPELLS} entry's `catalogVersion` at copy time — set
   * alongside `sourceKey` in the same copy paths (`catalogCopy.ts`), never
   * on a custom action. Compared against the CURRENT catalog entry's
   * `catalogVersion` (matched by `sourceKey`) to decide whether this copy
   * is outdated — see `isOutdated` in `catalogCopy.ts` and `spells.ts`'s
   * file header for the full contract. Undefined means either a custom
   * entry, or (same as `sourceKey`) a copy that can't be traced to the
   * catalog at all.
   */
  catalogVersion?: number;
}

/**
 * Coarse display category for an inventory item — which "Add Item" filter
 * pill it belongs under, and which icon it renders with. Purely a display
 * concern, unrelated to `isArmor` (which is what actually drives Defense
 * eligibility and roll-button gating; see `computeDefense.ts` and
 * `isEngineRollableItem` in `formulaParser.ts`) — an item can be
 * `category: "armor"` and `isArmor: true` at the same time (every real
 * armor entry is both), but nothing reads `category` to decide either of
 * those behaviors.
 *
 * Authored per entry in {@link InventoryItem.category}'s catalog source,
 * `BASIC_EQUIPMENTS` (`equipment.ts`) — never guessed from other fields.
 * An earlier version of this app inferred category from proxy signals
 * (slots === 0.5, "potion" in the name, actionCost + formula) via a
 * `guessCategory` heuristic in `InventoryTab.tsx`; that heuristic and a
 * second, independently-ordered copy of the same checks in the icon
 * picker disagreed with each other (a potion has both a formula+actionCost,
 * which looks like a weapon, AND slots === 0.5, which looks like a
 * consumable — whichever check ran first won), and it had no way to
 * classify a slots=1, formula-less single-use item like "Medical Kit
 * (1 use)" at all. Explicit, authored data can't drift out of sync with
 * itself the way two hand-written heuristics did.
 */
export type EquipmentCategory = "weapon" | "armor" | "consumable" | "gear";

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
  /**
   * Display category — see {@link EquipmentCategory}'s own doc. Required:
   * every item must have an opinion here, backfilled to `"gear"` on
   * migration for anything that can't be traced back to a catalog entry
   * (custom items, or a catalog copy predating this field). Never guess
   * this from other fields at a read site — if a future item shape needs
   * a category, add it here at construction time.
   */
  category: EquipmentCategory;
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
  /**
   * Same contract as {@link CharacterAction.catalogVersion}: the
   * {@link BASIC_EQUIPMENTS} entry's `catalogVersion` at copy time, used
   * by `isOutdated`/`resetItemToCatalog` in `catalogCopy.ts` to detect and
   * reset a stale copy. See `equipment.ts`'s file header for the full
   * contract.
   */
  catalogVersion?: number;
}

/**
 * Fields shared by every vault record ({@link NimbleCharacter} and
 * {@link MonsterSheet}) — the plumbing a token's {@link CharacterLink},
 * `characterStore.ts`, and `characterVault.ts` all need regardless of which
 * kind of sheet they're actually handling. Extending this instead of
 * hand-copying these five fields on both interfaces means they can't drift
 * apart from each other the way two independently hand-copied checks have
 * drifted before elsewhere in this codebase (see the `guessCategory` history
 * in CLAUDE.md) — while `kind` still discriminates {@link CharacterRecord}
 * exactly as it would with two fully independent interfaces.
 */
export interface CharacterRecordBase {
  /**
   * Stable identity of this record, independent of any token. Generated
   * once with `crypto.randomUUID()` and never changed again — this is the
   * key the record is stored under in the scene-metadata vault (see
   * `characterStore.ts`) and the value every token's {@link CharacterLink}
   * points at.
   *
   * Replaces the old `tokenId` field (removed in the schema v5 -> v6
   * migration, see `characterMigrations.ts`): a record no longer knows, or
   * needs to know, which token(s) currently display it. `tokenId`'s removal
   * is also what fixed a real copy-paste write-targeting bug (see
   * `selectedTokenIdRef` in `useOBR.ts`) — do not reintroduce a
   * token-pointing field here.
   */
  id: string;
  /**
   * Who may edit this record. For a {@link NimbleCharacter}, compared
   * against the current player's id (`useOBR.ts`'s `isOwner`/`canEdit`); for
   * a {@link MonsterSheet}, editing is gated on GM role alone (see
   * `CharacterKind`'s doc and the "Permissions" section of this batch's
   * design notes) and `ownerId` is only "who created/last switched this
   * record", not a permission check. A plain application-level convention
   * either way — this app has no OBR-side ACL on metadata, so a determined
   * client could still bypass it from devtools.
   */
  ownerId: string;
  updatedAt: number;
  /** See {@link CharacterKind}. */
  kind: CharacterKind;
  /**
   * Schema version this record was written at. `NimbleCharacter` and
   * `MonsterSheet` version independently (see {@link CURRENT_SCHEMA_VERSION}
   * / {@link CURRENT_MONSTER_SCHEMA_VERSION} and `characterMigrations.ts`'s
   * `MIGRATIONS`/`MONSTER_MIGRATIONS`) — a bump to one never implies a bump
   * to the other, since their shapes change independently.
   */
  schemaVersion: number;
}

/**
 * Full persisted state of a single Nimble player character sheet.
 *
 * This entire object is stored as-is in the scene-metadata vault
 * (`characterStore.ts`) and read/written via `OBR.scene.setMetadata`. Any
 * player or the GM with edit rights can trigger an update; OBR then syncs
 * the change to every connected client in real time.
 *
 * @see createDefaultCharacter for the initial state given to a fresh token.
 */
export interface NimbleCharacter extends CharacterRecordBase {
  kind: "player";

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
  /**
   * Up to {@link MAX_KEY_STATS} stats marked as this character's KEY —
   * Nimble Core Rules 2nd printing, p.55 (Glossary, "KEY"): a class's two
   * most important stats. Only the HIGHEST value among the selected
   * entries is ever used (see `buildContext` in `formulaParser.ts`) — an
   * array of up to 2 candidate stats, not a value to add together.
   * Deliberately never stores the resolved max itself: stats change on
   * level-up, and a stored max would silently go stale the moment the
   * currently-lower one overtakes it.
   */
  keyStats: (keyof Stats)[];
  /**
   * A single stat this app calls "FLAW" — not book terminology, and not
   * the same concept as {@link SaveMods}' per-stat save advantage/
   * disadvantage. `flawStat` feeds the `FLAW` formula variable (a plain
   * numeric substitution, see `buildContext`); it has nothing to do with
   * which save is rolled with advantage/disadvantage. Two different
   * concepts that happen to sit next to each other in the UI (the same
   * triangle-toggle row as `keyStats`) — do not merge them.
   */
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
}

/**
 * Coarse, purely informational armor descriptor for a {@link MonsterSheet}.
 * Unlike {@link Defense} (the player hero stat, which feeds
 * `computeDefense.ts`), this drives no calculation at all — the GM's own
 * external statblock is the source of truth for the monster's real numbers,
 * this is only a visual hint for the sheet. Deliberately reuses the word
 * "armor" in a different sense than `Defense`/`InventoryItem.isArmor`, same
 * as the book itself does (see the "Armor" -> "Defense" rename note
 * elsewhere in this file's history) — context disambiguates which sense
 * applies.
 */
export type MonsterArmor = "unarmored" | "medium" | "heavy";

/**
 * Full persisted state of a minimal monster/NPC sheet.
 *
 * Deliberately NOT a `NimbleCharacter` with most fields unused: this batch's
 * driving constraint is a GM who already has full statblocks elsewhere
 * (physical or virtual) and refuses to re-enter them in OBR — the sheet
 * exists purely as a combat visual aid for players (name, a rough sense of
 * how hurt the creature is, its conditions), not a mechanically complete
 * character. No stats, skills, spells, inventory, or background; no
 * model/instance sharing (see this batch's design notes for why a shared
 * statblock isn't worth it at four fields) — every monster token gets its
 * own sheet.
 *
 * Has no existence independent of a token (see {@link CharacterKind}'s doc):
 * `cleanupOrphanedMonsters` (`useOBR.ts`) deletes a `"monster"`-kind vault
 * record the moment no token links to it anymore.
 *
 * @see createDefaultMonster for the initial state given to a fresh token.
 */
export interface MonsterSheet extends CharacterRecordBase {
  kind: "monster";

  /** Free text, no auto-numbering — the GM names it however their own notes do. */
  name: string;
  /**
   * Damage inflicted so far, NOT hit points remaining. This is the whole
   * design point of this batch's damage tracker (see the design notes'
   * "Le compteur de dégâts, pas de PV" section): players at the table never
   * knew a monster's exact HP, only how much damage they'd landed and
   * whatever the GM chose to narrate ("it starts to falter"). Never derive
   * or display a fraction/percentage from this alongside {@link maxHp} on
   * anything a non-GM viewer can see — that reconstructs the exact HP the
   * whole field exists to hide (see `maxHp`'s own doc).
   */
  damageTaken: number;
  /**
   * Meant for the GM's eyes only, within what this app's own UI controls —
   * see `monsterView.ts`'s file header for the full, honest picture of what
   * that does and doesn't guarantee. In short: this app never renders this
   * value, or a fine-grained signal derived from it (an exact color ramp, a
   * percentage — a counter that turns red at 23 damage implies a max around
   * 25 almost as plainly as the number itself would), to a non-GM viewer;
   * `MonsterPlayerView`'s own prop type structurally excludes it, via the
   * `toPlayerView` choke point (`monsterView.ts`). What this canNOT do is
   * keep the raw value out of a player's REACH entirely: it is present, in
   * full, on BOTH surfaces every connected client already receives
   * identically — the vault entry in scene metadata (`characterStore.ts`)
   * AND every linked token's own `CharacterLink.snapshot` in item metadata
   * — because OBR's SDK has no concept of per-client metadata visibility
   * for either surface (see CLAUDE.md's repeated notes on `canEdit` being
   * an application-level convention for the identical underlying reason).
   * A player who calls `OBR.scene.getMetadata()` or reads a token's own
   * metadata from the console can still see it. A player-facing damage
   * indicator must use coarse, GM-narration-shaped bands (e.g. unharmed /
   * wounded / badly hurt) — see `MonsterPlayerView`.
   */
  maxHp: number;
  /** Purely informational — see {@link MonsterArmor}'s own doc. */
  armor: MonsterArmor;
  speed: number;
  /**
   * Free-form condition tags, official (see `src/data/conditions.ts`) or
   * GM-improvised. No duration or associated value is tracked — the GM
   * keeps that in their head, same as everything else this sheet
   * deliberately leaves out.
   */
  conditions: string[];
  /** GM's notes, shared with players (unlike a player character's private-by-convention `notes`, this is meant to be read at the table). */
  notes: string;
}

/**
 * A vault record of either kind, discriminated on `kind`. Everything that
 * touches vault storage without caring which kind it's handling
 * (`characterStore.ts`, `CharacterLink.snapshot`, `characterVault.ts`'s
 * `resolveCharacterRead`/`findOrphanedCharacters`) is typed to this; code
 * that only makes sense for one kind (stat rolls, spell/inventory tabs, the
 * monster sheet panel) narrows on `kind` first.
 */
export type CharacterRecord = NimbleCharacter | MonsterSheet;

/**
 * The pointer stored on an OBR token (item metadata, key {@link LINK_KEY})
 * that connects it to a {@link NimbleCharacter} living in the scene-metadata
 * vault (`characterStore.ts`).
 *
 * @property characterId - The vault key ({@link CharacterRecordBase.id})
 * this token displays.
 * @property snapshot - A copy of the record (player or monster), for
 * TRANSPORT ONLY. It is never read during normal operation while the vault
 * already holds this `characterId` — see `resolveCharacterRead` in
 * `characterVault.ts`, whose whole job is picking the vault over this
 * snapshot whenever the vault has an answer. Its only purpose is surviving a
 * copy-paste to a scene whose vault has never seen this `characterId`: OBR
 * copies token metadata verbatim on paste, so the pasted token still carries
 * a full copy of the record even though the destination scene's vault starts
 * out empty for it. Two copies of the same data existing here looks like a
 * bug on a first read of this file without that context — it is deliberate.
 * @property updatedAt - Mirrors `snapshot.updatedAt` at the moment this link
 * was last written. Compared against the vault record's own `updatedAt`
 * (never against `snapshot.updatedAt` after the fact, which could require
 * migrating `snapshot` first) to detect a stale snapshot cheaply and repair
 * it in the background — see `resolveCharacterRead`'s `needsSnapshotRepair`.
 */
export interface CharacterLink {
  characterId: string;
  snapshot: CharacterRecord;
  updatedAt: number;
}

/**
 * Namespaced metadata key under which a token's {@link CharacterLink} is
 * stored. Sibling of {@link METADATA_KEY} (the old, pre-vault single-key
 * storage format, still read by the v5 -> v6 migration path for a token
 * that hasn't been migrated yet).
 */
export const LINK_KEY = "com.nimble-obr.nimble/link";

/**
 * Namespaced metadata key under which a character sheet used to be stored,
 * in full, directly on the owning OBR token — the sole storage location
 * before the schema v5 -> v6 vault-decoupling migration. Kept only so that
 * migration can still find and convert a token that hasn't been touched
 * since before that change; nothing in current code writes a full character
 * under this key anymore. See {@link LINK_KEY} for the current pointer, and
 * `characterStore.ts` for the vault itself.
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
export const CURRENT_SCHEMA_VERSION = 7;

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

/**
 * Maximum number of stats a character can mark as KEY at once — Nimble
 * Core Rules 2nd printing, p.55 (Glossary, "KEY"): a class's two most
 * important stats. Only the higher-valued of the (up to 2) selected stats
 * is ever used (see {@link NimbleCharacter.keyStats}). Enforced both at
 * the input layer (`StatBox`'s triangle toggle) and, defense in depth, at
 * the write choke point (`updateCharacter` in `useOBR.ts`) — same
 * reasoning as {@link MAX_LEVEL}.
 */
export const MAX_KEY_STATS = 2;

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
  /**
   * Index into `rolls` of every die eliminated by advantage/disadvantage,
   * carried through unchanged from {@link formulaParser.RollFormulaResult}.
   * OPTIONAL: this is roll-LOG metadata (a separate, capped scene-metadata
   * space — see CLAUDE.md's "Shared roll log" note), not part of
   * `NimbleCharacter`, so adding it needed no schema bump. An entry
   * already sitting in scene metadata from before this field existed
   * simply won't have it; `RollLog` falls back to a value-based
   * reconstruction for those (see `matchKeptDice.ts`) until they age out
   * of the 20-entry cap — no migration, nothing to backfill.
   */
  droppedIndices?: number[];
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
 * @param ownerId - OBR player ID who will own (and be able to edit) this sheet.
 * @returns A fresh character at level 1 with zeroed stats and empty
 * inventory, with a freshly generated {@link CharacterRecordBase.id}.
 */
export function createDefaultCharacter(ownerId: string): NimbleCharacter {
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
    keyStats: [],
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
    id: crypto.randomUUID(),
    ownerId,
    updatedAt: Date.now(),
    kind: "player",
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * Current schema version of {@link MonsterSheet}. Versioned independently of
 * {@link CURRENT_SCHEMA_VERSION} (`NimbleCharacter`'s own version counter) —
 * the two types' shapes change independently, so a bump to one must never be
 * read as implying anything about the other. See `characterMigrations.ts`'s
 * `MONSTER_MIGRATIONS` for the matching migration chain, currently empty
 * (no `MonsterSheet` has ever shipped at any earlier shape).
 */
export const CURRENT_MONSTER_SCHEMA_VERSION = 1;

/**
 * Builds a brand-new {@link MonsterSheet} with sensible defaults, used when
 * the GM attaches a monster sheet to a token — either directly ("Create a
 * monster") or via switching an existing player sheet to monster mode (see
 * `characterSwitch.ts`).
 *
 * @param ownerId - OBR player ID of the GM creating this sheet. Not a
 * permission check (see {@link CharacterRecordBase.ownerId}'s doc) — editing
 * a monster sheet is gated on GM role alone, regardless of `ownerId`.
 * @returns A fresh, minimal monster sheet with a freshly generated
 * {@link CharacterRecordBase.id}.
 */
export function createDefaultMonster(ownerId: string): MonsterSheet {
  return {
    name: "New Monster",
    damageTaken: 0,
    maxHp: 10,
    armor: "unarmored",
    speed: 6,
    conditions: [],
    notes: "",
    id: crypto.randomUUID(),
    ownerId,
    updatedAt: Date.now(),
    kind: "monster",
    schemaVersion: CURRENT_MONSTER_SCHEMA_VERSION,
  };
}
