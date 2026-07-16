import { useMemo, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  ArrowLeft,
  Building2,
  Check,
  CircleDot,
  ContactRound,
  Download,
  ExternalLink,
  FileText,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Undo2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/app-shell";
import { DocumentDropzone } from "@/components/document-dropzone";
import { HistoryStateDiff } from "@/components/history-state-diff";
import { PropertyEditor } from "@/components/properties/property-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelDocumentDeletion,
  deleteDocument,
  getDocumentUrl,
  listDocuments,
  listExtractionJobs,
  listPendingDocumentUploads,
  retryPendingDocumentUpload,
} from "@/lib/documents.functions";
import { listRelationshipContacts } from "@/lib/operating-depth.functions";
import { listPermitCases } from "@/lib/permit-cases.functions";
import { listProjects } from "@/lib/projects.functions";
import {
  addPropertyLink,
  archiveProperty,
  getProperty,
  linkPropertyContact,
  linkPropertyDocument,
  linkPropertyPermitCase,
  linkPropertyProject,
  listPropertyActivity,
  savePropertyTask,
  type PropertyActivityCursor,
  type PropertyDetail,
} from "@/lib/properties.functions";
import {
  activityLabel,
  propertyAddress,
  propertyPrice,
  propertyTitle,
} from "@/lib/property-presentation";
import { propertyProjectTypeLabel } from "@/lib/property-project-types";
import { useWorkspace } from "@/lib/workspace-context";
import { listWorkspaceMembers, PERSONAL_WORKSPACE_ID } from "@/lib/workspaces.functions";

export const Route = createFileRoute("/_authenticated/properties/$propertyId")({
  head: () => ({ meta: [{ title: "Property | Agir" }] }),
  component: PropertyDetailPage,
});

