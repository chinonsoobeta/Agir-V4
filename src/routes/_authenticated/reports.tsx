// Reports: generate stakeholder-ready PDF/DOCX/XLSX reports from deterministic
// underwriting outputs. Project selector + four actionable report cards with
// readiness chips, last-generated timestamps, downloads, and an in-app preview.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  useQueries,
  useQuery,
  useMutation,
  useQueryClient,
  queryOptions,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listProjects } from "@/lib/projects.functions";
import {
  exportDealRunAuditPackage,
  generateReport,
  getReportReadiness,
} from "@/lib/reports.functions";
import {
  REPORT_DEFINITIONS,
  type ReportDefinition,
  type ReportFormat,
} from "@/lib/reports/report-definitions";
import type { MemoReport } from "@/lib/memo-report";
import type { Tables } from "@/integrations/supabase/types";
import {
  FileText,
  Shield,
  BarChart3,
  TrendingUp,
  Download,
  Eye,
  AlertTriangle,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PortfolioReports } from "@/components/portfolio-reports";
import { usePreferences } from "@/lib/preferences";

const projectsQ = queryOptions({ queryKey: ["projects"], queryFn: () => listProjects() });

type ProjectRow = Tables<"projects">;
type Readiness = Awaited<ReturnType<typeof getReportReadiness>>;
type ReportResult = Awaited<ReturnType<typeof generateReport>>;
type VerificationReport = ReportResult["verification_report"];

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports | Agir" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    project: typeof s.project === "string" ? s.project : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQ),
  component: ReportsPage,
});

const ICONS: Record<string, LucideIcon> = {
  investor_report: FileText,
  lender_package: Shield,
  executive_summary: BarChart3,
  internal_team_report: TrendingUp,
};
const STATUS_LABEL: Record<string, string> = {
  ready: "Ready",
  needs_underwriting: "Needs underwriting",
  needs_memo: "Needs memo",
  has_unresolved_errors: "Has unresolved errors",
  missing_project: "No project selected",
  missing_required_data: "Missing data",
};
const STATUS_STYLE: Record<string, string> = {
  ready: "bg-success/15 text-success border-success/30",
  has_unresolved_errors: "bg-warning/15 text-warning border-warning/30",
  needs_underwriting: "bg-warning/15 text-warning border-warning/30",
  needs_memo: "bg-warning/15 text-warning border-warning/30",
  missing_required_data: "bg-warning/15 text-warning border-warning/30",
  missing_project: "bg-muted text-muted-foreground border-border",
};

const safeName = (s: string) => String(s ?? "report").replace(/[^\w]+/g, "_");
const fmtTs = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : null);

function ReportsPage() {
  const { project: queryProject } = Route.useSearch();
  const { data: projects } = useSuspenseQuery(projectsQ);
  const { t } = usePreferences();
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) return;
    if (queryProject && projects.some((p) => p.id === queryProject)) setProjectId(queryProject);
    else if (projects.length) setProjectId(projects[0].id);
  }, [queryProject, projects, projectId]);

  return (
    <>
      <PageHeader
        eyebrow={t("page.reports.eyebrow")}
        title={t("page.reports.title")}
        subtitle={t("page.reports.subtitle")}
      />
      <PageBody>
        {/* Portfolio analytics: aggregate, filterable, exportable */}
        <section className="space-y-3">
          <div>
            <h2 className="display text-lg font-semibold">{t("rep.section.portfolio")}</h2>
            <p className="text-xs text-muted-foreground">{t("rep.deterministic")}</p>
          </div>
          <PortfolioReports />
        </section>

        {/* Deal documents: committee-ready packages per deal */}
        <section className="space-y-3">
          <div>
            <h2 className="display text-lg font-semibold">{t("rep.section.deal")}</h2>
            <p className="text-xs text-muted-foreground">
              Committee-ready PDF, DOCX and Excel packages built from a single deal's deterministic
              underwriting.
            </p>
          </div>
          {!projects.length ? (
            <Card className="surface-editorial p-12 text-center text-sm text-muted-foreground">
              No projects yet. Create or seed a project before generating deal documents.
            </Card>
          ) : (
            <>
              <ProjectSelector projects={projects} projectId={projectId} onChange={setProjectId} />
              {projectId && <ReportGrid key={projectId} projectId={projectId} />}
            </>
          )}
        </section>
      </PageBody>
    </>
  );
}

