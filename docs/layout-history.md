# Panel layout history

Chronological trial-and-error behind `App.tsx`'s `<main>` / tab-content /
`DicePanel`-`RollLog` wrapper layout. The binding, current rules are
CLAUDE.md's "Panel layout contract" section — read that first if you're
about to touch this region. This document is the diagnostic record of how
that contract came to exist: three consecutive batches (1e, 1f, 1g) each
adjusted flex rules here and broke a different state, verified only against
whichever state had just been reported broken. It's kept per this project's
convention of not deleting diagnosed history, and as a record of approaches
already tried and rejected so they aren't re-attempted.

## License notices: where they render (parts 1c–1f)

The Nimble 3rd Party Creator License v2.0 notices are a legal requirement,
not a design choice. They used to be a permanent `LicenseNotice` footer,
removed because it ate vertical space on an already-cramped laptop screen.
The license accepts "a banner, sidebar, welcome message" as prominent
placement, which is why the full VTT notice is pinned at the top of the
inline roll log and the short attribution line at its foot.

Both notices were briefly *also* shown in the floating popup (part 1c/1d) —
removed in part 1e: there was no room for a full paragraph plus attribution
without the popup becoming awkward, and the inline rendering is already
reachable via the no-token "welcome" state, which recurs on every
deselection rather than being a one-time dismissal. The attribution
component itself was renamed from the unhelpfully generic `Attribution` to
`LicenseAttribution` in part 1f. See CLAUDE.md's Panel layout contract and
Architecture section for the current, binding rules on where these notices
live and how they interact with the scroll chain.

## Reaching the panel's true bottom (parts 1c–1f)

The inline roll log's attribution line needed to reach the panel's actual
bottom edge, not just float above leftover blank space. Three attempts, in
order, each shipped, each still read as "floating" in real OBR testing:

1. **Part 1c: `mt-auto` on the attribution line itself.**
2. **Part 1d: an added `min-h-56` floor** on the wrapper, as a band-aid.
3. **Part 1e: `flex-1` on the entries area alone**, with nothing above it
   in the chain.

None of them addressed the actual gap, because the problem wasn't in
`RollLog`'s own subtree at all. Root cause, found in part 1f by walking the
DOM chain from the panel root down: `App.tsx`'s `<main>` received a
correctly constrained height from being a `flex-1` item of the panel root's
`flex flex-col h-full` — but `<main>` itself had no `flex`/`flex-col` class
of its own, so it was never a flex *container* for its own children. Its
children (including the `DicePanel`/`RollLog` wrapper `<div>`) just stacked
in normal block flow at natural content height, and `<main>`'s leftover
space became blank area below all of them, undistributable to any one child
— no amount of `flex-1`/`mt-auto` *inside* `RollLog`'s own subtree could
reach space that was never handed down to it in the first place. (Concrete
evidence this was a real gap, not just a hypothesis: the no-token header
`<div>` already carried a `shrink-0` class — meaningless without a flex
parent — presumably added on the assumption `<main>` already was one.)

Fixed at that level: `<main>` became `flex flex-col`; the `DicePanel`/
`RollLog` wrapper `<div>` and `RollLog`'s own inline root both got
`flex-1 min-h-0` (the `min-h-0` defeats the flex-item default
`min-height: auto`, which would otherwise partially block `flex-1` from
taking effect); `RollLog`'s internal entries-area `flex-1` (unchanged from
part 1e) still did the final, innermost push. The `min-h-56` floor was
removed as no longer needed. This fix was inline-mode-only; the floating
popup is `position: absolute` and self-contained (`max-h-80`), unaffected
by any of this chain.

**This `<main> flex flex-col` fix was itself superseded in part 1h** — see
below. It is not the current implementation for the sheet-open state.

## Part 1g: the split-scroll-region attempt, then the flex-collapse regression

**Split scroll regions (superseded in part 1h).** Part 1g gave tab content
its own independent `overflow-y-auto` scroll region, with `DicePanel`
pinned below it. This turned out to violate a requirement nobody had
written down until part 1h's Panel layout contract: `DicePanel` must scroll
*with* the sheet, not sit pinned below a separately-scrolling tab-content
box. Kept here as a record of what didn't work — don't re-derive this
approach again.

**The flex-collapse regression, introduced by part 1g's own fix above:**
giving `<main>`'s two children (tab content and the `DicePanel`/`RollLog`
wrapper) equal, competing `flex-1` treatment collapsed the wrapper to 0px
height whenever a sheet tab was open. Confirmed as a purely CSS layout
collapse, *not* the JSX-early-return unmount failure mode documented in
CLAUDE.md's "Structural constraints" section — this tree was already a
single, unconditional return with `DicePanel` always mounted; that failure
mode did not apply here. (CLAUDE.md's Structural constraints section keeps
the general distinction between the two `DicePanel`-invisible failure modes
— JSX unmount vs. this CSS collapse — since it's the reusable diagnostic
for any future report of the same symptom.)

