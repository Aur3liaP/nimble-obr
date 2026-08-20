/**
 * @file Unit tests for `initiativeToActions` (Nimble Core Rules 2nd
 * printing, p.15: 1 action under 10, 2 actions 10-19, 3 actions on 20+ or a
 * natural 20).
 */

import { describe, expect, it } from "vitest";
import { initiativeToActions } from "./initiative";

describe("initiativeToActions", () => {
  it("grants 1 action for a single-digit total", () => {
    expect(initiativeToActions(0, 0)).toBe(1);
    expect(initiativeToActions(9, 9)).toBe(1);
  });

  it("grants 2 actions for a two-digit total under 20", () => {
    expect(initiativeToActions(10, 10)).toBe(2);
    expect(initiativeToActions(19, 19)).toBe(2);
  });

  it("grants 3 actions for a total of 20 or more", () => {
    expect(initiativeToActions(20, 15)).toBe(3);
    expect(initiativeToActions(35, 15)).toBe(3);
  });

  it("grants 3 actions on a natural 20 even if the total is below 20", () => {
    // A natural 20 with a large negative DEX/initiativeBonus can still
    // total under 20 — the rulebook grants 3 actions regardless.
    expect(initiativeToActions(15, 20)).toBe(3);
    expect(initiativeToActions(5, 20)).toBe(3);
  });

  it("does not grant 3 actions for a high total that isn't a natural 20 and is under 20", () => {
    expect(initiativeToActions(19, 14)).toBe(2);
  });
});
