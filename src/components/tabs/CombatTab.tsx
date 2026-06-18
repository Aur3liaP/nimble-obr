/**
 * @file Combat tab — HP/wounds quick view, action economy tracker,
 * initiative roll, derived defense, favorited actions/items, and the
 * full action list.
 *
 * Defense is computed dynamically from whichever inventory item is
 * equipped as armor (see {@link computeDefense}), not from a static value,
 * so changing armor in the Inventory tab is immediately reflected here.
 */

import { useState, useEffect } from "react";
import type {
  NimbleCharacter,
  CharacterAction,
  DiceRollRequest,
  RollMode,
  InventoryItem,
} from "../../types/character";
import { DiceRollModal } from "../ui/DiceRollModal";
import { resolveFormulaDisplay, evalFormula } from "../../utils/formulaParser";
import { BentoSection } from "../ui/common/BentoSection";
import { InlineNumberField } from "../ui/common/InlineEditField";
import { FavoriteButton } from "../ui/common/FavoriteButton";
import { RollButton } from "../ui/common/RollButton";
import { TextAction } from "../ui/common/RowActions";
import { RowMeta } from "../ui/common/RowMeta";
import { RowDescriptionPanel } from "../ui/common/RowDescriptionPanel";
import { FormField, GridFields } from "../ui/common/FormField";

// ── Types ─────────────────────────────────────────────────────────
/**
 * @property character - The character being displayed/edited.
 * @property canEdit - Whether the current player may modify this sheet.
 * @property isGM - Whether the current player is the GM.
 * @property onUpdate - Persists a partial character update.
 * @property onRoll - Triggers a dice roll request after modal confirmation.
 * @property onRollInitiative - Rolls initiative via the shared `useOBR` logic; resolves to the roll result (or void/null) so this tab can derive the resulting action count.
 */
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

/** Minimal pending-roll shape used by this tab's dice modal (label + formula only — no save advantage needed here). */
type RollPending = { label: string; formula: string };

// ── Helpers ───────────────────────────────────────────────────────

/** Tailwind color classes per action type, used for the type badge on each action row. */
const ACTION_COLORS = {
  melee: "text-rose-300 border-rose-800/60 bg-rose-950/30",
  ranged: "text-sky-300 border-sky-800/60 bg-sky-950/30",
  spell: "text-violet-300 border-violet-800/60 bg-violet-950/30",
  ability: "text-amber-300 border-amber-800/60 bg-amber-950/30",
  item: "text-emerald-300 border-emerald-800/60 bg-emerald-950/30",
} as const;

/** Emoji icon per action type, shown at the start of each action row. */
const ACTION_ICONS = {
  melee: "⚔️",
  ranged: "🏹",
  spell: "✨",
  ability: "⚡",
  item: "🎒",
} as const;

/**
 * Derives the character's current defense value.
 *
 * If an inventory item is equipped as armor (`character.armor.equippedItemId`
 * pointing at an item with `isArmor: true`), its formula is evaluated and
 * the flat `defenseBonus` is added on top. Otherwise, defense falls back to
 * DEX + the flat bonus (unarmored).
 *
 * @param character - The character to compute defense for.
 * @returns The resolved numeric defense value.
 */
function computeDefense(character: NimbleCharacter): number {
  const armorItem = character.inventory.find(
    (i) => i.id === character.armor.equippedItemId && i.isArmor,
  );
  if (armorItem?.formula) {
    return (
      evalFormula(armorItem.formula, character) +
      (character.armor.defenseBonus ?? 0)
    );
  }
  return character.stats.dex + (character.armor.defenseBonus ?? 0);
}

/**
 * Converts an initiative roll total into the number of actions available
 * on the first combat turn, per the Nimble rules: below 10 → 1 action,
 * 10–19 → 2 actions, 20+ → 3 actions.
 *
 * @param total - The resolved initiative roll total.
 * @returns The number of actions (1–3) granted for the first turn.
 */
function initiativeToActions(total: number): number {
  if (total < 10) return 1;
  if (total < 20) return 2;
  return 3;
}

