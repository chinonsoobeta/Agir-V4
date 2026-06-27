import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listDocuments,
  deleteDocument,
  analyzeDocument,
  getDocumentUrl,
} from "@/lib/documents.functions";
import { listProjects } from "@/lib/projects.functions";
import { listAssumptionsAcrossProjects } from "@/lib/assumptions.functions";
import { PageHeader } from "@/components/app-shell";
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
import { FileText, Trash2, Sparkles, Download, Link2, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DocumentDropzone } from "@/components/document-dropzone";

const docsQ = queryOptions({
  queryKey: ["documents", "all"],
  queryFn: () => listDocuments({ data: {} }),
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

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({ meta: [{ title: "Documents | Agir" }] }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(docsQ),
      context.queryClient.ensureQueryData(projectsQ),
      context.queryClient.ensureQueryData(allAssumptionsQ),
    ]),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { data: docs } = useSuspenseQuery(docsQ);
  const { data: projects } = useSuspenseQuery(projectsQ);
  const { data: allAssumptions } = useSuspenseQuery(allAssumptionsQ);

  // Which document contributed which assumptions: the provenance link.
  const contributions = new Map<string, string[]>();
  for (const a of allAssumptions as any[]) {
    if (!a.source_document_id) continue;
    const arr = contributions.get(a.source_document_id) ?? [];
    arr.push(a.field_label);
    contributions.set(a.source_document_id, arr);
  }
  const analysed = docs.filter((d: any) => d.ai_summary).length;
  const contributing = docs.filter((d: any) => contributions.has(d.id)).length;
  const totalContribued = (allAssumptions as any[]).filter((a) => a.source_document_id).length;
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
  });
  const analyze = useMutation({
    mutationFn: (d: any) => analyzeFn({ data: { id: d.id, name: d.name, category: d.category } }),
    onSuccess: () => toast.success("AI analysis ready"),
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
      <div className="p-8 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Cov label="Documents" value={String(docs.length)} />
          <Cov label="Analysed" value={`${analysed} / ${docs.length}`} />
          <Cov label="Contributing Data" value={`${contributing} / ${docs.length}`} />
          <Cov label="Assumptions Extracted" value={String(totalContribued)} />
        </div>
        <Card className="p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Assign to deal
              </label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>: Unassigned : </SelectItem>
                  {validProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Category
              </label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
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
            </div>
          </div>
          <DocumentDropzone
            projectId={projectId !== UNASSIGNED ? projectId : null}
            category={category}
            existingNames={docs.map((d: any) => d.name)}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ["documents", "all"] });
              qc.invalidateQueries({ queryKey: ["assumptions", "all"] });
            }}
          />
        </Card>

        {docs.length === 0 ? (
          <Card className="p-12 text-center text-sm text-muted-foreground">
            No documents yet. PDF · Excel · Word · Images supported.
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {docs.map((d) => (
              <Card key={d.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="size-5 text-primary shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{d.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {d.category || "Not available"} ·{" "}
                        {new Date(d.upload_date).toLocaleDateString()}
                      </div>
                      {contributions.has(d.id) ? (
                        <Badge
                          variant="outline"
                          className="mt-1.5 text-[10px] bg-success/10 text-success border-success/30"
                        >
                          <Link2 className="size-3 mr-1" />
                          {contributions.get(d.id)!.length} assumptions
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="mt-1.5 text-[10px] text-muted-foreground"
                        >
                          No data extracted
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => download(d.id)}
                    >
                      <Download className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => del.mutate(d.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                {d.ai_summary ? (
                  <div className="mt-3 space-y-2 text-xs">
                    <div>
                      <span className="text-primary font-semibold uppercase tracking-widest text-[10px]">
                        Summary
                      </span>
                      <p className="mt-1 text-muted-foreground">{d.ai_summary}</p>
                    </div>
                    {d.ai_risks && (
                      <div>
                        <span className="text-destructive font-semibold uppercase tracking-widest text-[10px]">
                          Risks
                        </span>
                        <p className="mt-1 text-muted-foreground">{d.ai_risks}</p>
                      </div>
                    )}
                  </div>
                ) : d.status === "extraction_failed" && d.extraction_error ? (
                  <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-destructive font-semibold">
                      <AlertTriangle className="size-3" /> Extraction failed
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{d.extraction_error}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full mt-2"
                      onClick={() => analyze.mutate(d)}
                      disabled={analyze.isPending}
                    >
                      <Sparkles className="size-3.5 mr-1" />
                      Retry extraction
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-3"
                    onClick={() => analyze.mutate(d)}
                    disabled={analyze.isPending}
                  >
                    <Sparkles className="size-3.5 mr-1" />
                    Run AI analysis
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Cov({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="num text-2xl mt-1.5">{value}</div>
    </Card>
  );
}
