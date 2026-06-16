/**
 * NumericStepper — a −  value  + control.
 *
 * Used in:
 *   DicePanel   — dice count, modifier, extra dice
 *   DiceRollModal — extra dice count
 *   InventoryTab  — item quantity
 *
 * Props
 * ─────
 * value        — current number
 * onChange     — called with the new value (already clamped)
 * min / max    — clamp bounds (default −Infinity / +Infinity)
 * label        — optional tiny label above the stepper
 * displayFn    — optional formatter for the displayed value (e.g. "+3" for modifiers)
 * valueClass   — Tailwind text color class for the value (default "text-stone-200")
 * compact      — if true, uses smaller padding on the buttons (for inline usage)
 */

interface NumericStepperProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
  displayFn?: (v: number) => string;
  valueClass?: string;
  compact?: boolean;
}

export function NumericStepper({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  label,
  displayFn,
  valueClass = "text-stone-200",
  compact = false,
}: NumericStepperProps) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));

  const btnClass = compact
    ? "w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600 transition-colors"
    : "w-6 h-6 rounded bg-stone-700 text-stone-200 font-bold hover:bg-stone-600 transition-colors text-sm";

  const valClass = compact
    ? `text-xs font-bold w-5 text-center tabular-nums ${valueClass}`
    : `text-sm font-bold w-6 text-center tabular-nums ${valueClass}`;

  return (
    <div className="flex flex-col gap-0.5">
      {label && (
        <span className="text-[10px] text-stone-500 uppercase tracking-wide">{label}</span>
      )}
      <div className="flex items-center gap-1.5">
        <button onClick={dec} className={btnClass}>−</button>
        <span className={valClass}>{displayFn ? displayFn(value) : value}</span>
        <button onClick={inc} className={btnClass}>+</button>
      </div>
    </div>
  );
}
