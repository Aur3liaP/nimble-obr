/**
 * @file Unit tests for `characterVault.ts` — the pure decision logic behind
 * the vault decoupling (read-path resolution, legacy-sheet migration
 * preparation, orphan detection). No OBR dependency, same discipline as
 * `characterMigrations.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultCharacter,
  createDefaultMonster,
  CURRENT_SCHEMA_VERSION,
  type CharacterLink,
} from "../types/character";
import {
  filterRecoverableCharacters,
  findOrphanedCharacters,
  linkedCharacterIdsSignature,
  prepareLegacySheetMigration,
  resolveCharacterRead,
  visibleRecoverableCharacters,
} from "./characterVault";

function makeLink(overrides: Partial<CharacterLink> = {}): CharacterLink {
  const snapshot = createDefaultCharacter("owner-1");
  return {
    characterId: snapshot.id,
    snapshot,
    updatedAt: snapshot.updatedAt,
    ...overrides,
  };
}

describe("resolveCharacterRead", () => {
  it("uses the vault character when the vault has an answer, no repair needed when in sync", () => {
    const vaultCharacter = createDefaultCharacter("owner-1");
    const link = makeLink({ characterId: vaultCharacter.id, updatedAt: vaultCharacter.updatedAt });

    const result = resolveCharacterRead(link, vaultCharacter);
    expect(result).toEqual({
      action: "use-vault",
      character: vaultCharacter,
      needsSnapshotRepair: false,
    });
  });

  it("flags a repair when the vault character is newer than the token's own link.updatedAt", () => {
    const vaultCharacter = { ...createDefaultCharacter("owner-1"), updatedAt: 2000 };
    const link = makeLink({ characterId: vaultCharacter.id, updatedAt: 1000 });

    const result = resolveCharacterRead(link, vaultCharacter);
    expect(result.action).toBe("use-vault");
    if (result.action !== "use-vault") return;
    expect(result.needsSnapshotRepair).toBe(true);
    expect(result.character).toBe(vaultCharacter);
  });

  it("does not flag a repair when the token's link is already newer than or equal to the vault (should not normally happen, but must not misfire)", () => {
    const vaultCharacter = { ...createDefaultCharacter("owner-1"), updatedAt: 1000 };
    const link = makeLink({ characterId: vaultCharacter.id, updatedAt: 1000 });

    const result = resolveCharacterRead(link, vaultCharacter);
    expect(result.action).toBe("use-vault");
    if (result.action !== "use-vault") return;
    expect(result.needsSnapshotRepair).toBe(false);
  });

  it("rehydrates from the token's snapshot when the vault has nothing for this characterId", () => {
    const link = makeLink();
    const result = resolveCharacterRead(link, null);
    expect(result.action).toBe("rehydrate");
    if (result.action !== "rehydrate") return;
    expect(result.migration.status).toBe("ok");
    if (result.migration.status !== "ok") return;
    expect(result.migration.character.id).toBe(link.characterId);
  });

  it("propagates an invalid snapshot as an invalid rehydration rather than throwing", () => {
    const link = makeLink({
      snapshot: { ...createDefaultCharacter("owner-1"), hp: undefined } as never,
    });
    const result = resolveCharacterRead(link, null);
    expect(result.action).toBe("rehydrate");
    if (result.action !== "rehydrate") return;
    expect(result.migration.status).toBe("invalid");
  });

  it("propagates an unsupported (future-schema) snapshot as an unsupported rehydration", () => {
    const link = makeLink({
      snapshot: {
        ...createDefaultCharacter("owner-1"),
        schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      },
    });
    const result = resolveCharacterRead(link, null);
    expect(result.action).toBe("rehydrate");
    if (result.action !== "rehydrate") return;
    expect(result.migration).toEqual({
      status: "unsupported",
      foundVersion: CURRENT_SCHEMA_VERSION + 1,
    });
  });
});

describe("prepareLegacySheetMigration", () => {
  it("migrates a raw legacy sheet and builds a matching link", () => {
    const raw = createDefaultCharacter("owner-1") as unknown as Record<string, unknown>;
    const result = prepareLegacySheetMigration(raw, "fallback-owner");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.character.ownerId).toBe("owner-1"); // already present — fallback not used
    expect(result.link).toEqual({
      characterId: result.character.id,
      snapshot: result.character,
      updatedAt: result.character.updatedAt,
    });
  });

  it("falls back to the OBR item's createdUserId only when the record's own ownerId is empty", () => {
    const raw = { ...createDefaultCharacter(""), ownerId: "" } as unknown as Record<string, unknown>;
    const result = prepareLegacySheetMigration(raw, "creator-of-the-token");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.character.ownerId).toBe("creator-of-the-token");
    expect(result.link.snapshot.ownerId).toBe("creator-of-the-token");
  });

  it("generates a fresh id via the normal migration chain (v5 -> v6), not a hardcoded one", () => {
    const raw = createDefaultCharacter("owner-1") as unknown as Record<string, unknown>;
    delete raw.id;
    (raw as Record<string, unknown>).schemaVersion = 5;
    const result = prepareLegacySheetMigration(raw, "fallback-owner");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(typeof result.character.id).toBe("string");
    expect(result.character.id.length).toBeGreaterThan(0);
  });

  it("propagates an invalid record instead of throwing", () => {
    const result = prepareLegacySheetMigration("not a character", "fallback-owner");
    expect(result.status).toBe("invalid");
  });

  it("propagates an unsupported (future-schema) record instead of throwing", () => {
    const raw = { ...createDefaultCharacter("owner-1"), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    const result = prepareLegacySheetMigration(raw, "fallback-owner");
    expect(result).toEqual({ status: "unsupported", foundVersion: CURRENT_SCHEMA_VERSION + 1 });
  });
});

describe("findOrphanedCharacters", () => {
  it("returns characters with no linked token", () => {
    const linked = createDefaultCharacter("owner-1");
    const orphan = createDefaultCharacter("owner-2");
    const result = findOrphanedCharacters([linked, orphan], [linked.id]);
    expect(result).toEqual([orphan]);
  });

  it("returns an empty array when every character is linked", () => {
    const a = createDefaultCharacter("owner-1");
    const b = createDefaultCharacter("owner-2");
    expect(findOrphanedCharacters([a, b], [a.id, b.id])).toEqual([]);
  });

  it("returns every character when nothing is linked", () => {
    const a = createDefaultCharacter("owner-1");
    const b = createDefaultCharacter("owner-2");
    expect(findOrphanedCharacters([a, b], [])).toEqual([a, b]);
  });

  it("is agnostic to kind — callers filter by kind themselves", () => {
    const player = createDefaultCharacter("owner-1");
    const monster = createDefaultMonster("owner-2");
    const result = findOrphanedCharacters([player, monster], []);
    expect(result).toEqual([player, monster]);
  });
});

describe("filterRecoverableCharacters", () => {
  it("a non-GM player sees only their own characters", () => {
    const mine = createDefaultCharacter("player-1");
    const someoneElses = createDefaultCharacter("player-2");
    const result = filterRecoverableCharacters([mine, someoneElses], "player-1", false);
    expect(result).toEqual([mine]);
  });

  it("the GM sees every character, regardless of owner", () => {
    const a = createDefaultCharacter("player-1");
    const b = createDefaultCharacter("player-2");
    const result = filterRecoverableCharacters([a, b], "gm-player-id", true);
    expect(result).toEqual([a, b]);
  });

  it("a non-GM player sees nothing when they own none of the listed characters", () => {
    const a = createDefaultCharacter("player-1");
    const b = createDefaultCharacter("player-2");
    expect(filterRecoverableCharacters([a, b], "player-3", false)).toEqual([]);
  });

  it("a character with no valid ownerId is invisible to a non-GM player", () => {
    const ownerless = { ...createDefaultCharacter("player-1"), ownerId: "" };
    expect(filterRecoverableCharacters([ownerless], "player-1", false)).toEqual([]);
  });

  it("a character with no valid ownerId is still visible to the GM", () => {
    const ownerless = { ...createDefaultCharacter("player-1"), ownerId: "" };
    expect(filterRecoverableCharacters([ownerless], "gm-player-id", true)).toEqual([ownerless]);
  });
});

describe("visibleRecoverableCharacters", () => {
  it("combines orphan, kind, and ownership filters", () => {
    const myOrphanedPlayer = createDefaultCharacter("player-1");
    const someoneElsesOrphanedPlayer = createDefaultCharacter("player-2");
    const myLinkedPlayer = createDefaultCharacter("player-1");
    const myOrphanedMonster = createDefaultMonster("player-1");

    const result = visibleRecoverableCharacters(
      [myOrphanedPlayer, someoneElsesOrphanedPlayer, myLinkedPlayer, myOrphanedMonster],
      [myLinkedPlayer.id], // only myLinkedPlayer has a token pointing to it
      "player-1",
      false,
    );

    expect(result).toEqual([myOrphanedPlayer]);
  });

  it("the GM sees every orphaned player character regardless of owner, but never a monster", () => {
    const orphanedPlayerA = createDefaultCharacter("player-1");
    const orphanedPlayerB = createDefaultCharacter("player-2");
    const orphanedMonster = createDefaultMonster("player-1");

    const result = visibleRecoverableCharacters(
      [orphanedPlayerA, orphanedPlayerB, orphanedMonster],
      [],
      "gm-player-id",
      true,
    );

    expect(result).toEqual([orphanedPlayerA, orphanedPlayerB]);
  });
});

describe("linkedCharacterIdsSignature", () => {
  it("produces the same key regardless of input order", () => {
    expect(linkedCharacterIdsSignature(["b", "a", "c"])).toBe(
      linkedCharacterIdsSignature(["c", "a", "b"]),
    );
  });

  it("produces the same key regardless of duplicate entries", () => {
    expect(linkedCharacterIdsSignature(["a", "b", "a"])).toBe(linkedCharacterIdsSignature(["a", "b"]));
  });

  it("produces a different key when the set actually differs", () => {
    expect(linkedCharacterIdsSignature(["a", "b"])).not.toBe(linkedCharacterIdsSignature(["a", "c"]));
    expect(linkedCharacterIdsSignature(["a"])).not.toBe(linkedCharacterIdsSignature(["a", "b"]));
  });

  it("produces a stable, empty-safe key for an empty set", () => {
    expect(linkedCharacterIdsSignature([])).toBe("");
    expect(linkedCharacterIdsSignature([])).toBe(linkedCharacterIdsSignature([]));
  });
});
