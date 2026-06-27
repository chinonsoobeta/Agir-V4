// Regression tests for the false budget_vs_stated_total reconciliation:
// (A) a DOCX whose runs glue together must not truncate "$162,500,000" to
//     "162,500", and the senior loan must map to debt_amount: never to
//     total_project_cost. With the senior loan correctly mapped, no bogus
//     stated total is produced and budget_vs_stated_total does not fire.
// (B) the reconciliation guard downgrades an implausibly small stated total to
//     a suspect WARNING (not a hard error) and cites its source.

import { describe, expect, test } from "vitest";
import { docxBufferToText } from "@/lib/document-text.server";
import { extractCandidates } from "@/lib/assumption-candidates.server";
import { mapCandidateToKey, mapCandidates, groupAndResolve } from "@/lib/assumption-mapping";
import { runReconciliationChecks } from "@/lib/engine";

async function addendumDocxText(): Promise<string> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const lines = [
    "CONSTRUCTION BUDGET",
    "Land Cost: $34,500,000",
    "Hard Costs: $162,000,000",
    "Soft Costs: $27,500,000",
    "Financing Costs: $18,000,000",
    "Contingency Reserve: $8,000,000",
    "Total Project Cost: $250,000,000",
    "CAPITAL STACK",
    "Senior Construction Debt: $162,500,000",
    "Preferred Equity: $37,500,000",
    "Common Equity: $50,000,000",
  ];
  const doc = new Document({
    sections: [{ children: lines.map((l) => new Paragraph({ children: [new TextRun(l)] })) }],
  });
  const buf = await Packer.toBuffer(doc);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return docxBufferToText(ab);
}

describe("budget_vs_stated_total does not fire from the senior loan", () => {
  test("DOCX numbers are not truncated and the senior loan maps to debt_amount", async () => {
    const text = await addendumDocxText();

    // The $162.5M senior loan must survive intact (not truncated to 162,500).
    const cands = extractCandidates("Addendum.docx", text);
    expect(cands.some((c) => c.kind === "currency" && c.value_numeric === 162_500_000)).toBe(true);
    expect(cands.some((c) => c.value_numeric === 162_500)).toBe(false);

    // The senior-debt value maps to debt_amount, never total_project_cost.
    const seniorDebt = cands.find((c) => c.value_numeric === 162_500_000)!;
    expect(mapCandidateToKey(seniorDebt)?.field_key).toBe("debt_amount");

    const grouped = groupAndResolve(mapCandidates(cands));
    expect(grouped.get("debt_amount")?.value_numeric).toBe(162_500_000);
    // Total project cost, if mapped, is the real $250M: never the $162.5M loan.
    const tpc = grouped.get("total_project_cost");
    if (tpc) expect(tpc.value_numeric).toBe(250_000_000);
    // No key carries the loan value as a stated total.
    expect(grouped.get("total_project_cost")?.value_numeric).not.toBe(162_500_000);
  });

  test("with the loan correctly mapped, reconciliation raises no budget_vs_stated_total error", () => {
    // statedTotalProjectCost is the correctly-mapped $250M (== budget sum).
    const flags = runReconciliationChecks({
      tdc: 250_000_000,
      equity: 50_000_000,
      loan: 162_500_000,
      noi: 6_395_155,
      amortizingAnnualDebtService: 12_006_485,
      minDscr: 1.2,
      statedTotalProjectCost: 250_000_000,
      budgetSum: 250_000_000,
    });
    expect(flags.find((f) => f.check_key === "budget_vs_stated_total")).toBeUndefined();
  });

  test("an implausibly small stated total is a suspect WARNING, not a hard error, and cites its source", () => {
    const flags = runReconciliationChecks({
      tdc: 250_000_000,
      equity: 50_000_000,
      loan: 162_500_000,
      noi: 6_395_155,
      amortizingAnnualDebtService: 12_006_485,
      minDscr: 1.2,
      statedTotalProjectCost: 162_500,
      budgetSum: 250_000_000,
      statedTotalSource: "Addendum.docx: Senior Construction Debt: $162,500,000",
    });
    const flag = flags.find((f) => f.check_key === "budget_vs_stated_total")!;
    expect(flag).toBeDefined();
    expect(flag.severity).toBe("warning");
    expect(flag.message).toMatch(/suspect/i);
    expect(flag.message).toContain("Addendum.docx");
  });
});
