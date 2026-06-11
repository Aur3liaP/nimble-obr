import { useState } from "react";
import type { NimbleCharacter, InventoryItem, DiceRollRequest } from "../../types/character";
import { DiceRollModal } from "../ui/DiceRollModal";

interface Props {
  character: NimbleCharacter;
  canEdit: boolean;
  isGM: boolean;
  onUpdate: (u: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
}

export function InventoryTab({ character, canEdit, isGM, onUpdate, onRoll }: Props) {
  const [rollPending, setRollPending] = useState<{ label: string; formula: string } | null>(null);
  const [addingItem, setAddingItem] = useState(false);

  const maxSlots = 10 + character.stats.str;
  const usedSlots = character.inventory.reduce((s, i) => s + i.slots * i.quantity, 0);
  const slotPct = Math.min(100, (usedSlots / maxSlots) * 100);

  const update = (id: string, patch: Partial<InventoryItem>) =>
    onUpdate({ inventory: character.inventory.map((i) => i.id === id ? { ...i, ...patch } : i) });

  const remove = (id: string) =>
    onUpdate({ inventory: character.inventory.filter((i) => i.id !== id) });

  // Remove favorites section entirely from inventory — stars still work, favorites shown in Combat
  const items = character.inventory;

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* ── Slots ────────────────────────────────────────────────── */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-1.5">
          <p className="bento-label">Inventory Slots</p>
          <span className="text-xs font-semibold text-stone-300">
            {usedSlots} / {maxSlots}
            <span className="text-[10px] text-stone-500 ml-1">(10+STR)</span>
          </span>
        </div>
        <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${slotPct >= 100 ? "bg-rose-600" : slotPct >= 75 ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${slotPct}%` }} />
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {Array.from({ length: maxSlots }).map((_, i) => (
            <div key={i} className={`w-3 h-3 rounded-sm border transition-colors ${
              i < usedSlots
                ? usedSlots > maxSlots ? "border-rose-600 bg-rose-700" : "border-amber-700 bg-amber-800"
                : "border-stone-700 bg-stone-800/40"
            }`} />
          ))}
        </div>
      </div>

      {/* ── Currency ─────────────────────────────────────────────── */}
      <div className="bento-card flex items-center gap-4">
        <CurrencyField label="Gold" emoji="🪙" value={character.gold} canEdit={canEdit}
          onChange={(v) => onUpdate({ gold: v })} textColor="text-amber-300" />
        <CurrencyField label="Silver" emoji="🥈" value={character.silver} canEdit={canEdit}
          onChange={(v) => onUpdate({ silver: v })} textColor="text-slate-300" />
      </div>

      {/* ── Items ────────────────────────────────────────────────── */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-2">
          <p className="bento-label">Items</p>
          {canEdit && (
            <button onClick={() => setAddingItem(true)}
              className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded transition-colors">
              + Add item
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-stone-600 italic text-center py-6">
            No items yet.{canEdit && " Click \"+ Add item\"."}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} canEdit={canEdit} isGM={isGM}
                onRoll={item.formula ? () => setRollPending({ label: item.name, formula: item.formula! }) : undefined}
                onToggleFavorite={() => update(item.id, { isFavorite: !item.isFavorite })}
                onToggleEquipped={() => update(item.id, { isEquipped: !item.isEquipped })}
                onSetQuantity={(q) => update(item.id, { quantity: Math.max(0, q) })}
                onDelete={() => remove(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Notes ────────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Notes</p>
        {canEdit ? (
          <textarea value={character.notes} onChange={(e) => onUpdate({ notes: e.target.value })}
            rows={3} placeholder="Equipment notes, encumbrance…"
            className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-300 outline-none resize-none focus:border-amber-700/60 placeholder-stone-600"
          />
        ) : (
          <p className="text-xs text-stone-400 whitespace-pre-wrap">{character.notes || <span className="text-stone-600 italic">No notes.</span>}</p>
        )}
      </div>

      {addingItem && (
        <AddItemModal
          onAdd={(item) => { onUpdate({ inventory: [...character.inventory, item] }); setAddingItem(false); }}
          onCancel={() => setAddingItem(false)}
        />
      )}
      {rollPending && (
        <DiceRollModal label={rollPending.label} formula={rollPending.formula} isGM={isGM}
          onConfirm={(mode, ac, hidden) => { onRoll({ label: rollPending.label, formula: rollPending.formula, mode, advantageCount: ac, hidden }); setRollPending(null); }}
          onCancel={() => setRollPending(null)}
        />
      )}
    </div>
  );
}

function CurrencyField({ label, emoji, value, canEdit, onChange, textColor }: {
  label: string; emoji: string; value: number; canEdit: boolean;
  onChange: (v: number) => void; textColor: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xl">{emoji}</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</span>
        {canEdit ? (
          <input type="number" value={value} min={0}
            onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
            className={`w-20 bg-transparent border-b border-stone-700 focus:border-amber-600 outline-none text-lg font-bold text-center transition-colors ${textColor}`}
          />
        ) : (
          <span className={`text-lg font-bold ${textColor}`}>{value}</span>
        )}
      </div>
    </div>
  );
}

function ItemRow({ item, canEdit, isGM: _isGM, onRoll, onToggleFavorite, onToggleEquipped, onSetQuantity, onDelete }: {
  item: InventoryItem; canEdit: boolean; isGM: boolean;
  onRoll?: () => void; onToggleFavorite: () => void; onToggleEquipped: () => void;
  onSetQuantity: (q: number) => void; onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-stone-700/40 bg-stone-900/40 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className={`w-2 h-2 rounded-full shrink-0 ${item.isEquipped ? "bg-emerald-500" : "bg-stone-700"}`}
          title={item.isEquipped ? "Equipped" : "Unequipped"} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-200 truncate">{item.name}</span>
            <span className="text-[9px] text-stone-500 shrink-0">
              {item.slots === 0 ? "—" : item.slots === 2 ? "2 slots" : "1 slot"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {canEdit ? (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => onSetQuantity(item.quantity - 1)}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600">−</button>
              <span className="text-xs text-stone-300 w-4 text-center">{item.quantity}</span>
              <button onClick={() => onSetQuantity(item.quantity + 1)}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600">+</button>
            </div>
          ) : (
            <span className="text-xs text-stone-400">×{item.quantity}</span>
          )}
          <button onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`text-sm transition-colors ${item.isFavorite ? "text-amber-400" : "text-stone-600 hover:text-stone-400"}`}>⭐</button>
          {onRoll && (
            <button onClick={(e) => { e.stopPropagation(); onRoll(); }}
              className="px-2 py-1 rounded bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-300 text-[10px] font-bold border border-emerald-800/40 transition-all active:scale-95">
              🎲
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-2.5 border-t border-stone-700/40 pt-2 flex flex-col gap-1.5">
          {item.description && <p className="text-xs text-stone-400 leading-relaxed">{item.description}</p>}
          {canEdit && (
            <div className="flex items-center gap-3 mt-1">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={item.isEquipped} onChange={onToggleEquipped} className="accent-emerald-500" />
                <span className="text-[10px] text-stone-400">Equipped</span>
              </label>
              <button onClick={onDelete} className="text-[10px] text-rose-500 hover:text-rose-400">Remove</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddItemModal({ onAdd, onCancel }: { onAdd: (i: InventoryItem) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: "", description: "", slots: 1, formula: "" });
  const set = (k: string, v: string | number) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="w-80 rounded-xl border border-stone-700 bg-stone-900 shadow-2xl overflow-hidden">
        <div className="bg-stone-800 px-4 py-3 border-b border-stone-700">
          <h3 className="text-sm font-bold text-emerald-300">New Item</h3>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <IInput label="Name *" value={form.name} onChange={(v) => set("name", v)} />
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500 uppercase">Slots</span>
              <select value={form.slots} onChange={(e) => set("slots", parseInt(e.target.value))}
                className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-emerald-600">
                <option value={0}>Negligible</option>
                <option value={1}>1 slot</option>
                <option value={2}>2 slots</option>
              </select>
            </div>
            <IInput label="Roll formula" value={form.formula} onChange={(v) => set("formula", v)} placeholder="e.g. 1d6+DEX" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase">Description</span>
            <textarea value={form.description} rows={2} onChange={(e) => set("description", e.target.value)}
              className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300 outline-none resize-none focus:border-emerald-600" />
          </div>
        </div>
        <div className="flex gap-2 px-4 pb-4">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors">Cancel</button>
          <button onClick={() => { if (!form.name) return; onAdd({ id: `i-${Date.now()}`, name: form.name, description: form.description, slots: form.slots, quantity: 1, isEquipped: false, isFavorite: false, isCustom: true, formula: form.formula || undefined }); }}
            className="flex-1 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-sm font-bold transition-colors">Add</button>
        </div>
      </div>
    </div>
  );
}

function IInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-stone-500 uppercase">{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-emerald-600 placeholder-stone-600" />
    </div>
  );
}
