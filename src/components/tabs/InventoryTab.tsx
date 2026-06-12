import { useState, useMemo } from "react";
import type { NimbleCharacter, InventoryItem, DiceRollRequest } from "../../types/character";
import { DiceRollModal } from "../ui/DiceRollModal";
import { BASIC_EQUIPMENTS } from "../../data/equipment";

interface Props {
  character: NimbleCharacter;
  canEdit: boolean;
  isGM: boolean;
  onUpdate: (u: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
}

// ── Category helpers ──────────────────────────────────────────────

type ItemCategory = "all" | "armor" | "weapon" | "consumable" | "gear";

function guessCategory(item: typeof BASIC_EQUIPMENTS[0]): ItemCategory {
  if (item.isArmor) return "armor";
  if (item.formula && (item.name.toLowerCase().includes("potion") || item.slots === 0.5)) return "consumable";
  if (item.actionCost && item.formula) return "weapon";
  return "gear";
}

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  all: "All", armor: "🛡 Armor", weapon: "⚔️ Weapons", consumable: "🧪 Consumables", gear: "🎒 Gear",
};

// ── Add Item Modal ────────────────────────────────────────────────

type AddMode = "list" | "custom";

function AddItemModal({ onAdd, onCancel }: {
  onAdd: (i: InventoryItem) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<AddMode>("list");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<ItemCategory>("all");

  // Custom form
  const [form, setForm] = useState({
    name: "", description: "", slots: 1, formula: "", isFavorite: false, isArmor: false,
  });
  const setF = (k: string, v: string | number | boolean) => setForm((p) => ({ ...p, [k]: v }));

  const filteredBase = useMemo(() => {
    return BASIC_EQUIPMENTS.filter((item) => {
      const matchSearch = search === "" ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        (item.description?.toLowerCase().includes(search.toLowerCase()) ?? false);
      const matchCat = filterCat === "all" || guessCategory(item) === filterCat;
      return matchSearch && matchCat;
    });
  }, [search, filterCat]);

  const handleAddFromList = (template: typeof BASIC_EQUIPMENTS[0]) => {
    const newId = crypto.randomUUID();
    onAdd({
      id: `i-${newId}`,
      name: template.name,
      description: template.description ?? "",
      slots: template.slots,
      quantity: 1,
      isEquipped: false,
      isFavorite: false,
      isCustom: false,
      isArmor: template.isArmor ?? false,
      armorValue: template.armorValue,
      formula: template.formula,
      actionCost: template.actionCost,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="w-[340px] max-h-[85vh] rounded-xl border border-stone-700 bg-stone-900 shadow-2xl overflow-hidden flex flex-col">

        {/* Header */}
        <div className="bg-stone-800 px-4 py-3 border-b border-stone-700 shrink-0">
          <h3 className="text-sm font-bold text-emerald-300">Add Item</h3>
          <div className="flex gap-1 mt-2">
            {(["list", "custom"] as AddMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 py-1 rounded text-[11px] font-semibold transition-all ${
                  mode === m
                    ? "bg-emerald-900/60 border border-emerald-600/60 text-emerald-300"
                    : "bg-stone-800 border border-stone-700 text-stone-400 hover:text-stone-200"
                }`}>
                {m === "list" ? "📚 From list" : "✏️ Custom"}
              </button>
            ))}
          </div>
        </div>

        {mode === "list" ? (
          <>
            {/* Search + category filter */}
            <div className="px-3 pt-3 pb-2 shrink-0 flex flex-col gap-2 border-b border-stone-800">
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items…"
                className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-xs text-stone-200 outline-none focus:border-emerald-600 placeholder-stone-600"
              />
              <div className="flex gap-1 flex-wrap">
                {(["all", "armor", "weapon", "consumable", "gear"] as ItemCategory[]).map((cat) => (
                  <button key={cat} onClick={() => setFilterCat(cat)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                      filterCat === cat
                        ? "border-emerald-600 bg-emerald-900/50 text-emerald-300"
                        : "border-stone-700 bg-stone-800/40 text-stone-400 hover:border-stone-600"
                    }`}>
                    {CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>
            </div>

            {/* Item list */}
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
              {filteredBase.length === 0 && (
                <p className="text-xs text-stone-600 italic text-center py-6">No items match your search.</p>
              )}
              {filteredBase.map((item, idx) => (
                <button key={idx} onClick={() => handleAddFromList(item)}
                  className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-stone-700/40 bg-stone-900/40 hover:bg-emerald-950/30 hover:border-emerald-700/40 transition-all text-left w-full group">
                  <span className="mt-0.5 text-sm shrink-0">
                    {item.isArmor ? "🛡" : item.actionCost && item.formula ? "⚔️" : item.slots === 0.5 ? "🧪" : "🎒"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-stone-200">{item.name}</span>
                      <span className="text-[9px] text-stone-500">
                        {item.slots === 0 ? "negligible" : item.slots === 0.5 ? "½ slot" : item.slots === 2 ? "2 slots" : "1 slot"}
                      </span>
                    </div>
                    {item.formula && (
                      <span className="text-[10px] font-mono text-amber-300/70">{item.formula}</span>
                    )}
                    <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2 leading-relaxed">{item.description}</p>
                  </div>
                  <span className="text-[10px] text-emerald-500 group-hover:text-emerald-300 shrink-0 mt-1">+ Add</span>
                </button>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-stone-800 shrink-0">
              <button onClick={onCancel}
                className="w-full py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors">
                Cancel
              </button>
            </div>
          </>
        ) : (
          /* Custom item form */
          <>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <IInput label="Name *" value={form.name} onChange={(v) => setF("name", v)} />
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-stone-500 uppercase">Slots</span>
                  <select value={form.slots} onChange={(e) => setF("slots", parseFloat(e.target.value))}
                    className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-emerald-600">
                    <option value={0}>Negligible</option>
                    <option value={0.5}>½ slot (×2 per slot)</option>
                    <option value={1}>1 slot</option>
                    <option value={2}>2 slots</option>
                  </select>
                </div>
                <IInput label="Roll formula" value={form.formula} onChange={(v) => setF("formula", v)} placeholder="e.g. 1d6+DEX" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-stone-500 uppercase">Description</span>
                <textarea value={form.description} rows={2} onChange={(e) => setF("description", e.target.value)}
                  className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300 outline-none resize-none focus:border-emerald-600" />
              </div>
              {/* Options */}
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={form.isArmor} onChange={(e) => setF("isArmor", e.target.checked)} className="accent-sky-500" />
                  <span className="text-[10px] text-stone-400">Is armor</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={form.isFavorite} onChange={(e) => setF("isFavorite", e.target.checked)} className="accent-amber-500" />
                  <span className="text-[10px] text-stone-400">Add to favorites ⭐</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2 px-4 pb-4 shrink-0 border-t border-stone-800 pt-3">
              <button onClick={onCancel}
                className="flex-1 py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors">Cancel</button>
              <button
                onClick={() => {
                  if (!form.name.trim()) return;
                  onAdd({
                    id: `i-${Date.now()}`,
                    name: form.name,
                    description: form.description,
                    slots: form.slots,
                    quantity: 1,
                    isEquipped: false,
                    isFavorite: form.isFavorite,
                    isCustom: true,
                    isArmor: form.isArmor,
                    formula: form.formula || undefined,
                  });
                }}
                className="flex-1 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-sm font-bold transition-colors">Add</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main InventoryTab ─────────────────────────────────────────────

export function InventoryTab({ character, canEdit, isGM, onUpdate, onRoll }: Props) {
  const [rollPending, setRollPending] = useState<{ label: string; formula: string } | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const maxSlots = 10 + character.stats.str;
  // 0.5-slot items: 2 fit in 1 slot
  const usedSlots = character.inventory.reduce((s, i) => s + i.slots * i.quantity, 0);
  const slotPct = Math.min(100, (usedSlots / maxSlots) * 100);

  const update = (id: string, patch: Partial<InventoryItem>) =>
    onUpdate({ inventory: character.inventory.map((i) => i.id === id ? { ...i, ...patch } : i) });

  const remove = (id: string) =>
    onUpdate({ inventory: character.inventory.filter((i) => i.id !== id) });

  const toggleFavorite = (id: string) =>
    onUpdate({
      inventory: character.inventory.map((i) =>
        i.id === id ? { ...i, isFavorite: !i.isFavorite } : i
      ),
    });

  const filteredItems = useMemo(() => {
    if (search === "") return character.inventory;
    return character.inventory.filter((i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      (i.description?.toLowerCase().includes(search.toLowerCase()) ?? false)
    );
  }, [character.inventory, search]);

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
          <p className="bento-label">Items ({character.inventory.length})</p>
          {canEdit && (
            <button onClick={() => setAddingItem(true)}
              className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded transition-colors">
              + Add item
            </button>
          )}
        </div>

        {/* Search */}
        {character.inventory.length > 4 && (
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search inventory…"
            className="w-full mb-2 bg-stone-900/60 border border-stone-700 rounded-lg px-2.5 py-1.5 text-xs text-stone-200 outline-none focus:border-emerald-600 placeholder-stone-600"
          />
        )}

        {filteredItems.length === 0 ? (
          <p className="text-xs text-stone-600 italic text-center py-6">
            {character.inventory.length === 0
              ? `No items yet.${canEdit ? " Click \"+ Add item\"." : ""}`
              : "No items match your search."}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {filteredItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                canEdit={canEdit}
                isGM={isGM}
                isEditing={editingId === item.id}
                onRoll={item.formula ? () => setRollPending({ label: item.name, formula: item.formula! }) : undefined}
                onToggleFavorite={() => toggleFavorite(item.id)}
                onSetQuantity={(q) => update(item.id, { quantity: Math.max(0, q) })}
                onDelete={() => remove(item.id)}
                onEdit={() => setEditingId(editingId === item.id ? null : item.id)}
                onUpdate={(patch) => update(item.id, patch)}
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

// ── ItemRow ───────────────────────────────────────────────────────

function ItemRow({ item, canEdit, isEditing, onRoll, onToggleFavorite, onSetQuantity, onDelete, onEdit, onUpdate }: {
  item: InventoryItem;
  canEdit: boolean;
  isGM: boolean;
  isEditing: boolean;
  onRoll?: () => void;
  onToggleFavorite: () => void;
  onSetQuantity: (q: number) => void;
  onDelete: () => void;
  onEdit: () => void;
  onUpdate: (patch: Partial<InventoryItem>) => void;
}) {
  const slotLabel = item.slots === 0 ? "neg." : item.slots === 0.5 ? "½ slot" : item.slots === 2 ? "2 slots" : "1 slot";

  return (
    <div className="rounded-lg border border-stone-700/40 bg-stone-900/40 overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-200 truncate">{item.name}</span>
            <span className="text-[9px] text-stone-500 shrink-0">{slotLabel}</span>
            {item.isArmor && <span className="text-[9px] text-sky-400 shrink-0">🛡</span>}
          </div>
          {item.formula && <span className="text-[10px] font-mono text-amber-300/70">{item.formula}</span>}
        </div>

        {/* Quantity */}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit ? (
            <div className="flex items-center gap-1">
              <button onClick={() => onSetQuantity(item.quantity - 1)}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600">−</button>
              <span className="text-xs text-stone-300 w-5 text-center">{item.quantity}</span>
              <button onClick={() => onSetQuantity(item.quantity + 1)}
                className="w-5 h-5 rounded bg-stone-700 text-stone-300 text-xs font-bold hover:bg-stone-600">+</button>
            </div>
          ) : (
            <span className="text-xs text-stone-400">×{item.quantity}</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {/* Favorite toggle — always visible, ☆/⭐ */}
          <button onClick={onToggleFavorite}
            className={`text-sm transition-colors ${item.isFavorite ? "text-amber-400" : "text-stone-600 hover:text-stone-400 text-[22px] pb-0.5"}`}
            title={item.isFavorite ? "Remove from favorites" : "Add to favorites"}>
            {item.isFavorite ? "⭐" : "☆"}
          </button>
          {onRoll && (
            <button onClick={onRoll}
              className="px-2 py-1 rounded bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-300 text-[10px] font-bold border border-emerald-800/40 transition-all active:scale-95">
              🎲
            </button>
          )}
        </div>
      </div>

      {/* Expanded edit panel */}
      {isEditing && (
        <div className="px-3 pb-3 border-t border-stone-700/40 pt-2 flex flex-col gap-2">
          {item.description && (
            <p className="text-xs text-stone-400 leading-relaxed">{item.description}</p>
          )}
          {canEdit && (
            <>
              {/* Inline name edit */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-stone-500 uppercase">Name</span>
                <input value={item.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                  className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-emerald-600"
                />
              </div>
              {/* Formula edit */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-stone-500 uppercase">Roll formula</span>
                <input value={item.formula ?? ""}
                  onChange={(e) => onUpdate({ formula: e.target.value || undefined })}
                  placeholder="e.g. 1d6+STR"
                  className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-emerald-600 placeholder-stone-600"
                />
              </div>
              {/* Description edit */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-stone-500 uppercase">Description</span>
                <textarea value={item.description ?? ""}
                  onChange={(e) => onUpdate({ description: e.target.value })}
                  rows={2}
                  className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300 outline-none resize-none focus:border-emerald-600"
                />
              </div>
              {/* Slots */}
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-stone-500 uppercase">Slots</span>
                  <select value={item.slots}
                    onChange={(e) => onUpdate({ slots: parseFloat(e.target.value) })}
                    className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-emerald-600">
                    <option value={0}>Negligible</option>
                    <option value={0.5}>½ slot</option>
                    <option value={1}>1 slot</option>
                    <option value={2}>2 slots</option>
                  </select>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer mt-3">
                  <input type="checkbox" checked={item.isArmor ?? false}
                    onChange={(e) => onUpdate({ isArmor: e.target.checked })}
                    className="accent-sky-500" />
                  <span className="text-[10px] text-stone-400">Is armor</span>
                </label>
              </div>
              <button onClick={onDelete}
                className="text-[10px] text-rose-500 hover:text-rose-400 self-start mt-1">
                Remove item
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── CurrencyField ─────────────────────────────────────────────────

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

function IInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-stone-500 uppercase">{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-emerald-600 placeholder-stone-600" />
    </div>
  );
}
