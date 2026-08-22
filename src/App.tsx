/**
 * @file Root component of the Nimble OBR extension panel.
 *
 * Owns the tab navigation and renders one shared layout across every
 * selection state (no token / no sheet / ready), so that the
 * {@link DicePanel} and {@link RollLog} are mounted exactly once and never
 * lose their internal state (collapsed/mode/count) when the selection or
 * roll log changes.
 */

import { useState } from "react";
import { useOBR } from "./hooks/useOBR";
import { useDeleteUndo } from "./hooks/useDeleteUndo";
import { SummaryTab } from "./components/tabs/SummaryTab";
import { CombatTab } from "./components/tabs/CombatTab";
import { SpellsTab } from "./components/tabs/SpellsTab";
import { InventoryTab } from "./components/tabs/InventoryTab";
import { RollLog } from "./components/ui/RollLog";
import { DicePanel } from "./components/ui/DicePanel";
import { CharacterHeader } from "./components/ui/CharacterHeader";
import { SyncStatusBanner } from "./components/ui/SyncStatusBanner";
import { DeleteUndoToast } from "./components/ui/DeleteUndoToast";
import type { DiceRollRequest, RollMode } from "./types/character";

/** Identifiers for the four character sheet tabs. */
/** Tab definitions (id, label, icon) rendered in the tab bar. */
type TabId = "summary" | "combat" | "spells" | "inventory";
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "summary", label: "Summary", icon: "📋" },
  { id: "combat", label: "Combat", icon: "⚔️" },
  { id: "spells", label: "Spells", icon: "✨" },
  { id: "inventory", label: "Inventory", icon: "🎒" },
];

/**
 * Renders the extension panel: header (character name/HP/role), tab bar,
 * and the active tab's content, plus the always-mounted dice panel and
 * roll log. All character data and permissions come from {@link useOBR}.
 */
