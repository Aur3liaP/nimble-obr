/**
 * @file Central OBR integration hook for the Nimble character sheet extension.
 *
 * Wraps the entire `@owlbear-rodeo/sdk` surface used by this extension:
 * reading the current player/role, tracking scene selection, loading and
 * persisting character data from/to item metadata, broadcasting dice rolls
 * to the shared roll log, and exposing permission state (`permissions`)
 * to every tab component.
 *
 * This is the single source of truth for "what can the current player do
 * right now" — all UI components receive `permissions` from here rather
 * than computing it themselves.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";

import {
  METADATA_KEY,
  MAX_LEVEL,
  createDefaultCharacter,
  type NimbleCharacter,
  type DiceRollRequest,
  type DiceRollResult,
  type RollMode,
} from "../types/character";
import {
  rollFormula,
  rollFormulaWithContext,
  type FormulaContext,
} from "../utils/formulaParser";
import { migrateCharacter } from "../utils/characterMigrations";

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
 */
export type SyncStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "offline" }
  | SyncErrorStatus;

/**
 * The `"error"` branch of {@link SyncStatus}.
 *
 * @property canRetry - `false` for the "token no longer exists" case
 * (detected by the debounced post-write existence check): resending the
 * same write would just silently no-op again — `OBR.scene.items.updateItems`
 * re-resolves its target by ID before writing and quietly does nothing, with
 * no rejection, if that lookup comes back empty (verified in the SDK's own
 * `SceneItemsApi.updateItems` source). The UI should hide the retry action
 * whenever this is `false`, not just leave it a no-op.
 * @property retry - Re-attempts the write, recomputing against
 * `characterRef.current` as it stands at retry time rather than a snapshot
 * frozen at the original failure, and merging in only the field(s) that
 * actually failed to save. This reduces the risk to *other* fields but does
 * NOT eliminate it: `characterRef.current` only picks up a remote client's
 * change once this client has received and processed the corresponding
 * `OBR.scene.items.onChange` event. If retry fires before that event
 * arrives — a race this client cannot detect, and the window can be
 * arbitrarily long since a user decides when to click Retry — the write
 * still sends the whole merged object and can silently overwrite that other
 * field too. This isn't a risk retry introduces; it's the same "local
 * snapshot, not server-fresh state" property every write in this hook has
 * always had, just with a larger window than a single ordinary write gets.
 * Nor is retry safe from a conflict on the *same* field: if the field this
 * write touches was itself changed elsewhere since the failure, retrying
 * overwrites that change, silently. There is no reliable way to detect that
 * from this client — comparing the field's value at failure time against
 * its value at retry time would miss a change that was made and then
 * reverted, and can't see a write that races the retry itself (that would
 * need a compare-and-swap on the OBR side, which the SDK doesn't expose).
 * `message` (see {@link describeWriteError}) doesn't name the field at all —
 * raw property names like `hitDice` aren't something a player should have to
 * parse mid-game — and it never claims other fields, or this field against a
 * same-field conflict, are safe. It says only the one thing actually known:
 * retry now or the change is gone. No hedging with "may" or "probably", and
 * no false reassurance either.
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
  character: NimbleCharacter | null;
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
  handleRoll: (req: DiceRollRequest) => Promise<DiceRollResult | null>;
  handleFreeRoll: (req: DiceRollRequest) => Promise<DiceRollResult | null>;
  rollInitiative: (
    mode?: RollMode,
    advantageCount?: number,
    hidden?: boolean,
  ) => Promise<DiceRollResult | null>;
  recentRolls: DiceRollResult[];
  createSheetForToken: (item: Item) => Promise<void>;
  claimToken: () => Promise<void>;
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
 * How long to wait, after the most recent write to a given token, before
 * confirming that token still exists in the scene. Debounced per token (a
 * fresh write restarts the timer) rather than checked before or
 * immediately after every single write, so a burst of once-per-keystroke
 * writes to the same field costs one confirmation call after the burst
 * settles, not one per keystroke.
 */
