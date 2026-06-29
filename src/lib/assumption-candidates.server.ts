// Stage 1 of the extraction pipeline: deterministic, regex-driven candidate
// discovery. Scans raw document text and extracts every currency value,
// percentage, basis-point spread, ratio, unit count, square footage, rent, and
// duration along with the surrounding context and the label phrase to the LEFT
// of the match (the natural field label). Output is fed to the deterministic
// alias mapper (Stage 2). The extractor never invents values: every candidate
// is a literal token lifted from the document text.

export type CandidateKind =
  | "currency"
  | "percent"
  | "rent"
  | "sf"
  | "units"
  | "duration"
  | "ratio"
  | "date";

export type Candidate = {
  kind: CandidateKind;
  value_numeric: number | null;
  value_text: string;
  unit: string;
  // ~160 chars around the match.
  context: string;
  doc_name: string;
  // Nearby phrase (left of match) used as a label hint for alias mapping.
  label_hint: string;
  // Best-effort location, e.g. "Sheet Construction Budget row 4" or a char
  // offset, so the UI can show provenance.
  source_location: string | null;
};

// Money keywords used to promote a bare "34.5 million" / "34,500,000" to a
// currency candidate only when its label clearly denotes money.
const MONEY_LABEL_RE =
  /\b(cost|costs|loan|equity|rent|value|proceeds|budget|tdc|tpc|noi|revenue|financing|contingency|acquisition|debt|price|amount|reserve|capital|fee|fees|income|contribution|hard|soft)\b/i;

// Enumerator / reference words that immediately precede a bare alphanumeric
// token ("Phase 2b", "Exhibit 4k", "Line 7m"): the number is an item reference,
// not a money magnitude. Used to reject a bare scaled-money match whose number
// is actually a section/figure label even though a money word appears elsewhere
// on the line. Matched against the trailing text of the left-of-value label.
const ENUMERATOR_TRAILING_RE =
  /\b(?:phase|section|building|bldg|line|exhibit|item|lot|floor|figure|fig|table|appendix|schedule|step|option|round|unit|note|tier|block|parcel|page|article|clause|chart|diagram|wing|level|suite|ste|room|grade|tab|column|col|row|footnote|attachment|annex|addendum|amendment|rev|version|sheet)\.?\s*$/i;

