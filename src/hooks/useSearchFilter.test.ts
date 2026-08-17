/**
 * @file Unit tests for {@link matchesSearch}, the pure predicate behind
 * {@link useSearchFilter}. The hook itself is a thin `useState` + `useMemo`
 * wrapper with no independent logic worth rendering a component for; this
 * predicate is where the actual matching behavior lives.
 */

import { describe, it, expect } from "vitest";
import { matchesSearch } from "./useSearchFilter";

describe("matchesSearch", () => {
  it("matches when the search text is a substring of any field", () => {
    expect(matchesSearch(["Longsword", "A simple blade"], "sword")).toBe(true);
    expect(matchesSearch(["Longsword", "A simple blade"], "blade")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesSearch(["Longsword"], "LONGSWORD")).toBe(true);
    expect(matchesSearch(["Longsword"], "long")).toBe(true);
  });

  it("returns false when no field contains the search text", () => {
    expect(matchesSearch(["Longsword", "A simple blade"], "shield")).toBe(
      false,
    );
  });

  it("treats a blank search (empty or whitespace-only) as matching everything", () => {
    expect(matchesSearch(["Longsword"], "")).toBe(true);
    expect(matchesSearch(["Longsword"], "   ")).toBe(true);
    expect(matchesSearch([], "")).toBe(true);
  });

  it("skips undefined fields instead of matching or throwing", () => {
    expect(matchesSearch([undefined, "A simple blade"], "blade")).toBe(true);
    expect(matchesSearch([undefined, undefined], "anything")).toBe(false);
  });
});
