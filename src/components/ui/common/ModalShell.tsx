/**
 * @file ModalShell — generic backdrop + card wrapper used by every
 * add/edit modal in the app (AddSpellModal, AddItemModal, AddActionModal,
 * DiceRollModal).
 *
 * Provides a consistent header (title + accent color + optional extra
 * content like mode tabs), a scrollable body, and an optional footer for
 * action buttons. Clicking the backdrop (not the card itself) calls `onClose`.
 */

import type { ReactNode } from "react";

/** Available header accent colors, chosen per modal to match its parent tab's theme. */
type AccentColor = "amber" | "violet" | "emerald" | "sky" | "rose";

/** Tailwind text color class per accent, applied to the modal title. */
const ACCENT_TITLE: Record<AccentColor, string> = {
  amber: "text-amber-200",
  violet: "text-violet-300",
  emerald: "text-emerald-300",
  sky: "text-sky-300",
  rose: "text-rose-300",
};

/**
 * @property title - Bold header text.
 * @property accent - Header title color theme, defaults to "amber".
 * @property onClose - Called when the backdrop (outside the card) is clicked.
 * @property headerExtra - Optional content rendered below the title (e.g. mode tabs).
 * @property footer - Optional content rendered in a bordered footer area (e.g. action buttons).
 * @property maxWidth - Tailwind max-width class for the card, defaults to "max-w-sm".
 * @property maxHeight - Tailwind max-height class for the card, defaults to "max-h-[85vh]".
 * @property children - Scrollable body content.
 */
interface ModalShellProps {
  title: string;
  accent?: AccentColor;
  onClose: () => void;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
  maxHeight?: string;
  children: ReactNode;
}

/**
 * Renders a centered modal card over a blurred backdrop, with a header
 * (title + optional extra content), a scrollable body, and an optional
 * footer. The backdrop click-to-close only fires when the click target is
 * the backdrop itself, not a bubbled click from inside the card.
 */
export function ModalShell({
  title,
  accent = "amber",
  onClose,
  headerExtra,
  footer,
  maxWidth = "max-w-sm",
  maxHeight = "max-h-[85vh]",
  children,
}: ModalShellProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`
          w-full ${maxWidth} ${maxHeight}
          rounded-xl border border-stone-700 bg-stone-900 shadow-2xl shadow-black/60
          overflow-hidden flex flex-col
        `}
      >
        {/* Header */}
        <div className="shrink-0 bg-stone-800 px-4 py-3 border-b border-stone-700">
          <h3 className={`text-sm font-bold ${ACCENT_TITLE[accent]}`}>
            {title}
          </h3>
          {headerExtra && <div className="mt-2">{headerExtra}</div>}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="shrink-0 px-4 py-3 border-t border-stone-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
