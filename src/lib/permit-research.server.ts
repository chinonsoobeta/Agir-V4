import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type PermitResearchScope = "case" | "project";

type PermitResearchDocument = {
  id: string;
  owner_id: string | null;
  project_id: string | null;
  permit_case_id: string | null;
  name: string;
  file_type: string | null;
  storage_path: string;
  size_bytes: number | null;
  scan_status: string | null;
  status: string | null;
};

export function assertPermitResearchDocumentReady(
  document: Pick<PermitResearchDocument, "scan_status" | "status">,
) {
  if (
    document.scan_status !== "clean" ||
    !["uploaded", "analyzed"].includes(document.status ?? "")
  ) {
    throw new Error("Finish document verification before looking for Permit clues.");
  }
}

/** Worker-safe deterministic Permit research. The source document has already
 * passed the staged upload scanner. Candidates remain review-only evidence. */
export async function executePermitDocumentResearch(
  supabase: SupabaseClient<Database> | any,
  document: PermitResearchDocument,
  scope: PermitResearchScope,
  requestedBy = document.owner_id,
  assertCanPersist: () => Promise<void> = async () => undefined,
) {
  await assertCanPersist();
  if (!requestedBy) throw new Error("A current requesting user is required for Permit research.");
  assertPermitResearchDocumentReady(document);
  const parentId = scope === "case" ? document.permit_case_id : document.project_id;
  if (!parentId) throw new Error(`Document is not linked to the requested Permit ${scope}.`);

  const { downloadDocumentBlob } = await import("./storage-download.server");
  const download = await downloadDocumentBlob(supabase, document.storage_path);
  if (download.error || !download.data)
    throw new Error("The verified source document could not be read.");

  const { extractFileTextWithMeta } = await import("./document-text.server");
  const extracted = await extractFileTextWithMeta(
    document.name,
    document.file_type,
    await download.data.arrayBuffer(),
  );
  const { extractPermitResearchCandidates } = await import("./permit-domain");
  const candidates = extractPermitResearchCandidates(extracted.text);
  if (!candidates.length) return { created: 0, candidateCount: 0 };

  await assertCanPersist();
  const recorded = await supabase.rpc("record_permit_research_candidates", {
    p_document_id: document.id,
    p_scope: scope,
    p_requested_by: requestedBy,
    p_candidates: candidates.map((candidate) => ({
      candidate_name: candidate.candidateName,
      permit_type: candidate.permitType,
      description: candidate.description,
      source_location: candidate.sourceLocation,
      source_text: candidate.sourceText,
      confidence_score: extracted.recoveredViaOcr
        ? Math.min(candidate.confidenceScore, (extracted.ocrConfidence ?? 0) / 100)
        : candidate.confidenceScore,
    })),
  });
  if (recorded.error) throw new Error(recorded.error.message);
  return recorded.data as { created: number; candidateCount: number };
}

export async function requestPermitDocumentResearch(
  context: { supabase: any; userId: string },
  document: PermitResearchDocument,
  scope: PermitResearchScope,
) {
  assertPermitResearchDocumentReady(document);
  const { enforceRateLimit } = await import("./rate-limit.server");
  await enforceRateLimit(context, "document_analysis", {
    metadata: { document_id: document.id, feature: "permit_research" },
  });
  const { getServerConfig } = await import("./config.server");
  const config = getServerConfig();
  if (config.asyncExtraction) getServerConfig(["worker"]);
  const { claimJob, completeJob, failJob, isInlineJob } = await import("./extraction-jobs.server");
  const kind = scope === "case" ? "permit_case_research" : "permit_project_research";
  const { job, existed } = await claimJob(context, {
    kind,
    idempotencyKey: `permit-research-${scope}-v1:${document.id}`,
    projectId: document.project_id,
    documentId: document.id,
    message: "Looking for sourced Permit clues",
    enqueue: config.asyncExtraction,
  });
  if (existed && job.status === "completed") {
    return {
      queued: false as const,
      job_id: job.id,
      ...((job.result_json as { created?: number; candidateCount?: number }) ?? {}),
    };
  }
  if (config.asyncExtraction && !isInlineJob(job)) {
    if (["failed", "canceled", "dead_lettered"].includes(job.status)) {
      const retry = await context.supabase
        .from("extraction_jobs")
        .update({
          status: "queued",
          progress: 0,
          error: null,
          finished_at: null,
          attempts: 0,
          lease_owner: null,
          lease_expires_at: null,
          cancellation_requested: false,
        })
        .eq("id", job.id);
      if (retry.error) throw new Error(retry.error.message);
    }
    return { queued: true as const, job_id: job.id, created: 0, candidateCount: 0 };
  }

  // Development-only inline execution stays bounded. Production and staging
  // always use the durable worker path above.
  if ((document.size_bytes ?? 0) > 20 * 1024 * 1024) {
    throw new Error("This document requires the asynchronous extraction worker.");
  }
  try {
    const { getServiceRoleClient } = await import("@/integrations/supabase/service-role.server");
    const result = await executePermitDocumentResearch(
      getServiceRoleClient("permit_research_worker"),
      document,
      scope,
      context.userId,
    );
    await completeJob(context, job.id, result);
    return { queued: false as const, job_id: job.id, ...result };
  } catch (error) {
    await failJob(
      context,
      job.id,
      error instanceof Error ? error.message : "Permit document research failed.",
    );
    throw error;
  }
}
