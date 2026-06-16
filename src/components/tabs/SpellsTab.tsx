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

interface Props {
  character: NimbleCharacter;
  canEdit: boolean;
  isGM: boolean;
  onUpdate: (u: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
}

const TIER_LABELS: Record<number, string> = {
  0: "Cantrips",
  1: "Tier I",
  2: "Tier II",
  3: "Tier III",
  4: "Tier IV",
  5: "Tier V",
  6: "Tier VI",
  7: "Tier VII",
  8: "Tier VIII",
  9: "Tier IX",
};

const SCHOOL_STYLES: Record<SpellSchool, string> = {
  fire: "text-orange-300 border-orange-800/60 bg-orange-950/30",
  ice: "text-cyan-300 border-cyan-800/60 bg-cyan-950/30",
  lightning: "text-yellow-300 border-yellow-800/60 bg-yellow-950/30",
  wind: "text-teal-300 border-teal-800/60 bg-teal-950/30",
  radiant: "text-amber-300 border-amber-800/60 bg-amber-950/30",
  necrotic: "text-purple-300 border-purple-800/60 bg-purple-950/30",
  terramancy: "text-lime-300 border-lime-800/60 bg-lime-950/30",
  utility: "text-stone-300 border-stone-600/60 bg-stone-800/30",
};

const SCHOOL_ICONS: Record<SpellSchool, string> = {
  fire: "🔥",
  ice: "❄️",
  lightning: "⚡",
  wind: "💨",
  radiant: "✨",
  necrotic: "💀",
  terramancy: "🌿",
  utility: "🔮",
};

const SCHOOLS: SpellSchool[] = [
  "fire",
  "ice",
  "lightning",
  "wind",
  "radiant",
  "necrotic",
  "terramancy",
  "utility",
];

// ── Add spell modal ───────────────────────────────────────────────

type AddMode = "list" | "custom";

function AddSpellModal({
  existingIds,
  onAdd,
  onCancel,
}: {
  existingIds: Set<string>;
  onAdd: (s: CharacterAction) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<AddMode>("list");
  const [search, setSearch] = useState("");
  const [filterSchool, setFilterSchool] = useState<SpellSchool | "all">("all");
  const [filterTier, setFilterTier] = useState<number | "all">("all");

  const [form, setForm] = useState({
    name: "",
    tier: 0,
    manaCost: 0,
    school: "" as SpellSchool | "",
    range: "",
    damage: "",
    description: "",
  });
  const setF = (k: string, v: string | number) =>
    setForm((p) => ({ ...p, [k]: v }));

  const filteredBase = useMemo(() => {
    return BASE_SPELLS.filter((s) => {
      const matchSearch =
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description?.toLowerCase().includes(search.toLowerCase()) ?? false);
      const matchSchool =
        filterSchool === "all" || s.spellSchool === filterSchool;
      const matchTier = filterTier === "all" || s.spellTier === filterTier;
      return matchSearch && matchSchool && matchTier;
    });
  }, [search, filterSchool, filterTier]);

  const handleAddFromList = (template: (typeof BASE_SPELLS)[0]) => {
    const newId = crypto.randomUUID();
    onAdd({
      id: `sp-${newId}`,
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
      manaCost:
        template.manaCost ??
        (template.spellTier === 0 ? 0 : template.spellTier),
      actionCost: template.actionCost,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-85 max-h-[85vh] rounded-xl border border-stone-700 bg-stone-900 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-stone-800 px-4 py-3 border-b border-stone-700 shrink-0">
          <h3 className="text-sm font-bold text-violet-300">
            Add Spell / Cantrip
          </h3>
          <div className="flex gap-1 mt-2">
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
        </div>

        {mode === "list" ? (
          <>
            {/* Search + filters */}
            <div className="px-3 pt-3 pb-2 shrink-0 flex flex-col gap-2 border-b border-stone-800">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search spells…"
                className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-xs text-stone-200 outline-none focus:border-violet-600 placeholder-stone-600"
              />
              <div className="flex gap-1.5 flex-wrap">
                <select
                  value={filterSchool}
                  onChange={(e) =>
                    setFilterSchool(e.target.value as SpellSchool | "all")
                  }
                  className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-[10px] text-stone-300 outline-none focus:border-violet-600"
                >
                  <option value="all">All schools</option>
                  {SCHOOLS.map((s) => (
                    <option key={s} value={s}>
                      {SCHOOL_ICONS[s]} {s}
                    </option>
                  ))}
                </select>
                <select
                  value={filterTier}
                  onChange={(e) =>
                    setFilterTier(
                      e.target.value === "all"
                        ? "all"
                        : parseInt(e.target.value),
                    )
                  }
                  className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-[10px] text-stone-300 outline-none focus:border-violet-600"
                >
                  <option value="all">All tiers</option>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => (
                    <option key={t} value={t}>
                      {TIER_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Spell list */}
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
              {filteredBase.length === 0 && (
                <p className="text-xs text-stone-600 italic text-center py-6">
                  No spells match your search.
                </p>
              )}
              {filteredBase.map((spell, idx) => {
                const school = spell.spellSchool as SpellSchool | undefined;
                const schoolStyle = school
                  ? SCHOOL_STYLES[school]
                  : "text-violet-300 border-violet-800/60";
                const icon = school ? SCHOOL_ICONS[school] : "✨";
                // Check if already added (by name, since templates have no id)
                const alreadyAdded =
                  [...existingIds].some(() => false) ||
                  // We compare by name since templates don't have ids
                  false;
                void alreadyAdded; // suppress unused warning — kept for future use

                return (
                  <button
                    key={idx}
                    onClick={() => handleAddFromList(spell)}
                    className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-stone-700/40 bg-stone-900/40 hover:bg-violet-950/40 hover:border-violet-700/40 transition-all text-left w-full group"
                  >
                    <span className="mt-0.5 shrink-0">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-stone-200">
                          {spell.name}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${schoolStyle}`}
                        >
                          {school ??
                            (spell.spellTier === 0
                              ? "cantrip"
                              : TIER_LABELS[spell.spellTier ?? 0])}
                        </span>
                        {(spell.spellTier ?? 0) > 0 && (
                          <span className="text-[9px] text-violet-400">
                            T{spell.spellTier}
                          </span>
                        )}
                      </div>
                      {spell.formula && (
                        <span className="text-[10px] font-mono text-amber-300/70">
                          {spell.formula}
                        </span>
                      )}
                      <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2 leading-relaxed">
                        {spell.description}
                      </p>
                    </div>
                    <span className="text-[10px] text-violet-500 group-hover:text-violet-300 shrink-0 mt-1">
                      + Add
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="px-4 py-3 border-t border-stone-800 shrink-0">
              <button
                onClick={onCancel}
                className="w-full py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          /* Custom spell form */
          <>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <SInput
                label="Name *"
                value={form.name}
                onChange={(v) => setF("name", v)}
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-stone-500 uppercase">
                    Tier
                  </span>
                  <select
                    value={form.tier}
                    onChange={(e) => {
                      const t = parseInt(e.target.value);
                      setF("tier", t);
                      setF("manaCost", t);
                    }}
                    className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-violet-600"
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => (
                      <option key={t} value={t}>
                        {TIER_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-stone-500 uppercase">
                    School
                  </span>
                  <select
                    value={form.school}
                    onChange={(e) => setF("school", e.target.value)}
                    className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-violet-600"
                  >
                    <option value="">— none —</option>
                    {SCHOOLS.map((s) => (
                      <option key={s} value={s}>
                        {SCHOOL_ICONS[s]} {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SInput
                  label="Range"
                  value={form.range}
                  onChange={(v) => setF("range", v)}
                  placeholder="e.g. range 6"
                />
                <SInput
                  label="Damage/Formula"
                  value={form.damage}
                  onChange={(v) => setF("damage", v)}
                  placeholder="e.g. 2d6+INT"
                />
              </div>
              {form.tier > 0 && (
                <SInput
                  label="Mana cost"
                  value={String(form.manaCost)}
                  onChange={(v) => setF("manaCost", parseInt(v) || 0)}
                  type="number"
                />
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-stone-500 uppercase">
                  Description
                </span>
                <textarea
                  value={form.description}
                  rows={3}
                  onChange={(e) => setF("description", e.target.value)}
                  className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300 outline-none resize-none focus:border-violet-600"
                />
              </div>
            </div>
            <div className="flex gap-2 px-4 pb-4 shrink-0 border-t border-stone-800 pt-3">
              <button
                onClick={onCancel}
                className="flex-1 py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors"
              >
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
          </>
        )}
      </div>
    </div>
  );
}

// ── Main SpellsTab ────────────────────────────────────────────────

export function SpellsTab({
  character,
  canEdit,
  isGM,
  onUpdate,
  onRoll,
}: Props) {
  const [rollPending, setRollPending] = useState<{
    label: string;
    formula: string;
  } | null>(null);
  const [addingSpell, setAddingSpell] = useState(false);
  const [filterTier, setFilterTier] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  // Expand (desc) vs edit per spell
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const spells = character.actions.filter((a) => a.type === "spell");
  const tiers = [...new Set(spells.map((s) => s.spellTier ?? 0))].sort();

  const visible = useMemo(() => {
    return spells.filter((s) => {
      const matchTier =
        filterTier === "all" || (s.spellTier ?? 0) === filterTier;
      const matchSearch =
        search === "" ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description?.toLowerCase().includes(search.toLowerCase()) ?? false);
      return matchTier && matchSearch;
    });
  }, [spells, filterTier, search]);

  const toggleFavorite = (spellId: string) => {
    if (canEdit) {
      onUpdate({
        actions: character.actions.map((a) =>
          a.id === spellId ? { ...a, isFavorite: !a.isFavorite } : a,
        ),
      });
    }
  };

  const updateSpell = (id: string, patch: Partial<CharacterAction>) =>
    onUpdate({
      actions: character.actions.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    });

  const deleteSpell = (id: string) =>
    onUpdate({ actions: character.actions.filter((a) => a.id !== id) });

  const handleRowClick = (id: string) => {
    if (editingId === id) {
      setEditingId(null);
      setExpandedId(id);
      return;
    }
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleEditToggle = (id: string) => {
    if (editingId === id) {
      setEditingId(null);
    } else {
      setEditingId(id);
      setExpandedId(null);
    }
  };

  const existingIds = new Set(spells.map((s) => s.id));

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* ── Mana ─────────────────────────────────────────────────── */}
      <div className="bento-card flex items-center gap-4">
        <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-violet-950/40 border border-violet-800/40">
          <span className="text-[10px] text-violet-400 uppercase tracking-wider">
            Mana
          </span>
          <div className="flex items-baseline gap-1">
            <input
              type="number"
              value={character.mana}
              min={0}
              max={character.maxMana}
              disabled={!canEdit}
              onChange={(e) =>
                onUpdate({ mana: Math.max(0, parseInt(e.target.value) || 0) })
              }
              className="w-14 text-center text-3xl font-black bg-transparent text-violet-200 outline-none border-b border-violet-800 focus:border-violet-500 disabled:border-transparent"
            />
            <span className="text-stone-500 text-sm"> / </span>
            <input
              type="number"
              value={character.maxMana}
              min={0}
              disabled={!canEdit}
              onChange={(e) =>
                onUpdate({ maxMana: parseInt(e.target.value) || 0 })
              }
              className="w-10 text-center text-base font-semibold bg-transparent text-violet-300 outline-none border-b border-stone-700 focus:border-violet-500 disabled:border-transparent"
            />
          </div>
        </div>
        <div className="flex-1">
          <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all bg-linear-to-r from-violet-700 to-violet-400"
              style={{
                width: `${character.maxMana > 0 ? (character.mana / character.maxMana) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-[10px] text-stone-500 mt-1">
            Spell tier ≈ mana cost · cantrips are free
          </p>
        </div>
      </div>

      {/* ── Search + tier filter ──────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your spells…"
          className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-1.5 text-xs text-stone-200 outline-none focus:border-violet-600 placeholder-stone-600"
        />
        {tiers.length > 1 && (
          <div className="flex gap-1.5 flex-wrap">
            {["all" as const, ...tiers].map((t) => (
              <button
                key={t}
                onClick={() => setFilterTier(t)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  filterTier === t
                    ? "border-violet-600 bg-violet-900/50 text-violet-300"
                    : "border-stone-700 bg-stone-800/40 text-stone-400 hover:border-stone-600"
                }`}
              >
                {t === "all"
                  ? "All"
                  : (TIER_LABELS[t as number] ?? `Tier ${t}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Spell list ───────────────────────────────────────────── */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-2">
          <p className="bento-label">Spells & Cantrips ({spells.length})</p>
          {canEdit && (
            <button
              onClick={() => setAddingSpell(true)}
              className="text-xs text-violet-400 hover:text-violet-300 border border-violet-800/60 px-2 py-0.5 rounded transition-colors"
            >
              + Add spell
            </button>
          )}
        </div>
        {visible.length === 0 ? (
          <p className="text-xs text-stone-600 italic text-center py-6">
            {spells.length === 0
              ? "No spells known."
              : "No spells match your search."}
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
                onRoll={() =>
                  setRollPending({
                    label: spell.name,
                    formula: spell.formula || spell.damage,
                  })
                }
                onToggleFavorite={() => toggleFavorite(spell.id)}
                onDelete={() => {
                  deleteSpell(spell.id);
                  setEditingId(null);
                  setExpandedId(null);
                }}
                onUpdate={(patch) => updateSpell(spell.id, patch)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Notes ────────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Spell Notes</p>
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
            {character.spellNotes || (
              <span className="text-stone-600 italic">No notes.</span>
            )}
          </p>
        )}
      </div>

      {addingSpell && (
        <AddSpellModal
          existingIds={existingIds}
          onAdd={(s) => {
            onUpdate({ actions: [...character.actions, s] });
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
          onConfirm={(mode, ac, hidden) => {
            onRoll({
              label: rollPending.label,
              formula: rollPending.formula,
              mode,
              advantageCount: ac,
              hidden,
            });
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
  spell,
  character,
  canEdit,
  isExpanded,
  isEditing,
  onRowClick,
  onEditToggle,
  onRoll,
  onToggleFavorite,
  onDelete,
  onUpdate,
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
  const tier = spell.spellTier ?? 0;
  const school = spell.spellSchool;
  const schoolStyle = school
    ? SCHOOL_STYLES[school]
    : "text-violet-300 border-violet-800/60 bg-violet-950/30";
  const schoolIcon = school ? SCHOOL_ICONS[school] : "✨";
  const resolvedFormula = resolveFormulaDisplay(
    spell.formula || spell.damage,
    character,
  );

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-colors ${
        isEditing
          ? "border-violet-700/60 bg-violet-950/10"
          : "border-stone-700/40 bg-stone-900/40"
      }`}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span>{schoolIcon}</span>

        {/* Clickable name area → description */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onRowClick}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-stone-200 truncate">
              {spell.name}
            </span>
            <span
              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${schoolStyle}`}
            >
              {school ?? (tier === 0 ? "cantrip" : TIER_LABELS[tier])}
            </span>
            {tier > 0 && (
              <span className="text-[9px] text-violet-400">T{tier}</span>
            )}
            {spell.manaCost != null && spell.manaCost > 0 && (
              <span className="text-[9px] text-violet-400">
                ✦{spell.manaCost}
              </span>
            )}
          </div>
          {resolvedFormula && (
            <span className="text-[10px] font-mono text-amber-300/80">
              {resolvedFormula}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onToggleFavorite}
            className={`text-sm transition-colors ${spell.isFavorite ? "text-amber-400" : "text-stone-600 hover:text-stone-400 text-[22px] pb-0.5"}`}
            title={
              spell.isFavorite ? "Remove from favorites" : "Add to favorites"
            }
          >
            {spell.isFavorite ? "⭐" : "☆"}
          </button>
          {canEdit && (spell.formula || spell.damage) && (
            <button
              onClick={onRoll}
              className="px-2 py-1 rounded bg-violet-900/50 hover:bg-violet-800/60 text-violet-300 text-[10px] font-bold border border-violet-800/40 transition-all active:scale-95"
            >
              🎲
            </button>
          )}
        </div>
      </div>

      {/* Description panel */}
      {isExpanded && !isEditing && (
        <div className="px-3 pb-2.5 border-t border-stone-700/40 pt-2">
          <div className="flex justify-between">
            {spell.range && (
              <p className="text-[10px] text-stone-500 mb-1">
                📍 {spell.range}
                {spell.actionCost
                  ? ` · ${spell.actionCost} action${spell.actionCost > 1 ? "s" : ""}`
                  : ""}
              </p>
            )}
            <div className="flex gap-2">
              {/* Pencil edit */}
              {canEdit && (
                <button
                  onClick={onEditToggle}
                  title="Edit spell"
                  className="w-6 h-6 flex items-center justify-center rounded transition-all text-stone-500 hover:text-stone-300 hover:bg-stone-700/60"
                >
                  ✏️
                </button>
              )}
              <button onClick={onDelete} className="w-6 h-6 flex items-center justify-center rounded transition-all text-stone-500 hover:text-stone-300 hover:bg-stone-700/60">
                🗑️
              </button>
            </div>
          </div>
          <p className="text-xs text-stone-400 leading-relaxed">
            {spell.description || (
              <span className="italic text-stone-600">No description.</span>
            )}
          </p>
        </div>
      )}

      {/* Edit panel */}
      {isEditing && (
        <div className="px-3 pb-3 border-t border-violet-800/30 pt-2 flex flex-col gap-2">
          {/* Name */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase">Name</span>
            <input
              value={spell.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600"
            />
          </div>
          {/* Range + formula */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500 uppercase">
                Range
              </span>
              <input
                value={spell.range ?? ""}
                onChange={(e) => onUpdate({ range: e.target.value })}
                placeholder="e.g. 8"
                className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600 placeholder-stone-600"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500 uppercase">
                Formula
              </span>
              <input
                value={spell.formula ?? spell.damage ?? ""}
                onChange={(e) =>
                  onUpdate({ formula: e.target.value, damage: e.target.value })
                }
                placeholder="e.g. 2d6+INT"
                className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600 placeholder-stone-600"
              />
            </div>
          </div>
          {/* Tier + mana */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500 uppercase">Tier</span>
              <select
                value={spell.spellTier ?? 0}
                onChange={(e) => {
                  const t = parseInt(e.target.value);
                  onUpdate({
                    spellTier: t,
                    manaCost: t === 0 ? 0 : (spell.manaCost ?? t),
                  });
                }}
                className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600"
              >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-stone-500 uppercase">
                Mana cost
              </span>
              <input
                type="number"
                value={spell.manaCost ?? 0}
                min={0}
                onChange={(e) =>
                  onUpdate({ manaCost: parseInt(e.target.value) || 0 })
                }
                className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600"
              />
            </div>
          </div>
          {/* School */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase">School</span>
            <select
              value={spell.spellSchool ?? ""}
              onChange={(e) =>
                onUpdate({
                  spellSchool: (e.target.value as SpellSchool) || undefined,
                })
              }
              className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600"
            >
              <option value="">— none —</option>
              {SCHOOLS.map((s) => (
                <option key={s} value={s}>
                  {SCHOOL_ICONS[s]} {s}
                </option>
              ))}
            </select>
          </div>
          {/* Description */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase">
              Description
            </span>
            <textarea
              value={spell.description ?? ""}
              rows={3}
              onChange={(e) => onUpdate({ description: e.target.value })}
              className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300 outline-none resize-none focus:border-violet-600"
            />
          </div>
          <div className="flex justify-between">
          <button
            onClick={onDelete}
            className="text-[10px] text-rose-500 hover:text-rose-400 self-start mt-1"
          >
            Remove spell
          </button>
          <button onClick={onEditToggle} className="rounded px-2 py-1 text-xs bg-violet-900/60 border border-violet-600/60 text-stone-300">OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tiny form helpers ─────────────────────────────────────────────

function SInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-stone-500 uppercase">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-violet-600 placeholder-stone-600"
      />
    </div>
  );
}
