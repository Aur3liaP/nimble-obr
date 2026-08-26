/**
 * @file Central OBR integration hook for the Nimble character sheet extension.
 *
 * Wraps the entire `@owlbear-rodeo/sdk` surface used by this extension:
 * reading the current player/role, tracking scene selection, loading and
 * persisting character data, broadcasting dice rolls to the shared roll
 * log, and exposing permission state (`permissions`) to every tab
 * component.
 *
 * This is the single source of truth for "what can the current player do
 * right now" — all UI components receive `permissions` from here rather
 * than computing it themselves.
 *
 * ## Storage model (schema v6, the vault-decoupling batch)
 *
 * A character's data lives in the scene-metadata VAULT (`characterStore.ts`),
 * keyed by its own stable {@link NimbleCharacter.id} — never inside a
 * token's item metadata. A token only carries a {@link CharacterLink}
 * (`item.metadata[LINK_KEY]`): `characterId` (which vault entry this token
 * displays) plus a `snapshot` copy for cross-scene copy-paste transport
 * only (see that type's own doc for why a second copy of the data existing
 * there is deliberate, not a bug). Deleting a `"player"`-kind character's
 * token does NOT delete the character — it survives in the vault,
 * recoverable. Deleting a `"monster"`-kind character's token DOES delete
 * it, via {@link cleanupOrphanedMonsters}'s scene-load sweep, since a
 * monster has no existence independent of a token.
 *
 * This replaces the pre-v6 model, where the entire character record lived
 * directly under `item.metadata[METADATA_KEY]` and died with its token. A
 * token still carrying that old key is migrated on first load — see
 * `prepareLegacySheetMigration` in `characterVault.ts` and this file's own
 * {@link loadCharacterForToken}.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";

import {
  METADATA_KEY,
  LINK_KEY,
  MAX_LEVEL,
  MIN_STAT,
  MAX_STAT,
  MIN_SKILL,
  MAX_SKILL,
  MAX_KEY_STATS,
  createDefaultCharacter,
  createDefaultMonster,
  type NimbleCharacter,
  type MonsterSheet,
  type CharacterRecord,
  type CharacterLink,
  type DiceRollRequest,
  type DiceRollResult,
  type RollMode,
  type Stats,
  type Skills,
} from "../types/character";
import {
  rollFormula,
  rollFormulaWithContext,
  type FormulaContext,
} from "../utils/formulaParser";
import {
  findOrphanedCharacters,
  linkedCharacterIdsSignature,
  prepareLegacySheetMigration,
  resolveCharacterRead,
  visibleRecoverableCharacters,
} from "../utils/characterVault";
import {
  deleteCharacter,
  loadCharacter,
  listCharacters,
  saveCharacter,
} from "../utils/characterStore";
import { convertToMonster, convertToPlayer } from "../utils/characterSwitch";
import { formatModifier } from "../utils/formatModifier";

/** OBR player role as reported by the SDK. */

/**
 * Derived state of the current scene selection, used to decide what the
 * extension panel should render:
 * - "none": no character token selected.
 * - "multiple": more than one token selected (sheet not shown).
 * - "no-sheet": a single character token is selected but has no sheet yet.
 * - "unsupported-version": a single character token is selected whose
 *   stored `schemaVersion` is newer than this build understands (e.g. a
 *   browser tab left open across a deploy). There is no downward migration,
 *   so the sheet refuses to load rather than guessing at unknown fields.
 * - "invalid-sheet": a single character token is selected whose stored data
 *   doesn't match the expected shape even after migration (corrupted
 *   metadata, or a migration itself failed). See the console for the
 *   technical reason; see `migrateCharacter` in `characterMigrations.ts`.
 * - "ready": a single character token with a valid sheet is selected.
 */
export type OBRRole = "GM" | "PLAYER";
export type SelectionState =
  | "none"
  | "multiple"
  | "no-sheet"
  | "unsupported-version"
  | "invalid-sheet"
  | "ready";

/**
 * Centralized permission state for the currently loaded character,
 * computed once here and passed down as a single object instead of
 * being re-derived (and risking drift) in individual components.
 *
 * - `canEdit` — GM, or the sheet's current owner. Gates every mutation.
 * - `isGM` — current player has the OBR "GM" role.
 * - `isOwner` — current player is specifically the sheet's owner (a GM
 *   viewing someone else's sheet has `canEdit: true` but `isOwner: false`).
 * - `isUnclaimed` — the sheet has no owner yet (fresh token, or owner
 *   field was manually cleared); used to show "Claim" vs "Take over".
 */
export interface CharacterPermissions {
  canEdit: boolean;
  isGM: boolean;
  isOwner: boolean;
  isUnclaimed: boolean;
}

/**
 * Result of an OBR write attempt, tracked across every SDK write this hook
 * performs (character sheet edits, dice roll log, sheet creation,
 * claiming) — see {@link performWrite} inside the hook body for how every
 * write funnels through one place to produce this.
 *
 * - `"idle"` — no write in flight, nothing to show. This is where the UI
 *   sits almost all the time; a write only leaves it briefly, for
 *   `"pending"` when unusually slow or `"error"` on failure.
 *
 *   IMPORTANT, confirmed by testing, not assumed: `"idle"` after a write
 *   does NOT mean the table received it. `@owlbear-rodeo/sdk` (v3.1.0)
 *   talks to the OBR host exclusively through `window.postMessage` between
 *   this extension's iframe and its parent frame (`MessageBus.send`/
 *   `sendAsync`, see {@link describeWriteError}'s remarks) — a same-tab
 *   mechanism that never touches the network layer. `updateItems`/
 *   `setMetadata` resolve as soon as the host posts back a `_RESPONSE`
 *   acknowledging it applied the change to its own local scene state; that
 *   is not the same thing as the host having relayed the change to the
 *   multiplayer server, and this hook has no visibility into that second
 *   step. Reproduced directly: with the browser's network stack cut,
 *   `updateItems` still resolves normally — no rejection, no 5000ms
 *   timeout — while the OBR host's own WebSocket to its server sits
 *   closed (`WebSocket is already in CLOSING or CLOSED state` in the
 *   host's own console). The `navigator.onLine` guard in {@link performWrite}
 *   catches the one sub-case this hook CAN detect (no network interface at
 *   all, e.g. airplane mode, `"offline"` below). A host-to-server relay
 *   failure with the network interface still up (server restart, a proxy
 *   dropping an idle connection, etc.) is NOT detectable from here at
 *   all — see the note in CLAUDE.md.
 * - `"pending"` — at least one write has been in flight longer than the
 *   pending-display delay (`PENDING_DELAY_MS`). Deliberately not shown for
 *   every write: some text fields write to OBR on every keystroke by
 *   design (see CLAUDE.md), and those resolve well under that delay, so
 *   showing "pending" for each of them would flicker on every keystroke
 *   instead of communicating anything useful.
 * - `"offline"` — `navigator.onLine` is `false`. Purely informational: the
 *   extension stays fully usable while this shows (local rolls, formula
 *   drafts, navigation — see {@link performWrite}'s guard for what it
 *   actually blocks, which is OBR writes only, nothing local). Clears
 *   automatically when the browser reports `"online"` again, and only
 *   that — nothing queued during the outage is replayed automatically; see
 *   the `online` listener's comment in the hook body for why.
 * - `"error"` — see {@link SyncErrorStatus}. Sticky: an unrelated write
 *   succeeding afterward does NOT clear it, only an explicit dismiss or a
 *   successful retry of that same failure does. Takes priority over
 *   `"pending"` and `"offline"`: going offline, or a new write starting,
 *   never hides an error already on screen.
 *
 *   As of schema v6 (vault decoupling), this branch is reached only by a
 *   failure of the WRITE THAT MATTERS: saving the character to the vault
 *   (the source of truth), creating a sheet, or claiming/taking over one —
 *   all real, consequential writes where showing nothing would hide actual
 *   data risk. It is deliberately NOT reached by a failed snapshot fan-out
 *   (copying the just-saved character onto every token that displays it)
 *   or a failed background rehydration/repair: both are retried for free
 *   the next time the affected token is read (see `resolveCharacterRead` in
 *   `characterVault.ts`), so a transient failure there is a non-event, not
 *   something worth interrupting the player over. This is also why there is
 *   no "token no longer exists" error anymore (see the removed
 *   `scheduleExistenceCheck` in git history): that check existed only
 *   because a token vanishing used to mean the character's data vanished
 *   with it. Since the vault is now the source of truth, a `"player"`-kind
 *   character survives its token's deletion, and losing the currently
 *   selected token is already handled by the normal selection flow (the
 *   panel falls back to `"none"`/the no-sheet recovery UI), not by an error
 *   banner.
 */
export type SyncStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "offline" }
  | SyncErrorStatus;

/**
 * The `"error"` branch of {@link SyncStatus}.
 *
 * @property canRetry - Always `true` as of schema v6: every write that can
 * still reach this branch (vault save, sheet creation, claim) is retried
 * against the same, still-meaningful target — there is no more "resending
 * this would just silently no-op" case (that was specifically the
 * now-removed "token no longer exists" outcome; see {@link SyncStatus}'s
 * doc). Kept as a field rather than hardcoded `true` at each call site so a
 * future write path can still opt out without changing this interface.
 * @property retry - Re-attempts the write, recomputing against
 * `characterRef.current` as it stands at retry time rather than a snapshot
 * frozen at the original failure, and merging in only the field(s) that
 * actually failed to save. This reduces the risk to *other* fields but does
 * NOT eliminate it: `characterRef.current` only picks up a remote client's
 * change once this client has received and processed the corresponding
 * vault change (see the `onMetadataChange` listener below). If retry fires
 * before that arrives — a race this client cannot detect, and the window
 * can be arbitrarily long since a user decides when to click Retry — the
 * write still sends the whole merged object and can silently overwrite that
 * other field too. This isn't a risk retry introduces; it's the same "local
 * snapshot, not server-fresh state" property every write in this hook has
 * always had, just with a larger window than a single ordinary write gets.
 * Nor is retry safe from a conflict on the *same* field: if the field this
 * write touches was itself changed elsewhere since the failure, retrying
 * overwrites that change, silently. There is no reliable way to detect that
 * from this client. `message` (see {@link describeWriteError}) doesn't name
 * the field at all — raw property names like `hitDice` aren't something a
 * player should have to parse mid-game — and it never claims other fields,
 * or this field against a same-field conflict, are safe. It says only the
 * one thing actually known: retry now or the change is gone. No hedging
 * with "may" or "probably", and no false reassurance either.
 * @property dismiss - Clears the error without retrying.
 */
export interface SyncErrorStatus {
  state: "error";
  message: string;
  canRetry: boolean;
  retry: () => void;
  dismiss: () => void;
}

