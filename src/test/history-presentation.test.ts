import { describe, expect, it } from "vitest";
import { historyChangeRows, historyContextRows, historyValue } from "@/lib/history-presentation";

describe("history presentation", () => {
  it("presents changed fields as structured before and after values", () => {
    const rows = historyChangeRows(
      { status: "active", price: 1_000_000, notes: "Same" },
      { status: "archived", price: 1_250_000, notes: "Same" },
    );

    expect(rows).toEqual([
      { key: "price", label: "Price", before: "1,000,000", after: "1,250,000" },
      { key: "status", label: "Status", before: "Active", after: "Archived" },
    ]);
  });

  it("does not expose identifiers or sensitive provenance fields", () => {
    const changes = historyChangeRows(
      { owner_id: "old", api_token: "old", status: "active" },
      { owner_id: "new", api_token: "new", status: "archived" },
    );
    const context = historyContextRows({
      storage_path: "private/path.pdf",
      signature_hash: "secret",
      source_kind: "verified_source",
    });

    expect(changes.map((row) => row.key)).toEqual(["status"]);
    expect(context).toEqual([
      { key: "source_kind", label: "Source Kind", value: "Verified Source" },
    ]);
  });

  it("bounds long text and formats missing values explicitly", () => {
    expect(historyValue(null)).toBe("Not set");
    const value = historyValue("x".repeat(250));
    expect(value.length).toBeLessThanOrEqual(180);
    expect(value.endsWith("…")).toBe(true);
  });
});
