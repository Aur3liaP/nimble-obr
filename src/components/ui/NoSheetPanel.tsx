/**
 * @file NoSheetPanel — shown in `App.tsx` when the selected token has no
 * character sheet attached.
 *
 * Always offers "Create a sheet" and, for the GM only, "Create a monster"
 * (see `onCreateMonster`'s own doc for why that's a direct entry point
 * rather than routing through a throwaway player sheet plus the switch
 * button). Also offers "Retrieve a lost soul" when
 * the vault holds at least one `"player"`-kind character no token currently
 * links to (`orphanedCharacters`, from `useOBR`, already filtered by
 * ownership — a player sees only their own, the GM sees everything) —
 * clicking it opens a list of those characters by name and level; picking
 * one links this token to that character directly, skipping a fresh, empty
 * sheet.
 *
 * Vocabulary note, deliberate: this file's own code, and `useOBR.ts`/
 * `characterVault.ts` underneath it, all call these `orphanedCharacters` —
 * plain and factual, matching what `findOrphanedCharacters` actually
 * computes (a character with no token pointing to it). The player-facing
 * copy below ("lost soul", "Recover a deleted character") is thematic,
 * fitting a fantasy TTRPG panel instead of describing a data-model
 * relationship. Same characters, two vocabularies for two audiences — not
 * an inconsistency to reconcile.
 *
 * This screen deliberately does NOT show `DicePanel` or `RollLog`: its one
 * job is creating or recovering a sheet, and free-rolling dice/browsing
 * roll history are already one click away via the no-token state (just
 * deselect) — see the "Panel layout contract" in CLAUDE.md and the comment
 * on `DicePanel`'s wrapper in `App.tsx`. The required Nimble 3rd Party
 * Creator License notices, normally carried by inline `RollLog` (see that
 * file's own header), are rendered directly here instead (default view
 * only, not the recovery list — see below) so removing `RollLog` from this
 * screen doesn't also remove its only source of that text here.
 */

import { useState } from "react";
import type { NimbleCharacter } from "../../types/character";
import { useSearchFilter } from "../../hooks/useSearchFilter";
import { LicenseAttribution, VttNotice } from "./RollLog";
import { MonsterIcon } from "./icons/MonsterIcon";
import { BlueFlameIcon } from "./icons/BlueFlameIcon";

/**
 * The recovery list shows a name filter once there are more than this many
 * candidates — below this, scanning the (already short) list by eye is
 * faster than typing. A real reason to raise this bar exists, not just
 * scale: two characters with the same name AND level are otherwise
 * indistinguishable in this list (no other identifying field is shown, per
 * the original spec: name and level only) — the filter at least narrows a
 * long list down to the handful of homonyms, even though it can't fully
 * disambiguate between them.
 */
const SEARCH_THRESHOLD = 10;

/**
 * Bounds the entry list's own height so it scrolls internally instead of
 * growing the whole no-sheet screen — which, left unbounded, could push
 * this extension's fixed-height panel past its own bottom edge (see
 * App.tsx's outer container, `overflow-hidden`), clipping whatever renders
 * below `NoSheetPanel` in the page, including the inline Roll History.
 */
const LIST_MAX_HEIGHT_CLASS = "max-h-64";

interface NoSheetPanelProps {
  /** `"player"`-kind vault characters with no token currently linking to them — see `useOBR`'s `orphanedCharacters`. */
  orphanedCharacters: NimbleCharacter[];
  /** Attaches a brand-new default sheet to the selected token. `undefined` when there's no concrete token to attach to (defensive; `App.tsx` only renders this panel when one exists). */
  onCreate: (() => void) | undefined;
  /**
   * Attaches a brand-new monster sheet directly to the selected token —
   * GM-only (`undefined` for a non-GM viewer, hiding the button entirely,
   * same convention as `onCreate` being `undefined` with no concrete
   * token). Deliberately a separate entry point from "Create a sheet" +
   * the switch button: routing every monster through a throwaway
   * `NimbleCharacter` first would leave an empty, orphaned "New Hero"
   * record behind in the vault on every single monster created — harmless
   * one at a time, but a real mess on a ten-monster encounter (ten
   * unrecoverable player-kind orphans cluttering the GM's own recovery
   * list, since `cleanupOrphanedMonsters` only ever sweeps `"monster"`
   * kind).
   */
  onCreateMonster: (() => void) | undefined;
  /** Links the selected token to an existing vault character by id. */
  onRecover: (characterId: string) => void;
}

