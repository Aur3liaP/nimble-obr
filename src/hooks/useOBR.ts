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
  rollInitiative: (mode?: RollMode) => Promise<DiceRollResult | null>;
  recentRolls: DiceRollResult[];
  createSheetForToken: (item: Item) => Promise<void>;
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

  // Synchronisation sécurisée de la ref
  useEffect(() => {
    characterRef.current = character;
  }, [character]);

  const isGM = role === "GM";
  const canEdit =
    isGM || (character !== null && character.ownerId === playerId);

  const loadCharacterFromItem = useCallback(
    (item: Item): NimbleCharacter | null => {
      return (item.metadata?.[METADATA_KEY] as NimbleCharacter) ?? null;
    },
    [],
  );

  const handleSelectionChange = useCallback(
    async (selectedIds: string[]) => {
      if (!selectedIds || selectedIds.length === 0) {
        setSelectedItems([]);
        setSelectionState("none");
        setCharacter(null);
        return;
      }

      const items = await OBR.scene.items.getItems(selectedIds);
      // Filtrer pour ne garder que les tokens de personnages
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

        OBR.action.setWidth(500),
        OBR.action.setHeight(700),
      ]);

      setPlayerId(pid);
      setPlayerName(pname);
      setRole(prole as OBRRole);
      setIsReady(true);

      // Charger la sélection initiale
      await handleSelectionChange(initialSelection || []);

      // Écouter les changements de sélection (C'EST ICI QUE CA SE PASSE)
      OBR.player.onChange(async (player: Player) => {
        await handleSelectionChange(player.selection || []);
      });

      // Écouter les changements sur les items de la scène (synchro MJ/Joueur)
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

    setCharacter(updated); // Update local (optimiste)
    await OBR.scene.items.updateItems([current.tokenId], (items) => {
      for (const item of items) {
        item.metadata[METADATA_KEY] = updated;
      }
    });
  };

  const handleRoll = async (req: DiceRollRequest) => {
    const current = characterRef.current;
    if (!current) return null;

    const rolled = rollFormula(req.formula, current, req.mode);
    const result: DiceRollResult = {
      ...rolled,
      label: req.label,
      playerId,
      playerName,
      timestamp: Date.now(),
      hidden: req.hidden || false,
    };

    if (!result.hidden) {
      const meta = await OBR.scene.getMetadata();
      const existing = (meta[ROLL_LOG_KEY] as DiceRollResult[]) || [];
      const newLog = [...existing, result].slice(-MAX_ROLL_HISTORY);
      await OBR.scene.setMetadata({ [ROLL_LOG_KEY]: newLog });
    }

    return result;
  };

  const rollInitiative = async (mode: RollMode = "standard") => {
    const current = characterRef.current;
    if (!current) return null;
    return handleRoll({
      label: `${current.name} — Initiative`,
      formula: `1d20+${current.stats.dex + (current.initiativeBonus || 0)}`,
      mode,
    });
  };

  const createSheetForToken = async (item: Item) => {
    const newChar = createDefaultCharacter(item.id, playerId);
    await OBR.scene.items.updateItems([item.id], (items) => {
      for (const i of items) {
        i.metadata[METADATA_KEY] = newChar;
      }
    });
    setCharacter(newChar);
    setSelectionState("ready");
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
    updateCharacter,
    handleRoll,
    rollInitiative,
    recentRolls,
    createSheetForToken,
  };
}
