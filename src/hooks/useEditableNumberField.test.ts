/**
 * @file Unit tests for {@link resolveNumberFieldCommit} and
 * {@link stepDraft}, the pure (no React) decision logic behind
 * {@link useEditableNumberField}. The hook itself is a thin
 * `useState`/`useRef` wrapper with no independent logic worth rendering a
 * component for (this project has no hook-rendering test utility
 * installed) — see `useEditableNumberField.ts`'s file header.
 *
 * The "N consecutive ArrowUp presses only commit once, at blur" behavior
 * is verified by composing `stepDraft` in a loop and calling
 * `resolveNumberFieldCommit` exactly once afterward, mirroring exactly
 * what the hook's `step`/`commit` do — `stepDraft` itself has no
 * `onCommit` parameter and calls nothing, so it is structurally
 * incapable of committing; a test that never calls
 * `resolveNumberFieldCommit` mid-loop is, by construction, a test that
 * never commits mid-loop.
 */

import { describe, expect, it } from "vitest";
import { resolveNumberFieldCommit, stepDraft } from "./useEditableNumberField";

describe("resolveNumberFieldCommit", () => {
  it("commits the parsed value when the draft differs from the initial value", () => {
    expect(resolveNumberFieldCommit("5", "10")).toEqual({
      commit: true,
      value: 5,
    });
  });

  it("accepts leading zeros", () => {
    expect(resolveNumberFieldCommit("007", "10")).toEqual({
      commit: true,
      value: 7,
    });
  });

  it("does not commit an emptied draft (the original bug: could never clear the field)", () => {
    expect(resolveNumberFieldCommit("", "10")).toEqual({ commit: false });
  });

  it("does not commit a partial/garbage draft", () => {
    expect(resolveNumberFieldCommit("12abc", "10")).toEqual({
      commit: false,
    });
    expect(resolveNumberFieldCommit("-", "10")).toEqual({ commit: false });
  });

  it("does not commit a non-integer draft", () => {
    expect(resolveNumberFieldCommit("5.5", "10")).toEqual({ commit: false });
  });

  it("clamps to min", () => {
    expect(resolveNumberFieldCommit("-3", "10", 0)).toEqual({
      commit: true,
      value: 0,
    });
  });

  it("clamps to max", () => {
    expect(resolveNumberFieldCommit("99", "10", 0, 20)).toEqual({
      commit: true,
      value: 20,
    });
  });

  describe("unchanged-since-focus guard", () => {
    it("does not commit when the draft equals the initial value", () => {
      expect(resolveNumberFieldCommit("10", "10")).toEqual({
        commit: false,
      });
    });

    it("does not commit an unchanged draft even when it's outside min/max — the guard runs BEFORE clamping", () => {
      // A field focused on an already-out-of-range value (e.g. hp.max was
      // lowered elsewhere since, or an imported sheet) with the player
      // never typing anything must not fire a commit just because
      // clamping would reshape the untouched draft into a different
      // number. Reordering the guard after the clamp check breaks this.
      expect(resolveNumberFieldCommit("99", "99", 0, 20)).toEqual({
        commit: false,
      });
    });

    it("does not compare against a live/current server value — only the value captured at focus", () => {
      // Simulates: field focused while server value was "15" (captured as
      // initialValue), an external client then changes it to "12", the
      // player still hasn't typed anything (draft is still "15"). Must not
      // commit — comparing against the NEW server value ("12") instead of
      // the focus-time snapshot would wrongly see a "change" and overwrite
      // the external update the player never touched.
      expect(resolveNumberFieldCommit("15", "15")).toEqual({
        commit: false,
      });
    });
  });

  describe("mutation guard: clamp must not run before the unchanged-since-focus check", () => {
    it("regression: an unchanged out-of-range draft must stay non-committing", () => {
      const result = resolveNumberFieldCommit("30", "30", 0, 10);
      expect(result.commit).toBe(false);
    });
  });
});

describe("stepDraft", () => {
  it("a single ArrowUp press modifies the draft by +1", () => {
    expect(stepDraft("10", 10, 1)).toBe("11");
  });

  it("a single ArrowDown press modifies the draft by -1", () => {
    expect(stepDraft("10", 10, -1)).toBe("9");
  });

  it("twenty consecutive presses accumulate in the draft, with a single commit only once resolved afterward", () => {
    let draft = "10";
    const initialValue = "10";
    for (let i = 0; i < 20; i++) {
      draft = stepDraft(draft, 10, 1);
    }
    expect(draft).toBe("30");
    // The one and only commit resolution, exactly as the hook's blur
    // handler would perform it — never called inside the loop above.
    expect(resolveNumberFieldCommit(draft, initialValue)).toEqual({
      commit: true,
      value: 30,
    });
  });

  it("ArrowUp then ArrowDown returns to the starting value and produces no commit (initialValueRef guard)", () => {
    let draft = stepDraft("10", 10, 1);
    draft = stepDraft(draft, 10, -1);
    expect(draft).toBe("10");
    expect(resolveNumberFieldCommit(draft, "10")).toEqual({ commit: false });
  });

  it("stepping an empty draft restarts from the persisted value, not 0/NaN", () => {
    expect(stepDraft("", 10, 1)).toBe("11");
  });

  it("stepping a non-numeric draft restarts from the persisted value, not 0/NaN", () => {
    expect(stepDraft("abc", 10, 1)).toBe("11");
  });

  it("does not clamp mid-step — the draft is allowed outside min/max while editing", () => {
    // Clamping is resolveNumberFieldCommit's job, applied once at commit.
    // stepDraft itself takes no min/max at all, so it cannot clamp.
    let draft = "9";
    for (let i = 0; i < 5; i++) draft = stepDraft(draft, 9, 1);
    expect(draft).toBe("14"); // unclamped, even though a caller might cap display at e.g. 10
    expect(resolveNumberFieldCommit(draft, "9", 0, 10)).toEqual({
      commit: true,
      value: 10, // clamp only applied here, at commit
    });
  });

  describe("mutation guard: fallback must use the persisted value, not a hardcoded 0", () => {
    it("regression: an emptied draft stepped up must not restart from 0", () => {
      const result = stepDraft("", 42, 1);
      expect(result).toBe("43");
      expect(result).not.toBe("1");
    });
  });
});
