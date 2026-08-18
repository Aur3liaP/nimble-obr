/**
 * @file useDeleteUndo — single-slot, App-level undo for deleting a spell,
 * inventory item, or combat action.
 *
 * Deletion in this app is immediate and broadcast to the table (see
 * RowActions' delete icon, wired through SpellsTab/InventoryTab/CombatTab) —
 * there is no confirmation dialog, by design: a confirm-on-every-delete
 * dialog gets clicked through without being read once it becomes routine,
 * and slows down the common case without actually protecting anything.
 * This hook is the mitigation instead: a short window, local to the
 * deleting client only, to put the entry back.
 *
 * Deliberately NOT component-local `useState`: `App.tsx` mounts its four
 * tab components conditionally on `activeTab`
 * (`{activeTab === "combat" && <CombatTab/>}`), so a tab genuinely unmounts
 * when the player switches away from it. State that must survive a tab
 * switch has to live above the tabs — the same reason
 * `character.combat.actionsRemaining` was moved out of tab-local state
 * previously. This hook is instead instantiated once in `App.tsx`, at the
 * same level as `activeTab`, so `pendingUndo` (and the toast rendered from
 * it, `DeleteUndoToast`) survives every tab switch.
 *
 * Single level, not a stack: a second delete while a toast is still
 * showing replaces the pending undo outright (its timer is cleared, the
 * new one starts fresh). The problem this exists to mitigate is a single
 * misclick, not a deletion history — a multi-level undo stack would need
 * its own UI (a narrow OBR panel has little room for one) for a need
 * nobody asked for. No "your previous undo was lost" notice is shown
 * either: it would add a second interruption to a feature meant to be
 * lightweight, and the toast's own short lifetime already communicates
 * "act now or it's gone" for each deletion in turn.
 */

import { useEffect, useRef, useState } from "react";
import type {
  CharacterAction,
  InventoryItem,
  NimbleCharacter,
} from "../types/character";
import { removeEntryById, reinsertEntry } from "../utils/entryUndo";

/**
 * How long a delete stays undoable, and how long the toast's decorative
 * countdown bar takes to empty. Exported so `DeleteUndoToast` reads its CSS
 * animation duration from this exact constant instead of a separately
 * hardcoded value that could drift from the real timer below.
 */
export const UNDO_TIMEOUT_MS = 6000;

/** The two character arrays a deletable entry can live in. */
export type UndoableArrayKey = "actions" | "inventory";

/**
 * The single in-flight undo record, or absence thereof. A discriminated
 * union on `arrayKey` so `entry`'s type (`CharacterAction` vs
 * `InventoryItem`) narrows correctly at each use site.
 *
 * @property index - Position in the FULL `character.actions`/`.inventory`
 * array at delete time (never a filtered/displayed subset — see
 * `removeEntryById`'s doc in `entryUndo.ts`), used to restore roughly the
 * same list position.
 * @property tokenId - The real OBR item id of the token this deletion
 * happened on (the live selection's id, never `character.tokenId` from
 * the sheet payload — see `selectedTokenIdRef`'s doc in `useOBR.ts` for
 * why the payload id can't be trusted for this: a token copy-pasted in
 * the same scene carries an identical payload `tokenId` until its first
 * edit, which would make this guard fail to tell the original and the
 * copy apart). Guards against restoring into a *different* character's
 * sheet if the player switches token selection during the undo window —
 * switching tabs on the SAME character does not touch this, see the
 * effect below.
 */
export type PendingUndo =
  | {
      arrayKey: "actions";
      entry: CharacterAction;
      index: number;
      tokenId: string;
    }
  | {
      arrayKey: "inventory";
      entry: InventoryItem;
      index: number;
      tokenId: string;
    };

/** Public API returned by {@link useDeleteUndo}. */
export interface UseDeleteUndoReturn {
  /** The current pending undo, or `null` if nothing is undoable right now. */
  pendingUndo: PendingUndo | null;
  /**
   * Deletes the entry with `id` from `character[arrayKey]` immediately
   * (same as before this hook existed) and arms a {@link PendingUndo} for
   * it, but only once the write is confirmed to have gone through (see
   * `updateCharacter`'s return in `useOBR.ts`) — a delete that failed
   * (offline, timeout, revoked rights) never gets an Undo button, so it
   * surfaces through exactly one place, the existing sync-error banner,
   * instead of two.
   *
   * No-ops silently, without touching any existing `pendingUndo`, if `id`
   * is no longer present in the array — a duplicate delete click racing
   * the first one (or any other reason the entry's already gone) must
   * never arm a second, empty undo that clobbers a real one still on
   * screen.
   */
  deleteWithUndo: (arrayKey: UndoableArrayKey, id: string) => Promise<void>;
  /**
   * Reinserts the pending entry back into the character's current array
   * (read fresh at call time, not a snapshot from delete time) at its
   * original index, clamped to the array's current length. No-ops if
   * there's nothing pending, or if the currently loaded character isn't
   * the one the deletion happened on.
   *
   * Clears `pendingUndo` immediately (before the write resolves), the same
   * "act now" immediacy as the delete itself. If the restore write fails,
   * that failure surfaces through the normal sync-error banner (with its
   * own Retry) exactly like any other write — there is no separate
   * "retry the undo" affordance on the toast itself, since one already
   * exists.
   */
  undo: () => void;
}

