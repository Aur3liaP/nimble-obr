/**
 * @file Central OBR integration hook for the Nimble character sheet extension.
 *
 * Wraps the entire `@owlbear-rodeo/sdk` surface used by this extension:
 * reading the current player/role, tracking scene selection, loading and
 * persisting character data from/to item metadata, broadcasting dice rolls
 * to the shared roll log, and exposing permission state (`permissions`)
 * to every tab component.
 *
 * This is the single source of truth for "what can the current player do
 * right now" — all UI components receive `permissions` from here rather
 * than computing it themselves.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";

import {
  METADATA_KEY,
  createDefaultCharacter,
  type NimbleCharacter,
  type DiceRollRequest,
  type DiceRollResult,
  type RollMode,
} from "../types/character";
import { rollFormula } from "../utils/formulaParser";

/** OBR player role as reported by the SDK. */

/**
 * Derived state of the current scene selection, used to decide what the
 * extension panel should render:
 * - "none": no character token selected.
 * - "multiple": more than one token selected (sheet not shown).
 * - "no-sheet": a single character token is selected but has no sheet yet.
 * - "ready": a single character token with a valid sheet is selected.
 */
export type OBRRole = "GM" | "PLAYER";
export type SelectionState = "none" | "multiple" | "no-sheet" | "ready";

/**
 * Centralized permission state for the currently loaded character,
 * computed once here and passed down as a single object instead of
 * being re-derived (and risking drift) in individual components.
 *
 * - `canEdit` — GM, or the sheet's current owner. Gates every mutation.
 * - `isGM` — current player has the OBR "GM" role.
 * - `isOwner` — current player is specifically the sheet's owner (a GM
 *   viewing someone else's sheet has `canEdit: true` but `isOwner: false`).
 * - `isUnclaimed` — the sheet has no owner yet (fresh token, or owner
 *   field was manually cleared); used to show "Claim" vs "Take over".
 */
export interface CharacterPermissions {
  canEdit: boolean;
  isGM: boolean;
  isOwner: boolean;
  isUnclaimed: boolean;
}

/** Public API returned by {@link useOBR}, consumed by `App.tsx` and passed down to tab components. */
export interface UseOBRReturn {
  isReady: boolean;
  selectionState: SelectionState;
  character: NimbleCharacter | null;
  selectedItems: Item[];
  playerId: string;
  playerName: string;
  role: OBRRole;
  /** @deprecated Use `permissions.canEdit` — kept for incremental migration, will be removed once every call site reads from `permissions`. */
  canEdit: boolean;
  /** @deprecated Use `permissions.isGM` — kept for incremental migration. */
  isGM: boolean;
  permissions: CharacterPermissions;
  updateCharacter: (updates: Partial<NimbleCharacter>) => Promise<void>;
  handleRoll: (req: DiceRollRequest) => Promise<DiceRollResult | null>;
  handleFreeRoll: (req: DiceRollRequest) => Promise<DiceRollResult | null>;
  rollInitiative: (mode?: RollMode) => Promise<DiceRollResult | null>;
  recentRolls: DiceRollResult[];
  createSheetForToken: (item: Item) => Promise<void>;
  claimToken: () => Promise<void>;
}

/** Scene metadata key under which the shared, table-wide roll log is stored. */
/** Maximum number of roll entries kept in the shared log (older entries are trimmed). */
const ROLL_LOG_KEY = `${METADATA_KEY}/roll_log`;
const MAX_ROLL_HISTORY = 20;

/**
 * Connects this extension instance to the active OBR scene and player,
 * and exposes everything needed to render and edit a Nimble character sheet.
 *
 * Responsibilities:
 * - Resolves the current player's ID, name, and role (GM/PLAYER) on ready.
 * - Tracks scene selection changes and loads the corresponding character
 *   from item metadata (see {@link SelectionState}).
 * - Computes {@link CharacterPermissions} for permission gating.
 * - Persists character updates via `OBR.scene.items.updateItems`, but
 *   only when the caller currently holds edit rights (see
 *   {@link updateCharacter} — this is a client-side guard, not a real
 *   security boundary, since OBR has no server-side ACL on metadata
 *   writes; a determined player could still bypass it from devtools.
 *   It does, however, prevent accidental writes from stale UI state and
 *   keeps `canEdit` meaningful as the single gate everywhere).
 * - Pushes dice roll results to shared scene metadata so all clients see
 *   them, except hidden rolls (GM-only, kept in local state only).
 *
 * @returns See {@link UseOBRReturn} for the full shape.
 */
