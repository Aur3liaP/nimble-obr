/**
 * @file Blue-flame icon (used for "Retrieve a lost soul"), inlined as an
 * SVG React component — same reasoning as `MonsterIcon.tsx`'s file header
 * for why this isn't loaded via `<img src={...svg}>` (it rendered as a
 * broken image in real testing).
 *
 * Source: `src/assets/blue-flame.svg` (kept as the editable original).
 * Unlike `MonsterIcon`, keeps its own hardcoded blue fill rather than
 * `currentColor` — the color is the whole point of this specific icon
 * ("soul" imagery), not something a caller should be able to override.
 */

export function BlueFlameIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M9.29 14.5A2.5 2.5 0 0 0 10.5 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.5 3.5 6 1.295 1.295 2 3 2 5a5 5 0 0 1-10 0c0-.85.232-1.65.632-2.332A4.954 4.954 0 0 0 8.9 14.1z"
        fill="#0099ff"
      />
    </svg>
  );
}
