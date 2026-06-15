import { useState } from "react";
import type {
  NimbleCharacter,
  CharacterAction,
  DiceRollRequest,
  RollMode,
  InventoryItem,
} from "../../types/character";
import { DiceRollModal } from "../ui/DiceRollModal";
import { resolveFormulaDisplay, evalFormula } from "../../utils/formulaParser";

interface Props {
  character: NimbleCharacter;
  canEdit: boolean;
  isGM: boolean;
  onUpdate: (u: Partial<NimbleCharacter>) => void;
  onRoll: (req: DiceRollRequest) => void;
  onRollInitiative: (
    mode?: RollMode,
  ) => Promise<{ total: number } | null> | void;
}

const ACTION_COLORS = {
  melee: "text-rose-300 border-rose-800/60 bg-rose-950/30",
  ranged: "text-sky-300 border-sky-800/60 bg-sky-950/30",
  spell: "text-violet-300 border-violet-800/60 bg-violet-950/30",
  ability: "text-amber-300 border-amber-800/60 bg-amber-950/30",
  item: "text-emerald-300 border-emerald-800/60 bg-emerald-950/30",
} as const;

const ACTION_ICONS = {
  melee: "⚔️",
  ranged: "🏹",
  spell: "✨",
  ability: "⚡",
  item: "🎒",
} as const;

function computeDefense(character: NimbleCharacter): number {
  const armorItem = character.inventory.find(
    (i) => i.id === character.armor.equippedItemId && i.isArmor,
  );
  if (armorItem && armorItem.formula) {
    return (
      evalFormula(armorItem.formula, character) +
      (character.armor.defenseBonus ?? 0)
    );
  }
  return character.stats.dex + (character.armor.defenseBonus ?? 0);
}

/** Actions from initiative roll result */
function initiativeToActions(total: number): number {
  if (total < 10) return 1;
  if (total < 20) return 2;
  return 3;
}

