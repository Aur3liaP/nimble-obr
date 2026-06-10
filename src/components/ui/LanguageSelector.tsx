/**
 * LanguageSelector – Adapted from the user's SkillsSelector component.
 * Same multi-value pattern, styled for the Nimble dark parchment theme.
 */

import { useRef, useState } from 'react';

const AVAILABLE_LANGUAGES = [
  'Common',
  'Elvish',
  'Dwarvish',
  'Orcish',
  'Draconic',
  'Celestial',
  'Infernal',
  'Sylvan',
  'Primordial',
  'Undercommon',
  'Thieves Cant',
  'Ancient',
  'Giant',
  'Gnomish',
  'Halfling',
];

interface LanguageSelectorProps {
  selected: string[];
  readOnly?: boolean;
  onChange?: (languages: string[]) => void;
}

export function LanguageSelector({
  selected = [],
  readOnly = false,
  onChange,
}: LanguageSelectorProps) {
  const [inputValue, setInputValue] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  const handleBlur = (e: React.FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDropdownOpen(false);
    }
  };

  const available = AVAILABLE_LANGUAGES.filter(
    (lang) =>
      !selected.includes(lang) &&
      lang.toLowerCase().includes(inputValue.toLowerCase())
  );

  const addLanguage = (lang: string) => {
    if (readOnly || selected.includes(lang)) return;
    onChange?.([...selected, lang]);
    setInputValue('');
    setIsDropdownOpen(false);
  };

  const removeLanguage = (lang: string) => {
    if (readOnly || lang === 'Common') return; // Common can't be removed
    onChange?.(selected.filter((l) => l !== lang));
  };

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
          ${!readOnly
            ? 'border-stone-700 focus-within:border-amber-600/60 focus-within:ring-1 focus-within:ring-amber-800/40 cursor-text'
            : 'border-stone-700/40'}
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
            {!readOnly && lang !== 'Common' && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); removeLanguage(lang); }}
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
            placeholder={selected.length === 0 ? 'Add languages…' : ''}
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); setIsDropdownOpen(true); }}
            onClick={(e) => { e.stopPropagation(); setIsDropdownOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleCustomAdd(); }
              if (e.key === 'Escape') setIsDropdownOpen(false);
            }}
          />
        )}
      </div>

      {/* Dropdown */}
      {isDropdownOpen && !readOnly && (
        <ul className="
          absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg
          border border-stone-700 bg-stone-900 shadow-xl shadow-black/50
        ">
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
                : 'All known languages added'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
