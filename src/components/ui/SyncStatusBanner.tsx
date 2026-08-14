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
 */
export function SyncStatusBanner({ status }: SyncStatusBannerProps) {
  if (status.state === "idle") return null;

  if (status.state === "pending") {
    return (
      <div className="shrink-0 mx-3 mt-2 flex items-center gap-2 px-1 py-1 text-[11px] text-stone-500">
        <span
          aria-hidden="true"
          className="w-3 h-3 border-2 border-stone-600 border-t-stone-400 rounded-full animate-spin"
        />
        <span>Saving…</span>
      </div>
    );
  }

  if (status.state === "offline") {
    return (
      <div className="shrink-0 mx-3 mt-2 flex items-center gap-2 px-1 py-1 text-[11px] text-stone-500">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-stone-600" />
        <span>You're offline. Changes won't reach the table until you reconnect.</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="shrink-0 mx-3 mt-2 flex items-start gap-2 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300"
    >
      <span aria-hidden="true" className="shrink-0">
        ⚠
      </span>
      <span className="flex-1">{status.message}</span>
      {status.canRetry && (
        <button
          onClick={status.retry}
          className="shrink-0 font-semibold text-rose-200 hover:text-rose-100 transition-colors"
        >
          Retry
        </button>
      )}
      <button
        onClick={status.dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-rose-500 hover:text-rose-300 transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
