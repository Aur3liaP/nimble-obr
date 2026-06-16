/**
 * FavoriteButton — star toggle ⭐ / ☆.
 *
 * Used in: CombatTab (ActionRow, InventoryFavoriteRow),
 *          SpellsTab (SpellRow), InventoryTab (ItemRow).
 *
 * When `canEdit` is false the button renders as a plain span (no interaction).
 *
 * Props
 * ─────
 * isFavorite  — current state
 * canEdit     — if false, renders read-only
 * onToggle    — called on click (only when canEdit)
 * className   — extra classes
 */

interface FavoriteButtonProps {
  isFavorite: boolean;
  canEdit?: boolean;
  onToggle?: () => void;
  className?: string;
}

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
        ${isFavorite
          ? "text-amber-400"
          : "text-stone-600 hover:text-stone-400 text-[22px] pb-0.5"}
        ${className}
      `}
    >
      {icon}
    </button>
  );
}
