/**
 * DiceRollModal – Presented when a user clicks an action, spell, or item.
 * Lets them choose Standard / Advantage / Disadvantage (stackable).
 */

import { useState } from 'react';
import type { RollMode } from '../../types/character';

interface DiceRollModalProps {
  label: string;
  formula: string;
  isGM?: boolean;
  onConfirm: (mode: RollMode, advantageCount: number, hidden: boolean) => void;
  onCancel: () => void;
}

export function DiceRollModal({
  label,
  formula,
  isGM = false,
  onConfirm,
  onCancel,
}: DiceRollModalProps) {
  const [mode, setMode] = useState<RollMode>('standard');
  const [extraCount, setExtraCount] = useState(1);
  const [hidden, setHidden] = useState(false);

  const handleConfirm = () => {
    onConfirm(mode, mode === 'standard' ? 0 : extraCount, hidden);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="
        w-72 rounded-xl border border-stone-700 bg-stone-900 shadow-2xl
        shadow-black/60 overflow-hidden
      ">
        {/* Header */}
        <div className="bg-stone-800 px-4 py-3 border-b border-stone-700">
          <p className="text-xs text-stone-400 uppercase tracking-widest">Roll</p>
          <h3 className="text-base font-bold text-amber-200 mt-0.5 truncate">{label}</h3>
          <p className="text-xs font-mono text-stone-400 mt-0.5">{formula}</p>
        </div>

        {/* Mode selector */}
        <div className="p-4 flex flex-col gap-3">
          <p className="text-xs text-stone-400 uppercase tracking-wider">Mode</p>

          <div className="grid grid-cols-3 gap-2">
            {(['standard', 'advantage', 'disadvantage'] as RollMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`
                  py-2 px-1 rounded-lg text-xs font-semibold border transition-all duration-100
                  ${mode === m
                    ? m === 'advantage'
                      ? 'border-emerald-500 bg-emerald-900/50 text-emerald-300'
                      : m === 'disadvantage'
                      ? 'border-rose-500 bg-rose-900/50 text-rose-300'
                      : 'border-amber-500 bg-amber-900/50 text-amber-300'
                    : 'border-stone-700 bg-stone-800/50 text-stone-400 hover:border-stone-500'}
                `}
              >
                {m === 'standard' ? '⬡ Standard' : m === 'advantage' ? '▲ Adv.' : '▼ Disadv.'}
              </button>
            ))}
          </div>

          {/* Extra dice count (only when advantage/disadvantage) */}
          {mode !== 'standard' && (
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-stone-400">Extra dice:</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setExtraCount(Math.max(1, extraCount - 1))}
                  className="w-6 h-6 rounded bg-stone-700 text-stone-200 font-bold hover:bg-stone-600 transition-colors"
                >−</button>
                <span className="text-sm font-bold text-stone-100 w-4 text-center">{extraCount}</span>
                <button
                  onClick={() => setExtraCount(Math.min(5, extraCount + 1))}
                  className="w-6 h-6 rounded bg-stone-700 text-stone-200 font-bold hover:bg-stone-600 transition-colors"
                >+</button>
              </div>
              <span className="text-xs text-stone-500">
                {mode === 'advantage' ? 'keep highest' : 'keep lowest'}
              </span>
            </div>
          )}

          {/* Hidden roll (GM only) */}
          {isGM && (
            <label className="flex items-center gap-2 mt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
                className="accent-amber-500"
              />
              <span className="text-xs text-stone-300">Hidden roll (GM only)</span>
            </label>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-4 pb-4">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-stone-700 text-stone-400 text-sm font-medium hover:bg-stone-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-amber-100 text-sm font-bold transition-colors active:scale-95"
          >
            🎲 Roll!
          </button>
        </div>
      </div>
    </div>
  );
}
