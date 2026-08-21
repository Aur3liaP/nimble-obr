import { describe, expect, it } from "vitest";
import {
  GROUPED_CHARACTER_KEYS,
  buildKeyShorteningMap,
  compareSkillsStorage,
  extrapolateRoomMetadataCost,
  gzipBase64Size,
  measureCharacterWeight,
  perEntryKeyOverheadBytes,
  shortenKeysDeep,
  withCatalogDescriptionsStripped,
  withoutTransientInitiativeResult,
} from "./metadataSizing";
import { buildWorstCaseCharacter } from "./worstCaseCharacterFixture";
import { byteSize } from "./byteSize";
import { BASE_SPELLS } from "../data/spells";
import { BASIC_EQUIPMENTS } from "../data/equipment";
import type { NimbleCharacter } from "../types/character";

describe("measureCharacterWeight", () => {
  it("covers every NimbleCharacter field across its groups (reflective coverage check)", () => {
    const character = buildWorstCaseCharacter();
    const covered = new Set(GROUPED_CHARACTER_KEYS as string[]);
    for (const key of Object.keys(character) as (keyof NimbleCharacter)[]) {
      expect(covered.has(key)).toBe(true);
    }
  });

  it("groupedBytes is close to totalBytes (small, bounded per-group JSON envelope overhead)", () => {
    const character = buildWorstCaseCharacter();
    const report = measureCharacterWeight(character);
    expect(report.groupedBytes).toBeGreaterThanOrEqual(report.totalBytes);
    // 9 groups, each pays at most a few bytes of extra brace/comma overhead vs. sharing one envelope.
    expect(report.groupedBytes - report.totalBytes).toBeLessThan(9 * 4);
  });

  it("every group is non-negative and the report has one row per declared group", () => {
    const report = measureCharacterWeight(buildWorstCaseCharacter());
    expect(report.groups).toHaveLength(9);
    for (const g of report.groups) expect(g.bytes).toBeGreaterThan(0);
  });

  it("splits actions vs. spells by CharacterAction.type, not by presence", () => {
    const character = buildWorstCaseCharacter();
    const report = measureCharacterWeight(character);
    const actionsGroup = report.groups.find((g) => g.group === "actions")!;
    const spellsGroup = report.groups.find((g) => g.group === "spells")!;
    const spellCount = character.actions.filter((a) => a.type === "spell").length;
    const nonSpellCount = character.actions.filter((a) => a.type !== "spell").length;
    expect(spellCount).toBeGreaterThan(0);
    expect(nonSpellCount).toBeGreaterThan(0);
    // A non-empty group must cost more than an empty array ("[]", 2 bytes).
    expect(actionsGroup.bytes).toBeGreaterThan(2);
    expect(spellsGroup.bytes).toBeGreaterThan(2);
  });
});

describe("withCatalogDescriptionsStripped", () => {
  it("strips description only for non-custom, non-diverged entries", () => {
    const character = buildWorstCaseCharacter();
    const stripped = withCatalogDescriptionsStripped(character);

    for (const action of stripped.actions) {
      const original = character.actions.find((a) => a.id === action.id)!;
      if (original.isCustom || !original.sourceKey) {
        expect(action.description).toBe(original.description);
        continue;
      }
      const template = BASE_SPELLS.find((s) => s.sourceKey === original.sourceKey)!;
      if (template.description === original.description) {
        expect(action.description).toBe("");
      } else {
        expect(action.description).toBe(original.description); // diverged: kept
      }
    }

    for (const item of stripped.inventory) {
      const original = character.inventory.find((i) => i.id === item.id)!;
      if (original.isCustom || !original.sourceKey) {
        expect(item.description).toBe(original.description);
        continue;
      }
      const template = BASIC_EQUIPMENTS.find((e) => e.sourceKey === original.sourceKey)!;
      if (template.description === original.description) {
        expect(item.description).toBe("");
      } else {
        expect(item.description).toBe(original.description);
      }
    }
  });

  it("saves real bytes on the fixture (which has both diverged and untouched non-custom entries)", () => {
    const character = buildWorstCaseCharacter();
    const before = byteSize(character);
    const after = byteSize(withCatalogDescriptionsStripped(character));
    expect(after).toBeLessThan(before);
  });

  it("never touches a custom entry's description", () => {
    const character = buildWorstCaseCharacter();
    const stripped = withCatalogDescriptionsStripped(character);
    for (const action of stripped.actions.filter((a) => a.isCustom)) {
      const original = character.actions.find((a) => a.id === action.id)!;
      expect(action.description).toBe(original.description);
      expect(action.description).not.toBe("");
    }
  });
});

