/**
 * @file Unit tests for {@link DebouncedCommit}, the pure (no React) timing
 * logic behind {@link useDebouncedCommit}. The hook itself is a thin
 * `useRef` wrapper with no independent logic worth rendering a component
 * for (this project has no hook-rendering test utility installed) — see
 * `useDebouncedCommit.ts`'s file header.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebouncedCommit } from "./useDebouncedCommit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DebouncedCommit", () => {
  it("does not commit before the quiet period elapses", () => {
    const onCommit = vi.fn();
    const commit = new DebouncedCommit<number>(onCommit, 300);
    commit.schedule(1);
    vi.advanceTimersByTime(299);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the value once the quiet period elapses", () => {
    const onCommit = vi.fn();
    const commit = new DebouncedCommit<number>(onCommit, 300);
    commit.schedule(1);
    vi.advanceTimersByTime(300);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("collapses a burst into a single commit of the LATEST value, not one per schedule call", () => {
    const onCommit = vi.fn();
    const commit = new DebouncedCommit<number>(onCommit, 300);
    // Simulates OS key-repeat / spinner ticks: each call restarts the timer.
    for (let v = 1; v <= 20; v++) {
      commit.schedule(v);
      vi.advanceTimersByTime(50); // well under the 300ms quiet period
    }
    expect(onCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(20);
  });

  it("flush commits immediately, skipping the remaining quiet period", () => {
    const onCommit = vi.fn();
    const commit = new DebouncedCommit<number>(onCommit, 300);
    commit.schedule(5);
    vi.advanceTimersByTime(10);
    commit.flush();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(5);
  });

  it("flush is a no-op when nothing is pending", () => {
    const onCommit = vi.fn();
    const commit = new DebouncedCommit<number>(onCommit, 300);
    commit.flush();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("flush does not double-commit after the timer already fired on its own", () => {
    const onCommit = vi.fn();
    const commit = new DebouncedCommit<number>(onCommit, 300);
    commit.schedule(7);
    vi.advanceTimersByTime(300);
    expect(onCommit).toHaveBeenCalledTimes(1);
    commit.flush();
    expect(onCommit).toHaveBeenCalledTimes(1); // still just the one commit
  });

  it("a second schedule after a completed commit starts a fresh, independent cycle", () => {
    const onCommit = vi.fn();
    const commit = new DebouncedCommit<number>(onCommit, 300);
    commit.schedule(1);
    vi.advanceTimersByTime(300);
    commit.schedule(2);
    vi.advanceTimersByTime(300);
    expect(onCommit).toHaveBeenNthCalledWith(1, 1);
    expect(onCommit).toHaveBeenNthCalledWith(2, 2);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("setOnCommit updates the callback used by a future commit without disturbing a pending value", () => {
    const first = vi.fn();
    const second = vi.fn();
    const commit = new DebouncedCommit<number>(first, 300);
    commit.schedule(9);
    commit.setOnCommit(second);
    vi.advanceTimersByTime(300);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith(9);
  });
});