function PropertyDetailPage() {
  const { propertyId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const { workspaces, isLoading: workspacesLoading } = useWorkspace();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const detailQ = useQuery({
    queryKey: ["property", propertyId],
    queryFn: () => getProperty({ data: { id: propertyId } }),
  });
  const detail = detailQ.data;
  const property = detail?.property;

  if (detailQ.isLoading) {
    return (
      <PageBody>
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-[30rem] rounded-xl" />
      </PageBody>
    );
  }
  if (detailQ.isError || !property) {
    return (
      <PageBody>
        <Card className="surface-editorial mx-auto max-w-xl p-8 text-center">
          <h1 className="display text-xl font-semibold">Property could not be opened</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {detailQ.error instanceof Error ? detailQ.error.message : "The record is unavailable."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => detailQ.refetch()}>
              Try again
            </Button>
            <Button asChild variant="ghost">
              <Link to="/properties">Back to properties</Link>
            </Button>
          </div>
        </Card>
      </PageBody>
    );
  }

  const workspace = property.workspace_id
    ? workspaces.find((item) => item.id === property.workspace_id)
    : null;
  const canWrite = property.workspace_id
    ? !workspacesLoading && Boolean(workspace && workspace.role !== "viewer")
    : property.owner_id === user.id;
  const archived = Boolean(property.archived_at || property.status === "archived");
  const canEdit = canWrite && !archived;

  return (
    <>
      <PageHeader
        eyebrow="Property workspace"
        title={propertyTitle(property)}
        subtitle={propertyAddress(property)}
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link to="/properties">
                <ArrowLeft className="mr-1.5 size-4" /> All properties
              </Link>
            </Button>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-1.5 size-4" /> Edit
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setArchiveOpen(true)}>
                <Archive className="mr-1.5 size-4" /> Archive
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        {archived ? (
          <Card className="trust-note p-4 text-sm">
            <p className="font-medium">Archived property: read-only</p>
            <p className="mt-1 text-muted-foreground">
              History and linked records remain available. Restore support is not yet available in
              this workspace.
            </p>
          </Card>
        ) : !canWrite ? (
          <Card className="trust-note p-4 text-sm">
            <p className="font-medium">Read-only access</p>
            <p className="mt-1 text-muted-foreground">
              You can review this property. Ask a workspace owner or administrator to make changes.
            </p>
          </Card>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FactCard
            icon={MapPin}
            label="Municipality"
            value={property.municipality || "Not recorded"}
          />
          <FactCard
            icon={Building2}
            label="Project type"
            value={propertyProjectTypeLabel(property.project_type)}
          />
          <FactCard
            icon={ShieldCheck}
            label="Zoning"
            value={property.zoning_designation || "Not recorded"}
          />
          <FactCard icon={CircleDot} label="Price" value={propertyPrice(property)} />
        </div>

        <Tabs defaultValue="overview">
          <div className="max-w-full overflow-x-auto pb-1">
            <TabsList className="h-auto min-w-max">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="work">Deals & Permits</TabsTrigger>
              <TabsTrigger value="records">Files & contacts</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="mt-5 space-y-5">
            <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
              <Card className="surface-editorial p-6">
                <SectionHeading
                  title="Property facts"
                  subtitle="The shared facts used across Agir."
                />
                <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  <Definition label="Building or complex" value={property.building_name} />
                  <Definition
                    label="Unit or suite"
                    value={property.unit || property.address_line_2}
                  />
                  <Definition label="Owner" value={property.owner_name} />
                  <Definition label="Broker" value={property.broker_name} />
                  <Definition label="Place provider" value={property.place_provider} />
                  <Definition label="Place ID" value={property.provider_place_id} />
                  <Definition
                    label="Coordinates"
                    value={
                      property.latitude != null && property.longitude != null
                        ? `${property.latitude}, ${property.longitude}`
                        : null
                    }
                  />
                  <Definition
                    label="Last updated"
                    value={new Date(property.updated_at).toLocaleString("en-CA")}
                  />
                </dl>
              </Card>
              <Card className="surface-editorial p-6">
                <SectionHeading title="Zoning evidence" subtitle="Source-backed when available." />
                <div className="mt-5 space-y-3 text-sm">
                  <Definition label="Designation" value={property.zoning_designation} />
                  <Definition
                    label="Last checked"
                    value={
                      property.zoning_verified_at
                        ? new Date(property.zoning_verified_at).toLocaleDateString("en-CA")
                        : null
                    }
                  />
                  {property.zoning_source_url ? (
                    <a
                      href={property.zoning_source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      Open zoning source <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    <p className="text-muted-foreground">No zoning source saved.</p>
                  )}
                </div>
              </Card>
            </div>
            <Card className="surface-editorial p-6">
              <SectionHeading title="Notes" subtitle="Team memory that stays with the property." />
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {property.notes || "No notes yet."}
              </p>
            </Card>
            <PropertyLinks propertyId={propertyId} urls={detail.urls ?? []} canEdit={canEdit} />
          </TabsContent>

          <TabsContent value="work" className="mt-5 space-y-5">
            <RelatedWork
              property={property}
              projects={detail.projects ?? []}
              permitCases={detail.permit_cases ?? []}
              canEdit={canEdit}
            />
          </TabsContent>

          <TabsContent value="records" className="mt-5 space-y-5">
            <PropertyRecords
              property={property}
              documents={detail.documents ?? []}
              contacts={detail.contacts ?? []}
              canEdit={canEdit}
            />
          </TabsContent>

          <TabsContent value="tasks" className="mt-5">
            <PropertyTasks
              propertyId={propertyId}
              workspaceId={property.workspace_id}
              tasks={detail.tasks ?? []}
              canEdit={canEdit}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-5">
            <PropertyHistory
              propertyId={propertyId}
              initialActivities={detail.activities ?? []}
              total={detail.activity_total ?? detail.activities?.length ?? 0}
              nextCursor={detail.activity_next_cursor ?? null}
              workspaceId={property.workspace_id}
              currentUserId={user.id}
            />
          </TabsContent>
        </Tabs>
      </PageBody>

      {canEdit && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          {editOpen && (
            <PropertyEditor
              property={{
                ...property,
                place_provider: property.place_provider as
                  | "google_places"
                  | "openstreetmap"
                  | "manual"
                  | "other",
              }}
              workspaceId={property.workspace_id}
              onCancel={() => setEditOpen(false)}
              onSaved={() => {
                setEditOpen(false);
                detailQ.refetch();
                qc.invalidateQueries({ queryKey: ["property-activity", propertyId] });
              }}
            />
          )}
        </Dialog>
      )}
      {canEdit && (
        <ArchivePropertyDialog
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          propertyId={propertyId}
        />
      )}
    </>
  );
}

function FactCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <Card className="surface-editorial p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</span>
        <Icon className="size-4 text-primary" />
      </div>
      <div className="mt-2 truncate font-semibold">{value}</div>
    </Card>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="display text-lg font-semibold">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function Definition({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium capitalize">{value || "Not recorded"}</dd>
    </div>
  );
}

function PropertyLinks({
  propertyId,
  urls,
  canEdit,
}: {
  propertyId: string;
  urls: any[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const qc = useQueryClient();
  const addFn = useServerFn(addPropertyLink);
  const add = useMutation({
    mutationFn: () =>
      addFn({ data: { property_id: propertyId, url, label: label.trim() || null } }),
    onSuccess: () => {
      setOpen(false);
      setUrl("");
      setLabel("");
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["property-activity", propertyId] });
      toast.success("Link added");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Card className="surface-editorial p-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeading
          title="Links"
          subtitle="Listings, municipal pages, research, and source material."
        />
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 size-4" /> Add link
          </Button>
        )}
      </div>
      {urls.length ? (
        <div className="mt-5 divide-y divide-border rounded-lg border border-border">
          {urls.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40"
            >
              <span className="min-w-0 truncate">{item.label || item.url}</span>
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
            </a>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No links saved.</p>
      )}
      {canEdit && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add property link</DialogTitle>
            </DialogHeader>
            <Field label="URL" required>
              <Input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…"
              />
            </Field>
            <Field label="Label">
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Broker listing"
              />
            </Field>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!url.trim() || add.isPending} onClick={() => add.mutate()}>
                {add.isPending ? "Adding…" : "Add link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function RelatedWork({
  property,
  projects,
  permitCases,
  canEdit,
}: {
  property: any;
  projects: any[];
  permitCases: any[];
  canEdit: boolean;
}) {
  const workspaceId = property.workspace_id ?? null;
  const [projectId, setProjectId] = useState("");
  const [caseId, setCaseId] = useState("");
  const qc = useQueryClient();
  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
    enabled: canEdit,
  });
  const permitQ = useQuery({
    queryKey: ["permit-cases", workspaceId],
    queryFn: () => listPermitCases({ data: { workspace_id: workspaceId } }),
    enabled: canEdit,
  });
  const projectLinkFn = useServerFn(linkPropertyProject);
  const caseLinkFn = useServerFn(linkPropertyPermitCase);
  const attachProject = useMutation({
    mutationFn: () => projectLinkFn({ data: { property_id: property.id, project_id: projectId } }),
    onSuccess: () => {
      setProjectId("");
      qc.invalidateQueries({ queryKey: ["property", property.id] });
      qc.invalidateQueries({ queryKey: ["property-activity", property.id] });
      toast.success("Deal linked");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const attachCase = useMutation({
    mutationFn: () => caseLinkFn({ data: { property_id: property.id, permit_case_id: caseId } }),
    onSuccess: () => {
      setCaseId("");
      qc.invalidateQueries({ queryKey: ["property", property.id] });
      qc.invalidateQueries({ queryKey: ["property-activity", property.id] });
      toast.success("Permit case linked");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const availableProjects = (projectsQ.data ?? []).filter(
    (item: any) =>
      (item.workspace_id ?? null) === workspaceId &&
      !item.property_id &&
      !projects.some((linked) => linked.id === item.id),
  );
  const availableCases = (permitQ.data ?? []).filter(
    (item: any) => !item.property_id && !permitCases.some((linked) => linked.id === item.id),
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <RelatedCard
        title="Underwriting deals"
        icon={Workflow}
        empty="No deals linked to this property."
        items={projects.map((project) => ({
          id: project.id,
          title: project.name,
          subtitle: [project.status, project.type].filter(Boolean).join(" · "),
          to: `/projects/${project.id}`,
        }))}
        attach={
          canEdit && availableProjects.length ? (
            <AttachSelect
              label="Link deal"
              value={projectId}
              onValueChange={setProjectId}
              options={availableProjects.map((item: any) => ({ value: item.id, label: item.name }))}
              onAttach={() => attachProject.mutate()}
              pending={attachProject.isPending}
            />
          ) : null
        }
      />
      <RelatedCard
        title="Permit cases"
        icon={ShieldCheck}
        empty="No Permit cases linked to this property."
        items={permitCases.map((permitCase) => ({
          id: permitCase.id,
          title: permitCase.name,
          subtitle: [permitCase.municipality, permitCase.work_type].filter(Boolean).join(" · "),
          to: `/permits/${permitCase.id}`,
        }))}
        attach={
          canEdit && availableCases.length ? (
            <AttachSelect
              label="Link Permit case"
              value={caseId}
              onValueChange={setCaseId}
              options={availableCases.map((item: any) => ({ value: item.id, label: item.name }))}
              onAttach={() => attachCase.mutate()}
              pending={attachCase.isPending}
            />
          ) : null
        }
      />
    </div>
  );
}

function RelatedCard({
  title,
  icon: Icon,
  empty,
  items,
  attach,
}: {
  title: string;
  icon: typeof Workflow;
  empty: string;
  items: Array<{ id: string; title: string; subtitle: string; to: string }>;
  attach?: React.ReactNode;
}) {
  return (
    <Card className="surface-editorial p-6">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <h2 className="font-semibold">{title}</h2>
      </div>
      {items.length ? (
        <div className="mt-4 divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <a
              key={item.id}
              href={item.to}
              className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground capitalize">
                  {item.subtitle}
                </span>
              </span>
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
            </a>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{empty}</p>
      )}
      {attach && <div className="mt-5 border-t border-border pt-4">{attach}</div>}
    </Card>
  );
}

function AttachSelect({
  label,
  value,
  onValueChange,
  options,
  onAttach,
  pending,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  onAttach: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="flex-1" aria-label={label}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" disabled={!value || pending} onClick={onAttach}>
        {pending ? "Linking…" : "Link"}
      </Button>
    </div>
  );
}

function PropertyRecords({
  property,
  documents,
  contacts,
  canEdit,
}: {
  property: PropertyDetail["property"];
  documents: PropertyDetail["documents"];
  contacts: PropertyDetail["contacts"];
  canEdit: boolean;
}) {
  const workspaceId = property.workspace_id ?? null;
  const [documentId, setDocumentId] = useState("");
  const [contactId, setContactId] = useState("");
  const [replacement, setReplacement] = useState<PropertyDetail["documents"][number] | null>(null);
  const [deletionTarget, setDeletionTarget] = useState<PropertyDetail["documents"][number] | null>(
    null,
  );
  const qc = useQueryClient();
  const docsQ = useQuery({
    queryKey: ["documents", "property-records", property.id, workspaceId],
    queryFn: () => listDocuments({ data: {} }),
    enabled: canEdit,
  });
  const pendingQ = useQuery({
    queryKey: ["property-upload-status", property.id],
    queryFn: () => listPendingDocumentUploads({ data: { property_id: property.id } }),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((item) =>
        ["pending", "verification_queued", "verification_running"].includes(item.status),
      )
        ? 3000
        : false,
  });
  const jobsQ = useQuery({
    queryKey: ["property-extraction-jobs", property.id],
    queryFn: () => listExtractionJobs({ data: { property_id: property.id } }),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((item) => ["queued", "running"].includes(item.status))
        ? 3000
        : false,
  });
  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
    enabled: canEdit,
  });
  const permitCasesQ = useQuery({
    queryKey: ["permit-cases", workspaceId],
    queryFn: () => listPermitCases({ data: { workspace_id: workspaceId } }),
    enabled: canEdit,
  });
  const contactsQ = useQuery({
    queryKey: ["relationships", workspaceId],
    queryFn: () => listRelationshipContacts({ data: { workspace_id: workspaceId } }),
    enabled: canEdit,
  });
  const docFn = useServerFn(linkPropertyDocument);
  const contactFn = useServerFn(linkPropertyContact);
  const urlFn = useServerFn(getDocumentUrl);
  const deleteFn = useServerFn(deleteDocument);
  const cancelDeleteFn = useServerFn(cancelDocumentDeletion);
  const retryFn = useServerFn(retryPendingDocumentUpload);
  const refreshFiles = () => {
    qc.invalidateQueries({ queryKey: ["property", property.id] });
    qc.invalidateQueries({
      queryKey: ["documents", "property-records", property.id, workspaceId],
    });
    qc.invalidateQueries({ queryKey: ["property-upload-status", property.id] });
    qc.invalidateQueries({ queryKey: ["property-extraction-jobs", property.id] });
  };
  const openDocument = useMutation({
    mutationFn: (id: string) => urlFn({ data: { id } }),
    onSuccess: ({ url }) => {
      if (!url) return toast.error("A download link could not be created.");
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const removeDocument = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      setDeletionTarget(null);
      refreshFiles();
      toast.success("Document removal queued");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const cancelRemoval = useMutation({
    mutationFn: (id: string) => cancelDeleteFn({ data: { id } }),
    onSuccess: () => {
      refreshFiles();
      toast.success("Document removal cancelled");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const retryUpload = useMutation({
    mutationFn: (id: string) => retryFn({ data: { id } }),
    onSuccess: () => {
      refreshFiles();
      toast.success("Verification queued again");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const attachDocument = useMutation({
    mutationFn: () => docFn({ data: { property_id: property.id, document_id: documentId } }),
    onSuccess: () => {
      setDocumentId("");
      qc.invalidateQueries({ queryKey: ["property", property.id] });
      qc.invalidateQueries({ queryKey: ["property-activity", property.id] });
      toast.success("Document linked");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const attachContact = useMutation({
    mutationFn: () =>
      contactFn({ data: { property_id: property.id, contact_id: contactId, role: "other" } }),
    onSuccess: () => {
      setContactId("");
      qc.invalidateQueries({ queryKey: ["property", property.id] });
      qc.invalidateQueries({ queryKey: ["property-activity", property.id] });
      toast.success("Contact linked");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const projectIds = new Set(
    (projectsQ.data ?? [])
      .filter((item) => (item.workspace_id ?? null) === workspaceId)
      .map((item) => item.id),
  );
  const permitCaseIds = new Set((permitCasesQ.data ?? []).map((item: { id: string }) => item.id));
  const availableDocs = (docsQ.data ?? []).filter(
    (item) =>
      !item.property_id &&
      ((item.project_id && projectIds.has(item.project_id)) ||
        (item.permit_case_id && permitCaseIds.has(item.permit_case_id))) &&
      !documents.some((linked) => linked.id === item.id),
  );
  const availableContacts = (contactsQ.data ?? []).filter(
    (item: { id: string }) => !contacts.some((linked) => linked.contact_id === item.id),
  );
  const supersededDocumentIds = new Set(
    documents.map((document) => document.replaces_document_id).filter(Boolean),
  );
  const jobsByDocumentId = useMemo(
    () =>
      new Map(
        (jobsQ.data ?? [])
          .filter((item) => item.document_id)
          .map((item) => [item.document_id as string, item]),
      ),
    [jobsQ.data],
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="surface-editorial p-6">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <h2 className="font-semibold">Documents</h2>
        </div>
        {documents.length ? (
          <div className="mt-4 space-y-2">
            {documents.map((document) => {
              const job = jobsByDocumentId.get(document.id);
              const isLatestVersion = !supersededDocumentIds.has(document.id);
              return (
                <div key={document.id} className="rounded-lg border border-border px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{document.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {document.category || document.file_type || "Document"} · Version{" "}
                        {document.version_number ?? 1} ·{" "}
                        {document.deletion_requested_at
                          ? "removal queued"
                          : job?.status || document.extraction_status}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Added {new Date(document.upload_date).toLocaleString("en-CA")}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Open ${document.name}`}
                        onClick={() => openDocument.mutate(document.id)}
                      >
                        <Download className="size-4" />
                      </Button>
                      {canEdit && isLatestVersion && !document.deletion_requested_at && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Upload a new version of ${document.name}`}
                          onClick={() => setReplacement(document)}
                        >
                          <RefreshCw className="size-4" />
                        </Button>
                      )}
                      {canEdit && isLatestVersion && !document.deletion_requested_at && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${document.name}`}
                          onClick={() => {
                            if (replacement?.id === document.id) setReplacement(null);
                            setDeletionTarget(document);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                      {canEdit && isLatestVersion && document.deletion_requested_at && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Cancel removal of ${document.name}`}
                          disabled={cancelRemoval.isPending}
                          onClick={() => cancelRemoval.mutate(document.id)}
                        >
                          <Undo2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No documents linked.</p>
        )}
        {(pendingQ.data ?? []).some(
          (item) => !["finalized", "duplicate"].includes(item.status),
        ) && (
          <div className="mt-4 space-y-2" aria-live="polite">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Upload activity
            </p>
            {(pendingQ.data ?? [])
              .filter((item) => !["finalized", "duplicate"].includes(item.status))
              .map((item) => (
                <div key={item.id} className="rounded-lg border border-border px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{item.file_name}</span>
                    <Badge
                      variant={
                        item.status === "failed" || item.status === "rejected"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {String(item.status).replaceAll("_", " ")}
                    </Badge>
                  </div>
                  {item.failure_reason && (
                    <p className="mt-1 text-xs text-muted-foreground">{item.failure_reason}</p>
                  )}
                  {canEdit && item.retry_allowed && (
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      onClick={() => retryUpload.mutate(item.id)}
                    >
                      Retry verification
                    </Button>
                  )}
                </div>
              ))}
          </div>
        )}
        {canEdit && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-3 text-xs text-muted-foreground">
              Upload directly to this property. These files remain scoped to the property record.
            </p>
            <DocumentDropzone
              projectId={null}
              propertyId={property.id}
              category="property_file"
              existingNames={documents.map((document) => document.name)}
              onChanged={() => {
                refreshFiles();
              }}
              helperText="PDF, Excel, Word, CSV, text, or images · 75 MB per file"
            />
          </div>
        )}
        {canEdit && replacement && (
          <div className="mt-5 rounded-lg border border-primary/25 bg-primary/5 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">New version of {replacement.name}</p>
                <p className="text-xs text-muted-foreground">
                  The existing version remains in the evidence chain.
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setReplacement(null)}>
                Cancel
              </Button>
            </div>
            <DocumentDropzone
              projectId={null}
              propertyId={property.id}
              replacesDocumentId={replacement.id}
              category={replacement.category || "property_file"}
              existingNames={documents.map((document) => document.name)}
              onChanged={() => {
                setReplacement(null);
                refreshFiles();
              }}
              helperText="Choose the replacement file · the prior version is retained"
            />
          </div>
        )}
        <Dialog
          open={Boolean(deletionTarget)}
          onOpenChange={(open) => {
            if (!open && !removeDocument.isPending) setDeletionTarget(null);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Remove {deletionTarget?.name ?? "document"}?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              The document will be locked immediately and its stored file will be removed by the
              cleanup worker. You can cancel while the request is still waiting or retryable.
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={removeDocument.isPending}
                onClick={() => setDeletionTarget(null)}
              >
                Keep document
              </Button>
              <Button
                variant="destructive"
                disabled={!deletionTarget || removeDocument.isPending}
                onClick={() => deletionTarget && removeDocument.mutate(deletionTarget.id)}
              >
                {removeDocument.isPending ? "Queueing…" : "Remove document"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {canEdit && availableDocs.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <AttachSelect
              label="Link document"
              value={documentId}
              onValueChange={setDocumentId}
              options={availableDocs.map((item: any) => ({ value: item.id, label: item.name }))}
              onAttach={() => attachDocument.mutate()}
              pending={attachDocument.isPending}
            />
          </div>
        )}
      </Card>
      <Card className="surface-editorial p-6">
        <div className="flex items-center gap-2">
          <ContactRound className="size-4 text-primary" />
          <h2 className="font-semibold">Contacts</h2>
        </div>
        {contacts.length ? (
          <div className="mt-4 space-y-2">
            {contacts.map((link) => {
              const contact = link.contact ?? {};
              return (
                <div key={link.id} className="rounded-lg border border-border px-4 py-3">
                  <div className="truncate text-sm font-medium">
                    {contact.full_name || "Unnamed contact"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {[link.role, contact.company, contact.email].filter(Boolean).join(" · ")}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No contacts linked.</p>
        )}
        {canEdit && availableContacts.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <AttachSelect
              label="Link contact"
              value={contactId}
              onValueChange={setContactId}
              options={availableContacts.map((item: any) => ({
                value: item.id,
                label: [item.full_name, item.company].filter(Boolean).join(" · "),
              }))}
              onAttach={() => attachContact.mutate()}
              pending={attachContact.isPending}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

function PropertyTasks({
  propertyId,
  workspaceId,
  tasks,
  canEdit,
}: {
  propertyId: string;
  workspaceId: string | null;
  tasks: PropertyDetail["tasks"];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [dueAt, setDueAt] = useState("");
  const [nextAction, setNextAction] = useState(false);
  const [assignedTo, setAssignedTo] = useState("");
  const qc = useQueryClient();
  const saveFn = useServerFn(savePropertyTask);
  const membersQ = useQuery({
    queryKey: ["workspace-members", workspaceId ?? PERSONAL_WORKSPACE_ID],
    queryFn: () =>
      listWorkspaceMembers({
        data: { workspace_id: workspaceId ?? PERSONAL_WORKSPACE_ID },
      }),
  });
  const members = membersQ.data ?? [];
  const memberNames = new Map(
    members.map((member) => [member.user_id, member.full_name || member.email || "Team member"]),
  );
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          property_id: propertyId,
          title,
          notes: notes.trim() || null,
          status: "todo",
          priority,
          due_at: dueAt ? `${dueAt}T17:00:00.000Z` : null,
          is_next_action: nextAction,
          assigned_to: assignedTo || null,
        },
      }),
    onSuccess: () => {
      setOpen(false);
      setTitle("");
      setNotes("");
      setDueAt("");
      setNextAction(false);
      setAssignedTo("");
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["property-activity", propertyId] });
      toast.success("Task added");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const toggle = useMutation({
    mutationFn: (task: any) =>
      saveFn({
        data: {
          id: task.id,
          property_id: propertyId,
          title: task.title,
          status: task.status === "done" ? "todo" : "done",
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["property-activity", propertyId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const ordered = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          Number(Boolean(b.is_next_action)) - Number(Boolean(a.is_next_action)) ||
          String(a.due_at ?? "9999").localeCompare(String(b.due_at ?? "9999")),
      ),
    [tasks],
  );
  return (
    <Card className="surface-editorial p-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeading
          title="Tasks and next actions"
          subtitle="Keep ownership and deadlines beside the property record."
        />
        {canEdit && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 size-4" />
            Add task
          </Button>
        )}
      </div>
      {ordered.length ? (
        <div className="mt-5 divide-y divide-border rounded-lg border border-border">
          {ordered.map((task) => (
            <div key={task.id} className="flex items-start gap-3 px-4 py-3">
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => toggle.mutate(task)}
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border hover:border-primary"
                  aria-label={
                    task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`
                  }
                >
                  {task.status === "done" && <Check className="size-4 text-success" />}
                </button>
              ) : (
                <span
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border"
                  aria-label={task.status === "done" ? "Completed" : "Not completed"}
                >
                  {task.status === "done" && <Check className="size-4 text-success" />}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={`text-sm font-medium ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}
                >
                  {task.title}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{task.status.replaceAll("_", " ")}</span>
                  <span className="capitalize">{task.priority}</span>
                  {task.due_at && (
                    <span>Due {new Date(task.due_at).toLocaleDateString("en-CA")}</span>
                  )}
                  {task.assigned_to && (
                    <span>{memberNames.get(task.assigned_to) ?? "Assigned"}</span>
                  )}
                  {task.is_next_action && <Badge variant="secondary">Next action</Badge>}
                </div>
                {task.notes && <p className="mt-2 text-xs text-muted-foreground">{task.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">No tasks yet.</p>
      )}
      {canEdit && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add property task</DialogTitle>
            </DialogHeader>
            <Field label="Task" required>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Confirm zoning with the municipality"
              />
            </Field>
            <Field label="Priority">
              {(props) => (
                <Select
                  value={priority}
                  onValueChange={(value) =>
                    setPriority(value as "low" | "normal" | "high" | "urgent")
                  }
                >
                  <SelectTrigger {...props}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Due date">
              <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </Field>
            <Field label="Owner">
              {(props) => (
                <Select
                  value={assignedTo || "unassigned"}
                  onValueChange={(value) => setAssignedTo(value === "unassigned" ? "" : value)}
                >
                  <SelectTrigger {...props}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>
                        {member.full_name || member.email || "Team member"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Notes">
              <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 text-sm">
              <input
                type="checkbox"
                checked={nextAction}
                onChange={(event) => setNextAction(event.target.checked)}
              />
              Make this the next action
            </label>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!title.trim() || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Adding…" : "Add task"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function PropertyHistory({
  propertyId,
  initialActivities,
  total,
  nextCursor,
  workspaceId,
  currentUserId,
}: {
  propertyId: string;
  initialActivities: any[];
  total: number;
  nextCursor: PropertyActivityCursor | null;
  workspaceId: string | null;
  currentUserId: string;
}) {
  const membersQ = useQuery({
    queryKey: ["workspace-members", workspaceId ?? PERSONAL_WORKSPACE_ID],
    queryFn: () =>
      listWorkspaceMembers({ data: { workspace_id: workspaceId ?? PERSONAL_WORKSPACE_ID } }),
  });
  const memberNames = new Map(
    (membersQ.data ?? []).map((member) => [
      member.user_id,
      member.full_name || member.email || "Workspace member",
    ]),
  );
  const activityQ = useInfiniteQuery({
    queryKey: ["property-activity", propertyId],
    initialPageParam: null as PropertyActivityCursor | null,
    queryFn: ({ pageParam }) =>
      listPropertyActivity({
        data: {
          property_id: propertyId,
          before_created_at: pageParam?.created_at ?? null,
          before_id: pageParam?.id ?? null,
          limit: 50,
        },
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialData: {
      pages: [
        {
          items: initialActivities,
          total,
          next_cursor: nextCursor,
        },
      ],
      pageParams: [null],
    },
  });
  const activities = activityQ.data.pages.flatMap((page) => page.items);
  const resultTotal = activityQ.data.pages[0]?.total ?? total;
  return (
    <Card className="surface-editorial p-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeading
          title="Property history"
          subtitle="An immutable record of what changed, who changed it, and when."
        />
        <Badge variant="outline" className="shrink-0">
          {resultTotal} {resultTotal === 1 ? "event" : "events"}
        </Badge>
      </div>
      {activities.length ? (
        <ol className="relative mt-6 space-y-0 border-l border-border pl-6">
          {activities.map((event) => (
            <li key={event.id} className="relative pb-6 last:pb-0">
              <span className="absolute -left-[1.82rem] top-0.5 flex size-3 rounded-full border-2 border-background bg-primary" />
              <div className="text-sm font-medium">{activityLabel(event.event_type)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(event.created_at).toLocaleString("en-CA")} ·{" "}
                {activityActor(event.actor_id, currentUserId, memberNames)} ·{" "}
                {event.entity_type.replaceAll("_", " ")}
              </div>
              {event.reason && <p className="mt-2 text-sm text-muted-foreground">{event.reason}</p>}
              <HistoryStateDiff
                before={event.before_state}
                after={event.after_state}
                metadata={event.metadata}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">No activity has been recorded.</p>
      )}
      {activityQ.hasNextPage && (
        <div className="mt-6 border-t border-border pt-4 text-center">
          <Button
            variant="outline"
            disabled={activityQ.isFetchingNextPage}
            onClick={() => activityQ.fetchNextPage()}
          >
            {activityQ.isFetchingNextPage
              ? "Loading…"
              : `Load older events (${activities.length} of ${resultTotal} shown)`}
          </Button>
        </div>
      )}
      {activityQ.isFetchNextPageError && (
        <p className="mt-3 text-center text-sm text-destructive" role="alert">
          Older history could not be loaded. Try again.
        </p>
      )}
    </Card>
  );
}

function activityActor(
  actorId: string | null,
  currentUserId: string,
  memberNames: Map<string, string>,
) {
  if (!actorId) return "System";
  if (actorId === currentUserId) return "You";
  return memberNames.get(actorId) ?? "Former workspace member";
}

function ArchivePropertyDialog({
  open,
  onOpenChange,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  propertyId: string;
}) {
  const [reason, setReason] = useState("");
  const router = useRouter();
  const archiveFn = useServerFn(archiveProperty);
  const archive = useMutation({
    mutationFn: () => archiveFn({ data: { id: propertyId, reason } }),
    onSuccess: () => {
      toast.success("Property archived");
      router.navigate({ to: "/properties" });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Archive this property?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The history and linked work remain available. Archived properties are hidden from the
          default search.
        </p>
        <Field label="Reason" required>
          <Textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this property leaving active review?"
          />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || archive.isPending}
            onClick={() => archive.mutate()}
          >
            {archive.isPending ? "Archiving…" : "Archive property"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
