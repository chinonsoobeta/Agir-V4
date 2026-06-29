export type ExtractionFieldMetrics = {
  expected: number;
  predicted: number;
  truePositive: number;
  recall: number;
  precision: number;
};

export type ExtractionDashboardRow = ExtractionFieldMetrics & {
  fieldType: string;
  falsePositive: number;
  falseNegative: number;
  status: "pass" | "watch" | "fail";
};

export function buildExtractionCorpusDashboard(
  metrics: Record<string, ExtractionFieldMetrics>,
  floors: Record<string, { recall: number; precision: number }>,
): ExtractionDashboardRow[] {
  return Object.entries(metrics)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fieldType, metric]) => {
      const floor = floors[fieldType] ?? { recall: 0, precision: 0 };
      const falsePositive = Math.max(0, metric.predicted - metric.truePositive);
      const falseNegative = Math.max(0, metric.expected - metric.truePositive);
      const recallGap = floor.recall - metric.recall;
      const precisionGap = floor.precision - metric.precision;
      const status =
        recallGap > 0.05 || precisionGap > 0.05
          ? "fail"
          : recallGap > 0 || precisionGap > 0
            ? "watch"
            : "pass";
      return { fieldType, ...metric, falsePositive, falseNegative, status };
    });
}

export function renderExtractionCorpusDashboard(rows: ExtractionDashboardRow[]): string {
  return [
    "field_type,recall,precision,true_positive,expected,predicted,false_positive,false_negative,status",
    ...rows.map((row) =>
      [
        row.fieldType,
        row.recall.toFixed(3),
        row.precision.toFixed(3),
        row.truePositive,
        row.expected,
        row.predicted,
        row.falsePositive,
        row.falseNegative,
        row.status,
      ].join(","),
    ),
  ].join("\n");
}
