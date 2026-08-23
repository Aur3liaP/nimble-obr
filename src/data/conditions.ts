/**
 * @file Official condition catalogue for the monster sheet's condition
 * tagger (`MonsterPanel`'s use of `TagSelector`).
 *
 * Extracted from the Nimble Core Rules 2nd printing (`docs/reference/
 * CoreRules-v0.8.pdf`) — the combat quick-reference sidebar (pp. 10-11) and,
 * more authoritatively, the full Glossary (pp. 55-56) — not invented or
 * carried over from another system. Cross-checked between `pdftotext
 * -layout` and plain-mode extraction to avoid the two-column reading-order
 * pitfalls noted elsewhere in this project's docs.
 *
 * Deliberately narrower than every glossary entry that mentions a creature
 * state — see the exclusions below, each a real judgment call made and
 * confirmed with the project owner before this file shipped:
 * - **Hampered** — an umbrella term that only ever REFERS to other
 *   conditions ("any creature with actions or movement reduced, e.g.
 *   Dazed, Grappled/Restrained, Prone, Slowed..."), never something
 *   inflicted directly. Not a taggable condition on its own.
 * - **Distracted** — purely contextual/computed ("distracted if adjacent to
 *   or Taunted by an ally, or if it cannot see you"), never named as
 *   something a spell or ability directly inflicts. Recoverable via this
 *   picker's free-text add if a future ability ever does name it directly.
 * - **Bloodied** ("at half HP or less") — exists in the glossary, but is
 *   deliberately excluded: it is a state DERIVED from `damageTaken`/`maxHp`,
 *   and tagging it on a monster sheet would hand a player exactly the
 *   information the damage tracker is designed to hide (the same trap as
 *   color-coding the damage counter by exact ratio — see `MonsterSheet.
 *   maxHp`'s own doc).
 * - **Dying** — the mechanical consequence of a monster reaching 0 HP,
 *   derivable from `damageTaken`/`maxHp` exactly like Bloodied. Same
 *   reasoning, same exclusion: it is not a state a GM *inflicts*, it's a
 *   readout of the hidden HP math.
 *
 * `Paralyzed`, `Stunned`, and `Unconscious` are glossed by the book as
 * sharing Incapacitated's exact effect text, but each gets its OWN
 * `sourceKey` here, never an alias pointing at `incapacitated` — see that
 * entry's own comment for why.
 *
 * ## `sourceKey` is append-only
 *
 * Same contract as every other catalogue in this project (see
 * `equipment.ts`/`spells.ts`'s file headers): once an entry ships, its
 * `sourceKey` must never be edited or reused. Unlike those catalogues,
 * nothing in this app stores a frozen COPY of a condition entry — a
 * character's `conditions` array holds plain strings (the condition's
 * `name`, official or GM-improvised), not an object referencing
 * `sourceKey` — so `sourceKey` here exists only to keep this data file's
 * own identity stable and testable (uniqueness, no accidental duplicate
 * additions), not to trace anything back from persisted character data.
 */

export interface ConditionTemplate {
  /** Stable, immutable identifier for this catalogue entry — see the file header's append-only contract. Never referenced by persisted character data (conditions are stored as plain name strings), only by this file's own tests. */
  sourceKey: string;
  /** Official name, exactly as printed in the book. */
  name: string;
  /** The book's own effect text, verbatim (Nimble Core Rules 2nd printing). */
  description: string;
}

export const CONDITIONS: ConditionTemplate[] = [
  {
    sourceKey: "blind",
    name: "Blind",
    description: "Can't see. Attacks against you have advantage, and your attacks have disadvantage.",
  },
  {
    sourceKey: "charmed",
    name: "Charmed",
    description: "Sees the charmer as an ally. Charmer has advantage on social interactions with you.",
  },
  {
    sourceKey: "charged",
    name: "Charged",
    description:
      "Some spells/abilities have additional effects when Charged. Become Charged whenever you take lightning damage. Lasts 1 min or until combat ends.",
  },
  {
    sourceKey: "dazed",
    name: "Dazed",
    description: "Heroes: lose 1 action; monsters: can perform one less action on their next turn.",
  },
  {
    sourceKey: "frightened",
    name: "Frightened",
    description:
      "Disadvantage on rolls when source of fear is near; Speed halved when moving closer to it.",
  },
  {
    sourceKey: "grappled",
    name: "Grappled",
    description: "Cannot move. Attacks against you have advantage.",
  },
  {
    sourceKey: "incapacitated",
    name: "Incapacitated",
    description: "Can't do anything. Attacks against you have advantage, and melee attacks that hit, crit.",
  },
  {
    sourceKey: "invisible",
    name: "Invisible",
    description: "Cannot be seen. Your attacks have advantage, and attacks against you have disadvantage.",
  },
  {
    sourceKey: "paralyzed",
    // Distinct sourceKey from "incapacitated" even though the book glosses
    // this with identical effect text — see this file's header for why an
    // alias would be wrong here: the tag itself is what tells a GM what was
    // actually inflicted, independent of the shared mechanics behind it.
    name: "Paralyzed",
    description: "Incapacitated. Can't do anything. Attacks against you have advantage, and melee attacks that hit, crit.",
  },
  {
    sourceKey: "petrified",
    name: "Petrified",
    description:
      "Incapacitated with all the benefits and drawbacks of being a rock! Immune to most damage except from large explosions, picks, or similar tools.",
  },
  {
    sourceKey: "poisoned",
    name: "Poisoned",
    description: "Disadvantage on rolls (typically, healing ends this condition).",
  },
  {
    sourceKey: "prone",
    name: "Prone",
    description:
      "Movement costs twice as much, and disadvantage on attacks. Melee attacks against you have advantage; Ranged have disadvantage. Spend 3 spaces of your Speed to stand up.",
  },
  {
    sourceKey: "restrained",
    name: "Restrained",
    description:
      "Same as Grappled; objects Restrain, creatures Grapple. Cannot move. Attacks against you have advantage.",
  },
  {
    sourceKey: "riding",
    name: "Riding",
    description: "You move with the creature you are riding. Any attacks that miss you, strike them.",
  },
  {
    sourceKey: "silenced",
    name: "Silenced",
    description: "Cannot cast spells or use other abilities that require speaking.",
  },
  {
    sourceKey: "slowed",
    name: "Slowed",
    description: "Speed halved during your next turn.",
  },
  {
    sourceKey: "smoldering",
    name: "Smoldering",
    description:
      "This condition does nothing on its own, though some spells and abilities have additional effects against Smoldering creatures, ending the condition.",
  },
  {
    sourceKey: "stunned",
    // See "paralyzed" above — same shared-text, distinct-key reasoning.
    name: "Stunned",
    description: "Incapacitated. Can't do anything. Attacks against you have advantage, and melee attacks that hit, crit.",
  },
  {
    sourceKey: "taunted",
    name: "Taunted",
    description: "Disadvantage on attacks except against the most recent taunter.",
  },
  {
    sourceKey: "unconscious",
    // See "paralyzed" above — same shared-text, distinct-key reasoning.
    name: "Unconscious",
    description: "Incapacitated. Can't do anything. Attacks against you have advantage, and melee attacks that hit, crit.",
  },
];
