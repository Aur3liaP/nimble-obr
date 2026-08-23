/**
 * @file Unit tests for the `CONDITIONS` catalog invariants — same
 * `sourceKey` discipline already enforced for `BASE_SPELLS`/
 * `BASIC_EQUIPMENTS` in `catalogCopy.test.ts` (unique, non-empty, hyphenated
 * rather than a raw name), plus the deliberate distinct-key rule for the
 * three Incapacitated-effect synonyms (see `conditions.ts`'s file header).
 */

import { describe, expect, it } from "vitest";
import { CONDITIONS } from "./conditions";

describe("sourceKey — catalog invariants", () => {
  it("every entry has a non-empty sourceKey", () => {
    const offenders = CONDITIONS.filter((c) => !c.sourceKey).map((c) => c.name);
    expect(offenders).toEqual([]);
  });

  it("every sourceKey is unique", () => {
    const keys = CONDITIONS.map((c) => c.sourceKey);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it("sourceKey values are lowercase and hyphenated, not raw names", () => {
    const offenders = CONDITIONS.filter(
      (c) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.sourceKey),
    ).map((c) => `${c.name} :: sourceKey="${c.sourceKey}"`);
    expect(offenders).toEqual([]);
  });

  it("every name is unique too (the picker offers names, not sourceKeys)", () => {
    const names = CONDITIONS.map((c) => c.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });
});

describe("Incapacitated-effect synonyms", () => {
  it("Paralyzed, Stunned, and Unconscious each get their own sourceKey, never aliasing incapacitated", () => {
    const paralyzed = CONDITIONS.find((c) => c.name === "Paralyzed");
    const stunned = CONDITIONS.find((c) => c.name === "Stunned");
    const unconscious = CONDITIONS.find((c) => c.name === "Unconscious");
    const incapacitated = CONDITIONS.find((c) => c.name === "Incapacitated");

    expect(paralyzed?.sourceKey).toBe("paralyzed");
    expect(stunned?.sourceKey).toBe("stunned");
    expect(unconscious?.sourceKey).toBe("unconscious");
    expect(incapacitated?.sourceKey).toBe("incapacitated");

    const keys = [paralyzed, stunned, unconscious, incapacitated].map((c) => c?.sourceKey);
    expect(new Set(keys).size).toBe(4);
  });
});

describe("deliberately excluded terms", () => {
  it("does not catalog Hampered, Distracted, Bloodied, or Dying — see conditions.ts's file header for why", () => {
    const names = CONDITIONS.map((c) => c.name);
    expect(names).not.toContain("Hampered");
    expect(names).not.toContain("Distracted");
    expect(names).not.toContain("Bloodied");
    expect(names).not.toContain("Dying");
  });
});