export function CombatTab({
  character,
  canEdit,
  isGM,
  onUpdate,
  onRoll,
  onRollInitiative,
}: Props) {
  const [rollPending, setRollPending] = useState<{
    label: string;
    formula: string;
  } | null>(null);
  const [addingAction, setAddingAction] = useState(false);
  const [actionsUsed, setActionsUsed] = useState([false, false, false]);
  const [initiativeResult, setInitiativeResult] = useState<number | null>(null);

  const defenseValue = computeDefense(character);
  // Armor items from inventory
  const armorItems = character.inventory.filter((i) => i.isArmor);
  const equippedArmorItem = armorItems.find(
    (i) => i.id === character.armor.equippedItemId,
  );

  const favorites = [
    ...character.actions.filter((a) => a.isFavorite),
    ...character.inventory.filter((i) => i.isFavorite && i.formula),
  ];
  const combatActions = character.actions.filter((a) => a.type !== "spell");

  const broadcastAction = (label: string) => {
    onRoll({ label, formula: "0", mode: "standard", hidden: false });
  };

  const toggleActionUsed = (i: number) => {
    if (canEdit) {
      const next = [...actionsUsed];
      next[i] = !next[i];
      setActionsUsed(next);
    }
  };

  const resetActions = () => {
    setActionsUsed([false, false, false]);
  };

  const handleInitiativeRoll = async (mode: RollMode = "standard") => {
    const result = await onRollInitiative(mode);
    if (result && typeof result.total === "number") {
      const actionCount = initiativeToActions(result.total);
      setInitiativeResult(result.total);
      setActionsUsed([actionCount < 1, actionCount < 2, actionCount < 3]);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* ── Quick HP / Wounds ─────────────────────────────────────── */}
      <div className="bento-card grid grid-cols-2 gap-3">
        <div>
          <p className="bento-label">HP</p>
          <div className="flex items-baseline gap-1 mt-1">
            <input
              type="number"
              value={character.hp.current}
              min={0}
              max={character.hp.max + character.hp.temp}
              disabled={!canEdit}
              onChange={(e) =>
                onUpdate({
                  hp: {
                    ...character.hp,
                    current: Math.max(0, parseInt(e.target.value) || 0),
                  },
                })
              }
              className="w-14 text-center text-2xl font-black bg-transparent border-b border-stone-700 focus:border-emerald-600 outline-none text-emerald-300 disabled:border-transparent"
            />
            <span className="text-stone-500 text-xs">/ {character.hp.max}</span>
          </div>
          {/* Temp HP */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">
              Temp
            </span>
            {canEdit ? (
              <input
                type="number"
                value={character.hp.temp}
                min={0}
                onChange={(e) =>
                  onUpdate({
                    hp: {
                      ...character.hp,
                      temp: Math.max(0, parseInt(e.target.value) || 0),
                    },
                  })
                }
                className="w-12 text-center text-sm font-semibold bg-transparent border-b border-stone-700/60 focus:border-sky-500 outline-none text-sky-300"
              />
            ) : (
              <span className="text-sm font-semibold text-sky-300">
                {character.hp.temp}
              </span>
            )}
          </div>
          <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden mt-1.5">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, (character.hp.current / character.hp.max) * 100)}%`,
                background:
                  character.hp.current <= character.hp.max * 0.25
                    ? "#ef4444"
                    : character.hp.current <= character.hp.max * 0.5
                      ? "#f59e0b"
                      : "#34d399",
              }}
            />
          </div>
        </div>
        <div>
          <p className="bento-label">Wounds</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Array.from({ length: character.maxWounds + 1 }).map((_, i) => {
              const filled = i < character.wounds;
              const fatal = i === character.maxWounds;
              return (
                <button
                  key={i}
                  onClick={() =>
                    canEdit && onUpdate({ wounds: filled ? i : i + 1 })
                  }
                  className={`w-6 h-6 rounded-full border-2 transition-all text-[8px] ${
                    fatal
                      ? "border-rose-900 bg-rose-950/30 text-rose-800"
                      : filled
                        ? "border-rose-600 bg-rose-700"
                        : "border-stone-600 bg-stone-800/40"
                  } ${canEdit ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
                >
                  {fatal ? "☠" : ""}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bento-card">
        <div className="flex justify-between items-center gap-1.5">
          {/* ── Action tokens ─────────────────────────────────────────── */}
          <div className="w-full">
            <div className="flex items-center justify-between mb-2">
              <p className="bento-label">Actions this turn</p>
              {canEdit && (
                <button
                  onClick={resetActions}
                  className="text-[10px] text-stone-500 hover:text-amber-300 border border-stone-700 px-2 py-0.5 rounded transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {actionsUsed.map((used, i) => (
                <button
                  key={i}
                  onClick={() => toggleActionUsed(i)}
                  className={`flex-1 py-2 rounded-lg border-2 font-bold text-sm transition-all ${
                    used
                      ? "border-stone-700 bg-stone-800/40 text-stone-600"
                      : "border-amber-600 bg-amber-950/40 text-amber-300 shadow-amber-900/30 shadow-md"
                  }`}
                >
                  {used ? "✓" : `${i + 1}`}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-stone-600 mt-1.5 italic">
              Initiative: &lt;10 = 1 action · 10–19 = 2 · 20+ = 3
            </p>
          </div>

          {/* ── Initiative ───────────────────────────────────────────── */}
          {canEdit && (
          <div className="flex-1 border-l border-stone-700 pl-1.5">
            <p className="bento-label mb-2">Initiative</p>
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-center px-2 py-1 rounded-lg bg-stone-800/60 border border-stone-700/40">
                <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                  Base
                </span>
                <span className="text-2xl font-black text-amber-300">
                  {character.stats.dex >= 0 ? "+" : ""}
                  {character.stats.dex + character.initiativeBonus}
                </span>
                <span className="text-[10px] text-stone-500">DEX</span>
              </div>
              
                <div className="flex flex-col gap-1.5 flex-1">
                  <button
                    onClick={() => handleInitiativeRoll("standard")}
                    className="w-full py-2 rounded-lg border border-amber-700/60 bg-amber-950/40 text-amber-300 text-sm font-bold hover:bg-amber-900/50 transition-all active:scale-95"
                  >
                    🎲
                  </button>
                  {initiativeResult !== null && (
                    <p className="text-[10px] text-amber-400 text-center">
                      Result: {initiativeResult} →{" "}
                      {initiativeToActions(initiativeResult)} action
                      {initiativeToActions(initiativeResult) > 1 ? "s" : ""}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-stone-500">Bonus:</span>
                    <input
                      type="number"
                      value={character.initiativeBonus}
                      onChange={(e) =>
                        onUpdate({
                          initiativeBonus: parseInt(e.target.value) || 0,
                        })
                      }
                      className="w-8 text-center text-xs bg-stone-900 border border-stone-700 rounded py-0.5 text-stone-200 outline-none focus:border-amber-600"
                    />
                  </div>
                </div>
            </div>
          </div>
              )}
        </div>
      </div>

      {/* ── Defense ──────────────────────────────────────────────── */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-2">
          <p className="bento-label">Defense</p>
          <span className="text-3xl font-black text-sky-300">
            {defenseValue}
          </span>
        </div>
        {/* Armor selector from inventory */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500">
              Armor (from inventory)
            </span>
            {canEdit ? (
              <select
                value={character.armor.equippedItemId ?? ""}
                onChange={(e) =>
                  onUpdate({
                    armor: {
                      ...character.armor,
                      equippedItemId: e.target.value || undefined,
                    },
                  })
                }
                className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-sky-600"
              >
                <option value="">— Unarmored (DEX only) —</option>
                {armorItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.formula})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-stone-300">
                {equippedArmorItem ? equippedArmorItem.name : "Unarmored"}
              </span>
            )}
          </div>
          {/* Defense bonus (class/race/other) */}
          {canEdit && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-stone-500">Extra bonus:</span>
              <input
                type="number"
                value={character.armor.defenseBonus ?? 0}
                onChange={(e) =>
                  onUpdate({
                    armor: {
                      ...character.armor,
                      defenseBonus: parseInt(e.target.value) || 0,
                    },
                  })
                }
                className="w-14 text-center text-xs bg-stone-900 border border-stone-700 rounded py-0.5 text-stone-200 outline-none focus:border-sky-600"
              />
              <span className="text-[10px] text-stone-600">
                class/race/ability
              </span>
            </div>
          )}
          {/* Formula preview */}
          <p className="text-[10px] text-stone-600 italic">
            {equippedArmorItem
              ? `Formula: ${equippedArmorItem.formula} + ${character.armor.defenseBonus ?? 0} bonus`
              : `DEX (${character.stats.dex}) + ${character.armor.defenseBonus ?? 0} bonus`}
          </p>
        </div>
      </div>

      {/* ── Favorites ────────────────────────────────────────────── */}
      {favorites.length > 0 && (
        <div className="bento-card">
          <p className="bento-label mb-2">⭐ Favorites</p>
          <div className="flex flex-col gap-1.5">
            {character.actions
              .filter((a) => a.isFavorite)
              .map((a) => (
                <ActionRow
                  key={a.id}
                  action={a}
                  character={character}
                  canEdit={canEdit}
                  onRoll={
                    canEdit
                      ? () =>
                          setRollPending({
                            label: a.name,
                            formula: a.formula || a.damage,
                          })
                      : undefined
                  }
                  onToggleFavorite={
                    canEdit
                      ? () =>
                          onUpdate({
                            actions: character.actions.map((x) =>
                              x.id === a.id
                                ? { ...x, isFavorite: !x.isFavorite }
                                : x,
                            ),
                          })
                      : undefined
                  }
                  onDelete={
                    canEdit
                      ? () =>
                          onUpdate({
                            actions: character.actions.filter(
                              (x) => x.id !== a.id,
                            ),
                          })
                      : undefined
                  }
                  isGM={isGM}
                  onBroadcast={broadcastAction}
                />
              ))}
            {/* Inventory favorites */}
            {character.inventory
              .filter((i) => i.isFavorite && i.formula)
              .map((item) => (
                <InventoryFavoriteRow
                  key={item.id}
                  item={item}
                  canEdit={canEdit}
                  onRoll={
                    canEdit
                      ? () =>
                          setRollPending({
                            label: item.name,
                            formula: item.formula!,
                          })
                      : undefined
                  }
                  onToggleFavorite={
                    canEdit
                      ? () =>
                          onUpdate({
                            inventory: character.inventory.map((x) =>
                              x.id === item.id
                                ? { ...x, isFavorite: !x.isFavorite }
                                : x,
                            ),
                          })
                      : undefined
                  }
                />
              ))}
          </div>
        </div>
      )}

      {/* ── Combat actions ───────────────────────────────────────── */}
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
              No actions yet.{canEdit && ' Click "+ Add".'}
            </p>
          )}
          {combatActions.map((a) => (
            <ActionRow
              key={a.id}
              action={a}
              character={character}
              canEdit={canEdit}
              onRoll={
                canEdit
                  ? () =>
                      setRollPending({
                        label: a.name,
                        formula: a.formula || a.damage,
                      })
                  : undefined
              }
              onToggleFavorite={
                canEdit
                  ? () =>
                      onUpdate({
                        actions: character.actions.map((x) =>
                          x.id === a.id
                            ? { ...x, isFavorite: !x.isFavorite }
                            : x,
                        ),
                      })
                  : undefined
              }
              onDelete={
                canEdit
                  ? () =>
                      onUpdate({
                        actions: character.actions.filter((x) => x.id !== a.id),
                      })
                  : undefined
              }
              isGM={isGM}
              onBroadcast={broadcastAction}
            />
          ))}
        </div>
      </div>

      {/* ── Notes ────────────────────────────────────────────────── */}
      <div className="bento-card">
        <p className="bento-label mb-2">Combat Notes</p>
        {canEdit ? (
          <textarea
            value={character.notes}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            rows={3}
            placeholder="Conditions, concentration, special rules…"
            className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-300 outline-none resize-none focus:border-amber-700/60 placeholder-stone-600"
          />
        ) : (
          <p className="text-xs text-stone-400 whitespace-pre-wrap">
            {character.notes || (
              <span className="text-stone-600 italic">No notes.</span>
            )}
          </p>
        )}
      </div>

      {addingAction && (
        <AddActionModal
          onAdd={(a) => {
            onUpdate({ actions: [...character.actions, a] });
            setAddingAction(false);
          }}
          onCancel={() => setAddingAction(false)}
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

// ─── InventoryFavoriteRow ─────────────────────────────────────────
function InventoryFavoriteRow({
  item,
  canEdit,
  onRoll,
  onToggleFavorite,
}: {
  item: InventoryItem;
  canEdit: boolean;
  onRoll?: () => void;
  onToggleFavorite?: () => void;
}) {
  return (
    <div className="rounded-lg border border-stone-700/40 bg-stone-900/40 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span>🎒</span>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-stone-200 truncate">
            {item.name}
          </span>
          {item.formula && (
            <span className="text-[10px] font-mono text-amber-300/80 ml-2">
              {item.formula}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canEdit && onToggleFavorite && (
            <button
              onClick={onToggleFavorite}
              className={`text-sm transition-colors ${item.isFavorite ? "text-amber-400" : "text-stone-600 hover:text-stone-400"}`}
            >
              {item.isFavorite ? "⭐" : "☆"}
            </button>
          )}
          {canEdit && onRoll && (
            <button
              onClick={onRoll}
              className="px-2 py-1 rounded bg-amber-900/50 hover:bg-amber-800/60 text-amber-300 text-[10px] font-bold border border-amber-800/40 transition-all active:scale-95"
            >
              🎲
            </button>
          )}
        </div>
      </div>
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
  onBroadcast,
}: {
  action: CharacterAction;
  character: NimbleCharacter;
  canEdit: boolean;
  onRoll?: () => void;
  onToggleFavorite?: () => void;
  onDelete?: () => void;
  isGM: boolean;
  onBroadcast: (label: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const typeStyle = ACTION_COLORS[action.type] || "";
  const icon = ACTION_ICONS[action.type] || "⚡";
  const resolvedFormula = resolveFormulaDisplay(
    action.formula || action.damage,
    character,
  );

  return (
    <div className="rounded-lg border border-stone-700/40 bg-stone-900/40 overflow-hidden">
      <div
        className="flex items-center gap-2 px-2.5 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-200 truncate">
              {action.name}
            </span>
            <span
              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${typeStyle}`}
            >
              {action.type}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-stone-500">
              📍 {action.range || "—"}
            </span>
            {resolvedFormula && (
              <span className="text-[10px] font-mono text-amber-300/80">
                {resolvedFormula}
              </span>
            )}
          </div>
        </div>
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {canEdit && onToggleFavorite && (
            <button
              onClick={onToggleFavorite}
              className={`text-sm transition-colors ${action.isFavorite ? "text-amber-400" : "text-stone-600 hover:text-stone-400 text-[22px] pb-0.5"}`}
            >
              {action.isFavorite ? "⭐" : "☆"}
            </button>
          )}
          {canEdit && onRoll && (
            <button
              onClick={onRoll}
              className="px-2 py-1 rounded bg-amber-900/50 hover:bg-amber-800/60 text-amber-300 text-[10px] font-bold border border-amber-800/40 transition-all active:scale-95"
            >
              🎲
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-2.5 border-t border-stone-700/40 pt-2">
          <p className="text-xs text-stone-400 leading-relaxed">
            {action.description || "No description."}
          </p>
          {canEdit && onDelete && (
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => onBroadcast(`${action.name} used`)}
                className="text-[10px] text-sky-400 hover:text-sky-300"
              >
                Broadcast use
              </button>
              <button
                onClick={onDelete}
                className="text-[10px] text-rose-500 hover:text-rose-400"
              >
                Delete
              </button>
            </div>
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
}: {
  onAdd: (a: CharacterAction) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    type: "melee" as CharacterAction["type"],
    range: "",
    damage: "",
    description: "",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-80 rounded-xl border border-stone-700 bg-stone-900 shadow-2xl overflow-hidden">
        <div className="bg-stone-800 px-4 py-3 border-b border-stone-700">
          <h3 className="text-sm font-bold text-amber-200">New Action</h3>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <TinyInput
            label="Name *"
            value={form.name}
            onChange={(v) => set("name", v)}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase">Type</span>
            <select
              value={form.type}
              onChange={(e) => set("type", e.target.value)}
              className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-amber-600"
            >
              {["melee", "ranged", "ability", "item"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TinyInput
              label="Range"
              value={form.range}
              onChange={(v) => set("range", v)}
              placeholder="e.g. 1, range 6"
            />
            <TinyInput
              label="Damage"
              value={form.damage}
              onChange={(v) => set("damage", v)}
              placeholder="e.g. 1d8+STR"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-stone-500 uppercase">
              Description
            </span>
            <textarea
              value={form.description}
              rows={2}
              onChange={(e) => set("description", e.target.value)}
              className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300 outline-none resize-none focus:border-amber-600"
            />
          </div>
        </div>
        <div className="flex gap-2 px-4 pb-4">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!form.name) return;
              onAdd({
                id: `a-${Date.now()}`,
                ...form,
                formula: form.damage,
                isFavorite: false,
                isCustom: true,
              });
            }}
            className="flex-1 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-amber-100 text-sm font-bold transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function TinyInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-stone-500 uppercase">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="bg-stone-900/60 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 outline-none focus:border-amber-600 placeholder-stone-600"
      />
    </div>
  );
}
