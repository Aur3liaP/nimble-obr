/**
 * SummaryTab – "At a glance" view.
 * Bento layout: Identity | HP & Wounds | Stats | Skills
 */

import { useState } from 'react';
import type { NimbleCharacter, Stats, RollMode } from '../../types/character';
import { StatGrid } from '../ui/StatBox';
import { LanguageSelector } from '../ui/LanguageSelector';
import { DiceRollModal } from '../ui/DiceRollModal';
import type { DiceRollRequest } from '../../types/character';

const SKILL_LABELS = {
  arcana: 'Arcana',
  examination: 'Examination',
  finesse: 'Finesse',
  influence: 'Influence',
  insight: 'Insight',
  lore: 'Lore',
  might: 'Might',
  naturecraft: 'Naturecraft',
  perception: 'Perception',
  stealth: 'Stealth',
} as const;

const SKILL_STAT = {
  arcana: 'INT',
  examination: 'INT',
  finesse: 'DEX',
  influence: 'WIL',
  insight: 'WIL',
  lore: 'INT',
  might: 'STR',
  naturecraft: 'WIL',
  perception: 'WIL',
  stealth: 'DEX',
} as const;

interface SummaryTabProps {
  character: NimbleCharacter;
  canEdit: boolean;
  onUpdate: (updates: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
  isGM: boolean;
}

export function SummaryTab({
  character,
  canEdit,
  onUpdate,
  onRoll,
  isGM,
}: SummaryTabProps) {
  const [rollPending, setRollPending] = useState<{
    label: string;
    formula: string;
    saveAdv: 'advantage' | 'disadvantage' | 'none';
  } | null>(null);

  const handleStatRoll = (
    label: string,
    formula: string,
    saveAdv: 'advantage' | 'disadvantage' | 'none'
  ) => {
    setRollPending({ label, formula, saveAdv });
  };

  const confirmRoll = (mode: RollMode, advantageCount: number, hidden: boolean) => {
    if (!rollPending) return;
    // Merge save advantage with chosen mode
    const finalMode =
      rollPending.saveAdv === 'advantage' && mode === 'standard'
        ? 'advantage'
        : rollPending.saveAdv === 'disadvantage' && mode === 'standard'
        ? 'disadvantage'
        : mode;

    onRoll({
      label: rollPending.label,
      formula: rollPending.formula,
      mode: finalMode,
      advantageCount,
      hidden,
    });
    setRollPending(null);
  };

  const handleSkillRoll = (skillKey: string, value: number) => {
    setRollPending({
      label: `${SKILL_LABELS[skillKey as keyof typeof SKILL_LABELS]} check`,
      formula: `1d20+${value}`,
      saveAdv: 'none',
    });
  };

  // HP helpers
  const setHP = (field: keyof typeof character.hp, val: number) => {
    onUpdate({ hp: { ...character.hp, [field]: Math.max(0, val) } });
  };

  const setWounds = (val: number) => {
    onUpdate({ wounds: Math.max(0, Math.min(character.maxWounds + 1, val)) });
  };

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* ── Identity Card ─────────────────────────────────────────── */}
      <div className="bento-card grid grid-cols-2 gap-x-4 gap-y-2">
        <Field
          label="Name"
          value={character.name}
          canEdit={canEdit}
          onChange={(v) => onUpdate({ name: v })}
        />
        <div className="flex gap-2 items-center">
          <Field
            label="Level"
            value={String(character.level)}
            canEdit={canEdit}
            type="number"
            onChange={(v) => onUpdate({ level: parseInt(v) || 1 })}
            className="w-16"
          />
          <Field
            label="Class"
            value={character.class}
            canEdit={canEdit}
            onChange={(v) => onUpdate({ class: v })}
          />
        </div>
        <Field
          label="Ancestry"
          value={character.ancestry}
          canEdit={canEdit}
          onChange={(v) => onUpdate({ ancestry: v })}
        />
        <Field
          label="Background"
          value={character.background}
          canEdit={canEdit}
          onChange={(v) => onUpdate({ background: v })}
        />
      </div>

