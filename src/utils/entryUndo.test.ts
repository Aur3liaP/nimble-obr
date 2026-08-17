import { describe, it, expect } from "vitest";
import { removeEntryById, reinsertEntry } from "./entryUndo";

describe("removeEntryById", () => {
  it("captures the index in the full array, not a filtered view", () => {
    // Mirrors character.actions: spells and combat actions interleaved in
    // one array, exactly as SpellsTab/CombatTab filter it by `type` for
    // display only. That filtering must never reach this function.
    const actions = [
      { id: "a1", type: "melee" },
      { id: "a2", type: "spell" },
      { id: "a3", type: "spell" },
      { id: "a4", type: "melee" },
    ];
    const result = removeEntryById(actions, "a3");
    expect(result).not.toBeNull();
    // a3 is index 2 in the FULL array. If this were computed against the
    // spells-only filtered view ([a2, a3]) instead, it would wrongly come
    // out as index 1.
    expect(result!.removed.index).toBe(2);
    expect(result!.removed.entry.id).toBe("a3");
    expect(result!.next.map((x) => x.id)).toEqual(["a1", "a2", "a4"]);
  });

  it("returns null, without mutating the input, when the id is not found", () => {
    const items = [{ id: "i1" }, { id: "i2" }];
    expect(removeEntryById(items, "missing")).toBeNull();
    expect(items).toEqual([{ id: "i1" }, { id: "i2" }]);
  });
});

describe("reinsertEntry", () => {
  it("restores the entry at its original index", () => {
    const remaining = [{ id: "a1" }, { id: "a2" }, { id: "a4" }];
    const restored = reinsertEntry(remaining, { id: "a3" }, 2);
    expect(restored.map((x) => x.id)).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("clamps an out-of-range index instead of throwing or dropping the entry", () => {
    const shrunk = [{ id: "a1" }];
    const restored = reinsertEntry(shrunk, { id: "a3" }, 5);
    expect(restored.map((x) => x.id)).toEqual(["a1", "a3"]);
  });

  it("round-trips with removeEntryById on the full array", () => {
    const actions = [
      { id: "a1", type: "melee" },
      { id: "a2", type: "spell" },
      { id: "a3", type: "spell" },
      { id: "a4", type: "melee" },
    ];
    const removal = removeEntryById(actions, "a3")!;
    const restored = reinsertEntry(
      removal.next,
      removal.removed.entry,
      removal.removed.index,
    );
    expect(restored).toEqual(actions);
  });
});
