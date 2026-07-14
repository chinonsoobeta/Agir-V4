import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, FileText, Table2, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/lib/preferences";
import { listPortfolio, listDecisionHistory } from "@/lib/portfolio.functions";
import { assetTypeLabel } from "@/lib/asset-types";
import { PIPELINE_STAGES } from "@/lib/decision";
import {
  PORTFOLIO_REPORT_IDS,
  buildPortfolioReport,
  buildDecisionHistory,
  type PortfolioReportId,
} from "@/lib/reports/portfolio-analytics";
import { formatReportCell, isRightAligned } from "@/lib/reports/format-cell";
import { reportToCsv, downloadReportXlsx, downloadReportPdf } from "@/lib/reports/analytics-export";

const REPORT_LABEL: Record<PortfolioReportId, string> = {
  pipeline_conversion: "Pipeline conversion",
  capital_deployment: "Capital deployment",
  deal_velocity: "Deal velocity",
  risk_confidence: "Risk & confidence",
  upcoming_deadlines: "Upcoming deadlines",
  concentration: "Concentration",
  decision_history: "Decision history",
  sourcing: "Sourcing",
};

function triggerTextDownload(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function PortfolioReports() {
  const { fmt } = usePreferences();
  const [reportId, setReportId] = useState<PortfolioReportId>("pipeline_conversion");
  const [assetType, setAssetType] = useState("all");
  const [stage, setStage] = useState("all");
  const [risk, setRisk] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);

  const portfolioQ = useQuery({ queryKey: ["portfolio"], queryFn: () => listPortfolio() });
  const decisionsQ = useQuery({
    queryKey: ["decision-history"],
    queryFn: () => listDecisionHistory(),
  });

  const deals = useMemo(() => portfolioQ.data ?? [], [portfolioQ.data]);
  const assetTypes = useMemo(() => [...new Set(deals.map((d) => d.type))], [deals]);

  const filtered = useMemo(
    () =>
      deals.filter(
        (d) =>
          (assetType === "all" || d.type === assetType) &&
          (stage === "all" || d.stage === stage) &&
          (risk === "all" || d.riskRating === risk),
      ),
    [deals, assetType, stage, risk],
  );

  const asOfDate = portfolioQ.dataUpdatedAt ? new Date(portfolioQ.dataUpdatedAt) : new Date();
  const asOf = fmt.date(asOfDate, { dateStyle: "medium", timeStyle: "short" });

  const report = useMemo(() => {
    if (reportId === "decision_history") {
      const ids = new Set(filtered.map((d) => d.id));
      const scoped = (decisionsQ.data ?? []).filter(
        (d) => ids.size === deals.length || ids.has(d.project_id),
      );
      return buildDecisionHistory(scoped);
    }
    return buildPortfolioReport(reportId, filtered, asOfDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, filtered, decisionsQ.data]);

  const isLoading =
    portfolioQ.isLoading || (reportId === "decision_history" && decisionsQ.isLoading);
  const fileBase = `agir_${reportId}_${asOfDate.toISOString().slice(0, 10)}`;

  async function onExport(kind: "csv" | "xlsx" | "pdf") {
    try {
      setBusy(kind);
      const title = REPORT_LABEL[report.id];
      if (kind === "csv") {
        triggerTextDownload(
          reportToCsv(report, title, asOf),
          `${fileBase}.csv`,
          "text/csv;charset=utf-8",
        );
      } else if (kind === "xlsx") {
        await downloadReportXlsx(report, title, asOf, `${fileBase}.xlsx`);
      } else {
        await downloadReportPdf(report, title, asOf, `${fileBase}.pdf`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Report picker */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
        tabIndex={0}
        role="region"
        aria-label="Report views"
      >
        {PORTFOLIO_REPORT_IDS.map((id) => (
          <button
            key={id}
            onClick={() => setReportId(id)}
            className={cn(
              "whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              reportId === id
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent/40",
            )}
          >
            {REPORT_LABEL[id]}
          </button>
        ))}
      </div>

      {/* Filters + exports */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect value={assetType} onChange={setAssetType} placeholder="All asset types">
            <SelectItem value="all">All asset types</SelectItem>
            {assetTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {assetTypeLabel(t)}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect value={stage} onChange={setStage} placeholder="All stages">
            <SelectItem value="all">All stages</SelectItem>
            {PIPELINE_STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect value={risk} onChange={setRisk} placeholder="All risk">
            <SelectItem value="all">All risk</SelectItem>
            {["Low", "Moderate", "High", "Critical"].map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </FilterSelect>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExport("csv")}
            disabled={!!busy || isLoading}
          >
            {busy === "csv" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            <span className="ml-1.5">CSV</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExport("xlsx")}
            disabled={!!busy || isLoading}
          >
            {busy === "xlsx" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-3.5" />
            )}
            <span className="ml-1.5">Excel</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExport("pdf")}
            disabled={!!busy || isLoading}
          >
            {busy === "pdf" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileText className="size-3.5" />
            )}
            <span className="ml-1.5">PDF</span>
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      {!isLoading && report.summary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {report.summary.map((s) => (
            <Card key={s.label} className="p-3">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {s.label}
              </div>
              <div className="num text-lg mt-1">{formatReportCell(s.value, s.type, fmt)}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden elevated">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin mx-auto mb-2" />
            Loading…
          </div>
        ) : report.rows.length === 0 ? (
          <div className="p-12 text-center">
            <Table2 className="size-6 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No rows for this report and filter set.</p>
          </div>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Portfolio report table"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/35 text-[11px] uppercase tracking-widest text-muted-foreground">
                  {report.columns.map((c) => (
                    <th
                      key={c.key}
                      className={cn(
                        "px-4 py-2.5 font-medium",
                        isRightAligned(c.type) ? "text-right" : "text-left",
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={i} className="border-t border-border hover:bg-accent/20">
                    {report.columns.map((c, ci) => {
                      const content = formatReportCell(row.cells[c.key], c.type, fmt);
                      const linkable = ci === 0 && row.dealId;
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            "px-4 py-2.5",
                            isRightAligned(c.type) ? "text-right num" : "text-left",
                          )}
                        >
                          {linkable ? (
                            <Link
                              to="/projects/$id"
                              params={{ id: row.dealId! }}
                              className="text-primary hover:underline font-medium"
                            >
                              {content}
                            </Link>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Formula / provenance note */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="size-3.5 mt-0.5 shrink-0" />
        <div>
          <span className="text-foreground/70">Deterministic.</span> {report.formula}{" "}
          <span className="whitespace-nowrap">Data as of {asOf}</span>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs" aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
