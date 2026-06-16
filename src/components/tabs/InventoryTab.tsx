/**
 * InventoryTab — refactorisé avec BentoSection, FavoriteButton, RollButton,
 * RowActions, TextAction, FormField, GridFields, ModalShell, NumericStepper.
 */

import { useState, useMemo } from "react";
import type { NimbleCharacter, InventoryItem, DiceRollRequest } from "../../types/character";
import { DiceRollModal } from "../ui/DiceRollModal";
import { BASIC_EQUIPMENTS } from "../../data/equipment";
import { BentoSection } from "../ui/common/BentoSection";
import { FavoriteButton } from "../ui/common/FavoriteButton";
import { RollButton } from "../ui/common/RollButton";
import { RowActions, TextAction } from "../ui/common/RowActions";
import { FormField, GridFields } from "../ui/common/FormField";
import { NumericStepper } from "../ui/common/NumericStepper";
import { ModalShell } from "../ui/common/ModalShell";

// ── Types & helpers ───────────────────────────────────────────────

interface Props {
  character: NimbleCharacter;
  canEdit: boolean;
  isGM: boolean;
  onUpdate: (u: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
}

type ItemCategory = "all" | "armor" | "weapon" | "consumable" | "gear";
type AddMode = "list" | "custom";

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  all: "All", armor: "🛡 Armor", weapon: "⚔️ Weapons",
  consumable: "🧪 Consumables", gear: "🎒 Gear",
};

const SLOT_LABEL: Record<string, string> = {
  "0": "neg.", "0.5": "½ slot", "1": "1 slot", "2": "2 slots",
};

function slotLabel(slots: number): string {
  return SLOT_LABEL[String(slots)] ?? `${slots} slots`;
}

function guessCategory(item: (typeof BASIC_EQUIPMENTS)[0]): ItemCategory {
  if (item.isArmor) return "armor";
  if (item.formula && (item.name.toLowerCase().includes("potion") || item.slots === 0.5)) return "consumable";
  if (item.actionCost && item.formula) return "weapon";
  return "gear";
}

function itemIcon(item: { isArmor?: boolean; actionCost?: number; formula?: string; slots: number }): string {
  if (item.isArmor) return "🛡";
  if (item.actionCost && item.formula) return "⚔️";
  if (item.slots === 0.5) return "🧪";
  return "🎒";
}

// ── AddItemModal ──────────────────────────────────────────────────

