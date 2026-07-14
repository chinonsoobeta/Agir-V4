import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listDocuments,
  listPendingDocumentUploads,
  deleteDocument,
  analyzeDocument,
  getDocumentUrl,
} from "@/lib/documents.functions";
import { listProjects } from "@/lib/projects.functions";
import { listAssumptionsAcrossProjects } from "@/lib/assumptions.functions";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FileText, Trash2, Sparkles, Download, Link2, AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DocumentDropzone } from "@/components/document-dropzone";
import type { Tables } from "@/integrations/supabase/types";
import { statusClassName, statusConfig } from "@/lib/status-taxonomy";

type DocumentRow = Tables<"documents">;

const docsQ = queryOptions({
  queryKey: ["documents", "all"],
  queryFn: () => listDocuments({ data: {} }),
});
const pendingUploadsQ = queryOptions({
  queryKey: ["pending-document-uploads", "all"],
  queryFn: () => listPendingDocumentUploads({ data: {} }),
});
const projectsQ = queryOptions({ queryKey: ["projects"], queryFn: () => listProjects() });
const allAssumptionsQ = queryOptions({
  queryKey: ["assumptions", "all"],
  queryFn: () => listAssumptionsAcrossProjects(),
});

const CATEGORIES = [
  "Appraisal",
  "Budget",
  "Site Plan",
  "Financial Model",
  "Market Study",
  "Loan Package",
  "Legal",
  "Other",
];

