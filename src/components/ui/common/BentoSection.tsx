/**
 * BentoSection — bento-card with an optional label row and an action slot.
 *
 * Replaces the recurring pattern:
 *   <div className="bento-card">
 *     <div className="flex items-center justify-between mb-2">
 *       <p className="bento-label">Title</p>
 *       <button>+ Add</button>
 *     </div>
 *     {children}
 *   </div>
 *
 * Props
 * ─────
 * label      — section heading (bento-label style). Omit to skip the header row.
 * action     — ReactNode placed on the right of the label (e.g. an "+ Add" button)
 * className  — extra classes forwarded to the card wrapper
 * children   — card body
 */

import type { ReactNode } from "react";

interface BentoSectionProps {
  label?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function BentoSection({ label, action, className = "", children }: BentoSectionProps) {
  return (
    <div className={`bento-card ${className}`}>
      {(label || action) && (
        <div className={`flex items-center justify-between ${label || action ? "mb-2" : ""}`}>
          {label && <p className="bento-label">{label}</p>}
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
