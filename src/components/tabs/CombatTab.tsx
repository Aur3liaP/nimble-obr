/**
 * CombatTab – Combat-focused view.
 * Bento: Initiative | Armor | Actions list
 */

import { useState } from 'react';
import type { NimbleCharacter, CharacterAction, RollMode } from '../../types/character';
import { DiceRollModal } from '../ui/DiceRollModal';
import type { DiceRollRequest } from '../../types/character';
import { resolveFormulaDisplay } from '../../utils/formulaParser';

interface CombatTabProps {
  character: NimbleCharacter;
  canEdit: boolean;
  isGM: boolean;
  onUpdate: (updates: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
  onRollInitiative: (mode?: RollMode) => void;
}

const ACTION_TYPE_COLORS = {
  melee:   'text-rose-300 border-rose-800/60 bg-rose-950/30',
  ranged:  'text-sky-300  border-sky-800/60  bg-sky-950/30',
  spell:   'text-violet-300 border-violet-800/60 bg-violet-950/30',
  ability: 'text-amber-300 border-amber-800/60 bg-amber-950/30',
  item:    'text-emerald-300 border-emerald-800/60 bg-emerald-950/30',
} as const;

const ACTION_TYPE_ICONS = {
  melee:   '⚔️',
  ranged:  '🏹',
  spell:   '✨',
  ability: '⚡',
  item:    '🎒',
} as const;

export function CombatTab({
  character,
  canEdit,
  isGM,
  onUpdate,
  onRoll,
  onRollInitiative,
}: CombatTabProps) {
  const [rollPending, setRollPending] = useState<{
    label: string;
    formula: string;
  } | null>(null);

  const [initiativeMode, setInitiativeMode] = useState<RollMode | null>(null);
  const [addingAction, setAddingAction] = useState(false);

  const handleActionClick = (action: CharacterAction) => {
    if (!action.formula && !action.damage) return;
    setRollPending({
      label: action.name,
      formula: action.formula || action.damage,
    });
  };

  const toggleFavorite = (id: string) => {
    if (!canEdit) return;
    onUpdate({
      actions: character.actions.map((a) =>
        a.id === id ? { ...a, isFavorite: !a.isFavorite } : a
      ),
    });
  };

  const deleteAction = (id: string) => {
    if (!canEdit) return;
    onUpdate({ actions: character.actions.filter((a) => a.id !== id) });
  };

  const defenseValue =
    character.armor.equipped && character.armor.value > 0
      ? character.armor.value
      : 10 + character.stats.dex;

  const combatActions = character.actions.filter(
    (a) => a.type === 'melee' || a.type === 'ranged' || a.type === 'ability'
  );

  const favorites = character.actions.filter((a) => a.isFavorite);

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* ── Initiative ─────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Initiative</p>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center px-3 py-2 rounded-lg bg-stone-800/60 border border-stone-700/40">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">Base</span>
            <span className="text-2xl font-black text-amber-300">
              {character.stats.dex >= 0 ? '+' : ''}{character.stats.dex + character.initiativeBonus}
            </span>
            <span className="text-[10px] text-stone-500">DEX{character.initiativeBonus !== 0 ? ` + ${character.initiativeBonus}` : ''}</span>
          </div>

          <div className="flex flex-col gap-1.5 flex-1">
            <div className="flex gap-1.5">
              {(['standard', 'advantage', 'disadvantage'] as RollMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onRollInitiative(mode)}
                  className={`
                    flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all active:scale-95
                    ${mode === 'advantage'
                      ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50'
                      : mode === 'disadvantage'
                      ? 'border-rose-700/60 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50'
                      : 'border-amber-700/60 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50'}
                  `}
                >
                  {mode === 'standard' ? '🎲 Roll' : mode === 'advantage' ? '▲ Adv' : '▼ Dis'}
                </button>
              ))}
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-stone-500">Bonus:</span>
                <input
                  type="number"
                  value={character.initiativeBonus}
                  onChange={(e) => onUpdate({ initiativeBonus: parseInt(e.target.value) || 0 })}
                  className="w-14 text-center text-xs bg-stone-900 border border-stone-700 rounded py-0.5 text-stone-200 outline-none focus:border-amber-600"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Defense ────────────────────────────────────────────────── */}
      <div className="bento-card flex items-center gap-4">
        <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-stone-800/60 border border-stone-700/40">
          <span className="text-[10px] text-stone-500 uppercase tracking-wider">Defense</span>
          <span className="text-3xl font-black text-sky-300">{defenseValue}</span>
          <span className="text-[10px] text-stone-500">
            {character.armor.equipped && character.armor.value > 0
              ? character.armor.name
              : 'Unarmored (DEX)'}
          </span>
        </div>

        {canEdit && (
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500">Armor name</span>
              <input
                value={character.armor.name}
                onChange={(e) => onUpdate({ armor: { ...character.armor, name: e.target.value } })}
                className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-amber-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-stone-500">Value</span>
                <input
                  type="number"
                  value={character.armor.value}
                  min={0}
                  onChange={(e) => onUpdate({ armor: { ...character.armor, value: parseInt(e.target.value) || 0 } })}
                  className="w-14 text-center bg-stone-900 border border-stone-700 rounded py-0.5 text-xs text-stone-200 outline-none focus:border-amber-600"
                />
              </div>
              <label className="flex items-center gap-1 cursor-pointer mt-3">
                <input
                  type="checkbox"
                  checked={character.armor.equipped}
                  onChange={(e) => onUpdate({ armor: { ...character.armor, equipped: e.target.checked } })}
                  className="accent-amber-500"
                />
                <span className="text-xs text-stone-400">Equipped</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer mt-3">
                <input
                  type="checkbox"
                  checked={character.armor.proficient}
                  onChange={(e) => onUpdate({ armor: { ...character.armor, proficient: e.target.checked } })}
                  className="accent-amber-500"
                />
                <span className="text-xs text-stone-400">Proficient</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* ── Favorites ──────────────────────────────────────────────── */}
      {favorites.length > 0 && (
        <div className="bento-card">
          <p className="bento-label mb-2">⭐ Favorites</p>
          <div className="flex flex-col gap-1.5">
            {favorites.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                character={character}
                canEdit={canEdit}
                onRoll={() => handleActionClick(action)}
                onToggleFavorite={() => toggleFavorite(action.id)}
                onDelete={() => deleteAction(action.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Combat Actions ─────────────────────────────────────────── */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-2">
          <p className="bento-label">Actions</p>
          {canEdit && (
            <button
              onClick={() => setAddingAction(true)}
              className="text-xs text-amber-400 hover:text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded transition-colors"
            >
              + Add
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {combatActions.length === 0 && (
            <p className="text-xs text-stone-600 italic text-center py-4">
              No combat actions yet.
              {canEdit && ' Click "+ Add" to create one.'}
            </p>
          )}
          {combatActions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              character={character}
              canEdit={canEdit}
              onRoll={() => handleActionClick(action)}
              onToggleFavorite={() => toggleFavorite(action.id)}
              onDelete={() => deleteAction(action.id)}
            />
          ))}
        </div>
      </div>

      {/* Add action modal */}
      {addingAction && (
        <AddActionModal
          onAdd={(action) => {
            onUpdate({ actions: [...character.actions, action] });
            setAddingAction(false);
          }}
          onCancel={() => setAddingAction(false)}
          defaultType="melee"
        />
      )}

      {/* Roll modal */}
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

// ─── ActionRow ────────────────────────────────────────────────────

function ActionRow({
  action,
  character,
  canEdit,
  onRoll,
  onToggleFavorite,
  onDelete,
}: {
  action: CharacterAction;
  character: NimbleCharacter;
  canEdit: boolean;
  onRoll: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const typeStyle = ACTION_TYPE_COLORS[action.type] || '';
  const icon = ACTION_TYPE_ICONS[action.type] || '⚡';
  const resolvedFormula = resolveFormulaDisplay(action.formula || action.damage, character);

  return (
    <div
      className={`
        rounded-lg border overflow-hidden transition-all duration-150
        bg-stone-900/40 border-stone-700/40
      `}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-base">{icon}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-200 truncate">{action.name}</span>
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${typeStyle}`}>
              {action.type}
            </span>
            {action.manaCost != null && action.manaCost > 0 && (
              <span className="text-[9px] text-violet-400">✦{action.manaCost}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-stone-500">
              📍 {action.range || '—'}
            </span>
            {resolvedFormula && (
              <span className="text-[10px] font-mono text-amber-300/80">{resolvedFormula}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`text-sm transition-colors ${action.isFavorite ? 'text-amber-400' : 'text-stone-600 hover:text-stone-400'}`}
            title={action.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            ⭐
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRoll(); }}
            className="px-2 py-1 rounded bg-amber-900/50 hover:bg-amber-800/60 text-amber-300 text-[10px] font-bold border border-amber-800/40 transition-all active:scale-95"
          >
            🎲
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-2.5 border-t border-stone-700/40 pt-2">
          <p className="text-xs text-stone-400 leading-relaxed">{action.description || 'No description.'}</p>
          {canEdit && (
            <button
              onClick={onDelete}
              className="mt-2 text-[10px] text-rose-500 hover:text-rose-400 transition-colors"
            >
              Delete action
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AddActionModal ───────────────────────────────────────────────

function AddActionModal({
  onAdd,
  onCancel,
  defaultType,
}: {
  onAdd: (action: CharacterAction) => void;
  onCancel: () => void;
  defaultType: CharacterAction['type'];
}) {
  const [form, setForm] = useState<Partial<CharacterAction>>({
    type: defaultType,
    isFavorite: false,
    isCustom: true,
  });

  const set = <K extends keyof CharacterAction>(k: K, v: CharacterAction[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = () => {
    if (!form.name) return;
    onAdd({
      id: `action-${Date.now()}`,
      name: form.name ?? '',
      type: form.type ?? 'melee',
      range: form.range ?? '1',
      damage: form.damage ?? '',
      formula: form.formula ?? form.damage ?? '',
      description: form.description ?? '',
      isFavorite: form.isFavorite ?? false,
      isCustom: true,
      manaCost: form.manaCost,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-80 rounded-xl border border-stone-700 bg-stone-900 shadow-2xl overflow-hidden">
        <div className="bg-stone-800 px-4 py-3 border-b border-stone-700">
          <h3 className="text-sm font-bold text-amber-200">New Action</h3>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <Input label="Name *" value={form.name ?? ''} onChange={(v) => set('name', v)} />

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">Type</span>
            <select
              value={form.type}
              onChange={(e) => set('type', e.target.value as CharacterAction['type'])}
              className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-amber-600"
            >
              {['melee', 'ranged', 'spell', 'ability', 'item'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Input label="Range" value={form.range ?? ''} onChange={(v) => set('range', v)} placeholder="e.g. 1, range 6" />
            <Input label="Damage formula" value={form.damage ?? ''} onChange={(v) => { set('damage', v); set('formula', v); }} placeholder="e.g. 1d8+STR" />
          </div>

          {form.type === 'spell' && (
            <Input label="Mana cost" value={String(form.manaCost ?? 0)} type="number" onChange={(v) => set('manaCost', parseInt(v) || 0)} />
          )}

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">Description</span>
            <textarea
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300 outline-none resize-none focus:border-amber-600"
            />
          </div>
        </div>

        <div className="flex gap-2 px-4 pb-4">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} className="flex-1 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-amber-100 text-sm font-bold transition-colors">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  type = 'text',
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-amber-600 placeholder-stone-600"
      />
    </div>
  );
}
