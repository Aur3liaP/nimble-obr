/**
 * @file Cross-environment UTF-8 byte-length measurement for JSON-serializable
 * values.
 *
 * Shared by `metadataSizing.ts` (the offline room-metadata sizing script and
 * its tests) and `metadataBudget.ts` (the runtime room-metadata audit) so
 * both compute "how many bytes would this cost as OBR metadata" the exact
 * same way. `TextEncoder` is used instead of Node's `Buffer` because
 * `metadataBudget.ts` is imported from browser code (the runtime audit runs
 * inside the OBR extension iframe), not just from Node scripts/tests —
 * `TextEncoder` is the one UTF-8-length primitive available, unchanged, in
 * both environments.
 */

/**
 * UTF-8 byte length of `JSON.stringify(value)`.
 *
 * @remarks Mirrors how OBR actually transmits metadata: as a JSON string
 * over the wire, not as a JS object graph. `undefined` (a value that
 * `JSON.stringify` drops entirely, e.g. an omitted optional field) costs 0
 * bytes, matching that a key whose value is `undefined` is never present in
 * the serialized object at all.
 * @param value - Any JSON-serializable value (or `undefined`).
 * @returns The number of UTF-8 bytes `value` would occupy once serialized.
 */
export function byteSize(value: unknown): number {
  if (value === undefined) return 0;
  const json = JSON.stringify(value);
  if (json === undefined) return 0;
  return new TextEncoder().encode(json).length;
}