describe("withoutTransientInitiativeResult", () => {
  it("nulls combat.initiativeResult and nothing else", () => {
    const character = buildWorstCaseCharacter();
    const result = withoutTransientInitiativeResult(character);
    expect(result.combat.initiativeResult).toBeNull();
    expect(result.combat.actionsRemaining).toBe(character.combat.actionsRemaining);
    expect(result.skills).toEqual(character.skills);
  });
});

describe("compareSkillsStorage", () => {
  it("finds a near-zero difference between storing totals vs. invested points", () => {
    const comparison = compareSkillsStorage(buildWorstCaseCharacter());
    // Both are 10 small signed integers either way — this is the whole point
    // of the check: confirm there is no meaningful lever here, not assume it.
    expect(Math.abs(comparison.deltaBytes)).toBeLessThan(10);
  });
});

describe("buildKeyShorteningMap / shortenKeysDeep", () => {
  it("produces a map with no duplicate short codes", () => {
    const map = buildKeyShorteningMap();
    const codes = Object.values(map);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("shortens keys recursively through nested objects and arrays without touching values", () => {
    const map = buildKeyShorteningMap();
    const character = buildWorstCaseCharacter();
    const shortened = shortenKeysDeep(character, map) as Record<string, unknown>;
    expect(shortened[map.name]).toBe(character.name);
    const stats = shortened[map.stats] as Record<string, unknown>;
    expect(stats[map.str]).toBe(character.stats.str);
    const actions = shortened[map.actions] as Record<string, unknown>[];
    expect(actions[0][map.formula]).toBe(character.actions[0].formula);
  });

  it("reduces byte size on the fixture", () => {
    const character = buildWorstCaseCharacter();
    const map = buildKeyShorteningMap();
    expect(byteSize(shortenKeysDeep(character, map))).toBeLessThan(byteSize(character));
  });
});

describe("gzipBase64Size", () => {
  it("compresses smaller than the original JSON, and base64 adds ~33% over the raw gzip size", () => {
    const character = buildWorstCaseCharacter();
    const { jsonBytes, gzipBytes, base64Bytes } = gzipBase64Size(character);
    expect(gzipBytes).toBeLessThan(jsonBytes);
    expect(base64Bytes).toBeGreaterThan(gzipBytes);
    // ceil(gzipBytes/3)*4 must stay within one 4-byte rounding group of gzipBytes*4/3.
    expect(base64Bytes - (gzipBytes * 4) / 3).toBeLessThan(4);
  });
});

describe("extrapolateRoomMetadataCost", () => {
  it("grows linearly with character count plus fixed per-entry overhead", () => {
    const overhead = perEntryKeyOverheadBytes("com.nimble-obr.nimble/characters/abcdefabcdefabcdefabcdefabcdefab");
    const rows = extrapolateRoomMetadataCost(1000, [1, 2], 8192, overhead);
    const diff = rows[1].totalBytes - rows[0].totalBytes;
    expect(diff).toBe(1000 + overhead + 1); // +1 comma for the second entry
  });

  it("flags rows exceeding the budget", () => {
    const rows = extrapolateRoomMetadataCost(2000, [1, 2, 8], 8192, 50);
    expect(rows[0].overBudget).toBe(false);
    expect(rows[2].overBudget).toBe(true);
  });
});
