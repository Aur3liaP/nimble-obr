/**
 * @file TabPills — a row of filter/toggle pill buttons.
 *
 * Used in SpellsTab (tier filter) and InventoryTab's AddItemModal
 * (category filter), and generic enough for any future list filter
 * needing a small set of mutually-exclusive options.
 */

/** Available active-pill color themes. */
type PillAccent = "amber" | "violet" | "emerald";

/** Tailwind classes applied to the currently active pill, per accent. */
const ACTIVE_STYLES: Record<PillAccent, string> = {
  amber: "border-amber-600 bg-amber-900/50 text-amber-300",
  violet: "border-violet-600 bg-violet-900/50 text-violet-300",
  emerald: "border-emerald-600 bg-emerald-900/50 text-emerald-300",
};

/** Tailwind classes applied to all non-active pills, regardless of accent. */
const INACTIVE_STYLE =
  "border-stone-700 bg-stone-800/40 text-stone-400 hover:border-stone-600";

/** One selectable option: the value passed back on click, and its display label. */
interface PillOption<T extends string | number> {
  value: T;
  label: string;
}

/**
 * @property options - The list of selectable pills.
 * @property active - Currently selected value.
 * @property onChange - Called with the new value when a pill is clicked.
 * @property accent - Active-pill color theme, defaults to "amber".
 * @property className - Extra classes on the wrapper div.
 */
interface TabPillsProps<T extends string | number> {
  options: PillOption<T>[];
  active: T;
  onChange: (v: T) => void;
  accent?: PillAccent;
  className?: string;
}

/**
 * Renders `options` as a wrapping row of pill buttons, highlighting
 * whichever one matches `active`.
 *
 * @typeParam T - The value type carried by each option (string or number).
 */
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
