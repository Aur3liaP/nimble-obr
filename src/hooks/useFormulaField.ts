/**
 * @file useFormulaField — local draft + commit-when-valid state for a
 * single formula input field, shared by all 6 write sites (spell/item/
 * action create forms and inline edit panels in SpellsTab/InventoryTab/
 * CombatTab).
 *
 * Two distinct problems, one hook:
 *
 * 1. A formula the parser can't read must never be persisted. The 3
 *    create-form sites already buffer everything in local `form` state
 *    until an explicit "Add" click, so gating that click is enough there.
 *    The 3 inline edit-panel sites do not: every {@link FormField}
 *    `onChange` there calls `onUpdate` directly, which writes to OBR scene
 *    metadata on every keystroke (see `useOBR.updateCharacter`) — there is
 *    no separate "save" step to gate. This hook keeps a local `draft` and
 *    only calls `onCommit` when the draft is syntactically valid or empty,
 *    so an in-progress, invalid formula is never broadcast to the table;
 *    the character keeps its last valid formula until the draft becomes
 *    valid again.
 * 2. The error message shouldn't appear on the very first keystroke, but
 *    must stay visible while the user corrects a formula that's already
 *    known to be broken (e.g. re-opening an already-invalid saved
 *    formula). See `touched`.
 *
 * Modeled directly on {@link useDraggableValue}: a local value diverges
 * from the server value during active local editing, and only resyncs
 * from the server when not diverging, so an external update doesn't yank
 * the field out from under someone mid-edit. The one deliberate departure
 * from that precedent: a drag lasts about two seconds, a formula edit can
 * last a lot longer, so silently skipping the resync would mean an
 * external change (e.g. the GM editing the same formula from another
 * client) gets silently overwritten the moment the local draft finally
 * commits. `conflictWarning` exists specifically so that overwrite is
 * visible instead of silent, without discarding the user's own in-progress
 * typing.
 */

import { useEffect, useRef, useState } from "react";
import { formulaSyntaxError } from "../utils/formulaParser";

/**
 * @property value - Current draft text to render in the input. May differ
 * from the `serverValue` passed to {@link useFormulaField} while an
 * invalid, not-yet-committed local edit is in progress.
 * @property error - Syntax error for the current draft, or `undefined` if
 * it's valid (or blank — an empty formula is not an error).
 * @property showError - Whether `error` should currently be displayed.
 * `false` until the field is touched, so an error doesn't appear on the
 * very first keystroke of a fresh formula.
 * @property discardedWarning - Set by {@link UseFormulaFieldResult.closeEdit}
 * when it discards an invalid draft; explains that the edit wasn't saved
 * and what was kept. Persists after editing closes (the field itself may
 * no longer be rendered) until the next edit attempt. `null` otherwise.
 * @property conflictWarning - Set when the server value changed elsewhere
 * while the local draft was diverged (invalid); explains that finishing
 * the current edit will overwrite that change. Cleared once the draft
 * commits or the edit is discarded. `null` otherwise.
 * @property onChange - Wire directly to the input's `onChange`.
 * @property markTouched - Wire directly to the input's `onBlur`. Also
 * safe to call from a button's click handler (e.g. a blocked "Add") to
 * reveal a hidden error on a first submit attempt.
 * @property closeEdit - Call when leaving edit mode (e.g. an "OK" button).
 * If the draft is currently invalid, discards it back to the server value
 * and sets `discardedWarning`; otherwise a no-op. Never blocks the caller
 * from actually closing.
 */
export interface UseFormulaFieldResult {
  value: string;
  error: string | undefined;
  showError: boolean;
  discardedWarning: string | null;
  conflictWarning: string | null;
  onChange: (v: string) => void;
  markTouched: () => void;
  closeEdit: () => void;
}

/**
 * @param serverValue - The current persisted formula (e.g. `spell.formula`),
 * or the current local form-state value for the 3 create-form sites (which
 * never actually reach OBR through this hook — see the @file header).
 * @param onCommit - Called with the new value once it's valid or empty.
 * For edit-panel sites this is the real `onUpdate(...)` write; for
 * create-form sites it just updates local `form` state.
 * @returns See {@link UseFormulaFieldResult}.
 */
export function useFormulaField(
  serverValue: string,
  onCommit: (v: string) => void,
): UseFormulaFieldResult {
  const [draft, setDraft] = useState(serverValue);
  const [touched, setTouched] = useState(() => serverValue.trim() !== "");
  const [discardedWarning, setDiscardedWarning] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  // True while `draft` holds a locally-typed, not-yet-committed invalid
  // edit — mirrors useDraggableValue's isDraggingRef.
  const isDivergedRef = useRef(false);

  useEffect(() => {
    if (!isDivergedRef.current) {
      setDraft(serverValue);
      return;
    }
    // Not resyncing the draft (would yank the user's in-progress typing),
    // but the server value genuinely changed under them — surface it
    // rather than letting their eventual commit silently overwrite it.
    setConflictWarning(
      `This formula was changed elsewhere while you were editing (now: "${
        serverValue.trim() === "" ? "empty" : serverValue
      }"). Finishing your edit will overwrite that.`,
    );
  }, [serverValue]);

  const error = formulaSyntaxError(draft);

  const onChange = (v: string) => {
    setDraft(v);
    setDiscardedWarning(null);
    if (formulaSyntaxError(v) === undefined) {
      isDivergedRef.current = false;
      setConflictWarning(null);
      onCommit(v);
    } else {
      isDivergedRef.current = true;
    }
  };

  const markTouched = () => setTouched(true);

  const closeEdit = () => {
    if (error === undefined) return;
    setDraft(serverValue);
    setDiscardedWarning(
      // `error` is a FormulaError message, which by this file's own
      // convention already ends with a period — do not add a second one
      // right after it.
      `Formula edit wasn't saved: ${error} The previous formula was kept${
        serverValue.trim() === "" ? "." : ` ("${serverValue}").`
      }`,
    );
    isDivergedRef.current = false;
    setConflictWarning(null);
  };

  return {
    value: draft,
    error,
    showError: touched && error !== undefined,
    discardedWarning,
    conflictWarning,
    onChange,
    markTouched,
    closeEdit,
  };
}
