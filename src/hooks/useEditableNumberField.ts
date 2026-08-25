/**
 * @file useEditableNumberField — local string draft + explicit-commit
 * (blur/Enter) state for {@link InlineNumberField}.
 *
 * Fixes a bug where an in-progress edit could never be represented: the
 * field used to hold its local draft as a `number` and reject (silently
 * bounce back to the old value) any input that didn't parse — most notably
 * an emptied field (`parseInt("") === NaN`). A player could never clear
 * the field to retype a shorter number; a residual leading digit stuck
 * around instead. Fixed here by drafting in `string`, never rejecting an
 * intermediate value, and only parsing/clamping once at an explicit commit
 * trigger (blur or Enter) — never per keystroke.
 *
 * This retires this component's use of `useDebouncedCommit`: that hook
 * existed to collapse the rapid-fire `change` events a native
 * `<input type="number">` spinner/mouse-wheel fires. `InlineNumberField`
 * now renders `type="text" inputMode="numeric"` (no native spinner), and
 * commits are explicit (blur/Enter) rather than continuous, so there is no
 * longer a rapid-fire source to debounce here. `useDebouncedCommit` itself
 * is unaffected — `DraggableBar`'s keyboard-repeat handler still uses it.
 *
 * Resync policy — deliberate, not the same as {@link useFormulaField}:
 * a numeric field like this one is a SHORT edit (a couple of keystrokes,
 * a couple of seconds — more so than before this fix, since `handleFocus`
 * below selects the field's full text so retyping overwrites it outright).
 * Same policy as {@link useDraggableValue}: while editing, an external
 * (e.g. GM) change to the same field is not resynced into the draft, and
 * the eventual commit silently overwrites it — last commit wins. This is
 * a deliberate choice for a trusted-table extension, not an oversight:
 * `useFormulaField`'s skip-and-warn treatment is reserved for edits that
 * can legitimately stay open a lot longer (a formula can take a while to
 * get right), where a silent overwrite is more likely to destroy real,
 * unrelated work. Residual gap accepted by that same choice: a field
 * opened and then left focused for a long time (not touched, not blurred)
 * still commits last-wins at whatever point it's eventually blurred. See
 * CLAUDE.md's "Structural constraints" section for the summary of this
 * policy and its accepted limitation.
 */

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

/** Result of {@link resolveNumberFieldCommit}. */
export type NumberFieldCommitResult =
  | { commit: false }
  | { commit: true; value: number };

/**
 * Parses a draft string into a whole number, or `null` if it isn't one
 * (empty, partial, or garbage — e.g. mid-edit, or a stray non-numeric
 * character despite `inputMode="numeric"`, which only hints the on-screen
 * keyboard and enforces nothing on desktop).
 */
