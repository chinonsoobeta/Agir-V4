// Corpus anonymizer: turn a real customer document into a shareable fixture by
// scrubbing personally-identifying and account-identifying tokens while
// PRESERVING the financial structure that makes the corpus useful for
// extraction testing -- dollar amounts, percentages, multiples, unit counts and
// dates are left intact on purpose. Replacement is deterministic (same input +
// salt -> same pseudonym) so cross-references inside and across documents stay
// consistent (e.g. "Acme Capital" maps to the same alias everywhere).
//
// This is a pragmatic, rules-based scrubber, not a guaranteed de-identifier:
// it has no named-entity model, so free-text person/org names must be supplied
// via `namedEntities`. Always review output before sharing externally.

export type AnonymizeOptions = {
  /** Stable salt so pseudonyms differ per corpus but repeat within it. */
  salt?: string;
  /** Literal names/orgs to pseudonymize (case-insensitive, whole-word). */
  namedEntities?: string[];
};

export type Replacement = {
  kind: "email" | "phone" | "ssn" | "ein" | "account" | "address" | "entity";
  original: string;
  replacement: string;
};

export type AnonymizeResult = {
  text: string;
  replacements: Replacement[];
};

// Small, dependency-free FNV-1a hash -> short base36 code. Deterministic across
// runs and platforms (no Math.random), which the fixture pipeline relies on.
function shortCode(value: string, salt: string, len = 4): string {
  let h = 0x811c9dc5;
  const s = `${salt}:${value.toLowerCase()}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(len, "0").slice(0, len);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Order matters: most-specific patterns first so a phone-shaped SSN, etc. is
// classified once. Each entry replaces all matches with a stable token.
const PATTERNS: {
  kind: Replacement["kind"];
  re: RegExp;
  label: (m: string, code: string) => string;
}[] = [
  {
    kind: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    label: (_m, code) => `user-${code}@redacted.example`,
  },
  {
    kind: "ssn",
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
    label: () => "[SSN-REDACTED]",
  },
  {
    kind: "ein",
    re: /\b\d{2}-\d{7}\b/g,
    label: () => "[EIN-REDACTED]",
  },
  {
    // Account/loan/tax identifiers, only when explicitly labelled, so we never
    // touch a dollar figure or unit count that happens to be a long number.
    kind: "account",
    re: /\b(account|acct|loan|policy|tax\s?id|routing|iban)\b([#:\s.-]*)([A-Za-z0-9-]{6,})/gi,
    label: (m, code) => m.replace(/([A-Za-z0-9-]{6,})\s*$/, `ACCT-${code}`),
  },
  {
    kind: "phone",
    re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    label: (_m, code) =>
      `(555) 01${code.replace(/[^0-9]/g, "0").slice(0, 1)}-${code
        .slice(0, 4)
        .replace(/[^0-9]/g, "0")
        .padStart(4, "0")}`,
  },
  {
    // US-style street address: number + street name + suffix. Heuristic.
    kind: "address",
    re: /\b\d{1,6}\s+([A-Z][a-z]+\s){1,3}(Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/g,
    label: () => "[ADDRESS-REDACTED]",
  },
];

export function anonymizeText(input: string, opts: AnonymizeOptions = {}): AnonymizeResult {
  const salt = opts.salt ?? "agir-corpus";
  const replacements: Replacement[] = [];
  let text = input;

  // Caller-supplied named entities first (longest-first so "Acme Capital LLC"
  // is replaced before "Acme"), each mapped to a stable alias.
  const entities = [...(opts.namedEntities ?? [])].sort((a, b) => b.length - a.length);
  for (const entity of entities) {
    if (!entity.trim()) continue;
    const re = new RegExp(`\\b${escapeRegExp(entity)}\\b`, "gi");
    const code = shortCode(entity, salt);
    const replacement = `Entity-${code}`;
    if (re.test(text)) {
      text = text.replace(re, replacement);
      replacements.push({ kind: "entity", original: entity, replacement });
    }
  }

  for (const p of PATTERNS) {
    text = text.replace(p.re, (m) => {
      const code = shortCode(m, salt);
      const replacement = p.label(m, code);
      replacements.push({ kind: p.kind, original: m, replacement });
      return replacement;
    });
  }

  return { text, replacements };
}

// Quick audit helper: does any obvious PII survive? Returns the categories still
// present so the pipeline can fail closed before a fixture is shared.
export function residualPii(text: string): Replacement["kind"][] {
  const found = new Set<Replacement["kind"]>();
  for (const p of PATTERNS) {
    if (p.kind === "account") continue; // requires a label; low false-negative cost
    p.re.lastIndex = 0;
    if (p.re.test(text)) found.add(p.kind);
  }
  return [...found];
}
