export type HistoryChangeRow = {
  key: string;
  label: string;
  before: string;
  after: string;
};

export type HistoryContextRow = {
  key: string;
  label: string;
  value: string;
};

const HIDDEN_KEYS = new Set([
  "id",
  "owner_id",
  "actor_id",
  "changed_by",
  "created_by",
  "updated_by",
  "archived_by",
  "created_at",
  "updated_at",
  "changed_at",
  "row_version",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeKey(key: string): boolean {
  return !HIDDEN_KEYS.has(key) && !/(password|secret|token|hash|storage_path|signature)/i.test(key);
}

export function historyFieldLabel(key: string): string {
  return key.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function compactText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
}

export function historyValue(value: unknown, key = ""): string {
  if (value == null || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return Number.isFinite(value) ? value.toLocaleString("en-CA") : "Not set";
  if (typeof value === "string") {
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) return `Record ${value.slice(0, 8)}`;
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.valueOf())) return date.toLocaleString("en-CA");
    }
    const text = /(status|type|state|scope|kind|role)$/i.test(key)
      ? historyFieldLabel(value).replace(/\bAnd\b/g, "and")
      : value;
    return compactText(text);
  }
  if (Array.isArray(value)) {
    if (!value.length) return "None";
    if (value.every((item) => ["string", "number", "boolean"].includes(typeof item)))
      return compactText(value.map((item) => historyValue(item)).join(", "));
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  const record = asRecord(value);
  if (!record) return compactText(String(value));
  const parts = Object.entries(record)
    .filter(([nestedKey, nestedValue]) => safeKey(nestedKey) && nestedValue != null)
    .slice(0, 4)
    .map(
      ([nestedKey, nestedValue]) =>
        `${historyFieldLabel(nestedKey)}: ${historyValue(nestedValue, nestedKey)}`,
    );
  return parts.length ? compactText(parts.join(" · ")) : "Recorded";
}

function comparable(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function historyChangeRows(
  beforeState: unknown,
  afterState: unknown,
  limit = 8,
): HistoryChangeRow[] {
  const before = asRecord(beforeState) ?? {};
  const after = asRecord(afterState) ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(safeKey).sort();
  return keys
    .filter((key) => comparable(before[key]) !== comparable(after[key]))
    .slice(0, limit)
    .map((key) => ({
      key,
      label: historyFieldLabel(key),
      before: historyValue(before[key], key),
      after: historyValue(after[key], key),
    }));
}

export function historyContextRows(metadata: unknown, limit = 6): HistoryContextRow[] {
  const record = asRecord(metadata);
  if (!record) return [];
  return Object.entries(record)
    .filter(([key, value]) => safeKey(key) && value != null && value !== "")
    .slice(0, limit)
    .map(([key, value]) => ({
      key,
      label: historyFieldLabel(key),
      value: historyValue(value, key),
    }));
}
