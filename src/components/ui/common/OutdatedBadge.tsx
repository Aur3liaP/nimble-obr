/**
 * @file OutdatedBadge — small, informational badge shown on a catalog-
 * derived spell/item/action row whose `catalogVersion` is behind the
 * catalog's current one (see `isOutdated` in `utils/catalogCopy.ts` for
 * the exact contract: a version comparison, never a text comparison).
 *
 * Purely informational, per the "catalog versioning" batch's own
 * decision: it must never block rolling or editing, so it renders next to
 * the existing school/tier/type badges rather than replacing or gating
 * anything. The actual fix ("Reset to book version") lives in each row's
 * own edit panel — this component is display-only, no `onClick`.
 */

/**
 * Renders a compact amber "Updated" pill with a tooltip explaining what it
 * means. Callers gate rendering on {@link isOutdated} themselves — this
 * component has no opinion on when it should show, only how.
 */
export function OutdatedBadge() {
  return (
    <span
      title="The book text for this entry has changed since it was added. Open it to reset to the current version."
      className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border text-amber-300 border-amber-700/60 bg-amber-950/40"
    >
      Updated
    </span>
  );
}
