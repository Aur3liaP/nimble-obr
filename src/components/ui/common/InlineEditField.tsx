/**
 * InlineEditField — renders an input when editable, a plain span otherwise.
 *
 * Replaces the recurring pattern:
 *   {canEdit ? (
 *     <input value={x} onChange={...} className="bg-transparent border-b ..." />
 *   ) : (
 *     <span className="text-sm ...">{x}</span>
 *   )}
 *
 * Variants
 * ────────
 * "text"    — single-line text input with underline style (SummaryTab identity fields)
 * "number"  — numeric input with underline style (Level, Speed, HP…)
 * "display" — larger display value (HP current, stat values…)
 *
 * Props
 * ─────
 * value        — current value (string or number)
 * canEdit      — switches between edit and read mode
 * onChange     — called with new value (string always; parse in caller if needed)
 * label        — optional tiny label above the field
 * type         — "text" | "number" (default "text")
 * min / max    — for number inputs
 * placeholder  — for text inputs
 * readClass    — Tailwind classes for the read-only span
 * editClass    — extra Tailwind classes added to the input (merged with base)
 * className    — wrapper div classes
 * align        — "left" | "center" | "right" (default "left")
 */

type FieldType = "text" | "number";
type Align = "left" | "center" | "right";

const ALIGN_CLASS: Record<Align, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

// Base input style: transparent bg with underline, used for inline identity fields
const INPUT_UNDERLINE =
  "bg-transparent border-b border-stone-700 focus:border-amber-600 outline-none " +
  "transition-colors w-full pb-0.5";

interface InlineEditFieldProps {
  value: string | number;
  canEdit: boolean;
  onChange?: (v: string) => void;
  label?: string;
  type?: FieldType;
  min?: number;
  max?: number;
  placeholder?: string;
  /** Classes applied to the read-only <span> */
  readClass?: string;
  /** Extra classes merged onto the <input> */
  editClass?: string;
  className?: string;
  align?: Align;
}

export function InlineEditField({
  value,
  canEdit,
  onChange,
  label,
  type = "text",
  min,
  max,
  placeholder,
  readClass = "text-sm text-stone-200 font-medium truncate",
  editClass = "text-sm text-stone-200",
  className = "",
  align = "left",
}: InlineEditFieldProps) {
  const alignCls = ALIGN_CLASS[align];

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {label && (
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</span>
      )}
      {canEdit ? (
        <input
          type={type}
          value={value}
          min={min}
          max={max}
          placeholder={placeholder}
          onChange={(e) => onChange?.(e.target.value)}
          className={`${INPUT_UNDERLINE} ${editClass} ${alignCls}`}
        />
      ) : (
        <span className={`${readClass} ${alignCls}`}>
          {value !== "" && value !== undefined ? value : "—"}
        </span>
      )}
    </div>
  );
}

/**
 * InlineNumberField — shorthand for numeric inline fields (HP, Level, Speed…).
 * Displays value as-is in read mode, with configurable text size.
 */
interface InlineNumberFieldProps {
  value: number;
  canEdit: boolean;
  onChange?: (v: number) => void;
  label?: string;
  min?: number;
  max?: number;
  /** Size variant: "sm" | "base" | "lg" | "2xl" | "3xl" */
  size?: "sm" | "base" | "lg" | "2xl" | "3xl";
  colorClass?: string;
  align?: Align;
  className?: string;
}

const SIZE_CLASS: Record<string, string> = {
  sm:  "text-sm",
  base:"text-base",
  lg:  "text-lg",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
};

export function InlineNumberField({
  value,
  canEdit,
  onChange,
  label,
  min,
  max,
  size = "sm",
  colorClass = "text-stone-200",
  align = "center",
  className = "",
}: InlineNumberFieldProps) {
  const sizeCls = SIZE_CLASS[size] ?? "text-sm";
  const alignCls = ALIGN_CLASS[align];

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {label && (
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</span>
      )}
      {canEdit ? (
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            if (!isNaN(v)) onChange?.(v);
          }}
          className={`
            bg-transparent border-b border-stone-700 focus:border-amber-600
            outline-none transition-colors w-full pb-0.5 font-bold
            ${sizeCls} ${colorClass} ${alignCls}
          `}
        />
      ) : (
        <span className={`font-bold tabular-nums ${sizeCls} ${colorClass} ${alignCls}`}>
          {value}
        </span>
      )}
    </div>
  );
}
