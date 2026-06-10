/**
 * SpellsTab – Spells & cantrips management.
 * Shows mana pool, filters by tier, and allows rolling spells.
 */

import { useState } from 'react';
import type { NimbleCharacter, CharacterAction } from '../../types/character';
import { DiceRollModal } from '../ui/DiceRollModal';
import type { DiceRollRequest } from '../../types/character';
import { resolveFormulaDisplay } from '../../utils/formulaParser';

interface SpellsTabProps {
  character: NimbleCharacter;
  canEdit: boolean;
  isGM: boolean;
  onUpdate: (updates: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
}

const SPELL_TIER_LABELS: Record<number, string> = {
  0: 'Cantrips',
  1: 'Tier I',
  2: 'Tier II',
  3: 'Tier III',
  4: 'Tier IV',
};

export function SpellsTab({ character, canEdit, isGM, onUpdate, onRoll }: SpellsTabProps) {
  const [rollPending, setRollPending] = useState<{ label: string; formula: string } | null>(null);
  const [addingSpell, setAddingSpell] = useState(false);
  const [filterTier, setFilterTier] = useState<number | 'all'>('all');

  const spells = character.actions.filter((a) => a.type === 'spell');

  const tiers = [
    ...new Set(spells.map((s) => s.spellTier ?? 0)),
  ].sort();

  const visibleSpells = filterTier === 'all'
    ? spells
    : spells.filter((s) => (s.spellTier ?? 0) === filterTier);

  const handleSpellClick = (spell: CharacterAction) => {
    if (!spell.formula && !spell.damage) return;
    setRollPending({ label: spell.name, formula: spell.formula || spell.damage });
  };

  const deleteSpell = (id: string) => {
    if (!canEdit) return;
    onUpdate({ actions: character.actions.filter((a) => a.id !== id) });
  };

  const toggleFavorite = (id: string) => {
    if (!canEdit) return;
    onUpdate({
      actions: character.actions.map((a) =>
        a.id === id ? { ...a, isFavorite: !a.isFavorite } : a
      ),
    });
  };

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* ── Mana Pool ──────────────────────────────────────────────── */}
      <div className="bento-card flex items-center gap-4">
        <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-violet-950/40 border border-violet-800/40">
          <span className="text-[10px] text-violet-400 uppercase tracking-wider">Mana</span>
          <div className="flex items-baseline gap-1">
            {canEdit ? (
              <input
                type="number"
                value={character.mana}
                min={0}
                max={character.maxMana}
                onChange={(e) => onUpdate({ mana: parseInt(e.target.value) || 0 })}
                className="w-14 text-center text-3xl font-black bg-transparent text-violet-200 outline-none border-b border-violet-800 focus:border-violet-500"
              />
            ) : (
              <span className="text-3xl font-black text-violet-200">{character.mana}</span>
            )}
            <span className="text-stone-500 text-sm"> / </span>
            {canEdit ? (
              <input
                type="number"
                value={character.maxMana}
                min={0}
                onChange={(e) => onUpdate({ maxMana: parseInt(e.target.value) || 0 })}
                className="w-10 text-center text-base font-semibold bg-transparent text-violet-300 outline-none border-b border-stone-700 focus:border-violet-500"
              />
            ) : (
              <span className="text-base font-semibold text-violet-300">{character.maxMana}</span>
            )}
          </div>
        </div>

