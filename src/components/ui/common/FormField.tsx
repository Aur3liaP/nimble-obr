/**
 * @file FormField — label above a form control, with three variants via
 * the `as` prop: "input" (text/number), "textarea", "select", or "custom"
 * (just the label, with arbitrary children below it).
 *
 * The shared input/select/textarea visual style ({@link FIELD_BASE}) is
 * applied automatically so every form across the AddSpellModal,
 * AddItemModal, AddActionModal, and inline edit panels stays consistent.
 *
 * @example
 * ```tsx
 * <FormField label="Name" value={form.name} onChange={(v) => set("name", v)} />
 *
 * <FormField label="Type" as="select" value={form.type} onChange={(v) => set("type", v)}>
 *   <option value="melee">Melee</option>
 * </FormField>
 *
 * <FormField label="Notes" as="textarea" value={form.notes} onChange={(v) => set("notes", v)} rows={3} />
 * ```
 */

import type {
  ReactNode,
  TextareaHTMLAttributes,
  InputHTMLAttributes,
} from "react";

/** Shared Tailwind classes applied to every native input/textarea/select rendered by this component. */
const FIELD_BASE =
  "bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none " +
  "focus:border-amber-600 placeholder-stone-600 w-full transition-colors";

/** Same as {@link FIELD_BASE} with an extra opaque background, since `<select>` needs a solid backdrop for its native dropdown to read correctly. */
const FIELD_SELECT =
  FIELD_BASE.replace("focus:border-amber-600", "focus:border-amber-600") +
  " bg-stone-800";

/** Props shared by every variant. */
interface FormFieldBaseProps {
  label: string;
  /** Extra classes on the wrapper div */
  className?: string;
}

/** Props for the default "input" variant (text/number/etc. single-line input). */
interface InputFieldProps extends FormFieldBaseProps {
  as?: "input";
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
  min?: number;
  max?: number;
  disabled?: boolean;
}

/** Props for the "textarea" variant. */
interface TextareaFieldProps extends FormFieldBaseProps {
  as: "textarea";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: TextareaHTMLAttributes<HTMLTextAreaElement>["rows"];
  disabled?: boolean;
}

/** Props for the "select" variant; `children` should be `<option>` elements. */
interface SelectFieldProps extends FormFieldBaseProps {
  as: "select";
  value: string | number;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: ReactNode;
}

/** Props for the "custom" variant — renders only the label, with arbitrary `children` below it (no styled control applied). */
interface CustomFieldProps extends FormFieldBaseProps {
  as: "custom";
  children: ReactNode;
}

type FormFieldProps =
  | InputFieldProps
  | TextareaFieldProps
  | SelectFieldProps
  | CustomFieldProps;

/**
 * Renders a label followed by the form control matching `props.as`
 * (defaults to a plain text/number input when `as` is omitted).
 */
export function FormField(props: FormFieldProps) {
  const { label, className = "" } = props;

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[10px] text-stone-500 uppercase tracking-wide">
        {label}
      </span>

      {(!props.as || props.as === "input") && (
        <input
          type={(props as InputFieldProps).type ?? "text"}
          value={(props as InputFieldProps).value}
          placeholder={(props as InputFieldProps).placeholder}
          min={(props as InputFieldProps).min}
          max={(props as InputFieldProps).max}
          disabled={(props as InputFieldProps).disabled}
          onChange={(e) => (props as InputFieldProps).onChange(e.target.value)}
          className={FIELD_BASE}
        />
      )}

      {props.as === "textarea" && (
        <textarea
          value={(props as TextareaFieldProps).value}
          placeholder={(props as TextareaFieldProps).placeholder}
          rows={(props as TextareaFieldProps).rows ?? 3}
          disabled={(props as TextareaFieldProps).disabled}
          onChange={(e) =>
            (props as TextareaFieldProps).onChange(e.target.value)
          }
          className={`${FIELD_BASE} resize-none`}
        />
      )}

      {props.as === "select" && (
        <select
          value={(props as SelectFieldProps).value}
          disabled={(props as SelectFieldProps).disabled}
          onChange={(e) => (props as SelectFieldProps).onChange(e.target.value)}
          className={FIELD_SELECT}
        >
          {(props as SelectFieldProps).children}
        </select>
      )}

      {props.as === "custom" && (
        <div>{(props as CustomFieldProps).children}</div>
      )}
    </div>
  );
}

/**
 * Lays out its children (typically two or three {@link FormField}s) side
 * by side in a responsive grid.
 *
 * @param cols - Number of grid columns, 2 (default) or 3.
 */
export function GridFields({
  children,
  cols = 2,
}: {
  children: ReactNode;
  cols?: 2 | 3;
}) {
  const colClass = cols === 3 ? "grid-cols-3" : "grid-cols-2";
  return <div className={`grid ${colClass} gap-2`}>{children}</div>;
}
