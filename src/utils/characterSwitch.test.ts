/**
 * @file Unit tests for `characterSwitch.ts` — the pure conversion logic
 * behind the player/monster switch button. No OBR dependency, same
 * discipline as `characterMigrations.test.ts`/`characterVault.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { createDefaultCharacter, createDefaultMonster } from "../types/character";
import { convertToMonster, convertToPlayer } from "./characterSwitch";

describe("convertToMonster", () => {
  it("carries name and notes over from the player record", () => {
    const player = { ...createDefaultCharacter("player-1"), name: "Sir Reginald", notes: "Afraid of ducks." };
    const monster = convertToMonster(player, "gm-1");
    expect(monster.name).toBe("Sir Reginald");
    expect(monster.notes).toBe("Afraid of ducks.");
  });

  it("everything else starts at the monster default, not carried over from the player", () => {
    const player = {
      ...createDefaultCharacter("player-1"),
      level: 12,
      speed: 8,
    };
    const monster = convertToMonster(player, "gm-1");
    const freshDefault = createDefaultMonster("gm-1");
    expect(monster.speed).toBe(freshDefault.speed);
    expect(monster.damageTaken).toBe(freshDefault.damageTaken);
    expect(monster.maxHp).toBe(freshDefault.maxHp);
    expect(monster.armor).toBe(freshDefault.armor);
    expect(monster.conditions).toEqual([]);
  });

  it("ownerId is the acting GM, not the original player", () => {
    const player = createDefaultCharacter("player-1");
    const monster = convertToMonster(player, "gm-1");
    expect(monster.ownerId).toBe("gm-1");
  });

  it("is a brand-new record, never the same id as the original", () => {
    const player = createDefaultCharacter("player-1");
    const monster = convertToMonster(player, "gm-1");
    expect(monster.id).not.toBe(player.id);
  });

  it("the result is kind: monster", () => {
    const player = createDefaultCharacter("player-1");
    expect(convertToMonster(player, "gm-1").kind).toBe("monster");
  });
});

describe("convertToPlayer", () => {
  it("carries name and notes over from the monster record", () => {
    const monster = { ...createDefaultMonster("gm-1"), name: "Ancient Wyrm", notes: "Weak to fire." };
    const player = convertToPlayer(monster, "gm-1");
    expect(player.name).toBe("Ancient Wyrm");
    expect(player.notes).toBe("Weak to fire.");
  });

  it("everything else starts at the player default, not carried over from the monster", () => {
    const monster = { ...createDefaultMonster("gm-1"), speed: 12, damageTaken: 40 };
    const player = convertToPlayer(monster, "gm-1");
    const freshDefault = createDefaultCharacter("gm-1");
    expect(player.level).toBe(freshDefault.level);
    expect(player.hp).toEqual(freshDefault.hp);
    expect(player.stats).toEqual(freshDefault.stats);
  });

  it("ownerId is the acting GM (same convention as creating a fresh sheet)", () => {
    const monster = createDefaultMonster("gm-1");
    const player = convertToPlayer(monster, "gm-1");
    expect(player.ownerId).toBe("gm-1");
  });

  it("is a brand-new record, never the same id as the original", () => {
    const monster = createDefaultMonster("gm-1");
    const player = convertToPlayer(monster, "gm-1");
    expect(player.id).not.toBe(monster.id);
  });

  it("the result is kind: player", () => {
    const monster = createDefaultMonster("gm-1");
    expect(convertToPlayer(monster, "gm-1").kind).toBe("player");
  });
});
