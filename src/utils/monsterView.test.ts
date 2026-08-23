/**
 * @file Unit tests for `monsterView.ts` — the coarse damage band and the
 * `maxHp`/`speed`-excluding player-view narrowing.
 */

import { describe, expect, it } from "vitest";
import { createDefaultMonster } from "../types/character";
import {
  BADLY_HURT_AT_RATIO,
  computeDamageBand,
  computeDamageRatio,
  toPlayerView,
  WOUNDED_AT_RATIO,
} from "./monsterView";

describe("computeDamageRatio", () => {
  it("is 0 at no damage, 1 at or beyond maxHp", () => {
    expect(computeDamageRatio(0, 20)).toBe(0);
    expect(computeDamageRatio(20, 20)).toBe(1);
    expect(computeDamageRatio(40, 20)).toBe(1);
  });

  it("is the plain division in between", () => {
    expect(computeDamageRatio(5, 20)).toBe(0.25);
  });

  it("does not divide by zero when maxHp is non-positive", () => {
    expect(computeDamageRatio(0, 0)).toBe(0);
    expect(computeDamageRatio(1, 0)).toBe(1);
  });
});

describe("computeDamageBand", () => {
  it("unharmed at zero damage", () => {
    expect(computeDamageBand(0, 20)).toBe("unharmed");
  });

  it("a single point of damage on a healthy monster stays unharmed (regression: used to flip to wounded at any damage > 0)", () => {
    // The exact case reported: 1 damage on a 30-maxHp monster must not
    // leave the green band — this used to disagree with the GM's own
    // continuous gradient, which stayed visually green at this ratio.
    expect(computeDamageBand(1, 30)).toBe("unharmed");
  });

  it("stays unharmed just below WOUNDED_AT_RATIO, flips to wounded at/above it", () => {
    expect(computeDamageBand(6, 20)).toBe("unharmed"); // 0.30, just under 1/3
    expect(computeDamageBand(7, 20)).toBe("wounded"); // 0.35, just over 1/3
    expect(computeDamageBand(10, 20)).toBe("wounded"); // 0.50, still under 2/3
  });

  it("badly-hurt once the ratio crosses BADLY_HURT_AT_RATIO", () => {
    expect(computeDamageBand(14, 20)).toBe("badly-hurt"); // 0.70, over 2/3
    expect(computeDamageBand(19, 20)).toBe("badly-hurt");
  });

  it("badly-hurt for damage at or beyond maxHp (no separate dying tier)", () => {
    expect(computeDamageBand(20, 20)).toBe("badly-hurt");
    expect(computeDamageBand(40, 20)).toBe("badly-hurt");
  });

  it("does not divide by zero when maxHp is non-positive (defensive; should not happen in practice)", () => {
    expect(computeDamageBand(0, 0)).toBe("unharmed");
    expect(computeDamageBand(1, 0)).toBe("badly-hurt");
  });

  it("stays consistent with computeDamageRatio's own break points across a spread of ratios (shared-source guard)", () => {
    for (let pct = 0; pct <= 100; pct += 5) {
      const ratio = pct / 100;
      const band = computeDamageBand(ratio * 100, 100);
      if (ratio < WOUNDED_AT_RATIO) expect(band).toBe("unharmed");
      else if (ratio < BADLY_HURT_AT_RATIO) expect(band).toBe("wounded");
      else expect(band).toBe("badly-hurt");
    }
  });
});

describe("toPlayerView", () => {
  it("carries over exactly the allowed fields", () => {
    const monster = {
      ...createDefaultMonster("gm-1"),
      name: "Owlbear",
      damageTaken: 5,
      armor: "medium" as const,
      conditions: ["Prone"],
      notes: "Smells like an owl.",
    };
    expect(toPlayerView(monster)).toEqual({
      name: "Owlbear",
      damageTaken: 5,
      armor: "medium",
      conditions: ["Prone"],
      notes: "Smells like an owl.",
    });
  });

  it("never includes maxHp or speed, even by accident (structural — TypeScript alone won't catch a future field added to MonsterSheet)", () => {
    const monster = createDefaultMonster("gm-1");
    const view = toPlayerView(monster);
    expect("maxHp" in view).toBe(false);
    expect("speed" in view).toBe(false);
  });
});
