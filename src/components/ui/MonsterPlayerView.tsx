/**
 * @file MonsterPlayerView — what a non-GM viewer sees when the selected
 * token's sheet is a monster.
 *
 * Receives {@link MonsterPlayerViewData}, never a full `MonsterSheet` — see
 * `monsterView.ts`'s file header for why that narrowing happens at a typed
 * choke point in `App.tsx`, not by this component politely declining to
 * render a field it was handed anyway. There is no `maxHp` or `speed` prop
 * to add here by accident: the type this component accepts doesn't have
 * one.
 *
 * This is a combat visual aid, not the same sheet in read-only mode — per
 * the GM's own framing for this whole batch. Bigger, simpler, meant to be
 * read at a glance, not studied.
 *
 * No name here, deliberately: `App.tsx` already shows it in the shared
 * monster header (name + "Monster" badge) rendered above this component
 * for BOTH the GM and the player view — repeating it here was a real
 * duplicate, not a design choice, caught in review.
 *
 * No textual damage-band label either (no "Wounded"/"Badly hurt" string
 * anywhere in this component): only the {@link DamageBand}'s COLOR, applied
 * to the damage number itself. A text label would say more than the color
 * alone does — the entire point of a coarse, three-tier signal is to be
 * coarser than a number, and a precise word for each tier undoes that.
 */

import type { DamageBand, MonsterPlayerViewData } from "../../utils/monsterView";
import { BentoSection, GridFields } from "./common";

/**
 * Coarse damage band -> text color, matching the emerald/amber/rose
 * vocabulary `CharacterHeader`'s own HP pill already uses for the same
 * three-way "how bad is it" read. Discrete classes, not a computed
 * gradient — see `MonsterPanel`'s own `preciseDamageColor` for why the GM
 * side is allowed a continuous interpolation and this side deliberately
 * is not: a number whose exact shade varies continuously with the ratio
 * would let a player back-derive `maxHp` almost as precisely as seeing the
 * ratio itself, the same trap a textual band label would fall into.
 */
const BAND_COLOR: Record<DamageBand, string> = {
  unharmed: "text-emerald-300",
  wounded: "text-amber-300",
  "badly-hurt": "text-rose-300",
};

const ARMOR_LABEL: Record<MonsterPlayerViewData["armor"], string> = {
  unarmored: "Unarmored",
  medium: "Medium armor",
  heavy: "Heavy armor",
};

interface MonsterPlayerViewProps {
  data: MonsterPlayerViewData;
  damageBand: DamageBand;
}

export function MonsterPlayerView({ data, damageBand }: MonsterPlayerViewProps) {
  return (
    <div className="flex flex-col gap-3 px-3 pt-3 pb-2">
      <BentoSection>
        <GridFields cols={2}>
          <div className="flex flex-col gap-0.5">
            <span className="bento-label">Damage</span>
            <span className={`text-2xl font-black tabular-nums text-center ${BAND_COLOR[damageBand]}`}>
              {data.damageTaken}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 border-l pl-2 border-stone-700">
            <span className="bento-label">Armor</span>
            <span className="text-sm text-stone-300">{ARMOR_LABEL[data.armor]}</span>
          </div>
        </GridFields>
      </BentoSection>

      {data.conditions.length > 0 && (
        <BentoSection label="Conditions">
          <div className="flex flex-wrap gap-1.5">
            {data.conditions.map((condition) => (
              <span
                key={condition}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-900/40 border border-amber-700/40 text-amber-200"
              >
                {condition}
              </span>
            ))}
          </div>
        </BentoSection>
      )}

      {data.notes && (
        <BentoSection label="Notes">
          <p className="text-sm text-stone-300 whitespace-pre-wrap">{data.notes}</p>
        </BentoSection>
      )}
    </div>
  );
}
