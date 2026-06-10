/**
 * InventoryTab – Equipment & items.
 * Tracks slot usage (10 + STR), gold, and item rolls.
 */

import { useState } from 'react';
import type { NimbleCharacter, InventoryItem } from '../../types/character';
import { DiceRollModal } from '../ui/DiceRollModal';
import type { DiceRollRequest } from '../../types/character';

interface InventoryTabProps {
  character: NimbleCharacter;
  canEdit: boolean;
  isGM: boolean;
  onUpdate: (updates: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
}

export function InventoryTab({
  character,
  canEdit,
  isGM,
  onUpdate,
  onRoll,
}: InventoryTabProps) {
  const [rollPending, setRollPending] = useState<{ label: string; formula: string } | null>(null);
  const [addingItem, setAddingItem] = useState(false);

  const maxSlots = 10 + character.stats.str;
  const usedSlots = character.inventory.reduce((sum, item) => sum + item.slots * item.quantity, 0);
  const slotPct = Math.min(100, (usedSlots / maxSlots) * 100);

  const deleteItem = (id: string) => {
    if (!canEdit) return;
    onUpdate({ inventory: character.inventory.filter((i) => i.id !== id) });
  };

  const toggleEquipped = (id: string) => {
    if (!canEdit) return;
    onUpdate({
      inventory: character.inventory.map((i) =>
        i.id === id ? { ...i, isEquipped: !i.isEquipped } : i
      ),
    });
  };

  const setQuantity = (id: string, qty: number) => {
    if (!canEdit) return;
    onUpdate({
      inventory: character.inventory.map((i) =>
        i.id === id ? { ...i, quantity: Math.max(0, qty) } : i
      ),
    });
  };

  const toggleFavorite = (id: string) => {
    if (!canEdit) return;
    onUpdate({
      inventory: character.inventory.map((i) =>
        i.id === id ? { ...i, isFavorite: !i.isFavorite } : i
      ),
    });
  };

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* ── Slot tracker ──────────────────────────────────────────── */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-1.5">
          <p className="bento-label">Inventory Slots</p>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-300">
              {usedSlots} / {maxSlots}
            </span>
            <span className="text-[10px] text-stone-500">(10 + STR {character.stats.str >= 0 ? '+' : ''}{character.stats.str})</span>
          </div>
        </div>

        {/* Slot bar */}
        <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              slotPct >= 100 ? 'bg-rose-600' : slotPct >= 75 ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${slotPct}%` }}
          />
        </div>

        {/* Slot pips (visual grid for slot count) */}
        <div className="flex flex-wrap gap-1 mt-2">
          {Array.from({ length: maxSlots }).map((_, i) => (
            <div
              key={i}
              className={`
                w-3 h-3 rounded-sm border transition-colors
                ${i < usedSlots
                  ? usedSlots > maxSlots
                    ? 'border-rose-600 bg-rose-700'
                    : 'border-amber-700 bg-amber-800'
                  : 'border-stone-700 bg-stone-800/40'}
              `}
            />
          ))}
        </div>
      </div>

      {/* ── Gold ─────────────────────────────────────────────────── */}
      <div className="bento-card flex items-center gap-3">
        <span className="text-xl">🪙</span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-stone-500 uppercase tracking-wider">Gold Pieces</span>
          {canEdit ? (
            <input
              type="number"
              value={character.gold}
              min={0}
              onChange={(e) => onUpdate({ gold: Math.max(0, parseInt(e.target.value) || 0) })}
              className="w-24 bg-transparent border-b border-stone-700 focus:border-amber-600 outline-none text-lg font-bold text-amber-300 text-center transition-colors"
            />
          ) : (
            <span className="text-lg font-bold text-amber-300">{character.gold} gp</span>
          )}
        </div>
      </div>

      {/* ── Favorites ─────────────────────────────────────────────── */}
      {character.inventory.filter(i => i.isFavorite).length > 0 && (
        <div className="bento-card">
          <p className="bento-label mb-2">⭐ Favorites</p>
          <div className="flex flex-col gap-1.5">
            {character.inventory.filter(i => i.isFavorite).map(item => (
              <ItemRow
                key={item.id}
                item={item}
                canEdit={canEdit}
                isGM={isGM}
                onRoll={item.formula ? () => setRollPending({ label: item.name, formula: item.formula! }) : undefined}
                onToggleFavorite={() => toggleFavorite(item.id)}
                onToggleEquipped={() => toggleEquipped(item.id)}
                onSetQuantity={(q) => setQuantity(item.id, q)}
                onDelete={() => deleteItem(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Item list ──────────────────────────────────────────────── */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-2">
          <p className="bento-label">Items</p>
          {canEdit && (
            <button
              onClick={() => setAddingItem(true)}
              className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded transition-colors"
            >
              + Add item
            </button>
          )}
        </div>

        {character.inventory.length === 0 ? (
          <p className="text-xs text-stone-600 italic text-center py-6">
            No items yet.{canEdit && ' Click "+ Add item" to get started.'}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {character.inventory.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                canEdit={canEdit}
                isGM={isGM}
                onRoll={item.formula ? () => setRollPending({ label: item.name, formula: item.formula! }) : undefined}
                onToggleFavorite={() => toggleFavorite(item.id)}
                onToggleEquipped={() => toggleEquipped(item.id)}
                onSetQuantity={(q) => setQuantity(item.id, q)}
                onDelete={() => deleteItem(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Notes ─────────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Notes</p>
        {canEdit ? (
          <textarea
            value={character.notes}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            rows={4}
            placeholder="Equipment notes, encumbrance rules, etc."
            className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-300 outline-none resize-none focus:border-amber-700/60 placeholder-stone-600"
          />
        ) : (
          <p className="text-xs text-stone-400 whitespace-pre-wrap leading-relaxed">
            {character.notes || <span className="text-stone-600 italic">No notes.</span>}
          </p>
        )}
      </div>

      {/* Modals */}
      {addingItem && (
        <AddItemModal
          onAdd={(item) => {
            onUpdate({ inventory: [...character.inventory, item] });
            setAddingItem(false);
          }}
          onCancel={() => setAddingItem(false)}
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

// ─── ItemRow ──────────────────────────────────────────────────────

function ItemRow({
  item,
  canEdit,
  isGM,
  onRoll,
  onToggleFavorite,
  onToggleEquipped,
  onSetQuantity,
  onDelete,
}: {
  item: InventoryItem;
  canEdit: boolean;
  isGM: boolean;
  onRoll?: () => void;
  onToggleFavorite: () => void;
  onToggleEquipped: () => void;
  onSetQuantity: (q: number) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-stone-700/40 bg-stone-900/40 overflow-hidden">
      <div
        className="flex items-center gap-2 px-2.5 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Equipped indicator */}
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${item.isEquipped ? 'bg-emerald-500' : 'bg-stone-700'}`}
          title={item.isEquipped ? 'Equipped' : 'Unequipped'}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-200 truncate">{item.name}</span>
            <span className="text-[9px] text-stone-500 flex-shrink-0">
              {item.slots === 2 ? '2 slots' : item.slots === 0 ? 'negligible' : '1 slot'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Quantity */}
          {canEdit ? (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => onSetQuantity(item.quantity - 1)}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600 transition-colors"
              >−</button>
              <span className="text-xs text-stone-300 w-4 text-center">{item.quantity}</span>
              <button
                onClick={() => onSetQuantity(item.quantity + 1)}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600 transition-colors"
              >+</button>
            </div>
          ) : (
            <span className="text-xs text-stone-400">×{item.quantity}</span>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`text-sm transition-colors ${item.isFavorite ? 'text-amber-400' : 'text-stone-600 hover:text-stone-400'}`}
          >
            ⭐
          </button>

