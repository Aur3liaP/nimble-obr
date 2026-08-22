import { describe, expect, it } from "vitest";
import { byteSize } from "./byteSize";

describe("byteSize", () => {
  it("measures plain ASCII JSON", () => {
    expect(byteSize({ a: 1 })).toBe(new TextEncoder().encode('{"a":1}').length);
  });

  it("counts accented characters as multiple UTF-8 bytes", () => {
    // "é" is 2 bytes in UTF-8, so this must cost more than its character count would suggest.
    const ascii = byteSize("cafe");
    const accented = byteSize("café");
    expect(accented).toBeGreaterThan(ascii);
    expect(accented - ascii).toBe(1); // "é" (2 bytes) replacing "e" (1 byte)
  });

  it("returns 0 for undefined, matching JSON.stringify dropping it entirely", () => {
    expect(byteSize(undefined)).toBe(0);
  });

  it("omits keys whose value is undefined, matching JSON.stringify", () => {
    expect(byteSize({ a: 1, b: undefined })).toBe(byteSize({ a: 1 }));
  });
});
