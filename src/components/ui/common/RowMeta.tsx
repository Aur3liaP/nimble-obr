/**
 * RowMeta — compact "range · action cost" line shown in row headers.
 *
 * Used in: ActionRow, SpellRow, ItemRow — anywhere a row needs to show
 * range and/or action cost inline without taking much space.
 *
 * Icons:
 *  📍 range       (title="Range" on hover)
 *  ⚡ action cost (title="Action cost" on hover, shows just the number)
 *
 * Props
 * ─────
 * range       — range/reach string (e.g. "8", "touch", "self"). Omit to hide.
 * actionCost  — number of actions. Omit or 0 to hide (0-cost reactions still show if you pass it explicitly as a string range note instead).
 * className   — extra classes on the wrapper
 */

interface RowMetaProps {
  range?: string;
  actionCost?: number;
  className?: string;
}

export function RowMeta({ range, actionCost, className = "" }: RowMetaProps) {
  if (!range && !actionCost) return null;

  return (
    <span className={`flex items-center gap-2 text-[10px] text-stone-500 ${className}`}>
      {range && (
        <span title="Range">📍 {range}</span>
      )}
      {!!actionCost && (
        <span title="Action cost">⚡ {actionCost}</span>
      )}
    </span>
  );
}
