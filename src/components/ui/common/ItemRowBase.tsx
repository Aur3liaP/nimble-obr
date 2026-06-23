/**
 * @file ItemRowBase — shared row layout for "an inventory item with a
 * name, optional roll formula, favorite toggle, and expandable
 * description".
 *
 * Before this component, `CombatTab.InventoryFavoriteRow` and
 * `InventoryTab.ItemRow` each implemented their own version of this same
 * row shape, which had started to drift slightly between the two (icon,
 * spacing, expand behavior). This is the common base both now build on:
 *
 * - `InventoryFavoriteRow` (CombatTab) uses it as-is: icon + name +
 *   formula + favorite + roll, expandable to a description-only panel.
 * - `ItemRow` (InventoryTab) wraps it with the additional quantity
 *   stepper and edit/delete affordances via `extraHeaderContent` and its
 *   own edit-mode panel rendered as `children` below the base row.
 *
 * This intentionally only covers the *read-only display* shell — the
 * inline edit form differs enough between contexts (Inventory needs
 * slots/armor flag, Combat favorites have no edit at all) that forcing
 * them into one mega-component would hurt readability more than the
 * duplication it removes.
 */

import type { ReactNode } from "react";
import { FavoriteButton } from "./FavoriteButton";
import { RollButton } from "./RollButton";
import { RowDescriptionPanel } from "./RowDescriptionPanel";

interface ItemRowBaseProps {
  /** Item/action name shown in bold. */
  name: string;
  /** Small emoji/icon shown before the name (e.g. "🎒", "🛡"). */
  icon?: string;
  /** Resolved or raw formula string shown in amber monospace, if any. */
  formula?: string;
  /** Description shown in the expanded panel. */
  description?: string;
  /** Whether the description panel is currently expanded. Omit to manage internally (uncontrolled). */
  isExpanded?: boolean;
  /** Called when the row body is clicked, to toggle expansion. Required if `isExpanded` is controlled. */
  onRowClick?: () => void;
  isFavorite: boolean;
  canEdit: boolean;
  onToggleFavorite?: () => void;
  /** Omit entirely (not just disable) to hide the roll button — e.g. items with no formula. */
  onRoll?: () => void;
  rollAccent?: "amber" | "violet" | "emerald";
  /** Extra controls rendered before the favorite/roll buttons (e.g. a quantity stepper). */
  extraHeaderContent?: ReactNode;
  /** Edit/delete buttons or other content for the description panel's action slot. */
  onEdit?: () => void;
  onDelete?: () => void;
  /** Extra content rendered below the base row entirely (e.g. an inline edit form), shown instead of the description panel when present. */
  editPanel?: ReactNode;
  className?: string;
}

/**
 * Renders one collapsible item/action row: icon + name + formula on the
 * left, optional extra controls + favorite + roll button on the right,
 * and an expandable description panel below.
 *
 * When `editPanel` is provided, it replaces the description panel
 * entirely (the caller is responsible for not setting both expanded
 * states at once — see `ItemRow`/`ActionRow`'s `isEditing` vs
 * `isExpanded` pattern).
 */
export function ItemRowBase({
  name,
  icon,
  formula,
  description,
  isExpanded = false,
  onRowClick,
  isFavorite,
  canEdit,
  onToggleFavorite,
  onRoll,
  rollAccent = "emerald",
  extraHeaderContent,
  onEdit,
  onDelete,
  editPanel,
  className = "",
}: ItemRowBaseProps) {
  return (
    <div
      className={`rounded-lg border overflow-hidden transition-colors ${
        editPanel
          ? "border-emerald-700/60 bg-emerald-950/10"
          : "border-stone-700/40 bg-stone-900/40"
      } ${className}`}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <div
          className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer"
          onClick={onRowClick}
        >
          {icon && <span className="shrink-0">{icon}</span>}
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-stone-200 truncate block">
              {name}
            </span>
            {formula && (
              <span className="text-[10px] font-mono text-amber-300/80">
                {formula}
              </span>
            )}
          </div>
        </div>

        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {extraHeaderContent}
          <FavoriteButton
            isFavorite={isFavorite}
            canEdit={canEdit}
            onToggle={onToggleFavorite}
          />
          {canEdit && onRoll && (
            <RollButton onClick={onRoll} accent={rollAccent} />
          )}
        </div>
      </div>

      {isExpanded && !editPanel && (
        <RowDescriptionPanel
          description={description}
          onEdit={canEdit ? onEdit : undefined}
          onDelete={onDelete}
          canEdit={canEdit}
        />
      )}

      {editPanel}
    </div>
  );
}
