/**
 * @file Runtime audit of this extension's OBR room-metadata footprint
 * against its own, self-imposed byte budget.
 *
 * Room metadata (`OBR.room.getMetadata()`/`setMetadata()`) is a single
 * 16KB-capped bucket shared by every extension the GM has installed — a
 * total this extension does not control and must never dominate on its
 * own. `ROOM_METADATA_NAMESPACE_BUDGET_BYTES` below is this extension's own
 * self-imposed half of that shared ceiling (see the room-metadata sizing
 * report for how that split was chosen); the other half is left for every
 * other extension the GM did not choose to have compete with this one.
 *
 * `computeMetadataBudget` is pure and unit-tested. `auditRoomMetadata` is
 * the thin OBR-dependent wrapper actually called at runtime — not unit
 * tested, same convention as the rest of `useOBR.ts`: OBR-dependent code is
 * kept thin and pushed to the edge, the logic it wraps is what gets tested.
 *
 * This module currently has no call site — it is instrumentation, added
 * ahead of the room-metadata migration study so a future migration (or an
 * in-app "storage running low" warning) has it ready, not something the
 * app calls today. See the sizing report for the go/no-go recommendation
 * this measurement session produced.
 */

import { byteSize } from "./byteSize";

/** OBR's own hard cap on total room metadata, shared by every installed extension. */
export const ROOM_METADATA_TOTAL_BUDGET_BYTES = 16 * 1024;

/**
 * This extension's self-imposed share of {@link ROOM_METADATA_TOTAL_BUDGET_BYTES}
 * — half, leaving the rest for every other extension the GM has installed.
 * An extension that consumes the whole shared budget is a bad citizen of
 * the room, independent of whether OBR itself would technically allow it.
 */
export const ROOM_METADATA_NAMESPACE_BUDGET_BYTES = 8 * 1024;

export interface RoomMetadataBudgetReport {
  /** Byte size of the entire room metadata object, across every installed extension. */
  totalBytes: number;
  /** Byte size of just the keys belonging to this extension's namespace. */
  namespaceBytes: number;
  /** Byte size of every other extension's keys combined. */
  otherExtensionsBytes: number;
  /** The budget `namespaceBytes` was checked against. */
  namespaceBudgetBytes: number;
  isNamespaceOverBudget: boolean;
}

/**
 * Serializes just the metadata entries matching `predicate`, as their own
 * standalone object — returns 0 (not `byteSize({})`'s 2) when nothing
 * matches, since an empty namespace should cost nothing, not the 2 bytes of
 * an empty object literal that only exists as a measurement artifact.
 */
function subsetByteSize(metadata: Record<string, unknown>, predicate: (key: string) => boolean): number {
  const entries = Object.entries(metadata).filter(([key]) => predicate(key));
  if (entries.length === 0) return 0;
  return byteSize(Object.fromEntries(entries));
}

/**
 * Pure computation behind {@link auditRoomMetadata}: splits a room metadata
 * object into this extension's namespace vs. everyone else's, and checks
 * the namespace share against a budget.
 *
 * @remarks `namespaceBytes` and `otherExtensionsBytes` are each measured by
 * serializing their own subset as a standalone object, not by subtracting
 * one from `totalBytes` — the fairer number for "how many bytes is MY
 * namespace actually costing," matching how {@link measureCharacterWeight}
 * in `metadataSizing.ts` treats its own field groups. As a result the two
 * subset sizes can sum to a few bytes more than `totalBytes` (each subset
 * pays for its own `{`/`}` and inter-key commas); use `totalBytes` for the
 * authoritative whole-room figure, the two subsets for the proportional
 * comparison.
 * @param metadata - The full room metadata object (`OBR.room.getMetadata()`'s result, or a test double).
 * @param namespacePrefix - Prefix identifying this extension's own keys (e.g. `METADATA_KEY`).
 * @param namespaceBudgetBytes - Defaults to {@link ROOM_METADATA_NAMESPACE_BUDGET_BYTES}.
 */
export function computeMetadataBudget(
  metadata: Record<string, unknown>,
  namespacePrefix: string,
  namespaceBudgetBytes: number = ROOM_METADATA_NAMESPACE_BUDGET_BYTES,
): RoomMetadataBudgetReport {
  const namespaceBytes = subsetByteSize(metadata, (key) => key.startsWith(namespacePrefix));
  const otherExtensionsBytes = subsetByteSize(metadata, (key) => !key.startsWith(namespacePrefix));
  return {
    totalBytes: byteSize(metadata),
    namespaceBytes,
    otherExtensionsBytes,
    namespaceBudgetBytes,
    isNamespaceOverBudget: namespaceBytes > namespaceBudgetBytes,
  };
}

/**
 * Reads the live room metadata from OBR and audits this extension's share
 * of it. Callable from anywhere in the app once `OBR.isAvailable` — see
 * `useOBR.ts`'s own `OBR.isAvailable` gating convention for why that check
 * belongs at the call site, not baked into this function.
 *
 * @remarks Imports `@owlbear-rodeo/sdk` dynamically, inside this function,
 * rather than as a static top-level import like the rest of the app
 * (`useOBR.ts`). The SDK module has a load-time side effect that reads
 * `window.location` (`getDetails()` in the SDK's own entrypoint), which
 * throws in Vitest's Node test environment the instant the module is
 * imported — even if the importing test never calls anything OBR-related.
 * A static import would make `computeMetadataBudget` above untestable too,
 * since both would load from the same module. Deferring the import to call
 * time keeps this file's pure half (everything above) unit-testable while
 * this OBR-dependent half stays untested, same as the rest of `useOBR.ts`.
 * @param namespacePrefix - Prefix identifying this extension's own keys (e.g. `METADATA_KEY`).
 * @param namespaceBudgetBytes - Defaults to {@link ROOM_METADATA_NAMESPACE_BUDGET_BYTES}.
 */
export async function auditRoomMetadata(
  namespacePrefix: string,
  namespaceBudgetBytes: number = ROOM_METADATA_NAMESPACE_BUDGET_BYTES,
): Promise<RoomMetadataBudgetReport> {
  const { default: OBR } = await import("@owlbear-rodeo/sdk");
  const metadata = await OBR.room.getMetadata();
  return computeMetadataBudget(metadata, namespacePrefix, namespaceBudgetBytes);
}
