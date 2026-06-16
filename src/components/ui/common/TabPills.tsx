/**
 * TabPills — a row of filter/toggle pill buttons.
 *
 * Used in: SpellsTab (tier filter), InventoryTab (category filter),
 *          and adaptable for any future list filter.
 *
 * Props
 * ─────
 * options     — array of { value, label } pairs
 * active      — currently selected value
 * onChange    — called with the new value when a pill is clicked
 * accent      — active pill color theme
 *               "violet" | "emerald" | "amber" (default "amber")
 * className   — extra classes on the wrapper div
 */

type PillAccent = "amber" | "violet" | "emerald";

const ACTIVE_STYLES: Record<PillAccent, string> = {
  amber:   "border-amber-600 bg-amber-900/50 text-amber-300",
  violet:  "border-violet-600 bg-violet-900/50 text-violet-300",
  emerald: "border-emerald-600 bg-emerald-900/50 text-emerald-300",
};

const INACTIVE_STYLE =
  "border-stone-700 bg-stone-800/40 text-stone-400 hover:border-stone-600";

interface PillOption<T extends string | number> {
  value: T;
  label: string;
}

interface TabPillsProps<T extends string | number> {
  options: PillOption<T>[];
  active: T;
  onChange: (v: T) => void;
  accent?: PillAccent;
  className?: string;
}

export function TabPills<T extends string | number>({
  options,
  active,
  onChange,
  accent = "amber",
  className = "",
}: TabPillsProps<T>) {
  return (
    <div className={`flex gap-1.5 flex-wrap ${className}`}>
      {options.map(({ value, label }) => (
        <button
          key={String(value)}
          onClick={() => onChange(value)}
          className={`
            px-2.5 py-1 rounded-full text-xs font-medium border transition-all
            ${active === value ? ACTIVE_STYLES[accent] : INACTIVE_STYLE}
          `}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
