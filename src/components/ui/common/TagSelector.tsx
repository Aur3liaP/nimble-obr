/**
 * @file Generic multi-value tag picker: removable pill tags plus a text
 * input with an autocomplete dropdown, and free-text add on Enter for
 * anything not in the catalogue.
 *
 * Extracted from the original `LanguageSelector` (still the component's
 * only long-standing caller, via the thin wrapper in `LanguageSelector.tsx`)
 * so the monster sheet's condition tagger could reuse the exact same
 * behavior/ergonomics instead of a second, hand-copied implementation — the
 * project's explicit instruction for that feature was "same component, same
 * behavior," not "a similar-looking one." `catalog` and `nonRemovable` are
 * the only two axes that differ between the two current callers; nothing
 * else needed generalizing.
 *
 * @remarks If this is placed inside a `BentoSection`/`.bento-card` (as both
 * current callers are), give that card `className="relative z-10"` when
 * anything can render below it. `.bento-card` has `backdrop-blur-sm`, which
 * creates its own stacking context regardless of `position` — without a
 * higher z-index, a later sibling card paints OVER this dropdown instead of
 * the dropdown showing above it, even though the dropdown's own z-index is
 * higher. See `SummaryTab`'s Languages section and `MonsterPanel`'s
 * Conditions section for the two real fixes this produced.
 */

import { useRef, useState } from "react";

/**
 * @property selected - Currently selected tags.
 * @property catalog - Official/known values offered in the autocomplete
 * dropdown. Typing filters this list to unselected matches; pressing Enter
 * with no matching entry adds the typed text as a free-form tag instead —
 * this is not a validation list, just a suggestion source.
 * @property nonRemovable - Tags in `selected` that render without a remove
 * button, regardless of `readOnly` (e.g. "Common" for languages, which
 * every hero is assumed to know). Defaults to none.
 * @property placeholder - Input placeholder shown when nothing is selected yet.
 * @property readOnly - Disables adding/removing entirely (no input, no remove buttons).
 * @property onChange - Called with the full updated tag list on any add/remove.
 */
interface TagSelectorProps {
  selected: string[];
  catalog: string[];
  nonRemovable?: string[];
  placeholder?: string;
  readOnly?: boolean;
  onChange?: (tags: string[]) => void;
}

/**
 * Renders `selected` as removable pill tags plus a text input with an
 * autocomplete dropdown for adding more from `catalog`. Typing text that
 * matches nothing in `catalog` and pressing Enter adds it as a free-form
 * tag — the catalogue is a convenience, not a whitelist.
 */
export function TagSelector({
  selected = [],
  catalog,
  nonRemovable = [],
  placeholder = "Add…",
  readOnly = false,
  onChange,
}: TagSelectorProps) {
  const [inputValue, setInputValue] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /** Closes the dropdown when focus moves outside the component (ignores focus moving between the component's own children). */
  const handleBlur = (e: React.FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDropdownOpen(false);
    }
  };

  /** Catalogue entries not yet selected, filtered by the current input text. */
  const available = catalog.filter(
    (tag) =>
      !selected.includes(tag) &&
      tag.toLowerCase().includes(inputValue.toLowerCase()),
  );

  /** Adds a tag to the selection (no-op if read-only or already selected) and clears/closes the input/dropdown. */
  const addTag = (tag: string) => {
    if (readOnly || selected.includes(tag)) return;
    onChange?.([...selected, tag]);
    setInputValue("");
    setIsDropdownOpen(false);
  };

  /** Removes a tag from the selection (no-op if read-only or the tag is non-removable). */
  const removeTag = (tag: string) => {
    if (readOnly || nonRemovable.includes(tag)) return;
    onChange?.(selected.filter((t) => t !== tag));
  };

  /** Adds the current input text as a free-form tag if it's non-empty and not already selected, e.g. on Enter keypress. */
  const handleCustomAdd = () => {
    const val = inputValue.trim();
    if (val && !selected.includes(val)) {
      addTag(val);
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
        {selected.map((tag) => (
          <span
            key={tag}
            className="
              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
              font-medium bg-amber-900/40 border border-amber-700/40 text-amber-200
            "
          >
            {tag}
            {!readOnly && !nonRemovable.includes(tag) && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                className="text-amber-400/60 hover:text-amber-300 transition-colors leading-none"
                aria-label={`Remove ${tag}`}
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
            placeholder={selected.length === 0 ? placeholder : ""}
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
            available.map((tag) => (
              <li
                key={tag}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addTag(tag)}
                className="px-3 py-2 text-xs text-stone-300 hover:bg-stone-800 hover:text-amber-200 cursor-pointer border-b border-stone-800 last:border-0 transition-colors"
              >
                {tag}
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-xs text-stone-500 italic">
              {inputValue
                ? `Press Enter to add "${inputValue}"`
                : "All known entries added"}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
