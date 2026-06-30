// Extraction-accuracy scorecard: compare a run's extracted field map against a
// hand-verified golden map and produce per-field verdicts plus aggregate
// precision / recall / F1. This is the instrument that turns "extraction feels
// good on curated cases" into a number you can track as a real (anonymized)
// corpus grows. Pure and deterministic -- no I/O.

export type FieldValue = number | string | boolean | null;
export type FieldMap = Record<string, FieldValue>;

export type FieldVerdict = {
  key: string;
  status: "correct" | "incorrect" | "missing" | "spurious";
  extracted: FieldValue | undefined;
  golden: FieldValue | undefined;
};

export type Scorecard = {
  verdicts: FieldVerdict[];
  correct: number;
  incorrect: number;
  /** In golden but not produced by extraction. */
  missing: number;
  /** Produced by extraction but not in golden. */
  spurious: number;
  precision: number;
  recall: number;
  f1: number;
  /** Share of golden fields extracted exactly right. */
  accuracy: number;
};

export type ScoreOptions = {
  /** Relative tolerance for numeric comparison (default 0.5%). */
  numericTolerance?: number;
  /** Treat a golden value of null as "expected absent" rather than a field. */
  ignoreNullGolden?: boolean;
};

function isNum(v: FieldValue | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function valuesMatch(a: FieldValue | undefined, b: FieldValue | undefined, tol: number): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (isNum(a) && isNum(b)) {
    if (a === b) return true;
    const scale = Math.max(Math.abs(a), Math.abs(b));
    return scale === 0 ? a === b : Math.abs(a - b) / scale <= tol;
  }
  // Normalize strings: trim, collapse whitespace, case-insensitive.
  return (
    String(a).trim().replace(/\s+/g, " ").toLowerCase() ===
    String(b).trim().replace(/\s+/g, " ").toLowerCase()
  );
}

export function scoreExtraction(
  extracted: FieldMap,
  golden: FieldMap,
  opts: ScoreOptions = {},
): Scorecard {
  const tol = opts.numericTolerance ?? 0.005;
  const keys = new Set<string>([...Object.keys(extracted), ...Object.keys(golden)]);
  const verdicts: FieldVerdict[] = [];

  for (const key of [...keys].sort()) {
    const hasG = Object.prototype.hasOwnProperty.call(golden, key);
    const hasE = Object.prototype.hasOwnProperty.call(extracted, key);
    const g = golden[key];
    const e = extracted[key];

    if (opts.ignoreNullGolden && hasG && g == null && !hasE) continue;

    let status: FieldVerdict["status"];
    if (hasG && hasE) status = valuesMatch(e, g, tol) ? "correct" : "incorrect";
    else if (hasG && !hasE) status = "missing";
    else status = "spurious";

    verdicts.push({ key, status, extracted: hasE ? e : undefined, golden: hasG ? g : undefined });
  }

  const correct = verdicts.filter((v) => v.status === "correct").length;
  const incorrect = verdicts.filter((v) => v.status === "incorrect").length;
  const missing = verdicts.filter((v) => v.status === "missing").length;
  const spurious = verdicts.filter((v) => v.status === "spurious").length;

  // Precision: of what we produced, how much was right. Recall: of what should
  // exist, how much we got right. Guard against divide-by-zero (empty inputs
  // score a perfect 1, the only sensible identity).
  const produced = correct + incorrect + spurious;
  const expected = correct + incorrect + missing;
  const precision = produced === 0 ? 1 : correct / produced;
  const recall = expected === 0 ? 1 : correct / expected;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const accuracy = expected === 0 ? 1 : correct / expected;

  return {
    verdicts,
    correct,
    incorrect,
    missing,
    spurious,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    accuracy: round(accuracy),
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// Aggregate several per-document scorecards into a corpus-level summary
// (micro-average over all fields, so larger documents weigh proportionally).
export function aggregateScorecards(cards: Scorecard[]): Scorecard {
  const all = cards.flatMap((c) => c.verdicts);
  const correct = all.filter((v) => v.status === "correct").length;
  const incorrect = all.filter((v) => v.status === "incorrect").length;
  const missing = all.filter((v) => v.status === "missing").length;
  const spurious = all.filter((v) => v.status === "spurious").length;
  const produced = correct + incorrect + spurious;
  const expected = correct + incorrect + missing;
  const precision = produced === 0 ? 1 : correct / produced;
  const recall = expected === 0 ? 1 : correct / expected;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    verdicts: all,
    correct,
    incorrect,
    missing,
    spurious,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    accuracy: round(expected === 0 ? 1 : correct / expected),
  };
}
