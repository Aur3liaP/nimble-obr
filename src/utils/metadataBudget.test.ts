import { describe, expect, it } from "vitest";
import {
  ROOM_METADATA_NAMESPACE_BUDGET_BYTES,
  computeMetadataBudget,
} from "./metadataBudget";

const NAMESPACE = "com.nimble-obr.nimble/character_sheet";

describe("computeMetadataBudget", () => {
  it("splits metadata into this namespace vs. others", () => {
    const metadata = {
      [`${NAMESPACE}/characters/token-1`]: { name: "Aldrick", level: 10 },
      "com.other-extension.foo/state": { some: "data", another: [1, 2, 3] },
    };
    const report = computeMetadataBudget(metadata, NAMESPACE);
    expect(report.namespaceBytes).toBeGreaterThan(0);
    expect(report.otherExtensionsBytes).toBeGreaterThan(0);
    // Both subsets independently serialized should stay close to the true total.
    expect(report.namespaceBytes + report.otherExtensionsBytes).toBeGreaterThanOrEqual(report.totalBytes);
    expect(report.namespaceBytes + report.otherExtensionsBytes - report.totalBytes).toBeLessThan(8);
  });

  it("reports 0 namespace bytes, not the empty-object 2 bytes, when nothing matches", () => {
    const metadata = { "com.other-extension.foo/state": { a: 1 } };
    const report = computeMetadataBudget(metadata, NAMESPACE);
    expect(report.namespaceBytes).toBe(0);
    expect(report.otherExtensionsBytes).toBeGreaterThan(0);
  });

  it("reports 0 other-extension bytes when this namespace owns everything", () => {
    const metadata = { [`${NAMESPACE}/characters/token-1`]: { name: "Aldrick" } };
    const report = computeMetadataBudget(metadata, NAMESPACE);
    expect(report.otherExtensionsBytes).toBe(0);
    expect(report.namespaceBytes).toBe(report.totalBytes);
  });

  it("returns all zeros for empty room metadata", () => {
    const report = computeMetadataBudget({}, NAMESPACE);
    expect(report.totalBytes).toBe(2); // "{}"
    expect(report.namespaceBytes).toBe(0);
    expect(report.otherExtensionsBytes).toBe(0);
    expect(report.isNamespaceOverBudget).toBe(false);
  });

  it("flags the namespace as over budget once it exceeds the given threshold", () => {
    const big = "x".repeat(200);
    const metadata = { [`${NAMESPACE}/characters/token-1`]: big };
    const report = computeMetadataBudget(metadata, NAMESPACE, 100);
    expect(report.isNamespaceOverBudget).toBe(true);
  });

  it("defaults the budget to ROOM_METADATA_NAMESPACE_BUDGET_BYTES", () => {
    const report = computeMetadataBudget({}, NAMESPACE);
    expect(report.namespaceBudgetBytes).toBe(ROOM_METADATA_NAMESPACE_BUDGET_BYTES);
  });
});
