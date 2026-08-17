/**
 * @file SyncStatusBanner — renders {@link SyncStatus} from `useOBR`: a
 * subtle "still saving" indicator once a write has been in flight longer
 * than expected, a quiet "you're offline" notice, and a persistent error
 * banner (with retry/dismiss) when a write fails.
 *
 * Mounted once, unconditionally, at the top of {@link App}'s single JSX
 * tree, regardless of selection state — a sync failure (e.g. the shared
 * roll log) can happen with no character sheet open at all. Renders
 * nothing for `"idle"`, which is meant to be the common case: a
 * successful write should be invisible, not flash a confirmation.
 */

import { useState, type AnimationEvent } from "react";
import type { SyncStatus } from "../../hooks/useOBR";

interface SyncStatusBannerProps {
  status: SyncStatus;
}

/**
 * Reuses the same visual language as the existing failed-roll banner in
 * `App.tsx` (rose border/background, ⚠, dismiss ✕) for the `"error"`
 * case, rather than introducing a second style for "something went
 * wrong". The `"pending"` case is deliberately quieter (no red, no
 * border) since it isn't a problem, just a slow write.
 *
 * Fades and slides in/out (`.fade-toast-enter`/`.fade-toast-exit` in
 * `index.css`, shared with `DeleteUndoToast`) instead of the abrupt
 * mount/unmount a plain `if (status.state === "idle") return null;` would
 * give — same `displayed`/`phase` pattern as `DeleteUndoToast`: `displayed`
 * mirrors the last non-idle `status` so there's still content to animate
 * out once the prop itself has already gone back to `"idle"`, and
 * `onAnimationEnd` is what actually drops it once that exit animation
 * finishes. See `DeleteUndoToast.tsx`'s comment for why this is a
 * render-time state adjustment rather than a `useEffect` + `setState`.
 */
export function SyncStatusBanner({ status }: SyncStatusBannerProps) {
  const [displayed, setDisplayed] = useState(status);
  const [phase, setPhase] = useState<"enter" | "exit">("enter");

  if (status !== displayed) {
    if (status.state !== "idle") {
      setDisplayed(status);
      setPhase("enter");
    } else if (phase !== "exit") {
      setPhase("exit");
    }
  }

  if (displayed.state === "idle") return null;

  const animationClass = phase === "exit" ? "fade-toast-exit" : "fade-toast-enter";
  const handleAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (phase === "exit") setDisplayed({ state: "idle" });
  };

  if (displayed.state === "pending") {
    return (
      <div
        className={`shrink-0 mx-3 mt-2 flex items-center gap-2 px-1 py-1 text-[11px] text-stone-500 ${animationClass}`}
        onAnimationEnd={handleAnimationEnd}
      >
        <span
          aria-hidden="true"
          className="w-3 h-3 border-2 border-stone-600 border-t-stone-400 rounded-full animate-spin"
        />
        <span>Saving…</span>
      </div>
    );
  }

  if (displayed.state === "offline") {
    return (
      <div
        className={`shrink-0 mx-3 mt-2 flex items-center gap-2 px-1 py-1 text-[11px] text-stone-500 ${animationClass}`}
        onAnimationEnd={handleAnimationEnd}
      >
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-stone-600" />
        <span>You're offline. Changes won't reach the table until you reconnect.</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={`shrink-0 mx-3 mt-2 flex items-start gap-2 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300 ${animationClass}`}
      onAnimationEnd={handleAnimationEnd}
    >
      <span aria-hidden="true" className="shrink-0">
        ⚠
      </span>
      <span className="flex-1">{displayed.message}</span>
      {displayed.canRetry && (
        <button
          onClick={displayed.retry}
          className="shrink-0 font-semibold text-rose-200 hover:text-rose-100 transition-colors"
        >
          Retry
        </button>
      )}
      <button
        onClick={displayed.dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-rose-500 hover:text-rose-300 transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
