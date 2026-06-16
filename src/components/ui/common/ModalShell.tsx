/**
 * ModalShell — Generic modal wrapper used by all add/edit modals.
 *
 * Props
 * ─────
 * title        — bold header text
 * accent       — Tailwind color key for the header text + border:
 *                "amber" | "violet" | "emerald" | "sky" | "rose"
 * onClose      — called when the backdrop is clicked
 * headerExtra  — optional slot rendered below the title (e.g. mode tabs)
 * footer       — optional slot for action buttons at the bottom
 * maxWidth     — optional Tailwind max-w class (default "max-w-sm")
 * maxHeight    — optional Tailwind max-h class (default "max-h-[85vh]")
 * children     — scrollable body content
 */

import type { ReactNode } from "react";

type AccentColor = "amber" | "violet" | "emerald" | "sky" | "rose";

const ACCENT_TITLE: Record<AccentColor, string> = {
  amber:   "text-amber-200",
  violet:  "text-violet-300",
  emerald: "text-emerald-300",
  sky:     "text-sky-300",
  rose:    "text-rose-300",
};

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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
          <h3 className={`text-sm font-bold ${ACCENT_TITLE[accent]}`}>{title}</h3>
          {headerExtra && <div className="mt-2">{headerExtra}</div>}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {children}
        </div>

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