function ProjectSelector({
  projects,
  projectId,
  onChange,
}: {
  projects: ProjectRow[];
  projectId: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <Card className="surface-editorial flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="eyebrow">Project</label>
      <Select value={projectId ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-[260px]">
          <SelectValue placeholder="Select a project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {projectId && <AuditPackageButton projectId={projectId} />}
    </Card>
  );
}

function AuditPackageButton({ projectId }: { projectId: string }) {
  const exportFn = useServerFn(exportDealRunAuditPackage);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const pkg = (await exportFn({ data: { project_id: projectId } })) as {
        manifest: { project_id?: string | null };
      };
      const name = `${safeName(String(pkg.manifest.project_id ?? "deal"))}_audit_package.json`;
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Audit package downloaded. Validation passed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Audit package export failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={run}
      disabled={busy}
      title={busy ? "Generating audit package." : "Download the latest run audit package."}
    >
      {busy ? (
        <Loader2 className="size-3.5 mr-1 animate-spin" />
      ) : (
        <Shield className="size-3.5 mr-1" />
      )}
      Audit package
    </Button>
  );
}

function ReportGrid({ projectId }: { projectId: string }) {
  const readiness = useQueries({
    queries: REPORT_DEFINITIONS.map((def) => ({
      queryKey: ["report-readiness", projectId, def.type],
      queryFn: () => getReportReadiness({ data: { project_id: projectId, report_type: def.type } }),
    })),
  });
  const [preview, setPreview] = useState<{
    report: MemoReport;
    verification: VerificationReport;
    def: ReportDefinition;
  } | null>(null);

  return (
    <>
      <div className="grid md:grid-cols-2 gap-3">
        {REPORT_DEFINITIONS.map((def, i) => (
          <ReportCard
            key={def.type}
            def={def}
            projectId={projectId}
            readiness={readiness[i].data}
            loading={readiness[i].isLoading}
            onPreview={(report, verification) => setPreview({ report, verification, def })}
          />
        ))}
      </div>
      {preview && <ReportPreview preview={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function ReportCard({
  def,
  projectId,
  readiness,
  loading,
  onPreview,
}: {
  def: ReportDefinition;
  projectId: string;
  readiness: Readiness | undefined;
  loading: boolean;
  onPreview: (report: MemoReport, verification: VerificationReport) => void;
}) {
  const Icon = ICONS[def.type] ?? FileText;
  const qc = useQueryClient();
  const generateFn = useServerFn(generateReport);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = readiness?.ready ?? false;
  const status = readiness?.status ?? "ready";
  const warnings: string[] = readiness?.warnings ?? [];
  const blockers: string[] = readiness?.blocking_reasons ?? [];
  const lastGenerated = fmtTs(readiness?.latest_generated_at);

  const run = async (action: "preview" | ReportFormat) => {
    setError(null);
    setBusy(action);
    try {
      const res = await generateFn({ data: { project_id: projectId, report_type: def.type } });
      qc.invalidateQueries({ queryKey: ["report-readiness", projectId, def.type] });
      if (res.needs_review)
        toast.warning(`${def.title} generated but flagged needs review (provenance).`);
      if (action === "preview") {
        onPreview(res.report, res.verification_report);
        return;
      }
      const name = `${safeName(res.report.project_name)}_${safeName(def.title)}.${action}`;
      if (action === "pdf") {
        const { downloadMemoPdf } = await import("@/lib/memo-pdf");
        await downloadMemoPdf(res.report, name);
      } else if (action === "docx") {
        const { downloadMemoDocx } = await import("@/lib/memo-docx");
        await downloadMemoDocx(res.report, name);
      } else if (action === "xlsx") {
        const { downloadReportXlsx } = await import("@/lib/reports/report-xlsx");
        await downloadReportXlsx(res.report, name);
      }
      toast.success(`${def.title} ${action.toUpperCase()} downloaded`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[report ${def.type}] ${action} failed:`, e);
      setError(msg);
      toast.error(`${def.title}: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5 flex flex-col gap-3 elevated">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="size-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold">{def.title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{def.description}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge variant="outline" className={`text-xs ${STATUS_STYLE[status] ?? ""}`}>
              {loading ? "Checking…" : (STATUS_LABEL[status] ?? status)}
            </Badge>
            {readiness &&
              (readiness.counts.reconciliation_errors > 0 ||
                readiness.counts.reconciliation_warnings > 0) && (
                <span className="text-xs text-muted-foreground">
                  {readiness.counts.reconciliation_errors} errors /{" "}
                  {readiness.counts.reconciliation_warnings} warnings
                </span>
              )}
            {lastGenerated && (
              <span className="text-xs text-muted-foreground">Last generated: {lastGenerated}</span>
            )}
            {readiness?.outputs_freshness === "current" && (
              <Badge
                variant="outline"
                className="text-xs bg-success/10 text-success border-success/30"
              >
                Outputs current
              </Badge>
            )}
            {readiness?.outputs_freshness === "stale" && (
              <Badge
                variant="outline"
                className="text-xs bg-warning/10 text-warning border-warning/30"
              >
                Outputs stale
              </Badge>
            )}
            {readiness?.report_stale && (
              <Badge
                variant="outline"
                className="text-xs bg-warning/10 text-warning border-warning/30"
              >
                Report stale
              </Badge>
            )}
            {readiness?.latest_completed_run?.run_number && (
              <span className="text-xs text-muted-foreground">
                Run version v{readiness.latest_completed_run.run_number}
              </span>
            )}
          </div>
        </div>
      </div>

      {blockers.length > 0 && (
        <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded p-2">
          {blockers.map((b) => (
            <div key={b}>{b}</div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="text-xs text-warning bg-warning/5 border border-warning/20 rounded p-2 flex items-start gap-1.5">
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <div>
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        </div>
      )}
      {error && (
        <div className="text-xs text-destructive bg-destructive/5 border border-destructive/30 rounded p-2 font-mono break-words">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-auto">
        <Button size="sm" variant="outline" onClick={() => run("preview")} disabled={!!busy}>
          {busy === "preview" ? (
            <Loader2 className="size-3.5 mr-1 animate-spin" />
          ) : (
            <Eye className="size-3.5 mr-1" />
          )}
          {busy === "preview" ? "Generating preview…" : "Preview"}
        </Button>
        {def.supportedFormats.map((f) => (
          <Button
            key={f}
            size="sm"
            variant="outline"
            disabled={!ready || !!busy}
            onClick={() => run(f)}
          >
            {busy === f ? (
              <Loader2 className="size-3.5 mr-1 animate-spin" />
            ) : (
              <Download className="size-3.5 mr-1" />
            )}
            {busy === f ? `Generating ${f.toUpperCase()}…` : f.toUpperCase()}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function ReportPreview({
  preview,
  onClose,
}: {
  preview: { report: MemoReport; verification: VerificationReport; def: ReportDefinition };
  onClose: () => void;
}) {
  const { report, verification } = preview;
  const isReject = report.verdict_code === "REJECT";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {report.title}: {report.project_name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="text-xs text-muted-foreground">
            {report.subtitle} · {report.prepared}
          </div>
          {verification && !verification.pass && (
            <div className="text-xs text-warning bg-warning/5 border border-warning/20 rounded p-2">
              Needs review: {verification.orphans?.length ?? 0} numeric token(s) lacked provenance.
            </div>
          )}
          {report.verdict_banner && (
            <div
              className={`rounded px-3 py-2 text-sm font-semibold ${isReject ? "bg-destructive text-destructive-foreground" : report.verdict_code === "APPROVE" ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}`}
            >
              {report.verdict_banner}
            </div>
          )}
          {report.summary_stats?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {report.summary_stats.map((s) => (
                <div key={s.label} className="rounded border border-border p-2">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    {s.label}
                  </div>
                  <div className="num text-sm">{s.value}</div>
                </div>
              ))}
            </div>
          )}
          {report.metric_cards?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {report.metric_cards.map((c) => (
                <div key={c.label} className="rounded border border-border p-2">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    {c.label}
                  </div>
                  <div className="num text-base">{c.value}</div>
                </div>
              ))}
            </div>
          )}
          {report.sections?.map((sec, i) => (
            <div key={`${sec.heading}-${i}`}>
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-1">
                {sec.heading}
              </div>
              {sec.table && (
                <div className="overflow-x-auto">
                  <table className="data-grid w-full text-xs">
                    <thead>
                      <tr className="bg-muted/20">
                        {sec.table.columns.map((c: string) => (
                          <th key={c} className="text-left">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sec.table.rows.map((r: string[], ri: number) => (
                        <tr key={ri}>
                          {r.map((cell, ci) => (
                            <td key={ci} className={ci === 0 ? "font-medium" : "num"}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sec.body && <p className="whitespace-pre-wrap">{sec.body}</p>}
              {sec.table?.note && (
                <p className="text-xs italic text-muted-foreground mt-1">Note: {sec.table.note}</p>
              )}
            </div>
          ))}
          {report.footnotes?.length > 0 && (
            <div className="border-t border-border pt-2 space-y-1">
              {report.footnotes.map((f: string, i: number) => (
                <p key={i} className="text-xs text-muted-foreground">
                  {f}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 justify-end border-t border-border pt-3">
          {preview.def.supportedFormats.map((f) => (
            <Button
              key={f}
              size="sm"
              variant="outline"
              onClick={async () => {
                const name = `${safeName(report.project_name)}_${safeName(report.title)}.${f}`;
                if (f === "pdf") {
                  const { downloadMemoPdf } = await import("@/lib/memo-pdf");
                  await downloadMemoPdf(report, name);
                } else if (f === "docx") {
                  const { downloadMemoDocx } = await import("@/lib/memo-docx");
                  await downloadMemoDocx(report, name);
                } else if (f === "xlsx") {
                  const { downloadReportXlsx } = await import("@/lib/reports/report-xlsx");
                  await downloadReportXlsx(report, name);
                }
              }}
            >
              <Download className="size-3.5 mr-1" />
              {f.toUpperCase()}
            </Button>
          ))}
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