export default function App() {
  const {
    isReady,
    selectionState,
    character,
    selectedItems,
    playerId,
    permissions,
    syncStatus,
    updateCharacter,
    handleRoll,
    handleFreeRoll,
    rollInitiative,
    recentRolls,
    createSheetForToken,
    claimToken,
  } = useOBR();

  const { canEdit, isGM } = permissions;

  const [activeTab, setActiveTab] = useState<TabId>("summary");

  // Mounted here, above the conditionally-rendered tabs, so a pending undo
  // survives switching tabs — see useDeleteUndo's file header for why a
  // tab-local useState would lose it. `selectedItems[0]?.id` (the live
  // selection's real item id) is what the hook uses to detect a token
  // switch — see its JSDoc.
  const { pendingUndo, deleteWithUndo, undo } = useDeleteUndo(
    character,
    selectedItems[0]?.id,
    updateCharacter,
  );

  // Local-only feedback for a roll that failed a safety-limit/parse check
  // (DiceRollResult.error set). Never written to OBR — a failed roll is
  // never pushed to the shared log in the first place (see useOBR's
  // pushRollToLog gating), so this exists purely to tell the person who
  // triggered the roll why nothing showed up in the log.
  const [rollError, setRollError] = useState<string | null>(null);

  // ── Loading — only truly empty screen, no DicePanel needed yet ──
  if (!isReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-700 border-t-amber-400 rounded-full animate-spin" />
          <p className="text-sm text-stone-500">Connecting to Owlbear…</p>
        </div>
      </div>
    );
  }

  const onRoll = (req: DiceRollRequest) => {
    setRollError(null);
    void handleRoll(req).then((result) => {
      if (result?.error) setRollError(result.error);
    });
  };
  const onFreeRoll = (req: DiceRollRequest) => {
    setRollError(null);
    void handleFreeRoll(req).then((result) => {
      if (result?.error) setRollError(result.error);
    });
  };
  const onRollInitiative = (
    mode: RollMode = "standard",
    advantageCount = 0,
    hidden = false,
  ) => {
    setRollError(null);
    // Unlike onRoll/onFreeRoll, CombatTab awaits this and reads `.total`/
    // `.naturalRoll` off the resolved result to derive the starting action
    // count (see initiativeToActions), so the result must still be
    // returned, not swallowed. `naturalRoll` is `kept[0]` — the kept d20
    // after advantage/disadvantage resolution, not the raw first die (see
    // RollFormulaResult.kept's doc in formulaParser.ts).
    return rollInitiative(mode, advantageCount, hidden).then((result) => {
      if (!result) return null;
      if (result.error) {
        setRollError(result.error);
        return null;
      }
      return { total: result.total, naturalRoll: result.kept[0] ?? result.total };
    });
  };

  // ─────────────────────────────────────────────────────────────────────
  // All post-ready states share ONE layout so DicePanel is never unmounted.
  // Only the *content area* changes based on selectionState.
  // This prevents the DicePanel internal state (collapsed/mode/count) from
  // resetting when recentRolls updates and triggers a re-render.
  // ─────────────────────────────────────────────────────────────────────

  const showSheet = selectionState === "ready" && character !== null;
  const showNoToken = selectionState === "none";
  const showNoSheet = selectionState === "no-sheet";
  const showUnsupportedVersion = selectionState === "unsupported-version";
  const showInvalidSheet = selectionState === "invalid-sheet";
  const firstItem = selectedItems[0];

  return (
    <div className="relative flex flex-col h-full bg-stone-950 text-stone-200 overflow-hidden font-sans pb-7">
      {/* ── Sync status — always mounted, renders nothing when idle.
          Not scoped to showSheet: a roll log write can fail with no
          character sheet open at all. ── */}
      <SyncStatusBanner status={syncStatus} />
      <DeleteUndoToast pendingUndo={pendingUndo} onUndo={undo} />

      {/* ── Header — only when a sheet is open ───────────────────── */}
      {showSheet && character && (
        <CharacterHeader
          character={character}
          permissions={permissions}
          onClaim={claimToken}
        />
      )}

      {/* ── Tab bar — only when sheet open ───────────────────────── */}
      {showSheet && (
        <>
          <div className="shrink-0 flex gap-1 px-3 pt-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-label={tab.label}
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={`flex-1 flex flex-col items-center py-1.5 rounded-t-lg border-b-2 text-[10px] font-semibold tracking-wide transition-all duration-150 ${
                  activeTab === tab.id
                    ? "border-amber-600 bg-stone-800/80 text-amber-300"
                    : "border-transparent text-stone-500 hover:text-stone-300 hover:bg-stone-900/40"
                }`}
              >
                <span className="text-base leading-none">{tab.icon}</span>
                <span className="mt-0.5">{tab.label}</span>
              </button>
            ))}
          </div>
          <div className="shrink-0 h-px bg-stone-700/60 mx-3" />
        </>
      )}

      {/* ── No-token header ───────────────────────────────────────── */}
      {showNoToken && (
        <div className="shrink-0 px-3 pt-3 pb-2 border-b border-stone-800">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Nimble · No token selected
          </h2>
          <p className="text-[11px] text-stone-600 mt-0.5">
            Select a character token to open their sheet.
          </p>
        </div>
      )}

      {/* ── No-sheet message ──────────────────────────────────────── */}
      {showNoSheet && (
        <div className="flex flex-col items-center justify-center gap-4 py-10 px-6 text-center">
          <span className="text-5xl opacity-40">📄</span>
          <p className="text-sm text-stone-500 max-w-50 leading-relaxed">
            This token has no character sheet.
          </p>
          {firstItem && (
            <button
              onClick={() => createSheetForToken(firstItem)}
              className="px-4 py-2 rounded-lg bg-amber-800 hover:bg-amber-700 text-amber-100 text-sm font-semibold transition-colors"
            >
              Create sheet
            </button>
          )}
        </div>
      )}

      {/* ── Unsupported schema version — a newer client wrote this sheet
          than this build understands; no downward migration exists ──── */}
      {showUnsupportedVersion && (
        <div className="flex flex-col items-center justify-center gap-4 py-10 px-6 text-center">
          <span className="text-5xl opacity-40">⬆️</span>
          <p className="text-sm text-stone-500 max-w-50 leading-relaxed">
            This character sheet was saved by a newer version of this extension. Reload the page to get the latest version.
          </p>
        </div>
      )}

      {/* ── Invalid sheet data — corrupted metadata, or a migration failed ── */}
      {showInvalidSheet && (
        <div className="flex flex-col items-center justify-center gap-4 py-10 px-6 text-center">
          <span className="text-5xl opacity-40">⚠️</span>
          <p className="text-sm text-stone-500 max-w-50 leading-relaxed">
            This character sheet's data could not be read. It may be corrupted. Check the browser console for details.
          </p>
        </div>
      )}

      {/* ── Roll error banner — local-only feedback for a failed roll.
          Never touches OBR; a failed roll never reaches the shared log. ── */}
      {rollError && (
        <div
          role="alert"
          className="shrink-0 mx-3 mt-2 flex items-start gap-2 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300"
        >
          <span className="shrink-0">⚠</span>
          <span className="flex-1">{rollError}</span>
          <button
            onClick={() => setRollError(null)}
            aria-label="Dismiss"
            className="shrink-0 text-rose-500 hover:text-rose-300 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Scrollable content area ─────────────────────────────────
          Part 1h: RESTORED to the pre-part-1f design (a single scroll
          region) per the "Panel layout contract" in CLAUDE.md, after parts
          1f and 1g each tried to make `<main>` a flex CONTAINER for its
          children and each broke a different state — see CLAUDE.md's
          history for both. `<main>` here is deliberately NOT `flex
          flex-col` when a sheet tab is open: the contract requires
          `DicePanel` to "sit at the bottom of the tab content... and
          scroll WITH the content," which is exactly plain block flow
          inside a single `overflow-y-auto` region — the tab content and
          the DicePanel/RollLog wrapper below it are just two stacked
          block-level children, and scrolling `<main>` moves both together.
          Part 1g's fix (giving the tab content its OWN internal
          `overflow-y-auto` region, separate from `<main>`'s) DID stop the
          DicePanel wrapper from collapsing to 0px, but it also silently
          pinned DicePanel below a fixed-height, independently-scrolling
          tab content box — i.e. DicePanel stopped scrolling with the
          sheet, which nothing had written down as a requirement until the
          contract above existed to catch it against. That is the class of
          bug this whole rewrite is meant to end: verify against the
          contract, not against whichever single state was last reported
          broken.

          `<main>` DOES still need `flex flex-col` in the no-sheet states
          (no-token/no-sheet/unsupported/invalid), because there the
          DicePanel/RollLog wrapper is `<main>`'s ONLY child — no sibling
          to compete with for space — so stretching it via `flex-1 min-h-0`
          to reach `<main>`'s real bottom (needed so `RollLog`'s inline
          license attribution reaches a genuine bottom edge, not just its
          own natural content height) is safe there: the 1g collapse bug
          specifically required TWO children with mismatched flex-basis
          fighting over shrink space, and a lone child can't do that to
          itself. This is why the license-attribution fix from parts 1e/1f
          DOES genuinely depend on `<main>` being flex — but only in the
          no-sheet branch, never the sheet-open one; conditioning `<main>`'s
          own classes on `showSheet` satisfies both without re-breaking
          either. ── */}
      <main
        className={`flex-1 overflow-y-auto scrollbar-thin ${showSheet ? "" : "flex flex-col"}`}
      >
        {/* Sheet tabs — plain block-flow content, no wrapper div, no
            independent scroll region of its own. `<main>` is the ONLY
            scroll container in this state, so DicePanel below sits at the
            bottom of this content and scrolls away with it — per the
            contract, that's the intended behavior, not a bug to fix. */}
        {showSheet && character && (
          <>
            {activeTab === "summary" && (
              <SummaryTab
                character={character}
                canEdit={canEdit}
                onUpdate={updateCharacter}
                onRoll={onRoll}
                isGM={isGM}
              />
            )}
            {activeTab === "combat" && (
              <CombatTab
                character={character}
                canEdit={canEdit}
                isGM={isGM}
                onUpdate={updateCharacter}
                onRoll={onRoll}
                onRollInitiative={onRollInitiative}
                onDeleteEntry={deleteWithUndo}
              />
            )}
            {activeTab === "spells" && (
              <SpellsTab
                character={character}
                canEdit={canEdit}
                isGM={isGM}
                onUpdate={updateCharacter}
                onRoll={onRoll}
                onDeleteEntry={deleteWithUndo}
              />
            )}
            {activeTab === "inventory" && (
              <InventoryTab
                character={character}
                canEdit={canEdit}
                isGM={isGM}
                onUpdate={updateCharacter}
                onRoll={onRoll}
                onDeleteEntry={deleteWithUndo}
              />
            )}
          </>
        )}

        {/* ── DicePanel + RollLog — always mounted here, never unmounted.
            Mounted once in <main>, visible in all states. RollLog (inline)
            also carries the pinned Nimble license notices — see its
            @file header — present here from the empty state onward.

            Part 1h: plain `flex flex-col gap-3` (natural content height,
            a normal block-flow child of `<main>`) when a sheet tab is
            open — no `flex-1`/`min-h-0`, nothing to stretch or collapse.
            `flex-1 min-h-0` only when this wrapper is `<main>`'s sole
            child (no-sheet states) — see the comment on `<main>` above for
            why that's safe there and not elsewhere. */}
        <div
          className={`px-3 pt-2 pb-3 flex flex-col gap-3 ${showSheet ? "" : "flex-1 min-h-0"}`}
        >
          <DicePanel
            isGM={isGM}
            onRoll={onFreeRoll}
            defaultCollapsed={true}
          />
          {(showNoToken || showNoSheet || showUnsupportedVersion || showInvalidSheet) && (
            <RollLog
              rolls={recentRolls}
              isGM={isGM}
              currentPlayerId={playerId}
              inline
            />
          )}
        </div>
      </main>

      {/* Floating pill — only when sheet is visible (not to stack with inline log).
          Carries the same pinned license notices inside its popup, and no
          longer unmounts when there are zero rolls — see RollLog's @file
          header. */}
      {showSheet && (
        <RollLog rolls={recentRolls} isGM={isGM} currentPlayerId={playerId} />
      )}
    </div>
  );
}
