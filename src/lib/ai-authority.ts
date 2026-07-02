export const AI_ASSISTED_ALIAS = "(ai)";

export const AI_AUTHORITY_NOTE =
  "Deterministic underwriting authority: approved assumptions and engine logic own final numbers.";

export function aiClassificationReasoning(args: {
  candidateLabel?: string | null;
  modelReasoning?: string | null;
}) {
  const source = args.candidateLabel ? ` Candidate: ${args.candidateLabel}.` : "";
  const reasoning = args.modelReasoning ? ` Model note: ${args.modelReasoning}` : "";
  return `AI-assisted classification only: the model selected a canonical field for a pre-extracted document candidate. The value remains the source token and requires analyst approval before underwriting.${source}${reasoning}`;
}

export function isAiAssistedReasoning(value: unknown): boolean {
  return typeof value === "string" && value.includes("AI-assisted classification only");
}

export function aiFallbackNote(feature: string, reason: string) {
  return `AI unavailable for ${feature}: deterministic mode used (${reason}).`;
}