/** Public API returned by {@link useOBR}, consumed by `App.tsx` and passed down to tab components. */
export interface UseOBRReturn {
  isReady: boolean;
  selectionState: SelectionState;
  character: CharacterRecord | null;
  selectedItems: Item[];
  playerId: string;
  playerName: string;
  role: OBRRole;
  /** @deprecated Use `permissions.canEdit` — kept for incremental migration, will be removed once every call site reads from `permissions`. */
  canEdit: boolean;
  /** @deprecated Use `permissions.isGM` — kept for incremental migration. */
  isGM: boolean;
  permissions: CharacterPermissions;
  syncStatus: SyncStatus;
  updateCharacter: (updates: Partial<NimbleCharacter>) => Promise<boolean>;
  /** The `MonsterSheet` equivalent of `updateCharacter` — see that function's doc for the shared write mechanics; GM-only regardless of `ownerId` (see `CharacterKind`'s doc). */
  updateMonster: (updates: Partial<MonsterSheet>) => Promise<boolean>;
  handleRoll: (req: DiceRollRequest) => Promise<DiceRollResult | null>;
  handleFreeRoll: (req: DiceRollRequest) => Promise<DiceRollResult | null>;
  rollInitiative: (
    mode?: RollMode,
    advantageCount?: number,
    hidden?: boolean,
  ) => Promise<DiceRollResult | null>;
  recentRolls: DiceRollResult[];
  createSheetForToken: (item: Item) => Promise<void>;
  /** GM-only direct monster-creation entry point — see `NoSheetPanel`'s `onCreateMonster` doc for why this exists as its own path rather than "create a sheet then switch". */
  createMonsterForToken: (item: Item) => Promise<void>;
  claimToken: () => Promise<void>;
  /**
   * `"player"`-kind vault characters with no token currently linking to
   * them — the "Recover a lost soul" candidate list, refreshed whenever
   * the selected token has no sheet (see `refreshOrphanedCharacters` in
   * the hook body). Empty in every other selection state, and empty (not
   * stale) for a
   * moment right after landing on a new no-sheet token while the fresh
   * list loads.
   */
  orphanedCharacters: NimbleCharacter[];
  /**
   * Links the currently selected token to an existing vault character by
   * id — what selecting an entry from the recovery list above does.
   */
  recoverCharacter: (characterId: string) => Promise<void>;
  /**
   * Switches the currently selected token's sheet from player to monster
   * mode — GM-only (no-op otherwise), never a mutation in place (see
   * `characterSwitch.ts`). Returns `false` without writing anything if the
   * guard fails (no token/character, wrong kind, or not GM) or the write
   * itself fails; the caller (`CharacterHeader`'s switch button) is
   * expected to have already shown its own confirmation dialog before
   * calling this — this function performs the switch unconditionally, it
   * does not confirm anything itself.
   */
  switchToMonster: () => Promise<boolean>;
  /** The reverse of {@link switchToMonster} — monster to player. Same guards, same "caller already confirmed" contract. */
  switchToPlayer: () => Promise<boolean>;
}

/** Scene metadata key under which the shared, table-wide roll log is stored. */
/** Maximum number of roll entries kept in the shared log (older entries are trimmed). */
const ROLL_LOG_KEY = `${METADATA_KEY}/roll_log`;
const MAX_ROLL_HISTORY = 20;

/**
 * Delay before a still-in-flight write is surfaced as `"pending"` in
 * {@link SyncStatus}. Below this, nothing is shown — see the `"pending"`
 * case in {@link SyncStatus} for why.
 */
const PENDING_DELAY_MS = 700;

/**
 * Quiet period after the last `updateCharacter` call before its snapshot
 * fan-out actually runs — see `scheduleFanOut` in the hook body.
 */
const FAN_OUT_DEBOUNCE_MS = 1000;

/**
 * Backoff schedule for `maybeRunRepair` (hook body): base delay after the
 * first failed repair attempt for a token, doubled per additional
 * consecutive failure, capped at `REPAIR_MAX_BACKOFF_MS`.
 */
const REPAIR_BASE_BACKOFF_MS = 3000;
const REPAIR_MAX_BACKOFF_MS = 60000;

/**
 * Sentinel `Error` message {@link assertOnline} throws with, so
 * {@link describeWriteError} can recognize "we already knew this would
 * fail" separately from an actual SDK rejection, without a custom `Error`
 * subclass.
 */
const OFFLINE_ERROR_MESSAGE = "offline: navigator.onLine is false";

/**
 * {@link FormulaContext} for {@link handleFreeRoll}, which has no character
 * at all to build one from.
 *
 * @remarks Every field is `0`, not `1` — contrast
 * `NEUTRAL_VALIDATION_CONTEXT` in `formulaParser.ts`, which uses `1`s, but
 * only to keep write-time *syntax* validation from rejecting a formula
 * over a variable that can legitimately resolve to `0` on a real character
 * (see that file's header). Here there is no real character, and a free
 * roll's formula only ever comes from {@link DicePanel}'s own dice grid —
 * `${count}d${sides}${modStr}` with `modStr` a signed number literal,
 * never a variable — so no token in `VARIABLE_TABLE` is expected to
 * substitute here at all. `0` is deliberate for the case where one
 * eventually does: it resolves to "this bonus doesn't exist" rather than
 * silently injecting a fabricated `+1`-per-stat into someone's free roll.
 * `level: 1` is the one exception, matching Nimble's actual minimum
 * character level rather than a nonexistent "level 0".
 */
const FREE_ROLL_CONTEXT: FormulaContext = {
  level: 1,
  key: 0,
  flaw: 0,
  stats: { str: 0, dex: 0, int: 0, wil: 0 },
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
  hp: 0,
  maxHp: 0,
};

/**
 * Called from inside each write's `execute`, right before the actual SDK
 * call — and, for `updateCharacter` specifically, *after* its optimistic
 * `setCharacter`, never before. `OBR.scene.setMetadata`/`items.updateItems`
 * resolve successfully even with no network interface at all (see the big
 * note on `SyncStatus`'s `"idle"` case), so waiting for one of them to
 * reject would never catch this; checking `navigator.onLine` first is the
 * only signal available for this specific sub-case.
 *
 * Deliberately NOT called at the top of `performWrite`, before `execute`
 * runs at all: for `updateCharacter`, that would skip the optimistic
 * `setCharacter` too, and the field bound to it would visibly revert
 * whatever the player just typed on every keystroke while offline — the
 * exact "yank" bug `useDraggableValue`/`useFormulaField` exist to avoid
 * elsewhere, reintroduced here by mistake once already during this change.
 * Each `execute` calls this itself, at the point that's actually safe for
 * that call site — see each one's comment.
 */
function assertOnline(): void {
  if (!navigator.onLine) throw new Error(OFFLINE_ERROR_MESSAGE);
}

/**
 * Clamps every value of a stats/skills-shaped record to `[min, max]`. Shared
 * by the two clamps `updateCharacter` applies below (stats to
 * `[MIN_STAT, MAX_STAT]`, skills to `[MIN_SKILL, MAX_SKILL]`) — same
 * "clamp at the write choke point, not just as an input hint" reasoning
 * already applied to `level`/`MAX_LEVEL`: an HTML input's `min`/`max`
 * doesn't stop a typed value from being committed.
 */
function clampRecord<K extends string>(
  record: Record<K, number>,
  min: number,
  max: number,
): Record<K, number> {
  const clamped = {} as Record<K, number>;
  for (const key of Object.keys(record) as K[]) {
    clamped[key] = Math.min(Math.max(record[key], min), max);
  }
  return clamped;
}

/**
 * Turns an OBR SDK write rejection into a short, user-facing message.
 * Written for a player mid-game, not for a developer: it says what to do
 * (retry, or the change is gone), not what state the hook is internally
 * in, and it never names the field involved — a raw property name like
 * `hitDice` isn't something a player should have to parse mid-game, and
 * this project has no hand-maintained label dictionary to turn one into
 * plain English. The deeper mechanics of *why* retrying can be risky (see
 * {@link SyncErrorStatus.retry}) live in that JSDoc, not here — there's no
 * room in a two-line banner to state that honestly without either
 * bloating it or hedging with "may".
 *
 * @remarks OBR's SDK (v3.1.0) exposes no typed error taxonomy for
 * `updateItems`/`setMetadata` writes — verified directly in the SDK
 * source (`MessageBus.sendAsync`), not assumed: a rejection is either a
 * generic `Error` whose message matches its own hardcoded
 * `"took longer than <n>ms"` 5000ms client timeout, or whatever raw,
 * undocumented payload the OBR host relays back on the message's
 * `_ERROR` event — permission denial, a closed scene, a dropped
 * connection, etc. are not distinguished from each other anywhere in the
 * SDK. Only the timeout case is reliably recognizable from here;
 * everything else collapses to one generic message rather than guessing
 * at a taxonomy the SDK doesn't provide.
 *
 * @param isOptimistic - Whether this write already applied its change to
 * local state (`character`) before knowing whether the write succeeded —
 * true only for `updateCharacter` (see its `execute`). When true, the
 * screen right now shows something nobody else at the table has: worth
 * saying plainly, since it's the one fact a player can't infer just from
 * seeing an error banner. `claimToken`/`createSheetForToken` only touch
 * local state *after* a successful write — for both, the screen already
 * matches reality on failure, so this doesn't apply.
 */
function describeWriteError(err: unknown, isOptimistic: boolean): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw === OFFLINE_ERROR_MESSAGE) {
    return describeWriteFailure(isOptimistic, "Reconnect, then retry");
  }
  const timedOut = /took longer than \d+ms/.test(raw);
  return describeWriteFailure(
    isOptimistic,
    timedOut ? "Check your connection, then retry" : "Retry now",
  );
}

/**
 * Shared template behind {@link describeWriteError} and the
 * `navigator.onLine` guard in {@link performWrite}: same two facts either
 * way (what's true right now, what to do about it), only the "what to do"
 * hint differs by cause.
 */
function describeWriteFailure(isOptimistic: boolean, hint: string): string {
  const fact = isOptimistic ? "Your change only shows on your screen" : "Couldn't save your changes";
  return `${fact}. ${hint}, or it's lost.`;
}

/**
 * Builds the {@link CharacterLink} a token should carry for `character`.
 * Small, but centralizing it means the three fields (`characterId`,
 * `snapshot`, `updatedAt`) can never drift out of sync with each other at
 * one call site but not another.
 */
function linkFor(character: CharacterRecord): CharacterLink {
  return { characterId: character.id, snapshot: character, updatedAt: character.updatedAt };
}

/**
 * Copies `character`'s current state onto the {@link CharacterLink} of
 * every token in the scene that displays it.
 *
 * Called (debounced — see `scheduleFanOut` in the hook body) after a vault
 * save ({@link saveCharacter} having already run) so a future copy-paste of
 * any of those tokens carries current data — but deliberately NOT part of
 * that write's own {@link performWrite} tracking, and never lets a failure
 * here become a user-facing error: the vault is the source of truth, so a
 * token that misses this fan-out just carries a stale `snapshot`/`updatedAt`
 * until either a later fan-out succeeds or its own next read notices the
 * vault is newer and repairs it in the background (see `maybeRunRepair` in
 * the hook body). Nothing is lost either way — only logged, so a persistent
 * failure is still visible in the console rather than completely silent.
 *
 * @remarks Targets a freshly-fetched, explicit list of ids, never a
 * predicate handed straight to `updateItems` — confirmed directly (not
 * assumed) against the real SDK: `updateItems` no-ops its ENTIRE batch, not
 * just the one bad id, the moment even one targeted id no longer resolves
 * to a live item (writing `[alive]` succeeds; writing `[alive, alreadyGone]`
 * resolves without error but writes NEITHER — the same silent-no-op shape
 * that motivated the item's own existence check before the vault existed,
 * now in list form). A token can be deleted between one fan-out and the
 * next at any time, so the live-token list is never assumed current from a
 * previous call — it is always re-fetched here, immediately before writing.
 * This narrows, but cannot fully close, the race: a token could still
 * vanish in the gap between this `getItems` and the `updateItems` right
 * after it — and if one does, the consequence is NOT a partial write. It is
 * a NULL write, for every id in the batch, including the other tokens that
 * are still perfectly alive: confirmed directly in console testing, not
 * inferred, that `updateItems` resolves its promise normally while writing
 * NOTHING AT ALL the moment even one targeted id fails to resolve — there
 * is no per-id fallback, no "skip the dead one and write the rest". A fan-out
 * to three live tokens and one just-deleted one silently saves none of the
 * three, not two out of three. That residual window is accepted, not
 * solved — closing it would need an atomic "check existence and write" the
 * SDK doesn't expose — but it is accepted with this cost fully in view: the
 * few-millisecond gap doesn't just risk losing the vanished token's own
 * update, it risks losing every OTHER live token's update in the same call,
 * silently, with the promise reporting success either way. Recoverable
 * regardless (the next fan-out, or that token's own next read-time repair,
 * catches it — see the paragraph above), which is what makes the gap
 * acceptable rather than something to build a workaround for.
 */
