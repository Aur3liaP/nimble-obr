/**
 * @file Confirmation modal shown before resolving any dice roll.
 *
 * Used by every tab (Summary, Combat, Spells, Inventory) right before
 * calling `onRoll` — lets the player pick standard/advantage/disadvantage,
 * how many extra dice to add for adv/disadv, and (GM only) whether the
 * result should be hidden from the rest of the table.
 */

import { useState } from "react";
import type { RollMode } from "../../types/character";
import { ModalShell } from "./common/ModalShell";
import { NumericStepper } from "./common/NumericStepper";

/**
 * @property label - Roll label shown in the modal title (e.g. "Strength Save").
 * @property formula - Formula preview shown under the title (variables not yet resolved to a final value here).
 * @property isGM - Shows the "Hidden roll" checkbox when true.
 * @property onConfirm - Called with (mode, advantageCount, hidden) when "Roll!" is clicked.
 * @property onCancel - Called when the modal is dismissed without rolling.
 */
interface DiceRollModalProps {
  label: string;
  formula: string;
  isGM?: boolean;
  onConfirm: (mode: RollMode, advantageCount: number, hidden: boolean) => void;
  onCancel: () => void;
}

/** Tailwind color classes per roll mode, applied to the active mode button. */
const MODE_STYLES: Record<RollMode, string> = {
  standard: "border-amber-500 bg-amber-900/50 text-amber-300",
  advantage: "border-emerald-500 bg-emerald-900/50 text-emerald-300",
  disadvantage: "border-rose-500 bg-rose-900/50 text-rose-300",
};

/** Display labels (with glyph) for each roll mode button. */
const MODE_LABELS: Record<RollMode, string> = {
  standard: "⬡ Standard",
  advantage: "▲ Adv.",
  disadvantage: "▼ Disadv.",
};

/**
 * Modal for confirming a dice roll: lets the player choose a mode
 * (standard/advantage/disadvantage), an extra-dice count when not
 * standard (defaults to 1, capped at 5), and — for the GM only — whether
 * to hide the result from other players.
 *
 * On standard mode, `advantageCount` is forced to 0 regardless of the
 * `extraCount` stepper's value, since extra dice only apply to adv/disadv.
 */
export function DiceRollModal({
  label,
  formula,
  isGM = false,
  onConfirm,
  onCancel,
}: DiceRollModalProps) {
  const [mode, setMode] = useState<RollMode>("standard");
  const [extraCount, setExtraCount] = useState(1);
  const [hidden, setHidden] = useState(false);

  const footer = (
    <div className="flex gap-2">
      <button
        onClick={onCancel}
        className="flex-1 py-2 rounded-lg border border-stone-700 text-stone-400 text-sm font-medium hover:bg-stone-800 transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={() =>
          onConfirm(mode, mode === "standard" ? 0 : extraCount, hidden)
        }
        className="flex-1 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-amber-100 text-sm font-bold transition-colors active:scale-95"
      >
        🎲 Roll!
      </button>
    </div>
  );

  return (
    <ModalShell
      title={label}
      accent="amber"
      onClose={onCancel}
      maxWidth="max-w-xs"
      maxHeight="max-h-screen"
      footer={footer}
      headerExtra={
        <p className="text-xs font-mono text-stone-400 mt-0.5">{formula}</p>
      }
    >
      <div className="p-4 flex flex-col gap-4">
        {/* Mode selector */}
        <div>
          <p className="text-[10px] text-stone-400 uppercase tracking-wider mb-2">
            Mode
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(["standard", "advantage", "disadvantage"] as RollMode[]).map(
              (m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`
                  py-2 px-1 rounded-lg text-xs font-semibold border transition-all duration-100
                  ${mode === m ? MODE_STYLES[m] : "border-stone-700 bg-stone-800/50 text-stone-400 hover:border-stone-500"}
                `}
                >
                  {MODE_LABELS[m]}
                </button>
              ),
            )}
          </div>
        </div>

        {/* Extra dice — only when adv/disadv */}
        {mode !== "standard" && (
          <div className="flex items-center gap-3">
            <NumericStepper
              label="Extra dice"
              value={extraCount}
              onChange={setExtraCount}
              min={1}
              max={5}
              compact
            />
            <span className="text-xs text-stone-500 mt-4">
              {mode === "advantage" ? "keep highest" : "keep lowest"}
            </span>
          </div>
        )}

        {/* Hidden roll — GM only */}
        {isGM && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
              className="accent-amber-500"
            />
            <span className="text-xs text-stone-300">
              Hidden roll (GM only)
            </span>
          </label>
        )}
      </div>
    </ModalShell>
  );
}
