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
import { SummaryTab } from "./components/tabs/SummaryTab";
import { CombatTab } from "./components/tabs/CombatTab";
import { SpellsTab } from "./components/tabs/SpellsTab";
import { InventoryTab } from "./components/tabs/InventoryTab";
import { RollLog } from "./components/ui/RollLog";
import { DicePanel } from "./components/ui/DicePanel";
import { CharacterHeader } from "./components/ui/CharacterHeader";
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
    playerName,
    permissions,
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

  const onRoll = (req: DiceRollRequest) => handleRoll(req);
  const onRollInitiative = (mode: RollMode = "standard") =>
    rollInitiative(mode);

  // ─────────────────────────────────────────────────────────────────────
  // All post-ready states share ONE layout so DicePanel is never unmounted.
  // Only the *content area* changes based on selectionState.
  // This prevents the DicePanel internal state (collapsed/mode/count) from
  // resetting when recentRolls updates and triggers a re-render.
  // ─────────────────────────────────────────────────────────────────────

  const showSheet = selectionState === "ready" && character !== null;
  const showNoToken = selectionState === "none";
  const showNoSheet = selectionState === "no-sheet";
  const firstItem = selectedItems[0];

  return (
    <div className="relative flex flex-col h-full bg-stone-950 text-stone-200 overflow-hidden font-sans pb-7">
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

      {/* ── Scrollable content area ───────────────────────────────── */}
      <main className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Sheet tabs */}
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
              />
            )}
            {activeTab === "spells" && (
              <SpellsTab
                character={character}
                canEdit={canEdit}
                isGM={isGM}
                onUpdate={updateCharacter}
                onRoll={onRoll}
              />
            )}
            {activeTab === "inventory" && (
              <InventoryTab
                character={character}
                canEdit={canEdit}
                isGM={isGM}
                onUpdate={updateCharacter}
                onRoll={onRoll}
              />
            )}
          </>
        )}

        {/* ── DicePanel + RollLog — always mounted here, never unmounted.
            Mounted once in <main>, visible in all states. */}
        <div className="px-3 pt-2 pb-3 flex flex-col gap-3">
          <DicePanel
            isGM={isGM}
            playerName={playerName}
            onRoll={handleFreeRoll}
            defaultCollapsed={true}
          />
          {(showNoToken || showNoSheet) && (
            <RollLog
              rolls={recentRolls}
              isGM={isGM}
              currentPlayerId={playerId}
              inline
            />
          )}
        </div>
      </main>

      {/* Floating pill — only when sheet is visible (not to stack with inline log) */}
      {showSheet && (
        <RollLog rolls={recentRolls} isGM={isGM} currentPlayerId={playerId} />
      )}
    </div>
  );
}