const EXISTENCE_CHECK_DEBOUNCE_MS = 600;

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
 * `setCharacter`, never before. `OBR.scene.items.updateItems`/`setMetadata`
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
 * local state *after* a successful write, and `pushRollToLog` never
 * updates local state itself at all (see its `execute`'s comment) — for
 * all three, the screen already matches reality on failure, so this
 * doesn't apply.
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
 * Connects this extension instance to the active OBR scene and player,
 * and exposes everything needed to render and edit a Nimble character sheet.
 *
 * Responsibilities:
 * - Resolves the current player's ID, name, and role (GM/PLAYER) on ready.
 * - Tracks scene selection changes and loads the corresponding character
 *   from item metadata (see {@link SelectionState}).
 * - Computes {@link CharacterPermissions} for permission gating.
 * - Persists character updates via `OBR.scene.items.updateItems`, but
 *   only when the caller currently holds edit rights (see
 *   {@link updateCharacter} — this is a client-side guard, not a real
 *   security boundary, since OBR has no server-side ACL on metadata
 *   writes; a determined player could still bypass it from devtools.
 *   It does, however, prevent accidental writes from stale UI state and
 *   keeps `canEdit` meaningful as the single gate everywhere).
 * - Pushes dice roll results to shared scene metadata so all clients see
 *   them, except hidden rolls (GM-only, kept in local state only).
 *
 * @returns See {@link UseOBRReturn} for the full shape.
 */
export function useOBR(): UseOBRReturn {
  const [isReady, setIsReady] = useState(false);
  const [selectionState, setSelectionState] = useState<SelectionState>("none");
  const [character, setCharacter] = useState<NimbleCharacter | null>(null);
  const [selectedItems, setSelectedItems] = useState<Item[]>([]);
  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [role, setRole] = useState<OBRRole>("PLAYER");
  const [recentRolls, setRecentRolls] = useState<DiceRollResult[]>([]);

  const characterRef = useRef<NimbleCharacter | null>(null);
  const playerIdRef = useRef<string>("");
  const playerNameRef = useRef<string>("");
  // Mirrors `permissions.canEdit` synchronously for use inside callbacks
  // (handleRoll, updateCharacter) that close over refs rather than state,
  // so the guard always sees the latest value even mid-render.
  const canEditRef = useRef(false);
  /**
   * The OBR item id of the currently selected single character token —
   * refreshed synchronously inside {@link handleSelectionChange} on every
   * selection change, and the ONLY id every write in this hook may target.
   *
   * @remarks `character.tokenId` (the id stored inside the sheet's own
   * metadata payload) must never be used to target an OBR operation.
   * `NimbleCharacter.tokenId` is part of the metadata payload itself, and
   * OBR copies that payload verbatim when a token is copy-pasted while
   * assigning the *copy* a brand-new item id — so the payload's `tokenId`
   * silently drifts out of sync with the item it actually lives on. Two
   * confirmed failure modes result: editing a copy pasted into the SAME
   * scene writes to the original token (both copies' payloads name the
   * original's id, so both target it), and editing a copy pasted into a
   * DIFFERENT scene fails with "this token no longer exists" (the
   * payload's id belongs to a token that doesn't exist in the new scene at
   * all). Reading the write target from this ref instead — the real,
   * live-selected item id — fixes both: a copy is retargeted at itself the
   * moment it's edited (see the `tokenId: targetId` fixups at each write
   * site below, which also repair the stored payload going forward).
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

  const isOwner =
    character !== null && !!character.ownerId && character.ownerId === playerId;
  const isUnclaimed = character !== null && !character.ownerId;

  const canEdit = isGM || isOwner;

  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "idle" });
  // Count of writes currently in flight — decides when to promote
  // syncStatus to "pending" and when it's safe to clear the pending timer.
  // See performWrite.
  const pendingWritesRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounced per-token "does this item still exist" check. See
  // scheduleExistenceCheck.
  const existenceCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Identifies the currently-displayed error so a retry's async success
  // handler can tell whether it's still retrying the error being shown, or
  // whether a newer, unrelated failure has already replaced it — see
  // performWrite.
  const currentErrorIdRef = useRef(0);
  // Set to a token id right after loading a character whose stored
  // schemaVersion was behind CURRENT_SCHEMA_VERSION (migrateCharacter's
  // `migrated: true`), cleared once the write-back effect below has
  // consumed it. Not touched for the "multiple selection" branch, which
  // never triggers a write-back — see that branch's comment.
  const pendingMigrationTokenIdRef = useRef<string | null>(null);

  const permissions: CharacterPermissions = {
    canEdit,
    isGM,
    isOwner,
    isUnclaimed,
  };

  /**
   * Reads an OBR item's metadata and runs it through {@link migrateCharacter},
   * or returns `null` if the item has no sheet attached at all (a distinct
   * case from a sheet whose data is unreadable, see {@link MigrationResult}).
   *
   * @remarks Single choke point for both entry points that read a character
   * off an item: {@link handleSelectionChange} and the `scene.items.onChange`
   * resync listener registered in the main effect below. Logs `"invalid"`
   * reasons to the console: they're a technical detail (a thrown error
   * message, a field path), not something to show a player mid-game — the
   * UI only ever gets the generic `"invalid-sheet"` selection state.
   */
  const loadCharacterFromItem = useCallback((item: Item) => {
    const raw = item.metadata?.[METADATA_KEY];
    if (raw === undefined) return null;
    const result = migrateCharacter(raw);
    if (result.status === "invalid") {
      console.error(
        `[Nimble] Character sheet on token ${item.id} failed validation: ${result.reason}`,
      );
    }
    return result;
  }, []);

  /**
   * Recomputes `selectionState`, `selectedItems`, and `character` whenever
   * the player's scene selection changes. Filters to CHARACTER-layer items
   * only, since the sheet only applies to character tokens.
   */
  const handleSelectionChange = useCallback(
    async (selectedIds: string[]) => {
      if (!selectedIds || selectedIds.length === 0) {
        selectedTokenIdRef.current = null;
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
        setSelectionState("none");
        setCharacter(null);
      } else if (tokens.length > 1) {
        // No single write target while multiple tokens are selected — see
        // selectedTokenIdRef's doc. `App.tsx` never renders edit controls
        // in this state (selectionState "multiple" is display-only), and
        // clearing the ref here backs that up: a write attempted from a
        // stale closure would find no target rather than guessing one.
        selectedTokenIdRef.current = null;
        setSelectionState("multiple");
        // Display (and free-roll stat source) only — never triggers a
        // migration write-back. A bulk selection isn't a deliberate "open
        // this sheet" action on any one token, and writing to every stale
        // token a multi-select happens to sweep over is not something the
        // player asked for.
        const loaded = loadCharacterFromItem(tokens[0]);
        setCharacter(loaded && loaded.status === "ok" ? loaded.character : null);
      } else {
        selectedTokenIdRef.current = tokens[0].id;
        const loaded = loadCharacterFromItem(tokens[0]);
        if (!loaded) {
          setSelectionState("no-sheet");
          setCharacter(null);
        } else if (loaded.status === "unsupported") {
          setSelectionState("unsupported-version");
          setCharacter(null);
        } else if (loaded.status === "invalid") {
          setSelectionState("invalid-sheet");
          setCharacter(null);
        } else {
          if (loaded.migrated) pendingMigrationTokenIdRef.current = tokens[0].id;
          setCharacter(loaded.character);
          setSelectionState("ready");
        }
      }
    },
    [loadCharacterFromItem],
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
          const currentChar = characterRef.current;
          if (!currentChar) return;
          // Match against the real selected item id, not `currentChar.tokenId`
          // — see selectedTokenIdRef's doc for why the payload id can't be
          // trusted here either.
          const targetId = selectedTokenIdRef.current;
          if (!targetId) return;
          const updatedItem = items.find((i) => i.id === targetId);
          if (!updatedItem) return;
          const fresh = loadCharacterFromItem(updatedItem);
          if (!fresh) return; // sheet removed mid-session — leave state as-is
          if (fresh.status === "ok") {
            if (fresh.migrated) pendingMigrationTokenIdRef.current = updatedItem.id;
            setCharacter(fresh.character);
          } else if (fresh.status === "unsupported") {
            setSelectionState("unsupported-version");
            setCharacter(null);
          } else {
            setSelectionState("invalid-sheet");
            setCharacter(null);
          }
        }),
      );

      // Single source of truth for the roll log — only update from metadata,
      // never from local setRecentRolls after a push (avoids double-update re-mounts)
      unsubscribers.push(
        OBR.scene.onMetadataChange((meta) => {
          const log = meta[ROLL_LOG_KEY] as DiceRollResult[] | undefined;
          if (log) setRecentRolls(log.slice(-MAX_ROLL_HISTORY));
        }),
      );

      // `App.tsx` is a single JSX tree that never unmounts (see CLAUDE.md),
      // so switching scenes alone does not clear whatever character was
      // loaded from the previous scene — without this, the panel keeps
      // showing the old scene's sheet (wrong data presented as current,
      // not an empty state) until the player happens to change selection.
      // `ready` goes false during the switch and back to true once the new
      // scene has loaded; only the false transition needs handling here,
      // since the new scene's own selection change (if any) re-populates
      // everything through the normal `player.onChange`/`handleSelectionChange`
      // path.
      unsubscribers.push(
        OBR.scene.onReadyChange((ready) => {
          if (ready) return;
          selectedTokenIdRef.current = null;
          setSelectedItems([]);
          setSelectionState("none");
          setCharacter(null);
        }),
      );
    });

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [handleSelectionChange, loadCharacterFromItem]);

  // Timers above are refs, not effect-scoped state, so they need their own
  // cleanup — same discipline as the SDK listener unsubscribes above,
  // applied to setTimeout instead.
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
      if (existenceCheckTimerRef.current !== null) {
        clearTimeout(existenceCheckTimerRef.current);
      }
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
   * Confirms, after a debounced quiet period, that `tokenId` still exists
   * in the scene. Catches the one write failure mode that resolves
   * successfully instead of rejecting: `OBR.scene.items.updateItems`
   * re-resolves its target by ID before writing, and silently does
   * nothing — no error, no rejection — if that lookup comes back empty
   * (verified in the SDK's `SceneItemsApi.updateItems` source: it
   * early-returns once the computed patch set is empty). A `.then`/`.catch`
   * around the write itself can never see this; the promise resolves
   * normally either way.
   *
   * Deliberately debounced rather than checked before, or synchronously
   * after, every write: some fields write to OBR on every keystroke by
   * design (see CLAUDE.md), and checking existence on that same cadence
   * would double the SDK calls on the common, successful path to catch a
   * rare case (a token deleted mid-edit). Debouncing moves that cost onto
   * the failure path instead — one confirmation call after a burst of
   * writes settles, not one per keystroke.
   *
   * The resulting error has `canRetry: false`: resending the same write
   * would just re-trigger the same silent no-op.
   *
   * NOT extended into a general "read the value back and compare it to what
   * we sent" persistence check, on purpose — don't add that. `getItems`
   * here is itself an SDK call, resolved the exact same way as the write it
   * would be verifying: both are answered by the OBR host from its own
   * local scene state over `postMessage`, not by asking the multiplayer
   * server. A write that "succeeded" only locally (see the big note on
   * `SyncStatus`'s `"idle"` case) would read back as matching, every time,
   * because the read and the write hit the same local state. Comparing
   * values here would look more thorough while detecting nothing more than
   * the existence check already does — false confidence, not real
   * coverage. This check stays scoped to what it can actually verify: item
   * existence.
   */
  const scheduleExistenceCheck = (tokenId: string) => {
    if (existenceCheckTimerRef.current !== null) {
      clearTimeout(existenceCheckTimerRef.current);
    }
    existenceCheckTimerRef.current = setTimeout(() => {
      existenceCheckTimerRef.current = null;
      void OBR.scene.items.getItems([tokenId]).then((items) => {
        if (items.length === 0) {
          currentErrorIdRef.current += 1;
          setSyncStatus({
            state: "error",
            message:
              "This token no longer exists in the scene. Your last change may not have been saved.",
            canRetry: false,
            retry: () => {},
            dismiss: () => setSyncStatus({ state: "idle" }),
          });
        }
      });
    }, EXISTENCE_CHECK_DEBOUNCE_MS);
  };

  /**
   * Central choke point for every OBR SDK write this hook performs
   * (character sheet edits, roll log, sheet creation, claiming) — wraps
   * `execute` with {@link SyncStatus} tracking so a failure is visible
   * instead of silent, which is the reliability gap this exists to close.
   *
   * @param options.execute - Performs the actual SDK call(s). Must re-read
   * any character state it needs from `characterRef.current` at call time
   * rather than closing over a value captured earlier: this same function
   * runs again, unchanged, on retry. If it targets a single item, it must
   * likewise read the target id from `selectedTokenIdRef.current` at call
   * time (never from `character.tokenId` — see that ref's doc) and return
   * the id it actually wrote to, so {@link scheduleExistenceCheck} verifies
   * the exact item just written rather than a value computed separately
   * that could drift from it. Return nothing for writes not tied to a
   * single item (the roll log, which lives in scene metadata).
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
   */
  const performWrite = async (options: {
    execute: () => Promise<string | undefined | void>;
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
      const writtenTokenId = await execute();
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
      if (writtenTokenId) scheduleExistenceCheck(writtenTokenId);
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
   * Writes back a character that was just migrated on read (see
   * {@link loadCharacterFromItem}), so the persisted `schemaVersion` catches
   * up and other clients stop re-migrating the same old data on every load.
   *
   * Runs as its own effect, keyed off `pendingMigrationTokenIdRef`, rather
   * than inline in `handleSelectionChange`: by the time this effect runs,
   * `character` (and therefore `canEdit`/`isOwner`, both derived from it
   * above) already reflects the just-loaded record, so this reuses the same
   * `canEdit` every other write in this hook is gated on instead of
   * re-deriving permission from `ownerId` a second way. `pendingMigrationTokenIdRef`
   * only exists because `NimbleCharacter` itself can't carry an ephemeral
   * "this copy was just migrated" flag — `character.schemaVersion` is
   * always `CURRENT_SCHEMA_VERSION` once loaded, migrated or not.
   *
   * A read-only viewer (not GM, not owner) never reaches the write: `canEdit`
   * is `false` for them, so the ref is cleared and nothing is sent. Two
   * clients that both hold edit rights and load the same stale sheet at
   * nearly the same time both write here; since the migration is a pure
   * function of the same stored data, both writes carry identical content,
   * so whichever lands last simply repeats the same result — no different
   * from any other pair of near-simultaneous writes this hook already
   * doesn't defend against (there is no compare-and-swap on the OBR side).
   * A sheet nobody with edit rights ever selects stays at its old
   * `schemaVersion` in storage indefinitely, migrated only in memory for
   * whoever views it — accepted, not solved here.
   */
  useEffect(() => {
    if (!character) return;
    // Compared against the live selection (selectedTokenIdRef), never
    // `character.tokenId` — see that ref's doc. `pendingMigrationTokenIdRef`
    // itself already holds a real item id (set from `tokens[0].id`/
    // `updatedItem.id` in handleSelectionChange/the resync listener, never
    // from the payload), so once it matches the current selection it IS
    // the correct write target.
    const tokenId = pendingMigrationTokenIdRef.current;
    if (!tokenId || tokenId !== selectedTokenIdRef.current) return;
    pendingMigrationTokenIdRef.current = null;
    if (!canEdit) return;
    void performWriteRef.current({
      execute: async () => {
        assertOnline();
        // Repairs the payload's own `tokenId` to the real target as part
        // of this write, same as every other write site below — see
        // selectedTokenIdRef's doc.
        const migrated = { ...character, tokenId };
        await OBR.scene.items.updateItems([tokenId], (items) => {
          for (const item of items) {
            item.metadata[METADATA_KEY] = migrated;
          }
        });
        return tokenId;
      },
    });
  }, [character, canEdit]);

  /**
   * Applies a partial update to the currently loaded character and persists
   * it to the owning item's metadata via `OBR.scene.items.updateItems`,
   * which propagates the change to every connected client.
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
   * Also clamps `level` to `[1, MAX_LEVEL]` when present in `updates` — an
   * unbounded level can push a legitimate dynamic-dice spell formula
   * (`incrementdice`/`stepdice`) past formulaParser's dice safety limits,
   * turning it into one that always errors out. Clamped here, at the
   * single write choke point, rather than only as an input hint, since an
   * HTML `max` attribute doesn't stop a typed value from being committed.
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
    if (!current) return false;
    if (!canEditRef.current) {
      console.warn(
        "[Nimble] updateCharacter blocked: current player has no edit rights on this sheet.",
      );
      return false;
    }
    const clampedUpdates =
      updates.level !== undefined
        ? { ...updates, level: Math.min(Math.max(updates.level, 1), MAX_LEVEL) }
        : updates;

    return performWrite({
      // setCharacter below runs before the write is confirmed — see
      // describeWriteError's isOptimistic doc for why the error message
      // needs to know that.
      isOptimistic: true,
      execute: async () => {
        // Re-read at call time, not the `current` captured above: this
        // same closure runs again, unchanged, on retry, potentially after
        // other fields changed remotely — see performWrite's JSDoc. The
        // write target is read fresh here too, from selectedTokenIdRef,
        // never from `latest.tokenId` — see that ref's doc for why the
        // payload id can't be trusted as a write target.
        const latest = characterRef.current;
        if (!latest || !canEditRef.current) return;
        const targetId = selectedTokenIdRef.current;
        if (!targetId) return;
        const updated = {
          ...latest,
          ...clampedUpdates,
          tokenId: targetId,
          updatedAt: Date.now(),
        };
        // setCharacter first, offline check second: the field must still
        // show what was typed even if we already know the write will fail
        // (see assertOnline's doc) — checking before setCharacter would
        // revert the keystroke instead.
        setCharacter(updated);
        assertOnline();
        await OBR.scene.items.updateItems([targetId], (items) => {
          for (const item of items) {
            item.metadata[METADATA_KEY] = updated;
          }
        });
        return targetId;
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
   * state update that would otherwise remount conditional branches in `App`.
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
      // than replacing a whole stored object with a locally-held copy. Not
      // wired into the banner text (no room in a two-line message for a
      // distinction this narrow) — it stays true only as an implementation
      // note here.
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
   * @returns The resolved {@link DiceRollResult}, or `null` if no character is loaded.
   * If the formula failed (`result.error` set), the result is still
   * returned to the caller (so it can show the roller what went wrong) but
   * is *not* pushed to the shared roll log — a failed roll must never reach
   * the table looking like a legitimate total of 0.
   */
  const handleRoll = async (
    req: DiceRollRequest,
  ): Promise<DiceRollResult | null> => {
    const current = characterRef.current;
    if (!current) return null;
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
   * Now routed through {@link DiceRollModal} like every other roll (see
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
    if (!current) return null;
    return handleRoll({
      label: "Initiative",
      formula: `1d20+${current.stats.dex + (current.initiativeBonus || 0)}`,
      mode,
      advantageCount,
      hidden,
    });
  };

  /**
   * Attaches a brand-new default character sheet to the given token and
   * makes the calling player its owner.
   *
   * @param item - The OBR scene item (token) to attach a sheet to.
   */
  const createSheetForToken = async (item: Item) => {
    // Safe to target `item.id` directly here, unlike every other write
    // site in this hook: `item` is the actual selected token passed in by
    // the caller (`App.tsx`'s `firstItem`, itself sourced from the live
    // selection), not an id read back out of a stored payload.
    const newChar = createDefaultCharacter(item.id, playerIdRef.current);
    await performWrite({
      execute: async () => {
        assertOnline();
        await OBR.scene.items.updateItems([item.id], (items) => {
          for (const i of items) {
            i.metadata[METADATA_KEY] = newChar;
          }
        });
        setCharacter(newChar);
        setSelectionState("ready");
        return item.id;
      },
    });
  };

  /**
   * Sets the current player as the owner of the currently loaded character.
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
    if (!initial) return;
    await performWrite({
      execute: async () => {
        const latest = characterRef.current;
        if (!latest) return;
        // Write target read fresh from the live selection, not
        // `latest.tokenId` — see selectedTokenIdRef's doc.
        const targetId = selectedTokenIdRef.current;
        if (!targetId) return;
        const claimed = {
          ...latest,
          ownerId: playerIdRef.current,
          tokenId: targetId,
          updatedAt: Date.now(),
        };
        assertOnline();
        await OBR.scene.items.updateItems([targetId], (items) => {
          for (const item of items) {
            item.metadata[METADATA_KEY] = claimed;
          }
        });
        setCharacter(claimed);
        return targetId;
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
    handleRoll,
    handleFreeRoll,
    rollInitiative,
    recentRolls,
    createSheetForToken,
    claimToken,
  };
}
