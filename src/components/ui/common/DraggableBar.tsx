/**
 * @file DraggableBar — barre de progression cliquable et draggable.
 *
 * Complète (ne remplace pas) les inputs numériques existants pour HP/Mana :
 * cliquer ou glisser sur la barre met à jour `value` en fonction de la
 * position horizontale du curseur, clampée entre 0 et `max`.
 *
 * Comportement :
 * - mousedown/touchstart sur la barre → jump immédiat à la position
 * - mousemove/touchmove tant que le bouton/doigt est maintenu → suit le curseur
 * - Les listeners de mouvement sont attachés à `window` pendant le drag,
 *   donc ça ne casse pas si la souris sort de la barre.
 * - En lecture seule (`canEdit` false), aucun listener n'est attaché —
 *   la barre reste un simple indicateur visuel.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useDebouncedCommit } from "../../../hooks/useDebouncedCommit";

/**
 * @property value - Valeur actuelle (ex: HP courant).
 * @property max - Valeur maximale représentant 100% de la barre.
 * @property canEdit - Active ou désactive l'interactivité (drag/clic).
 * @property onChange - Appelé avec la nouvelle valeur (déjà clampée 0..max) pendant le drag.
 * @property onCommit - Optionnel, appelé une seule fois au relâchement (mouseup/touchend) avec la valeur finale — utile pour ne déclencher la sauvegarde OBR qu'une fois plutôt qu'à chaque pixel de mouvement.
 * @property color - Couleur de remplissage (CSS), ou une fonction qui la dérive du ratio actuel (ex: rouge sous 25%).
 * @property bgClass - Classe Tailwind du fond de la barre (piste vide).
 * @property height - Hauteur Tailwind de la barre, défaut "h-2.5".
 * @property secondaryValue - Valeur additionnelle affichée par-dessus (ex: temp HP), purement visuelle, non draggable.
 * @property secondaryColor - Couleur du segment secondaire.
 * @property className - Classes supplémentaires sur le conteneur.
 * @property showValueOnDrag - Affiche un tooltip flottant avec la valeur courante au-dessus du curseur pendant le drag. Défaut: true.
 * @property valueSuffix - Texte ajouté après le nombre dans le tooltip (ex: " HP", " mana").
 * @property ariaLabel - Nom accessible du slider (ex: "HP", "Mana"), exposé via `aria-label` quand `canEdit` est vrai. Un `role="slider"` sans nom ne dit rien d'utile à un lecteur d'écran au-delà du chiffre brut.
 */
interface DraggableBarProps {
  value: number;
  max: number;
  canEdit: boolean;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  color?: string | ((ratio: number) => string);
  bgClass?: string;
  height?: string;
  secondaryValue?: number;
  secondaryColor?: string;
  className?: string;
  showValueOnDrag?: boolean;
  valueSuffix?: string;
  ariaLabel?: string;
}

/**
 * Barre de progression interactive. Calcule la valeur à partir de la
 * position du pointeur relative à la largeur de la barre (`getBoundingClientRect`),
 * avec un ratio arrondi au point le plus proche défini par `max` (valeurs entières).
 */
