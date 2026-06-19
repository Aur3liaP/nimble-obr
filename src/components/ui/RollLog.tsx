/**
 * @file Shared roll history display.
 *
 * Rendered in two modes from the same component:
 * - Inline (`inline` prop): a static list embedded in the page flow,
 *   used when no character sheet is open (no-token/no-sheet states).
 * - Floating pill (default): a bottom-right collapsible popup showing the
 *   most recent roll, used whenever a character sheet is open.
 *
 * The GM sees every roll including hidden ones; players only see
 * non-hidden rolls (hidden rolls are never even sent to them — see
 * `useOBR.pushRollToLog` — but this component double-filters defensively).
 */
import { useState } from "react";
import type { DiceRollResult } from "../../types/character";

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
 * Displays the shared dice roll history for the table.
 *
 * In `inline` mode, renders a plain labeled list (used in the no-token/
 * no-sheet states where there's no floating pill anchor point). Otherwise,
 * renders a collapsible floating pill in the bottom-right corner showing
 * the latest roll's label/total/critical/fumble/hidden status, which
 * expands into the full scrollable history on click.
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

  if (inline) {
    return (
      <div className="flex flex-col gap-2">
        <p className="bento-label">Roll History</p>
        {visible.length === 0 ? (
          <p className="text-xs text-stone-600 italic text-center py-6">
            No rolls yet at this table.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {[...visible].reverse().map((roll, i) => (
              <RollEntry
                key={i}
                roll={roll}
                isMine={roll.playerId === currentPlayerId}
                isGM={isGM}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (visible.length === 0) return null;
  const last = visible[visible.length - 1];

  return (
    <div className="absolute bottom-3 right-3 z-40 flex flex-col items-end gap-1">
      {isOpen && (
        <div className="w-64 max-h-52 overflow-y-auto rounded-xl border border-stone-700 bg-stone-950/95 shadow-2xl shadow-black/60 backdrop-blur-sm">
          <div className="sticky top-0 bg-stone-900 px-3 py-2 border-b border-stone-700 flex items-center justify-between">
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
          <div className="p-2 flex flex-col gap-1.5">
            {[...visible].reverse().map((roll, i) => (
              <RollEntry
                key={i}
                roll={roll}
                isMine={roll.playerId === currentPlayerId}
                isGM={isGM}
              />
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-lg text-xs font-bold transition-all ${
          last.isCritical
            ? "border-amber-500 bg-amber-900/80 text-amber-200"
            : last.isFumble
              ? "border-rose-700 bg-rose-950/80 text-rose-300"
              : "border-stone-700 bg-stone-900/90 text-stone-200"
        }`}
      >
        <span>🎲</span>
        <span className="max-w-25 truncate">{last.label}</span>
        <span
          className={`text-base font-black ${last.isCritical ? "text-amber-300" : last.isFumble ? "text-rose-400" : "text-white"}`}
        >
          {last.total}
        </span>
        {last.isCritical && <span className="text-amber-400">⚡</span>}
        {last.isFumble && <span className="text-rose-400">💀</span>}
        {last.hidden && <span className="text-stone-400">👁</span>}
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
            {roll.modifier > 0 ? "+" : ""}
            {roll.modifier}
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
