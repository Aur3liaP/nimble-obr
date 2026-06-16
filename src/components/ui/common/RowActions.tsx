/**
 * RowActions — small icon buttons for row-level actions.
 *
 * Used in: SpellRow (desc panel), ItemRow (desc panel).
 * Renders ✏️ edit and/or 🗑️ delete buttons; each is optional.
 *
 * Props
 * ─────
 * onEdit    — if provided, renders the ✏️ button (requires canEdit)
 * onDelete  — if provided, renders the 🗑️ button
 * canEdit   — gates the edit button (delete is always shown if onDelete given)
 * extra     — optional ReactNode rendered before the icon buttons
 */

import type { ReactNode } from "react";

const ICON_BTN =
  "w-6 h-6 flex items-center justify-center rounded transition-all " +
  "text-stone-500 hover:text-stone-300 hover:bg-stone-700/60";

interface RowActionsProps {
  onEdit?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  extra?: ReactNode;
}

export function RowActions({ onEdit, onDelete, canEdit = true, extra }: RowActionsProps) {
  if (!onEdit && !onDelete && !extra) return null;

  return (
    <div className="flex items-center gap-1 shrink-0">
      {extra}
      {canEdit && onEdit && (
        <button onClick={onEdit} title="Edit" className={ICON_BTN}>
          ✏️
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} title="Remove" className={ICON_BTN}>
          🗑️
        </button>
      )}
    </div>
  );
}

/**
 * TextAction — a tiny text link button (e.g. "Remove spell", "Delete").
 * Used at the bottom of edit panels.
 */
interface TextActionProps {
  onClick: () => void;
  label: string;
  variant?: "danger" | "neutral" | "confirm";
}

const TEXT_STYLES = {
  danger:  "text-rose-500 hover:text-rose-400",
  neutral: "text-stone-500 hover:text-stone-300",
  confirm: "rounded px-2 py-1 text-xs bg-stone-700/60 border border-stone-600 text-stone-300 hover:bg-stone-600",
};

export function TextAction({ onClick, label, variant = "neutral" }: TextActionProps) {
  return (
    <button onClick={onClick} className={`text-[10px] transition-colors ${TEXT_STYLES[variant]}`}>
      {label}
    </button>
  );
}