/**
 * Renders the "no sheet" empty state, or — once "Retrieve a lost soul" is
 * clicked — the recovery list in its place. Purely local UI state
 * (`showRecoveryList`, `search` via `useSearchFilter`); nothing here talks
 * to OBR directly, that's `useOBR`'s job via the two callback props.
 *
 * No delete/cleanup action lives here, on purpose: a destructive button
 * next to Recover, in a list where entries can be visually
 * indistinguishable (see `SEARCH_THRESHOLD`'s doc), with no confirmation
 * dialog convention in this codebase and no undo for a vault delete, is a
 * real way to lose a character permanently by misclick. Deferred to its
 * own dedicated batch, ideally alongside the JSON export this file's own
 * task list already has planned — export-before-delete is the safety net
 * this needs, not a same-list confirmation prompt bolted on early.
 */
export function NoSheetPanel({
  orphanedCharacters,
  onCreate,
  onCreateMonster,
  onRecover,
}: NoSheetPanelProps) {
  const [showRecoveryList, setShowRecoveryList] = useState(false);
  const { search, setSearch, filtered } = useSearchFilter(orphanedCharacters, (c) => [c.name]);

  if (showRecoveryList) {
    return (
      <div className="flex flex-col gap-2 py-3 px-4 min-h-0">
        {/* Header row: Back + title, deliberately OUTSIDE the scrollable
            list below (not a footer button under it) — with two entries
            a trailing Back was reachable without scrolling, but with
            fifty it wasn't reachable at all without scrolling through
            every entry first. Pinned here, it's always one click away
            regardless of list length. */}
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={() => setShowRecoveryList(false)}
            aria-label="Back"
            className="shrink-0 text-stone-500 hover:text-stone-300 transition-colors text-base leading-none"
          >
            ←
          </button>
          <h3 className="flex-1 text-xs font-semibold uppercase tracking-widest text-stone-500 text-center">
            Recover a deleted character
          </h3>
          {/* Balances the back arrow's width so the title stays visually centered rather than skewed right. */}
          <span className="shrink-0 w-4" aria-hidden="true" />
        </div>

        {orphanedCharacters.length > SEARCH_THRESHOLD && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name…"
            className="shrink-0 bg-stone-900/60 border border-stone-700 rounded-lg px-2.5 py-1.5 text-xs text-stone-200 outline-none focus:border-amber-600 placeholder-stone-600"
          />
        )}

        <div className={`flex flex-col gap-1.5 overflow-y-auto ${LIST_MAX_HEIGHT_CLASS}`}>
          {filtered.length === 0 ? (
            <p className="text-xs text-stone-600 italic text-center py-4">
              {orphanedCharacters.length === 0 ? "Nothing left to recover." : "No match."}
            </p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => onRecover(c.id)}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-stone-900 hover:bg-stone-800 border border-stone-800 text-left transition-colors"
              >
                <span className="text-sm text-stone-200 font-medium truncate">
                  {c.name || "Unnamed hero"}
                </span>
                <span className="text-[11px] text-stone-500 shrink-0 ml-2">Lv {c.level}</span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10 px-6 text-center">
      <span className="text-5xl opacity-40">📄</span>
      <p className="text-sm text-stone-500 max-w-50 leading-relaxed">
        This token has no character sheet.
      </p>
      {/* Three same-level buttons, each with an icon — a plain emoji for
          "Create a sheet" (no icon-library dependency justified for one
          glyph — see this batch's own decision to drop lucide-react), the
          project's own SVG icons (inlined as components, not loaded via
          <img> — see MonsterIcon/BlueFlameIcon's own file headers for why)
          for the other two. `flex-wrap` so a narrow panel stacks instead of
          truncating/overflowing when all three are present. */}
      <div className="flex flex-wrap justify-center gap-2">
        {onCreate && (
          <button
            onClick={onCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-800 hover:bg-amber-700 text-amber-100 text-sm font-semibold transition-colors"
          >
            <span className="text-sm leading-none" aria-hidden="true">📄</span>
            Create a sheet
          </button>
        )}
        {onCreateMonster && (
          <button
            onClick={onCreateMonster}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-semibold transition-colors"
          >
            <MonsterIcon className="w-3.5 h-3.5 text-stone-200" />
            Create a monster
          </button>
        )}
        {orphanedCharacters.length > 0 && (
          <button
            onClick={() => setShowRecoveryList(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-semibold transition-colors"
          >
            <BlueFlameIcon className="w-3.5 h-3.5" />
            Retrieve a lost soul
          </button>
        )}
      </div>

      {/* Required license notices — see this file's own header for why
          they're rendered directly here instead of via inline RollLog. */}
      <div className="mt-2 pt-3 border-t border-stone-800 w-full">
        <VttNotice />
        <LicenseAttribution className="mt-1" />
      </div>
    </div>
  );
}
