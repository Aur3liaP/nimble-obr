/**
 * @file InlineEditField — renders an input when editable, a plain span otherwise.
 *
 * Replaces the recurring pattern:
 * ```tsx
 * {canEdit ? (
 *   <input value={x} onChange={...} className="bg-transparent border-b ..." />
 * ) : (
 *   <span className="text-sm ...">{x}</span>
 * )}
 * ```
 *
 * Two exports:
 * - {@link InlineEditField} — generic text/number field with an underline
 *   style, used for identity fields in SummaryTab (Name, Class, Ancestry, Size).
 * - {@link InlineNumberField} — numeric-only shorthand with size variants,
 *   used for HP, Level, Speed, and other prominent numeric displays.
 */

/** Native input type supported by {@link InlineEditField}. */
type FieldType = "text" | "number";

/** Text alignment variant applied to both the input and the read-only span. */
type Align = "left" | "center" | "right";

/** Tailwind text-alignment class per {@link Align} value. */
const ALIGN_CLASS: Record<Align, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/** Shared base style for the underline-style input used by {@link InlineEditField}. */
const INPUT_UNDERLINE =
  "bg-transparent border-b border-stone-700 focus:border-amber-600 outline-none " +
  "transition-colors w-full pb-0.5";

/**
 * @property value - Current value (string or number).
 * @property canEdit - Switches between edit (input) and read (span) mode.
 * @property onChange - Called with the new value as a string; caller parses if a number is needed.
 * @property label - Optional tiny label shown above the field.
 * @property type - Native input type, defaults to "text".
 * @property min - Minimum value (numeric inputs only).
 * @property max - Maximum value (numeric inputs only).
 * @property placeholder - Placeholder shown in edit mode.
 * @property readClass - Tailwind classes for the read-only `<span>`.
 * @property editClass - Extra Tailwind classes merged onto the `<input>`.
 * @property className - Wrapper div classes.
 * @property align - Text alignment, defaults to "left".
 */
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

/**
 * Renders a labeled text/number field that swaps between an editable
 * underline-style input and a plain read-only span based on `canEdit`.
 * In read mode, falls back to an em dash when the value is empty/undefined.
 */
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
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">
          {label}
        </span>
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
/**
 * @property value - Current numeric value.
 * @property canEdit - Switches between edit (input) and read (span) mode.
 * @property onChange - Called with the parsed number; not called if the input doesn't parse to a valid number.
 * @property label - Optional tiny label shown above the field.
 * @property min - Minimum value.
 * @property max - Maximum value.
 * @property size - Text size variant, from "sm" to "3xl".
 * @property colorClass - Either a static Tailwind text-color class (e.g. "text-emerald-300"),
 * or a function `(ratio: number) => string` returning a raw CSS color (e.g. a hex string)
 * derived from `value / max` — used for HP-style fields where the color should shift
 * as the ratio drops (e.g. green → amber → red). When a function is passed, the
 * resolved color is applied via inline `style`, not as a Tailwind class, since a
 * function can't be safely interpolated into a `className` string.
 * @property align - Text alignment, defaults to "center" (unlike {@link InlineEditField}, which defaults to "left").
 * @property className - Wrapper div classes.
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
  colorClass?: string | ((ratio: number) => string);
  align?: Align;
  className?: string;
}

/** Tailwind font-size class per size variant. */
const SIZE_CLASS: Record<string, string> = {
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
};

/**
 * Numeric-only shorthand for {@link InlineEditField}, with size variants
 * for prominent displays (HP current value, Level, Speed, stat bonuses…).
 * Always renders bold, tabular-nums text in both edit and read modes.
 *
 * `colorClass` can be a static Tailwind class or a ratio-based function;
 * in the latter case the resolved color is applied via inline `style` in
 * *both* the input (edit mode) and the span (read mode) — a function
 * value is never interpolated directly into `className`, since
 * `${someFunction}` would stringify to the function's source code and
 * silently produce an invalid class.
 */
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

  const isDynamicColor = typeof colorClass === "function";
  // Ratio only makes sense when max is a real, positive bound — guard
  // against max being 0/undefined (e.g. fields with no real max, like
  // Level or Speed) to avoid divide-by-zero producing NaN colors.
  const ratio =
    isDynamicColor && max ? Math.min(1, Math.max(0, value / max)) : 0;
  const resolvedColor = isDynamicColor
    ? (colorClass as (ratio: number) => string)(ratio)
    : undefined;
  const staticColorCls = isDynamicColor ? "" : (colorClass as string);

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {label && (
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">
          {label}
        </span>
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
            ${sizeCls} ${alignCls} ${staticColorCls}
          `}
          style={resolvedColor ? { color: resolvedColor } : undefined}
        />
      ) : (
        <span
          className={`font-bold tabular-nums ${sizeCls} ${alignCls} ${staticColorCls}`}
          style={resolvedColor ? { color: resolvedColor } : undefined}
        >
          {value}
        </span>
      )}
    </div>
  );
}