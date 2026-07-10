import {
  handleSchemaCompatibilityFallback,
  isMissingFunction,
  isMissingRelation,
} from "./db-compat";
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
  if (!Number.isInteger(cost) || cost < 1) throw new Error("Invalid rate-limit cost.");

  // Postgres serializes each (user, bucket) decision under an advisory lock,
  // then records consumption in the same transaction. Never turn this into a
  // client-side SELECT + INSERT: concurrent requests would both observe the
  // same remaining capacity and oversubscribe the control.
  const rateLimitArgs = {
    p_bucket: bucket,
    p_cost: cost,
    p_max_events: policy.maxEvents,
    p_window_seconds: policy.windowSeconds,
    p_metadata: opts.metadata ?? {},
    ...(opts.workspaceId ? { p_workspace_id: opts.workspaceId } : {}),
  };
  const { data: allowed, error } = await ctx.supabase.rpc("consume_rate_limit", rateLimitArgs);
  if (isMissingFunction(error) || isMissingRelation(error)) {
    return handleSchemaCompatibilityFallback(error, {
      featureName: "atomic rate limiting",
      table: "rate_limit_events",
      operation: `consume ${bucket}`,
      // Demo/test compatibility is intentionally explicit. Production and
      // staging reject a missing RPC through db-compat's strict mode.
      fallback: undefined,
    });
  }
  if (error) throw new Error(`Unable to enforce rate limit: ${error.message}`);
  if (!allowed) {
    emitOperationalMetric("rate_limit.blocked", 1, {
      bucket,
      userId: ctx.userId,
      windowSeconds: policy.windowSeconds,
    });
    throw new Error(
      `Rate limit reached for ${bucket.replaceAll("_", " ")}. Try again later or contact your workspace administrator.`,
    );
  }
}
