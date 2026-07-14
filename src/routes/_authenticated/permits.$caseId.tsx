import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  assignPermitCase,
  extractPermitCaseDocumentCandidates,
  generateCasePermitCandidates,
  getPermitCase,
  getPermitCaseCollaboration,
  listAttachableProjects,
  listPermitCaseExtractionCandidates,
  reviewPermitCaseExtractionCandidate,
  respondPermitCaseHandoff,
  setPermitCaseArchived,
  setPermitCaseProject,
  startPermitCaseHandoff,
  transferPermitCaseToWorkspace,
} from "@/lib/permit-cases.functions";
import { listWorkspaceMembers } from "@/lib/workspaces.functions";
import {
  getDocumentUrl,
  getExtractionJobStatus,
  listPermitCaseDocuments,
} from "@/lib/documents.functions";
import { DocumentDropzone } from "@/components/document-dropzone";
import { HistoryStateDiff } from "@/components/history-state-diff";
import { PERMIT_LIMITATIONS_TEXT } from "@/lib/permit-limitations";
import { UNKNOWN_DURATION, UNKNOWN_REQUIREMENT } from "@/lib/permits.functions";
import { PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/lib/workspace-context";
import { PERSONAL_WORKSPACE_ID } from "@/lib/workspaces.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Archive,
  Download,
  ExternalLink,
  FileQuestion,
  History,
  Link2,
  Plus,
  RotateCcw,
  Send,
  UserRoundCheck,
  ShieldCheck,
} from "lucide-react";
export const Route = createFileRoute("/_authenticated/permits/$caseId")({
  component: PermitCaseWorkspace,
});
const label = (s: string) => s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
function PermitCaseWorkspace() {
  const { caseId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { workspaces } = useWorkspace();
  const caseQ = useQuery({
    queryKey: ["permit-case", caseId],
    queryFn: () => getPermitCase({ data: { id: caseId } }),
  });
  const c = caseQ.data;
  const documentsQ = useQuery({
    queryKey: ["permit-case-documents", caseId],
    queryFn: () => listPermitCaseDocuments({ data: { permit_case_id: caseId } }),
  });
  const documents = documentsQ.data ?? [];
  const extractionCandidatesQ = useQuery({
    queryKey: ["permit-case-extraction-candidates", caseId],
    queryFn: () => listPermitCaseExtractionCandidates({ data: { case_id: caseId } }),
  });
  const extractionCandidates = extractionCandidatesQ.data ?? [];
  const projectsQ = useQuery({
    queryKey: ["permit-attachable-projects", c?.workspace_id],
    queryFn: () => listAttachableProjects({ data: { workspace_id: c?.workspace_id ?? null } }),
    enabled: Boolean(c),
  });
  const projects = projectsQ.data ?? [];
  const collaborationQ = useQuery({
    queryKey: ["permit-case-collaboration", caseId],
    queryFn: () => getPermitCaseCollaboration({ data: { case_id: caseId } }),
  });
  const collaboration = collaborationQ.data;
  const membersQ = useQuery({
    queryKey: ["permit-case-members", c?.workspace_id],
    queryFn: () => listWorkspaceMembers({ data: { workspace_id: c!.workspace_id } }),
    enabled: Boolean(c?.workspace_id),
  });
  const members = membersQ.data ?? [];
  const [linkOpen, setLinkOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [transferWorkspaceId, setTransferWorkspaceId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [projectId, setProjectId] = useState("");
  const [linkReason, setLinkReason] = useState("");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [responsibility, setResponsibility] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const [candidateReasons, setCandidateReasons] = useState<Record<string, string>>({});
  const [researchJobId, setResearchJobId] = useState<string | null>(null);
  const { data: researchJob } = useQuery({
    queryKey: ["permit-research-job", researchJobId],
    queryFn: () => getExtractionJobStatus({ data: { id: researchJobId! } }),
    enabled: Boolean(researchJobId),
    refetchInterval: (query) =>
      ["queued", "running"].includes((query.state.data as any)?.status) ? 2_000 : false,
  });
  useEffect(() => {
    if (!researchJobId || !researchJob) return;
    if (researchJob.status === "completed") {
      const result = (researchJob.result_json ?? {}) as {
        created?: number;
        candidateCount?: number;
      };
      qc.invalidateQueries({ queryKey: ["permit-case-extraction-candidates", caseId] });
      toast.success(
        result.candidateCount
          ? `${result.candidateCount} sourced document clue${result.candidateCount === 1 ? " is" : "s are"} ready to review.`
          : "No sourced Permit clues were found in the document.",
      );
      setResearchJobId(null);
    } else if (["failed", "dead_lettered", "canceled"].includes(researchJob.status)) {
      toast.error(researchJob.error || "Permit document research did not complete.");
      setResearchJobId(null);
    }
  }, [caseId, qc, researchJob, researchJobId]);
  const linkProject = useMutation({
    mutationFn: () =>
      setPermitCaseProject({
        data: {
          case_id: caseId,
          project_id: projectId || null,
          expected_version: c?.row_version ?? 0,
          reason: linkReason,
        },
      }),
    onSuccess: () => {
      setLinkOpen(false);
      setLinkReason("");
      qc.invalidateQueries({ queryKey: ["permit-case", caseId] });
    },
  });
  const transfer = useMutation({
    mutationFn: () =>
      transferPermitCaseToWorkspace({
        data: { case_id: caseId, workspace_id: transferWorkspaceId, reason: transferReason },
      }),
    onSuccess: () => {
      setShareOpen(false);
      setTransferReason("");
      qc.invalidateQueries({ queryKey: ["permit-case", caseId] });
      qc.invalidateQueries({ queryKey: ["permit-cases"] });
    },
  });
  const archiveCase = useMutation({
    mutationFn: () =>
      setPermitCaseArchived({
        data: {
          case_id: caseId,
          archived: !c?.archived_at,
          reason: archiveReason,
        },
      }),
    onSuccess: () => {
      setArchiveOpen(false);
      setArchiveReason("");
      qc.invalidateQueries({ queryKey: ["permit-case", caseId] });
      qc.invalidateQueries({ queryKey: ["permit-cases"] });
    },
  });
  const [view, setView] = useState<"guided" | "professional">(() =>
    localStorage.getItem("agir-permit-view") === "professional" ? "professional" : "guided",
  );
  const generate = useMutation({
    mutationFn: () => generateCasePermitCandidates({ data: { case_id: caseId } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["permit-case", caseId] });
      toast.success(
        r.created
          ? `${r.created} possible approvals added for review.`
          : `No new approval types were found for ${r.jurisdiction}.`,
      );
    },
  });
  const extractDocument = useMutation({
    mutationFn: (documentId: string) =>
      extractPermitCaseDocumentCandidates({ data: { case_id: caseId, document_id: documentId } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["permit-case-extraction-candidates", caseId] });
      if (result.queued) {
        setResearchJobId(result.job_id);
        toast.success("Document research queued. You can keep working while it runs.");
      } else {
        toast.success(
          result.candidateCount
            ? `${result.candidateCount} sourced document clue${result.candidateCount === 1 ? " is" : "s are"} ready to review.`
            : "No sourced Permit clues were found in the document.",
        );
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const reviewExtraction = useMutation({
    mutationFn: (input: { id: string; decision: "accepted" | "rejected"; reason: string }) =>
      reviewPermitCaseExtractionCandidate({ data: input }),
    onSuccess: (_result, input) => {
      setCandidateReasons((current) => ({ ...current, [input.id]: "" }));
      qc.invalidateQueries({ queryKey: ["permit-case-extraction-candidates", caseId] });
      qc.invalidateQueries({ queryKey: ["permit-case", caseId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const refreshCollaboration = () =>
    qc.invalidateQueries({ queryKey: ["permit-case-collaboration", caseId] });
  const assign = useMutation({
    mutationFn: () =>
      assignPermitCase({
        data: {
          case_id: caseId,
          assignee_id: collaboratorId,
          responsibility,
        },
      }),
    onSuccess: () => {
      setResponsibility("");
      refreshCollaboration();
    },
  });
  const handoff = useMutation({
    mutationFn: () =>
      startPermitCaseHandoff({
        data: { case_id: caseId, to_user_id: collaboratorId, note: handoffNote },
      }),
    onSuccess: () => {
      setHandoffNote("");
      refreshCollaboration();
    },
  });
  const respondHandoff = useMutation({
    mutationFn: (data: { handoff_id: string; status: "accepted" | "rejected" }) =>
      respondPermitCaseHandoff({ data }),
    onSuccess: refreshCollaboration,
  });
  if (caseQ.isLoading)
    return (
      <PageBody>
        <p role="status">Loading permit case…</p>
      </PageBody>
    );
  if (caseQ.isError || !c)
    return (
      <PageBody>
        <QueryErrorCard
          title="Permit case could not be opened"
          error={caseQ.error}
          onRetry={() => caseQ.refetch()}
        />
        <Button asChild variant="outline">
          <Link to="/permits">Back to permit cases</Link>
        </Button>
      </PageBody>
    );
  const rawPermits = c.project_permits ?? [];
  const permitGroups = new Map<string, any[]>();
  for (const permit of rawPermits) {
    const key = permit.permit_type || `record:${permit.id}`;
    permitGroups.set(key, [...(permitGroups.get(key) ?? []), permit]);
  }
  const permits = [...permitGroups.values()]
    .map((records) => {
      const ordered = [...records].sort(comparePermitEvidence);
      return { ...ordered[0], _records: ordered };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const permitRecords = permits.flatMap((permit: any) => permit._records);
  const requirements = permitRecords.flatMap((p: any) =>
    (p.permit_requirements ?? []).map((r: any) => ({ ...r, permit: p.name })),
  );
  const unresolved = permitRecords.filter((p: any) =>
    ["unknown", "needs_review", "potentially_required"].includes(p.applicability_status),
  );
  const caseWorkspace = c.workspace_id
    ? workspaces.find((workspace) => workspace.id === c.workspace_id)
    : null;
  const canWrite = c.workspace_id
    ? Boolean(caseWorkspace && caseWorkspace.role !== "viewer")
    : c.owner_id === user.id;
  const canEdit = canWrite && !c.archived_at;
  const eligibleCollaborators = members.filter((member) => member.role !== "viewer");
  const timeline = [
    ...(c.permit_case_history ?? []).map((event: any) => ({
      id: `case:${event.id}`,
      at: event.changed_at,
      actor: event.changed_by,
      title: historyLabel(event.action),
      reason: event.reason,
      detail: caseHistoryDetail(event),
      before: event.previous_data,
      after: event.new_data,
      metadata: null,
    })),
    ...permitRecords.flatMap((permit: any) =>
      (permit.permit_history ?? []).map((event: any) => ({
        id: `permit:${event.id}`,
        at: event.changed_at,
        actor: event.changed_by,
        title: `${permit.name} updated`,
        reason: event.change_reason,
        detail: permitHistoryDetail(event),
        before: {
          applicability_status: event.previous_applicability_status,
          workflow_status: event.previous_status,
        },
        after: {
          applicability_status: event.new_applicability_status,
          workflow_status: event.new_status,
        },
        metadata: {
          source_document_id: event.source_document_id,
          source_text: event.source_text,
        },
      })),
    ),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const changeView = (v: "guided" | "professional") => {
    setView(v);
    localStorage.setItem("agir-permit-view", v);
  };
  return (
    <>
      <PageHeader
        eyebrow={c.project_id ? "Underwriting-linked permit case" : "Standalone permit case"}
        title={c.name}
        subtitle={c.property_address || "Address incomplete"}
        actions={
          <>
            {!c.workspace_id && canEdit && (
              <Button
                size="sm"
                className="min-h-11 sm:min-h-8"
                variant="outline"
                onClick={() => setShareOpen(true)}
              >
                <UserRoundCheck className="mr-2 size-4" />
                Share with workspace
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                className="min-h-11 sm:min-h-8"
                variant="outline"
                disabled={projectsQ.isLoading || projectsQ.isError}
                onClick={() => {
                  setProjectId(c.project_id ?? "");
                  setLinkOpen(true);
                }}
              >
                <Link2 className="mr-2 size-4" />
                {c.project_id ? "Change link" : "Attach to underwriting"}
              </Button>
            )}
            {canWrite && (
              <Button
                size="sm"
                className="min-h-11 sm:min-h-8"
                variant="outline"
                onClick={() => setArchiveOpen(true)}
              >
                {c.archived_at ? (
                  <RotateCcw className="mr-2 size-4" />
                ) : (
                  <Archive className="mr-2 size-4" />
                )}
                {c.archived_at ? "Restore case" : "Archive case"}
              </Button>
            )}
            <div
              className="flex rounded-md border p-1"
              role="radiogroup"
              aria-label="Permit presentation"
            >
              <Button
                size="sm"
                className="min-h-11 sm:min-h-8"
                variant={view === "guided" ? "secondary" : "ghost"}
                role="radio"
                aria-checked={view === "guided"}
                onClick={() => changeView("guided")}
              >
                Guided
              </Button>
              <Button
                size="sm"
                className="min-h-11 sm:min-h-8"
                variant={view === "professional" ? "secondary" : "ghost"}
                role="radio"
                aria-checked={view === "professional"}
                onClick={() => changeView("professional")}
              >
                Professional
              </Button>
            </div>
          </>
        }
      />
      <PageBody>
        {c.archived_at && (
          <Warning
            text={`This case was archived${c.archive_reason ? `: ${c.archive_reason}` : "."} Restore it before changing evidence or workflow.`}
          />
        )}
        {c.project_id && (
          <Link
            to="/projects/$id"
            params={{ id: c.project_id }}
            search={{ tab: "permits" } as any}
            className="text-sm text-primary underline"
          >
            Back to underwriting project: {c.projects?.name}
          </Link>
        )}
        {projectsQ.isError && (
          <QueryErrorCard
            title="Underwriting links are temporarily unavailable"
            error={projectsQ.error}
            onRetry={() => projectsQ.refetch()}
          />
        )}
        <Tabs defaultValue="overview">
          <TabsList
            className="h-auto w-full justify-start overflow-x-auto"
            aria-label="Permit case sections"
          >
            {["overview", "permits", "paperwork", "documents", "collaboration", "history"].map(
              (x) => (
                <TabsTrigger key={x} value={x} className="min-h-11 sm:min-h-8">
                  {label(x)}
                </TabsTrigger>
              ),
            )}
          </TabsList>
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric k="Potential approvals" v={permits.length} />
              <Metric k="Items needing review" v={unresolved.length} />
              <Metric
                k="Missing paperwork"
                v={requirements.filter((r: any) => r.is_required && r.status === "missing").length}
              />
              <Metric
                k="Upcoming dates"
                v={[c.target_date, c.issue_date, c.expiration_date].filter(Boolean).length}
              />
            </div>
            <Card className="surface-editorial p-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="eyebrow">Case summary</p>
                  <h2 className="mt-2 font-semibold">What we know</h2>
                </div>
                <span className="status-chip">
                  <ShieldCheck className="size-3" /> Current
                </span>
              </div>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <Fact
                  k="Municipality"
                  v={c.municipality_confirmed ? c.municipality : "Unconfirmed"}
                  source={c.municipality_confirmed ? "User confirmed" : "Not confirmed"}
                />
                <Fact
                  k="Property type"
                  v={c.property_type ? label(c.property_type) : "Not provided"}
                  source={c.property_type ? "User provided" : "Not provided"}
                />
                <Fact
                  k="Proposed work"
                  v={c.work_type ? label(c.work_type) : "Not provided"}
                  source={c.work_type ? "User provided" : "Not provided"}
                />
                <Fact
                  k="Zoning"
                  v={c.zoning_designation || "Zoning change analysis not yet available"}
                  source={c.zoning_source_kind}
                />
              </dl>
            </Card>
            {!c.municipality_confirmed && (
              <Warning text="Confirm the municipality before starting Permit research." />
            )}
          </TabsContent>
          <TabsContent value="permits" className="space-y-4">
            <div className="flex items-center justify-between gap-4 surface-subtle rounded-xl p-4">
              <div>
                <p className="font-medium">Possible permits and approvals</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start with municipal research, then review what fits this work.
                </p>
              </div>
              <Button
                disabled={!canEdit || !c.municipality_confirmed || generate.isPending}
                onClick={() => generate.mutate()}
              >
                <Plus className="mr-2 size-4" />
                Find possible approvals
              </Button>
            </div>
            {generate.error && (
              <p role="alert" className="text-sm text-destructive">
                {(generate.error as Error).message}
              </p>
            )}
            {permits.length ? (
              view === "professional" ? (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <Th>Permit / approval</Th>
                        <Th>Authority</Th>
                        <Th>Applicability</Th>
                        <Th>Workflow</Th>
                        <Th>Source</Th>
                        <Th>Source review</Th>
                        <Th>Duration</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {permitRecords.map((p: any) => (
                        <tr className="border-b" key={p.id}>
                          <Td>
                            {p.name}
                            <small className="block text-muted-foreground">{p.permit_type}</small>
                          </Td>
                          <Td>{p.jurisdictions?.name || "Unknown"}</Td>
                          <Td>
                            <State v={p.applicability_status} />
                          </Td>
                          <Td>
                            <State v={p.workflow_status} />
                          </Td>
                          <Td>
                            {label(p.source_kind)}
                            <small className="block text-muted-foreground">
                              {p.confidence_band || "Confidence unknown"}
                            </small>
                          </Td>
                          <Td>{sourceReviewSummary(p)}</Td>
                          <Td>{p.processing_duration_text || UNKNOWN_DURATION}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {permits.map((p: any) => (
                    <Card key={p.id} className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="font-semibold">{p.name}</h2>
                          <p className="text-sm text-muted-foreground">
                            {p.jurisdictions?.name || "Authority not confirmed"}
                          </p>
                        </div>
                        <State v={p.applicability_status} />
                      </div>
                      {p._records.length > 1 && (
                        <Badge className="mt-3" variant="outline">
                          {p._records.length} source records retained
                        </Badge>
                      )}
                      <p className="mt-4 text-sm">
                        {p.description || "Description not available yet."}
                      </p>
                      <p className="mt-4 text-sm font-medium">
                        {p.processing_duration_text || UNKNOWN_DURATION}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Why it may apply: {p.notes || "The reason still needs review."}
                      </p>
                      {p.application_url && (
                        <a
                          className="mt-4 inline-flex items-center gap-1 text-sm text-primary underline"
                          href={p.application_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Official source <ExternalLink className="size-3" />
                        </a>
                      )}
                      <p className="mt-3 text-xs text-muted-foreground">{sourceReviewSummary(p)}</p>
                      {p._records.length > 1 && (
                        <details className="mt-4 rounded-md border p-3 text-sm">
                          <summary className="cursor-pointer font-medium">
                            Review all {p._records.length} records
                          </summary>
                          <ul className="mt-3 space-y-3">
                            {p._records.map((record: any) => (
                              <li
                                key={record.id}
                                className="border-t pt-3 first:border-0 first:pt-0"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <span>{record.name}</span>
                                  <State v={record.applicability_status} />
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {sourceReviewSummary(record)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </Card>
                  ))}
                </div>
              )
            ) : (
              <Empty text="No possible approvals yet. Start the research when the municipality is confirmed." />
            )}
          </TabsContent>
          <TabsContent value="paperwork" className="space-y-3">
            {requirements.length ? (
              requirements.map((r: any) => (
                <Card key={r.id} className="p-4">
                  <div className="flex justify-between gap-3">
                    <div>
                      <h2 className="font-medium">{r.name}</h2>
                      <p className="text-sm text-muted-foreground">Related permit: {r.permit}</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <State v={r.applicability_state || "unresolved"} />
                      <State v={r.status} />
                    </div>
                  </div>
                  <p className="mt-3 text-sm">
                    {r.is_required === true
                      ? "Confirmed paperwork for this approval."
                      : "Possible paperwork if the related approval applies."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {r.source_text ? "Source saved" : UNKNOWN_REQUIREMENT}
                  </p>
                </Card>
              ))
            ) : (
              <Empty text="No paperwork has been added yet. Review possible approvals and document clues first." />
            )}
          </TabsContent>
          <TabsContent value="documents" className="space-y-4">
            {documentsQ.isError ? (
              <QueryErrorCard
                title="Case documents could not be loaded"
                error={documentsQ.error}
                onRetry={() => documentsQ.refetch()}
              />
            ) : (
              <>
                <Card className="surface-editorial p-6">
                  <h2 className="mb-4 font-semibold">Add supporting documents</h2>
                  {canEdit ? (
                    <DocumentDropzone
                      projectId={c.project_id}
                      permitCaseId={caseId}
                      category="Permit"
                      existingNames={documents.map((d) => d.name)}
                      helperText="PDF, Excel, Word, CSV, and images · extraction creates review candidates only"
                      onChanged={() =>
                        qc.invalidateQueries({ queryKey: ["permit-case-documents", caseId] })
                      }
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This case is read-only. Existing documents remain available below.
                    </p>
                  )}
                </Card>
                {documentsQ.isLoading ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading case documents…
                  </p>
                ) : documents.length ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {documents.map((d) => (
                      <Card key={d.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate font-medium">{d.name}</h3>
                            <p className="text-xs text-muted-foreground">
                              {d.category || "Other"} · Version {d.version_number} · Uploaded{" "}
                              {new Date(d.upload_date).toLocaleString()}
                            </p>
                            <p className="mt-2 text-xs">
                              Extraction review: {label(d.extraction_review_status)}
                            </p>
                          </div>
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label={`Download ${d.name}`}
                            onClick={async () => {
                              const result = await getDocumentUrl({ data: { id: d.id } });
                              if (result.url) window.location.assign(result.url);
                            }}
                          >
                            <Download className="size-4" />
                          </Button>
                        </div>
                        <Button
                          className="mt-4"
                          size="sm"
                          variant="outline"
                          disabled={!canEdit || extractDocument.isPending}
                          onClick={() => extractDocument.mutate(d.id)}
                        >
                          Find permit clues in this document
                        </Button>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Empty text="No documents have been uploaded to this permit case." />
                )}
              </>
            )}
            {researchJobId && (
              <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                {researchJob?.message || "Looking for sourced Permit clues…"}
              </p>
            )}
            {extractionCandidatesQ.isError ? (
              <QueryErrorCard
                title="Document clues could not be loaded"
                error={extractionCandidatesQ.error}
                onRetry={() => extractionCandidatesQ.refetch()}
              />
            ) : extractionCandidates.length > 0 ? (
              <Card className="p-5">
                <h2 className="font-semibold">Document clues</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Each clue keeps the source line that triggered it. It is not a confirmed
                  requirement. Keeping one adds it to the research list for further review.
                </p>
                <div className="mt-4 space-y-3">
                  {extractionCandidates.map((candidate: any) => (
                    <div key={candidate.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{candidate.candidate_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {candidate.documents?.name || "Source document"} ·{" "}
                            {candidate.source_location}
                          </p>
                        </div>
                        <State v={candidate.review_status} />
                      </div>
                      <blockquote className="mt-3 border-l-2 pl-3 text-sm">
                        {candidate.source_text}
                      </blockquote>
                      {candidate.review_status === "needs_review" && canEdit && (
                        <div className="mt-4 space-y-3">
                          <Label htmlFor={`candidate-reason-${candidate.id}`}>Review note</Label>
                          <Input
                            id={`candidate-reason-${candidate.id}`}
                            value={candidateReasons[candidate.id] ?? ""}
                            onChange={(event) =>
                              setCandidateReasons((current) => ({
                                ...current,
                                [candidate.id]: event.target.value,
                              }))
                            }
                            placeholder="Explain why you kept or dismissed this clue"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={
                                !candidateReasons[candidate.id]?.trim() ||
                                reviewExtraction.isPending
                              }
                              onClick={() =>
                                reviewExtraction.mutate({
                                  id: candidate.id,
                                  decision: "accepted",
                                  reason: candidateReasons[candidate.id],
                                })
                              }
                            >
                              Keep for research
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !candidateReasons[candidate.id]?.trim() ||
                                reviewExtraction.isPending
                              }
                              onClick={() =>
                                reviewExtraction.mutate({
                                  id: candidate.id,
                                  decision: "rejected",
                                  reason: candidateReasons[candidate.id],
                                })
                              }
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
          </TabsContent>
          <TabsContent value="collaboration" className="space-y-4">
            {collaborationQ.isError || (Boolean(c.workspace_id) && membersQ.isError) ? (
              <QueryErrorCard
                title="Collaboration details could not be loaded"
                error={collaborationQ.error ?? membersQ.error}
                onRetry={() => {
                  collaborationQ.refetch();
                  if (c.workspace_id) membersQ.refetch();
                }}
              />
            ) : collaborationQ.isLoading || (Boolean(c.workspace_id) && membersQ.isLoading) ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading assignments and handoffs…
              </p>
            ) : !c.workspace_id ? (
              <Warning text="Personal permit cases are private. Move the case into an authorized property project workspace before assigning or handing off work." />
            ) : (
              <>
                {canEdit ? (
                  <Card className="p-5">
                    <h2 className="font-semibold">Assign or hand off work</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Access comes from workspace membership. A handoff does not grant new access.
                    </p>
                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      <div>
                        <Label>Authorized collaborator</Label>
                        <Select value={collaboratorId} onValueChange={setCollaboratorId}>
                          <SelectTrigger className="mt-2">
                            <SelectValue placeholder="Select a workspace member" />
                          </SelectTrigger>
                          <SelectContent>
                            {eligibleCollaborators.map((member) => (
                              <SelectItem key={member.user_id} value={member.user_id}>
                                {member.full_name || member.email || "Workspace member"} (
                                {member.role})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="permit-responsibility">Responsibility</Label>
                        <Input
                          id="permit-responsibility"
                          className="mt-2"
                          value={responsibility}
                          onChange={(event) => setResponsibility(event.target.value)}
                          placeholder="Review building permit candidate"
                        />
                        <Button
                          className="mt-3"
                          variant="outline"
                          disabled={!collaboratorId || !responsibility.trim() || assign.isPending}
                          onClick={() => assign.mutate()}
                        >
                          <UserRoundCheck className="mr-2 size-4" />
                          Assign work
                        </Button>
                      </div>
                    </div>
                    <div className="mt-5 border-t pt-5">
                      <Label htmlFor="permit-handoff-note">Handoff note</Label>
                      <Input
                        id="permit-handoff-note"
                        className="mt-2"
                        value={handoffNote}
                        onChange={(event) => setHandoffNote(event.target.value)}
                        placeholder="State what is ready and what remains unresolved"
                      />
                      <Button
                        className="mt-3"
                        disabled={!collaboratorId || !handoffNote.trim() || handoff.isPending}
                        onClick={() => handoff.mutate()}
                      >
                        <Send className="mr-2 size-4" />
                        Request handoff
                      </Button>
                    </div>
                    {(assign.error || handoff.error) && (
                      <p role="alert" className="mt-3 text-sm text-destructive">
                        {((assign.error || handoff.error) as Error).message}
                      </p>
                    )}
                  </Card>
                ) : (
                  <Warning text="You have read-only access. Assignments and handoffs remain visible below." />
                )}
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="p-5">
                    <h2 className="font-semibold">Assignments</h2>
                    <div className="mt-4 space-y-3">
                      {(collaboration?.assignments ?? []).map((item: any) => (
                        <div key={item.id} className="rounded-md border p-3 text-sm">
                          <p className="font-medium">{item.responsibility}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Assignee: {memberName(members, item.assignee_id)} · {label(item.status)}
                          </p>
                        </div>
                      ))}
                      {!collaboration?.assignments?.length && (
                        <p className="text-sm text-muted-foreground">No case assignments yet.</p>
                      )}
                    </div>
                  </Card>
                  <Card className="p-5">
                    <h2 className="font-semibold">Handoffs</h2>
                    <div className="mt-4 space-y-3">
                      {(collaboration?.handoffs ?? []).map((item: any) => (
                        <div key={item.id} className="rounded-md border p-3 text-sm">
                          <div className="flex items-start justify-between gap-3">
                            <p>{item.note}</p>
                            <State v={item.status} />
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            From {memberName(members, item.from_user_id)} to{" "}
                            {memberName(members, item.to_user_id)}
                          </p>
                          {item.status === "pending" && item.to_user_id === user.id && (
                            <div className="mt-3 flex gap-2">
                              {canEdit && (
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    respondHandoff.mutate({
                                      handoff_id: item.id,
                                      status: "accepted",
                                    })
                                  }
                                >
                                  Accept
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  respondHandoff.mutate({ handoff_id: item.id, status: "rejected" })
                                }
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                      {!collaboration?.handoffs?.length && (
                        <p className="text-sm text-muted-foreground">No handoffs yet.</p>
                      )}
                    </div>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>
          <TabsContent value="history" className="space-y-3">
            {timeline.length ? (
              timeline.map((event) => (
                <Card key={event.id} className="surface-editorial p-4">
                  <div className="flex gap-3">
                    <History className="size-4" />
                    <div>
                      <p className="font-medium">{event.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.at).toLocaleString()} ·{" "}
                        {timelineActor(event.actor, user.id, members)}
                      </p>
                      {event.detail && <p className="mt-2 text-sm leading-6">{event.detail}</p>}
                      {event.reason && (
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Reason: {event.reason}
                        </p>
                      )}
                      <HistoryStateDiff
                        before={event.before}
                        after={event.after}
                        metadata={event.metadata}
                      />
                      <p className="mt-2 text-xs text-muted-foreground">Saved to case history</p>
                    </div>
                  </div>
                </Card>
              ))
            ) : (
              <Empty text="No case changes have been recorded yet. Future changes, assignments, links, and evidence updates appear here." />
            )}
          </TabsContent>
        </Tabs>
        <details className="trust-note rounded-lg p-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Limitations and evidence handling
          </summary>
          <p className="mt-3 leading-6 text-muted-foreground">{PERMIT_LIMITATIONS_TEXT}</p>
        </details>
      </PageBody>
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this permit case</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Move this personal case into a workspace to invite collaborators, assign work, and
              hand off responsibility. The case ID, documents, evidence, and history stay intact.
            </p>
            <div>
              <Label>Property project workspace</Label>
              <Select value={transferWorkspaceId} onValueChange={setTransferWorkspaceId}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Choose a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces
                    .filter((workspace) => workspace.id !== PERSONAL_WORKSPACE_ID)
                    .map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="permit-transfer-reason">Reason</Label>
              <Input
                id="permit-transfer-reason"
                className="mt-2"
                value={transferReason}
                onChange={(event) => setTransferReason(event.target.value)}
              />
            </div>
            {transfer.error && (
              <p role="alert" className="text-sm text-destructive">
                {(transfer.error as Error).message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!transferWorkspaceId || !transferReason.trim() || transfer.isPending}
              onClick={() => transfer.mutate()}
            >
              {transfer.isPending ? "Sharing…" : "Share case"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Underwriting project link</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Project</Label>
              <Select
                value={projectId || "standalone"}
                onValueChange={(value) => setProjectId(value === "standalone" ? "" : value)}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standalone">Standalone / unlink</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="permit-link-reason">Reason</Label>
              <Input
                id="permit-link-reason"
                className="mt-2"
                value={linkReason}
                onChange={(event) => setLinkReason(event.target.value)}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Linking preserves permit IDs, paperwork, documents, and history. It never changes
              underwriting assumptions.
            </p>
            {linkProject.error && (
              <p role="alert" className="text-sm text-destructive">
                {(linkProject.error as Error).message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!linkReason.trim() || linkProject.isPending}
              onClick={() => linkProject.mutate()}
            >
              Save link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{c.archived_at ? "Restore this case" : "Archive this case"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              {c.archived_at
                ? "Restoring makes the case editable again. Its evidence and history stay in place."
                : "Archiving makes the case read-only. It keeps permits, paperwork, documents, and history for later search or restoration."}
            </p>
            <div>
              <Label htmlFor="permit-archive-reason">Reason</Label>
              <Input
                id="permit-archive-reason"
                className="mt-2"
                value={archiveReason}
                onChange={(event) => setArchiveReason(event.target.value)}
                placeholder={
                  c.archived_at ? "Why is this case active again?" : "Why is it closing?"
                }
              />
            </div>
            {archiveCase.error && (
              <p role="alert" className="text-sm text-destructive">
                {(archiveCase.error as Error).message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!archiveReason.trim() || archiveCase.isPending}
              onClick={() => archiveCase.mutate()}
            >
              {archiveCase.isPending ? "Saving…" : c.archived_at ? "Restore case" : "Archive case"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
function memberName(
  members: { user_id: string; full_name: string | null; email: string | null }[],
  userId: string,
) {
  const member = members.find((item) => item.user_id === userId);
  return member?.full_name || member?.email || "Authorized user";
}
function Metric({ k, v }: { k: string; v: number }) {
  return (
    <Card className="surface-editorial metric-card">
      <p className="eyebrow">{k}</p>
      <p className="mt-2 font-mono text-3xl font-semibold tracking-[-0.04em]">{v}</p>
    </Card>
  );
}
function Fact({ k, v, source }: { k: string; v: string; source: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
      <dd className="mt-1 text-xs">Based on: {plainState(source)}</dd>
    </div>
  );
}
function State({ v }: { v: string }) {
  return (
    <Badge variant="outline" className="status-chip">
      {plainState(v)}
    </Badge>
  );
}
function plainState(value: string) {
  const states: Record<string, string> = {
    unknown: "Needs review",
    not_reviewed: "Not checked",
    needs_review: "Needs review",
    potentially_required: "May apply",
    not_started: "Not started",
    verified_source: "Official source",
    analyst: "User confirmed",
    reported: "User provided",
  };
  return states[value] ?? label(value);
}
function sourceReviewSummary(permit: any) {
  if (!permit.source_reviewed_at) return "Source not checked yet";
  const date = new Date(permit.source_reviewed_at).toLocaleDateString();
  if (permit.source_freshness_status === "current" && permit.source_official_status === "official")
    return `Official source checked ${date}`;
  return `Source checked ${date} · ${plainState(permit.source_freshness_status || "not_reviewed")}`;
}

function comparePermitEvidence(a: any, b: any) {
  const score = (permit: any) => {
    const workflow = permit.workflow_status && permit.workflow_status !== "not_started" ? 80 : 0;
    const applicability = ["required", "not_required", "not_applicable"].includes(
      permit.applicability_status,
    )
      ? 60
      : permit.applicability_status === "potentially_required"
        ? 35
        : permit.applicability_status === "needs_review"
          ? 20
          : 0;
    const official = permit.source_official_status === "official" ? 12 : 0;
    const current = permit.source_freshness_status === "current" ? 8 : 0;
    const reviewed = permit.source_reviewed_at ? 4 : 0;
    return workflow + applicability + official + current + reviewed;
  };
  return (
    score(b) - score(a) ||
    String(b.source_reviewed_at ?? b.updated_at ?? b.created_at ?? "").localeCompare(
      String(a.source_reviewed_at ?? a.updated_at ?? a.created_at ?? ""),
    ) ||
    String(a.id).localeCompare(String(b.id))
  );
}
function Warning({ text }: { text: string }) {
  return (
    <Card className="trust-note p-4 text-sm">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>{text}</p>
      </div>
    </Card>
  );
}
function QueryErrorCard({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Card className="surface-editorial p-5" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "The service returned an unexpected error."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Agir is not showing an empty state because the current records could not be verified.
          </p>
          <Button className="mt-4" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="mr-2 size-4" />
            Try again
          </Button>
        </div>
      </div>
    </Card>
  );
}
function historyLabel(action: string) {
  const labels: Record<string, string> = {
    case_insert: "Permit case created",
    case_update_reason: "Case details updated",
    case_project_linked: "Underwriting project link updated",
    case_handoff_started: "Handoff started",
    case_handoff_accepted: "Handoff accepted",
    case_handoff_rejected: "Handoff declined",
    case_workspace_transferred: "Case shared with workspace",
    case_archived: "Case archived",
    case_restored: "Case restored",
    case_document_research_completed: "Document clues created",
    document_candidate_accepted: "Document clue kept for research",
    document_candidate_rejected: "Document clue dismissed",
    permit_insert: "Possible approval added",
    permit_update: "Approval record updated",
    permit_delete: "Approval record removed by a controlled operation",
    paperwork_insert: "Paperwork item added",
    paperwork_update: "Paperwork item updated",
    paperwork_delete: "Paperwork item removed",
    permit_document_insert: "Document linked to approval",
    permit_document_update: "Approval document link updated",
    permit_document_delete: "Document unlinked from approval",
    permit_case_assignments_insert: "Responsibility assigned",
    permit_case_assignments_update: "Assignment updated",
    permit_case_assignments_delete: "Assignment removed",
    permit_case_handoffs_insert: "Handoff requested",
    permit_case_handoffs_update: "Handoff response recorded",
    permit_case_handoffs_delete: "Handoff removed by a controlled operation",
  };
  return labels[action] ?? label(action);
}
function caseHistoryDetail(event: any) {
  const data = event.new_data ?? {};
  if (data.source_location && data.source_text)
    return `${data.source_location}: “${String(data.source_text).slice(0, 500)}”`;
  if (data.candidate_count != null)
    return `${data.candidate_count} sourced clue${data.candidate_count === 1 ? "" : "s"} recorded from the verified document.`;
  return null;
}
function permitHistoryDetail(event: any) {
  const changes = [
    event.previous_applicability_status !== event.new_applicability_status
      ? `Applicability: ${plainState(event.previous_applicability_status || "unknown")} → ${plainState(event.new_applicability_status || "unknown")}`
      : null,
    event.previous_status !== event.new_status
      ? `Workflow: ${plainState(event.previous_status || "unknown")} → ${plainState(event.new_status || "unknown")}`
      : null,
  ].filter(Boolean);
  return changes.join(" · ") || "Evidence record updated.";
}
function timelineActor(
  actorId: string | null,
  currentUserId: string,
  members: { user_id: string; full_name: string | null; email: string | null }[],
) {
  if (!actorId) return "System";
  if (actorId === currentUserId) return "You";
  return memberName(members, actorId);
}
function Empty({ text }: { text: string }) {
  return (
    <Card className="p-10 text-center">
      <FileQuestion className="mx-auto size-8 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">{text}</p>
    </Card>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="p-3 font-medium">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="p-3 align-top">{children}</td>;
}
