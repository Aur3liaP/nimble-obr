/**
 * @file RollButton — small 🎲 button that opens the dice roll modal.
 *
 * Used in SummaryTab (skills), CombatTab (actions, inventory favorites),
 * SpellsTab (spell rows), and InventoryTab (item rows) — anywhere a
 * formula can be rolled. Callers are responsible for queuing the actual
 * roll request and opening {@link DiceRollModal}; this component only
 * renders the trigger.
 */

type RollAccent = "amber" | "violet" | "emerald";

/** Tailwind color classes per accent theme, matching the tab context the button appears in. */
const ACCENT_STYLES: Record<RollAccent, string> = {
  amber:
    "bg-amber-900/50 hover:bg-amber-800/60 text-amber-300 border-amber-800/40",
  violet:
    "bg-violet-900/50 hover:bg-violet-800/60 text-violet-300 border-violet-800/40",
  emerald:
    "bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-300 border-emerald-800/40",
};

/**
 * @property onClick - Called when the button is clicked (not called at all in the `disabled` state).
 * @property accent - Color theme matching the surrounding tab context.
 * @property disabled - Renders a muted, non-interactive `<span>` instead of a button (e.g. when there are no hit dice left to spend).
 * @property className - Extra classes merged onto the root element.
 */
interface RollButtonProps {
  onClick: () => void;
  accent?: RollAccent;
  disabled?: boolean;
  className?: string;
}

/**
 * Renders a small 🎲 trigger button. When `disabled`, renders a
 * non-interactive muted `<span>` instead, since some call sites (e.g.
 * hit dice with none remaining) need to visually communicate "can't roll
 * right now" without removing the button from the layout.
 */
export function RollButton({
  onClick,
  accent = "amber",
  disabled = false,
  className = "",
}: RollButtonProps) {
  if (disabled) {
    return (
      <span className="px-2 py-1 rounded text-[10px] font-bold border border-stone-700/40 bg-stone-800/40 text-stone-600 cursor-not-allowed">
        🎲
      </span>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`
        px-2 py-1 rounded text-[10px] font-bold border transition-all active:scale-95
        ${ACCENT_STYLES[accent]} ${className}
      `}
    >
      🎲
    </button>
  );
}