Mechanism: tab content has `flex: 0 1 auto` (default, content-based basis);
the `DicePanel`/`RollLog` wrapper below it had `flex-1` (`flex: 1 1 0%`,
zero basis). Whenever tab content's natural height exceeded `<main>`'s
available space (routine — spell/inventory lists routinely do), flexbox's
negative-space shrink pass divides the deficit by each item's *scaled*
shrink factor (`shrink × basis`); the wrapper's scaled factor was
`1 × 0 = 0`, so it absorbed none of the deficit, got none of the leftover
growth either (there was none), and rendered at its bare 0% basis: 0px.

Fixed by no longer letting the two children compete for the same space at
all: the tab content itself became the scroll region
(`flex-1 min-h-0 overflow-y-auto`), so an arbitrarily tall tab scrolls
internally instead of starving its sibling; the `DicePanel`/`RollLog`
wrapper became `shrink-0` (natural content height, always rendered in full)
whenever a sheet tab is present. This was the *second* layout regression
the `<main>` flex change alone had produced — treat that flex context as a
blast radius, not a self-contained local edit, when touching it again.

**No-token welcome state: a roll landed below the fold (also part 1g).**
The inline `RollLog`'s entries list (newest-first) had `flex-1` but no
`min-h-0`/`overflow-y-auto`, so it could only ever *grow* to fill leftover
space, never *shrink* below its own content height. In the no-token state,
the free-roll panel plus the license notice already fill a typical laptop
panel height with zero entries; adding one entry pushed the whole panel's
content taller than the viewport, and `<main>`'s own `overflow-y-auto` made
the *page* scroll to reveal it — a roll read as though nothing had happened
until the user scrolled. Fixed by bounding the entries list itself
(`min-h-0 overflow-y-auto`) so it scrolls internally instead of pushing its
container taller; because the list is newest-first, the just-added roll is
always the first item and so is visible immediately, regardless of how many
older entries end up pushed below it inside this self-contained region.
(This fix's still-binding requirement — the entries list needs
`min-h-0 overflow-y-auto`, not a bare `flex-1` — is noted in CLAUDE.md's
Panel layout contract.)

## Part 1h: the current design

Restored `<main>` to a single, plain scroll region — no flex container, no
split scroll regions — when a sheet tab is open, which is what CLAUDE.md's
Panel layout contract now states as binding. This was the third batch in a
row to touch this exact area (1e implicitly, 1f, 1g), and the first written
*after* the contract existed, specifically so it could be checked against
every state at once instead of just the one most recently reported broken.

`<main>`'s classes ended up conditional on `showSheet`:

- **Sheet tab open:** `<main>` is plain `overflow-y-auto` (no
  `flex flex-col`). Tab content and the `DicePanel`/`RollLog` wrapper are
  two ordinary block-level children — no flex classes on either — so they
  simply stack, and `<main>`'s own scrollbar moves both together.
  `DicePanel` sits at the bottom of the tab content and scrolls away with
  it, instead of being pinned below an independently-scrolling tab-content
  box (part 1g's mistake) or collapsing to 0px (part 1f's, once a second
  competing child existed).
- **No-sheet states (no-token/no-sheet/unsupported/invalid):** `<main>` IS
  `flex flex-col` here, and the wrapper is `flex-1 min-h-0` — this is
  genuinely still needed, and it's why the license-notice fix depends on
  `<main>` being flex only in this one branch: the wrapper is `<main>`'s
  *sole* child here. The part 1g collapse bug required two children with
  mismatched flex-basis fighting over shrink space; a lone child can't do
  that to itself, so stretching it here is safe — this is exactly why the
  two branches must not be "unified" onto one shared `<main>` treatment.
  `RollLog`'s own inline root and entries area (parts 1f/1g) are unchanged
  and still do the last two steps of the same chain. Inline `RollLog` is
  never rendered in the sheet-open branch, so its dependency on this flex
  chain never needs the sheet-open branch to provide it.
- **Auto-close (new in part 1h, not a restoration):** `DicePanel` calls
  `setCollapsed(true)` at the end of its own `handleRoll`, in
  `DicePanel.tsx` — every roll, in every state it can be opened from,
  closes it. This is the mechanism behind the contract's "closes itself
  automatically once a roll is made" requirement, and what makes "opening
  `DicePanel` must not hide the log" trivially true in the common case (the
  panel is only ever open for the brief moment before a roll).

This restore intentionally did not touch: the whitespace-tolerant
`normalizeSubstitutedSignsForDisplay` fix (part 1g, unrelated to layout),
the inline license notices living in `RollLog.tsx` instead of a separate
`LicenseNotice` footer (part 1e, kept), or `RollLog`'s entries-list internal
scroll bound (part 1g, kept — still the right fix, still needed once the
license text lives inline instead of in a separate persistent footer with
its own reserved space).
