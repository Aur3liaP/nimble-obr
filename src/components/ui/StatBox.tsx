import { useState } from "react";
import type { Stats, SaveMods } from "../../types/character";

interface StatBoxProps {
  statKey: keyof Stats;
  value: number;
  saveAdvantage: "advantage" | "disadvantage" | "none";
  canEdit: boolean;
  isKeyStats?: boolean;
  onChange?: (key: keyof Stats, value: number) => void;
  onRoll?: (label: string, formula: string, saveAdv: "advantage" | "disadvantage" | "none") => void;
}

const STAT_LABELS: Record<keyof Stats, string> = { str: "STR", dex: "DEX", int: "INT", wil: "WIL" };
const STAT_FULL: Record<keyof Stats, string> = { str: "Strength", dex: "Dexterity", int: "Intelligence", wil: "Willpower" };

export function StatBox({ statKey, value, saveAdvantage, canEdit, isKeyStats = false, onChange, onRoll }: StatBoxProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(value));
  const displayBonus = value >= 0 ? `+${value}` : String(value);

  const commitEdit = () => {
    const parsed = parseInt(inputVal, 10);
    if (!isNaN(parsed) && parsed >= -5 && parsed <= 5) onChange?.(statKey, parsed);
    setIsEditing(false);
  };

  return (
    <div className={`relative flex flex-col items-center gap-1 p-2 rounded-lg border transition-all select-none ${
      isKeyStats
        ? "border-amber-500/50 bg-amber-950/30 shadow-amber-900/20 shadow-md"
        : "border-stone-700/60 bg-stone-900/40"
    }`}>
      {isKeyStats && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold tracking-widest text-amber-400 bg-stone-950 px-1 rounded uppercase">KEY</span>
      )}
      {saveAdvantage !== "none" && (
        <span className={`absolute top-1 right-1.5 text-[10px] font-bold ${saveAdvantage === "advantage" ? "text-emerald-400" : "text-rose-400"}`}
          title={`${saveAdvantage} on saves`}>
          {saveAdvantage === "advantage" ? "▲" : "▼"}
        </span>
      )}
      <span className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase">{STAT_LABELS[statKey]}</span>

      {isEditing ? (
        <input autoFocus type="number" min={-5} max={5} value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setIsEditing(false); }}
          className="w-12 text-center text-lg font-bold bg-stone-800 border border-amber-500 rounded text-amber-100 outline-none py-0.5"
        />
      ) : (
        <span
          onDoubleClick={() => { if (canEdit) { setInputVal(String(value)); setIsEditing(true); } }}
          className={`text-2xl font-bold tabular-nums leading-none ${isKeyStats ? "text-amber-300" : "text-stone-100"} ${canEdit ? "cursor-pointer" : ""}`}
          title={canEdit ? "Double-click to edit" : undefined}
        >
          {displayBonus}
        </span>
      )}

      <button onClick={() => onRoll?.(`${STAT_FULL[statKey]} Save`, `1d20+${value}`, saveAdvantage)}
        className="mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-stone-700/60 hover:bg-amber-900/60 text-stone-300 hover:text-amber-200 border border-stone-600/40 hover:border-amber-700/60 transition-all active:scale-95">
        SAVE
      </button>
    </div>
  );
}

interface StatGridProps {
  stats: Stats;
  saveMods: SaveMods;
  keyStats?: Array<keyof Stats>;
  canEdit: boolean;
  onStatChange?: (key: keyof Stats, value: number) => void;
  onRoll?: (label: string, formula: string, saveAdv: "advantage" | "disadvantage" | "none") => void;
}

export function StatGrid({ stats, saveMods, keyStats = [], canEdit, onStatChange, onRoll }: StatGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(["str", "dex", "int", "wil"] as Array<keyof Stats>).map((key) => (
        <StatBox key={key} statKey={key} value={stats[key]} saveAdvantage={saveMods[key]}
          canEdit={canEdit} isKeyStats={keyStats.includes(key)}
          onChange={onStatChange} onRoll={onRoll} />
      ))}
    </div>
  );
}