/**
 * @param character - The currently loaded character, or `null`. Passed
 * straight through from `useOBR` — this hook holds no character state of
 * its own, only the undo bookkeeping layered on top.
 * @param selectedTokenId - The real OBR item id of the currently selected
 * token (`useOBR`'s `selectedItems[0]?.id`), or `undefined`. Used ONLY as
 * an identity key for the same-character guard described on
 * {@link PendingUndo.tokenId} — never `character.tokenId`, which is part
 * of the sheet payload and can lag behind the actual selection (see that
 * property's doc).
 * @param updateCharacter - `useOBR`'s write function. Resolves `true` only
 * once the SDK write actually went through without throwing (see its doc
 * in `useOBR.ts`) — `deleteWithUndo` relies on that to decide whether a
 * delete is even worth offering an undo for.
 */
export function useDeleteUndo(
  character: NimbleCharacter | null,
  selectedTokenId: string | undefined,
  updateCharacter: (updates: Partial<NimbleCharacter>) => Promise<boolean>,
): UseDeleteUndoReturn {
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped every time an undo is armed or consumed. Lets a `setTimeout`
  // callback recognize it's stale (superseded by a newer arm, or the arm
  // it belonged to was abandoned by the token-switch check below) and
  // no-op instead of clearing a `pendingUndo` it was never scheduled for
  // — see `armPendingUndo` and the render-time check below, neither of
  // which can call `clearTimeout` directly in every case (see below), so
  // this is what makes a merely-not-yet-cancelled stale timer harmless.
  const armIdRef = useRef(0);

  // Unmount cleanup — same discipline as every other timer in this project
  // (useOBR's pendingTimerRef/existenceCheckTimerRef, CombatTab's
  // initiative-result timer). This runs in the effect's cleanup phase, not
  // during render, so touching `timerRef` here is fine — unlike the
  // render-time check below.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  // Abandons a pending undo if the player switches to a DIFFERENT
  // character's token while the toast is showing — reinserting into
  // whichever sheet happens to be open when Undo is clicked would put the
  // entry on the wrong character. Switching TABS on the same character
  // never changes `selectedTokenId`, so the toast survives that, as
  // required.
  //
  // Deliberately not a `useEffect` keyed on `selectedTokenId`: React
  // 19's `react-hooks/set-state-in-effect` rule flags a setState call in
  // an effect body, and `react-hooks/refs` separately forbids touching a
  // ref during render. This is instead the React-docs-endorsed "adjust
  // state when a prop changes" pattern (compare against the previous value,
  // call setState directly during render, which React folds into the same
  // render pass rather than scheduling a second one) — which means this
  // branch can only touch `pendingUndo` state, never `timerRef` directly.
  // The abandoned arm's native timer is therefore left to fire later; its
  // callback checks `armIdRef` and no-ops once it finds it's no longer
  // current, so the delay never clobbers a since-armed, unrelated undo. It
  // is still a real `clearTimeout`, eventually, well before it could
  // matter: either the next `armPendingUndo`/`undo` call clears it (both
  // are event handlers, not render), or unmount does.
  const [lastTokenId, setLastTokenId] = useState(selectedTokenId);
  if (selectedTokenId !== lastTokenId) {
    setLastTokenId(selectedTokenId);
    if (pendingUndo && pendingUndo.tokenId !== selectedTokenId) {
      setPendingUndo(null);
    }
  }

  const armPendingUndo = (next: PendingUndo) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    armIdRef.current += 1;
    const armId = armIdRef.current;
    setPendingUndo(next);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (armIdRef.current === armId) setPendingUndo(null);
    }, UNDO_TIMEOUT_MS);
  };

  const deleteWithUndo = async (arrayKey: UndoableArrayKey, id: string) => {
    if (!character || !selectedTokenId) return;
    if (arrayKey === "actions") {
      const removal = removeEntryById(character.actions, id);
      if (!removal) return;
      const success = await updateCharacter({ actions: removal.next });
      if (!success) return;
      armPendingUndo({
        arrayKey: "actions",
        entry: removal.removed.entry,
        index: removal.removed.index,
        tokenId: selectedTokenId,
      });
    } else {
      const removal = removeEntryById(character.inventory, id);
      if (!removal) return;
      const success = await updateCharacter({ inventory: removal.next });
      if (!success) return;
      armPendingUndo({
        arrayKey: "inventory",
        entry: removal.removed.entry,
        index: removal.removed.index,
        tokenId: selectedTokenId,
      });
    }
  };

  const undo = () => {
    if (!pendingUndo || !character) return;
    if (selectedTokenId !== pendingUndo.tokenId) return;
    armIdRef.current += 1;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPendingUndo(null);
    if (pendingUndo.arrayKey === "actions") {
      void updateCharacter({
        actions: reinsertEntry(
          character.actions,
          pendingUndo.entry,
          pendingUndo.index,
        ),
      });
    } else {
      void updateCharacter({
        inventory: reinsertEntry(
          character.inventory,
          pendingUndo.entry,
          pendingUndo.index,
        ),
      });
    }
  };

  return { pendingUndo, deleteWithUndo, undo };
}