// Raw upload names are underscore-joined ("Harbour_Centre_Rent_Roll.xlsx"); show
// a human title for the card and keep the exact filename in the tooltip.
function friendlyDocName(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/_+/g, " ")
      .trim() || name
  );
}

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({ meta: [{ title: "Documents | Agir" }] }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(docsQ),
      context.queryClient.ensureQueryData(pendingUploadsQ),
      context.queryClient.ensureQueryData(projectsQ),
      context.queryClient.ensureQueryData(allAssumptionsQ),
    ]),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { data: docs } = useSuspenseQuery(docsQ);
  const { data: pendingUploads } = useSuspenseQuery(pendingUploadsQ);
  const { data: projects } = useSuspenseQuery(projectsQ);
  const { data: allAssumptions } = useSuspenseQuery(allAssumptionsQ);

  // Which document contributed which assumptions: the provenance link.
  const contributions = new Map<string, string[]>();
  for (const a of allAssumptions) {
    if (!a.source_document_id) continue;
    const arr = contributions.get(a.source_document_id) ?? [];
    arr.push(a.field_label);
    contributions.set(a.source_document_id, arr);
  }
  const analysed = docs.filter((d) => d.ai_summary).length;
  const contributing = docs.filter((d) => contributions.has(d.id)).length;
  const totalContribued = allAssumptions.filter((a) => a.source_document_id).length;
  const qc = useQueryClient();
  const delFn = useServerFn(deleteDocument);
  const analyzeFn = useServerFn(analyzeDocument);
  const urlFn = useServerFn(getDocumentUrl);
  const UNASSIGNED = "unassigned";
  const [projectId, setProjectId] = useState<string>(UNASSIGNED);
  const validProjects = projects.filter((p) => p?.id && String(p.id).trim() !== "");
  const [category, setCategory] = useState<string>("Other");

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", "all"] });
      toast.success("Deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const analyze = useMutation({
    mutationFn: (d: DocumentRow) =>
      analyzeFn({ data: { id: d.id, name: d.name, category: d.category } }),
    onSuccess: (result) => {
      // Async mode: the server only queued the job; a worker executes it and
      // realtime refresh updates the row as it progresses.
      if (result && "queued" in result && result.queued) {
        toast.info("Analysis queued - a background worker will pick it up shortly.");
      } else {
        const mode = result && "generationMode" in result ? result.generationMode : null;
        toast.success(mode === "ai" ? "AI document summary ready" : "Document analysis ready");
      }
    },
    onError: (e: Error) => toast.error(e.message),
    // Refetch on success AND failure so a persisted extraction_failed status surfaces.
    onSettled: () => qc.invalidateQueries({ queryKey: ["documents", "all"] }),
  });

  async function download(id: string) {
    const { url } = await urlFn({ data: { id } });
    if (url) window.open(url, "_blank");
  }

  return (
    <>
      <PageHeader
        eyebrow="Data Room"
        title="Documents"
        subtitle={`${docs.length} documents · ${totalContribued} assumptions extracted`}
      />
      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Cov label="Documents" value={String(docs.length)} />
          <Cov label="Analysed" value={`${analysed} / ${docs.length}`} />
          <Cov label="Contributing Data" value={`${contributing} / ${docs.length}`} />
          <Cov label="Assumptions Extracted" value={String(totalContribued)} />
        </div>
        <Card className="surface-editorial space-y-4 p-5">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Assign to deal">
              {(f) => (
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger id={f.id} aria-describedby={f["aria-describedby"]}>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {validProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Category">
              {(f) => (
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id={f.id} aria-describedby={f["aria-describedby"]}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>
          <DocumentDropzone
            projectId={projectId !== UNASSIGNED ? projectId : null}
            category={category}
            existingNames={docs.map((d) => d.name)}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ["documents", "all"] });
              qc.invalidateQueries({ queryKey: ["pending-document-uploads", "all"] });
              qc.invalidateQueries({ queryKey: ["assumptions", "all"] });
            }}
          />
        </Card>

        {pendingUploads.length > 0 && (
          <Card className="p-4 space-y-2">
            <div>
              <div className="font-medium text-sm">Upload verification</div>
              <p className="text-xs text-muted-foreground">
                These objects are not documents yet and cannot feed extraction or underwriting.
              </p>
            </div>
            <div className="space-y-1.5">
              {pendingUploads.map((upload) => (
                <div key={upload.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{upload.file_name}</span>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {upload.status.replaceAll("_", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        )}

        {docs.length === 0 ? (
          <Card className="p-12 text-center text-sm text-muted-foreground">
            No documents yet. PDF · Excel · Word · Images supported.
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {docs.map((d) => (
              <Card key={d.id} className="surface-editorial p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="size-5 text-primary shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate" title={d.name}>
                        {friendlyDocName(d.name)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {d.category || "–"} · {new Date(d.upload_date).toLocaleDateString()}
                      </div>
                      {contributions.has(d.id) ? (
                        <Badge
                          variant="outline"
                          className="mt-1.5 text-xs bg-success/10 text-success border-success/30"
                        >
                          <Link2 className="size-3 mr-1" />
                          {contributions.get(d.id)!.length} assumptions
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="mt-1.5 text-xs text-muted-foreground">
                          No data extracted
                        </Badge>
                      )}
                      <DocumentStatusBadge d={d} />
                      <DocQuality d={d} />
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Download ${friendlyDocName(d.name)}`}
                      onClick={() => download(d.id)}
                    >
                      <Download className="size-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Delete ${friendlyDocName(d.name)}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {friendlyDocName(d.name)}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This also removes its assumption provenance.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del.mutate(d.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                {d.ai_summary ? (
                  <div className="mt-3 space-y-2 text-xs">
                    <div>
                      <span className="text-primary font-semibold uppercase tracking-widest text-[11px]">
                        Summary
                      </span>
                      <p className="mt-1 text-muted-foreground">{d.ai_summary}</p>
                    </div>
                    {d.ai_risks && (
                      <div>
                        <span className="text-destructive font-semibold uppercase tracking-widest text-[11px]">
                          Risks
                        </span>
                        <p className="mt-1 text-muted-foreground">{d.ai_risks}</p>
                      </div>
                    )}
                  </div>
                ) : d.status === "extraction_failed" && d.extraction_error ? (
                  <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-destructive font-semibold">
                      <AlertTriangle className="size-3" />{" "}
                      {statusConfig("document", "extraction_failed").label}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{d.extraction_error}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full mt-2"
                      onClick={() => analyze.mutate(d)}
                      disabled={analyze.isPending && analyze.variables?.id === d.id}
                    >
                      {analyze.isPending && analyze.variables?.id === d.id ? (
                        <Loader2 className="size-3.5 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="size-3.5 mr-1" />
                      )}
                      Retry extraction
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-3"
                    onClick={() => analyze.mutate(d)}
                    disabled={analyze.isPending && analyze.variables?.id === d.id}
                  >
                    {analyze.isPending && analyze.variables?.id === d.id ? (
                      <Loader2 className="size-3.5 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5 mr-1" />
                    )}
                    Run AI analysis
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}

// Per-document extraction confidence, surfaced so a low-confidence (OCR) doc is
// visibly flagged for analyst review BEFORE it can drive a verdict. OCR
// confidence < 70% is shown in warning colour; a rejected safety scan or a
// page-cap failure is shown as a hard flag.
function DocQuality({ d }: { d: DocumentRow }) {
  const conf = d.ocr_confidence == null ? null : Number(d.ocr_confidence);
  const lowConf = conf != null && conf < 70;
  const chips: { label: string; cls: string }[] = [];
  if (conf != null) {
    chips.push({
      label: `OCR ${Math.round(conf)}%${lowConf ? " · verify" : ""}`,
      cls: lowConf
        ? "bg-warning/10 text-warning border-warning/30"
        : "bg-success/10 text-success border-success/30",
    });
  }
  if (d.page_count) {
    chips.push({ label: `${d.page_count} pp`, cls: "text-muted-foreground" });
  }
  if (d.scan_status === "rejected") {
    const cfg = statusConfig("document", "rejected");
    chips.push({
      label: `scan: ${cfg.label.toLowerCase()}`,
      cls: statusClassName(cfg.severity),
    });
  } else if (d.scan_status === "clean") {
    chips.push({ label: "scan: clean", cls: "text-muted-foreground" });
  }
  if (d.extraction_status === "running") {
    const cfg = statusConfig("extractionJob", "running");
    chips.push({ label: cfg.label.toLowerCase(), cls: statusClassName(cfg.severity) });
  } else if (d.extraction_status === "queued") {
    const cfg = statusConfig("extractionJob", "queued");
    chips.push({ label: cfg.label.toLowerCase(), cls: statusClassName(cfg.severity) });
  }
  if (!chips.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((c) => (
        <Badge key={c.label} variant="outline" className={`text-[11px] ${c.cls}`}>
          {c.label}
        </Badge>
      ))}
    </div>
  );
}

function DocumentStatusBadge({ d }: { d: DocumentRow }) {
  const key =
    d.extraction_status === "failed" || d.status === "extraction_failed"
      ? "extraction_failed"
      : d.ai_summary
        ? "analyzed"
        : d.status || "uploaded";
  const cfg = statusConfig("document", key);
  return (
    <Badge variant="outline" className={`mt-1.5 text-xs ${statusClassName(cfg.severity)}`}>
      {cfg.label}
    </Badge>
  );
}

function Cov({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="num text-2xl mt-1.5">{value}</div>
    </Card>
  );
}