function AddItemModal({
  onAdd, onCancel,
}: {
  onAdd: (i: InventoryItem) => void;
  onCancel: () => void;
}) {
  const [mode, setMode]         = useState<AddMode>("list");
  const [search, setSearch]     = useState("");
  const [filterCat, setFilterCat] = useState<ItemCategory>("all");

  const [form, setForm] = useState({
    name: "", description: "", slots: 1, formula: "", isFavorite: false, isArmor: false,
  });
  const setF = (k: string, v: string | number | boolean) => setForm((p) => ({ ...p, [k]: v }));

  const filteredBase = useMemo(() => BASIC_EQUIPMENTS.filter((item) => {
    const matchSearch = search === "" ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.description?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchCat = filterCat === "all" || guessCategory(item) === filterCat;
    return matchSearch && matchCat;
  }), [search, filterCat]);

  const handleAddFromList = (template: (typeof BASIC_EQUIPMENTS)[0]) => {
    onAdd({
      id: `i-${crypto.randomUUID()}`,
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

  const categoryOptions = (["all", "armor", "weapon", "consumable", "gear"] as ItemCategory[]).map(
    (cat) => ({ value: cat, label: CATEGORY_LABELS[cat] }),
  );

  const modeTabs = (
    <div className="flex gap-1">
      {(["list", "custom"] as AddMode[]).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`flex-1 py-1 rounded text-[11px] font-semibold transition-all ${
            mode === m
              ? "bg-emerald-900/60 border border-emerald-600/60 text-emerald-300"
              : "bg-stone-800 border border-stone-700 text-stone-400 hover:text-stone-200"
          }`}
        >
          {m === "list" ? "📚 From list" : "✏️ Custom"}
        </button>
      ))}
    </div>
  );

  const cancelFooter = (
    <button onClick={onCancel} className="w-full py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors">
      Cancel
    </button>
  );

  const addCustomFooter = (
    <div className="flex gap-2">
      <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors">
        Cancel
      </button>
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
        className="flex-1 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-sm font-bold transition-colors"
      >
        Add
      </button>
    </div>
  );

  return (
    <ModalShell
      title="Add Item"
      accent="emerald"
      onClose={onCancel}
      maxWidth="max-w-sm"
      headerExtra={modeTabs}
      footer={mode === "list" ? cancelFooter : addCustomFooter}
    >
      {mode === "list" ? (
        <div className="flex flex-col">
          {/* Search + category filter */}
          <div className="px-3 pt-3 pb-2 flex flex-col gap-2 border-b border-stone-800">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-xs text-stone-200 outline-none focus:border-emerald-600 placeholder-stone-600"
            />
            <div className="flex gap-1 flex-wrap">
              {categoryOptions.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setFilterCat(value)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                    filterCat === value
                      ? "border-emerald-600 bg-emerald-900/50 text-emerald-300"
                      : "border-stone-700 bg-stone-800/40 text-stone-400 hover:border-stone-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Item list */}
          <div className="p-2 flex flex-col gap-1">
            {filteredBase.length === 0 && (
              <p className="text-xs text-stone-600 italic text-center py-6">No items match your search.</p>
            )}
            {filteredBase.map((item, idx) => (
              <button
                key={idx}
                onClick={() => handleAddFromList(item)}
                className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-stone-700/40 bg-stone-900/40 hover:bg-emerald-950/30 hover:border-emerald-700/40 transition-all text-left w-full group"
              >
                <span className="mt-0.5 text-sm shrink-0">{itemIcon(item)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-stone-200">{item.name}</span>
                    <span className="text-[9px] text-stone-500">{slotLabel(item.slots)}</span>
                  </div>
                  {item.formula && (
                    <span className="text-[10px] font-mono text-amber-300/70">{item.formula}</span>
                  )}
                  <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                </div>
                <span className="text-[10px] text-emerald-500 group-hover:text-emerald-300 shrink-0 mt-1">+ Add</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Custom item form */
        <div className="p-4 flex flex-col gap-3">
          <FormField label="Name *" value={form.name} onChange={(v) => setF("name", v)} />
          <GridFields>
            <FormField label="Slots" as="select" value={form.slots} onChange={(v) => setF("slots", parseFloat(v))}>
              <option value={0}>Negligible</option>
              <option value={0.5}>½ slot (×2 per slot)</option>
              <option value={1}>1 slot</option>
              <option value={2}>2 slots</option>
            </FormField>
            <FormField label="Roll formula" value={form.formula} onChange={(v) => setF("formula", v)} placeholder="e.g. 1d6+DEX" />
          </GridFields>
          <FormField label="Description" as="textarea" value={form.description} onChange={(v) => setF("description", v)} rows={2} />
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
      )}
    </ModalShell>
  );
}

// ── Main InventoryTab ─────────────────────────────────────────────

export function InventoryTab({ character, canEdit, isGM, onUpdate, onRoll }: Props) {
  const [rollPending, setRollPending] = useState<{ label: string; formula: string } | null>(null);
  const [addingItem, setAddingItem]   = useState(false);
  const [search, setSearch]           = useState("");
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [editingId, setEditingId]     = useState<string | null>(null);

  const maxSlots  = 10 + character.stats.str;
  const usedSlots = character.inventory.reduce((s, i) => s + i.slots * i.quantity, 0);
  const slotPct   = Math.min(100, (usedSlots / maxSlots) * 100);

  const update = (id: string, patch: Partial<InventoryItem>) =>
    onUpdate({ inventory: character.inventory.map((i) => i.id === id ? { ...i, ...patch } : i) });

  const remove = (id: string) =>
    onUpdate({ inventory: character.inventory.filter((i) => i.id !== id) });

  const filteredItems = useMemo(() => {
    if (search === "") return character.inventory;
    return character.inventory.filter(
      (i) =>
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        (i.description?.toLowerCase().includes(search.toLowerCase()) ?? false),
    );
  }, [character.inventory, search]);

  const handleRowClick = (id: string) => {
    if (editingId === id) { setEditingId(null); setExpandedId(id); return; }
    setExpandedId((prev) => prev === id ? null : id);
  };

  const handleEditToggle = (id: string) => {
    if (editingId === id) { setEditingId(null); return; }
    setEditingId(id);
    setExpandedId(null);
  };

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* ── Slots ────────────────────────────────────────────────── */}
      <BentoSection>
        <div className="flex items-center justify-between mb-1.5">
          <p className="bento-label">Inventory Slots</p>
          <span className="text-xs font-semibold text-stone-300">
            {usedSlots} / {maxSlots}
            <span className="text-[10px] text-stone-500 ml-1">(10+STR)</span>
          </span>
        </div>
        <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              slotPct >= 100 ? "bg-rose-600" : slotPct >= 75 ? "bg-amber-500" : "bg-emerald-500"
            }`}
            style={{ width: `${slotPct}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {Array.from({ length: maxSlots }).map((_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-sm border transition-colors ${
                i < usedSlots
                  ? usedSlots > maxSlots
                    ? "border-rose-600 bg-rose-700"
                    : "border-amber-700 bg-amber-800"
                  : "border-stone-700 bg-stone-800/40"
              }`}
            />
          ))}
        </div>
      </BentoSection>

      {/* ── Currency ─────────────────────────────────────────────── */}
      <BentoSection>
        <div className="flex items-center gap-4">
          <CurrencyField label="Gold"   emoji="🪙" value={character.gold}   canEdit={canEdit} onChange={(v) => onUpdate({ gold: v })}   textColor="text-amber-300" />
          <CurrencyField label="Silver" emoji="🥈" value={character.silver} canEdit={canEdit} onChange={(v) => onUpdate({ silver: v })} textColor="text-slate-300" />
        </div>
      </BentoSection>

      {/* ── Items ────────────────────────────────────────────────── */}
      <BentoSection
        label={`Items (${character.inventory.length})`}
        action={
          canEdit && (
            <button
              onClick={() => setAddingItem(true)}
              className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded transition-colors"
            >
              + Add item
            </button>
          )
        }
      >
        {character.inventory.length > 4 && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search inventory…"
            className="w-full mb-2 bg-stone-900/60 border border-stone-700 rounded-lg px-2.5 py-1.5 text-xs text-stone-200 outline-none focus:border-emerald-600 placeholder-stone-600"
          />
        )}

        {filteredItems.length === 0 ? (
          <p className="text-xs text-stone-600 italic text-center py-6">
            {character.inventory.length === 0
              ? `No items yet.${canEdit ? ' Click "+ Add item".' : ""}`
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
                isExpanded={expandedId === item.id}
                isEditing={editingId === item.id}
                onRowClick={() => handleRowClick(item.id)}
                onEditToggle={() => handleEditToggle(item.id)}
                onRoll={item.formula ? () => setRollPending({ label: item.name, formula: item.formula! }) : undefined}
                onToggleFavorite={() => update(item.id, { isFavorite: !item.isFavorite })}
                onSetQuantity={(q) => update(item.id, { quantity: Math.max(0, q) })}
                onDelete={() => { remove(item.id); setEditingId(null); setExpandedId(null); }}
                onUpdate={(patch) => update(item.id, patch)}
              />
            ))}
          </div>
        )}
      </BentoSection>

      {/* ── Notes ────────────────────────────────────────────────── */}
      <BentoSection label="Notes">
        {canEdit ? (
          <textarea
            value={character.inventoryNotes}
            onChange={(e) => onUpdate({ inventoryNotes: e.target.value })}
            rows={3}
            placeholder="Equipment notes, encumbrance…"
            className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-300 outline-none resize-none focus:border-amber-700/60 placeholder-stone-600"
          />
        ) : (
          <p className="text-xs text-stone-400 whitespace-pre-wrap">
            {character.inventoryNotes || <span className="text-stone-600 italic">No notes.</span>}
          </p>
        )}
      </BentoSection>

      {addingItem && (
        <AddItemModal
          onAdd={(item) => { onUpdate({ inventory: [...character.inventory, item] }); setAddingItem(false); }}
          onCancel={() => setAddingItem(false)}
        />
      )}
      {rollPending && (
        <DiceRollModal
          label={rollPending.label}
          formula={rollPending.formula}
          isGM={isGM}
          onConfirm={(mode, ac, hidden) => {
            onRoll({ label: rollPending.label, formula: rollPending.formula, mode, advantageCount: ac, hidden });
            setRollPending(null);
          }}
          onCancel={() => setRollPending(null)}
        />
      )}
    </div>
  );
}

// ── ItemRow ───────────────────────────────────────────────────────

function ItemRow({
  item, canEdit, isExpanded, isEditing,
  onRowClick, onEditToggle, onRoll, onToggleFavorite,
  onSetQuantity, onDelete, onUpdate,
}: {
  item: InventoryItem;
  canEdit: boolean;
  isGM: boolean;
  isExpanded: boolean;
  isEditing: boolean;
  onRowClick: () => void;
  onEditToggle: () => void;
  onRoll?: () => void;
  onToggleFavorite: () => void;
  onSetQuantity: (q: number) => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<InventoryItem>) => void;
}) {
  return (
    <div className={`rounded-lg border overflow-hidden transition-colors ${
      isEditing ? "border-emerald-700/60 bg-emerald-950/10" : "border-stone-700/40 bg-stone-900/40"
    }`}>
      {/* Main row */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onRowClick}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-200 truncate">{item.name}</span>
            <span className="text-[9px] text-stone-500 shrink-0">{slotLabel(item.slots)}</span>
            {item.isArmor && <span className="text-[9px] text-sky-400 shrink-0">🛡</span>}
          </div>
          {item.formula && (
            <span className="text-[10px] font-mono text-amber-300/70">{item.formula}</span>
          )}
        </div>

        {/* Quantity — NumericStepper remplace les 3 boutons inline */}
        <div onClick={(e) => e.stopPropagation()}>
          {canEdit ? (
            <NumericStepper
              value={item.quantity}
              onChange={onSetQuantity}
              min={0}
              compact
            />
          ) : (
            <span className="text-xs text-stone-400">×{item.quantity}</span>
          )}
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <FavoriteButton isFavorite={item.isFavorite ?? false} canEdit={canEdit} onToggle={onToggleFavorite} />
          {canEdit && onRoll && <RollButton onClick={onRoll} accent="emerald" />}
        </div>
      </div>

      {/* Description panel */}
      {isExpanded && !isEditing && (
        <div className="px-3 pb-2.5 border-t border-stone-700/40 pt-2 flex justify-between items-start gap-2">
          <p className="text-xs text-stone-400 leading-relaxed flex-1">
            {item.description || <span className="italic text-stone-600">No description.</span>}
          </p>
          <RowActions
            onEdit={canEdit ? onEditToggle : undefined}
            onDelete={onDelete}
            canEdit={canEdit}
          />
        </div>
      )}

      {/* Edit panel */}
      {isEditing && (
        <div className="px-3 pb-3 border-t border-emerald-800/30 pt-2 flex flex-col gap-2">
          <FormField label="Name" value={item.name} onChange={(v) => onUpdate({ name: v })} />
          <FormField label="Roll formula" value={item.formula ?? ""} onChange={(v) => onUpdate({ formula: v || undefined })} placeholder="e.g. 1d6+STR" />
          <FormField label="Description" as="textarea" value={item.description ?? ""} onChange={(v) => onUpdate({ description: v })} rows={2} />
          <GridFields>
            <FormField label="Slots" as="select" value={item.slots} onChange={(v) => onUpdate({ slots: parseFloat(v) })}>
              <option value={0}>Negligible</option>
              <option value={0.5}>½ slot</option>
              <option value={1}>1 slot</option>
              <option value={2}>2 slots</option>
            </FormField>
            <div className="flex items-center gap-1.5 mt-4">
              <input
                type="checkbox"
                checked={item.isArmor ?? false}
                onChange={(e) => onUpdate({ isArmor: e.target.checked })}
                className="accent-sky-500"
              />
              <span className="text-[10px] text-stone-400">Is armor</span>
            </div>
          </GridFields>
          <div className="flex justify-between items-center mt-1">
            <TextAction onClick={onDelete} label="Remove item" variant="danger" />
            <TextAction onClick={onEditToggle} label="OK" variant="confirm" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── CurrencyField ─────────────────────────────────────────────────

function CurrencyField({
  label, emoji, value, canEdit, onChange, textColor,
}: {
  label: string; emoji: string; value: number; canEdit: boolean;
  onChange: (v: number) => void; textColor: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xl">{emoji}</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</span>
        {canEdit ? (
          <input
            type="number" value={value} min={0}
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
