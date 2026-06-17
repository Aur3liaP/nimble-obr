/**
 * @file Multi-value language picker for the Summary tab.
 *
 * Lets the player add languages from a fixed official list, or type a
 * custom one and press Enter. "Common" is always known and cannot be
 * removed, matching the Nimble rule that every hero speaks it by default.
 */

import { useRef, useState } from "react";

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

/**
 * Renders known languages as removable pill tags plus a text input with
 * an autocomplete dropdown for adding more.
 *
 * Typing filters {@link AVAILABLE_LANGUAGES} to unselected matches;
 * pressing Enter with no matching official language adds the typed text
 * as a custom language. "Common" is rendered without a remove button
 * regardless of `readOnly`, since it can never be removed.
 */
export function LanguageSelector({
  selected = [],
  readOnly = false,
  onChange,
}: LanguageSelectorProps) {
  const [inputValue, setInputValue] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /** Closes the dropdown when focus moves outside the component (ignores focus moving between the component's own children). */
  const handleBlur = (e: React.FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDropdownOpen(false);
    }
  };

  /** Official languages not yet selected, filtered by the current input text. */
  const available = AVAILABLE_LANGUAGES.filter(
    (lang) =>
      !selected.includes(lang) &&
      lang.toLowerCase().includes(inputValue.toLowerCase()),
  );

  /** Adds a language to the selection (no-op if read-only or already selected) and clears/closes the input/dropdown. */
  const addLanguage = (lang: string) => {
    if (readOnly || selected.includes(lang)) return;
    onChange?.([...selected, lang]);
    setInputValue("");
    setIsDropdownOpen(false);
  };

  /** Removes a language from the selection (no-op if read-only or if the language is "Common"). */
  const removeLanguage = (lang: string) => {
    if (readOnly || lang === "Common") return; // Common can't be removed
    onChange?.(selected.filter((l) => l !== lang));
  };

  /** Adds the current input text as a custom language if it's non-empty and not already selected, e.g. on Enter keypress. */
  const handleCustomAdd = () => {
    const val = inputValue.trim();
    if (val && !selected.includes(val)) {
      addLanguage(val);
    }
  };

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      {/* Input container */}
      <div
        className={`
          flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg
          border bg-stone-900/60 px-2.5 py-1.5 transition-all
          ${
            !readOnly
              ? "border-stone-700 focus-within:border-amber-600/60 focus-within:ring-1 focus-within:ring-amber-800/40 cursor-text"
              : "border-stone-700/40"
          }
        `}
        onClick={() => !readOnly && setIsDropdownOpen(true)}
      >
        {selected.map((lang) => (
          <span
            key={lang}
            className="
              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
              font-medium bg-amber-900/40 border border-amber-700/40 text-amber-200
            "
          >
            {lang}
            {!readOnly && lang !== "Common" && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeLanguage(lang);
                }}
                className="text-amber-400/60 hover:text-amber-300 transition-colors leading-none"
                aria-label={`Remove ${lang}`}
              >
                ×
              </button>
            )}
          </span>
        ))}

        {!readOnly && (
          <input
            type="text"
            className="min-w-24 flex-1 bg-transparent text-xs text-stone-300 outline-none placeholder-stone-600"
            placeholder={selected.length === 0 ? "Add languages…" : ""}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setIsDropdownOpen(true);
            }}
            onClick={(e) => {
              e.stopPropagation();
              setIsDropdownOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCustomAdd();
              }
              if (e.key === "Escape") setIsDropdownOpen(false);
            }}
          />
        )}
      </div>

      {/* Dropdown */}
      {isDropdownOpen && !readOnly && (
        <ul
          className="
          absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg
          border border-stone-700 bg-stone-900 shadow-xl shadow-black/50
        "
        >
          {available.length > 0 ? (
            available.map((lang) => (
              <li
                key={lang}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addLanguage(lang)}
                className="px-3 py-2 text-xs text-stone-300 hover:bg-stone-800 hover:text-amber-200 cursor-pointer border-b border-stone-800 last:border-0 transition-colors"
              >
                {lang}
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-xs text-stone-500 italic">
              {inputValue
                ? `Press Enter to add "${inputValue}"`
                : "All known languages added"}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
