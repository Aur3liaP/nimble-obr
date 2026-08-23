/**
 * @file Pure conversion logic behind the player/monster sheet toggle
 * (`CharacterHeader`'s switch button, wired through `useOBR.ts`'s
 * `switchToMonster`/`switchToPlayer`).
 *
 * The toggle never mutates a record in place — it always builds a brand-new
 * record of the target kind and leaves the old one behind in the vault,
 * unlinked from any token. This is what makes the switch non-destructive in
 * either direction without inventing a bespoke undo mechanism: a `"player"`
 * kind record with no linking token is already, by construction (see
 * `CharacterKind`'s doc), exactly what "Retrieve a lost soul" surfaces —
 * switching a player sheet to monster mode just makes the ORIGINAL player
 * record orphaned-and-recoverable through that existing path, rather than
 * needing a second, parallel "undo a switch" feature. A `"monster"` kind
 * record left behind the same way is, just as automatically, swept by
 * `cleanupOrphanedMonsters` at the next scene load — which is the expected,
 * accepted loss for that direction (see the design notes' "Confirmation
 * dans les deux sens" section: the monster-to-player direction's tracked
 * damage/conditions are real, intentional, one-time-warned losses, not a
 * bug).
 *
 * Kept here, pure and OBR-free, specifically so the "what survives the
 * switch" contract (currently: `name` and `notes`) is unit-tested directly
 * rather than only verifiable by reading `useOBR.ts`'s write logic.
 */

import {
  createDefaultCharacter,
  createDefaultMonster,
  type MonsterSheet,
  type NimbleCharacter,
} from "../types/character";

/**
 * Builds the fresh {@link MonsterSheet} a player-to-monster switch links the
 * token to. Everything monster-specific starts at its default
 * (`createDefaultMonster`); only `name` and `notes` carry over from the
 * player record being switched away from, per this batch's design decision
 * to reduce what's actually lost in the switch without attempting to
 * reconcile fields that have no monster-side equivalent (stats, spells,
 * inventory, ...).
 *
 * @param player - The player character currently linked to the token being
 * switched.
 * @param actingGmId - OBR player id of the GM performing the switch —
 * becomes the new monster record's `ownerId` (see
 * `CharacterRecordBase.ownerId`'s doc: not a permission check for a
 * monster, just "who created/last switched this record").
 */
export function convertToMonster(player: NimbleCharacter, actingGmId: string): MonsterSheet {
  const monster = createDefaultMonster(actingGmId);
  return { ...monster, name: player.name, notes: player.notes };
}

/**
 * Builds the fresh {@link NimbleCharacter} a monster-to-player switch links
 * the token to. Everything player-specific starts at its default
 * (`createDefaultCharacter`, ownership included — same "whoever performs
 * the switch becomes the initial owner" convention `createSheetForToken`
 * already uses for "Create a sheet", not a new pattern introduced here);
 * only `name` and `notes` carry over from the monster record.
 *
 * @param monster - The monster sheet currently linked to the token being
 * switched.
 * @param actingGmId - OBR player id of the GM performing the switch —
 * becomes the new player record's initial `ownerId`, same as any other
 * freshly created sheet.
 */
export function convertToPlayer(monster: MonsterSheet, actingGmId: string): NimbleCharacter {
  const player = createDefaultCharacter(actingGmId);
  return { ...player, name: monster.name, notes: monster.notes };
}
