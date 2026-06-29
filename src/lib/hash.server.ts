import { createHash } from "node:crypto";

/** SHA-256 hex of a byte buffer (used for document content hashing). */
export function sha256Hex(buf: ArrayBuffer | Uint8Array | Buffer): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Stable SHA-256 of an arbitrary JSON value, with object keys sorted
 * recursively so the digest is independent of key insertion order. Used to key
 * idempotent extraction / underwriting work by the content of its inputs.
 */
export function stableJsonHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}