function parseDraftNumber(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/**
 * Pure (no React) decision logic behind the ArrowUp/ArrowDown keyboard
 * step — extracted and tested the same way {@link resolveNumberFieldCommit}
 * is, for the same reason (see that function's own doc). Never clamps
 * (clamping happens once, at commit, exactly like a typed draft — the
 * draft is allowed to wander outside `min`/`max` mid-edit) and never
 * produces `NaN`: an unparseable draft (typically an emptied field) steps
 * from `persistedValue` instead, not from 0.
 *
 * @param draft - The field's current local text.
 * @param persistedValue - Fallback base when `draft` doesn't parse.
 * @param delta - `+1` for ArrowUp, `-1` for ArrowDown.
 * @returns The new draft string. Has no `onCommit` parameter and calls
 * nothing — structurally incapable of triggering a commit, which is the
 * whole point: stepping only ever mutates the draft.
 */
export function stepDraft(
  draft: string,
  persistedValue: number,
  delta: number,
): string {
  const base = parseDraftNumber(draft) ?? persistedValue;
  return String(base + delta);
}

/**
 * Pure (no React) decision logic for what a number field's commit should
 * do, extracted for unit testing the same way {@link DebouncedCommit} is
 * (see `useDebouncedCommit.ts`'s header — this project has no
 * hook-rendering test utility, so a hook itself isn't directly testable,
 * but this decision doesn't need React to be tested).
 *
 * Two guards, checked in this exact order — reordering either one
 * reintroduces a silent, needless overwrite of a concurrent external
 * change that the player never actually caused:
 *
 * 1. **Unchanged-since-focus.** `draft === initialValue` means the field
 *    was opened (focused) and left (blurred/Enter) without the player
 *    typing anything different — even if `min`/`max` would reshape it.
 *    This check MUST run before clamping: a field opened on an
 *    already-out-of-range value (an imported sheet, or `max` lowered
 *    elsewhere since) would otherwise have its untouched draft silently
 *    reshaped by the clamp into something that reads as "changed", firing
 *    a commit — and, per the resync policy above, overwriting whatever an
 *    external client wrote in the meantime — even though the player never
 *    typed a single character.
 * 2. **Unparseable draft.** Typically an emptied field the player never
 *    finished retyping before leaving it. Discarded, not committed as a
 *    fallback 0 or NaN — same "a failure is never silently coerced into a
 *    value" principle as the formula parser (see CLAUDE.md's "Failures
 *    are loud, never a silent zero").
 *
 * @param draft - The field's current local text.
 * @param initialValue - The text captured when the field was focused (see
 * {@link useEditableNumberField}'s `initialValueRef`) — NOT the value
 * currently persisted on the server, which may have moved since focus;
 * comparing against the live persisted value would let through exactly
 * the case this guard exists to catch (draft still reads the old value,
 * the server now holds something else, so a naive comparison against the
 * live server value would see a "difference" and fire a commit that
 * overwrites it).
 * @param min - Optional lower clamp bound, applied only once guard 1 and
 * guard 2 have both passed.
 * @param max - Optional upper clamp bound, same timing as `min`.
 */
export function resolveNumberFieldCommit(
  draft: string,
  initialValue: string,
  min?: number,
  max?: number,
): NumberFieldCommitResult {
  if (draft === initialValue) return { commit: false };
  const parsed = parseDraftNumber(draft);
  if (parsed === null) return { commit: false };
  let value = parsed;
  if (min !== undefined) value = Math.max(min, value);
  if (max !== undefined) value = Math.min(max, value);
  return { commit: true, value };
}

/** Return shape of {@link useEditableNumberField}. */
export interface EditableNumberFieldResult {
  /** What the `<input>`'s `value` should be bound to. */
  displayValue: string;
  /** Wire to the `<input>`'s `onFocus`. */
  handleFocus: (e: FocusEvent<HTMLInputElement>) => void;
  /** Wire to the `<input>`'s `onChange` — pass `e.target.value`. */
  handleChange: (v: string) => void;
  /** Wire to the `<input>`'s `onBlur`. Commits if there's something to commit. */
  handleBlur: () => void;
  /** Wire to the `<input>`'s `onKeyDown`. Enter commits (and blurs); Escape discards the draft. */
  handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Local string-draft + explicit-commit state for a single numeric field.
 * See this file's header for the bug this replaces and the resync policy.
 *
 * @param value - Current persisted value (e.g. `character.hp.current`).
 * @param onCommit - Called with the new, already-clamped value once the
 * player finishes an edit that actually changed something valid. Not
 * called for an unchanged or unparseable draft (see
 * {@link resolveNumberFieldCommit}).
 * @param min - Optional lower clamp bound.
 * @param max - Optional upper clamp bound.
 */
export function useEditableNumberField(
  value: number,
  onCommit: (v: number) => void,
  min?: number,
  max?: number,
): EditableNumberFieldResult {
  // `null` = not currently editing; display tracks `value` directly.
  const [draft, setDraft] = useState<string | null>(null);
  // Captured once, at focus time — see resolveNumberFieldCommit's `initialValue`
  // doc for why this must never be refreshed from a live `value` change
  // while the field is focused (that's the entire point of the guard it
  // feeds). Only ever written in handleFocus, only ever read/cleared in
  // handleBlur/discard below — do not add a third writer.
  const initialValueRef = useRef<string>("");

  const cancel = () => setDraft(null);

  const commit = () => {
    if (draft === null) return;
    const result = resolveNumberFieldCommit(
      draft,
      initialValueRef.current,
      min,
      max,
    );
    cancel();
    if (result.commit) onCommit(result.value);
  };

  const handleFocus = (e: FocusEvent<HTMLInputElement>) => {
    const current = String(value);
    initialValueRef.current = current;
    setDraft(current);
    e.target.select();
  };

  const handleChange = (v: string) => setDraft(v);

  const handleBlur = () => commit();

  /**
   * ArrowUp/ArrowDown step, restored after the `type="number"` →
   * `type="text"` switch removed the native spinner's keyboard step (an
   * intentional accessibility affordance, not incidental to the native
   * `<input type="number">`). `preventDefault` is required here: in a
   * text input, these keys otherwise move the caret to the start/end of
   * the field instead of doing nothing.
   *
   * Steps the DRAFT only — never calls `onCommit`, never touches OBR.
   * Deliberately NOT routed through `useDebouncedCommit`: that hook
   * existed to collapse rapid-fire *commits* into one OBR write (see this
   * file's header on why it was retired from this component); stepping
   * the draft doesn't commit at all until blur/Enter, so there is nothing
   * to debounce — reintroducing it here would be solving a problem this
   * design doesn't have. Twenty consecutive presses (OS key-repeat) just
   * update local state twenty times; still one commit, at blur, same as
   * twenty keystrokes of typed digits.
   *
   * Not clamped here — clamping happens once, at commit, exactly like a
   * typed draft. The draft is allowed to wander outside `min`/`max`
   * mid-edit; only the eventual committed value is bounded.
   */
  const step = (delta: number) => setDraft(stepDraft(draft ?? "", value, delta));

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commit();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      cancel();
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(-1);
    }
  };

  // Abandon (never commit) an in-progress draft when the tab/app is
  // hidden — e.g. the player alt-tabs away mid-edit without blurring the
  // field first. NOT VERIFIED against a real OBR session as of this
  // writing: the extension runs inside an iframe, and it hasn't been
  // confirmed which document actually receives `visibilitychange` there
  // (`document.visibilityState` in the iframe is expected to track the
  // parent tab, but that's an assumption, not a tested fact). If manual
  // OBR testing shows this never fires, remove it rather than leave it in
  // as a guard that silently never runs — see CLAUDE.md's `manualResolution`
  // history for why a documented-but-never-wired guard is worse than no
  // guard at all. Blur is the primary safety net regardless (e.g. clicking
  // a token on the table blurs the field) — this only covers the narrower
  // "switched away without clicking anything first" case.
  useEffect(() => {
    if (draft === null) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [draft]);

  return {
    displayValue: draft ?? String(value),
    handleFocus,
    handleChange,
    handleBlur,
    handleKeyDown,
  };
}
