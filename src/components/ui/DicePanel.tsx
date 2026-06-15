/**
 * DicePanel – Quick dice roller available to everyone (players + GM).
 * Shows standard dice buttons with advantage/disadvantage options.
 * Sits above the roll log in the "no token" view AND as a collapsible
 * section in the main sheet view.
 */

import { useState } from "react";
import type { DiceRollRequest, RollMode } from "../../types/character";

interface DicePanelProps {
  isGM?: boolean;
  playerName: string;
  onRoll: (req: DiceRollRequest) => void;
  collapsed?: boolean;
}

type DieOption = { sides: number; label: string; color: string; bg: string; border: string };

const DICE: DieOption[] = [
  { sides: 4,   label: "d4",   color: "text-pink-300",   bg: "bg-pink-950/40",   border: "border-pink-800/60" },
  { sides: 6,   label: "d6",   color: "text-orange-300", bg: "bg-orange-950/40", border: "border-orange-800/60" },
  { sides: 8,   label: "d8",   color: "text-amber-300",  bg: "bg-amber-950/40",  border: "border-amber-800/60" },
  { sides: 10,  label: "d10",  color: "text-yellow-300", bg: "bg-yellow-950/40", border: "border-yellow-800/60" },
  { sides: 12,  label: "d12",  color: "text-lime-300",   bg: "bg-lime-950/40",   border: "border-lime-800/60" },
  { sides: 20,  label: "d20",  color: "text-emerald-300",bg: "bg-emerald-950/40",border: "border-emerald-800/60" },
  { sides: 100, label: "d100", color: "text-sky-300",    bg: "bg-sky-950/40",    border: "border-sky-800/60" },
];

export function DicePanel({ isGM = false, playerName, onRoll, collapsed: initialCollapsed = false }: DicePanelProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mode, setMode] = useState<RollMode>("standard");
  const [extraCount, setExtraCount] = useState(1);
  const [modifier, setModifier] = useState(0);
  const [count, setCount] = useState(1);
  const [hidden, setHidden] = useState(false);

  const handleRoll = (die: DieOption) => {
    const formula = count > 1
      ? `${count}d${die.sides}${modifier !== 0 ? (modifier > 0 ? `+${modifier}` : modifier) : ""}`
      : `1d${die.sides}${modifier !== 0 ? (modifier > 0 ? `+${modifier}` : modifier) : ""}`;

    onRoll({
      label: `${playerName} — ${count > 1 ? count : ""}${die.label}${modifier !== 0 ? (modifier > 0 ? `+${modifier}` : modifier) : ""}`,
      formula,
      mode,
      advantageCount: mode === "standard" ? 0 : extraCount,
      hidden: isGM ? hidden : false,
    });
  };

  return (
    <div className="rounded-xl border border-stone-700/60 bg-stone-900/50 overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-stone-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">🎲</span>
          <span className="text-xs font-semibold uppercase tracking-widest text-stone-400">
            Free Roll
          </span>
        </div>
        <span className="text-stone-500 text-xs">{collapsed ? "▸" : "▾"}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 flex flex-col gap-3 border-t border-stone-800">

          {/* Dice grid */}
          <div className="grid grid-cols-4 gap-1.5 pt-2">
            {DICE.map((die) => (
              <button
                key={die.sides}
                onClick={() => handleRoll(die)}
                className={`
                  flex flex-col items-center py-2 rounded-lg border font-bold text-xs
                  transition-all active:scale-95 hover:brightness-125
                  ${die.color} ${die.bg} ${die.border}
                `}
              >
                <span className="text-base leading-none">{dieFace(die.sides)}</span>
                <span className="mt-1 text-[10px]">{die.label}</span>
              </button>
            ))}
          </div>

          {/* Count + Modifier row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-stone-500 uppercase">Dice</span>
              <button
                onClick={() => setCount(Math.max(1, count - 1))}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600"
              >−</button>
              <span className="text-xs font-bold text-stone-200 w-4 text-center">{count}</span>
              <button
                onClick={() => setCount(Math.min(10, count + 1))}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600"
              >+</button>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-stone-500 uppercase">Mod</span>
              <button
                onClick={() => setModifier(modifier - 1)}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600"
              >−</button>
              <span className={`text-xs font-bold w-6 text-center ${modifier > 0 ? "text-emerald-300" : modifier < 0 ? "text-rose-300" : "text-stone-400"}`}>
                {modifier > 0 ? `+${modifier}` : modifier}
              </span>
              <button
                onClick={() => setModifier(modifier + 1)}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600"
              >+</button>
            </div>
          </div>

          {/* Mode selector */}
          <div className="flex gap-1.5">
            {(["standard", "advantage", "disadvantage"] as RollMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`
                  flex-1 py-1.5 px-1 rounded-lg text-[10px] font-semibold border transition-all
                  ${mode === m
                    ? m === "advantage"
                      ? "border-emerald-500 bg-emerald-900/50 text-emerald-300"
                      : m === "disadvantage"
                      ? "border-rose-500 bg-rose-900/50 text-rose-300"
                      : "border-amber-500 bg-amber-900/50 text-amber-300"
                    : "border-stone-700 bg-stone-800/50 text-stone-400 hover:border-stone-500"
                  }
                `}
              >
                {m === "standard" ? "⬡ Std" : m === "advantage" ? "▲ Adv." : "▼ Dis."}
              </button>
            ))}
          </div>

          {/* Extra dice count (adv/disadv only) */}
          {mode !== "standard" && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-stone-500">Extra dice:</span>
              <button
                onClick={() => setExtraCount(Math.max(1, extraCount - 1))}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600"
              >−</button>
              <span className="text-xs font-bold text-stone-200 w-4 text-center">{extraCount}</span>
              <button
                onClick={() => setExtraCount(Math.min(5, extraCount + 1))}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600"
              >+</button>
              <span className="text-[10px] text-stone-500">
                {mode === "advantage" ? "keep highest" : "keep lowest"}
              </span>
            </div>
          )}

          {/* Hidden roll — GM only */}
          {isGM && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
                className="accent-amber-500"
              />
              <span className="text-[10px] text-stone-300">Hidden roll (GM only)</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** Simple ASCII die face per die type */
function dieFace(sides: number): string {
  const faces: Record<number, string> = {
    4: "△",
    6: "⬡",
    8: "◇",
    10: "⬟",
    12: "⬠",
    20: "⬣",
    100: "%",
  };
  return faces[sides] ?? "◻";
}
