/**
 * RollLog – Floating log of recent dice rolls, visible to all players.
 * Hidden rolls only show to GM.
 */

import { useState } from 'react';
import type { DiceRollResult } from '../../types/character';

interface RollLogProps {
  rolls: DiceRollResult[];
  isGM: boolean;
  currentPlayerId: string;
}

export function RollLog({ rolls, isGM, currentPlayerId }: RollLogProps) {
  const [isOpen, setIsOpen] = useState(false);

  const visibleRolls = isGM
    ? rolls
    : rolls.filter((r) => !r.hidden);

  const last = visibleRolls[visibleRolls.length - 1];

  if (visibleRolls.length === 0) return null;

  return (
    <div className="fixed bottom-3 right-3 z-40 flex flex-col items-end gap-1">
      {/* Expandable log */}
      {isOpen && (
        <div className="
          w-64 max-h-52 overflow-y-auto rounded-xl border border-stone-700
          bg-stone-950/95 shadow-2xl shadow-black/60 backdrop-blur-sm
        ">
          <div className="sticky top-0 bg-stone-900 px-3 py-2 border-b border-stone-700 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-widest text-stone-400 uppercase">Roll History</span>
            <button onClick={() => setIsOpen(false)} className="text-stone-500 hover:text-stone-300 text-xs">✕</button>
          </div>
          <div className="p-2 flex flex-col gap-1.5">
            {[...visibleRolls].reverse().map((roll, i) => (
              <RollEntry key={i} roll={roll} isMine={roll.playerId === currentPlayerId} isGM={isGM} />
            ))}
          </div>
        </div>
      )}

      {/* Last roll chip */}
      {last && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-lg
            text-xs font-bold transition-all
            ${last.isCritical
              ? 'border-amber-500 bg-amber-900/80 text-amber-200'
              : last.isFumble
              ? 'border-rose-700 bg-rose-950/80 text-rose-300'
              : 'border-stone-700 bg-stone-900/90 text-stone-200'}
          `}
        >
          <span>🎲</span>
          <span>{last.label}</span>
          <span className={`text-base font-black ${last.isCritical ? 'text-amber-300' : last.isFumble ? 'text-rose-400' : 'text-white'}`}>
            {last.total}
          </span>
          {last.isCritical && <span className="text-amber-400">⚡</span>}
          {last.isFumble && <span className="text-rose-400">💀</span>}
          {last.hidden && <span className="text-stone-400" title="Hidden roll">👁</span>}
        </button>
      )}
    </div>
  );
}

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
    <div className={`
      px-2.5 py-1.5 rounded-lg text-xs
      ${isMine ? 'bg-stone-800/80' : 'bg-stone-900/60'}
      border ${roll.isCritical ? 'border-amber-700/60' : roll.isFumble ? 'border-rose-800/60' : 'border-stone-700/40'}
    `}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-stone-300 truncate max-w-[140px]">{roll.label}</span>
        <span className={`font-black text-sm ml-1 ${roll.isCritical ? 'text-amber-300' : roll.isFumble ? 'text-rose-400' : 'text-white'}`}>
          {roll.total}
          {roll.isCritical && ' ⚡'}
          {roll.isFumble && ' 💀'}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-stone-500 font-mono">[{roll.kept.join(', ')}]</span>
        {roll.modifier !== 0 && (
          <span className="text-stone-400">
            {roll.modifier > 0 ? '+' : ''}{roll.modifier}
          </span>
        )}
        {roll.kept.length !== roll.rolls.length && (
          <span className="text-stone-600 line-through font-mono text-[10px]">
            {roll.rolls.filter(r => !roll.kept.includes(r)).join(', ')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-stone-600">{roll.playerName}</span>
        {roll.hidden && isGM && <span className="text-stone-500 italic">hidden</span>}
      </div>
    </div>
  );
}
