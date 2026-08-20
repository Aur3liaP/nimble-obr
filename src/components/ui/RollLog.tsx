/**
 * @file Shared roll history display.
 *
 * Rendered in two modes from the same component:
 * - Inline (`inline` prop): a static list embedded in the page flow,
 *   used when no character sheet is open (no-token/no-sheet states,
 *   including the no-token "welcome" state shown on extension open and
 *   whenever the selection is cleared).
 * - Floating pill (default): a bottom-right collapsible popup showing the
 *   most recent roll, used whenever a character sheet is open.
 *
 * The GM sees every roll including hidden ones; players only see
 * non-hidden rolls (hidden rolls are never even sent to them — see
 * `useOBR.pushRollToLog` — but this component double-filters defensively).
 *
 * Also carries the Nimble 3rd Party Creator License v2.0 notices (see
 * {@link VTT_NOTICE}/{@link LICENSE_ATTRIBUTION_TEXT} below) — INLINE MODE
 * ONLY. They
 * used to live in a permanent `LicenseNotice` panel footer, which ate
 * vertical space on an already-cramped laptop screen; the license accepts
 * "a banner, sidebar, welcome message" as prominent placement, so they
 * moved here instead. They were briefly present in the floating popup too
 * (part 1c/1d), but that popup has no room for a full paragraph plus an
 * attribution line without becoming awkward, and the notice is already
 * prominent in the inline (welcome-state) rendering — which recurs on
 * every deselection, not a one-time dismissal, so it stays genuinely
 * reachable without needing to also live in the popup. Present from the
 * empty state onward in inline mode; neither notice is dismissible, and
 * neither scrolls away with roll entries — inline mode has no independent
 * scroll container of its own (the page itself scrolls), so the notices
 * simply sit as the first/last items in the flex column, structurally
 * unable to be interleaved with entries in between.
 */
import { useState } from "react";
import type { DiceRollResult } from "../../types/character";
import { formatModifier } from "../../utils/formatModifier";

/**
 * The license's required VTT/app notice, verbatim. Pinned at the top of
 * the roll log in inline mode only (see the @file header for why) — never
 * dismissible, never scrolled away.
 */
const VTT_NOTICE =
  "This app is free to use for anyone who already owns the content, is trying the system out, or cannot afford to buy it right now. If you enjoy Nimble and are able, please support the game by purchasing the official content at nimbleRPG.com.";

/**
 * The license's required attribution line, verbatim. Small and muted, at
 * the foot of the roll log panel only (not across the whole sheet).
 */
const LICENSE_ATTRIBUTION_TEXT =
  "Nimble OBR is an independent product published under the Nimble 3rd Party Creator License. Nimble TTRPG (c) Nimble Co.";

/** Pinned, non-dismissible VTT notice — see {@link VTT_NOTICE}. */
function VttNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[9px] leading-snug text-stone-500 ${className}`}>
      {VTT_NOTICE}
    </p>
  );
}

/**
 * Small muted attribution line — see {@link LICENSE_ATTRIBUTION_TEXT}.
 * Named `LicenseAttribution`, not the previous plain `Attribution` — that
 * name said nothing about WHAT it's attributing (attribution of what, to
 * whom?) and read as a generic UI-credits component to a reader who
 * hadn't just read this file's @file header.
 */
function LicenseAttribution({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[8px] leading-snug text-stone-600 ${className}`}>
      {LICENSE_ATTRIBUTION_TEXT}
    </p>
  );
}

/**
 * @property rolls - Full roll history (already capped upstream, but re-sliced here defensively).
 * @property isGM - Whether the current player is the GM (controls hidden-roll visibility and the "· hidden" tag).
 * @property currentPlayerId - Used to highlight the current player's own rolls.
 * @property inline - Renders as a static inline list instead of the floating pill popup.
 */
interface RollLogProps {
  rolls: DiceRollResult[];
  isGM: boolean;
  currentPlayerId: string;
  inline?: boolean;
}

