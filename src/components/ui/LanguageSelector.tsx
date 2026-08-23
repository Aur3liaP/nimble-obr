/**
 * @file Multi-value language picker for the Summary tab.
 *
 * Thin wrapper over the generic `TagSelector` (`components/ui/common/`) —
 * lets the player add languages from a fixed official list, or type a
 * custom one and press Enter. "Common" is always known and cannot be
 * removed, matching the Nimble rule that every hero speaks it by default.
 */

import { TagSelector } from "./common/TagSelector";

/** Official Nimble languages offered in the dropdown, before any custom entry. */
const AVAILABLE_LANGUAGES = [
  "Common",
  "Elvish",
  "Dwarvish",
  "Orcish",
  "Draconic",
  "Celestial",
  "Infernal",
  "Sylvan",
  "Primordial",
  "Undercommon",
  "Thieves Cant",
  "Ancient",
  "Giant",
  "Gnomish",
  "Halfling",
];

/**
 * @property selected - Currently known languages (including "Common").
 * @property readOnly - Disables adding/removing entirely (no input, no remove buttons).
 * @property onChange - Called with the full updated language list on any add/remove.
 */
interface LanguageSelectorProps {
  selected: string[];
  readOnly?: boolean;
  onChange?: (languages: string[]) => void;
}

/** Renders known languages as removable pill tags plus a text input with an autocomplete dropdown for adding more. */
export function LanguageSelector({
  selected = [],
  readOnly = false,
  onChange,
}: LanguageSelectorProps) {
  return (
    <TagSelector
      selected={selected}
      catalog={AVAILABLE_LANGUAGES}
      nonRemovable={["Common"]}
      placeholder="Add languages…"
      readOnly={readOnly}
      onChange={onChange}
    />
  );
}
