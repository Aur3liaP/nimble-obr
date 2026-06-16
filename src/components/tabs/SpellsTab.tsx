/**
 * SpellsTab — refactorisé avec BentoSection, FavoriteButton, RollButton,
 * RowActions, TextAction, FormField, GridFields, TabPills, ModalShell.
 */

import { useState, useMemo } from "react";
import type {
  NimbleCharacter,
  CharacterAction,
  SpellSchool,
  DiceRollRequest,
} from "../../types/character";
import { DiceRollModal } from "../ui/DiceRollModal";
import { resolveFormulaDisplay } from "../../utils/formulaParser";
import { BASE_SPELLS } from "../../data/spells";
import { BentoSection } from "../ui/common/BentoSection";
import { FavoriteButton } from "../ui/common/FavoriteButton";
import { RollButton } from "../ui/common/RollButton";
import { RowActions, TextAction } from "../ui/common/RowActions";
import { FormField, GridFields } from "../ui/common/FormField";
import { TabPills } from "../ui/common/TabPills";
import { ModalShell } from "../ui/common/ModalShell";

// ── Constants ─────────────────────────────────────────────────────

const TIER_LABELS: Record<number, string> = {
  0: "Cantrips", 1: "Tier I",   2: "Tier II",  3: "Tier III",
  4: "Tier IV",  5: "Tier V",   6: "Tier VI",  7: "Tier VII",
  8: "Tier VIII",9: "Tier IX",
};

const SCHOOL_STYLES: Record<SpellSchool, string> = {
  fire:       "text-orange-300 border-orange-800/60 bg-orange-950/30",
  ice:        "text-cyan-300 border-cyan-800/60 bg-cyan-950/30",
  lightning:  "text-yellow-300 border-yellow-800/60 bg-yellow-950/30",
  wind:       "text-teal-300 border-teal-800/60 bg-teal-950/30",
  radiant:    "text-amber-300 border-amber-800/60 bg-amber-950/30",
  necrotic:   "text-purple-300 border-purple-800/60 bg-purple-950/30",
  terramancy: "text-lime-300 border-lime-800/60 bg-lime-950/30",
  utility:    "text-stone-300 border-stone-600/60 bg-stone-800/30",
};

const SCHOOL_ICONS: Record<SpellSchool, string> = {
  fire: "🔥", ice: "❄️", lightning: "⚡", wind: "💨",
  radiant: "✨", necrotic: "💀", terramancy: "🌿", utility: "🔮",
};

const SCHOOLS: SpellSchool[] = [
  "fire", "ice", "lightning", "wind", "radiant", "necrotic", "terramancy", "utility",
];

const TIERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// ── Types ─────────────────────────────────────────────────────────

