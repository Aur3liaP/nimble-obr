/**
 * @file Sanity checks for the room-metadata sizing study's fixture.
 *
 * Not a test of `NimbleCharacter` behavior (there is none here) — these
 * guard the fixture's own internal consistency, so a future edit to it (or
 * to the catalogs it's built from) can't silently produce a character that
 * no longer represents what the sizing report claims it does.
 */
import { describe, expect, it } from "vitest";
import { buildWorstCaseCharacter } from "./worstCaseCharacterFixture";
import { BASE_SPELLS } from "../data/spells";
import { BASIC_EQUIPMENTS } from "../data/equipment";
import { CURRENT_SCHEMA_VERSION } from "../types/character";

describe("buildWorstCaseCharacter", () => {
  it("fills the inventory exactly to capacity (10 + STR slots)", () => {
    const character = buildWorstCaseCharacter();
    const usedSlots = character.inventory.reduce((sum, item) => sum + item.slots * item.quantity, 0);
    expect(usedSlots).toBe(character.inventorySlots);
    expect(character.inventorySlots).toBe(10 + character.stats.str);
  });

  it("is at the level cap used throughout the sizing report", () => {
    expect(buildWorstCaseCharacter().level).toBe(10);
  });

  it("stamps the current schema version", () => {
    expect(buildWorstCaseCharacter().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("every non-custom action/item sourceKey resolves in its catalog", () => {
    const character = buildWorstCaseCharacter();
    for (const action of character.actions.filter((a) => !a.isCustom)) {
      expect(BASE_SPELLS.some((s) => s.sourceKey === action.sourceKey)).toBe(true);
    }
    for (const item of character.inventory.filter((i) => !i.isCustom)) {
      expect(BASIC_EQUIPMENTS.some((e) => e.sourceKey === item.sourceKey)).toBe(true);
    }
  });

  it("every custom action/item has no sourceKey", () => {
    const character = buildWorstCaseCharacter();
    for (const action of character.actions.filter((a) => a.isCustom)) {
      expect(action.sourceKey).toBeUndefined();
    }
    for (const item of character.inventory.filter((i) => i.isCustom)) {
      expect(item.sourceKey).toBeUndefined();
    }
  });

  it("contains at least one non-custom action and one non-custom item whose description has diverged from the catalog", () => {
    const character = buildWorstCaseCharacter();
    const divergedAction = character.actions.find((a) => {
      if (a.isCustom || !a.sourceKey) return false;
      const template = BASE_SPELLS.find((s) => s.sourceKey === a.sourceKey);
      return template !== undefined && template.description !== a.description;
    });
    const divergedItem = character.inventory.find((i) => {
      if (i.isCustom || !i.sourceKey) return false;
      const template = BASIC_EQUIPMENTS.find((e) => e.sourceKey === i.sourceKey);
      return template !== undefined && template.description !== i.description;
    });
    expect(divergedAction).toBeDefined();
    expect(divergedItem).toBeDefined();
  });

  it("contains at least one non-custom action and one non-custom item whose description still matches the catalog", () => {
    const character = buildWorstCaseCharacter();
    const untouchedAction = character.actions.find((a) => {
      if (a.isCustom || !a.sourceKey) return false;
      const template = BASE_SPELLS.find((s) => s.sourceKey === a.sourceKey);
      return template !== undefined && template.description === a.description;
    });
    const untouchedItem = character.inventory.find((i) => {
      if (i.isCustom || !i.sourceKey) return false;
      const template = BASIC_EQUIPMENTS.find((e) => e.sourceKey === i.sourceKey);
      return template !== undefined && template.description === i.description;
    });
    expect(untouchedAction).toBeDefined();
    expect(untouchedItem).toBeDefined();
  });
});
