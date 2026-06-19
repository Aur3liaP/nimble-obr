/**
 * @file useDraggableValue — valeur locale "optimiste" pour les contrôles
 * draggables (HP, Mana) branchés sur {@link DraggableBar}.
 *
 * Problème résolu : `DraggableBar.onChange` se déclenche à chaque
 * `mousemove` (potentiellement des dizaines de fois par seconde). Si on
 * appelait directement `onUpdate` (→ `OBR.scene.items.updateItems`) à
 * chaque fois, ça spammerait le réseau OBR et tous les autres clients
 * recevraient une rafale de updates pendant le drag.
 *
 * Ce hook garde une valeur locale affichée instantanément pendant le
 * drag (pas de latence visuelle), et ne déclenche la sauvegarde réelle
 * (`onCommit`) qu'au relâchement de la souris/du doigt.
 *
 * Se resynchronise automatiquement sur `serverValue` quand celui-ci
 * change *en dehors* d'un drag local (ex: le MJ modifie les HP du
 * personnage depuis sa propre fenêtre — la prop change via
 * `OBR.scene.items.onChange`, donc ce client doit suivre).
 */

import { useEffect, useRef, useState } from "react";

/**
 * @param serverValue - La valeur "source de vérité" actuelle (ex: `character.hp.current`).
 * @param onCommit - Appelé avec la valeur finale au relâchement du drag — typiquement `(v) => onUpdate({...})`.
 * @returns `displayValue` (à passer à `DraggableBar.value`), `onDragChange`
 * (à passer à `DraggableBar.onChange`), et `onDragCommit` (à passer à
 * `DraggableBar.onCommit`).
 */
export function useDraggableValue(
  serverValue: number,
  onCommit: (v: number) => void,
) {
  const [localValue, setLocalValue] = useState(serverValue);
  const isDraggingRef = useRef(false);

  // Resynchronise depuis le serveur (OBR) si on n'est pas en train de
  // drag localement — évite d'écraser le geste de l'utilisateur en cours
  // si un autre client (ex: le MJ) met à jour la même valeur en même temps.
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(serverValue);
    }
  }, [serverValue]);

  const onDragChange = (v: number) => {
    isDraggingRef.current = true;
    setLocalValue(v);
  };

  const onDragCommit = (v: number) => {
    isDraggingRef.current = false;
    setLocalValue(v);
    onCommit(v);
  };

  return { displayValue: localValue, onDragChange, onDragCommit };
}
