import { isMissingRelation } from "./db-compat";
import { emitOperationalMetric } from "./observability.server";

export type RateLimitBucket =
  | "document_upload"
  | "document_analysis"
  | "underwriting_run"
  | "report_generation"
  | "signed_document_url"
  | "chat_completion"
  | "scim_operation"
  | "workspace_invitation";

export const RATE_LIMIT_POLICY: Record<
  RateLimitBucket,
  { maxEvents: number; windowSeconds: number; description: string }
> = {
  document_upload: {
    maxEvents: 200,
    windowSeconds: 24 * 60 * 60,
    description: "Uploaded documents per user per 24 hours.",
  },
  document_analysis: {
    maxEvents: 80,
    windowSeconds: 60 * 60,
    description: "AI/OCR document analyses per user per hour.",
  },
  underwriting_run: {
    maxEvents: 120,
    windowSeconds: 60 * 60,
    description: "Full underwriting runs per user per hour.",
  },
  report_generation: {
    maxEvents: 60,
    windowSeconds: 60 * 60,
    description: "Report generation/export requests per user per hour.",
  },
  signed_document_url: {
    maxEvents: 180,
    windowSeconds: 60 * 60,
    description: "Signed document URL requests per user per hour.",
  },
  chat_completion: {
    maxEvents: 120,
    windowSeconds: 60 * 60,
    description: "Chat completion requests per user per hour.",
  },
  scim_operation: {
    maxEvents: 200,
    windowSeconds: 60 * 60,
    description: "SCIM provisioning operations per workspace per hour.",
  },
  workspace_invitation: {
    maxEvents: 50,
    windowSeconds: 24 * 60 * 60,
    description: "Workspace invitations per user per 24 hours.",
  },
};

export type RateLimitContext = {
  supabase: any;
  userId: string;
};

export async function enforceRateLimit(
  ctx: RateLimitContext,
  bucket: RateLimitBucket,
  opts: { cost?: number; workspaceId?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  const policy = RATE_LIMIT_POLICY[bucket];
  const cost = opts.cost ?? 1;
  const since = new Date(Date.now() - policy.windowSeconds * 1000).toISOString();
  const { data, error } = await ctx.supabase
    .from("rate_limit_events")
    .select("cost")
    .eq("owner_id", ctx.userId)
    .eq("bucket", bucket)
    .gte("created_at", since);
  if (isMissingRelation(error)) return;
  if (error) throw new Error(error.message);

  const used = ((data ?? []) as Array<{ cost: number | null }>).reduce(
    (sum: number, row: { cost: number | null }) => sum + Number(row.cost ?? 1),
    0,
  );
  if (used + cost > policy.maxEvents) {
    emitOperationalMetric("rate_limit.blocked", 1, {
      bucket,
      userId: ctx.userId,
      windowSeconds: policy.windowSeconds,
    });
    throw new Error(
      `Rate limit reached for ${bucket.replaceAll("_", " ")}. Try again later or contact your workspace administrator.`,
    );
  }

  const insert = await ctx.supabase.from("rate_limit_events").insert({
    owner_id: ctx.userId,
    workspace_id: opts.workspaceId ?? null,
    bucket,
    cost,
    metadata: opts.metadata ?? {},
  });
  if (isMissingRelation(insert.error)) return;
  if (insert.error) throw new Error(insert.error.message);
}
