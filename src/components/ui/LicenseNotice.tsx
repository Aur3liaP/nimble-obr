/**
 * @file Nimble 3rd Party Creator License v2.0 attribution notice.
 *
 * The license requires a free VTT/app implementation to display this exact
 * notice prominently. Rendered by `App.tsx` as the panel's last, `shrink-0`
 * child, outside the scrollable content area (`<main>`) entirely, so it can
 * never end up scrolled out of view or nested inside a scrolling list — see
 * App.tsx's layout comment for how that's structured.
 *
 * Deliberately small and muted (not a banner) per the batch's design intent
 * — "visually unobtrusive... but always readable" — this is a legal
 * requirement, not a marketing callout, and must not carry any Nimble
 * artwork or logo.
 */
export function LicenseNotice() {
  return (
    <p className="shrink-0 border-t border-stone-800 bg-stone-950 px-3 py-1 text-center text-[9px] leading-snug text-stone-600">
      This app is free to use for anyone who already owns the content, is
      trying the system out, or cannot afford to buy it right now. If you
      enjoy Nimble and are able, please support the game by purchasing the
      official content at nimbleRPG.com.
    </p>
  );
}
