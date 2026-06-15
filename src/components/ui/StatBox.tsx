import { useState } from "react";
import type { Stats, SaveMods } from "../../types/character";

interface StatBoxProps {
  statKey: keyof Stats;
  value: number;
  saveAdvantage: "advantage" | "disadvantage" | "none";
  canEdit: boolean;
  status?: "none" | "key" | "flaw";
  onChange?: (key: keyof Stats, value: number) => void;
  onRoll?: (label: string, formula: string, saveAdv: "advantage" | "disadvantage" | "none") => void;
  onStatusChange? : (statkey: keyof Stats, newStatus: "key" | "flaw" | "none") => void
}

const STAT_LABELS: Record<keyof Stats, string> = { str: "STR", dex: "DEX", int: "INT", wil: "WIL" };
const STAT_FULL: Record<keyof Stats, string> = { str: "Strength", dex: "Dexterity", int: "Intelligence", wil: "Willpower" };

export function StatBox({ statKey, value, saveAdvantage, canEdit, status = "none", onChange, onRoll, onStatusChange }: StatBoxProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(value));
  const displayBonus = value >= 0 ? `+${value}` : String(value);

  const commitEdit = () => {
    const parsed = parseInt(inputVal, 10);
    if (!isNaN(parsed) && parsed >= -5 && parsed <= 5) onChange?.(statKey, parsed);
    setIsEditing(false);
  };

  return (
    <div className={`relative flex flex-col items-center gap-1 p-2 rounded-lg border border-stone-700/60 bg-stone-900/40 transition-all select-none`}>
      {saveAdvantage !== "none" && (
        <span
          className={`absolute top-1 right-1.5 text-[10px] font-bold ${saveAdvantage === "advantage" ? "text-emerald-400" : "text-rose-400"}`}
          title={`${saveAdvantage} on saves`}
        >
          {saveAdvantage === "advantage" ? "▲" : "▼"}
        </span>
      )}

      <span className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase">{STAT_LABELS[statKey]}</span>

      {isEditing ? (
        <input
          autoFocus
          type="number" min={-5} max={5} value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setIsEditing(false); }}
          className="w-12 text-center text-lg font-bold bg-stone-800 border border-amber-500 rounded text-amber-100 outline-none py-0.5"
        />
      ) : (
        <div className="flex justify-around w-full">
          <button 
          onClick={() => onStatusChange?.(statKey, status === "key" ? "none" : "key")}
          className={`text-lg transition-colors ${status === "key" ? "text-emerald-500" : "text-stone-600 hover:text-stone-400"}`}
        >
          {status === "key" ? "▲" : "△"}
        </button>
       <span
            onDoubleClick={() => { if (canEdit) { setInputVal(String(value)); setIsEditing(true); } }}
            className={`text-2xl font-bold tabular-nums leading-none ${status === "key" ? "text-amber-300" : "text-stone-100"} ${canEdit ? "cursor-pointer" : ""}`}
            title={canEdit ? "Double-click to edit" : undefined}
          >
            {displayBonus}
          </span>
          <button 
          onClick={() => onStatusChange?.(statKey, status === "flaw" ? "none" : "flaw")}
          className={`text-lg transition-colors ${status === "flaw" ? "text-rose-500" : "text-stone-600 hover:text-stone-400"}`}
        >
          {status === "flaw" ? "▼" : "▽"}
        </button>
        </div>
      )}

      {/* SAVE button — only clickable by owner/GM (canEdit).
          Hidden entirely for read-only viewers to avoid confusion. */}
      {onRoll && (
        <button
          onClick={() => onRoll(`${STAT_FULL[statKey]} Save`, `1d20+${value}`, saveAdvantage)}
          className="mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-stone-700/60 hover:bg-amber-900/60 text-stone-300 hover:text-amber-200 border border-stone-600/40 hover:border-amber-700/60 transition-all active:scale-95"
        >
          SAVE
        </button>
      )}
    </div>
  );
}

interface StatGridProps {
  stats: Stats;
  saveMods: SaveMods;
  keyStat: keyof Stats | null;
  flawStat: keyof Stats | null;
  canEdit: boolean;
  onStatChange?: (key: keyof Stats, value: number) => void;
  onStatusChange?: (key: keyof Stats, status: "key" | "flaw" | "none") => void;
  onRoll?: (label: string, formula: string, saveAdv: "advantage" | "disadvantage" | "none") => void;
}

export function StatGrid({ stats, saveMods, keyStat, flawStat, canEdit, onStatChange, onStatusChange, onRoll }: StatGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(["str", "dex", "int", "wil"] as Array<keyof Stats>).map((key) => (
        <StatBox
          key={key}
          statKey={key}
          value={stats[key]}
          saveAdvantage={saveMods[key]}
          canEdit={canEdit}
          status={
            keyStat === key ? "key" : 
            flawStat === key ? "flaw" : 
            "none"
          }
          onChange={canEdit ? onStatChange : undefined}
          onStatusChange={canEdit ? onStatusChange : undefined}
          // onRoll only passed if canEdit — disables the button for non-owners
          onRoll={canEdit ? onRoll : undefined}
        />
      ))}
    </div>
  );
}
