// Integration connector abstraction (Workstream 3C).
//
// A connector is a deterministic, dependency-free adapter between an external
// system's payload and our normalized deal record. It does TWO things: parse an
// inbound payload into deal records (using an explicit field mapping) and format
// outbound deal records back into the external payload. Persistence, auth, and
// sync-run bookkeeping live in the server functions; connectors stay pure so the
// import/export round-trip is unit-testable.
//
// One reference connector is fully LIVE (CSV). Salesforce / DealCloud / generic
// HTTP are declared PLANNED so the UI never shows a fake "connected" state.

export type FieldMapping = Record<string, string>; // external column -> internal field key

// The internal fields a connector may map onto. external_id is required so an
// import is idempotent (it links to external_record_links).
export type DealRecord = {
  external_id: string;
  name: string;
  location: string | null;
  type: string | null;
  source: string | null;
  probability: number | null;
  target_close_date: string | null;
};

export type ParseResult = { records: DealRecord[]; errors: string[] };

export type Connector = {
  provider: string;
  label: string;
  category: string;
  status: "live" | "planned";
  // Internal field keys this connector can read/write.
  fields: Array<keyof DealRecord>;
  parseInbound(payload: string, mapping: FieldMapping): ParseResult;
  formatOutbound(records: DealRecord[], mapping: FieldMapping): string;
};

export const DEAL_FIELDS: Array<keyof DealRecord> = [
  "external_id",
  "name",
  "location",
  "type",
  "source",
  "probability",
  "target_close_date",
];

// ---- Minimal RFC-4180 CSV parse / stringify (quotes, embedded commas, CRLF) ----
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  // Flush the trailing field/row unless the file ended on a clean newline.
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function toCsv(rows: string[][]): string {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map((c) => esc(c ?? "")).join(",")).join("\n");
}

export const csvConnector: Connector = {
  provider: "csv",
  label: "CSV Import / Export",
  category: "spreadsheet",
  status: "live",
  fields: DEAL_FIELDS,
  parseInbound(payload, mapping) {
    const errors: string[] = [];
    const rows = parseCsv(payload);
    if (rows.length < 2)
      return {
        records: [],
        errors: rows.length === 0 ? ["Empty CSV payload."] : ["CSV has a header but no data rows."],
      };
    const header = rows[0].map((h) => h.trim());
    // Invert the mapping: external column header -> internal field.
    const colToField = new Map<number, keyof DealRecord>();
    for (const [externalCol, internalField] of Object.entries(mapping)) {
      const idx = header.findIndex((h) => h.toLowerCase() === externalCol.toLowerCase());
      if (idx >= 0 && DEAL_FIELDS.includes(internalField as keyof DealRecord)) {
        colToField.set(idx, internalField as keyof DealRecord);
      }
    }
    const records: DealRecord[] = [];
    rows.slice(1).forEach((cells, i) => {
      // Collect the mapped raw strings, then build a fully-typed record.
      const raw: Partial<Record<keyof DealRecord, string>> = {};
      for (const [idx, field] of colToField) raw[field] = (cells[idx] ?? "").trim();
      const probNum =
        raw.probability != null ? Number(raw.probability.replace(/[%\s]/g, "")) : Number.NaN;
      const rec: DealRecord = {
        external_id: raw.external_id ?? "",
        name: raw.name ?? "",
        location: raw.location ? raw.location : null,
        type: raw.type ? raw.type : null,
        source: raw.source ? raw.source : null,
        probability: Number.isFinite(probNum) ? probNum : null,
        target_close_date: raw.target_close_date ? raw.target_close_date : null,
      };
      if (!rec.external_id) {
        errors.push(`Row ${i + 2}: missing external id (mapped column empty).`);
        return;
      }
      if (!rec.name) {
        errors.push(`Row ${i + 2}: missing deal name.`);
        return;
      }
      records.push(rec);
    });
    return { records, errors };
  },
  formatOutbound(records, mapping) {
    // Stable column order: the mapping's external columns in insertion order.
    const cols = Object.entries(mapping).filter(([, f]) =>
      DEAL_FIELDS.includes(f as keyof DealRecord),
    );
    const header = cols.map(([externalCol]) => externalCol);
    const body = records.map((rec) =>
      cols.map(([, field]) => {
        const v = rec[field as keyof DealRecord];
        return v == null ? "" : String(v);
      }),
    );
    return toCsv([header, ...body]);
  },
};

export type ConnectorMeta = {
  provider: string;
  label: string;
  category: string;
  status: "live" | "planned";
};

// The provider registry: exactly which connectors are LIVE versus PLANNED. The
// UI reads this so it never advertises a connection it cannot actually run.
export const CONNECTOR_REGISTRY: ConnectorMeta[] = [
  { provider: "csv", label: "CSV Import / Export", category: "spreadsheet", status: "live" },
  { provider: "http_generic", label: "Generic HTTP / Webhook", category: "api", status: "planned" },
  { provider: "salesforce", label: "Salesforce", category: "crm", status: "planned" },
  { provider: "dealcloud", label: "DealCloud", category: "crm", status: "planned" },
];

export function getConnector(provider: string): Connector | null {
  return provider === "csv" ? csvConnector : null;
}
