/**
 * @file RowActions — small icon buttons for row-level edit/delete actions,
 * plus TextAction, a tiny text-link button used at the bottom of inline
 * edit panels.
 *
 * Used in SpellRow and ItemRow's expanded description panels (RowActions),
 * and in their inline edit panels (TextAction, for "Remove spell/item" and "OK").
 */

import type { ReactNode } from "react";

const ICON_BTN =
  "w-6 h-6 flex items-center justify-center rounded transition-all " +
  "text-stone-500 hover:text-stone-300 hover:bg-stone-700/60";

/**
 * @property onEdit - If provided, renders the ✏️ button (still gated by `canEdit`).
 * @property onDelete - If provided, renders the 🗑️ button (always shown regardless of `canEdit` when provided — callers should omit it for read-only viewers if delete shouldn't be available).
 * @property canEdit - Gates the edit button only; delete is shown whenever `onDelete` is passed.
 * @property extra - Optional node rendered before the icon buttons.
 */
interface RowActionsProps {
  onEdit?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  extra?: ReactNode;
}

/**
 * Renders ✏️ edit and/or 🗑️ delete icon buttons based on which callbacks
 * are provided. Returns `null` entirely if none of `onEdit`, `onDelete`,
 * or `extra` are given, so callers can render it unconditionally.
 */
export function RowActions({
  onEdit,
  onDelete,
  canEdit = true,
  extra,
}: RowActionsProps) {
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
 * @property onClick - Called when the link is clicked.
 * @property label - Link text.
 * @property variant - Visual style: "danger" (destructive, e.g. delete), "neutral" (default), or "confirm" (pill-style, e.g. "OK").
 */
interface TextActionProps {
  onClick: () => void;
  label: string;
  variant?: "danger" | "neutral" | "confirm";
}

/** Tailwind classes per `TextAction` variant. */
const TEXT_STYLES = {
  danger: "text-rose-500 hover:text-rose-400",
  neutral: "text-stone-500 hover:text-stone-300",
  confirm:
    "rounded px-2 py-1 text-xs bg-stone-700/60 border border-stone-600 text-stone-300 hover:bg-stone-600",
};

/** Renders a small text-only action link, styled per `variant`. Used at the bottom of inline edit panels for destructive or confirming actions. */
export function TextAction({
  onClick,
  label,
  variant = "neutral",
}: TextActionProps) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] transition-colors ${TEXT_STYLES[variant]}`}
    >
      {label}
    </button>
  );
}
