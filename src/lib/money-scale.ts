// Detects a declared "amounts in thousands / millions" scale from a sheet title,
// caption, or column header so raw spreadsheet numbers are read at their true
// dollar magnitude. CRE financial models routinely state every figure "in
// thousands" or "in millions" (a 34,500 land line that means $34,500,000); the
// extractor previously honored only an INLINE suffix like "$34.5M", so a clean,
// conventional spreadsheet was read 1000x too small and silently poisoned the
// whole underwriting. Only currency-anchored declarations rescale, so a "units
// in thousands" or "area in thousands of SF" note never touches a dollar column.
//
// Returns the multiplier (1, 1_000, 1_000_000, or 1_000_000_000); 1 means "no
// declared scale, use the number as written".
export function detectMoneyScale(text: string): number {
  const t = (text || "").toLowerCase();

  // Inherently currency-scoped compact notations: "$MM", "($000)", "'000s", etc.
  if (/\$\s*bn\b|\(\s*\$?\s*bn\s*\)/.test(t)) return 1_000_000_000;
  if (/\$\s*mm\b|\(\s*\$?\s*mm\s*\)|\bin\s+\$?\s*mm\b/.test(t)) return 1_000_000;
  if (/\(\s*\$?\s*0{3}s?\s*\)|['’]\s*0{3}s?\b|\bin\s+\$?\s*0{3}s?\b|\$\s*0{3}s?\b/.test(t))
    return 1_000;

  // Long form ("in thousands", "(millions)", "stated in millions"): accepted
  // only when the text is clearly about money, so a non-currency column is never
  // rescaled.
  const currencyAnchored =
    /\$|usd|cad|dollar|amount|figure|cost|budget|loan|equity|capital|price|proceeds|value|noi|revenue|financing/.test(
      t,
    );
  if (!currencyAnchored) return 1;

  const m =
    /(?:\b(?:in|amounts?\s+in|figures?\s+in|stated\s+in|expressed\s+in|reported\s+in|shown\s+in)\s+\$?\s*|\(\s*\$?\s*)(thousand|million|billion)s?\b/.exec(
      t,
    );
  if (m) {
    if (m[1] === "billion") return 1_000_000_000;
    if (m[1] === "million") return 1_000_000;
    return 1_000;
  }
  return 1;
}
