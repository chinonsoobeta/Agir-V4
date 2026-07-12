import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  assignPermitCase,
  generateCasePermitCandidates,
  getPermitCase,
  getPermitCaseCollaboration,
  listAttachableProjects,
  respondPermitCaseHandoff,
  setPermitCaseProject,
  startPermitCaseHandoff,
} from "@/lib/permit-cases.functions";
import { listWorkspaceMembers } from "@/lib/workspaces.functions";
import { getDocumentUrl, listPermitCaseDocuments } from "@/lib/documents.functions";
import { DocumentDropzone } from "@/components/document-dropzone";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileQuestion,
  History,
  Link2,
  Plus,
  Send,
  UserRoundCheck,
} from "lucide-react";
export const Route = createFileRoute("/_authenticated/permits/$caseId")({
  component: PermitCaseWorkspace,
});
const label = (s: string) => s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
function PermitCaseWorkspace() {
  const { caseId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: c, isLoading } = useQuery({
    queryKey: ["permit-case", caseId],
    queryFn: () => getPermitCase({ data: { id: caseId } }),
  });
  const { data: documents = [] } = useQuery({
    queryKey: ["permit-case-documents", caseId],
    queryFn: () => listPermitCaseDocuments({ data: { permit_case_id: caseId } }),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["permit-attachable-projects", c?.workspace_id],
    queryFn: () => listAttachableProjects({ data: { workspace_id: c?.workspace_id ?? null } }),
    enabled: Boolean(c),
  });
  const { data: collaboration } = useQuery({
    queryKey: ["permit-case-collaboration", caseId],
    queryFn: () => getPermitCaseCollaboration({ data: { case_id: caseId } }),
  });
  const { data: members = [] } = useQuery({
    queryKey: ["permit-case-members", c?.workspace_id],
    queryFn: () => listWorkspaceMembers({ data: { workspace_id: c!.workspace_id } }),
    enabled: Boolean(c?.workspace_id),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [linkReason, setLinkReason] = useState("");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [responsibility, setResponsibility] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
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
  const [view, setView] = useState<"guided" | "professional">(() =>
    localStorage.getItem("agir-permit-view") === "professional" ? "professional" : "guided",
  );
  const generate = useMutation({
    mutationFn: () => generateCasePermitCandidates({ data: { case_id: caseId } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["permit-case", caseId] });
      alert(`${r.created} review candidates added for ${r.jurisdiction}.`);
    },
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
  if (isLoading || !c)
    return (
      <PageBody>
        <p>Loading permit case…</p>
      </PageBody>
    );
  const permits = c.project_permits ?? [];
  const requirements = permits.flatMap((p: any) =>
    (p.permit_requirements ?? []).map((r: any) => ({ ...r, permit: p.name })),
  );
  const unresolved = permits.filter((p: any) =>
    ["unknown", "needs_review", "potentially_required"].includes(p.applicability_status),
  );
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
            <Button
              size="sm"
              className="min-h-11 sm:min-h-8"
              variant="outline"
              onClick={() => {
                setProjectId(c.project_id ?? "");
                setLinkOpen(true);
              }}
            >
              <Link2 className="mr-2 size-4" />
              {c.project_id ? "Change link" : "Attach to underwriting"}
            </Button>
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
            <Card className="p-5">
              <h2 className="font-semibold">Known case facts</h2>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <Fact
                  k="Municipality"
                  v={c.municipality_confirmed ? c.municipality : "Unconfirmed"}
                  source={c.municipality_confirmed ? "Analyst-provided" : "Unknown"}
                />
                <Fact
                  k="Property type"
                  v={c.property_type ? label(c.property_type) : "Unknown"}
                  source={c.property_type ? "Reported" : "Unknown"}
                />
                <Fact
                  k="Proposed work"
                  v={c.work_type ? label(c.work_type) : "Unknown"}
                  source={c.work_type ? "Reported" : "Unknown"}
                />
                <Fact
                  k="Zoning"
                  v={c.zoning_designation || "Zoning change analysis not yet available"}
                  source={c.zoning_source_kind}
                />
              </dl>
            </Card>
            {!c.municipality_confirmed && (
              <Warning text="Permit candidates cannot be generated until the municipality is explicitly confirmed." />
            )}
          </TabsContent>
          <TabsContent value="permits" className="space-y-4">
            <div className="flex justify-end">
              <Button
                disabled={!c.municipality_confirmed || generate.isPending}
                onClick={() => generate.mutate()}
              >
                <Plus className="mr-2 size-4" />
                Generate review candidates
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
                        <Th>Provenance</Th>
                        <Th>Source review</Th>
                        <Th>Duration</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {permits.map((p: any) => (
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
                          <Td>
                            {p.source_reviewed_at
                              ? new Date(p.source_reviewed_at).toLocaleDateString()
                              : "Not reviewed"}
                            <small className="block text-muted-foreground">
                              {label(p.source_freshness_status || "not_reviewed")} ·{" "}
                              {label(p.source_official_status || "unknown")}
                            </small>
                          </Td>
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
                      <p className="mt-4 text-sm">
                        {p.description || "No verified description available."}
                      </p>
                      <p className="mt-4 text-sm font-medium">
                        {p.processing_duration_text || UNKNOWN_DURATION}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Why this appears: {p.notes || "Reason needs review."}
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
                      <p className="mt-3 text-xs text-muted-foreground">
                        Source review:{" "}
                        {p.source_reviewed_at
                          ? new Date(p.source_reviewed_at).toLocaleDateString()
                          : "Not reviewed"}{" "}
                        · {label(p.source_freshness_status || "not_reviewed")} ·{" "}
                        {label(p.source_official_status || "unknown")}
                      </p>
                    </Card>
                  ))}
                </div>
              )
            ) : (
              <Empty text="No permit candidates yet. Candidate generation never confirms a requirement." />
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
                    <State v={r.status} />
                  </div>
                  <p className="mt-3 text-sm">
                    {r.source_text ? "Source evidence recorded" : UNKNOWN_REQUIREMENT}
                  </p>
                </Card>
              ))
            ) : (
              <Empty text="No paperwork requirements have been recorded. Missing information is not treated as a requirement." />
            )}
          </TabsContent>
          <TabsContent value="documents" className="space-y-4">
            <Card className="p-5">
              <h2 className="mb-4 font-semibold">Add supporting documents</h2>
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
            </Card>
            {documents.length ? (
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
                  </Card>
                ))}
              </div>
            ) : (
              <Empty text="No documents have been uploaded to this permit case." />
            )}
          </TabsContent>
          <TabsContent value="collaboration" className="space-y-4">
            {!c.workspace_id ? (
              <Warning text="Personal permit cases are private. Move the case into an authorized property project workspace before assigning or handing off work." />
            ) : (
              <>
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
                          {members.map((member) => (
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
                              <Button
                                size="sm"
                                onClick={() =>
                                  respondHandoff.mutate({ handoff_id: item.id, status: "accepted" })
                                }
                              >
                                Accept
                              </Button>
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
            {(c.permit_case_history ?? []).map((h: any) => (
              <Card key={h.id} className="p-4">
                <div className="flex gap-3">
                  <History className="size-4" />
                  <div>
                    <p className="font-medium">{label(h.action)}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(h.changed_at).toLocaleString()}
                    </p>
                    {h.reason && <p className="mt-2 text-sm">{h.reason}</p>}
                  </div>
                </div>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
        <Warning text={PERMIT_LIMITATIONS_TEXT} />
      </PageBody>
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
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{k}</p>
      <p className="mt-1 text-2xl font-semibold">{v}</p>
    </Card>
  );
}
function Fact({ k, v, source }: { k: string; v: string; source: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
      <dd className="mt-1 text-xs">Provenance: {label(source)}</dd>
    </div>
  );
}
function State({ v }: { v: string }) {
  return <Badge variant="outline">{label(v)}</Badge>;
}
function Warning({ text }: { text: string }) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>{text}</p>
      </div>
    </Card>
  );
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
