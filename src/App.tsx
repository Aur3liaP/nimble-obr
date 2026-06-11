/**
 * App.tsx – Root component for the Nimble OBR Character Sheet extension.
 *
 * Handles:
 *  - OBR SDK initialization via useOBR
 *  - Empty/multi-select/no-sheet states
 *  - Tab navigation (Summary | Combat | Spells | Inventory)
 *  - Roll log overlay
 *  - GM create-sheet shortcut
 */

// ─── Tab config ──────────────────────────────
import { useState } from "react";
import { useOBR } from "./hooks/useOBR";
import { SummaryTab } from "./components/tabs/SummaryTab";
import { CombatTab } from "./components/tabs/CombatTab";
import { SpellsTab } from "./components/tabs/SpellsTab";
import { InventoryTab } from "./components/tabs/InventoryTab";
import { RollLog } from "./components/ui/RollLog";
import type { DiceRollRequest, RollMode } from "./types/character";

type TabId = "summary" | "combat" | "spells" | "inventory";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "summary", label: "Summary", icon: "📋" },
  { id: "combat", label: "Combat", icon: "⚔️" },
  { id: "spells", label: "Spells", icon: "✨" },
  { id: "inventory", label: "Inventory", icon: "🎒" },
];

// ─────────────────────────────────────────────────────────────────
export default function App() {
  const {
    isReady,
    selectionState,
    character,
    selectedItems,
    playerId,
    isGM,
    canEdit,
    updateCharacter,
    handleRoll,
    rollInitiative,
    recentRolls,
    createSheetForToken,
    claimToken,
  } = useOBR();

  const [activeTab, setActiveTab] = useState<TabId>("summary");

  // ── Loading ──────────────────────────────────────────────────
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

  // ── No selection → show global roll log ───────────────────────
  if (selectionState === "none") {
    return (
      <div className="flex flex-col h-screen bg-stone-950 text-stone-200 overflow-hidden">
        <div className="shrink-0 px-3 pt-3 pb-2 border-b border-stone-800">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Nimble · No token selected
          </h2>
          <p className="text-[11px] text-stone-600 mt-0.5">
            Select a character token to open their sheet.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
          <RollLog
            rolls={recentRolls}
            isGM={isGM}
            currentPlayerId={playerId}
            inline
          />
        </div>
      </div>
    );
  }

  // ── No sheet on token ─────────────────────────────────────────
  if (selectionState === "no-sheet") {
    const firstItem = selectedItems[0];
    return (
      <div className="flex flex-col h-screen bg-stone-950 text-stone-200 overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
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
        <div className="border-t border-stone-800 p-3">
          <RollLog
            rolls={recentRolls}
            isGM={isGM}
            currentPlayerId={playerId}
            inline
          />
        </div>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-950">
        <p className="text-sm text-stone-500">Loading…</p>
      </div>
    );
  }

  // ── Helpers ──────────────────────────────────────────────────
  const onRoll = (req: DiceRollRequest) => handleRoll(req);
  const onRollInitiative = (mode: RollMode = "standard") =>
    rollInitiative(mode);
  const isOwner = character.ownerId === playerId;
  const isUnclaimed = !character.ownerId;

  return (
    <div className="flex flex-col h-screen bg-stone-950 text-stone-200 overflow-hidden font-sans">
      {/* ── Header ────────────────────────────────────────────── */}
      <header className="shrink-0 px-3 pt-3 pb-0">
        <div className="bento-card !py-2 !px-3">
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
              {/* HP */}
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
              </span>

              <div className="flex items-center gap-1">
                {isGM && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase bg-amber-900/40 text-amber-400 border border-amber-800/40">
                    GM
                  </span>
                )}
                {/* Claim button for unclaimed or other player's token */}
                {!isGM && !isOwner && (
                  <button
                    onClick={claimToken}
                    className="px-2 py-0.5 rounded text-[9px] font-semibold border border-sky-700/60 bg-sky-950/40 text-sky-300 hover:bg-sky-900/50 transition-colors"
                    title="Claim this character as yours"
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

          {/* Wound dots */}
          {character.wounds > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[9px] text-rose-500 uppercase tracking-wider">
                Wounds
              </span>
              <div className="flex gap-1">
                {Array.from({ length: character.maxWounds + 1 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full ${i < character.wounds ? "bg-rose-600" : "bg-stone-700"}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Tab bar ─────────────────────────────────────────────── */}
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

      {/* ── Content ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto scrollbar-thin">
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
      </main>

      {/* ── Floating roll log ───────────────────────────────────── */}
      <RollLog rolls={recentRolls} isGM={isGM} currentPlayerId={playerId} />
    </div>
  );
}
