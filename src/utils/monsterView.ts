/**
 * @file Pure logic behind the player-facing monster view: the coarse
 * damage band a non-GM viewer sees instead of a number, and the single
 * choke point that narrows a full `MonsterSheet` down to what that viewer
 * is allowed to receive at all.
 *
 * ## Why `maxHp` narrowing happens HERE, in a pure function, not just in JSX
 *
 * `App.tsx` computes {@link computeDamageBand} and calls
 * {@link toPlayerView} once, at the point where it decides which component
 * to render (GM: `MonsterPanel`, gets the full `MonsterSheet`; everyone
 * else: `MonsterPlayerView`, gets only {@link MonsterPlayerViewData}).
 * `MonsterPlayerView`'s own props type structurally cannot carry `maxHp` —
 * there is no field to accidentally read, log, or forward. That is the
 * actual point of doing this at a typed choke point instead of just
 * conditionally hiding a `<span>` in the player component: a UI-only hide
 * only stops the number from being DRAWN, it does nothing about the value
 * still sitting in that component's own props/closures for anyone
 * inspecting them (React DevTools, a future careless edit that adds a
 * debug log, ...).
 *
 * ## The one thing this can NOT do, stated plainly
 *
 * OBR's SDK has no per-client visibility concept at all, on EITHER of the
 * two surfaces a monster's `maxHp` sits on:
 * - The vault entry in scene metadata (`characterStore.ts`,
 *   `OBR.scene.setMetadata`/`getMetadata`).
 * - Every linked token's own `CharacterLink.snapshot`, in that token's item
 *   metadata (`useOBR.ts`'s `linkFor`) — a full copy of the record, kept
 *   there for cross-scene copy-paste transport (see `CharacterLink`'s own
 *   doc), which any client can read directly off that item.
 *
 * Every connected client, GM or player, receives both identically —
 * `MonsterSheet.maxHp` included on both (see CLAUDE.md's repeated notes on
 * `canEdit` being an application-level convention, not a real ACL, for the
 * same underlying reason: OBR has none to build on for either surface). A
 * player who opens their browser console and calls
 * `OBR.scene.getMetadata()`, or reads a selected token's own metadata
 * directly, can still read `maxHp` off either one — nothing in this app, or
 * achievable with this SDK, prevents that. This module's job is narrower
 * and still real: never let `maxHp` flow into any player-facing PROP,
 * RENDER PATH, or LOG in this app's own code, so it is not served on a
 * plate by this extension's own UI even though the underlying platform
 * can't fully hide it on either surface. A local-only OBR storage
 * mechanism was considered (`OBR.scene.local`) and rejected: it's scoped to
 * scene ITEMS, not general data, is ephemeral/client-specific by design
 * (not shared even between a table's own multiple GM sessions), and would
 * silently break for a co-GM or a GM on a second device — a real regression
 * traded for a guarantee the platform doesn't actually let anyone claim.
 */

import type { MonsterArmor, MonsterSheet } from "../types/character";

/**
 * Coarse, three-tier damage indicator for a non-GM viewer — deliberately
 * imprecise, matching what a GM already narrates aloud at the table
 * ("it's fine" / "it's starting to falter" / "it's about to go down")
 * rather than a computed percentage. See `MonsterSheet.maxHp`'s own doc for
 * why a finer-grained signal (an exact color ramp, a percentage) would
 * indirectly disclose `maxHp` almost as much as showing the number itself.
 */
export type DamageBand = "unharmed" | "wounded" | "badly-hurt";

/**
 * The ONLY place the damage-ratio break points live. `computeDamageBand`
 * (below, the player's 3-tier read) and `MonsterPanel`'s own precise GM
 * gradient BOTH key their color off these same two numbers — this is what a
 * real "one calculation, two renderings" design actually requires, not just
 * "both use `damageTaken / maxHp` somewhere in their own code": a bug
 * shipped exactly this way once already (each side computed its OWN
 * thresholds independently — `computeDamageBand` flipped out of "unharmed"
 * at the first point of damage at all, while the GM's gradient stayed
 * visually green until well past that — so at 1 damage on a 30-`maxHp`
 * monster the GM saw green and the players saw amber, for the SAME
 * underlying ratio). Fixed by sharing these constants, not just the
 * "shape" of the computation.
 */
export const WOUNDED_AT_RATIO = 1 / 3;
export const BADLY_HURT_AT_RATIO = 2 / 3;

/**
 * `damageTaken / maxHp`, clamped to `[0, 1]` — the single ratio both
 * {@link computeDamageBand} and `MonsterPanel`'s GM-facing gradient are
 * computed from. Never reimplement this division at a second call site;
 * import this instead, so the two views can't drift apart on WHAT they're
 * even measuring (only on how coarsely they render it).
 *
 * @param maxHp - Guarded against `<= 0` (shouldn't happen — `createDefaultMonster`/
 * `updateMonster` both keep it at least 1 — but this function must not
 * divide by zero if it ever does): treated as fully damaged (`1`) the
 * moment any damage exists, undamaged (`0`) otherwise.
 */
export function computeDamageRatio(damageTaken: number, maxHp: number): number {
  if (maxHp <= 0) return damageTaken > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, damageTaken / maxHp));
}

/**
 * Classifies `damageTaken` against `maxHp` into a {@link DamageBand}, via
 * {@link computeDamageRatio} and the shared {@link WOUNDED_AT_RATIO}/
 * {@link BADLY_HURT_AT_RATIO} break points — roughly equal thirds, not
 * "any damage at all is already wounded": a single point of damage on a
 * healthy monster must read as unharmed, matching what a GM would actually
 * narrate at that point (see this function's own doc above for the bug
 * this specifically fixes).
 */
export function computeDamageBand(damageTaken: number, maxHp: number): DamageBand {
  const ratio = computeDamageRatio(damageTaken, maxHp);
  if (ratio < WOUNDED_AT_RATIO) return "unharmed";
  if (ratio < BADLY_HURT_AT_RATIO) return "wounded";
  return "badly-hurt";
}

/**
 * Exactly the fields a non-GM viewer may see, per this batch's design
 * decision — never `maxHp`, never `speed`. See this file's header for why
 * this is a real type, not just a rendering choice.
 */
export interface MonsterPlayerViewData {
  name: string;
  damageTaken: number;
  armor: MonsterArmor;
  conditions: string[];
  notes: string;
}

/**
 * Narrows a full {@link MonsterSheet} down to {@link MonsterPlayerViewData}
 * — the ONLY function in this codebase allowed to hand monster data to a
 * player-facing component. Never add a field here without re-reading this
 * file's header first.
 */
export function toPlayerView(monster: MonsterSheet): MonsterPlayerViewData {
  return {
    name: monster.name,
    damageTaken: monster.damageTaken,
    armor: monster.armor,
    conditions: monster.conditions,
    notes: monster.notes,
  };
}