export function DraggableBar({
  value,
  max,
  canEdit,
  onChange,
  onCommit,
  color = "#34d399",
  bgClass = "bg-stone-800",
  height = "h-2.5",
  secondaryValue = 0,
  secondaryColor = "#38bdf8",
  className = "",
  showValueOnDrag = true,
  valueSuffix = "",
  ariaLabel,
}: DraggableBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Garde la dernière valeur calculée pendant le drag, pour onCommit au relâchement
  const lastValueRef = useRef(value);

  const safeMax = Math.max(1, max);
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const secondaryRatio =
    secondaryValue > 0
      ? Math.min(1 - ratio, secondaryValue / safeMax)
      : 0;

  const resolvedColor = typeof color === "function" ? color(ratio) : color;

  /** Calcule la nouvelle valeur (entière, clampée) à partir d'une position X cliente. */
  const computeValueFromClientX = useCallback(
    (clientX: number): number => {
      const bar = barRef.current;
      if (!bar) return value;
      const rect = bar.getBoundingClientRect();
      const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
      const newRatio = rect.width > 0 ? x / rect.width : 0;
      return Math.round(newRatio * safeMax);
    },
    [safeMax, value],
  );

  const handlePointerMove = useCallback(
    (clientX: number) => {
      const v = computeValueFromClientX(clientX);
      lastValueRef.current = v;
      onChange(v);
    },
    [computeValueFromClientX, onChange],
  );

  const startDrag = (clientX: number) => {
    if (!canEdit) return;
    setIsDragging(true);
    handlePointerMove(clientX);
  };

  // Standard WAI-ARIA slider keyboard interaction: arrow keys step by 1,
  // Home/End jump to the extremes. There's no separate press/release the
  // way a drag has mousedown/mouseup — holding a key fires OS key-repeat,
  // potentially dozens of keydown events per second — so the commit itself
  // is debounced (see useDebouncedCommit) rather than fired on every
  // keystroke the way it used to be: one write per repeated keydown was
  // tolerable before the vault-decoupling batch doubled write volume per
  // save (vault + snapshot fan-out), but enough on its own to trip OBR's
  // rate limit once it was. `onChange` (local display only) still fires on
  // every keystroke for instant visual feedback — only the OBR write is
  // throttled.
  const { schedule: scheduleKeyCommit, flush: flushKeyCommit } =
    useDebouncedCommit<number>((v) => onCommit?.(v));

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = Math.min(max, value + 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = Math.max(0, value - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(next);
    scheduleKeyCommit(next);
  };

  /** Commits immediately on blur rather than waiting out the debounce — leaving the control shouldn't leave a write pending. */
  const handleBlur = () => flushKeyCommit();

  // ── Listeners globaux pendant le drag ──────────────────────────
  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => handlePointerMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) handlePointerMove(e.touches[0].clientX);
    };
    const stopDrag = () => {
      setIsDragging(false);
      onCommit?.(lastValueRef.current);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopDrag);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", stopDrag);
    window.addEventListener("touchcancel", stopDrag);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopDrag);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", stopDrag);
      window.removeEventListener("touchcancel", stopDrag);
    };
  }, [isDragging, handlePointerMove, onCommit]);

  return (
    <div
      ref={barRef}
      onMouseDown={(e) => startDrag(e.clientX)}
      onTouchStart={(e) => {
        if (e.touches[0]) startDrag(e.touches[0].clientX);
      }}
      className={`
        relative w-full ${height} rounded-full overflow-hidden ${bgClass}
        ${canEdit ? "cursor-pointer select-none" : ""}
        ${className}
      `}
      role={canEdit ? "slider" : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onKeyDown={canEdit ? handleKeyDown : undefined}
      onBlur={canEdit ? handleBlur : undefined}
      aria-label={canEdit ? ariaLabel : undefined}
      aria-valuenow={canEdit ? value : undefined}
      aria-valuemin={canEdit ? 0 : undefined}
      aria-valuemax={canEdit ? max : undefined}
    >
      {/* Segment secondaire (ex: temp HP), affiché après le segment principal */}
      {secondaryRatio > 0 && (
        <div
          className="absolute top-0 h-full transition-[width] duration-100"
          style={{
            left: `${ratio * 100}%`,
            width: `${secondaryRatio * 100}%`,
            background: secondaryColor,
          }}
        />
      )}
      {/* Segment principal */}
      <div
        className={`absolute top-0 left-0 h-full rounded-full ${
          isDragging ? "" : "transition-[width] duration-300"
        }`}
        style={{ width: `${ratio * 100}%`, background: resolvedColor }}
      />
      {/* Poignée — visible seulement en mode édition, pour indiquer l'affordance */}
      {canEdit && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-stone-400 shadow-md border border-black/20 ${
            isDragging ? "scale-125" : ""
          } transition-transform`}
          style={{ left: `${ratio * 100}%` }}
        />
      )}

      {/* Tooltip flottant — montre la valeur en cours pendant le drag,
          sinon on ne voit que le résultat final au relâchement */}
      {isDragging && showValueOnDrag && (
        <div
          className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-stone-950 border border-stone-700 text-[10px] font-bold text-stone-100 shadow-lg whitespace-nowrap pointer-events-none z-10"
          style={{ left: `${ratio * 100}%` }}
        >
          {value}
          {valueSuffix}
        </div>
      )}
    </div>
  );
}