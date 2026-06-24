// Deal activity timeline: institutional memory.
//
// A deal's history already lives across several tables (operational activities,
// the immutable financial audit log, committee decisions, documents, generated
// reports, milestones). This module maps each source into ONE labeled,
// chronological event stream. It is pure read-side parsing/labeling: it never
// creates or alters a financial value, and it tolerates any source being
// absent. The React layer adds icons/colour per category.

export type TimelineCategory =
  | "deal"
  | "document"
  | "assumption"
  | "underwriting"
  | "decision"
  | "milestone"
  | "report"
  | "integration"
  | "memo";

export type TimelineEvent = {
  id: string;
  category: TimelineCategory;
  title: string;
  detail: string | null;
  actor: string | null;
  at: string; // ISO timestamp
};

const DECISION_LABEL: Record<string, string> = {
  approve: "Approved",
  approve_with_conditions: "Approved with conditions",
  reject: "Rejected",
  return_to_underwriting: "Returned to underwriting",
};

// activity_type -> {category, friendly title}. Unknown types fall back to a
// title-cased version of the raw type so nothing is silently dropped.
const ACTIVITY_MAP: Record<string, { category: TimelineCategory; title: string }> = {
  project_created: { category: "deal", title: "Deal created" },
  memo_generated: { category: "memo", title: "Memo generated" },
  report_generated: { category: "report", title: "Report generated" },
  integration_connection: { category: "integration", title: "Integration updated" },
  document_uploaded: { category: "document", title: "Document uploaded" },
  underwriting_run: { category: "underwriting", title: "Underwriting run" },
};

// audit_logs.action -> {category, friendly title}. The audit log is the
// financial provenance trail (fail-closed actions).
const AUDIT_MAP: Record<string, { category: TimelineCategory; title: string }> = {
  run_full_underwriting: { category: "underwriting", title: "Underwriting run" },
  ai_accept_defaults: { category: "assumption", title: "Defaults accepted (AI-assisted)" },
  accept_defaults: { category: "assumption", title: "Defaults accepted" },
  resolve_conflict: { category: "assumption", title: "Conflict resolved" },
  extract_assumptions: { category: "assumption", title: "Assumptions extracted" },
  ic_decision: { category: "decision", title: "Committee decision recorded" },
  assumption_approved: { category: "assumption", title: "Assumption approved" },
  assumption_modified: { category: "assumption", title: "Assumption modified" },
  assumption_rejected: { category: "assumption", title: "Assumption rejected" },
};

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type RawSources = {
  activities?:
    | { id?: string; activity_type: string; description: string | null; created_at: string }[]
    | null;
  audit?:
    | {
        id?: string;
        action: string;
        entity_type?: string | null;
        payload?: any;
        user_name?: string | null;
        created_at: string;
      }[]
    | null;
  decisions?:
    | {
        id?: string;
        decision: string;
        rationale: string | null;
        conditions?: string | null;
        user_name: string | null;
        created_at: string;
      }[]
    | null;
  documents?: { id?: string; name: string; category?: string | null; upload_date: string }[] | null;
  reports?:
    | { id?: string; report_type: string; title: string | null; generated_at: string }[]
    | null;
  milestones?:
    | {
        id?: string;
        title: string;
        status: string;
        completed_at: string | null;
        created_at?: string;
      }[]
    | null;
};

export function mapTimeline(src: RawSources): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const a of src.activities ?? []) {
    const m = ACTIVITY_MAP[a.activity_type] ?? {
      category: "deal" as TimelineCategory,
      title: titleCase(a.activity_type),
    };
    // The integration fallback stores JSON in description: don't dump raw JSON.
    const detail = a.activity_type === "integration_connection" ? null : a.description;
    events.push({
      id: a.id ?? `act:${a.created_at}:${a.activity_type}`,
      category: m.category,
      title: m.title,
      detail,
      actor: null,
      at: a.created_at,
    });
  }

  for (const a of src.audit ?? []) {
    const m = AUDIT_MAP[a.action] ?? {
      category: "deal" as TimelineCategory,
      title: titleCase(a.action),
    };
    let detail: string | null = null;
    if (a.payload && typeof a.payload === "object") {
      if (a.action === "run_full_underwriting" && a.payload.verdict)
        detail = `Verdict ${a.payload.verdict}${a.payload.risk_score != null ? ` · risk ${a.payload.risk_score}` : ""}`;
      else if (a.action === "accept_defaults" && Array.isArray(a.payload.accepted))
        detail = `${a.payload.accepted.length} default(s) accepted`;
      else if (a.action === "resolve_conflict" && a.payload.key)
        detail = `Resolved ${a.payload.key}`;
    }
    events.push({
      id: a.id ?? `aud:${a.created_at}:${a.action}`,
      category: m.category,
      title: m.title,
      detail,
      actor: a.user_name ?? null,
      at: a.created_at,
    });
  }

  for (const d of src.decisions ?? []) {
    events.push({
      id: d.id ?? `dec:${d.created_at}`,
      category: "decision",
      title: `Committee: ${DECISION_LABEL[d.decision] ?? titleCase(d.decision)}`,
      detail: d.rationale ?? d.conditions ?? null,
      actor: d.user_name ?? null,
      at: d.created_at,
    });
  }

  for (const doc of src.documents ?? []) {
    events.push({
      id: doc.id ?? `doc:${doc.upload_date}:${doc.name}`,
      category: "document",
      title: `Document uploaded: ${doc.name}`,
      detail: doc.category ?? null,
      actor: null,
      at: doc.upload_date,
    });
  }

  for (const r of src.reports ?? []) {
    events.push({
      id: r.id ?? `rep:${r.generated_at}`,
      category: "report",
      title: `Report generated: ${r.title ?? titleCase(r.report_type)}`,
      detail: null,
      actor: null,
      at: r.generated_at,
    });
  }

  for (const m of src.milestones ?? []) {
    if (m.status === "complete" && m.completed_at) {
      events.push({
        id: m.id ? `ms:${m.id}` : `ms:${m.completed_at}`,
        category: "milestone",
        title: `Milestone completed: ${m.title}`,
        detail: null,
        actor: null,
        at: m.completed_at,
      });
    }
  }

  // Newest first; stable on ties by id.
  return events
    .filter((e) => e.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}
