/**
 * @file SwitchKindButton — the small round GM-only button that toggles a
 * sheet between player and monster mode.
 *
 * Rendered by `App.tsx` via `RollLog`'s own `extraAction` prop — i.e.
 * INSIDE the roll-log pill's own absolutely-positioned container, on the
 * same row as the pill button itself (see `RollLog.tsx`'s `extraAction`
 * doc). Three earlier placements were each tried and rejected first:
 * absolutely positioned as a second, independent floating element near the
 * pill (never reliably aligned with it — two separate positioning systems,
 * no margin adjustment on either one converges them); inside the header
 * badge row (read as part of the character summary, not its own action);
 * and as a new in-flow sibling elsewhere in the panel, tuned with a
 * clearance margin to avoid the pill (same "two systems, one adjusted by
 * guesswork" problem as the first attempt, just with one side in-flow
 * instead of both absolute). This component itself has no `position` of
 * its own regardless of where it's placed — that property was never the
 * problem; sharing the pill's own container is what actually fixed it.
 *
 * The icon shows the DESTINATION, not the current state — matching what
 * the tooltip already says. A monster-head icon while a MONSTER sheet is
 * open would describe where the sheet already is, not what clicking the
 * button does.
 */

import { MonsterIcon } from "./icons/MonsterIcon";

interface SwitchKindButtonProps {
  /** What clicking this button switches TO — drives both the icon and the tooltip/aria-label. */
  targetKind: "player" | "monster";
  onClick: () => void;
}

export function SwitchKindButton({ targetKind, onClick }: SwitchKindButtonProps) {
  const label = targetKind === "monster" ? "Switch to monster sheet" : "Switch to player sheet";

  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex items-center justify-center w-10 h-10 rounded-full border border-stone-700 bg-stone-800/80 hover:bg-stone-700 transition-colors shrink-0 cursor-pointer"
    >
      {targetKind === "monster" ? (
        <MonsterIcon className="w-8 h-8 text-red-900" />
      ) : (
        // No dedicated "player/hero" icon asset exists — a plain glyph is
        // enough here, the tooltip carries the actual meaning either way.
        <span className="text-xl leading-none" aria-hidden="true">
          👤
        </span>
      )}
    </button>
  );
}
