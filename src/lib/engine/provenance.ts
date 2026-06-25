// Output provenance verifier: every numeric token in a rendered underwriting
// surface or generated memo must be (a) an approved/default_accepted/calculated
// input, (b) an engine output, or (c) a pure function of those supplied by the
// caller. Any orphan number fails verification -- this is the structural
// guarantee that a synthesized figure cannot reach a screen silently.

export type TokenUnit = "$" | "%" | "x" | "bps";

export type NumericToken = {
  raw: string;
  value: number;
  // half-unit of the least significant displayed digit (e.g. "2.45" -> 0.005)
  tolerance: number;
  // The unit the token is written in, inferred from its suffix / $ sign.
  unit?: TokenUnit;
};

// An allowed value is either a bare number (unit-agnostic: validates a token of
// the same magnitude regardless of unit, the original behavior) or a value
// carrying a unit. A unit-tagged value only validates a token of a COMPATIBLE
// unit, so a fabricated "5.25%" can no longer be waved through by an unrelated
// $5.25 sitting in the allowed set. Callers tag the values whose unit is known
// ($ cash flows, % / x / bps outputs) and leave the rest untyped, so a
// legitimate rate is never falsely orphaned.
export type AllowedValue = number | { value: number; unit?: TokenUnit };

export type ProvenanceReport = {
  tokenCount: number;
  orphans: NumericToken[];
  pass: boolean;
};

const TOKEN_RE =
  /(\$\s?)?(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s?(%|bps|×|x\b|million\b|mm\b|bn\b|M\b|B\b|k\b|K\b)?/g;

function suffixMultiplier(suffix: string | undefined, hasDollar: boolean): number {
  if (!suffix) return 1;
  const s = suffix.trim();
  if (s === "million" || s === "mm" || s === "M") return 1_000_000;
  if (s === "bn" || s === "B") return 1_000_000_000;
  if ((s === "k" || s === "K") && hasDollar) return 1_000;
  return 1;
}

export function collectNumericTokens(text: string): NumericToken[] {
  const out: NumericToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const hasDollar = Boolean(m[1]);
    const numeric = m[2];
    const suffix = m[3];
    const base = Number(numeric.replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const multiplier = suffixMultiplier(suffix, hasDollar);
    const value = base * multiplier;
    // Implicitly allowed: small counts/ordinals (0..12) and calendar years.
    const isInt = Number.isInteger(base) && !numeric.includes(".");
    if (multiplier === 1 && isInt && Math.abs(base) <= 12) continue;
    if (multiplier === 1 && isInt && base >= 1900 && base <= 2100) continue;
    const decimals = numeric.includes(".") ? numeric.split(".")[1].length : 0;
    const tolerance = 0.5 * Math.pow(10, -decimals) * multiplier;
    const unit: TokenUnit | undefined =
      suffix === "%"
        ? "%"
        : suffix === "bps"
          ? "bps"
          : suffix === "×" || suffix === "x"
            ? "x"
            : hasDollar || multiplier !== 1
              ? "$"
              : undefined;
    out.push({ raw: m[0].trim(), value, tolerance, unit });
  }
  return out;
}

export function buildAllowedValues(...groups: (number | null | undefined)[][]): number[] {
  const out: number[] = [];
  for (const group of groups) {
    for (const v of group) {
      if (v == null || !Number.isFinite(v)) continue;
      out.push(v, -v);
    }
  }
  return out;
}

function tokenMatches(token: NumericToken, allowed: AllowedValue[]): boolean {
  return allowed.some((entry) => {
    const value = typeof entry === "number" ? entry : entry.value;
    const unit = typeof entry === "number" ? undefined : entry.unit;
    // Unit gate: a unit-tagged allowed value only validates a token written in
    // the same unit. An untyped allowed value (or an untyped token) stays
    // permissive, so a legitimate figure is never falsely orphaned.
    if (unit != null && token.unit != null && unit !== token.unit) return false;
    return Math.abs(token.value - value) <= Math.max(token.tolerance, Math.abs(value) * 1e-9);
  });
}

export function verifyNumericProvenance(text: string, allowed: AllowedValue[]): ProvenanceReport {
  const tokens = collectNumericTokens(text);
  const orphans = tokens.filter((t) => !tokenMatches(t, allowed));
  return { tokenCount: tokens.length, orphans, pass: orphans.length === 0 };
}