function scaleMultiplier(suffix?: string): number {
  if (!suffix) return 1;
  const s = suffix.toLowerCase();
  if (s === "bn" || s === "b" || s.startsWith("bil")) return 1_000_000_000;
  if (s === "mm" || s === "m" || s.startsWith("mil")) return 1_000_000;
  if (s === "k" || s.startsWith("thou")) return 1_000;
  return 1;
}

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function contextAround(text: string, idx: number, len: number, span = 80): string {
  const start = Math.max(0, idx - span);
  const end = Math.min(text.length, idx + len + span);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

// The label that names a value is the text immediately to its left ON THE SAME
// LINE. Scoping to the current line prevents a value from borrowing a
// neighbouring line's label (e.g. "Preferred Equity: $37,500,000" inheriting the
// previous line's "Senior Construction Debt").
function labelHint(text: string, idx: number, span = 64): string {
  const start = Math.max(0, idx - span);
  let seg = text.slice(start, idx);
  const nl = seg.lastIndexOf("\n");
  if (nl >= 0) seg = seg.slice(nl + 1);
  return seg.replace(/\s+/g, " ").trim();
}

// Spreadsheet lines are emitted as "Sheet <name> row <n>: <label> | <value>".
// Recover that prefix (or fall back to a char offset) for provenance.
function sourceLocation(text: string, idx: number): string | null {
  const lineStart = text.lastIndexOf("\n", idx) + 1;
  const line = text.slice(lineStart, Math.min(text.length, lineStart + 80));
  const sheetMatch = line.match(/^(Sheet [^|:]+?row \d+)/i);
  if (sheetMatch) return sheetMatch[1].trim();
  return `char ${idx}`;
}

// Tracks claimed [start,end) spans so a single numeric token is not emitted as
// multiple candidates (e.g. "$42 per square foot" is one rent, not also "$42"
// currency and "42 sf").
//
// Backed by a per-character coverage bitmap rather than a list of spans: the
// previous list-scan made `overlaps()` O(spans) per call, so a whole-document
// scan was O(matches²) and degraded sharply on large (500–1000 page) inputs.
// The bitmap makes both `overlaps` and `claim` O(token length) - i.e. the whole
// pass is linear in the scanned text - at a cost of one byte per character.
class Claims {
  private readonly claimed: Uint8Array;
  constructor(length: number) {
    this.claimed = new Uint8Array(Math.max(0, length));
  }
  overlaps(start: number, end: number): boolean {
    const lo = Math.max(0, start);
    const hi = Math.min(this.claimed.length, end);
    for (let i = lo; i < hi; i++) if (this.claimed[i]) return true;
    return false;
  }
  claim(start: number, end: number) {
    const lo = Math.max(0, start);
    const hi = Math.min(this.claimed.length, end);
    for (let i = lo; i < hi; i++) this.claimed[i] = 1;
  }
}

export function extractCandidates(docName: string, text: string): Candidate[] {
  const out: Array<Candidate & { _idx: number }> = [];
  const claims = new Claims(text.length);
  const push = (
    idx: number,
    len: number,
    c: Omit<Candidate, "doc_name" | "context" | "label_hint" | "source_location">,
  ) => {
    // For unit counts the descriptor that names the value usually sits BETWEEN
    // the number and the noun ("220 residential units"), i.e. inside the match
    // rather than to its left. Fold the matched phrase into the label hint so the
    // mapper can classify it; other kinds keep the strict left-of-value label.
    const baseHint = labelHint(text, idx);
    const hint =
      c.kind === "units"
        ? `${baseHint} ${text.slice(idx, idx + len)}`.replace(/\s+/g, " ").trim()
        : baseHint;
    out.push({
      ...c,
      doc_name: docName,
      context: contextAround(text, idx, len),
      label_hint: hint,
      source_location: sourceLocation(text, idx),
      _idx: idx,
    });
  };

  // Run patterns in priority order; the most specific (rent) claims its span
  // first so the generic currency/sf passes skip it.
  type Pass = {
    re: RegExp;
    handle: (
      m: RegExpMatchArray,
    ) => Omit<Candidate, "doc_name" | "context" | "label_hint" | "source_location"> | null;
  };

  const passes: Pass[] = [
    // Rent: monthly: "$3,050/month", "$3,050 per unit per month", "$3,050/unit/month".
    {
      re: /\$?\s?([\d,]+(?:\.\d+)?)\s*(?:\/\s*mo(?:nth)?\b|per\s+month\b|per\s+unit\s+per\s+month\b|\/\s*unit\s*\/\s*(?:mo|month)\b|per\s+unit\s*\/\s*(?:mo|month)\b)/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return { kind: "rent", value_numeric: n, value_text: `$${m[1]}/mo`, unit: "$/mo" };
      },
    },
    // Rent: per SF with the dollar sign after the number: "55 $/SF".
    {
      re: /([\d,]+(?:\.\d+)?)\s*\$\s*\/\s*(?:sf|sq\.?\s*ft\.?|square\s+foot|rentable\s+square\s+foot)\b/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return { kind: "rent", value_numeric: n, value_text: `$${m[1]}/SF`, unit: "$/SF" };
      },
    },
    // Rent: per SF: "$42 PSF", "$42/SF", "$42 per square foot", "55 per rentable square foot".
    {
      re: /\$?\s?([\d,]+(?:\.\d+)?)\s*(?:psf\b|\/\s*sf\b|per\s+sf\b|per\s+(?:rentable\s+)?square\s+foot\b|\/\s*(?:rentable\s+)?square\s+foot\b)/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return { kind: "rent", value_numeric: n, value_text: `$${m[1]}/SF`, unit: "$/SF" };
      },
    },
    // Currency with optional scale word: "$34.5M", "$34.5 million", "CAD 34.5 million", "USD 34,500,000", "$3,050".
    {
      re: /(?:CAD|USD|US\$|C\$|\$)\s?([\d,]+(?:\.\d+)?)\s*(million|billion|thousand|mm|bn|m|b|k)?\b/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return {
          kind: "currency",
          value_numeric: n * scaleMultiplier(m[2]),
          value_text: m[0].trim(),
          unit: "$",
        };
      },
    },
    // Percent RANGE: "5.0% - 5.5%", "5% to 6%". A stated range is ONE estimate,
    // so collapse it to a single midpoint candidate (claiming the whole span)
    // instead of two values that downstream would treat as a blocking conflict.
    // Runs before the single-percent pass so it claims the range first.
    {
      re: /([\d,]+(?:\.\d+)?)\s*%\s*(?:[-\u2013\u2014]|to\b|through\b)\s*([\d,]+(?:\.\d+)?)\s*%/gi,
      handle: (m) => {
        const a = toNumber(m[1]);
        const b = toNumber(m[2]);
        if (!isFinite(a) || !isFinite(b)) return null;
        const mid = Math.round(((a + b) / 2) * 1000) / 1000;
        return {
          kind: "percent",
          value_numeric: mid,
          value_text: `${m[1]}%-${m[2]}% (mid ${mid}%)`,
          unit: "%",
        };
      },
    },
    // Basis points: "625 bps" → 6.25%.
    {
      re: /([\d,]+(?:\.\d+)?)\s*bps\b/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return { kind: "percent", value_numeric: n / 100, value_text: m[0].trim(), unit: "%" };
      },
    },
    // Percent: "6.25%", "96 percent", "35 pct".
    {
      re: /([\d,]+(?:\.\d+)?)\s*(?:%|percent\b|pct\b)/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return { kind: "percent", value_numeric: n, value_text: m[0].trim(), unit: "%" };
      },
    },
    // Scaled square footage: "5 million square feet", "1.2 million SF". Runs
    // before the bare-money and plain-SF passes so the scale word is applied to
    // the magnitude (5,000,000 SF), not dropped or read as $5M.
    {
      re: /\b([\d,]+(?:\.\d+)?)\s+(million|billion|thousand|mm|bn|k)\s+(?:sq\.?\s?ft\.?|square\s?feet|square\s?foot|sf)\b/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return {
          kind: "sf",
          value_numeric: n * scaleMultiplier(m[2]),
          value_text: m[0].trim(),
          unit: "SF",
        };
      },
    },
    // Scaled unit counts: "2 thousand units", "1.5 million keys". Runs before the
    // plain-units pass, which would otherwise read the scale word as a descriptor
    // and capture the bare number ("5 million units" -> 5 instead of 5,000,000).
    {
      re: /\b([\d,]+(?:\.\d+)?)\s+(million|billion|thousand|mm|bn|k)\s+(?:(?!per\b)[a-z][a-z-]*\s+){0,2}(?:units|apartments|condos|keys|rooms|beds|stalls|spaces)\b/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return {
          kind: "units",
          value_numeric: n * scaleMultiplier(m[2]),
          value_text: m[0].trim(),
          unit: "units",
        };
      },
    },
    // Bare scaled money: "34.5 million" / "250M": only when the label denotes money AND
    // the scaled number is not naming a non-money quantity ("5 million square
    // feet", "2 thousand units", "5 million residents") - those would otherwise
    // be emitted as $5,000,000 and would also pre-empt the SF/units passes.
    {
      re: /\b([\d,]+(?:\.\d+)?)\s*(million|billion|thousand|mm|bn|m|b|k)\b(?!\s+(?:sq\b|square|sf\b|ft\b|feet|acres?|units?|keys?|rooms?|beds?|stalls?|spaces?|residents?|people|jobs|employees|tenants?|members?|households?|cars?|vehicles?))/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return {
          kind: "currency",
          value_numeric: n * scaleMultiplier(m[2]),
          value_text: m[0].trim(),
          unit: "$",
          __needsMoneyLabel: true,
        } as any;
      },
    },
    // Square footage: "18,000 SF", "32,000 square feet".
    {
      re: /([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s?ft\.?|square\s?feet|sf)\b/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return { kind: "sf", value_numeric: n, value_text: m[0].trim(), unit: "SF" };
      },
    },
    // Unit counts: "220 units", "220 residential units", "150 market-rate rental
    // apartments". Up to two descriptor words may sit between the number and the
    // noun (a very common prose phrasing the adjacent-only pattern missed). The
    // decimal group matches the siblings above so "220.5 units" captures 220.5,
    // not 5 (without it the engine skipped the "220." prefix and mis-read the
    // fractional digit).
    {
      re: /([\d,]+(?:\.\d+)?)\s*(?:(?!per\b)[a-z][a-z-]*\s+){0,2}(?:units|apartments|condos|keys|rooms|beds|stalls|spaces)\b/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        return { kind: "units", value_numeric: n, value_text: m[0].trim(), unit: "units" };
      },
    },
    // Durations: "30-year", "5 years", "12-month".
    {
      re: /([\d,]+(?:\.\d+)?)[-\s]*(years?|yrs?|months?|mos?)\b/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n)) return null;
        const unit = m[2].toLowerCase().startsWith("mo") ? "mo" : "yr";
        return { kind: "duration", value_numeric: n, value_text: m[0].trim(), unit };
      },
    },
    // Ratios: "1.20x" (DSCR / multiples). Reject implausibly large values.
    {
      re: /([\d,]+(?:\.\d+)?)\s*(?:x|×)\b/gi,
      handle: (m) => {
        const n = toNumber(m[1]);
        if (!isFinite(n) || n > 20) return null;
        return { kind: "ratio", value_numeric: n, value_text: m[0].trim(), unit: "x" };
      },
    },
    // Dates: "Q1 2027", "2027-03-01", "Mar 2027".
    {
      re: /\b(?:Q[1-4]\s?\d{4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s?\d{1,2}?,?\s?\d{4})\b/gi,
      handle: () => ({ kind: "date", value_numeric: null, value_text: "", unit: "date" }),
    },
  ];

  for (const pass of passes) {
    for (const m of text.matchAll(pass.re)) {
      const idx = m.index ?? 0;
      const end = idx + m[0].length;
      if (claims.overlaps(idx, end)) continue;
      const parsed = pass.handle(m);
      if (!parsed) continue;
      // Bare scaled money requires a money label nearby; otherwise drop it.
      if ((parsed as any).__needsMoneyLabel) {
        delete (parsed as any).__needsMoneyLabel;
        const left = labelHint(text, idx);
        const hint = `${left} ${contextAround(text, idx, m[0].length, 40)}`;
        if (!MONEY_LABEL_RE.test(hint)) continue;
        // "Phase 2b", "Exhibit 4k": the number is an item reference, not a
        // magnitude, even when a money word appears elsewhere on the line.
        if (ENUMERATOR_TRAILING_RE.test(left)) continue;
      }
      claims.claim(idx, end);
      const value_text = parsed.value_text || m[0].trim();
      push(idx, m[0].length, { ...parsed, value_text });
    }
  }

  // Stable order by document position so downstream ranking/labels are
  // deterministic across runs.
  out.sort((a, b) => a._idx - b._idx);
  return out.map(({ _idx, ...c }) => c);
}
