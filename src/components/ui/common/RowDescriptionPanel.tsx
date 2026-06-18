/**
 * RowDescriptionPanel — the expandable description panel shared by
 * ActionRow, SpellRow, ItemRow, and InventoryFavoriteRow.
 *
 * Renders the description text on the left and RowActions (edit/delete) on
 * the right. For favorites, simply omit onEdit/onDelete — RowActions then
 * renders nothing on that side, so the panel becomes description-only.
 *
 * Props
 * ─────
 * description — text shown (falls back to an italic "No description.")
 * onEdit      — optional, shows ✏️ (only if canEdit)
 * onDelete    — optional, shows 🗑️
 * canEdit     — gates the edit button
 */

import { RowActions } from "./RowActions";

interface RowDescriptionPanelProps {
  description?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
}

export function RowDescriptionPanel({
  description,
  onEdit,
  onDelete,
  canEdit = false,
}: RowDescriptionPanelProps) {
  return (
    <div className="px-3 pb-2.5 border-t border-stone-700/40 pt-2 flex justify-between items-start gap-2">
      <p className="text-xs text-stone-400 leading-relaxed flex-1">
        {description || <span className="italic text-stone-600">No description.</span>}
      </p>
      <RowActions onEdit={onEdit} onDelete={onDelete} canEdit={canEdit} />
    </div>
  );
}