      {/* ── HP & Wounds ───────────────────────────────────────────── */}
      <div className="bento-card grid grid-cols-2 gap-3">
        {/* HP */}
        <div>
          <p className="bento-label">Hit Points</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            {/* Current HP */}
            <EditableNumber
              value={character.hp.current}
              canEdit={canEdit}
              min={0}
              max={character.hp.max + character.hp.temp}
              onChange={(v) => setHP('current', v)}
              className="text-3xl font-black text-emerald-300"
            />
            <span className="text-stone-500 text-sm font-medium">/ </span>
            <EditableNumber
              value={character.hp.max}
              canEdit={canEdit}
              min={1}
              onChange={(v) => setHP('max', v)}
              className="text-base font-semibold text-stone-300"
            />
          </div>
          {/* Temp HP */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">Temp</span>
            <EditableNumber
              value={character.hp.temp}
              canEdit={canEdit}
              min={0}
              onChange={(v) => setHP('temp', v)}
              className="text-sm font-semibold text-sky-300"
            />
          </div>
          {/* HP bar */}
          <div className="mt-2 h-1.5 bg-stone-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(100, (character.hp.current / character.hp.max) * 100)}%`,
                background: character.hp.current <= character.hp.max * 0.25
                  ? '#ef4444'
                  : character.hp.current <= character.hp.max * 0.5
                  ? '#f59e0b'
                  : '#34d399',
              }}
            />
          </div>
        </div>

        {/* Wounds */}
        <div>
          <p className="bento-label">Wounds</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Array.from({ length: character.maxWounds + 1 }).map((_, i) => {
              const isFilled = i < character.wounds;
              const isFatal = i === character.maxWounds;
              return (
                <button
                  key={i}
                  onClick={() => canEdit && setWounds(isFilled ? i : i + 1)}
                  className={`
                    w-6 h-6 rounded-full border-2 transition-all duration-150 text-xs
                    ${isFatal
                      ? 'border-rose-900 bg-rose-950/30 text-rose-800 text-[8px]'
                      : isFilled
                      ? 'border-rose-600 bg-rose-700 shadow-rose-900/60 shadow-md'
                      : 'border-stone-600 bg-stone-800/40'}
                    ${canEdit ? 'cursor-pointer hover:scale-110' : 'cursor-default'}
                  `}
                  title={isFatal ? 'Death' : `Wound ${i + 1}`}
                >
                  {isFatal && '☠'}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-stone-500 mt-1.5">
            {character.wounds} / {character.maxWounds} wounds
            {character.wounds === 0 && ' · healthy'}
            {character.wounds >= character.maxWounds && ' · DYING'}
          </p>

          {/* Hit Dice */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">HD</span>
            <span className="text-sm font-semibold text-stone-300">
              {character.hitDice.current}/{character.hitDice.max}
            </span>
            <span className="text-xs text-stone-500">{character.hitDice.dice}</span>
          </div>
        </div>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Characteristics</p>
        <StatGrid
          stats={character.stats}
          saveMods={character.saveMods}
          canEdit={canEdit}
          onStatChange={(key, val) =>
            onUpdate({ stats: { ...character.stats, [key]: val } })
          }
          onRoll={handleStatRoll}
        />
      </div>

      {/* ── Skills ────────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Skills</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(SKILL_LABELS) as Array<keyof typeof SKILL_LABELS>).map(
            (skillKey) => {
              const val = character.skills[skillKey as keyof typeof character.skills];
              const display = val >= 0 ? `+${val}` : String(val);

              return (
                <div
                  key={skillKey}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-stone-800/40 border border-stone-700/40 group"
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-stone-200">
                      {SKILL_LABELS[skillKey]}
                    </span>
                    <span className="text-[10px] text-stone-500">
                      {SKILL_STAT[skillKey]}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {canEdit ? (
                      <input
                        type="number"
                        value={val}
                        min={-5}
                        max={10}
                        onChange={(e) =>
                          onUpdate({
                            skills: {
                              ...character.skills,
                              [skillKey]: parseInt(e.target.value) || 0,
                            },
                          })
                        }
                        className="w-10 text-center text-sm font-bold bg-stone-900 border border-stone-700 rounded text-amber-200 outline-none py-0.5 focus:border-amber-600"
                      />
                    ) : (
                      <span className="text-sm font-bold text-amber-200 w-8 text-right">
                        {display}
                      </span>
                    )}

                    <button
                      onClick={() => handleSkillRoll(skillKey, val)}
                      className="
                        opacity-0 group-hover:opacity-100 transition-opacity
                        px-1.5 py-0.5 rounded text-[10px] bg-stone-700 hover:bg-amber-900
                        text-stone-400 hover:text-amber-200 border border-stone-600
                      "
                      title={`Roll ${SKILL_LABELS[skillKey]}`}
                    >
                      🎲
                    </button>
                  </div>
                </div>
              );
            }
          )}
        </div>
      </div>

      {/* ── Languages ─────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Languages</p>
        <LanguageSelector
          selected={character.languages}
          readOnly={!canEdit}
          onChange={(langs) => onUpdate({ languages: langs })}
        />
      </div>

      {/* ── Abilities & Notes ─────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Abilities & Traits</p>
        {canEdit ? (
          <textarea
            value={character.abilities.join('\n')}
            onChange={(e) =>
              onUpdate({ abilities: e.target.value.split('\n').filter(Boolean) })
            }
            rows={4}
            placeholder="Enter class, ancestry, and background abilities…"
            className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-300 outline-none resize-none focus:border-amber-700/60 placeholder-stone-600"
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {character.abilities.map((a, i) => (
              <li key={i} className="text-xs text-stone-300 leading-relaxed">
                • {a}
              </li>
            ))}
            {character.abilities.length === 0 && (
              <li className="text-xs text-stone-600 italic">No abilities listed.</li>
            )}
          </ul>
        )}
      </div>

      {/* Dice roll modal */}
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

// ─── Small reusable sub-components ───────────────────────────────

function Field({
  label,
  value,
  canEdit,
  type = 'text',
  onChange,
  className = '',
}: {
  label: string;
  value: string;
  canEdit: boolean;
  type?: string;
  onChange?: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</span>
      {canEdit ? (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className="bg-transparent border-b border-stone-700 focus:border-amber-600 outline-none text-sm text-stone-200 pb-0.5 transition-colors"
        />
      ) : (
        <span className="text-sm text-stone-200 font-medium">{value || '—'}</span>
      )}
    </div>
  );
}

function EditableNumber({
  value,
  canEdit,
  min,
  max,
  onChange,
  className = '',
}: {
  value: number;
  canEdit: boolean;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  if (!canEdit) {
    return <span className={className}>{value}</span>;
  }

  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const v = parseInt(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      className={`
        bg-transparent border-b border-stone-700/60 focus:border-amber-600
        outline-none text-center w-16 transition-colors
        ${className}
      `}
    />
  );
}
