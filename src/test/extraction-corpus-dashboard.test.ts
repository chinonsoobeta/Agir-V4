import { describe, expect, test } from "vitest";
import {
  buildExtractionCorpusDashboard,
  renderExtractionCorpusDashboard,
} from "@/lib/extraction-corpus-dashboard";

describe("extraction corpus dashboard", () => {
  test("summarizes precision/recall trend rows with pass/watch/fail status", () => {
    const rows = buildExtractionCorpusDashboard(
      {
        currency: { expected: 10, predicted: 10, truePositive: 10, recall: 1, precision: 1 },
        percent: { expected: 10, predicted: 11, truePositive: 9, recall: 0.9, precision: 9 / 11 },
        ratio: { expected: 5, predicted: 5, truePositive: 4, recall: 0.8, precision: 0.8 },
      },
      {
        currency: { recall: 1, precision: 1 },
        percent: { recall: 0.92, precision: 0.82 },
        ratio: { recall: 0.95, precision: 0.95 },
      },
    );

    expect(rows.map((row) => [row.fieldType, row.status])).toEqual([
      ["currency", "pass"],
      ["percent", "watch"],
      ["ratio", "fail"],
    ]);
    expect(renderExtractionCorpusDashboard(rows)).toContain("false_positive,false_negative");
  });
});