// ── Main component ────────────────────────────────────────────────

/**
 * Renders the combat-facing view of a character: HP/wounds shortcuts,
 * a 3-action turn tracker with manual toggle/reset, an initiative roller
 * that auto-sets the action tracker from the result, derived defense with
 * an armor-item selector, favorited actions/items for quick access, the
 * full action list, and combat notes.
 */
export function CombatTab({
  character,
  canEdit,
  isGM,
  onUpdate,
  onRoll,
  onRollInitiative,
}: Props) {
  const [rollPending, setRollPending] = useState<RollPending | null>(null);
  const [addingAction, setAddingAction] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [actionsUsed, setActionsUsed] = useState([false, false, false]);
  const [initiativeResult, setInitiativeResult] = useState<number | null>(null);

  useEffect(() => {
    if (initiativeResult === null) return;

    const timer = setTimeout(() => {
      setInitiativeResult(null);
    }, 5000);

    return () => clearTimeout(timer);
  }, [initiativeResult]);
  
  const defenseValue = computeDefense(character);
  const armorItems = character.inventory.filter((i) => i.isArmor);
  const equippedArmorItem = armorItems.find(
    (i) => i.id === character.armor.equippedItemId,
  );
  const combatActions = character.actions.filter((a) => a.type !== "spell");
  const favorites = [
    ...character.actions.filter((a) => a.isFavorite),
    ...character.inventory.filter((i) => i.isFavorite && i.formula),
  ];

  /** Flips the used/unused state of one of the three action tokens (no-op for non-editors). */
  const toggleActionUsed = (i: number) => {
    if (!canEdit) return;
    const next = [...actionsUsed];
    next[i] = !next[i];
    setActionsUsed(next);
  };

  /**
   * Rolls initiative, then automatically marks actions as used/unused on
   * the turn tracker to reflect how many actions the result grants
   * (see {@link initiativeToActions}).
   *
   * @param mode - Roll mode, defaults to "standard".
   */
  const handleInitiativeRoll = async (mode: RollMode = "standard") => {
    const result = await onRollInitiative(mode);
    if (result && typeof result.total === "number") {
      const ac = initiativeToActions(result.total);
      setInitiativeResult(result.total);
      setActionsUsed([ac < 1, ac < 2, ac < 3]);
    }
  };

  /** Replaces the character's full actions array (shorthand for `onUpdate({ actions: ... })`). */
  const updateActions = (updated: CharacterAction[]) =>
    onUpdate({ actions: updated });

  /** Queues a roll for confirmation in the shared {@link DiceRollModal}. */
  const setRoll = (label: string, formula: string) =>
    setRollPending({ label, formula });

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* ── Quick HP / Wounds ─────────────────────────────────────── */}
      <BentoSection>
        <div className="grid grid-cols-2 gap-3">
          {/* HP */}
          <div>
            <p className="bento-label">HP</p>
            <div className="flex items-baseline gap-1 mt-1">
              <InlineNumberField
                value={character.hp.current}
                canEdit={canEdit}
                min={0}
                max={character.hp.max + character.hp.temp}
                onChange={(v) =>
                  onUpdate({ hp: { ...character.hp, current: Math.max(0, v) } })
                }
                size="2xl"
                colorClass="text-emerald-300"
              />
              <span className="text-stone-500 text-xs">
                / {character.hp.max}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                Temp
              </span>
              <InlineNumberField
                value={character.hp.temp}
                canEdit={canEdit}
                min={0}
                onChange={(v) =>
                  onUpdate({ hp: { ...character.hp, temp: Math.max(0, v) } })
                }
                size="sm"
                colorClass="text-sky-300"
              />
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

          {/* Wounds */}
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
                    className={`
                      w-5 h-5 rounded-full border-2 transition-all text-[10px]
                      ${
                        fatal
                          ? "border-rose-900 bg-rose-950/30 text-rose-800"
                          : filled
                            ? "border-rose-700 bg-rose-900"
                            : "border-stone-600 bg-stone-800/40"
                      }
                      ${canEdit ? "cursor-pointer hover:scale-110" : "cursor-default"}
                    `}
                  >
                    {fatal ? "☠" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </BentoSection>

      {/* ── Actions + Initiative ──────────────────────────────────── */}
      <BentoSection>
        <div className="flex justify-between items-start gap-1.5">
          {/* Initiative */}
          {canEdit && (
            <div className="w-4/11 border-r border-stone-700 pr-2">
              <p className="bento-label mb-2">Initiative</p>
              <div className="flex items-center gap-2">
                <div className="flex flex-col items-center px-2 py-1 rounded-lg bg-stone-800/60 border border-stone-700/40">
                  <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                    Base
                  </span>
                  <span className="text-xl font-black text-amber-300">
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
                      className="w-7 text-center text-xs bg-stone-900 border border-stone-700 rounded py-0.5 text-stone-200 outline-none focus:border-amber-600"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action tokens */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <p className="bento-label">Actions this turn</p>
              {canEdit && (
                <button
                  onClick={() => setActionsUsed([false, false, false])}
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
                  className={`
                    flex-1 py-2 rounded-lg border-2 font-bold text-sm transition-all
                    ${
                      used
                        ? "border-stone-700 bg-stone-800/40 text-stone-600"
                        : "border-amber-600 bg-amber-950/40 text-amber-300 shadow-amber-900/30 shadow-md"
                    }
                  `}
                >
                  {used ? "✓" : `${i + 1}`}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-stone-600 mt-1.5 italic">
              Initiative: &lt;10 = 1 action · 10–19 = 2 · 20+ = 3
            </p>
          </div>
        </div>
        {initiativeResult !== null && (
          <p className="text-[10px] font-medium text-amber-400 text-center mt-1.5 -mb-1 ">
            Result: {initiativeResult} → {initiativeToActions(initiativeResult)}{" "}
            action
            {initiativeToActions(initiativeResult) > 1 ? "s" : ""}
          </p>
        )}
      </BentoSection>

      {/* ── Defense ──────────────────────────────────────────────── */}
      <BentoSection>
        <div className="flex items-center justify-between -mt-2">
          <p className="bento-label">Defense</p>
          <span className="text-3xl font-black text-sky-300">
            {defenseValue}
          </span>
        </div>
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
          <p className="text-[10px] text-stone-600 italic">
            {equippedArmorItem
              ? `Formula: ${equippedArmorItem.formula} + ${character.armor.defenseBonus ?? 0} bonus`
              : `DEX (${character.stats.dex}) + ${character.armor.defenseBonus ?? 0} bonus`}
          </p>
        </div>
      </BentoSection>

      {/* ── Favorites ────────────────────────────────────────────── */}
      {favorites.length > 0 && (
        <BentoSection label="⭐ Favorites">
          <div className="flex flex-col gap-1.5">
            {character.actions
              .filter((a) => a.isFavorite)
              .map((a) => (
                <ActionRow
                  key={a.id}
                  action={a}
                  character={character}
                  canEdit={canEdit}
                  isGM={isGM}
                  isEditing={false}
                  onRoll={() => setRoll(a.name, a.formula || a.damage)}
                  onToggleFavorite={() =>
                    updateActions(
                      character.actions.map((x) =>
                        x.id === a.id ? { ...x, isFavorite: !x.isFavorite } : x,
                      ),
                    )
                  }
                  // No onEdit/onDelete here on purpose — favorites are read-only shortcuts
                />
              ))}
            {character.inventory
              .filter((i) => i.isFavorite && i.formula)
              .map((item) => (
                <InventoryFavoriteRow
                  key={item.id}
                  item={item}
                  canEdit={canEdit}
                  onRoll={() => setRoll(item.name, item.formula!)}
                  onToggleFavorite={() =>
                    onUpdate({
                      inventory: character.inventory.map((x) =>
                        x.id === item.id
                          ? { ...x, isFavorite: !x.isFavorite }
                          : x,
                      ),
                    })
                  }
                />
              ))}
          </div>
        </BentoSection>
      )}

      {/* ── Combat actions ───────────────────────────────────────── */}
      <BentoSection
        label="Actions"
        action={
          canEdit && (
            <button
              onClick={() => setAddingAction(true)}
              className="text-xs text-amber-400 hover:text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded transition-colors"
            >
              + Add
            </button>
          )
        }
      >
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
              isGM={isGM}
              isEditing={editingActionId === a.id}
              onRoll={() => setRoll(a.name, a.formula || a.damage)}
              onToggleFavorite={() =>
                updateActions(
                  character.actions.map((x) =>
                    x.id === a.id ? { ...x, isFavorite: !x.isFavorite } : x,
                  ),
                )
              }
              onEditToggle={() =>
                setEditingActionId((cur) => (cur === a.id ? null : a.id))
              }
              onDelete={() => {
                updateActions(character.actions.filter((x) => x.id !== a.id));
                setEditingActionId(null);
              }}
              onUpdate={(patch) =>
                updateActions(
                  character.actions.map((x) =>
                    x.id === a.id ? { ...x, ...patch } : x,
                  ),
                )
              }
            />
          ))}
        </div>
      </BentoSection>

      {/* ── Notes ────────────────────────────────────────────────── */}
      <BentoSection label="Combat Notes">
        {canEdit ? (
          <textarea
            value={character.battleNotes}
            onChange={(e) => onUpdate({ battleNotes: e.target.value })}
            rows={3}
            placeholder="Conditions, concentration, special rules…"
            className="w-full bg-stone-900/60 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-300 outline-none resize-none focus:border-amber-700/60 placeholder-stone-600"
          />
        ) : (
          <p className="text-xs text-stone-400 whitespace-pre-wrap">
            {character.battleNotes || (
              <span className="text-stone-600 italic">No notes.</span>
            )}
          </p>
        )}
      </BentoSection>

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

// ── InventoryFavoriteRow ──────────────────────────────────────────
/**
 * Compact row for a favorited inventory item shown in the Combat tab's
 * Favorites section — same favorite/roll affordances as the Inventory
 * tab's `ItemRow`, but without expand/edit/delete (those live in Inventory).
 */

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
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-stone-700/40 bg-stone-900/40 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span>🎒</span>
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="text-xs font-semibold text-stone-200 truncate">
            {item.name}
          </span>
          {item.formula && (
            <span className="text-[10px] font-mono text-amber-300/80 ml-2">
              {item.formula}
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <FavoriteButton
            isFavorite={item.isFavorite ?? false}
            canEdit={canEdit}
            onToggle={onToggleFavorite}
          />
          {canEdit && onRoll && <RollButton onClick={onRoll} />}
        </div>
      </div>

      {expanded && <RowDescriptionPanel description={item.description} />}
    </div>
  );
}

// ── ActionRow ─────────────────────────────────────────────────────

/**
 * Expandable row for one combat action (melee/ranged/ability/item — spells
 * are excluded, they live in the Spells tab). Click to expand/collapse the
 * description; favorite toggle and roll button are always visible.
 *
 * @param action - The action to render.
 * @param character - Used to resolve the formula's display string (variables substituted, dice kept).
 * @param canEdit - Gates the favorite toggle, roll button, and delete action.
 * @param isEditing - Whether the inline edit form is open.
 * @param onRoll - Called when the roll button is clicked.
 * @param onToggleFavorite - Called when the favorite star is clicked.
 * @param onEditToggle -Called when edit mode is toggled.
 * @param onDelete - Called when "Delete" is clicked in the expanded panel.
 * @param onUpdate - Called with a partial patch when an edit field changes.
 */
function ActionRow({
  action,
  character,
  canEdit,
  isEditing = false,
  onRoll,
  onToggleFavorite,
  onEditToggle,
  onDelete,
  onUpdate,
}: {
  action: CharacterAction;
  character: NimbleCharacter;
  canEdit: boolean;
  isGM: boolean;
  isEditing?: boolean;
  onRoll?: () => void;
  onToggleFavorite?: () => void;
  onEditToggle?: () => void;
  onDelete?: () => void;
  onUpdate?: (patch: Partial<CharacterAction>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const typeStyle = ACTION_COLORS[action.type] ?? "";
  const icon = ACTION_ICONS[action.type] ?? "⚡";
  const resolvedFormula = resolveFormulaDisplay(
    action.formula || action.damage,
    character,
  );

  const handleHeaderClick = () => {
    if (isEditing) {
      onEditToggle?.();
      setExpanded(true);
      return;
    }
    setExpanded((e) => !e);
  };

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-colors ${
        isEditing
          ? "border-amber-700/60 bg-amber-950/10"
          : "border-stone-700/40 bg-stone-900/40"
      }`}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-2 cursor-pointer"
        onClick={handleHeaderClick}
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
            <RowMeta range={action.range} actionCost={action.actionCost} />
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
          <FavoriteButton
            isFavorite={action.isFavorite}
            canEdit={canEdit}
            onToggle={onToggleFavorite}
          />
          {canEdit && onRoll && <RollButton onClick={onRoll} />}
        </div>
      </div>

      {/* Description panel — only when not editing */}
      {expanded && !isEditing && (
        <RowDescriptionPanel
          description={action.description}
          onEdit={canEdit ? onEditToggle : undefined}
          onDelete={canEdit ? onDelete : undefined}
          canEdit={canEdit}
        />
      )}

      {/* Edit panel */}
      {isEditing && onUpdate && (
        <div className="px-3 pb-3 border-t border-amber-800/30 pt-2 flex flex-col gap-2">
          <FormField
            label="Name"
            value={action.name}
            onChange={(v) => onUpdate({ name: v })}
          />
          <GridFields>
            <FormField
              label="Range"
              value={action.range ?? ""}
              onChange={(v) => onUpdate({ range: v })}
              placeholder="e.g. 1, range 6"
            />
            <FormField
              label="Formula"
              value={action.formula ?? action.damage ?? ""}
              onChange={(v) => onUpdate({ formula: v, damage: v })}
              placeholder="e.g. 1d8+STR"
            />
          </GridFields>
          <FormField
            label="Action cost"
            type="number"
            value={action.actionCost ?? 0}
            min={0}
            onChange={(v) => onUpdate({ actionCost: parseInt(v) || undefined })}
          />
          <FormField
            label="Description"
            as="textarea"
            value={action.description ?? ""}
            onChange={(v) => onUpdate({ description: v })}
            rows={2}
          />
          <div className="flex justify-between items-center mt-1">
            <TextAction
              onClick={() => onDelete?.()}
              label="Remove action"
              variant="danger"
            />
            <TextAction
              onClick={() => onEditToggle?.()}
              label="OK"
              variant="confirm"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── AddActionModal ────────────────────────────────────────────────
/**
 * Simple modal form for creating a new custom combat action (name, type,
 * range, damage formula, description). Spells are added separately via
 * the Spells tab's own modal, which has school/tier/mana fields.
 *
 * @param onAdd - Called with the fully-constructed {@link CharacterAction} on submit.
 * @param onCancel - Called when the modal is dismissed without adding.
 */

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
          <FormField
            label="Name *"
            value={form.name}
            onChange={(v) => set("name", v)}
          />
          <FormField
            label="Type"
            as="select"
            value={form.type}
            onChange={(v) => set("type", v)}
          >
            {["melee", "ranged", "ability", "item"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </FormField>
          <GridFields>
            <FormField
              label="Range"
              value={form.range}
              onChange={(v) => set("range", v)}
              placeholder="e.g. 1, range 6"
            />
            <FormField
              label="Damage"
              value={form.damage}
              onChange={(v) => set("damage", v)}
              placeholder="e.g. 1d8+STR"
            />
          </GridFields>
          <FormField
            label="Description"
            as="textarea"
            value={form.description}
            onChange={(v) => set("description", v)}
            rows={2}
          />
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
