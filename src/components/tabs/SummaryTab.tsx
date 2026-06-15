import { useState } from "react";
import type { NimbleCharacter, DiceRollRequest, RollMode, DiceType } from "../../types/character";
import { StatGrid } from "../ui/StatBox";
import { LanguageSelector } from "../ui/LanguageSelector";
import { DiceRollModal } from "../ui/DiceRollModal";

const SKILL_LABELS = {
  arcana: "Arcana", examination: "Examination", finesse: "Finesse",
  influence: "Influence", insight: "Insight", lore: "Lore",
  might: "Might", naturecraft: "Naturecraft", perception: "Perception", stealth: "Stealth",
} as const;

const SKILL_STAT = {
  arcana: "INT", examination: "INT", finesse: "DEX", influence: "WIL",
  insight: "WIL", lore: "INT", might: "STR", naturecraft: "WIL",
  perception: "WIL", stealth: "DEX",
} as const;

const HIT_DICE_OPTIONS: DiceType[] = ["d6", "d8", "d10", "d12"];

interface Props {
  character: NimbleCharacter;
  canEdit: boolean;
  onUpdate: (u: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
  isGM: boolean;
}

export function SummaryTab({ character, canEdit, onUpdate, onRoll, isGM }: Props) {
  const [rollPending, setRollPending] = useState<{
    label: string; formula: string; saveAdv: "advantage" | "disadvantage" | "none"
  } | null>(null);

  const handleStatRoll = (label: string, formula: string, saveAdv: "advantage" | "disadvantage" | "none") => {
    setRollPending({ label, formula, saveAdv });
  };

  const confirmRoll = (mode: RollMode, advantageCount: number, hidden: boolean) => {
    if (!rollPending) return;
    const finalMode = rollPending.saveAdv !== "none" && mode === "standard" ? rollPending.saveAdv : mode;
    onRoll({ label: rollPending.label, formula: rollPending.formula, mode: finalMode, advantageCount, hidden });
    setRollPending(null);
  };

  const setHP = (field: keyof typeof character.hp, val: number) =>
    onUpdate({ hp: { ...character.hp, [field]: Math.max(0, val) } });

  const setWounds = (val: number) =>
    onUpdate({ wounds: Math.max(0, Math.min(character.maxWounds + 1, val)) });

  const handleHitDiceRoll = () => {
    if (character.hitDice.current <= 0) return;
    onUpdate({ hitDice: { ...character.hitDice, current: character.hitDice.current - 1 } });
    // Formula: roll the die + STR modifier (separate from die notation display)
    // We pass str as a raw number so the parser doesn't double-count it
    const strBonus = character.stats.str;
    const formula = strBonus !== 0
      ? `1${character.hitDice.dice}${strBonus >= 0 ? "+" : ""}${strBonus}`
      : `1${character.hitDice.dice}`;
    setRollPending({
      label: `Hit Die (${character.hitDice.dice})`,
      formula,
      saveAdv: "none",
    });
  };

  const strSign = character.stats.str >= 0 ? "+" : "";

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* ── Identity — 2 clean rows ───────────────────────────────── */}
      <div className="bento-card flex flex-col gap-2">

        {/* Row 1: Name · Class · Lv */}
        <div className="flex items-end gap-2">
          <Field label="Name" value={character.name} canEdit={canEdit}
            onChange={(v) => onUpdate({ name: v })} className="flex-1 min-w-0" />
          <Field label="Class" value={character.class} canEdit={canEdit}
            onChange={(v) => onUpdate({ class: v })} className="flex-1 min-w-0" />
          {/* Lv — narrow, label abbreviated */}
          <div className="flex flex-col gap-0.5 w-10 shrink-0">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">Lv</span>
            {canEdit ? (
              <input
                type="number"
                value={character.level}
                min={1}
                onChange={(e) => onUpdate({ level: parseInt(e.target.value) || 1 })}
                className="bg-transparent border-b border-stone-700 focus:border-amber-600 outline-none text-sm text-stone-200 pb-0.5 text-center w-full"
              />
            ) : (
              <span className="text-sm text-stone-200 font-bold text-center">{character.level}</span>
            )}
          </div>
        </div>

