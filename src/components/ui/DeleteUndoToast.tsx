/**
 * @file DeleteUndoToast — the "Undo" affordance for `useDeleteUndo`.
 *
 * Rendered unconditionally, directly under `SyncStatusBanner` in `App.tsx`'s
 * single JSX tree (same "always mounted, renders nothing when idle" pattern
 * as that banner). Not merged into `SyncStatusBanner` itself: sync status
 * and "you just deleted something" are orthogonal and can both be true at
 * once (e.g. an unrelated stale sync error still showing while a fresh
 * delete is separately undoable) — each stacks as its own block, the same
 * way the existing roll-error banner in `App.tsx` already stacks alongside
 * `SyncStatusBanner`.
 */

import { useState, type AnimationEvent } from "react";
import { UNDO_TIMEOUT_MS, type PendingUndo } from "../../hooks/useDeleteUndo";

interface DeleteUndoToastProps {
  pendingUndo: PendingUndo | null;
  onUndo: () => void;
}

/**
 * Shows the name of the just-deleted entry and an Undo button, with a
 * decorative bar underneath that empties over `UNDO_TIMEOUT_MS` to show how
 * much of the undo window is left.
 *
 * Fades and slides in/out (`.fade-toast-enter`/`.fade-toast-exit` in
 * `index.css`, shared with `SyncStatusBanner`) instead of the abrupt
 * mount/unmount a plain `if (!pendingUndo) return null;` would give.
 * Clicking Undo calls `onUndo` directly and unconditionally, before any of
 * this component's own animation state changes — the restore write starts
 * immediately regardless of how the toast animates itself out afterward,
 * they're independent. Unmounting *is* delayed for the exit animation
 * (`displayed`/`phase` below keep the last known content on screen while it
 * plays), but nothing about the undo *action* waits on it.
 *
 * `displayed` mirrors the last non-null `pendingUndo` so there's still
 * something to render (and animate) once the prop itself has already gone
 * null — removing the element the instant `pendingUndo` clears would cut
 * the exit animation off before it starts, since CSS can't animate
 * something that's no longer in the DOM. `onAnimationEnd` is what actually
 * drops `displayed` once the exit animation finishes; the prop change alone
 * only switches `phase` to `"exit"`. Render-time state adjustment (not a
 * `useEffect` + `setState`) for the same reason as `useDeleteUndo`'s own
 * `tokenId` check — see that hook's comment.
 *
 * The `e.target !== e.currentTarget` guard in the handler matters here
 * specifically: the countdown bar below is itself a 6-second CSS animation,
 * and `animationend` bubbles, so without the guard the bar finishing its
 * shrink would be mistaken for the toast's own (160ms) exit animation
 * finishing.
 */
export function DeleteUndoToast({ pendingUndo, onUndo }: DeleteUndoToastProps) {
  const [displayed, setDisplayed] = useState(pendingUndo);
  const [phase, setPhase] = useState<"enter" | "exit">("enter");

  if (pendingUndo !== displayed) {
    if (pendingUndo) {
      // A new (or first) undo arrived — show it right away, even if the
      // previous one's exit animation hadn't finished playing yet.
      setDisplayed(pendingUndo);
      setPhase("enter");
    } else if (phase !== "exit") {
      setPhase("exit");
    }
  }

  if (!displayed) return null;

  const handleAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (phase === "exit") setDisplayed(null);
  };

  return (
    <div
      className={`shrink-0 mx-3 mt-2 rounded-lg border border-stone-700 bg-stone-900/80 overflow-hidden ${
        phase === "exit" ? "fade-toast-exit" : "fade-toast-enter"
      }`}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-stone-300">
        <span className="flex-1 truncate">{displayed.entry.name} removed</span>
        <button
          onClick={onUndo}
          className="shrink-0 font-semibold text-amber-300 hover:text-amber-200 transition-colors"
        >
          Undo
        </button>
      </div>
      <div
        key={displayed.entry.id}
        aria-hidden="true"
        className="undo-bar h-1 bg-cyan-700/70 rounded-sm"
        style={{ animationDuration: `${UNDO_TIMEOUT_MS}ms` }}
      />
    </div>
  );
}
