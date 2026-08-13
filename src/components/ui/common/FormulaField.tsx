/**
 * @file FormulaField — the formula {@link FormField} plus everything
 * {@link useFormulaField} needs to render: the deferred inline syntax
 * error, and a conflict notice if the server value changed elsewhere
 * mid-edit. Also exports {@link FormulaDiscardNotice}, a small standalone
 * piece for the *other* message `useFormulaField` can produce
 * (`discardedWarning`), which needs to render in a row's collapsed view
 * after its edit panel (and this component) has already unmounted.
 *
 * Used at all 6 formula write sites (spell/item/action create forms and
 * inline edit panels) — see `useFormulaField`'s @file header for why a
 * shared hook exists at all, and CLAUDE.md's formula-parser notes for why
 * the variable list surfaced via {@link FormulaHelpButton} is generated
 * rather than hand-typed.
 */

import type { UseFormulaFieldResult } from "../../../hooks/useFormulaField";
import { FormField } from "./FormField";
import { FormulaHelpButton } from "./FormulaHelp";

/**
 * @property label - Same as {@link FormField}'s `label`.
 * @property placeholder - Same as {@link FormField}'s `placeholder`.
 * @property field - The result of this call site's own `useFormulaField(...)` call.
 */
interface FormulaFieldProps {
  label: string;
  placeholder?: string;
  field: UseFormulaFieldResult;
}

/**
 * Renders the formula input (with the existing {@link FormulaHelpButton}
 * in its `labelExtra`, unchanged layout), plus, directly beneath it: the
 * syntax error once `field.showError` is true, and/or a conflict notice
 * if a concurrent external edit was detected. Both use the same visual
 * language as the existing invalid-formula badge on collapsed rows (⚠ +
 * color), just spelled out inline instead of behind a `title` tooltip,
 * since there's room here.
 */
export function FormulaField({ label, placeholder, field }: FormulaFieldProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <FormField
        label={label}
        labelExtra={<FormulaHelpButton />}
        value={field.value}
        onChange={field.onChange}
        onBlur={field.markTouched}
        placeholder={placeholder}
      />
      {field.showError && (
        <p className="text-[10px] text-rose-400 flex items-start gap-1">
          <span aria-hidden="true">⚠</span>
          <span>{field.error}</span>
        </p>
      )}
      {field.conflictWarning && (
        <p className="text-[10px] text-amber-400 flex items-start gap-1">
          <span aria-hidden="true">⚠</span>
          <span>{field.conflictWarning}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Renders `useFormulaField`'s `discardedWarning`, if set: shown when an
 * edit panel's "OK" button discarded an invalid, uncommitted formula draft
 * on close. Deliberately separate from {@link FormulaField} (rather than
 * folded into it) because it needs to keep showing in a row's *collapsed*
 * view, after the edit panel unmounts and {@link FormulaField} along with
 * it — `useFormulaField` itself must be called unconditionally by the row
 * (not only while editing) for this message to survive that transition.
 */
export function FormulaDiscardNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-[10px] text-amber-400 flex items-start gap-1.5 px-2.5 pb-2">
      <span aria-hidden="true">⚠</span>
      <span>{message}</span>
    </p>
  );
}
