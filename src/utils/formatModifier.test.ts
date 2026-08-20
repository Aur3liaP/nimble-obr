/**
 * @file Unit tests for `formatModifier` — see its own file header for why
 * this was extracted (the "+ -2" bug independently reimplemented twice).
 */

import { describe, expect, it } from "vitest";
import { formatModifier } from "./formatModifier";

describe("formatModifier", () => {
  it("prefixes a positive modifier with +", () => {
    expect(formatModifier(3)).toBe("+3");
    expect(formatModifier(1)).toBe("+1");
  });

  it("renders a negative modifier with its own sign, never a double sign", () => {
    expect(formatModifier(-2)).toBe("-2");
    expect(formatModifier(-10)).toBe("-10");
  });

  it("renders zero as +0, not a bare 0 — zero is still a real modifier", () => {
    expect(formatModifier(0)).toBe("+0");
  });
});
