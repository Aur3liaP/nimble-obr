/**
 * @file MonsterPanel — the entire monster sheet, rendered in `App.tsx` in
 * place of the four player tabs whenever the selected token's record is a
 * {@link MonsterSheet}.
 *
 * Deliberately not tabbed like the player sheet: a `MonsterSheet` has seven
 * fields total (see that type's doc for why it isn't a trimmed-down
 * `NimbleCharacter`), all of which fit on one screen.
 *
 * GM-only, in both senses: `App.tsx` only ever mounts this component when
 * `isGM` is true (a non-GM viewer gets `MonsterPlayerView` instead, built
 * from a narrowed prop type that structurally excludes `maxHp`/`speed` —
 * see `monsterView.ts`'s file header). `canEdit` is still threaded through
 * and every control still respects it, matching every other tab's
 * discipline, even though for a monster it currently always agrees with
 * `isGM` (see `useOBR.ts`'s permissions block) — defense in depth against a
 * future call site, not dead weight today.
 */

import type { MonsterSheet, MonsterArmor } from "../../types/character";
import { FormField, GridFields, BentoSection, TagSelector } from "./common";
import { CONDITIONS } from "../../data/conditions";
import {
  computeDamageRatio,
  WOUNDED_AT_RATIO,
  BADLY_HURT_AT_RATIO,
} from "../../utils/monsterView";

const ARMOR_OPTIONS: { value: MonsterArmor; label: string }[] = [
  { value: "unarmored", label: "Unarmored" },
  { value: "medium", label: "Medium" },
  { value: "heavy", label: "Heavy" },
];

const CONDITION_NAMES = CONDITIONS.map((c) => c.name);

/**
 * Precise GM-facing damage color, unlike the player's own coarse three-tier
 * band (`MonsterPlayerView`) — permitted explicitly by this batch's design
 * ("côté MJ, elle peut être précise"). A continuous interpolation of this
 * app's existing emerald/amber/rose HP vocabulary (`CharacterHeader`),
 * computed inline since Tailwind can't compile a dynamic class (see
 * CLAUDE.md's "Tailwind cannot compile dynamic class names").
 *
 * Shares its ratio (`computeDamageRatio`) AND its color-stop positions
 * (`WOUNDED_AT_RATIO`/`BADLY_HURT_AT_RATIO`, from `monsterView.ts`) with the
 * player's discrete `computeDamageBand` — this is the actual fix for a real
 * bug: an earlier version used its own hand-picked stop at ratio 0.5, while
 * the player's band flipped out of "unharmed" at any damage above zero, so
 * at 1 damage on a 30-maxHp monster the GM saw green and players saw amber
 * for the identical underlying ratio. Two renderings of ONE calculation now
 * — a continuous gradient here, three flat bands there — never two
 * independently-tuned ones again.
 */
function preciseDamageColor(damageTaken: number, maxHp: number): string {
  const ratio = computeDamageRatio(damageTaken, maxHp);
  const stops = [
    { at: 0, rgb: [16, 185, 129] }, // emerald
    { at: WOUNDED_AT_RATIO, rgb: [245, 158, 11] }, // amber
    { at: BADLY_HURT_AT_RATIO, rgb: [225, 29, 72] }, // rose
  ];
  if (ratio >= BADLY_HURT_AT_RATIO) {
    const rose = stops[2].rgb;
    return `rgb(${rose.join(",")})`;
  }
  const [a, b] = ratio < WOUNDED_AT_RATIO ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const t = (ratio - a.at) / (b.at - a.at || 1);
  const rgb = a.rgb.map((c, i) => Math.round(c + (b.rgb[i] - c) * t));
  return `rgb(${rgb.join(",")})`;
}

interface MonsterPanelProps {
  character: MonsterSheet;
  canEdit: boolean;
  onUpdate: (updates: Partial<MonsterSheet>) => void;
}

/**
 * Renders every {@link MonsterSheet} field as a single-screen form: name,
 * the damage tracker (`damageTaken`/`maxHp` — see that field's own doc for
 * why it's a damage COUNTER, not HP), armor/speed, conditions (via the
 * shared `TagSelector`, same catalogue-plus-free-text ergonomics as
 * `LanguageSelector`), and shared GM notes.
 */
export function MonsterPanel({ character, canEdit, onUpdate }: MonsterPanelProps) {
  return (
    <div className="flex flex-col gap-3 px-3 pt-3 pb-2">
      <BentoSection>
        <FormField
          label="Name"
          value={character.name}
          onChange={(v) => onUpdate({ name: v })}
          disabled={!canEdit}
        />
      </BentoSection>

      <BentoSection label="Damage">
        <GridFields cols={2}>
          <FormField
            label="Damage taken"
            as="input"
            type="number"
            value={character.damageTaken}
            onChange={(v) => onUpdate({ damageTaken: Math.max(0, Number(v) || 0) })}
            disabled={!canEdit}
            labelExtra={
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: preciseDamageColor(character.damageTaken, character.maxHp),
                }}
              />
            }
          />
          <FormField
            label="Max HP (GM only)"
            as="input"
            type="number"
            value={character.maxHp}
            onChange={(v) => onUpdate({ maxHp: Math.max(1, Number(v) || 1) })}
            disabled={!canEdit}
          />
        </GridFields>
      </BentoSection>

      <BentoSection>
        <GridFields cols={2}>
          <FormField
            label="Armor"
            as="select"
            value={character.armor}
            onChange={(v) => onUpdate({ armor: v as MonsterArmor })}
            disabled={!canEdit}
          >
            {ARMOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </FormField>
          <FormField
            label="Speed"
            as="input"
            type="number"
            value={character.speed}
            onChange={(v) => onUpdate({ speed: Math.max(0, Number(v) || 0) })}
            disabled={!canEdit}
          />
        </GridFields>
      </BentoSection>

      {/* z-10: `.bento-card` has `backdrop-blur-sm`, which creates its own
          stacking context regardless of position — without this, the
          Notes card right below (a later flex-item sibling at the default
          stacking level) paints OVER this card's open dropdown instead of
          the dropdown showing above it. Same fix already applied to
          SummaryTab's Languages section for the identical reason — see
          that file's own `BentoSection` call. */}
      <BentoSection label="Conditions" className="relative z-10">
        <TagSelector
          selected={character.conditions}
          catalog={CONDITION_NAMES}
          placeholder="Add conditions…"
          readOnly={!canEdit}
          onChange={(conditions) => onUpdate({ conditions })}
        />
      </BentoSection>

      <BentoSection label="Notes">
        <FormField
          label=""
          as="textarea"
          value={character.notes}
          onChange={(v) => onUpdate({ notes: v })}
          rows={4}
          disabled={!canEdit}
        />
      </BentoSection>
    </div>
  );
}