async function fanOutSnapshot(character: CharacterRecord): Promise<void> {
  try {
    const liveTokens = await OBR.scene.items.getItems(
      (item) =>
        item.layer === "CHARACTER" &&
        (item.metadata[LINK_KEY] as CharacterLink | undefined)?.characterId === character.id,
    );
    if (liveTokens.length === 0) return;
    await OBR.scene.items.updateItems(
      liveTokens.map((item) => item.id),
      (items) => {
        for (const item of items) {
          item.metadata[LINK_KEY] = linkFor(character);
        }
      },
    );
  } catch (err) {
    console.warn(
      `[Nimble] snapshot fan-out for character ${character.id} failed — affected tokens' ` +
        `snapshots will be retried, with backoff, the next time each is read (see maybeRunRepair).`,
      err,
    );
  }
}

/**
 * Rewrites `tokenId`'s {@link CharacterLink} to match `character` — the
 * actual write behind a snapshot repair. Deliberately has NO try/catch of
 * its own: {@link maybeRunRepair} (hook body) is the single place that
 * catches, logs, and decides what happens next (in-flight tracking,
 * backoff) — duplicating that here would let this function's own generic
 * failure log paper over the more specific, actionable one the caller can
 * produce.
 */
async function repairStaleSnapshot(tokenId: string, character: CharacterRecord): Promise<void> {
  await OBR.scene.items.updateItems([tokenId], (items) => {
    for (const item of items) {
      item.metadata[LINK_KEY] = linkFor(character);
    }
  });
}

/**
 * The one-time write {@link loadCharacterForToken} decided a token needs,
 * tagged by kind so the caller (`applyTokenLoadResult` in the hook body)
 * knows which handling policy applies:
 *
 * - `"legacy-migration"` — routed through `performWrite` (visible failure
 *   handling): this is the record's one-time, real move out of the old
 *   storage location, and deserves the same treatment as any other
 *   consequential write.
 * - `"rehydrate"` — fired immediately, failure only logged: safe to lose,
 *   retried for free the next time this token is read (see
 *   `resolveCharacterRead` in `characterVault.ts`), and writes to the vault
 *   by `character.id`, not any one token's metadata, so it has no feedback
 *   loop to guard against.
 * - `"repair"` — routed through `maybeRunRepair` (in-flight cap + backoff),
 *   NOT fired directly: this is the one write in this file that targets a
 *   token's own metadata from inside the very `items.onChange` listener
 *   that write itself triggers. Firing it unconditionally on every match
 *   turned a single stale snapshot, during a sustained burst of edits (the
 *   vault moving to a new `updatedAt` faster than a single repair
 *   round-trip could land), into a repair attempt on every subsequent
 *   `onChange` tick for as long as the burst lasted — this is what actually
 *   tripped OBR's rate limit in testing, not the repair mechanism's
 *   existence. See `maybeRunRepair`'s own doc for the guard.
 */
type BackgroundWrite =
  | { kind: "legacy-migration"; run: () => Promise<void> }
  | { kind: "rehydrate"; run: () => Promise<void> }
  | { kind: "repair"; character: CharacterRecord };

/**
 * Outcome of {@link loadCharacterForToken}.
 *
 * - `"none"` — the token has neither a {@link CharacterLink} nor a legacy
 *   `METADATA_KEY` payload: no sheet has ever been attached.
 * - `"ready"` — a usable character was resolved. `backgroundWrite`, if
 *   present, must be handled per its `kind` — see {@link BackgroundWrite}.
 * - `"unsupported"` / `"invalid"` — mirrors `MigrationResult`, see that
 *   type's own doc.
 */
type TokenLoadResult =
  | { status: "none" }
  | {
      status: "ready";
      character: CharacterRecord;
      backgroundWrite?: BackgroundWrite;
    }
  | { status: "unsupported"; foundVersion: number }
  | { status: "invalid"; reason: string };

/**
 * Resolves what `item` should display: reads its {@link CharacterLink} (or
 * legacy `METADATA_KEY` payload) and, for a link, looks the character up in
 * the vault — the "coffre puis snapshot" read order the vault-decoupling
 * design specifies. See {@link TokenLoadResult}/{@link BackgroundWrite} for
 * the shape this returns and `resolveCharacterRead`/
 * `prepareLegacySheetMigration` in `characterVault.ts` for the pure
 * decision logic this wraps with the actual OBR reads.
 */
async function loadCharacterForToken(item: Item): Promise<TokenLoadResult> {
  const link = item.metadata?.[LINK_KEY] as CharacterLink | undefined;

  if (link === undefined) {
    const legacyRaw = item.metadata?.[METADATA_KEY];
    if (legacyRaw === undefined) return { status: "none" };

    const outcome = prepareLegacySheetMigration(legacyRaw, item.createdUserId ?? "");
    if (outcome.status === "invalid") {
      console.error(
        `[Nimble] Legacy sheet on token ${item.id} failed validation: ${outcome.reason}`,
      );
      return outcome;
    }
    if (outcome.status === "unsupported") return outcome;

    const { character, link: newLink } = outcome;
    return {
      status: "ready",
      character,
      backgroundWrite: {
        kind: "legacy-migration",
        // Token link written BEFORE the vault entry, deliberately: this is
        // what guarantees a character can never appear in the vault without
        // a token already pointing at it, which is what makes
        // cleanupOrphanedMonsters safe to run at any time (see that
        // function's own comment). If the vault write below fails after
        // this one succeeds, the token is left pointing at a characterId
        // the vault doesn't have yet — the very next selection of this
        // token takes the "rehydrate" branch further down and writes it
        // in, self-healing with no special-case code needed.
        run: async () => {
          await OBR.scene.items.updateItems([item.id], (items) => {
            for (const it of items) {
              it.metadata[LINK_KEY] = newLink;
              delete it.metadata[METADATA_KEY];
            }
          });
          await saveCharacter(character);
        },
      },
    };
  }

  const vaultCharacter = await loadCharacter(link.characterId);
  const resolution = resolveCharacterRead(link, vaultCharacter);

  if (resolution.action === "use-vault") {
    return {
      status: "ready",
      character: resolution.character,
      backgroundWrite: resolution.needsSnapshotRepair
        ? { kind: "repair", character: resolution.character }
        : undefined,
    };
  }

  // "rehydrate": the vault has never seen this characterId — cross-scene
  // copy-paste is the expected cause. The token's own snapshot is promoted
  // as-is (already run through migrateCharacter by resolveCharacterRead).
  const migration = resolution.migration;
  if (migration.status !== "ok") return migration;
  return {
    status: "ready",
    character: migration.character,
    backgroundWrite: { kind: "rehydrate", run: () => saveCharacter(migration.character) },
  };
}

/**
 * Extracts every `characterId` linked from a list of scene items — pure,
 * no OBR call of its own. Two callers, deliberately kept separate rather
 * than each re-fetching:
 * - {@link fetchLinkedCharacterIds}, which supplies the items via its own
 *   `getItems` call, for callers with no item list already in hand
 *   (`cleanupOrphanedMonsters`, `fetchOrphanRefreshInputs`).
 * - `maybeRefreshOrphanedCharactersOnLinkChange` (hook body), which is
 *   handed the scene's full, current item list directly by
 *   `items.onChange` and must NOT re-fetch it — see that function's own
 *   doc for why a redundant `getItems` there would defeat the entire
 *   point of that guard on this extension's hottest code path.
 *
 * @param items - Confirmed (not assumed) to need no further filtering by
 * layer at either call site beyond what's applied here: `getItems`'s own
 * predicate already narrows to `CHARACTER` for the first caller, and
 * `items.onChange` hands the SECOND caller the scene's full, unfiltered
 * item list — this function's own `layer` filter is what narrows that one.
 */
function linkedCharacterIdsFromItems(items: Item[]): string[] {
  return items
    .filter((item) => item.layer === "CHARACTER")
    .map((item) => (item.metadata[LINK_KEY] as CharacterLink | undefined)?.characterId)
    .filter((id): id is string => typeof id === "string");
}

/**
 * Every `characterId` currently linked to a live CHARACTER-layer token in
 * the scene — a fresh `getItems` call plus {@link linkedCharacterIdsFromItems}.
 * Shared by {@link cleanupOrphanedMonsters} and
 * {@link fetchOrphanRefreshInputs} — both need the exact same computation
 * (which characters currently have no token pointing to them), just
 * filtered by a different `kind` afterward. Same "share the computation,
 * let each caller filter" reasoning as `findOrphanedCharacters` itself
 * (`characterVault.ts`) — see that function's own doc.
 */
async function fetchLinkedCharacterIds(): Promise<string[]> {
  const tokens = await OBR.scene.items.getItems((item) => item.layer === "CHARACTER");
  return linkedCharacterIdsFromItems(tokens);
}

/**
 * Deletes every `"monster"`-kind vault character that no token in the
 * current scene links to. Monsters have no existence independent of a
 * token (see {@link CharacterKind}'s doc) — this is what actually enforces
 * that, since a token deletion event isn't reliably observable from every
 * client (see the `items.onChange` listener's own long-standing "sheet
 * removed mid-session — leave state as-is" comment below). Idempotent:
 * deleting an already-gone vault entry is a no-op, so running this
 * redundantly (every client does, on every scene load) is harmless.
 *
 * @remarks Safe to run at ANY time, including immediately on scene load,
 * with no race against a monster still being created: every creation path
 * in this file (`loadCharacterForToken`'s legacy-migration branch,
 * `createSheetForToken`) writes the token's link BEFORE the vault entry —
 * so a monster's vault entry never becomes visible to any client (this one
 * included) before its owning token already points at it. There is
 * therefore no window in which this function could observe "exists in the
 * vault, no token points to it yet" for a character that's still being
 * created rather than genuinely orphaned. (Today's UI can only create
 * `kind: "player"` characters, so this race is moot in practice either
 * way — but the ordering is applied uniformly, not conditionally on kind,
 * so it stays correct once a `"monster"`-creating UI exists.)
 */
async function cleanupOrphanedMonsters(): Promise<void> {
  try {
    const [characters, linkedIds] = await Promise.all([
      listCharacters(),
      fetchLinkedCharacterIds(),
    ]);

    const orphans = findOrphanedCharacters(characters, linkedIds).filter(
      (character) => character.kind === "monster",
    );
    for (const monster of orphans) {
      await deleteCharacter(monster.id);
    }
  } catch (err) {
    console.warn("[Nimble] orphaned-monster cleanup pass failed — will retry on next scene load.", err);
  }
}

/**
 * Raw inputs behind the "Retrieve a lost soul" list: every vault character,
 * and every characterId currently linked to a token in the scene. Returned
 * un-filtered, separately, rather than pre-combined into the final visible
 * list — the hook body needs `linkedIds` on its own too, as a cheap
 * comparison key deciding whether a live-update recompute is even worth
 * doing (see `linkedCharacterIdsSignature` in `characterVault.ts` and
 * `maybeRefreshOrphanedCharactersOnLinkChange` below), not just as an input
 * to the filter.
 */
async function fetchOrphanRefreshInputs(): Promise<{
  characters: CharacterRecord[];
  linkedIds: string[];
}> {
  const [characters, linkedIds] = await Promise.all([listCharacters(), fetchLinkedCharacterIds()]);
  return { characters, linkedIds };
}

/**
 * Connects this extension instance to the active OBR scene and player,
 * and exposes everything needed to render and edit a Nimble character sheet.
 *
 * Responsibilities:
 * - Resolves the current player's ID, name, and role (GM/PLAYER) on ready.
 * - Tracks scene selection changes and loads the corresponding character
 *   via its token's {@link CharacterLink} (see {@link SelectionState}).
 * - Computes {@link CharacterPermissions} for permission gating.
 * - Persists character updates to the scene-metadata vault
 *   (`characterStore.ts`), but only when the caller currently holds edit
 *   rights (see {@link updateCharacter} — this is a client-side guard, not
 *   a real security boundary, since OBR has no server-side ACL on
 *   metadata; a determined player could still bypass it from devtools. It
 *   does, however, prevent accidental writes from stale UI state and keeps
 *   `canEdit` meaningful as the single gate everywhere).
 * - Pushes dice roll results to shared scene metadata so all clients see
 *   them, except hidden rolls (GM-only, kept in local state only).
 *
 * @returns See {@link UseOBRReturn} for the full shape.
 */
