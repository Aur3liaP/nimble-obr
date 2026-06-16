/**
 * RollButton — the small 🎲 button that triggers a dice roll modal.
 *
 * Used in: SummaryTab (skills), CombatTab (actions, inventory favorites),
 *          SpellsTab (spell rows), InventoryTab (item rows).
 *
 * Props
 * ─────
 * onClick     — called when the button is clicked
 * accent      — color theme matching the tab context
 *               "amber" (default) | "violet" | "emerald"
 * disabled    — shows a muted state, no click
 * className   — extra classes (e.g. opacity-0 group-hover:opacity-100)
 */

type RollAccent = "amber" | "violet" | "emerald";

const ACCENT_STYLES: Record<RollAccent, string> = {
  amber:   "bg-amber-900/50 hover:bg-amber-800/60 text-amber-300 border-amber-800/40",
  violet:  "bg-violet-900/50 hover:bg-violet-800/60 text-violet-300 border-violet-800/40",
  emerald: "bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-300 border-emerald-800/40",
};

interface RollButtonProps {
  onClick: () => void;
  accent?: RollAccent;
  disabled?: boolean;
  className?: string;
}

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
