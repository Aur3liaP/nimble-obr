/**
 * @file CharacterHeader — top banner shown when a character sheet is open.
 *
 * Extracted from `App.tsx` to keep the root
 * component focused on layout/tab orchestration rather than rendering
 * ~70 lines of header JSX inline. Pure presentational component: all
 * data and callbacks are passed in via props.
 */

import type { NimbleCharacter } from "../../types/character";
import type { CharacterPermissions } from "../../hooks/useOBR";

interface CharacterHeaderProps {
  character: NimbleCharacter;
  permissions: CharacterPermissions;
  onClaim: () => void;
}

/**
 * Renders the character's name/ancestry/class/level line, an HP pill
 * (color-coded by current ratio, with temp HP shown separately), the
 * GM/owner/claim badge, and the wounds track (only when wounds > 0).
 */
export function CharacterHeader({
  character,
  permissions,
  onClaim,
}: CharacterHeaderProps) {
  const { isGM, isOwner, isUnclaimed } = permissions;

  return (
    <header className="shrink-0 px-3 pt-3 pb-0">
      <div className="bento-card py-2! px-3!">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-black text-amber-200 truncate leading-tight">
              {character.name}
            </h1>
            <p className="text-[10px] text-stone-500 truncate">
              {[
                character.ancestry,
                character.class,
                character.level ? `Lv.${character.level}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                character.hp.current === 0
                  ? "border-rose-700 bg-rose-950/60 text-rose-300"
                  : character.hp.current <= character.hp.max * 0.5
                    ? "border-amber-700/60 bg-amber-950/30 text-amber-300"
                    : "border-emerald-800/50 bg-emerald-950/30 text-emerald-300"
              }`}
            >
              ♥ {character.hp.current}/{character.hp.max}
              {character.hp.temp > 0 && (
                <span className="text-sky-300 ml-1">
                  +{character.hp.temp}
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              {isGM && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase bg-amber-900/40 text-amber-400 border border-amber-800/40">
                  GM
                </span>
              )}
              {!isGM && !isOwner && (
                <button
                  onClick={onClaim}
                  className="px-2 py-0.5 rounded text-[9px] font-semibold border border-sky-700/60 bg-sky-950/40 text-sky-300 hover:bg-sky-900/50 transition-colors"
                >
                  {isUnclaimed ? "Claim" : "Take over"}
                </button>
              )}
              {isOwner && !isGM && (
                <span className="px-1.5 py-0.5 rounded text-[9px] text-stone-500 border border-stone-800">
                  mine
                </span>
              )}
            </div>
          </div>
        </div>
        {character.wounds > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-[9px] text-rose-700 uppercase tracking-wider">
              Wounds
            </span>
            <div className="flex gap-1">
              {Array.from({ length: character.maxWounds + 1 }).map(
                (_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full ${i < character.wounds ? "bg-rose-700" : "bg-stone-700"}`}
                  />
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
