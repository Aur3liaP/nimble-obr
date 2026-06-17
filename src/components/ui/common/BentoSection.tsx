/**
 * @file BentoSection — card with an optional label row and an action slot.
 *
 * Replaces the recurring pattern:
 * ```tsx
 * <div className="bento-card">
 *   <div className="flex items-center justify-between mb-2">
 *     <p className="bento-label">Title</p>
 *     <button>+ Add</button>
 *   </div>
 *   {children}
 * </div>
 * ```
 */

import type { ReactNode } from "react";

/**
 * @property label - Section heading (bento-label style). Omit to skip the header row entirely.
 * @property action - Node placed on the right of the label (e.g. an "+ Add" button).
 * @property className - Extra classes forwarded to the card wrapper.
 * @property children - Card body content.
 */
interface BentoSectionProps {
  label?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps `children` in the standard `.bento-card` styling, with an optional
 * header row showing a label and/or an action element. The header row is
 * omitted entirely when neither `label` nor `action` is provided.
 */
export function BentoSection({
  label,
  action,
  className = "",
  children,
}: BentoSectionProps) {
  return (
    <div className={`bento-card ${className}`}>
      {(label || action) && (
        <div
          className={`flex items-center justify-between ${label || action ? "mb-2" : ""}`}
        >
          {label && <p className="bento-label">{label}</p>}
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