/** Formats a roll timestamp as a zero-padded 24h `HH:MM` string. */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Displays the shared dice roll history for the table. In `inline` mode,
 * also carries the pinned license notices (see the @file header) — the
 * floating pill does not.
 *
 * In `inline` mode, renders a plain labeled list (used in the no-token/
 * no-sheet states, including the no-token "welcome" state, where there's
 * no floating pill anchor point). Otherwise, renders a collapsible
 * floating pill in the bottom-right corner: it always renders (never
 * `null`, even with zero rolls) so there's a consistent affordance for
 * "here's where rolls will show up" from the very first load.
 */
export function RollLog({
  rolls,
  isGM,
  currentPlayerId,
  inline = false,
}: RollLogProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Players only see non-hidden rolls; GM sees everything
  const visible = (isGM ? rolls : rolls.filter((r) => !r.hidden)).slice(-20);
  const last = visible[visible.length - 1] as DiceRollResult | undefined;

  if (inline) {
    return (
      // flex-1 min-h-0 here, NOT a min-height floor (min-h-56, tried in
      // part 1e, and mt-auto before that in part 1c/1d) — those were leaf-
      // level fixes for a parent-chain problem. This div's own ancestor
      // chain (the DicePanel/RollLog wrapper in App.tsx, then <main>
      // itself) needs a constrained height for this div to grow into:
      // <main> is a flex ITEM of the panel root (correctly constrained
      // itself) but must ALSO be a flex CONTAINER for its own children —
      // see the comment on <main> in App.tsx for the full chain. Inline
      // mode only ever renders in the no-sheet states (see the call site
      // in App.tsx), and as of part 1h that's exactly the one state where
      // <main> and the wrapper above THIS div are still flex-chained this
      // way; the sheet-open case deliberately is NOT (plain block flow, so
      // DicePanel scrolls with the sheet per the Panel layout contract in
      // CLAUDE.md) but inline RollLog never renders there anyway, so this
      // div's own flex-1 always has a real chain to grow into. Once that
      // chain holds, THIS div can just ask for its fair share (`flex-1`)
      // of real, available space, and the entries area below (already
      // `flex-1` since part 1e) does the same one level down, pushing the
      // license attribution to a genuine bottom edge instead of guessing
      // at a fixed floor.
      <div className="flex flex-col gap-2 flex-1 min-h-0">
        <VttNotice />
        <p className="bento-label">Roll History</p>
        {/* min-h-0 + overflow-y-auto (part 1g): without these, this div's
            flex-1 could only ever GROW to fill leftover space, never
            SHRINK below its content — so once an entry was added (this
            list is newest-first, see the .reverse() below), its natural
            content height could exceed what's actually available in the
            no-token welcome state (free-roll grid + license notice already
            fill a typical laptop panel height with zero entries), pushing
            the whole panel taller than the viewport. <main>'s own
            overflow-y-auto then made the PAGE scroll to reveal it — the
            roll "landed below the fold". Bounding this div and letting it
            scroll INTERNALLY instead fixes it structurally: the newest
            roll is always the first item, so it's visible the instant it
            lands, with no scrolling at all, regardless of how many older
            entries are pushed below it inside this now-self-contained
            region. */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
          {visible.length === 0 ? (
            <p className="text-xs text-stone-600 italic text-center py-6">
              No rolls yet at this table.
            </p>
          ) : (
            [...visible].reverse().map((roll, i) => (
              <RollEntry
                key={i}
                roll={roll}
                isMine={roll.playerId === currentPlayerId}
                isGM={isGM}
              />
            ))
          )}
        </div>
        <LicenseAttribution className="text-center pt-1 border-t border-stone-800" />
      </div>
    );
  }

  return (
    <div className="absolute bottom-3 right-3 z-40 flex flex-col items-end gap-1">
      {isOpen && (
        <div className="w-64 max-h-80 flex flex-col rounded-xl border border-stone-700 bg-stone-950/95 shadow-2xl shadow-black/60 backdrop-blur-sm overflow-hidden">
          <div className="shrink-0 bg-stone-900 px-3 py-2 border-b border-stone-700 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-widest text-stone-400 uppercase">
              Roll History
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-stone-500 hover:text-stone-300 text-xs"
            >
              ✕
            </button>
          </div>

          {/* No license notices here — see the @file header for why: not
              enough room for the full paragraph plus attribution without
              the popup becoming awkward, and the inline (welcome-state)
              rendering already keeps them genuinely reachable. Just the
              scrollable entries list, capped at max-h-80. */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1.5">
            {visible.length === 0 ? (
              <p className="text-xs text-stone-600 italic text-center py-6">
                No rolls yet at this table.
              </p>
            ) : (
              [...visible].reverse().map((roll, i) => (
                <RollEntry
                  key={i}
                  roll={roll}
                  isMine={roll.playerId === currentPlayerId}
                  isGM={isGM}
                />
              ))
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-lg text-xs font-bold transition-all ${
          last?.isCritical
            ? "border-amber-500 bg-amber-900/80 text-amber-200"
            : last?.isFumble
              ? "border-rose-700 bg-rose-950/80 text-rose-300"
              : "border-stone-700 bg-stone-900/90 text-stone-200"
        }`}
      >
        <span>🎲</span>
        {last ? (
          <>
            <span className="max-w-25 truncate">{last.label}</span>
            <span
              className={`text-base font-black ${last.isCritical ? "text-amber-300" : last.isFumble ? "text-rose-400" : "text-white"}`}
            >
              {last.total}
            </span>
            {last.isCritical && <span className="text-amber-400">⚡</span>}
            {last.isFumble && <span className="text-rose-400">💀</span>}
            {last.hidden && <span className="text-stone-400">👁</span>}
          </>
        ) : (
          <span className="text-stone-400">Roll Log</span>
        )}
      </button>
    </div>
  );
}

/**
 * One entry in the roll history list: label, total (with critical/fumble
 * styling), the individual dice results (with kept-vs-dropped dice
 * visually distinguished when advantage/disadvantage discarded some),
 * the flat modifier, and the player name/timestamp.
 *
 * @param roll - The roll result to render.
 * @param isMine - Whether this roll belongs to the current player (slightly different background).
 * @param isGM - Whether to show the "· hidden" tag for hidden rolls.
 */
function RollEntry({
  roll,
  isMine,
  isGM,
}: {
  roll: DiceRollResult;
  isMine: boolean;
  isGM: boolean;
}) {
  return (
    <div
      className={`px-2.5 py-1.5 rounded-lg text-xs ${isMine ? "bg-stone-800/80" : "bg-stone-900/60"} border ${
        roll.isCritical
          ? "border-amber-700/60"
          : roll.isFumble
            ? "border-rose-800/60"
            : "border-stone-700/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-stone-300 truncate max-w-35>">
          {roll.label}
        </span>
        <span
          className={`font-black text-sm ml-1 ${roll.isCritical ? "text-amber-300" : roll.isFumble ? "text-rose-400" : "text-white"}`}
        >
          {roll.total}
          {roll.isCritical ? " ⚡" : roll.isFumble ? " 💀" : ""}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
        {roll.rolls.length > roll.kept.length ? (
          (() => {
            const keptCopy = [...roll.kept];
            const isKept = roll.rolls.map((v) => {
              const idx = keptCopy.indexOf(v);
              if (idx !== -1) {
                keptCopy.splice(idx, 1);
                return true;
              }
              return false;
            });
            return (
              <span className="font-mono text-[10px]">
                [
                {roll.rolls.map((d, i) => (
                  <span
                    key={i}
                    className={
                      isKept[i] ? "text-amber-200 font-bold" : "text-stone-600"
                    }
                  >
                    {i > 0 && ", "}
                    {d}
                  </span>
                ))}
                ]
              </span>
            );
          })()
        ) : (
          <span className="text-stone-500 font-mono text-[10px]">
            [{roll.kept.join(", ")}]
          </span>
        )}
        {roll.modifier !== 0 && (
          <span className="text-stone-400 text-[10px]">
            {formatModifier(roll.modifier)}
          </span>
        )}
      </div>
      {/* Player name + time */}
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-stone-400 text-[10px] font-medium">{roll.playerName}</span>
        <span className="text-stone-500 text-[10px]">·</span>
        <span className="text-stone-500 text-[10px]">
          {formatTime(roll.timestamp)}
        </span>
        {roll.hidden && isGM && (
          <span className="text-stone-500 italic text-[10px]">· hidden</span>
        )}
      </div>
    </div>
  );
}
