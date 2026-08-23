/**
 * @file useDebouncedCommit — collapses a rapid burst of values into a single
 * commit once the burst goes quiet.
 *
 * Companion to `useDraggableValue` (a mouse/touch drag has a real, discrete
 * release event to commit on) and `useFormulaField` (commits on syntactic
 * validity) — this is for inputs that have neither kind of natural
 * end-of-edit signal: OS key-repeat on a held arrow key, or the rapid-fire
 * `change` events a native `<input type="number">` fires from its spinner
 * buttons or a mouse-wheel scroll. Each of those produces many discrete
 * "new value" events with no equivalent of a mouseup to hook a single
 * commit onto, so the only available signal that a burst has ended is a
 * short quiet period with no further change.
 *
 * Exists specifically because a naive "commit every change" on either of
 * those inputs used to send one OBR write per repeated key/tick — tolerable
 * before the vault-decoupling batch doubled write volume per save (vault +
 * snapshot fan-out), but enough on its own to trip OBR's rate limit once it
 * was. See `DraggableBar.tsx`'s keyboard handler and `InlineEditField.tsx`'s
 * `InlineNumberField` for the two call sites this was built for.
 *
 * The actual scheduling logic lives in {@link DebouncedCommit}, a plain
 * class with no React dependency, specifically so it's unit-testable with
 * fake timers (`useDebouncedCommit.test.ts`) the same way this project
 * tests every other piece of pure logic — this project has no
 * hook-rendering test utility installed, so a hook itself isn't directly
 * testable, but the timing behavior that actually matters here is not
 * React-specific and doesn't need to be. `useDebouncedCommit` itself is a
 * thin wrapper: one `DebouncedCommit` instance per component instance,
 * flushed on unmount.
 */

import { useEffect, useRef } from "react";

/** Default quiet period before a pending value commits. */
const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Pure (no React, no OBR) debounce controller: `schedule(value)` records a
 * pending value and (re)starts a quiet-period timer; `flush()` commits
 * immediately if anything is pending. See this file's header for why this
 * exists as a separate class rather than living directly inside the hook.
 */
export class DebouncedCommit<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: T | undefined = undefined;
  private hasPending = false;
  private onCommit: (value: T) => void;
  private delayMs: number;

  constructor(onCommit: (value: T) => void, delayMs: number = DEFAULT_DEBOUNCE_MS) {
    this.onCommit = onCommit;
    this.delayMs = delayMs;
  }

  /** Records `value` as pending and (re)starts the quiet-period timer, replacing any not-yet-committed value already pending. */
  schedule(value: T): void {
    this.pending = value;
    this.hasPending = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.delayMs);
  }

  /** Commits whatever is pending immediately, if anything is. Safe to call with nothing pending (no-op). */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.hasPending) {
      this.hasPending = false;
      const value = this.pending as T;
      this.pending = undefined;
      this.onCommit(value);
    }
  }

  /** Updates the callback invoked on commit, without disturbing a pending value or its timer — used by the hook wrapper to keep the latest closure without restarting an in-flight debounce. */
  setOnCommit(onCommit: (value: T) => void): void {
    this.onCommit = onCommit;
  }
}

/**
 * React wrapper around {@link DebouncedCommit}: one instance per component
 * instance, kept across renders via `useRef`.
 *
 * @param onCommit - Called with the most recent value once `delayMs` has
 * passed with no further call to the returned `schedule`. Safe to pass a
 * fresh closure every render — updated on the existing instance rather than
 * recreating it, so a pending value/timer survives a re-render.
 * @param delayMs - Quiet period required before a scheduled value commits.
 * Read only once, at first render (changing it later has no effect) — every
 * call site in this codebase passes a constant.
 * @returns `schedule`/`flush`, delegating straight to the underlying
 * {@link DebouncedCommit} instance. Callers MUST call `flush` on blur
 * (leaving the control shouldn't wait out the debounce) — this hook already
 * calls it on unmount for you, which matters because `App.tsx` mounts tab
 * components conditionally on `activeTab` (see `useDeleteUndo.ts`'s file
 * header): a value scheduled right before a tab switch would otherwise
 * never commit at all, not just late.
 */
export function useDebouncedCommit<T>(
  onCommit: (value: T) => void,
  delayMs: number = DEFAULT_DEBOUNCE_MS,
): { schedule: (value: T) => void; flush: () => void } {
  const controllerRef = useRef<DebouncedCommit<T> | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new DebouncedCommit<T>(onCommit, delayMs);
  }
  useEffect(() => {
    controllerRef.current?.setOnCommit(onCommit);
  });

  useEffect(() => {
    const controller = controllerRef.current;
    return () => controller?.flush();
  }, []);

  return {
    schedule: (value: T) => controllerRef.current?.schedule(value),
    flush: () => controllerRef.current?.flush(),
  };
}