interface Props {
  character: NimbleCharacter;
  canEdit: boolean;
  isGM: boolean;
  onUpdate: (u: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
}

type AddMode = "list" | "custom";

// ── AddSpellModal ─────────────────────────────────────────────────

function AddSpellModal({
  existingIds,
  onAdd,
  onCancel,
}: {
  existingIds: Set<string>;
  onAdd: (s: CharacterAction) => void;
  onCancel: () => void;
}) {
  const [mode, setMode]               = useState<AddMode>("list");
  const [search, setSearch]           = useState("");
  const [filterSchool, setFilterSchool] = useState<SpellSchool | "all">("all");
  const [filterTier, setFilterTier]   = useState<number | "all">("all");

  const [form, setForm] = useState({
    name: "", tier: 0, manaCost: 0,
    school: "" as SpellSchool | "",
    range: "", damage: "", description: "",
  });
  const setF = (k: string, v: string | number) => setForm((p) => ({ ...p, [k]: v }));

  // Suppress unused warning — kept for future duplicate detection
  void existingIds;

  const filteredBase = useMemo(() => BASE_SPELLS.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchSchool = filterSchool === "all" || s.spellSchool === filterSchool;
    const matchTier   = filterTier   === "all" || s.spellTier   === filterTier;
    return matchSearch && matchSchool && matchTier;
  }), [search, filterSchool, filterTier]);

  const handleAddFromList = (template: (typeof BASE_SPELLS)[0]) => {
    onAdd({
      id: `sp-${crypto.randomUUID()}`,
      name: template.name,
      type: "spell",
      range: template.range,
      damage: template.damage,
      formula: template.formula || template.damage,
      description: template.description,
      isFavorite: false,
      isCustom: false,
      spellTier: template.spellTier,
      spellSchool: template.spellSchool as SpellSchool | undefined,
      manaCost: template.manaCost ?? (template.spellTier === 0 ? 0 : template.spellTier),
      actionCost: template.actionCost,
    });
  };

  // Tier pills options
  const tierOptions = [
    { value: "all" as const, label: "All" },
    ...TIERS.map((t) => ({ value: t as number | "all", label: TIER_LABELS[t] })),
  ];

  const modeTabs = (
    <div className="flex gap-1">
      {(["list", "custom"] as AddMode[]).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`flex-1 py-1 rounded text-[11px] font-semibold transition-all ${
            mode === m
              ? "bg-violet-900/60 border border-violet-600/60 text-violet-300"
              : "bg-stone-800 border border-stone-700 text-stone-400 hover:text-stone-200"
          }`}
        >
          {m === "list" ? "📚 From list" : "✏️ Custom"}
        </button>
      ))}
    </div>
  );

  const cancelFooter = (
    <button
      onClick={onCancel}
      className="w-full py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors"
    >
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
            id: `sp-${Date.now()}`,
            name: form.name,
            type: "spell",
            range: form.range,
            damage: form.damage,
            formula: form.damage,
            description: form.description,
            isFavorite: false,
            isCustom: true,
            spellTier: form.tier,
            spellSchool: (form.school as SpellSchool) || undefined,
            manaCost: form.tier === 0 ? 0 : form.manaCost,
          });
        }}
        className="flex-1 py-2 rounded-lg bg-violet-800 hover:bg-violet-700 text-violet-100 text-sm font-bold transition-colors"
      >
        Add
      </button>
    </div>
  );

  return (
    <ModalShell
      title="Add Spell / Cantrip"
      accent="violet"
      onClose={onCancel}
      maxWidth="max-w-sm"
      headerExtra={modeTabs}
      footer={mode === "list" ? cancelFooter : addCustomFooter}
    >
      {mode === "list" ? (
        <div className="flex flex-col">
          {/* Search + filters */}
          <div className="px-3 pt-3 pb-2 flex flex-col gap-2 border-b border-stone-800">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search spells…"
              className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-xs text-stone-200 outline-none focus:border-violet-600 placeholder-stone-600"
            />
            <div className="flex gap-1.5 flex-wrap">
              <select
                value={filterSchool}
                onChange={(e) => setFilterSchool(e.target.value as SpellSchool | "all")}
                className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-[10px] text-stone-300 outline-none focus:border-violet-600"
              >
                <option value="all">All schools</option>
                {SCHOOLS.map((s) => (
                  <option key={s} value={s}>{SCHOOL_ICONS[s]} {s}</option>
                ))}
              </select>
              <TabPills
                options={tierOptions}
                active={filterTier}
                onChange={(v) => setFilterTier(v)}
                accent="violet"
              />
            </div>
          </div>

          {/* Spell list */}
          <div className="p-2 flex flex-col gap-1">
            {filteredBase.length === 0 && (
              <p className="text-xs text-stone-600 italic text-center py-6">No spells match your search.</p>
            )}
            {filteredBase.map((spell, idx) => {
              const school = spell.spellSchool as SpellSchool | undefined;
              const schoolStyle = school ? SCHOOL_STYLES[school] : "text-violet-300 border-violet-800/60";
              const icon = school ? SCHOOL_ICONS[school] : "✨";
              return (
                <button
                  key={idx}
                  onClick={() => handleAddFromList(spell)}
                  className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-stone-700/40 bg-stone-900/40 hover:bg-violet-950/40 hover:border-violet-700/40 transition-all text-left w-full group"
                >
                  <span className="mt-0.5 shrink-0">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-stone-200">{spell.name}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${schoolStyle}`}>
                        {school ?? (spell.spellTier === 0 ? "cantrip" : TIER_LABELS[spell.spellTier ?? 0])}
                      </span>
                      {(spell.spellTier ?? 0) > 0 && (
                        <span className="text-[9px] text-violet-400">T{spell.spellTier}</span>
                      )}
                    </div>
                    {spell.formula && (
                      <span className="text-[10px] font-mono text-amber-300/70">{spell.formula}</span>
                    )}
                    <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2 leading-relaxed">
                      {spell.description}
                    </p>
                  </div>
                  <span className="text-[10px] text-violet-500 group-hover:text-violet-300 shrink-0 mt-1">+ Add</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* Custom spell form */
        <div className="p-4 flex flex-col gap-3">
          <FormField label="Name *" value={form.name} onChange={(v) => setF("name", v)} />
          <GridFields>
            <FormField label="Tier" as="select" value={form.tier}
              onChange={(v) => { const t = parseInt(v); setF("tier", t); setF("manaCost", t); }}>
              {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
            </FormField>
            <FormField label="School" as="select" value={form.school} onChange={(v) => setF("school", v)}>
              <option value="">— none —</option>
              {SCHOOLS.map((s) => <option key={s} value={s}>{SCHOOL_ICONS[s]} {s}</option>)}
            </FormField>
          </GridFields>
          <GridFields>
            <FormField label="Range" value={form.range} onChange={(v) => setF("range", v)} placeholder="e.g. range 6" />
            <FormField label="Damage / Formula" value={form.damage} onChange={(v) => setF("damage", v)} placeholder="e.g. 2d6+INT" />
          </GridFields>
          {form.tier > 0 && (
            <FormField label="Mana cost" type="number" value={form.manaCost}
              onChange={(v) => setF("manaCost", parseInt(v) || 0)} />
          )}
          <FormField label="Description" as="textarea" value={form.description}
            onChange={(v) => setF("description", v)} rows={3} />
        </div>
      )}
    </ModalShell>
  );
}

// ── Main SpellsTab ────────────────────────────────────────────────

export function SpellsTab({ character, canEdit, isGM, onUpdate, onRoll }: Props) {
  const [rollPending, setRollPending] = useState<{ label: string; formula: string } | null>(null);
  const [addingSpell, setAddingSpell] = useState(false);
  const [filterTier, setFilterTier]   = useState<number | "all">("all");
  const [search, setSearch]           = useState("");
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [editingId, setEditingId]     = useState<string | null>(null);

  const spells = character.actions.filter((a) => a.type === "spell");
  const tiers  = [...new Set(spells.map((s) => s.spellTier ?? 0))].sort();

  const visible = useMemo(() => spells.filter((s) => {
    const matchTier   = filterTier === "all" || (s.spellTier ?? 0) === filterTier;
    const matchSearch = search === "" ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description?.toLowerCase().includes(search.toLowerCase()) ?? false);
    return matchTier && matchSearch;
  }), [spells, filterTier, search]);

  const updateSpell = (id: string, patch: Partial<CharacterAction>) =>
    onUpdate({ actions: character.actions.map((a) => a.id === id ? { ...a, ...patch } : a) });

  const deleteSpell = (id: string) =>
    onUpdate({ actions: character.actions.filter((a) => a.id !== id) });

  const handleRowClick = (id: string) => {
    if (editingId === id) { setEditingId(null); setExpandedId(id); return; }
    setExpandedId((prev) => prev === id ? null : id);
  };

  const handleEditToggle = (id: string) => {
    if (editingId === id) { setEditingId(null); return; }
    setEditingId(id);
    setExpandedId(null);
  };

  // Tier filter pills — only shown when there are multiple tiers
  const tierPillOptions = tiers.length > 1
    ? [{ value: "all" as number | "all", label: "All" }, ...tiers.map((t) => ({ value: t as number | "all", label: TIER_LABELS[t] ?? `Tier ${t}` }))]
    : [];

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* ── Mana ─────────────────────────────────────────────────── */}
      <BentoSection>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-violet-950/40 border border-violet-800/40">
            <span className="text-[10px] text-violet-400 uppercase tracking-wider">Mana</span>
            <div className="flex items-baseline gap-1">
              <input
                type="number" value={character.mana} min={0} max={character.maxMana}
                disabled={!canEdit}
                onChange={(e) => onUpdate({ mana: Math.max(0, parseInt(e.target.value) || 0) })}
                className="w-14 text-center text-3xl font-black bg-transparent text-violet-200 outline-none border-b border-violet-800 focus:border-violet-500 disabled:border-transparent"
              />
              <span className="text-stone-500 text-sm"> / </span>
              <input
                type="number" value={character.maxMana} min={0} disabled={!canEdit}
                onChange={(e) => onUpdate({ maxMana: parseInt(e.target.value) || 0 })}
                className="w-10 text-center text-base font-semibold bg-transparent text-violet-300 outline-none border-b border-stone-700 focus:border-violet-500 disabled:border-transparent"
              />
            </div>
          </div>
          <div className="flex-1">
            <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all bg-gradient-to-r from-violet-700 to-violet-400"
                style={{ width: `${character.maxMana > 0 ? (character.mana / character.maxMana) * 100 : 0}%` }}
              />
            </div>
            <p className="text-[10px] text-stone-500 mt-1">
              Spell tier ≈ mana cost · cantrips are free
            </p>
          </div>
        </div>
      </BentoSection>

      {/* ── Search + tier filter ──────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your spells…"
          className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-1.5 text-xs text-stone-200 outline-none focus:border-violet-600 placeholder-stone-600"
        />
        {tierPillOptions.length > 0 && (
          <TabPills
            options={tierPillOptions}
            active={filterTier}
            onChange={setFilterTier}
            accent="violet"
          />
        )}
      </div>

      {/* ── Spell list ───────────────────────────────────────────── */}
      <BentoSection
        label={`Spells & Cantrips (${spells.length})`}
        action={
          canEdit && (
            <button
              onClick={() => setAddingSpell(true)}
              className="text-xs text-violet-400 hover:text-violet-300 border border-violet-800/60 px-2 py-0.5 rounded transition-colors"
            >
              + Add spell
            </button>
          )
        }
      >
        {visible.length === 0 ? (
          <p className="text-xs text-stone-600 italic text-center py-6">
            {spells.length === 0 ? "No spells known." : "No spells match your search."}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visible.map((spell) => (
              <SpellRow
                key={spell.id}
                spell={spell}
                character={character}
                canEdit={canEdit}
                isExpanded={expandedId === spell.id}
                isEditing={editingId === spell.id}
                onRowClick={() => handleRowClick(spell.id)}
                onEditToggle={() => handleEditToggle(spell.id)}
                onRoll={() => setRollPending({ label: spell.name, formula: spell.formula || spell.damage })}
                onToggleFavorite={() => onUpdate({
                  actions: character.actions.map((a) =>
                    a.id === spell.id ? { ...a, isFavorite: !a.isFavorite } : a
                  ),
                })}
                onDelete={() => { deleteSpell(spell.id); setEditingId(null); setExpandedId(null); }}
                onUpdate={(patch) => updateSpell(spell.id, patch)}
              />
            ))}
          </div>
        )}
      </BentoSection>

      {/* ── Notes ────────────────────────────────────────────────── */}
      <BentoSection label="Spell Notes">
        {canEdit ? (
          <textarea
            value={character.spellNotes}
            onChange={(e) => onUpdate({ spellNotes: e.target.value })}
            rows={3}
            placeholder="Concentration, spell-specific rules…"
            className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-300 outline-none resize-none focus:border-amber-700/60 placeholder-stone-600"
          />
        ) : (
          <p className="text-xs text-stone-400 whitespace-pre-wrap">
            {character.spellNotes || <span className="text-stone-600 italic">No notes.</span>}
          </p>
        )}
      </BentoSection>

      {addingSpell && (
        <AddSpellModal
          existingIds={new Set(spells.map((s) => s.id))}
          onAdd={(s) => { onUpdate({ actions: [...character.actions, s] }); setAddingSpell(false); }}
          onCancel={() => setAddingSpell(false)}
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

// ── SpellRow ──────────────────────────────────────────────────────

function SpellRow({
  spell, character, canEdit, isExpanded, isEditing,
  onRowClick, onEditToggle, onRoll, onToggleFavorite, onDelete, onUpdate,
}: {
  spell: CharacterAction;
  character: NimbleCharacter;
  canEdit: boolean;
  isExpanded: boolean;
  isEditing: boolean;
  onRowClick: () => void;
  onEditToggle: () => void;
  onRoll: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<CharacterAction>) => void;
}) {
  const tier        = spell.spellTier ?? 0;
  const school      = spell.spellSchool;
  const schoolStyle = school
    ? SCHOOL_STYLES[school]
    : "text-violet-300 border-violet-800/60 bg-violet-950/30";
  const schoolIcon  = school ? SCHOOL_ICONS[school] : "✨";
  const resolvedFormula = resolveFormulaDisplay(spell.formula || spell.damage, character);

  return (
    <div className={`rounded-lg border overflow-hidden transition-colors ${
      isEditing ? "border-violet-700/60 bg-violet-950/10" : "border-stone-700/40 bg-stone-900/40"
    }`}>
      {/* Main row */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span>{schoolIcon}</span>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={onRowClick}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-stone-200 truncate">{spell.name}</span>
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${schoolStyle}`}>
              {school ?? (tier === 0 ? "cantrip" : TIER_LABELS[tier])}
            </span>
            {tier > 0 && <span className="text-[9px] text-violet-400">T{tier}</span>}
            {spell.manaCost != null && spell.manaCost > 0 && (
              <span className="text-[9px] text-violet-400">✦{spell.manaCost}</span>
            )}
          </div>
          {resolvedFormula && (
            <span className="text-[10px] font-mono text-amber-300/80">{resolvedFormula}</span>
          )}
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <FavoriteButton isFavorite={spell.isFavorite} canEdit={canEdit} onToggle={onToggleFavorite} />
          {canEdit && (spell.formula || spell.damage) && (
            <RollButton onClick={onRoll} accent="violet" />
          )}
        </div>
      </div>

      {/* Description panel */}
      {isExpanded && !isEditing && (
        <div className="px-3 pb-2.5 border-t border-stone-700/40 pt-2">
          <div className="flex justify-between items-start">
            <div>
              {spell.range && (
                <p className="text-[10px] text-stone-500 mb-1">
                  📍 {spell.range}
                  {spell.actionCost ? ` · ${spell.actionCost} action${spell.actionCost > 1 ? "s" : ""}` : ""}
                </p>
              )}
            </div>
            <RowActions
              onEdit={canEdit ? onEditToggle : undefined}
              onDelete={onDelete}
              canEdit={canEdit}
            />
          </div>
          <p className="text-xs text-stone-400 leading-relaxed">
            {spell.description || <span className="italic text-stone-600">No description.</span>}
          </p>
        </div>
      )}

      {/* Edit panel */}
      {isEditing && (
        <div className="px-3 pb-3 border-t border-violet-800/30 pt-2 flex flex-col gap-2">
          <FormField label="Name" value={spell.name} onChange={(v) => onUpdate({ name: v })} />
          <GridFields>
            <FormField label="Range" value={spell.range ?? ""} onChange={(v) => onUpdate({ range: v })} placeholder="e.g. 8" />
            <FormField label="Formula" value={spell.formula ?? spell.damage ?? ""} onChange={(v) => onUpdate({ formula: v, damage: v })} placeholder="e.g. 2d6+INT" />
          </GridFields>
          <GridFields>
            <FormField label="Tier" as="select" value={spell.spellTier ?? 0}
              onChange={(v) => {
                const t = parseInt(v);
                onUpdate({ spellTier: t, manaCost: t === 0 ? 0 : (spell.manaCost ?? t) });
              }}>
              {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
            </FormField>
            <FormField label="Mana cost" type="number" value={spell.manaCost ?? 0}
              onChange={(v) => onUpdate({ manaCost: parseInt(v) || 0 })} />
          </GridFields>
          <FormField label="School" as="select" value={spell.spellSchool ?? ""}
            onChange={(v) => onUpdate({ spellSchool: (v as SpellSchool) || undefined })}>
            <option value="">— none —</option>
            {SCHOOLS.map((s) => <option key={s} value={s}>{SCHOOL_ICONS[s]} {s}</option>)}
          </FormField>
          <FormField label="Description" as="textarea" value={spell.description ?? ""}
            onChange={(v) => onUpdate({ description: v })} rows={3} />
          <div className="flex justify-between items-center mt-1">
            <TextAction onClick={onDelete} label="Remove spell" variant="danger" />
            <TextAction onClick={onEditToggle} label="OK" variant="confirm" />
          </div>
        </div>
      )}
    </div>
  );
}
