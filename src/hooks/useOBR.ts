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

export type OBRRole = "GM" | "PLAYER";
export type SelectionState = "none" | "multiple" | "no-sheet" | "ready";

export interface UseOBRReturn {
  isReady: boolean;
  selectionState: SelectionState;
  character: NimbleCharacter | null;
  selectedItems: Item[];
  playerId: string;
  playerName: string;
  role: OBRRole;
  canEdit: boolean;
  isGM: boolean;
  updateCharacter: (updates: Partial<NimbleCharacter>) => Promise<void>;
  handleRoll: (req: DiceRollRequest) => Promise<DiceRollResult | null>;
  handleFreeRoll: (req: DiceRollRequest) => Promise<DiceRollResult | null>;
  rollInitiative: (mode?: RollMode) => Promise<DiceRollResult | null>;
  recentRolls: DiceRollResult[];
  createSheetForToken: (item: Item) => Promise<void>;
  claimToken: () => Promise<void>;
}

const ROLL_LOG_KEY = `${METADATA_KEY}/roll_log`;
const MAX_ROLL_HISTORY = 20;

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

  useEffect(() => { characterRef.current = character; }, [character]);
  useEffect(() => { playerIdRef.current = playerId; }, [playerId]);
  useEffect(() => { playerNameRef.current = playerName; }, [playerName]);

  const isGM = role === "GM";

  /**
   * canEdit rules:
   * - GM can always edit any sheet
   * - A player can edit ONLY if the token's ownerId matches their playerId
   * - Unclaimed tokens (no ownerId) are read-only for players (they can claim first)
   */
  const canEdit = isGM || (
    character !== null &&
    !!character.ownerId &&
    character.ownerId === playerId
  );

  const loadCharacterFromItem = useCallback((item: Item): NimbleCharacter | null => {
    return (item.metadata?.[METADATA_KEY] as NimbleCharacter) ?? null;
  }, []);

  const handleSelectionChange = useCallback(async (selectedIds: string[]) => {
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
  }, [loadCharacterFromItem]);

  useEffect(() => {
    if (!OBR.isAvailable) return;
    OBR.onReady(async () => {
      const [pid, pname, prole, initialSelection] = await Promise.all([
        OBR.player.getId(),
        OBR.player.getName(),
        OBR.player.getRole(),
        OBR.player.getSelection(),
        OBR.action.setWidth(500),
        OBR.action.setHeight(700),
      ]);
      setPlayerId(pid);
      setPlayerName(pname);
      playerNameRef.current = pname;
      setRole(prole as OBRRole);
      setIsReady(true);
      await handleSelectionChange(initialSelection || []);

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
      OBR.scene.onMetadataChange((meta) => {
        const log = meta[ROLL_LOG_KEY] as DiceRollResult[] | undefined;
        if (log) setRecentRolls(log.slice(-MAX_ROLL_HISTORY));
      });
    });
  }, [handleSelectionChange, loadCharacterFromItem]);

  const updateCharacter = async (updates: Partial<NimbleCharacter>) => {
    const current = characterRef.current;
    if (!current) return;
    const updated = { ...current, ...updates, updatedAt: Date.now() };
    setCharacter(updated);
    await OBR.scene.items.updateItems([current.tokenId], (items) => {
      for (const item of items) { item.metadata[METADATA_KEY] = updated; }
    });
  };

  /** Push a roll result to the shared scene metadata log */
  const pushRollToLog = async (result: DiceRollResult) => {
    if (result.hidden) return;
    const meta = await OBR.scene.getMetadata();
    const existing = (meta[ROLL_LOG_KEY] as DiceRollResult[]) || [];
    const newLog = [...existing, result].slice(-MAX_ROLL_HISTORY);
    await OBR.scene.setMetadata({ [ROLL_LOG_KEY]: newLog });
  };

  /** Roll tied to a character sheet (requires character in context) */
  const handleRoll = async (req: DiceRollRequest): Promise<DiceRollResult | null> => {
    const current = characterRef.current;
    if (!current) return null;
    const rolled = rollFormula(req.formula, current, req.mode, req.advantageCount ?? 0);
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
    setRecentRolls((prev) => [...prev, result].slice(-MAX_ROLL_HISTORY));
    return result;
  };

  /**
   * Free roll — no character required.
   * Uses a minimal character stub so rollFormula can run (no stat substitution needed
   * for plain NdX+modifier formulas from DicePanel).
   */
  const handleFreeRoll = async (req: DiceRollRequest): Promise<DiceRollResult | null> => {
    // Build a minimal stub so rollFormula doesn't crash on missing character
    const stub = {
      level: 1,
      stats: { str: 0, dex: 0, int: 0, wil: 0 },
      skills: {
        arcana: 0, examination: 0, finesse: 0, influence: 0, insight: 0,
        lore: 0, might: 0, naturecraft: 0, perception: 0, stealth: 0,
      },
      hp: { current: 0, max: 0, temp: 0 },
    } as unknown as import("../types/character").NimbleCharacter;

    const rolled = rollFormula(req.formula, stub, req.mode, req.advantageCount ?? 0);
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
    setRecentRolls((prev) => [...prev, result].slice(-MAX_ROLL_HISTORY));
    return result;
  };

  const rollInitiative = async (mode: RollMode = "standard") => {
    const current = characterRef.current;
    if (!current) return null;
    return handleRoll({
      label: `Initiative`,
      formula: `1d20+${current.stats.dex + (current.initiativeBonus || 0)}`,
      mode,
    });
  };

  const createSheetForToken = async (item: Item) => {
    const newChar = createDefaultCharacter(item.id, playerIdRef.current);
    await OBR.scene.items.updateItems([item.id], (items) => {
      for (const i of items) { i.metadata[METADATA_KEY] = newChar; }
    });
    setCharacter(newChar);
    setSelectionState("ready");
  };

  const claimToken = async () => {
    const current = characterRef.current;
    if (!current) return;
    await updateCharacter({ ownerId: playerIdRef.current });
  };

  return {
    isReady, selectionState, character, selectedItems,
    playerId, playerName, role, canEdit, isGM,
    updateCharacter, handleRoll, handleFreeRoll, rollInitiative, recentRolls,
    createSheetForToken, claimToken,
  };
}