export function useOBR(): UseOBRReturn {
  const [isReady, setIsReady] = useState(false);
  const [selectionState, setSelectionState] = useState<SelectionState>("none");
  const [character, setCharacter] = useState<NimbleCharacter | null>(null);
  const [selectedItems, setSelectedItems] = useState<Item[]>([]);
  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [role, setRole] = useState<OBRRole>("PLAYER");
  const [recentRolls, setRecentRolls] = useState<DiceRollResult[]>([]);

  const characterRef = useRef<NimbleCharacter | null>(null);
  const playerIdRef = useRef<string>("");
  const playerNameRef = useRef<string>("");
  // Mirrors `permissions.canEdit` synchronously for use inside callbacks
  // (handleRoll, updateCharacter) that close over refs rather than state,
  // so the guard always sees the latest value even mid-render.
  const canEditRef = useRef(false);

  useEffect(() => {
    characterRef.current = character;
  }, [character]);
  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);
  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  const isGM = role === "GM";

  const isOwner =
    character !== null && !!character.ownerId && character.ownerId === playerId;
  const isUnclaimed = character !== null && !character.ownerId;

  const canEdit = isGM || isOwner;

  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);

  const permissions: CharacterPermissions = {
    canEdit,
    isGM,
    isOwner,
    isUnclaimed,
  };

  /** Reads a {@link NimbleCharacter} out of an OBR item's metadata, or `null` if the item has no sheet attached. */
  const loadCharacterFromItem = useCallback(
    (item: Item): NimbleCharacter | null => {
      return (item.metadata?.[METADATA_KEY] as NimbleCharacter) ?? null;
    },
    [],
  );

  /**
   * Recomputes `selectionState`, `selectedItems`, and `character` whenever
   * the player's scene selection changes. Filters to CHARACTER-layer items
   * only, since the sheet only applies to character tokens.
   */
  const handleSelectionChange = useCallback(
    async (selectedIds: string[]) => {
      if (!selectedIds || selectedIds.length === 0) {
        setSelectedItems([]);
        setSelectionState("none");
        setCharacter(null);
        return;
      }
      const items = await OBR.scene.items.getItems(selectedIds);
      const tokens = items.filter((i) => i.layer === "CHARACTER");
      setSelectedItems(tokens);

      if (tokens.length === 0) {
        setSelectionState("none");
        setCharacter(null);
      } else if (tokens.length > 1) {
        setSelectionState("multiple");
        setCharacter(loadCharacterFromItem(tokens[0]));
      } else {
        const loaded = loadCharacterFromItem(tokens[0]);
        if (!loaded) {
          setSelectionState("no-sheet");
          setCharacter(null);
        } else {
          setCharacter(loaded);
          setSelectionState("ready");
        }
      }
    },
    [loadCharacterFromItem],
  );

  useEffect(() => {
    if (!OBR.isAvailable) return;
    OBR.onReady(async () => {
      const [pid, pname, prole, initialSelection] = await Promise.all([
        OBR.player.getId(),
        OBR.player.getName(),
        OBR.player.getRole(),
        OBR.player.getSelection(),
      ]);
      setPlayerId(pid);
      setPlayerName(pname);
      playerNameRef.current = pname;
      setRole(prole as OBRRole);
      setIsReady(true);
      await handleSelectionChange(initialSelection || []);
      await OBR.action.setWidth(400);
      await OBR.action.setHeight(800);
      await OBR.action.setTitle("Nimble Sheet");
      OBR.player.onChange(async (player: Player) => {
        await handleSelectionChange(player.selection || []);
      });

      OBR.scene.items.onChange(async (items) => {
        const currentChar = characterRef.current;
        if (!currentChar) return;
        const updatedItem = items.find((i) => i.id === currentChar.tokenId);
        if (updatedItem) {
          const fresh = loadCharacterFromItem(updatedItem);
          if (fresh) setCharacter(fresh);
        }
      });

      // Single source of truth for the roll log — only update from metadata,
      // never from local setRecentRolls after a push (avoids double-update re-mounts)
      OBR.scene.onMetadataChange((meta) => {
        const log = meta[ROLL_LOG_KEY] as DiceRollResult[] | undefined;
        if (log) setRecentRolls(log.slice(-MAX_ROLL_HISTORY));
      });
    });
  }, [handleSelectionChange, loadCharacterFromItem]);

  /**
   * Applies a partial update to the currently loaded character and persists
   * it to the owning item's metadata via `OBR.scene.items.updateItems`,
   * which propagates the change to every connected client.
   *
   * Guarded by `canEditRef`: if the caller doesn't currently hold edit
   * rights (not GM, not the sheet's owner), the update is silently
   * dropped and a warning is logged. This is a client-side sanity check,
   * not a real security boundary — OBR has no server-side ACL on
   * metadata, so a determined player could still write via devtools.
   * What it *does* protect against is accidental writes triggered by
   * stale UI (e.g. a button that should have been hidden/disabled but
   * briefly wasn't during a re-render).
   *
   * @param updates - Partial character fields to merge into the current state.
   */
  const updateCharacter = async (updates: Partial<NimbleCharacter>) => {
    const current = characterRef.current;
    if (!current) return;
    if (!canEditRef.current) {
      console.warn(
        "[Nimble] updateCharacter blocked: current player has no edit rights on this sheet.",
      );
      return;
    }
    const updated = { ...current, ...updates, updatedAt: Date.now() };
    setCharacter(updated);
    await OBR.scene.items.updateItems([current.tokenId], (items) => {
      for (const item of items) {
        item.metadata[METADATA_KEY] = updated;
      }
    });
  };

  /**
   * Appends a roll result to the shared roll log.
   *
   * Hidden rolls (GM-only) are *not* written to scene metadata — they are
   * appended directly to local state instead, so only the roller (the GM)
   * sees them. Visible rolls are written to `OBR.scene.setMetadata`; the
   * `onMetadataChange` listener registered in the main effect is the only
   * place that calls `setRecentRolls` for visible rolls, to avoid a double
   * state update that would otherwise remount conditional branches in `App`.
   *
   * @param result - The roll result to log.
   */
  const pushRollToLog = async (result: DiceRollResult) => {
    if (result.hidden) {
      // Not written to scene — update locally only
      setRecentRolls((prev) => [...prev, result].slice(-MAX_ROLL_HISTORY));
      return;
    }
    const meta = await OBR.scene.getMetadata();
    const existing = (meta[ROLL_LOG_KEY] as DiceRollResult[]) || [];
    const newLog = [...existing, result].slice(-MAX_ROLL_HISTORY);
    // onMetadataChange will fire and update recentRolls — don't call setRecentRolls here
    await OBR.scene.setMetadata({ [ROLL_LOG_KEY]: newLog });
  };

  /**
   * Rolls a formula tied to the currently loaded character (uses its stats/
   * skills/level as context) and logs the result.
   *
   * Rolling is intentionally NOT gated by `canEdit` — read-only viewers
   * (e.g. a player looking at another player's sheet) should still be
   * able to roll dice using that sheet's stats (this is a tabletop game,
   * not a permissions system for hiding numbers). Only *persisting changes
   * to the sheet itself* goes through {@link updateCharacter}'s guard.
   *
   * @param req - Label, formula, roll mode, and optional hidden flag.
   * @returns The resolved {@link DiceRollResult}, or `null` if no character is loaded.
   */
  const handleRoll = async (
    req: DiceRollRequest,
  ): Promise<DiceRollResult | null> => {
    const current = characterRef.current;
    if (!current) return null;
    const rolled = rollFormula(
      req.formula,
      current,
      req.mode,
      req.advantageCount ?? 0,
    );
    const result: DiceRollResult = {
      ...rolled,
      label: req.label,
      formula: req.formula,
      playerId: playerIdRef.current,
      playerName: playerNameRef.current,
      timestamp: Date.now(),
      hidden: req.hidden || false,
    };
    await pushRollToLog(result);
    return result;
  };

  /**
   * Rolls a formula with no character context (used by the standalone
   * {@link DicePanel} free-roll widget). Builds a zeroed-out stub character
   * so plain `NdX+modifier` formulas still resolve correctly.
   *
   * @param req - Label, formula, roll mode, and optional hidden flag.
   * @returns The resolved {@link DiceRollResult}.
   */
  const handleFreeRoll = async (
    req: DiceRollRequest,
  ): Promise<DiceRollResult | null> => {
    const stub = {
      level: 1,
      stats: { str: 0, dex: 0, int: 0, wil: 0 },
      skills: {
        arcana: 0,
        examination: 0,
        finesse: 0,
        influence: 0,
        insight: 0,
        lore: 0,
        might: 0,
        naturecraft: 0,
        perception: 0,
        stealth: 0,
      },
      hp: { current: 0, max: 0, temp: 0 },
    } as unknown as NimbleCharacter;

    const rolled = rollFormula(
      req.formula,
      stub,
      req.mode,
      req.advantageCount ?? 0,
    );
    const result: DiceRollResult = {
      ...rolled,
      label: req.label,
      formula: req.formula,
      playerId: playerIdRef.current,
      playerName: playerNameRef.current,
      timestamp: Date.now(),
      hidden: req.hidden || false,
    };
    await pushRollToLog(result);
    return result;
  };

  /**
   * Rolls initiative for the current character: `1d20 + DEX + initiativeBonus`.
   *
   * @param mode - Roll mode, defaults to "standard".
   * @returns The resolved {@link DiceRollResult}, or `null` if no character is loaded.
   */
  const rollInitiative = async (mode: RollMode = "standard") => {
    const current = characterRef.current;
    if (!current) return null;
    return handleRoll({
      label: "Initiative",
      formula: `1d20+${current.stats.dex + (current.initiativeBonus || 0)}`,
      mode,
    });
  };

  /**
   * Attaches a brand-new default character sheet to the given token and
   * makes the calling player its owner.
   *
   * @param item - The OBR scene item (token) to attach a sheet to.
   */
  const createSheetForToken = async (item: Item) => {
    const newChar = createDefaultCharacter(item.id, playerIdRef.current);
    await OBR.scene.items.updateItems([item.id], (items) => {
      for (const i of items) {
        i.metadata[METADATA_KEY] = newChar;
      }
    });
    setCharacter(newChar);
    setSelectionState("ready");
  };

  /**
   * Sets the current player as the owner of the currently loaded character.
   *
   * @remarks This is intentionally **not** gated by `canEdit` — it is the
   * entry point that grants edit rights in the first place. It powers two
   * distinct UI affordances exposed via the same button:
   * - "Claim" — the sheet has no owner yet (fresh token created by the GM
   *   for a player, or `ownerId` cleared); any non-GM player may claim it.
   * - "Take over" — the sheet *already* has a different owner. Calling
   *   this reassigns ownership to the current player, silently revoking
   *   the previous owner's edit rights.
   *
   * "Take over" existing on a sheet that already belongs to someone else
   * is a deliberate design choice for this game (a small trusted table),
   * not an oversight — but if you want to prevent players from
   * "stealing" each other's sheets, gate this behind `isGM ||
   * permissions.isUnclaimed` at the call site (the Claim/Take-over button
   * in `App.tsx`) before calling it.
   */
  const claimToken = async () => {
    const current = characterRef.current;
    if (!current) return;
    await OBR.scene.items.updateItems([current.tokenId], (items) => {
      for (const item of items) {
        item.metadata[METADATA_KEY] = {
          ...current,
          ownerId: playerIdRef.current,
          updatedAt: Date.now(),
        };
      }
    });
    setCharacter((prev) =>
      prev ? { ...prev, ownerId: playerIdRef.current } : prev,
    );
  };

  return {
    isReady,
    selectionState,
    character,
    selectedItems,
    playerId,
    playerName,
    role,
    canEdit,
    isGM,
    permissions,
    updateCharacter,
    handleRoll,
    handleFreeRoll,
    rollInitiative,
    recentRolls,
    createSheetForToken,
    claimToken,
  };
}