          {onRoll && (
            <button
              onClick={(e) => { e.stopPropagation(); onRoll(); }}
              className="px-2 py-1 rounded bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-300 text-[10px] font-bold border border-emerald-800/40 transition-all active:scale-95"
            >
              🎲
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-2.5 border-t border-stone-700/40 pt-2 flex flex-col gap-1.5">
          {item.description && (
            <p className="text-xs text-stone-400 leading-relaxed">{item.description}</p>
          )}
          {canEdit && (
            <div className="flex items-center gap-3 mt-1">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={item.isEquipped}
                  onChange={onToggleEquipped}
                  className="accent-emerald-500"
                />
                <span className="text-[10px] text-stone-400">Equipped</span>
              </label>
              <button onClick={onDelete} className="text-[10px] text-rose-500 hover:text-rose-400 transition-colors">
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AddItemModal ─────────────────────────────────────────────────

function AddItemModal({
  onAdd,
  onCancel,
}: {
  onAdd: (item: InventoryItem) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ name: '', description: '', slots: 1, formula: '' });
  const set = (k: string, v: unknown) => setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = () => {
    if (!form.name) return;
    onAdd({
      id: `item-${Date.now()}`,
      name: form.name,
      description: form.description,
      slots: form.slots,
      quantity: 1,
      isEquipped: false,
      isFavorite: false,
      isCustom: true,
      formula: form.formula || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-80 rounded-xl border border-stone-700 bg-stone-900 shadow-2xl overflow-hidden">
        <div className="bg-stone-800 px-4 py-3 border-b border-stone-700">
          <h3 className="text-sm font-bold text-emerald-300">New Item</h3>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase">Name *</span>
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-emerald-600" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500 uppercase">Slots</span>
              <select value={form.slots} onChange={(e) => set('slots', parseInt(e.target.value))}
                className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-emerald-600">
                <option value={0}>Negligible</option>
                <option value={1}>1 slot</option>
                <option value={2}>2 slots</option>
              </select>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500 uppercase">Roll formula</span>
              <input value={form.formula} placeholder="e.g. 1d6+DEX"
                onChange={(e) => set('formula', e.target.value)}
                className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-emerald-600 placeholder-stone-600" />
            </div>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase">Description</span>
            <textarea value={form.description} rows={2} onChange={(e) => set('description', e.target.value)}
              className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300 outline-none resize-none focus:border-emerald-600" />
          </div>
        </div>

        <div className="flex gap-2 px-4 pb-4">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-sm font-bold transition-colors">Add</button>
        </div>
      </div>
    </div>
  );
}