export function useOBR(): UseOBRReturn {
  const [isReady, setIsReady] = useState(false);
  const [selectionState, setSelectionState] = useState<SelectionState>("none");
  const [character, setCharacter] = useState<CharacterRecord | null>(null);
  const [selectedItems, setSelectedItems] = useState<Item[]>([]);
  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [role, setRole] = useState<OBRRole>("PLAYER");
  const [recentRolls, setRecentRolls] = useState<DiceRollResult[]>([]);
  const [orphanedCharacters, setOrphanedCharacters] = useState<NimbleCharacter[]>([]);

  const characterRef = useRef<CharacterRecord | null>(null);
  const playerIdRef = useRef<string>("");
  const playerNameRef = useRef<string>("");
  // Mirrors `permissions.canEdit` synchronously for use inside callbacks
  // (handleRoll, updateCharacter) that close over refs rather than state,
  // so the guard always sees the latest value even mid-render.
  const canEditRef = useRef(false);
  /**
   * The OBR item id of the currently selected single character token —
   * refreshed synchronously inside {@link handleSelectionChange} on every
   * selection change.
   *
   * @remarks This is the only id `createSheetForToken`/`claimToken`/the
   * legacy-migration write-back may target when writing a
   * {@link CharacterLink} onto "the selected token" specifically. It is
   * NOT how `updateCharacter`'s own save targets tokens at all — that write
   * goes to the vault by `character.id`, and the matching
   * {@link CharacterLink} fan-out (`fanOutSnapshot`) finds its targets by
   * filtering the scene for `link.characterId === character.id`, never by
   * this ref. A single character can legitimately be displayed by more than
   * one token (two tokens for the same PC, or a copy-pasted duplicate)
   * since schema v6, so there is no longer one "the" token a character
   * could even be said to point back to. Before v6, `character.tokenId`
   * lived inside the payload itself and drifted out of sync on copy-paste
   * (OBR copies metadata verbatim, assigning the copy a new item id) —
   * removing that field entirely is what closed that bug, not just working
   * around it here.
   *
   * Set to `null` whenever there isn't exactly one character-layer token
   * selected (no selection, multiple selection, or a non-character item),
   * so a write attempted from a stale closure in one of those states fails
   * closed instead of guessing at a target.
   */
  const selectedTokenIdRef = useRef<string | null>(null);

  useEffect(() => {
    characterRef.current = character;
  }, [character]);
  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);
  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  const isGM = role === "GM";

  // Ownership/claiming is a player-sheet-only concept — a MonsterSheet's
  // `ownerId` is "who created/last switched this record", never a
  // permission check (see CharacterRecordBase.ownerId's doc): editing a
  // monster is gated on GM role alone. Forcing isOwner/isUnclaimed false
  // for a monster is what makes that fall out of `canEdit` below without a
  // separate branch: canEdit = isGM || false = isGM.
  const isOwner =
    character !== null &&
    character.kind === "player" &&
    !!character.ownerId &&
    character.ownerId === playerId;
  const isUnclaimed = character !== null && character.kind === "player" && !character.ownerId;

  const canEdit = isGM || isOwner;

  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);
  // Latest-value refs for use inside callbacks registered once (the SDK
  // listeners in the main effect below) rather than recreated on every
  // render — same "ref for latest closure" pattern as canEditRef/
  // playerIdRef above. Needed by refreshOrphanedCharacters (isGMRef) and
  // the onMetadataChange listener's own guard (selectionStateRef).
  const isGMRef = useRef(false);
  useEffect(() => {
    isGMRef.current = isGM;
  }, [isGM]);
  const selectionStateRef = useRef<SelectionState>("none");
  useEffect(() => {
    selectionStateRef.current = selectionState;
  }, [selectionState]);
  /**
   * Comparison baseline for `maybeRefreshOrphanedCharactersOnLinkChange`:
   * the `linkedCharacterIdsSignature` recorded by the last
   * `applyOrphanRefresh` call. `null` until the first refresh ever runs.
   */
  const linkedCharacterIdsSignatureRef = useRef<string | null>(null);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "idle" });
  // Count of writes currently in flight — decides when to promote
  // syncStatus to "pending" and when it's safe to clear the pending timer.
  // See performWrite.
  const pendingWritesRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Identifies the currently-displayed error so a retry's async success
  // handler can tell whether it's still retrying the error being shown, or
  // whether a newer, unrelated failure has already replaced it — see
  // performWrite.
  const currentErrorIdRef = useRef(0);
  /**
   * Set right after loading a token whose stored sheet still lived under
   * the legacy `METADATA_KEY` (see `loadCharacterForToken`'s legacy
   * branch), cleared once the write-back effect below has consumed it.
   * Not touched for the "multiple selection" branch, which never triggers
   * a write-back — see that branch's comment. This is the ONE background
   * write from `loadCharacterForToken` routed through `performWrite`
   * rather than fired directly — see that function's own doc for why.
   */
  const pendingLegacyMigrationRef = useRef<{
    tokenId: string;
    run: () => Promise<void>;
  } | null>(null);

  /**
   * Per-token bookkeeping for {@link maybeRunRepair}'s guard: at most one
   * repair in flight per token, plus an exponential backoff after a
   * failure. See that function's own doc for why this exists.
   */
  const repairGuardRef = useRef<
    Map<string, { inFlight: boolean; failureCount: number; nextAttemptAllowedAt: number }>
  >(new Map());
  /**
   * The `updatedAt` this client itself last successfully wrote via a
   * repair, per token — lets the `items.onChange` listener recognize the
   * `onChange` event that repair's own write produces and skip reprocessing
   * it as a new external change. Purely an efficiency measure (the
   * in-flight/backoff guard in {@link maybeRunRepair} is what actually
   * bounds the write rate); harmless if a stale entry lingers after being
   * superseded by a genuinely new value, since a real subsequent change
   * simply won't match it anymore.
   */
  const lastRepairedUpdatedAtRef = useRef<Map<string, number>>(new Map());
  /**
   * The {@link CharacterLink} last actually PROCESSED (read, resolved, and
   * applied to state) for the currently selected token — `null` if that
   * token has no link at all (never had a sheet, or is still on the legacy
   * per-token storage location). Updated by `applyTokenLoadResult` every
   * time it runs, for whichever token it just ran for.
   *
   * The sole purpose of this ref: letting the `items.onChange` listener,
   * this extension's hottest code path, tell "this token's link is
   * IDENTICAL to what I already loaded" apart from "something about this
   * token's link actually changed" — WITHOUT re-fetching or re-resolving
   * anything, using only data the listener is already handed. Before v6,
   * this same distinction didn't need a dedicated mechanism: the character
   * WAS the item's metadata, so `items.onChange`'s own delivered item data
   * already contained everything needed to know whether anything relevant
   * changed, with no separate vault round trip possible. See the
   * `items.onChange` listener's own comment for the comparison this drives.
   */
  const selectedTokenLinkRef = useRef<{
    tokenId: string;
    characterId: string;
    updatedAt: number;
  } | null>(null);
  /**
   * Debounce timers for {@link scheduleFanOut}, one per `characterId` — see
   * that function's doc for why per-character, not a single shared timer.
   */
  const fanOutTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const permissions: CharacterPermissions = {
    canEdit,
    isGM,
    isOwner,
    isUnclaimed,
  };

  /**
   * Guarded entry point for a `"repair"` {@link BackgroundWrite} — the only
   * one of the three kinds not fired unconditionally, because it is the
   * only one whose own write can retrigger the exact `items.onChange`
   * listener that calls it.
   *
   * Two protections, both required (confirmed in testing: neither alone was
   * enough to stop the observed failure):
   * - **At most one repair in flight per token.** A second call for a
   *   token already being repaired is dropped outright, not queued.
   * - **Exponential backoff after a failure**, per token, capped at
   *   {@link REPAIR_MAX_BACKOFF_MS}. Without this, a token whose repair
   *   keeps failing (rate limit, offline, ...) would retry on every single
   *   subsequent `onChange` tick for that token — and during a sustained
   *   burst of unrelated edits elsewhere (which also fire `onChange`), that
   *   is not a rare event.
   *
   * A successful repair resets both the failure count and the backoff, and
   * records `character.updatedAt` in {@link lastRepairedUpdatedAtRef} so the
   * `items.onChange` listener can recognize this write's own echo.
   */
  const maybeRunRepair = useCallback((tokenId: string, character: CharacterRecord) => {
    const guards = repairGuardRef.current;
    const state = guards.get(tokenId) ?? {
      inFlight: false,
      failureCount: 0,
      nextAttemptAllowedAt: 0,
    };
    if (state.inFlight || Date.now() < state.nextAttemptAllowedAt) return;

    state.inFlight = true;
    guards.set(tokenId, state);

    void repairStaleSnapshot(tokenId, character)
      .then(() => {
        state.failureCount = 0;
        state.nextAttemptAllowedAt = 0;
        lastRepairedUpdatedAtRef.current.set(tokenId, character.updatedAt);
      })
      .catch((err) => {
        state.failureCount += 1;
        const backoffMs = Math.min(
          REPAIR_MAX_BACKOFF_MS,
          REPAIR_BASE_BACKOFF_MS * 2 ** (state.failureCount - 1),
        );
        state.nextAttemptAllowedAt = Date.now() + backoffMs;
        console.warn(
          `[Nimble] snapshot repair for token ${tokenId} failed (attempt ${state.failureCount}) — ` +
            `will not retry for at least ${Math.round(backoffMs / 1000)}s, and only if this token is read again.`,
          err,
        );
      })
      .finally(() => {
        state.inFlight = false;
        guards.set(tokenId, state);
      });
  }, []);

  /**
   * Debounces {@link fanOutSnapshot} so it runs once after a burst of
   * `updateCharacter` calls settles, rather than once per call. The
   * snapshot is transport only (see {@link CharacterLink}'s doc) — nothing
   * reads it while the vault already has an answer — so there is no
   * correctness reason to fan it out on the same cadence as the vault save
   * itself. Before this, a continuous edit (a value dragged/scrolled/typed
   * across many small commits) doubled its write volume on every single
   * commit (vault save + fan-out), which is what actually tripped OBR's
   * rate limit in testing — see `useDebouncedCommit` for the complementary
   * fix on the commit side itself.
   *
   * Coalesces to the LATEST state PER CHARACTER only (one timer per
   * `character.id` in {@link fanOutTimersRef}, not one shared timer): an
   * earlier call's pending fan-out for that SAME character is replaced,
   * never queued, since only the final state after a burst on one
   * character is worth broadcasting. A single shared timer would have
   * meant editing character A and then character B within the debounce
   * window cancels A's pending fan-out outright — A's tokens would never
   * receive that fan-out at all (not merely delayed), left to whatever
   * stale `snapshot`/`updatedAt` they already had until each is
   * individually repaired at its own next read. Not a correctness bug
   * either way (the vault stays the source of truth, and a stale snapshot
   * self-heals on read — see `maybeRunRepair`), but a single shared timer
   * would have made that self-heal path do work a plain per-character
   * timer avoids needing at all.
   */
  const scheduleFanOut = useCallback((character: CharacterRecord) => {
    const timers = fanOutTimersRef.current;
    const existing = timers.get(character.id);
    if (existing !== undefined) clearTimeout(existing);
    timers.set(
      character.id,
      setTimeout(() => {
        timers.delete(character.id);
        void fanOutSnapshot(character);
      }, FAN_OUT_DEBOUNCE_MS),
    );
  }, []);

  /**
   * Applies fetched vault/link data to `orphanedCharacters` state, and
   * records the linked-id set's signature as the new baseline for
   * {@link maybeRefreshOrphanedCharactersOnLinkChange}'s comparison. The
   * one place both `refreshOrphanedCharacters` (always fetches) and that
   * function (fetches only after confirming the set actually changed)
   * converge, so the "compute visible list + update the comparison
   * baseline" step can't drift between the two call sites.
   */
  const applyOrphanRefresh = useCallback(
    (characters: CharacterRecord[], linkedIds: string[]) => {
      linkedCharacterIdsSignatureRef.current = linkedCharacterIdsSignature(linkedIds);
      setOrphanedCharacters(
        visibleRecoverableCharacters(characters, linkedIds, playerIdRef.current, isGMRef.current),
      );
    },
    [],
  );

  /**
   * Unconditionally refreshes `orphanedCharacters` — used the moment the
   * no-sheet screen first appears (`applyTokenLoadResult`'s `"none"`
   * branch), where there is no previous linked-id signature to compare
   * against yet, so a full fetch is the only option anyway.
   *
   * Reads `playerIdRef`/`isGMRef` (via `applyOrphanRefresh`) rather than
   * the plain `playerId`/`isGM` values so this stays correct even if ever
   * called from a callback registered once inside `OBR.onReady`, which
   * would otherwise close over whatever those values were at that first
   * render.
   */
  const refreshOrphanedCharacters = useCallback(() => {
    void fetchOrphanRefreshInputs()
      .then(({ characters, linkedIds }) => applyOrphanRefresh(characters, linkedIds))
      .catch((err) => {
        console.warn("[Nimble] failed to list characters eligible for recovery.", err);
      });
  }, [applyOrphanRefresh]);

  /**
   * Live-update path for `orphanedCharacters` while the no-sheet screen is
   * already showing — reacts to a token being deleted/relinked by ANOTHER
   * client, which (unlike an edit to a character's own fields) never
   * touches scene metadata and so never reaches `onMetadataChange` at all
   * (see that listener's own comment for the gap this specifically closes).
   *
   * Wired into the `items.onChange` listener below, which is this
   * extension's hottest code path — it fires on every token move on the
   * table, the single most frequent gesture on a virtual tabletop, not an
   * edge case. Two hard requirements follow directly from that, both
   * enforced here:
   *
   * 1. **The no-sheet guard is the very first thing checked, synchronously,
   *    before any `await` or OBR call of any kind.** A token drag fires
   *    this on every frame; if nobody is even looking at the no-sheet
   *    screen, this function must return having done nothing measurable at
   *    all, not "having started a cheap read". The check is duplicated
   *    (also present in `applyOrphanRefresh`'s caller context via
   *    `selectionStateRef`) rather than assumed — see the call site.
   * 2. **No OBR call at all before the comparison — not even a "cheap"
   *    one.** `items.onChange`'s own callback parameter IS already the
   *    scene's full, current item list (confirmed, not assumed: it's what
   *    makes `items.find(i => i.id === targetId)` below work at all) — so
   *    `linkedCharacterIdsFromItems(items)` computes the comparison key
   *    from data already in hand, with zero SDK round trips. An earlier
   *    version of this function called `fetchLinkedCharacterIds` here
   *    instead, re-fetching via `getItems` the exact list this callback
   *    had ALREADY been handed — asking OBR again for what it had just
   *    given us, on every single frame of every drag. Only once the
   *    resulting signature (`linkedCharacterIdsSignature`) actually
   *    differs from the baseline recorded by the last `applyOrphanRefresh`
   *    call does a REAL OBR call happen: `listCharacters`, the full vault
   *    read. Without this, every frame of every drag, for anyone parked on
   *    the no-sheet screen, would cost at least one OBR round trip — trading
   *    a display bug (point 2 of the earlier fix) for guaranteed, continuous
   *    load on the hottest path in this extension.
   *
   * @param items - The scene's full current item list, exactly as handed
   * to the `items.onChange` callback — never re-fetched.
   */
  const maybeRefreshOrphanedCharactersOnLinkChange = useCallback((items: Item[]) => {
    if (selectionStateRef.current !== "no-sheet") return;
    const linkedIds = linkedCharacterIdsFromItems(items);
    const signature = linkedCharacterIdsSignature(linkedIds);
    if (signature === linkedCharacterIdsSignatureRef.current) return; // unchanged — nothing to do
    void listCharacters()
      .then((characters) => applyOrphanRefresh(characters, linkedIds))
      .catch((err) => {
        console.warn("[Nimble] failed to refresh characters eligible for recovery.", err);
      });
  }, [applyOrphanRefresh]);

  /**
   * Applies the result of {@link loadCharacterForToken} to local state:
   * sets `selectionState`/`character`, dispatches any
   * {@link BackgroundWrite} per its `kind` (see that type's own doc for
   * why each kind is handled differently), and records `item`'s own
   * {@link CharacterLink} in `selectedTokenLinkRef` — the baseline the
   * `items.onChange` listener compares against to decide whether a future
   * event even needs to reach this function again (see that listener's own
   * comment).
   *
   * @param item - The token this result was loaded for — the actual item,
   * not just its id, since this needs to read `item.metadata[LINK_KEY]`
   * itself to update `selectedTokenLinkRef`.
   * @param result - What `loadCharacterForToken` resolved.
   */
  const applyTokenLoadResult = useCallback(
    (item: Item, result: TokenLoadResult) => {
      const tokenId = item.id;
      const link = item.metadata?.[LINK_KEY] as CharacterLink | undefined;
      selectedTokenLinkRef.current = link
        ? { tokenId, characterId: link.characterId, updatedAt: link.updatedAt }
        : null;

      if (result.status === "none") {
        setSelectionState("no-sheet");
        setCharacter(null);
        // Cleared, not left stale, while the fresh list loads — otherwise
        // a token with no orphans to offer would briefly show the previous
        // no-sheet token's list until this fetch resolves.
        setOrphanedCharacters([]);
        refreshOrphanedCharacters();
        return;
      }
      if (result.status === "unsupported") {
        setSelectionState("unsupported-version");
        setCharacter(null);
        return;
      }
      if (result.status === "invalid") {
        setSelectionState("invalid-sheet");
        setCharacter(null);
        return;
      }

      const bw = result.backgroundWrite;
      if (bw?.kind === "legacy-migration") {
        pendingLegacyMigrationRef.current = { tokenId, run: bw.run };
      } else if (bw?.kind === "rehydrate") {
        bw.run().catch((err) => {
          console.warn(
            `[Nimble] rehydration of character into the vault failed for token ${tokenId} — ` +
              `will retry the next time this token is read.`,
            err,
          );
        });
      } else if (bw?.kind === "repair") {
        maybeRunRepair(tokenId, bw.character);
      }
      setCharacter(result.character);
      setSelectionState("ready");
    },
    [maybeRunRepair, refreshOrphanedCharacters],
  );

  /**
   * Recomputes `selectionState`, `selectedItems`, and `character` whenever
   * the player's scene selection changes. Filters to CHARACTER-layer items
   * only, since the sheet only applies to character tokens.
   */
  const handleSelectionChange = useCallback(
    async (selectedIds: string[]) => {
      if (!selectedIds || selectedIds.length === 0) {
        selectedTokenIdRef.current = null;
        selectedTokenLinkRef.current = null;
        setSelectedItems([]);
        setSelectionState("none");
        setCharacter(null);
        return;
      }
      const items = await OBR.scene.items.getItems(selectedIds);
      const tokens = items.filter((i) => i.layer === "CHARACTER");
      setSelectedItems(tokens);

      if (tokens.length === 0) {
        selectedTokenIdRef.current = null;
        selectedTokenLinkRef.current = null;
        setSelectionState("none");
        setCharacter(null);
      } else if (tokens.length > 1) {
        // No single write target while multiple tokens are selected — see
        // selectedTokenIdRef's doc. `App.tsx` never renders edit controls
        // in this state (selectionState "multiple" is display-only), and
        // clearing the refs here backs that up: a write attempted from a
        // stale closure would find no target rather than guessing one.
        selectedTokenIdRef.current = null;
        selectedTokenLinkRef.current = null;
        setSelectionState("multiple");
        // Display (and free-roll stat source) only — never triggers a
        // background write of any kind. A bulk selection isn't a
        // deliberate "open this sheet" action on any one token.
        const result = await loadCharacterForToken(tokens[0]);
        setCharacter(result.status === "ready" ? result.character : null);
      } else {
        selectedTokenIdRef.current = tokens[0].id;
        const result = await loadCharacterForToken(tokens[0]);
        applyTokenLoadResult(tokens[0], result);
      }
    },
    [applyTokenLoadResult],
  );

  useEffect(() => {
    if (!OBR.isAvailable) return;
    // Registration happens inside OBR.onReady's async callback, so the
    // unsubscribe functions the SDK hands back (player.onChange,
    // scene.items.onChange, scene.onMetadataChange all return `() => void`)
    // can't be returned directly from this effect the way a synchronous
    // subscription would be. Collected here instead, and the effect's
    // cleanup calls all of them. `cancelled` additionally guards the
    // registration itself: in StrictMode/HMR an effect can be torn down
    // (cleanup runs) while this async callback is still in flight, and
    // without the guard it would register fresh listeners *after* its own
    // cleanup already ran, leaking them for the lifetime of the page.
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    OBR.onReady(async () => {
      const [pid, pname, prole, initialSelection] = await Promise.all([
        OBR.player.getId(),
        OBR.player.getName(),
        OBR.player.getRole(),
        OBR.player.getSelection(),
      ]);
      setPlayerId(pid);
      setPlayerName(pname);
      playerNameRef.current = pname;
      setRole(prole as OBRRole);
      setIsReady(true);
      await handleSelectionChange(initialSelection || []);
      void cleanupOrphanedMonsters();
      await OBR.action.setWidth(400);
      await OBR.action.setHeight(800);
      await OBR.action.setTitle("Nimble Sheet");

      if (cancelled) return;

      unsubscribers.push(
        OBR.player.onChange(async (player: Player) => {
          await handleSelectionChange(player.selection || []);
        }),
      );

      unsubscribers.push(
        OBR.scene.items.onChange(async (items) => {
          // This fires on every token move on the table — the hottest path
          // in this extension, not an edge case. Called FIRST, before the
          // selected-token logic below (which is scoped to "does this
          // change concern MY selected token" and would often return
          // before ever reaching a later call — moving some OTHER token
          // wouldn't touch the currently selected one at all): its own
          // first action is a synchronous, no-sheet-only check that
          // returns immediately, before any OBR call, for the overwhelming
          // majority of events where nobody is even looking at the
          // recovery list. `items` is passed straight through — see its
          // own doc for why it must never re-fetch what this callback was
          // already handed.
          maybeRefreshOrphanedCharactersOnLinkChange(items);

          // Match against the real selected item id, never a value read out
          // of stored character data — see selectedTokenIdRef's doc.
          const targetId = selectedTokenIdRef.current;
          if (!targetId) return;
          const updatedItem = items.find((i) => i.id === targetId);
          // Reachable, confirmed (not assumed): `items` here is the scene's
          // FULL current item list (proven by the `.find` above actually
          // working at all — a delta-only list couldn't reliably resolve
          // `targetId` this way). A deleted item is simply absent from that
          // full list on the very `onChange` call the deletion itself
          // triggers, so this genuinely fires for "the selected token was
          // just deleted", not a case that can never happen.
          if (!updatedItem) return; // sheet's token removed mid-session — leave state as-is

          // THE guard for this hot path: does this token's own link even
          // differ from what was last loaded? A drag/rotate/etc. touches
          // position/rotation/etc, never `item.metadata[LINK_KEY]`, so the
          // overwhelming majority of events reaching this point (anything
          // concerning the selected token that isn't a link change) stop
          // here — before `loadCharacterForToken`'s vault read, migration,
          // and `setCharacter` (a new object, so a full sheet re-render)
          // ever run. Before schema v6, this exact case needed no dedicated
          // check: the character WAS the item's own metadata, so a plain
          // position change never touched the field this hook actually
          // read. Comparing `selectedTokenLinkRef` (what was last actually
          // processed) restores that same property now that a link
          // indirects to the vault instead.
          const currentLink = updatedItem.metadata?.[LINK_KEY] as CharacterLink | undefined;
          const lastProcessed = selectedTokenLinkRef.current;
          if (
            currentLink &&
            lastProcessed &&
            lastProcessed.tokenId === targetId &&
            lastProcessed.characterId === currentLink.characterId &&
            lastProcessed.updatedAt === currentLink.updatedAt
          ) {
            return; // token's own link is unchanged — nothing to reload
          }

          // Recognizes this listener's own repair write echoing back and
          // skips reprocessing it — see lastRepairedUpdatedAtRef's doc.
          // Catches specifically the one case the check above cannot: right
          // after a successful repair, `currentLink.updatedAt` is NEWER
          // than `selectedTokenLinkRef` (which is only updated once
          // `applyTokenLoadResult` runs again), so the check above does not
          // short-circuit on that first echo — this one still does, via the
          // separate value `maybeRunRepair` itself recorded on success.
          // Purely an efficiency measure: `maybeRunRepair`'s in-flight/
          // backoff guard is what actually bounds the write rate; without
          // this check, the repair's own echo would still just cost one
          // extra (correct, convergent, non-looping) reprocessing pass, not
          // a correctness bug.
          if (currentLink && lastRepairedUpdatedAtRef.current.get(updatedItem.id) === currentLink.updatedAt) {
            return;
          }

          const result = await loadCharacterForToken(updatedItem);
          applyTokenLoadResult(updatedItem, result);
        }),
      );

      // Single source of truth for the roll log — only update from metadata,
      // never from local setRecentRolls after a push (avoids double-update re-mounts).
      // Also the resync path for the currently loaded character's VAULT
      // entry: the vault, not any one token, is what changes when another
      // client edits this character, so this listener (not items.onChange
      // above) is what a remote character edit actually arrives through.
      //
      // TRAP for any future write that changes WHICH character.id is
      // loaded (not just fields on the same one): this resync below reads
      // `characterRef.current.id` to decide what to re-fetch. Every write
      // in this hook except switchToMonster/switchToPlayer keeps that id
      // constant, so a stale ref here is harmless (re-fetching the same id
      // just confirms what was already set). A write that swaps `character`
      // to a DIFFERENT id must set `characterRef.current` itself,
      // synchronously, BEFORE any OBR write that could trigger this
      // listener — otherwise this resync fires with the OLD id, re-fetches
      // the OLD (still-valid, not-yet-deleted) record, and silently
      // overwrites the new one. See switchToMonster's own `@remarks` for
      // the full trace of this exact bug.
      unsubscribers.push(
        OBR.scene.onMetadataChange(async (meta) => {
          const log = meta[ROLL_LOG_KEY] as DiceRollResult[] | undefined;
          if (log) setRecentRolls(log.slice(-MAX_ROLL_HISTORY));

          const current = characterRef.current;
          if (current) {
            // Re-reads through loadCharacter (its own round trip) rather
            // than picking `character.id`'s key out of `meta` directly, so
            // this stays behind the same validate/migrate choke point as
            // every other vault read instead of a second, hand-rolled one
            // here.
            const fresh = await loadCharacter(current.id);
            if (fresh) setCharacter(fresh);
          }

          // Keeps the "Retrieve a lost soul" list live while the no-sheet
          // screen is showing, rather than frozen at whatever it was the
          // moment that screen first appeared — guarded on
          // selectionStateRef (not the plain `selectionState` closure,
          // stale here — see refreshOrphanedCharacters' own doc) so this
          // doesn't run an extra vault read on every single scene-metadata
          // change table-wide when nobody's even looking at that screen.
          //
          // Known gap: this fires on VAULT changes, never on a pure token
          // deletion with no accompanying vault write — item metadata and
          // scene metadata are separate OBR channels, and today nothing
          // touches the vault when a `"player"`-kind token alone is
          // deleted (only `"monster"`-kind does, via
          // cleanupOrphanedMonsters, and only at scene load). A token
          // deleted elsewhere while this screen is open is not guaranteed
          // to appear here until something else changes the vault too.
          if (selectionStateRef.current === "no-sheet") {
            refreshOrphanedCharacters();
          }
        }),
      );

      // `App.tsx` is a single JSX tree that never unmounts (see CLAUDE.md),
      // so switching scenes alone does not clear whatever character was
      // loaded from the previous scene — without this, the panel keeps
      // showing the old scene's sheet (wrong data presented as current,
      // not an empty state) until the player happens to change selection.
      // `ready` goes false during the switch and back to true once the new
      // scene has loaded; the false transition resets local state, and the
      // true transition re-runs the orphaned-monster sweep for the newly
      // entered scene (selection itself is repopulated separately, through
      // the normal `player.onChange`/`handleSelectionChange` path).
      unsubscribers.push(
        OBR.scene.onReadyChange((ready) => {
          if (!ready) {
            selectedTokenIdRef.current = null;
            setSelectedItems([]);
            setSelectionState("none");
            setCharacter(null);
            return;
          }
          void cleanupOrphanedMonsters();
        }),
      );
    });

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [
    handleSelectionChange,
    applyTokenLoadResult,
    refreshOrphanedCharacters,
    maybeRefreshOrphanedCharactersOnLinkChange,
  ]);

  // Cleanup for the pending-write and fan-out debounce timers — same
  // discipline as the SDK listener unsubscribes above, applied to
  // setTimeout instead.
  useEffect(() => {
    // Captured once here, not read as `fanOutTimersRef.current` inside the
    // cleanup itself: same Map object either way (never replaced, only
    // mutated — see scheduleFanOut), but this satisfies the lint rule
    // about reading a ref's `.current` inside a cleanup closure.
    const fanOutTimers = fanOutTimersRef.current;
    return () => {
      if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
      for (const timer of fanOutTimers.values()) clearTimeout(timer);
    };
  }, []);

  /**
   * Surfaces `"offline"` proactively, independent of any write attempt —
   * `assertOnline` (called from inside each write's `execute`) only fires
   * when a write is actually tried, so without this a player who opens the
   * sheet already offline would see nothing until they typed something.
   * Runs regardless of `OBR.isAvailable`/`OBR.onReady`: connectivity is a
   * plain browser fact, unrelated to whether the OBR host has finished its
   * own handshake.
   *
   * Purely informational. Does NOT gate anything: reading the sheet,
   * rolling locally, editing a formula draft all keep working exactly as
   * before — only the OBR write itself (via `assertOnline` inside
   * `execute`) refuses to pretend it succeeded. See `"offline"` in
   * {@link SyncStatus}'s doc.
   *
   * Coming back online clears ONLY this `"offline"` status, and does
   * nothing else — deliberately no replay of writes attempted while
   * offline. Queuing and auto-retrying them on reconnect would resend
   * whatever was true when they were queued against a table that has kept
   * moving in the meantime, the exact same staleness risk already
   * documented for manual retry ({@link SyncErrorStatus.retry}), except
   * automatic and unannounced instead of something the player chose. A
   * write that failed while offline is reported through the normal
   * `"error"` path (`assertOnline` throwing is just another rejection
   * `performWrite` catches) with its own Retry button; the player decides
   * if and when to press it, same as any other failed write.
   */
  useEffect(() => {
    const setOffline = () => {
      setSyncStatus((prev) => (prev.state === "error" ? prev : { state: "offline" }));
    };
    const setOnline = () => {
      setSyncStatus((prev) => (prev.state === "offline" ? { state: "idle" } : prev));
    };
    if (!navigator.onLine) setOffline();
    window.addEventListener("offline", setOffline);
    window.addEventListener("online", setOnline);
    return () => {
      window.removeEventListener("offline", setOffline);
      window.removeEventListener("online", setOnline);
    };
  }, []);

  /**
   * Central choke point for every OBR SDK write this hook performs
   * (character sheet edits, roll log, sheet creation, claiming) — wraps
   * `execute` with {@link SyncStatus} tracking so a failure is visible
   * instead of silent, which is the reliability gap this exists to close.
   *
   * @param options.execute - Performs the actual SDK call(s). Must re-read
   * any character state it needs from `characterRef.current` at call time
   * rather than closing over a value captured earlier: this same function
   * runs again, unchanged, on retry.
   * @param options.isOptimistic - Passed straight through to
   * {@link describeWriteError}; see its doc. Defaults to `false`; only
   * `updateCharacter` sets it.
   * @param options.isRetry - Internal: marks this call as the retry of an
   * existing error, so its success is allowed to clear that specific
   * error. A plain (non-retry) success never clears an existing error —
   * see the `"error"` case in {@link SyncStatus}: otherwise a later,
   * unrelated write succeeding would silently make the earlier failure's
   * banner disappear, and the player would never have seen that the
   * earlier change was lost.
   * @param options.retryOfErrorId - Internal: the error id this call is
   * retrying. Guards against a stale retry clearing a newer, unrelated
   * error that has since replaced the one actually being retried.
   * @returns `true` if `execute()` ran to completion without throwing,
   * `false` if it threw (in which case {@link SyncStatus} has already been
   * set to `"error"` before this resolves). Callers that only care about
   * `syncStatus` (every existing call site except `updateCharacter`) can
   * ignore this. Note it only tells you `execute()` didn't throw, not that
   * it necessarily performed a write: `updateCharacter`'s own `execute`
   * silently returns early, without throwing, if `canEditRef.current` has
   * gone false since the call was made — resolving this `true` for a
   * no-op. That inner guard exists for the retry case (rights revoked
   * between the original attempt and a later Retry click) and is not
   * reachable on a fresh, non-retry call the way `useDeleteUndo`'s
   * `deleteWithUndo` makes one, so it doesn't undermine that hook's use of
   * this return value to decide whether a delete is worth offering an
   * undo for.
   *
   * @remarks As of schema v6, `execute` no longer returns a token id for a
   * post-write existence check: the write that matters now targets the
   * vault (by `character.id`, immune to any one token's existence), and
   * every write that still touches a specific token (sheet creation,
   * claiming) is a token the player is actively looking at, not one this
   * hook needs to double-check survived the round trip. See the removed
   * "token no longer exists" outcome in `SyncStatus`'s own doc for the
   * full reasoning.
   */
  const performWrite = async (options: {
    execute: () => Promise<void>;
    isOptimistic?: boolean;
    isRetry?: boolean;
    retryOfErrorId?: number;
  }): Promise<boolean> => {
    const {
      execute,
      isOptimistic = false,
      isRetry = false,
      retryOfErrorId,
    } = options;

    pendingWritesRef.current += 1;
    if (pendingTimerRef.current === null) {
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        if (pendingWritesRef.current > 0) {
          setSyncStatus((prev) => (prev.state === "error" ? prev : { state: "pending" }));
        }
      }, PENDING_DELAY_MS);
    }

    const settle = () => {
      pendingWritesRef.current -= 1;
      if (pendingWritesRef.current === 0 && pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };

    try {
      await execute();
      settle();
      if (isRetry) {
        setSyncStatus((prev) =>
          prev.state === "error" && retryOfErrorId === currentErrorIdRef.current
            ? { state: "idle" }
            : prev,
        );
      } else {
        setSyncStatus((prev) => (prev.state === "error" ? prev : { state: "idle" }));
      }
      return true;
    } catch (err) {
      settle();
      currentErrorIdRef.current += 1;
      const errorId = currentErrorIdRef.current;
      setSyncStatus({
        state: "error",
        message: describeWriteError(err, isOptimistic),
        canRetry: true,
        retry: () => {
          void performWrite({ ...options, isRetry: true, retryOfErrorId: errorId });
        },
        dismiss: () => setSyncStatus({ state: "idle" }),
      });
      return false;
    }
  };

  // Kept in sync with `performWrite` every render so the migration
  // write-back effect below can call the latest `performWrite` without
  // listing it as a dependency — same "ref for latest closure" pattern as
  // `characterRef`/`canEditRef`/`playerIdRef` above. `performWrite` itself
  // stays a plain (non-memoized) function: it self-references its own name
  // inside its `retry` closure for the retry-of-retry case, which the
  // react-hooks/immutability rule flags as unsafe on a `useCallback`-wrapped
  // value (its identity finalizes only after `retry`'s closure is created).
  const performWriteRef = useRef(performWrite);
  useEffect(() => {
    performWriteRef.current = performWrite;
  });

  /**
   * Writes back a token whose sheet was just migrated off the legacy
   * `METADATA_KEY` storage location (see `loadCharacterForToken`'s legacy
   * branch and `pendingLegacyMigrationRef`'s own doc), so the token stops
   * re-migrating the same old data on every future load.
   *
   * Runs as its own effect, keyed off `pendingLegacyMigrationRef`, rather
   * than inline in `handleSelectionChange`: by the time this effect runs,
   * `character` (and therefore `canEdit`/`isOwner`, both derived from it
   * above) already reflects the just-loaded record, so this reuses the same
   * `canEdit` every other write in this hook is gated on instead of
   * re-deriving permission from `ownerId` a second way.
   *
   * A read-only viewer (not GM, not owner) never reaches the write: `canEdit`
   * is `false` for them, so the ref is cleared and nothing is sent. Two
   * clients that both hold edit rights and load the same stale sheet at
   * nearly the same time both write here; since the migration is a pure
   * function of the same stored data, both writes carry identical content,
   * so whichever lands last simply repeats the same result — no different
   * from any other pair of near-simultaneous writes this hook already
   * doesn't defend against (there is no compare-and-swap on the OBR side).
   * A token nobody with edit rights ever selects stays on the legacy
   * storage location indefinitely, migrated only in memory for whoever
   * views it — accepted, not solved here, same as the pre-v6 equivalent of
   * this effect always was for a plain schema-version bump.
   */
  useEffect(() => {
    if (!character) return;
    const pending = pendingLegacyMigrationRef.current;
    // Compared against the live selection (selectedTokenIdRef), never any
    // value derived from stored character data — see that ref's doc.
    if (!pending || pending.tokenId !== selectedTokenIdRef.current) return;
    pendingLegacyMigrationRef.current = null;
    if (!canEdit) return;
    void performWriteRef.current({
      execute: async () => {
        assertOnline();
        await pending.run();
      },
    });
  }, [character, canEdit]);

  /**
   * Applies a partial update to the currently loaded character and persists
   * it to the vault (`characterStore.ts`'s `saveCharacter`), then schedules
   * a debounced fan-out of the new state to every token's
   * {@link CharacterLink} (see `scheduleFanOut`/`fanOutSnapshot`) — not
   * immediate, since the vault save above is what actually makes this
   * write visible to every other client; the fan-out only refreshes the
   * cross-scene-copy-paste transport copy.
   *
   * Guarded by `canEditRef`: if the caller doesn't currently hold edit
   * rights (not GM, not the sheet's owner), the update is silently
   * dropped and a warning is logged. This is a client-side sanity check,
   * not a real security boundary — OBR has no server-side ACL on
   * metadata, so a determined player could still write via devtools.
   * What it *does* protect against is accidental writes triggered by
   * stale UI (e.g. a button that should have been hidden/disabled but
   * briefly wasn't during a re-render).
   *
   * Also clamps `level` to `[1, MAX_LEVEL]`, `stats` to `[MIN_STAT, MAX_STAT]`,
   * `skills` to `[MIN_SKILL, MAX_SKILL]`, and `keyStats` to at most
   * {@link MAX_KEY_STATS} entries, when present in `updates` — an
   * unbounded level can push a legitimate dynamic-dice spell formula
   * (`incrementdice`/`stepdice`) past formulaParser's dice safety limits,
   * turning it into one that always errors out, and stats/skills/keyStats
   * have their own rulebook-defined ranges (see those constants' JSDoc).
   * Clamped here, at the single write choke point, rather than only as an
   * input hint, since an HTML `max` attribute (or a UI-level cap on the
   * `StatBox` triangle toggle) doesn't stop a hand-crafted value from being
   * committed.
   *
   * @param updates - Partial character fields to merge into the current state.
   * @returns `true` if the write went through, `false` if it was blocked
   * (no character loaded, no edit rights) or failed — see
   * {@link performWrite}'s `@returns` for exactly what this does and
   * doesn't guarantee. `useDeleteUndo.deleteWithUndo` relies on this to
   * decide whether a delete is worth offering an undo for; most other
   * callers (every plain field edit) ignore it, which is fine since the
   * return type is compatible with the `void`-returning `onUpdate` prop
   * every tab component declares.
   */
  const updateCharacter = async (
    updates: Partial<NimbleCharacter>,
  ): Promise<boolean> => {
    const current = characterRef.current;
    if (!current || current.kind !== "player") return false;
    if (!canEditRef.current) {
      console.warn(
        "[Nimble] updateCharacter blocked: current player has no edit rights on this sheet.",
      );
      return false;
    }
    const clampedUpdates: Partial<NimbleCharacter> = { ...updates };
    if (clampedUpdates.level !== undefined) {
      clampedUpdates.level = Math.min(Math.max(clampedUpdates.level, 1), MAX_LEVEL);
    }
    if (clampedUpdates.stats !== undefined) {
      clampedUpdates.stats = clampRecord<keyof Stats>(
        clampedUpdates.stats,
        MIN_STAT,
        MAX_STAT,
      );
    }
    if (clampedUpdates.skills !== undefined) {
      clampedUpdates.skills = clampRecord<keyof Skills>(
        clampedUpdates.skills,
        MIN_SKILL,
        MAX_SKILL,
      );
    }
    if (clampedUpdates.keyStats !== undefined) {
      clampedUpdates.keyStats = clampedUpdates.keyStats.slice(-MAX_KEY_STATS);
    }

    return performWrite({
      // setCharacter below runs before the write is confirmed — see
      // describeWriteError's isOptimistic doc for why the error message
      // needs to know that.
      isOptimistic: true,
      execute: async () => {
        // Re-read at call time, not the `current` captured above: this
        // same closure runs again, unchanged, on retry, potentially after
        // other fields changed remotely — see performWrite's JSDoc.
        const latest = characterRef.current;
        if (!latest || latest.kind !== "player" || !canEditRef.current) return;
        const updated = { ...latest, ...clampedUpdates, updatedAt: Date.now() };
        // setCharacter first, offline check second: the field must still
        // show what was typed even if we already know the write will fail
        // (see assertOnline's doc) — checking before setCharacter would
        // revert the keystroke instead.
        setCharacter(updated);
        assertOnline();
        await saveCharacter(updated);
        // Debounced, not immediate — see scheduleFanOut's doc for why the
        // fan-out doesn't need to run on the same cadence as the vault
        // save that's actually the source of truth.
        scheduleFanOut(updated);
      },
    });
  };

  /**
   * The `MonsterSheet` equivalent of {@link updateCharacter} — same write
   * mechanics (vault save, debounced fan-out, optimistic local state), but
   * gated on GM role alone rather than `canEditRef` — a monster's `canEdit`
   * already reduces to `isGM` (see the permissions block above), but this
   * reads `isGMRef` directly rather than `canEditRef` so the guard's intent
   * ("only the GM may touch a monster sheet") stays legible on its own,
   * without relying on the reader recalling how `canEdit` happens to be
   * derived for this one kind. No clamping: `MonsterSheet` has no
   * rulebook-bounded numeric fields the way `NimbleCharacter.level`/
   * `stats`/`skills` do — `damageTaken`/`maxHp`/`speed` are the GM's own
   * numbers, informed by whatever statblock they're already tracking
   * elsewhere, not values this app has any rulebook basis to clamp.
   *
   * @param updates - Partial monster fields to merge into the current state.
   * @returns Same contract as {@link updateCharacter}'s `@returns`.
   */
  const updateMonster = async (
    updates: Partial<MonsterSheet>,
  ): Promise<boolean> => {
    const current = characterRef.current;
    if (!current || current.kind !== "monster") return false;
    if (!isGMRef.current) {
      console.warn(
        "[Nimble] updateMonster blocked: only the GM may edit a monster sheet.",
      );
      return false;
    }

    return performWrite({
      isOptimistic: true,
      execute: async () => {
        const latest = characterRef.current;
        if (!latest || latest.kind !== "monster" || !isGMRef.current) return;
        const updated = { ...latest, ...updates, updatedAt: Date.now() };
        setCharacter(updated);
        assertOnline();
        await saveCharacter(updated);
        scheduleFanOut(updated);
      },
    });
  };

  /**
   * Appends a roll result to the shared roll log.
   *
   * Hidden rolls (GM-only) are *not* written to scene metadata — they are
   * appended directly to local state instead, so only the roller (the GM)
   * sees them. Visible rolls are written to `OBR.scene.setMetadata`; the
   * `onMetadataChange` listener registered in the main effect is the only
   * place that calls `setRecentRolls` for visible rolls, to avoid a double
   * state update that would otherwise remount conditional UI in `App`.
   *
   * @param result - The roll result to log.
   */
  const pushRollToLog = async (result: DiceRollResult) => {
    if (result.hidden) {
      // Not written to scene — update locally only
      setRecentRolls((prev) => [...prev, result].slice(-MAX_ROLL_HISTORY));
      return;
    }
    await performWrite({
      // Unlike the other 3 call sites, retry here can't overwrite a
      // concurrent change: execute re-fetches the log fresh (below) and
      // appends to it, on both the original attempt and any retry, rather
      // than replacing a whole stored object with a locally-held copy.
      execute: async () => {
        assertOnline();
        // Re-fetched fresh on every call, including retry, so a retry
        // appends after whatever the log looks like right now rather than
        // replaying a stale snapshot from the original failed attempt.
        const meta = await OBR.scene.getMetadata();
        const existing = (meta[ROLL_LOG_KEY] as DiceRollResult[]) || [];
        const newLog = [...existing, result].slice(-MAX_ROLL_HISTORY);
        // onMetadataChange will fire and update recentRolls — don't call setRecentRolls here
        await OBR.scene.setMetadata({ [ROLL_LOG_KEY]: newLog });
      },
    });
  };

  /**
   * Rolls a formula tied to the currently loaded character (uses its stats/
   * skills/level as context) and logs the result.
   *
   * Rolling is intentionally NOT gated by `canEdit` — read-only viewers
   * (e.g. a player looking at another player's sheet) should still be
   * able to roll dice using that sheet's stats (this is a tabletop game,
   * not a permissions system for hiding numbers). Only *persisting changes
   * to the sheet itself* goes through {@link updateCharacter}'s guard.
   *
   * @param req - Label, formula, roll mode, and optional hidden flag.
   * @returns The resolved {@link DiceRollResult}, or `null` if no character
   * is loaded, or the loaded record is a {@link MonsterSheet} — a monster
   * sheet carries no formulas at all (see that type's doc), so there is
   * nothing this could ever roll; `MonsterPanel` never wires an `onRoll` in
   * the first place, this guard is defense in depth against a stale
   * closure calling it anyway.
   * If the formula failed (`result.error` set), the result is still
   * returned to the caller (so it can show the roller what went wrong) but
   * is *not* pushed to the shared roll log — a failed roll must never reach
   * the table looking like a legitimate total of 0.
   */
  const handleRoll = async (
    req: DiceRollRequest,
  ): Promise<DiceRollResult | null> => {
    const current = characterRef.current;
    if (!current || current.kind !== "player") return null;
    const rolled = rollFormula(
      req.formula,
      current,
      req.mode,
      req.advantageCount ?? 0,
    );
    const result: DiceRollResult = {
      ...rolled,
      label: req.label,
      formula: req.formula,
      playerId: playerIdRef.current,
      playerName: playerNameRef.current,
      timestamp: Date.now(),
      hidden: req.hidden || false,
    };
    if (result.error) return result;
    await pushRollToLog(result);
    return result;
  };

  /**
   * Rolls a formula with no character context (used by the standalone
   * {@link DicePanel} free-roll widget), via {@link rollFormulaWithContext}
   * and {@link FREE_ROLL_CONTEXT} instead of building a fake
   * {@link NimbleCharacter} to satisfy {@link rollFormula}'s signature.
   *
   * @param req - Label, formula, roll mode, and optional hidden flag.
   * @returns The resolved {@link DiceRollResult}. Same failure handling as
   * {@link handleRoll}: a result with `.error` set is returned but not
   * pushed to the shared roll log.
   */
  const handleFreeRoll = async (
    req: DiceRollRequest,
  ): Promise<DiceRollResult | null> => {
    const rolled = rollFormulaWithContext(
      req.formula,
      FREE_ROLL_CONTEXT,
      req.mode,
      req.advantageCount ?? 0,
    );
    const result: DiceRollResult = {
      ...rolled,
      label: req.label,
      formula: req.formula,
      playerId: playerIdRef.current,
      playerName: playerNameRef.current,
      timestamp: Date.now(),
      hidden: req.hidden || false,
    };
    if (result.error) return result;
    await pushRollToLog(result);
    return result;
  };

  /**
   * Rolls initiative for the current character: `1d20 + DEX + initiativeBonus`.
   * Routed through {@link DiceRollModal} like every other roll (see
   * CombatTab), so `mode`/`advantageCount`/`hidden` come from the same
   * confirmation the player already sees for stat saves/skill checks.
   *
   * @param mode - Roll mode, defaults to "standard".
   * @param advantageCount - Extra dice for advantage/disadvantage, see {@link DiceRollRequest.advantageCount}.
   * @param hidden - GM-only hidden roll flag, see {@link DiceRollRequest.hidden}.
   * @returns The resolved {@link DiceRollResult}, or `null` if no character is loaded.
   */
  const rollInitiative = async (
    mode: RollMode = "standard",
    advantageCount = 0,
    hidden = false,
  ) => {
    const current = characterRef.current;
    if (!current || current.kind !== "player") return null;
    return handleRoll({
      label: "Initiative",
      formula: `1d20${formatModifier(current.stats.dex + (current.initiativeBonus || 0))}`,
      mode,
      advantageCount,
      hidden,
    });
  };

  /**
   * Creates a brand-new default character, saves it to the vault, and links
   * the given token to it, making the calling player its owner.
   *
   * @param item - The OBR scene item (token) to attach a sheet to.
   */
  const createSheetForToken = async (item: Item) => {
    const newChar = createDefaultCharacter(playerIdRef.current);
    await performWrite({
      execute: async () => {
        assertOnline();
        // Token link written before the vault entry — see
        // cleanupOrphanedMonsters' comment for why this ordering is always
        // used for character creation, not only when kind is "monster".
        await OBR.scene.items.updateItems([item.id], (items) => {
          for (const i of items) i.metadata[LINK_KEY] = linkFor(newChar);
        });
        await saveCharacter(newChar);
        setCharacter(newChar);
        setSelectionState("ready");
      },
    });
  };

  /**
   * Creates a brand-new default {@link MonsterSheet} and links the given
   * token to it directly — GM-only. Not "create a player sheet, then
   * switch": see `NoSheetPanel`'s `onCreateMonster` doc for why routing a
   * monster through a throwaway `NimbleCharacter` first would leave an
   * orphaned, unrecoverable-by-cleanup "New Hero" record behind in the
   * vault every time.
   *
   * @param item - The OBR scene item (token) to attach a monster sheet to.
   */
  const createMonsterForToken = async (item: Item) => {
    if (!isGMRef.current) {
      console.warn("[Nimble] createMonsterForToken blocked: GM only.");
      return;
    }
    const newMonster = createDefaultMonster(playerIdRef.current);
    await performWrite({
      execute: async () => {
        assertOnline();
        if (!isGMRef.current) return;
        // Same ordering as createSheetForToken — token link before vault
        // entry, see cleanupOrphanedMonsters' comment for why.
        await OBR.scene.items.updateItems([item.id], (items) => {
          for (const i of items) i.metadata[LINK_KEY] = linkFor(newMonster);
        });
        await saveCharacter(newMonster);
        setCharacter(newMonster);
        setSelectionState("ready");
      },
    });
  };

  /**
   * Switches the selected token's sheet from player to monster mode —
   * GM-only, never a mutation in place (see `characterSwitch.ts`'s
   * `convertToMonster`). The original `NimbleCharacter` record is left
   * behind in the vault, unlinked — a `"player"`-kind record with no
   * token pointing to it is exactly what "Retrieve a lost soul" already
   * surfaces, so it stays recoverable through that existing path with no
   * bespoke undo mechanism needed.
   *
   * Does NOT show a confirmation dialog itself — the caller
   * (`CharacterHeader`'s switch button) is responsible for that; this
   * function performs the switch unconditionally once called.
   *
   * @remarks Sets local state (`character` AND `characterRef.current`,
   * synchronously, before either OBR write) — diagnosed as load-bearing,
   * not cosmetic: `OBR.scene.onMetadataChange`'s listener (this file's main
   * effect) resyncs "the currently loaded character" by re-reading
   * `characterRef.current.id` from the vault whenever ANY scene-metadata
   * write lands, including this function's own `saveCharacter(monster)`.
   * Every OTHER write in this hook keeps that ref pointed at the SAME
   * character id throughout (only fields on it change), so that resync is
   * harmless there. This function is the one place `character.id` itself
   * changes while a sheet is already open — if `characterRef.current`
   * still held the OLD player id when that listener's resync fired (which
   * it would, updating that ref only via the `useEffect` mirror further up
   * runs strictly after this render commits, i.e. possibly after the
   * listener already read it), the listener would re-fetch the OLD
   * player record (still sitting in the vault, unlinked but not deleted —
   * see `characterSwitch.ts`) and silently overwrite this function's own
   * correct `setCharacter(monster)` with it. Reproduced exactly like this
   * in real testing: the switch appeared to do nothing until the token was
   * deselected and reselected, which forces a clean, unraced reload.
   * Updating `characterRef.current` here, synchronously, before either
   * write starts, closes the window: by the time that listener's resync
   * can possibly run, it already sees the new monster id, and re-fetching
   * that id only ever lands on the (correct) new data.
   * @returns `false` without writing anything if the guard fails (no
   * selected token, no character loaded, the loaded character isn't a
   * player sheet, or not GM) or the write itself fails.
   */
  const switchToMonster = async (): Promise<boolean> => {
    const targetId = selectedTokenIdRef.current;
    const initial = characterRef.current;
    if (!targetId || !initial || initial.kind !== "player" || !isGMRef.current) return false;

    return performWrite({
      isOptimistic: true,
      execute: async () => {
        const latest = characterRef.current;
        if (!targetId || !latest || latest.kind !== "player" || !isGMRef.current) return;
        const monster = convertToMonster(latest, playerIdRef.current);
        // Optimistic AND ahead of characterRef's own mirror effect — see
        // this function's @remarks above for the race this specifically
        // closes. assertOnline() still comes after, same "show it, then
        // check" ordering updateCharacter already uses.
        characterRef.current = monster;
        setCharacter(monster);
        assertOnline();
        await OBR.scene.items.updateItems([targetId], (items) => {
          for (const item of items) item.metadata[LINK_KEY] = linkFor(monster);
        });
        await saveCharacter(monster);
      },
    });
  };

  /**
   * The reverse of {@link switchToMonster} — monster to player. The
   * original {@link MonsterSheet} is left behind in the vault, unlinked;
   * unlike the player-to-monster direction, this loss is real and
   * permanent — a `"monster"`-kind record with no linking token is swept
   * by `cleanupOrphanedMonsters` at the next scene load (see
   * `characterSwitch.ts`'s `convertToPlayer` and this batch's design notes
   * for why the two directions carry different confirmation wording).
   *
   * @remarks Same `characterRef.current` ordering, and the same race it
   * closes, as {@link switchToMonster} — see that function's `@remarks`.
   * @returns Same contract as {@link switchToMonster}'s `@returns`.
   */
  const switchToPlayer = async (): Promise<boolean> => {
    const targetId = selectedTokenIdRef.current;
    const initial = characterRef.current;
    if (!targetId || !initial || initial.kind !== "monster" || !isGMRef.current) return false;

    return performWrite({
      isOptimistic: true,
      execute: async () => {
        const latest = characterRef.current;
        if (!targetId || !latest || latest.kind !== "monster" || !isGMRef.current) return;
        const player = convertToPlayer(latest, playerIdRef.current);
        characterRef.current = player;
        setCharacter(player);
        assertOnline();
        await OBR.scene.items.updateItems([targetId], (items) => {
          for (const item of items) item.metadata[LINK_KEY] = linkFor(player);
        });
        await saveCharacter(player);
      },
    });
  };

  /**
   * Sets the current player as the owner of the currently loaded character,
   * saves it to the vault, and fans the change out to every token
   * displaying it (see `fanOutSnapshot`).
   *
   * @remarks This is intentionally **not** gated by `canEdit` — it is the
   * entry point that grants edit rights in the first place. It powers two
   * distinct UI affordances exposed via the same button:
   * - "Claim" — the sheet has no owner yet (fresh token created by the GM
   *   for a player, or `ownerId` cleared); any non-GM player may claim it.
   * - "Take over" — the sheet *already* has a different owner. Calling
   *   this reassigns ownership to the current player, silently revoking
   *   the previous owner's edit rights.
   *
   * "Take over" existing on a sheet that already belongs to someone else
   * is a deliberate design choice for this game (a small trusted table),
   * not an oversight — but if you want to prevent players from
   * "stealing" each other's sheets, gate this behind `isGM ||
   * permissions.isUnclaimed` at the call site (the Claim/Take-over button
   * in `App.tsx`) before calling it.
   */
  const claimToken = async () => {
    const initial = characterRef.current;
    // Claiming is a player-sheet-only concept — a MonsterSheet's ownerId is
    // never a permission check (see CharacterRecordBase.ownerId's doc), so
    // there is nothing to "claim" on one. `App.tsx` never renders this
    // button for a monster sheet in the first place; this guard is defense
    // in depth against a stale closure calling it anyway.
    if (!initial || initial.kind !== "player") return;
    await performWrite({
      execute: async () => {
        const latest = characterRef.current;
        if (!latest || latest.kind !== "player") return;
        const claimed = { ...latest, ownerId: playerIdRef.current, updatedAt: Date.now() };
        assertOnline();
        await saveCharacter(claimed);
        void fanOutSnapshot(claimed);
        setCharacter(claimed);
      },
    });
  };

  /**
   * Links the currently selected (sheet-less) token to an existing vault
   * character by id — the "Retrieve a lost soul" recovery action. A
   * `"player"`-kind character survives its token's deletion (see
   * {@link CharacterKind}'s doc); this is what makes it reachable again
   * from a different, or the same, token.
   *
   * No-ops if nothing is selected, or if `characterId` no longer resolves
   * in the vault by the time this runs — the list shown to the player
   * (`orphanedCharacters`) is a snapshot from whenever the no-sheet screen
   * loaded, and could in principle be a moment stale (another client
   * recovering the same character first, however unlikely at this table
   * size). Recovering doesn't remove the character from anyone else's
   * list either, and isn't exclusive: a character can legitimately be
   * linked from more than one token at once (see `selectedTokenIdRef`'s
   * doc) — a race here just means two tokens end up pointing at the same
   * character, not a conflict to prevent.
   *
   * @remarks Not gated by `canEdit`, matching `createSheetForToken` and
   * `claimToken`: attaching a sheet to a blank token is not itself an edit
   * to that sheet's contents.
   */
  const recoverCharacter = async (characterId: string) => {
    const targetId = selectedTokenIdRef.current;
    if (!targetId) return;
    await performWrite({
      execute: async () => {
        assertOnline();
        const found = await loadCharacter(characterId);
        if (!found) return;
        await OBR.scene.items.updateItems([targetId], (items) => {
          for (const item of items) item.metadata[LINK_KEY] = linkFor(found);
        });
        setCharacter(found);
        setSelectionState("ready");
      },
    });
  };

  return {
    isReady,
    selectionState,
    character,
    selectedItems,
    playerId,
    playerName,
    role,
    canEdit,
    isGM,
    permissions,
    syncStatus,
    updateCharacter,
    updateMonster,
    handleRoll,
    handleFreeRoll,
    rollInitiative,
    recentRolls,
    createSheetForToken,
    createMonsterForToken,
    claimToken,
    switchToMonster,
    switchToPlayer,
    orphanedCharacters,
    recoverCharacter,
  };
}
