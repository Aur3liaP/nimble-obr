/**
 * @file FavoriteButton — star toggle (⭐ / ☆).
 *
 * Used across SpellsTab, InventoryTab, and CombatTab (action rows and
 * inventory favorite rows) for marking spells/items/actions as quick-access
 * favorites, which then surface in the Combat tab's Favorites section.
 *
 * When `canEdit` is false, renders as a plain non-interactive `<span>`
 * instead of a `<button>`, so read-only viewers see the star but can't
 * toggle it.
 */

/**
 * @property isFavorite - Current favorite state.
 * @property canEdit - If false, renders read-only (no click handler, plain span).
 * @property onToggle - Called on click; only wired up when `canEdit` is true.
 * @property className - Extra classes merged onto the root element.
 */
interface FavoriteButtonProps {
  isFavorite: boolean;
  canEdit?: boolean;
  onToggle?: () => void;
  className?: string;
}

/**
 * Renders a star toggle reflecting `isFavorite`. Read-only viewers get a
 * non-interactive `<span>` with `aria-hidden`; editors get a clickable
 * `<button>` with an appropriate add/remove tooltip.
 */
export function FavoriteButton({
  isFavorite,
  canEdit = true,
  onToggle,
  className = "",
}: FavoriteButtonProps) {
  const icon = isFavorite ? "⭐" : "☆";

  if (!canEdit) {
    return (
      <span
        className={`text-sm ${isFavorite ? "text-amber-400" : "text-stone-600"} ${className}`}
        aria-hidden="true"
      >
        {icon}
      </span>
    );
  }

  return (
    <button
      onClick={onToggle}
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      className={`
        text-sm transition-colors leading-none
        ${
          isFavorite
            ? "text-amber-400"
            : "text-stone-600 hover:text-stone-400 text-[22px] pb-0.5"
        }
        ${className}
      `}
    >
      {icon}
    </button>
  );
}