        {/* Row 2: Ancestry · Size · Speed */}
        <div className="flex items-end gap-2">
          <Field label="Ancestry" value={character.ancestry} canEdit={canEdit}
            onChange={(v) => onUpdate({ ancestry: v })} className="flex-1 min-w-0" />
          <Field label="Size" value={character.size} canEdit={canEdit}
            onChange={(v) => onUpdate({ size: v })} className="w-20 shrink-0" />
          {/* Speed — narrow */}
          <div className="flex flex-col gap-0.5 w-12 shrink-0">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">Speed</span>
            {canEdit ? (
              <input
                type="number"
                value={character.speed}
                min={1}
                onChange={(e) => onUpdate({ speed: parseInt(e.target.value) || 6 })}
                className="bg-transparent border-b border-stone-700 focus:border-amber-600 outline-none text-sm text-stone-200 pb-0.5 text-center w-full"
              />
            ) : (
              <span className="text-sm text-stone-200 font-bold text-center">{character.speed}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── HP & Wounds ──────────────────────────────────────────── */}
      <div className="bento-card grid grid-cols-2 gap-3">
        <div>
          <p className="bento-label">Hit Points</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <NumInput value={character.hp.current} canEdit={canEdit} min={0} max={character.hp.max + character.hp.temp}
              onChange={(v) => setHP("current", v)} className="text-3xl font-black text-emerald-300" />
            <span className="text-stone-500 text-sm">/ </span>
            <NumInput value={character.hp.max} canEdit={canEdit} min={1}
              onChange={(v) => setHP("max", v)} className="text-base font-semibold text-stone-300" />
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">Temp</span>
            <NumInput value={character.hp.temp} canEdit={canEdit} min={0}
              onChange={(v) => setHP("temp", v)} className="text-sm font-semibold text-sky-300" />
          </div>
          <div className="mt-2 h-1.5 bg-stone-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300" style={{
              width: `${Math.min(100, (character.hp.current / character.hp.max) * 100)}%`,
              background: character.hp.current <= character.hp.max * 0.25 ? "#ef4444"
                : character.hp.current <= character.hp.max * 0.5 ? "#f59e0b" : "#34d399",
            }} />
          </div>
        </div>

        <div>
          <p className="bento-label">Wounds</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Array.from({ length: character.maxWounds + 1 }).map((_, i) => {
              const filled = i < character.wounds;
              const fatal = i === character.maxWounds;
              return (
                <button key={i}
                  onClick={() => canEdit && setWounds(filled ? i : i + 1)}
                  className={`w-6 h-6 rounded-full border-2 transition-all text-xs ${
                    fatal ? "border-rose-900 bg-rose-950/30 text-rose-800 text-[8px]"
                    : filled ? "border-rose-600 bg-rose-700"
                    : "border-stone-600 bg-stone-800/40"
                  } ${canEdit ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
                >
                  {fatal ? "☠" : ""}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-stone-500 mt-1.5">
            {character.wounds}/{character.maxWounds} wounds
            {character.hp.current === 0 && " · DYING"}
          </p>

          {/* ── Hit Dice
              Display:  4 / d8        (current / dieType)
              Roll:     1d8 + STR        (STR is a bonus, not part of the die count)
              No additive bonus shown in the count fields.
          ── */}
          <div className="mt-2">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">Hit Dice</span>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {canEdit ? (
                <>
                  <input
                    type="number" value={character.hitDice.current} min={0} max={character.hitDice.max}
                    onChange={(e) => onUpdate({ hitDice: { ...character.hitDice, current: Math.max(0, parseInt(e.target.value) || 0) } })}
                    className="w-7 text-center text-sm font-bold bg-stone-900 border border-stone-700 rounded text-stone-200 outline-none py-0.5 focus:border-amber-600"
                  />
                  <span className="text-stone-600 text-xs">/</span>
                  <input
                    type="number" value={character.hitDice.max} min={1}
                    onChange={(e) => onUpdate({ hitDice: { ...character.hitDice, max: Math.max(1, parseInt(e.target.value) || 1) } })}
                    className="w-7 text-center text-sm font-bold bg-stone-900 border border-stone-700 rounded text-stone-200 outline-none py-0.5 focus:border-amber-600"
                  />
                  <select value={character.hitDice.dice}
                    onChange={(e) => onUpdate({ hitDice: { ...character.hitDice, dice: e.target.value as DiceType } })}
                    className="bg-stone-800 border border-stone-700 rounded px-1 py-0.5 text-[11px] text-stone-300 outline-none focus:border-amber-600"
                  >
                    {HIT_DICE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </>
              ) : (
                <span className="text-sm font-bold text-stone-300">
                  {character.hitDice.current}/{character.hitDice.max} {character.hitDice.dice}
                </span>
              )}

              <button
                onClick={handleHitDiceRoll}
                disabled={character.hitDice.current <= 0}
                title={character.hitDice.current > 0
                  ? `Roll ${character.hitDice.dice} + STR (${strSign}${character.stats.str})`
                  : "No hit dice remaining"}
                className={`px-1.5 py-0.5 rounded text-[10px] border transition-all ${
                  character.hitDice.current > 0
                    ? "bg-stone-700 hover:bg-amber-900 text-stone-400 hover:text-amber-200 border-stone-600 cursor-pointer"
                    : "bg-stone-800/40 text-stone-600 border-stone-700/40 cursor-not-allowed"
                }`}
              >🎲</button>
            </div>
            <p className="text-[10px] text-stone-600 mt-0.5 italic">
              Roll = {character.hitDice.dice} + STR ({strSign}{character.stats.str})
            </p>
          </div>
        </div>
      </div>

      {/* ── Stats ────────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Characteristics</p>
        <StatGrid
          stats={character.stats}
          saveMods={character.saveMods}
          canEdit={canEdit}
          onStatChange={(key, val) => onUpdate({ stats: { ...character.stats, [key]: val } })}
          onRoll={canEdit ? handleStatRoll : undefined}
        />
        {canEdit && (
          <p className="text-[10px] text-stone-600 mt-2 italic">
            Double-click a value to edit · +2/+2/+0/−1 · +2/+1/+1/+0 · +3/+1/−1/−1
          </p>
        )}
      </div>

      {/* ── Skills ───────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Skills</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(SKILL_LABELS) as Array<keyof typeof SKILL_LABELS>).map((skillKey) => {
            const val = character.skills[skillKey];
            return (
              <div key={skillKey}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-stone-800/40 border border-stone-700/40 group">
                <div>
                  <span className="text-xs font-medium text-stone-200">{SKILL_LABELS[skillKey]}</span>
                  <span className="text-[10px] text-stone-500 ml-1.5">{SKILL_STAT[skillKey]}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {canEdit ? (
                    <input type="number" value={val} min={-5} max={10}
                      onChange={(e) => onUpdate({ skills: { ...character.skills, [skillKey]: parseInt(e.target.value) || 0 } })}
                      className="w-10 text-center text-sm font-bold bg-stone-900 border border-stone-700 rounded text-amber-200 outline-none py-0.5 focus:border-amber-600"
                    />
                  ) : (
                    <span className="text-sm font-bold text-amber-200 w-8 text-right">
                      {val >= 0 ? `+${val}` : val}
                    </span>
                  )}
                  {/* 🎲 only visible to owner/GM */}
                  {canEdit && (
                    <button
                      onClick={() => setRollPending({ label: `${SKILL_LABELS[skillKey]} check`, formula: `1d20+${val}`, saveAdv: "none" })}
                      className="opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded text-[10px] bg-stone-700 hover:bg-amber-900 text-stone-400 hover:text-amber-200 border border-stone-600"
                    >🎲</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Languages — z-10 so dropdown clears cards below ─────── */}
      <div className="bento-card relative z-10">
        <p className="bento-label mb-2">Languages</p>
        <LanguageSelector
          selected={character.languages}
          readOnly={!canEdit}
          onChange={(langs) => onUpdate({ languages: langs })}
        />
        {canEdit && (
          <p className="text-[10px] text-stone-600 mt-1.5 italic">
            Common is always known. +1 language per INT point.
          </p>
        )}
      </div>

      {/* ── Abilities ────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Abilities & Traits</p>
        {canEdit ? (
          <textarea value={character.abilities.join("\n")}
            onChange={(e) => onUpdate({ abilities: e.target.value.split("\n").filter(Boolean) })}
            rows={4} placeholder="Class, ancestry, and background abilities…"
            className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-300 outline-none resize-none focus:border-amber-700/60 placeholder-stone-600"
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {character.abilities.map((a, i) => (
              <li key={i} className="text-xs text-stone-300 leading-relaxed">• {a}</li>
            ))}
            {character.abilities.length === 0 && <li className="text-xs text-stone-600 italic">No abilities listed.</li>}
          </ul>
        )}
      </div>

      {/* ── Notes ────────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Background & Notes</p>
        {canEdit ? (
          <textarea value={character.notes}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            rows={4} placeholder="Background, history, motivations…"
            className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-300 outline-none resize-none focus:border-amber-700/60 placeholder-stone-600"
          />
        ) : (
          <p className="text-xs text-stone-400 whitespace-pre-wrap leading-relaxed">
            {character.notes || <span className="text-stone-600 italic">No notes.</span>}
          </p>
        )}
      </div>

      {rollPending && (
        <DiceRollModal
          label={rollPending.label}
          formula={rollPending.formula}
          isGM={isGM}
          onConfirm={confirmRoll}
          onCancel={() => setRollPending(null)}
        />
      )}
    </div>
  );
}

function Field({ label, value, canEdit, type = "text", onChange, className = "" }: {
  label: string; value: string; canEdit: boolean; type?: string;
  onChange?: (v: string) => void; className?: string;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</span>
      {canEdit ? (
        <input type={type} value={value} onChange={(e) => onChange?.(e.target.value)}
          className="bg-transparent border-b border-stone-700 focus:border-amber-600 outline-none text-sm text-stone-200 pb-0.5 transition-colors w-full"
        />
      ) : (
        <span className="text-sm text-stone-200 font-medium truncate">{value || "—"}</span>
      )}
    </div>
  );
}

function NumInput({ value, canEdit, min, max, onChange, className = "" }: {
  value: number; canEdit: boolean; min?: number; max?: number;
  onChange: (v: number) => void; className?: string;
}) {
  if (!canEdit) return <span className={className}>{value}</span>;
  return (
    <input type="number" value={value} min={min} max={max}
      onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onChange(v); }}
      className={`bg-transparent border-b border-stone-700/60 focus:border-amber-600 outline-none text-center w-16 transition-colors ${className}`}
    />
  );
}
