import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Plus,
  Search,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  APPLICABILITY_STATUSES,
  WORKFLOW_STATUSES,
  UNKNOWN_DURATION,
  UNKNOWN_REQUIREMENT,
  createPermit,
  addPermitRequirement,
  deletePermitRequirement,
  generatePermitCandidates,
  linkPermitDocument,
  listJurisdictions,
  listProjectPermits,
  unlinkPermitDocument,
  updatePermit,
  updatePermitRequirement,
} from "@/lib/permits.functions";
import { getDocumentUrl, listDocuments } from "@/lib/documents.functions";

type Permit = any;
const label = (v: string) => v.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function PermitStatusBadge({ status }: { status: string }) {
  const warning = ["unknown", "needs_review", "blocked", "corrections_requested"].includes(status);
  return (
    <Badge
      variant={warning ? "outline" : "secondary"}
      className={warning ? "border-warning text-warning" : ""}
    >
      {label(status)}
    </Badge>
  );
}
export function PermitSourceBadge({ kind }: { kind: string }) {
  return (
    <Badge
      variant="outline"
      className={
        kind === "verified_source"
          ? "border-success text-success"
          : kind === "unknown" || kind === "needs_review"
            ? "border-warning text-warning"
            : ""
      }
    >
      {label(kind)}
    </Badge>
  );
}
export function JurisdictionSelector({
  value,
  onChange,
}: {
  value?: string;
  onChange: (v: string) => void;
}) {
  const { data = [] } = useQuery({
    queryKey: ["jurisdictions"],
    queryFn: () => listJurisdictions(),
  });
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select municipality" />
      </SelectTrigger>
      <SelectContent>
        {data.map((j: any) => (
          <SelectItem key={j.id} value={j.id}>
            {j.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function PermitHistory({ items = [] }: { items?: any[] }) {
  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
      ) : (
        items
          .slice()
          .reverse()
          .map((h) => (
            <div key={h.id} className="border-l-2 pl-3 text-sm">
              <p>
                {label(h.previous_applicability_status ?? "unknown")} →{" "}
                {label(h.new_applicability_status ?? "unknown")}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(h.changed_at).toLocaleString()}{" "}
                {h.change_reason ? `· ${h.change_reason}` : ""}
              </p>
            </div>
          ))
      )}
    </div>
  );
}
export function PermitRequirementChecklist({
  items = [],
  onChange,
  onDelete,
}: {
  items?: any[];
  onChange: (id: string, status: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No officially listed paperwork has been added.
        </p>
      ) : (
        items.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-sm rounded-md border p-2">
            <input
              type="checkbox"
              checked={r.status === "received"}
              onChange={(e) => onChange(r.id, e.target.checked ? "received" : "missing")}
            />
            <span className={r.status === "received" ? "line-through text-muted-foreground" : ""}>
              {r.name}
            </span>
            {r.is_required && <Badge variant="outline">Required</Badge>}
            {r.document_id && <Badge variant="secondary">Document linked</Badge>}
            {onDelete && (
              <Button
                className="ml-auto"
                size="icon"
                variant="ghost"
                aria-label={`Delete ${r.name}`}
                onClick={() => onDelete(r.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
export function PermitRow({ permit, onOpen }: { permit: Permit; onOpen: () => void }) {
  const duration = permit.processing_duration_text || UNKNOWN_DURATION;
  return (
    <button
      onClick={onOpen}
      className="w-full grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr] gap-3 items-center p-4 text-left border-b hover:bg-muted/30"
    >
      <div>
        <p className="font-medium">{permit.name}</p>
        <p className="text-xs text-muted-foreground">
          {permit.jurisdictions?.name || "Authority not confirmed"}
        </p>
      </div>
      <PermitStatusBadge status={permit.applicability_status} />
      <PermitStatusBadge status={permit.workflow_status} />
      <p className="text-xs text-muted-foreground">{duration}</p>
    </button>
  );
}
export function PermitDetailPanel({ permit, onClose }: { permit: Permit; onClose: () => void }) {
  const qc = useQueryClient();
  const [requirementName, setRequirementName] = useState("");
  const [requirementDescription, setRequirementDescription] = useState("");
  const [selectedDocument, setSelectedDocument] = useState("");
  const [documentRole, setDocumentRole] = useState("supporting");
  const { data: projectDocuments = [] } = useQuery({
    queryKey: ["docs", permit.project_id],
    queryFn: () => listDocuments({ data: { project_id: permit.project_id } }),
  });
  const mutation = useMutation({
    mutationFn: (patch: any) => updatePermit({ data: { id: permit.id, patch } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permits", permit.project_id] }),
  });
  const req = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updatePermitRequirement({ data: { id, status: status as any } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permits", permit.project_id] }),
  });
  const addReq = useMutation({
    mutationFn: () =>
      addPermitRequirement({
        data: {
          project_permit_id: permit.id,
          name: requirementName,
          description: requirementDescription || null,
          requirement_type: "paperwork",
          is_required: true,
          notes: "Analyst-added checklist item.",
        },
      }),
    onSuccess: () => {
      setRequirementName("");
      setRequirementDescription("");
      qc.invalidateQueries({ queryKey: ["permits", permit.project_id] });
    },
  });
  const deleteReq = useMutation({
    mutationFn: (id: string) => deletePermitRequirement({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permits", permit.project_id] }),
  });
  const linkDoc = useMutation({
    mutationFn: () =>
      linkPermitDocument({
        data: {
          permit_id: permit.id,
          document_id: selectedDocument,
          document_role: documentRole,
          is_required: false,
        },
      }),
    onSuccess: () => {
      setSelectedDocument("");
      qc.invalidateQueries({ queryKey: ["permits", permit.project_id] });
    },
  });
  const unlinkDoc = useMutation({
    mutationFn: (document_id: string) =>
      unlinkPermitDocument({ data: { permit_id: permit.id, document_id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permits", permit.project_id] }),
  });
  const download = async (id: string) => {
    const result = await getDocumentUrl({ data: { id } });
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l bg-background p-6 shadow-xl">
      <div className="flex justify-between">
        <div>
          <h2 className="text-xl font-semibold">{permit.name}</h2>
          <div className="flex gap-2 mt-2">
            <PermitSourceBadge kind={permit.source_kind} />
            <PermitStatusBadge status={permit.applicability_status} />
          </div>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mt-6 space-y-6">
        <section>
          <h3 className="font-medium mb-2">Applicability</h3>
          <Select
            value={permit.applicability_status}
            onValueChange={(v) =>
              mutation.mutate({
                applicability_status: v,
                is_required: v === "required" ? true : v === "not_required" ? false : null,
                source_kind: "analyst",
                required_reason:
                  permit.required_reason || "Analyst determination entered in permit workspace.",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPLICABILITY_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {label(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {permit.applicability_status === "unknown" && (
            <p className="mt-2 text-sm text-warning">{UNKNOWN_REQUIREMENT}</p>
          )}
        </section>
        <section>
          <h3 className="font-medium mb-2">Workflow</h3>
          <Select
            value={permit.workflow_status}
            onValueChange={(v) => mutation.mutate({ workflow_status: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOW_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {label(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>
        <section>
          <h3 className="font-medium">Description</h3>
          <p className="text-sm text-muted-foreground">
            {permit.description || "No verified description available."}
          </p>
        </section>
        <section>
          <h3 className="font-medium">Processing duration</h3>
          <p className={!permit.processing_duration_text ? "text-sm text-warning" : "text-sm"}>
            {permit.processing_duration_text || UNKNOWN_DURATION}
          </p>
          {permit.duration_source && (
            <a
              className="text-sm text-primary underline"
              href={permit.duration_source}
              target="_blank"
              rel="noreferrer"
            >
              Duration source
            </a>
          )}
        </section>
        <section>
          <h3 className="font-medium mb-2">Required paperwork</h3>
          <PermitRequirementChecklist
            items={permit.permit_requirements}
            onChange={(id, status) => req.mutate({ id, status })}
            onDelete={(id) => deleteReq.mutate(id)}
          />
          <div className="mt-3 space-y-2 rounded-md border border-dashed p-3">
            <p className="text-sm font-medium">Add checklist item</p>
            <Input
              value={requirementName}
              onChange={(e) => setRequirementName(e.target.value)}
              placeholder="Paperwork name"
            />
            <Input
              value={requirementDescription}
              onChange={(e) => setRequirementDescription(e.target.value)}
              placeholder="Description or source note (optional)"
            />
            <Button
              size="sm"
              disabled={!requirementName || addReq.isPending}
              onClick={() => addReq.mutate()}
            >
              <Plus className="mr-2 size-4" />
              Add required paperwork
            </Button>
          </div>
        </section>
        <section>
          <h3 className="font-medium mb-2">Linked documents</h3>
          {permit.permit_documents?.length ? (
            <div className="space-y-2">
              {permit.permit_documents.map((d: any) => (
                <div key={d.document_id} className="flex items-center gap-2 rounded-md border p-2">
                  <FileText className="size-4" />
                  <span className="text-sm">{d.documents?.name || d.document_id}</span>
                  <Badge variant="outline">{label(d.document_role)}</Badge>
                  <Button
                    className="ml-auto"
                    size="icon"
                    variant="ghost"
                    aria-label={`Download ${d.documents?.name || "document"}`}
                    onClick={() => download(d.document_id)}
                  >
                    <Download className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Unlink ${d.documents?.name || "document"}`}
                    onClick={() => unlinkDoc.mutate(d.document_id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No linked documents.</p>
          )}
          <div className="mt-3 grid grid-cols-[1fr_9rem_auto] gap-2">
            <Select value={selectedDocument} onValueChange={setSelectedDocument}>
              <SelectTrigger>
                <SelectValue placeholder="Choose project document" />
              </SelectTrigger>
              <SelectContent>
                {projectDocuments
                  .filter(
                    (doc: any) =>
                      !permit.permit_documents?.some(
                        (linked: any) => linked.document_id === doc.id,
                      ),
                  )
                  .map((doc: any) => (
                    <SelectItem key={doc.id} value={doc.id}>
                      {doc.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={documentRole} onValueChange={setDocumentRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["supporting", "application", "approval", "inspection", "source", "drawing"].map(
                  (role) => (
                    <SelectItem key={role} value={role}>
                      {label(role)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Button
              disabled={!selectedDocument || linkDoc.isPending}
              onClick={() => linkDoc.mutate()}
            >
              Link
            </Button>
          </div>
        </section>
        <section>
          <h3 className="font-medium">Source</h3>
          <p className="text-sm text-muted-foreground">
            {permit.source_text || "No source text recorded."}
          </p>
          {permit.application_url && (
            <a
              className="text-sm text-primary underline"
              href={permit.application_url}
              target="_blank"
              rel="noreferrer"
            >
              Official application or information page
            </a>
          )}
        </section>
        <section>
          <h3 className="font-medium mb-2">Audit history</h3>
          <PermitHistory items={permit.permit_history} />
        </section>
      </div>
    </div>
  );
}
export function PermitCreateDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [type, setType] = useState("building"),
    [jurisdiction, setJurisdiction] = useState<string>();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      createPermit({
        data: {
          project_id: projectId,
          name,
          permit_type: type,
          jurisdiction_id: jurisdiction,
          applicability_status: "unknown",
          workflow_status: "not_started",
          source_kind: "analyst",
          notes: "Manually created permit candidate; applicability requires review.",
        },
      }),
    onSuccess: () => {
      setOpen(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["permits", projectId] });
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4 mr-2" />
          Add permit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add permit candidate</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Permit or approval name"
          />
          <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Permit type" />
          <JurisdictionSelector value={jurisdiction} onChange={setJurisdiction} />
          <p className="text-xs text-muted-foreground">
            New records start with unknown applicability. Creating a candidate does not assert that
            it is required.
          </p>
          <Button disabled={!name || m.isPending} onClick={() => m.mutate()}>
            Create candidate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function PermitRegister({ projectId }: { projectId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["permits", projectId],
    queryFn: () => listProjectPermits({ data: { project_id: projectId } }),
  });
  const [selected, setSelected] = useState<Permit | null>(null),
    [search, setSearch] = useState(""),
    [app, setApp] = useState("all"),
    [flow, setFlow] = useState("all"),
    [required, setRequired] = useState(false),
    [missing, setMissing] = useState(false),
    [review, setReview] = useState(false);
  const rows = useMemo(
    () =>
      data.filter(
        (p: any) =>
          (!search ||
            `${p.name} ${p.permit_type} ${p.jurisdictions?.name}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (app === "all" || p.applicability_status === app) &&
          (flow === "all" || p.workflow_status === flow) &&
          (!required || p.is_required === true) &&
          (!missing ||
            p.permit_requirements?.some((r: any) => r.is_required && r.status !== "received")) &&
          (!review ||
            ["unknown", "needs_review", "potentially_required"].includes(p.applicability_status)),
      ),
    [data, search, app, flow, required, missing, review],
  );
  const selectedPermit = selected ? data.find((permit: any) => permit.id === selected.id) : null;
  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search permits or authorities"
          />
        </div>
        <Select value={app} onValueChange={setApp}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Applicability" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All applicability</SelectItem>
            {APPLICABILITY_STATUSES.map((s) => (
              <SelectItem value={s} key={s}>
                {label(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={flow} onValueChange={setFlow}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Workflow" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All workflow</SelectItem>
            {WORKFLOW_STATUSES.map((s) => (
              <SelectItem value={s} key={s}>
                {label(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="text-sm flex items-center gap-1">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Required
        </label>
        <label className="text-sm flex items-center gap-1">
          <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />
          Missing docs
        </label>
        <label className="text-sm flex items-center gap-1">
          <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
          Needs review
        </label>
      </div>
      {isLoading ? (
        <p className="p-8 text-center">Loading permits…</p>
      ) : rows.length ? (
        rows.map((p: any) => <PermitRow key={p.id} permit={p} onOpen={() => setSelected(p)} />)
      ) : (
        <div className="p-10 text-center">
          <AlertTriangle className="mx-auto size-6 text-warning" />
          <p className="mt-2 font-medium">No permit records match this view</p>
          <p className="text-sm text-muted-foreground">
            No requirements are inferred automatically from municipality, address, or project type.
          </p>
        </div>
      )}
      {selectedPermit && (
        <PermitDetailPanel permit={selectedPermit} onClose={() => setSelected(null)} />
      )}
    </Card>
  );
}
export function PermitWorkspace({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const generate = useMutation({
    mutationFn: () => generatePermitCandidates({ data: { project_id: projectId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permits", projectId] }),
  });
  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Permits</h2>
          <p className="text-sm text-muted-foreground">
            Track municipal and external approvals without affecting underwriting.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={generate.isPending} onClick={() => generate.mutate()}>
            <WandSparkles className="mr-2 size-4" />
            {generate.isPending ? "Generating…" : "Generate municipality candidates"}
          </Button>
          <PermitCreateDialog projectId={projectId} />
        </div>
      </div>
      {generate.data && (
        <p className="text-sm text-success">
          Created {generate.data.created} review candidate{generate.data.created === 1 ? "" : "s"}{" "}
          for {generate.data.jurisdiction}.
        </p>
      )}
      {generate.error && <p className="text-sm text-destructive">{generate.error.message}</p>}
      <PermitRegister projectId={projectId} />
      <div className="flex gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="size-4 text-success" />
        Verified facts show their source. Unknown or analyst-provided facts remain visibly labelled.
      </div>
    </div>
  );
}