        <div className="flex-1">
          <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 bg-linear-to-r from-violet-700 to-violet-400"
              style={{ width: `${character.maxMana > 0 ? (character.mana / character.maxMana) * 100 : 0}%` }}
            />
          </div>
          <p className="text-[10px] text-stone-500 mt-1">
            Spell tier ≈ mana cost · cantrips are free
          </p>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────── */}
      {tiers.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {['all' as const, ...tiers].map((t) => (
            <button
              key={t}
              onClick={() => setFilterTier(t)}
              className={`
                px-2.5 py-1 rounded-full text-xs font-medium border transition-all
                ${filterTier === t
                  ? 'border-violet-600 bg-violet-900/50 text-violet-300'
                  : 'border-stone-700 bg-stone-800/40 text-stone-400 hover:border-stone-600'}
              `}
            >
              {t === 'all' ? 'All' : SPELL_TIER_LABELS[t as number] ?? `Tier ${t}`}
            </button>
          ))}
        </div>
      )}

      {/* ── Spell list ─────────────────────────────────────────────── */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-2">
          <p className="bento-label">Spells & Cantrips</p>
          {canEdit && (
            <button
              onClick={() => setAddingSpell(true)}
              className="text-xs text-violet-400 hover:text-violet-300 border border-violet-800/60 px-2 py-0.5 rounded transition-colors"
            >
              + Add spell
            </button>
          )}
        </div>

        {visibleSpells.length === 0 ? (
          <p className="text-xs text-stone-600 italic text-center py-6">
            {spells.length === 0 ? 'No spells known.' : 'No spells for this tier.'}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visibleSpells.map((spell) => (
              <SpellRow
                key={spell.id}
                spell={spell}
                character={character}
                canEdit={canEdit}
                onRoll={() => handleSpellClick(spell)}
                onToggleFavorite={() => toggleFavorite(spell.id)}
                onDelete={() => deleteSpell(spell.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {addingSpell && (
        <AddSpellModal
          onAdd={(spell) => {
            onUpdate({ actions: [...character.actions, spell] });
            setAddingSpell(false);
          }}
          onCancel={() => setAddingSpell(false)}
        />
      )}

      {rollPending && (
        <DiceRollModal
          label={rollPending.label}
          formula={rollPending.formula}
          isGM={isGM}
          onConfirm={(mode, advantageCount, hidden) => {
            onRoll({ label: rollPending.label, formula: rollPending.formula, mode, advantageCount, hidden });
            setRollPending(null);
          }}
          onCancel={() => setRollPending(null)}
        />
      )}
    </div>
  );
}

// ─── SpellRow ─────────────────────────────────────────────────────

function SpellRow({
  spell,
  character,
  canEdit,
  onRoll,
  onToggleFavorite,
  onDelete,
}: {
  spell: CharacterAction;
  character: NimbleCharacter;
  canEdit: boolean;
  onRoll: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tier = spell.spellTier ?? 0;
  const tierLabel = SPELL_TIER_LABELS[tier] ?? `Tier ${tier}`;
  const resolvedFormula = resolveFormulaDisplay(spell.formula || spell.damage, character);

  return (
    <div className="rounded-lg border border-stone-700/40 bg-stone-900/40 overflow-hidden">
      <div
        className="flex items-center gap-2 px-2.5 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-base">{tier === 0 ? '✦' : '✨'}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-200 truncate">{spell.name}</span>
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border text-violet-300 border-violet-800/60 bg-violet-950/30">
              {tierLabel}
            </span>
            {tier > 0 && spell.manaCost != null && (
              <span className="text-[9px] text-violet-400">✦{spell.manaCost}</span>
            )}
          </div>
          {resolvedFormula && (
            <span className="text-[10px] font-mono text-amber-300/80">{resolvedFormula}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`text-sm transition-colors ${spell.isFavorite ? 'text-amber-400' : 'text-stone-600 hover:text-stone-400'}`}
          >
            ⭐
          </button>
          {(spell.formula || spell.damage) && (
            <button
              onClick={(e) => { e.stopPropagation(); onRoll(); }}
              className="px-2 py-1 rounded bg-violet-900/50 hover:bg-violet-800/60 text-violet-300 text-[10px] font-bold border border-violet-800/40 transition-all active:scale-95"
            >
              🎲
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-2.5 border-t border-stone-700/40 pt-2">
          <p className="text-xs text-stone-400 leading-relaxed">{spell.description || 'No description.'}</p>
          {canEdit && (
            <button onClick={onDelete} className="mt-2 text-[10px] text-rose-500 hover:text-rose-400 transition-colors">
              Remove spell
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AddSpellModal ────────────────────────────────────────────────

function AddSpellModal({
  onAdd,
  onCancel,
}: {
  onAdd: (spell: CharacterAction) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    tier: 0,
    manaCost: 0,
    range: '',
    damage: '',
    description: '',
  });

  const set = (k: string, v: unknown) => setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = () => {
    if (!form.name) return;
    onAdd({
      id: `spell-${Date.now()}`,
      name: form.name,
      type: 'spell',
      range: form.range,
      damage: form.damage,
      formula: form.damage,
      description: form.description,
      isFavorite: false,
      isCustom: true,
      spellTier: form.tier,
      manaCost: form.tier === 0 ? 0 : form.manaCost,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-80 rounded-xl border border-stone-700 bg-stone-900 shadow-2xl overflow-hidden">
        <div className="bg-stone-800 px-4 py-3 border-b border-stone-700">
          <h3 className="text-sm font-bold text-violet-300">New Spell / Cantrip</h3>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase">Name *</span>
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500 uppercase">Tier</span>
              <select value={form.tier} onChange={(e) => { const t = parseInt(e.target.value); set('tier', t); set('manaCost', t); }}
                className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-violet-600">
                {[0, 1, 2, 3, 4].map((t) => (
                  <option key={t} value={t}>{SPELL_TIER_LABELS[t]}</option>
                ))}
              </select>
            </div>
            {form.tier > 0 && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-stone-500 uppercase">Mana cost</span>
                <input type="number" value={form.manaCost} min={0}
                  onChange={(e) => set('manaCost', parseInt(e.target.value) || 0)}
                  className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500 uppercase">Range</span>
              <input value={form.range} placeholder="e.g. range 6" onChange={(e) => set('range', e.target.value)}
                className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600 placeholder-stone-600" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500 uppercase">Damage</span>
              <input value={form.damage} placeholder="e.g. 2d6+INT" onChange={(e) => set('damage', e.target.value)}
                className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600 placeholder-stone-600" />
            </div>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase">Description</span>
            <textarea value={form.description} rows={3}
              onChange={(e) => set('description', e.target.value)}
              className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300 outline-none resize-none focus:border-violet-600" />
          </div>
        </div>

        <div className="flex gap-2 px-4 pb-4">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 py-2 rounded-lg bg-violet-800 hover:bg-violet-700 text-violet-100 text-sm font-bold transition-colors">Add</button>
        </div>
      </div>
    </div>
  );
}
