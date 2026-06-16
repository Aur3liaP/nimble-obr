/**
 * FormField — label above a form control.
 *
 * Three variants via `as` prop:
 *   "input"    — single-line text/number input
 *   "textarea" — multiline textarea
 *   "select"   — <select> with children as <option> elements
 *   "custom"   — just renders the label above whatever `children` you pass
 *
 * The shared input/select/textarea style is applied automatically.
 * Forward `inputProps` / `selectProps` / `textareaProps` for native attrs.
 *
 * Usage:
 *   <FormField label="Name" value={form.name} onChange={(v) => set("name", v)} />
 *   <FormField label="Type" as="select" value={form.type} onChange={(v) => set("type", v)}>
 *     <option value="melee">Melee</option>
 *   </FormField>
 *   <FormField label="Notes" as="textarea" value={form.notes} onChange={(v) => set("notes", v)} rows={3} />
 */

import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, InputHTMLAttributes } from "react";

type Variant = "input" | "textarea" | "select" | "custom";

// Shared visual class applied to every native form element
const FIELD_BASE =
  "bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none " +
  "focus:border-amber-600 placeholder-stone-600 w-full transition-colors";

const FIELD_SELECT = FIELD_BASE.replace("focus:border-amber-600", "focus:border-amber-600") + " bg-stone-800";

interface FormFieldBaseProps {
  label: string;
  /** Extra classes on the wrapper div */
  className?: string;
}

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

interface TextareaFieldProps extends FormFieldBaseProps {
  as: "textarea";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: TextareaHTMLAttributes<HTMLTextAreaElement>["rows"];
  disabled?: boolean;
}

interface SelectFieldProps extends FormFieldBaseProps {
  as: "select";
  value: string | number;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: ReactNode;
}

interface CustomFieldProps extends FormFieldBaseProps {
  as: "custom";
  children: ReactNode;
}

type FormFieldProps =
  | InputFieldProps
  | TextareaFieldProps
  | SelectFieldProps
  | CustomFieldProps;

export function FormField(props: FormFieldProps) {
  const { label, className = "" } = props;

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[10px] text-stone-500 uppercase tracking-wide">{label}</span>

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
          onChange={(e) => (props as TextareaFieldProps).onChange(e.target.value)}
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
 * GridFields — convenience wrapper that puts 2 FormFields side by side.
 *
 * Usage:
 *   <GridFields>
 *     <FormField label="Range" ... />
 *     <FormField label="Damage" ... />
 *   </GridFields>
 */
export function GridFields({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  const colClass = cols === 3 ? "grid-cols-3" : "grid-cols-2";
  return <div className={`grid ${colClass} gap-2`}>{children}</div>;
}
