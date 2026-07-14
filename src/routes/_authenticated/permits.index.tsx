import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listPermitCases } from "@/lib/permit-cases.functions";
import { PageBody, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/workspace-context";
import {
  AlertTriangle,
  Archive,
  ClipboardCheck,
  FileWarning,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  PERMIT_LIMITATIONS_APPROVAL_STATUS,
  PERMIT_LIMITATIONS_TEXT,
} from "@/lib/permit-limitations";
export const Route = createFileRoute("/_authenticated/permits/")({
  head: () => ({ meta: [{ title: "Permits | Agir" }] }),
  component: PermitDashboard,
});
function PermitDashboard() {
  const { activeWorkspace } = useWorkspace();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const workspaceId = activeWorkspace?.name === "Personal workspace" ? null : activeWorkspace?.id;
  const casesQ = useQuery({
    queryKey: ["permit-cases", workspaceId],
    queryFn: () => listPermitCases({ data: { workspace_id: workspaceId } }),
  });
  const data = casesQ.data ?? [];
  const activeCases = data.filter((c: any) => !c.archived_at);
  const visibleCases = showArchived ? data.filter((c: any) => c.archived_at) : activeCases;
  const q = search.toLowerCase();
  const rows = visibleCases.filter((c: any) =>
    `${c.name} ${c.property_address ?? ""} ${c.municipality ?? ""} ${(c.project_permits ?? []).map((p: any) => p.name).join(" ")}`
      .toLowerCase()
      .includes(q),
  );
  const review = activeCases.filter((c: any) =>
    (c.project_permits ?? []).some((p: any) =>
      ["unknown", "needs_review", "potentially_required"].includes(p.applicability_status),
    ),
  ).length;
  const missing = activeCases.reduce(
    (n: number, c: any) =>
      n +
      (c.project_permits ?? [])
        .flatMap((p: any) => p.permit_requirements ?? [])
        .filter((r: any) => r.is_required && r.status === "missing").length,
    0,
  );
  return (
    <>
      <PageHeader
        eyebrow="Permits"
        title="Permit cases"
        subtitle="Keep possible approvals, paperwork, documents, and responsibility together."
        actions={
          <Link to="/permits/new">
            <Button>
              <Plus className="mr-2 size-4" />
              Start a permit project
            </Button>
          </Link>
        }
      />
      <PageBody>
        {casesQ.isError ? (
          <Card className="surface-editorial p-6" role="alert">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <h2 className="font-semibold">Permit cases could not be loaded</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {casesQ.error instanceof Error
                    ? casesQ.error.message
                    : "The permit service returned an unexpected error."}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  No empty-case summary is shown because Agir could not verify the current records.
                </p>
                <Button className="mt-4" variant="outline" onClick={() => casesQ.refetch()}>
                  <RotateCcw className="mr-2 size-4" />
                  Try again
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Active cases" value={activeCases.length} />
              <Metric label="Cases needing review" value={review} />
              <Metric label="Missing paperwork" value={missing} />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <span className="sr-only">Search permit cases</span>
                <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search address, case, permit, or authority"
                />
              </label>
              <Button
                type="button"
                variant={showArchived ? "secondary" : "outline"}
                aria-pressed={showArchived}
                onClick={() => setShowArchived((value) => !value)}
              >
                <Archive className="mr-2 size-4" />
                {showArchived ? "Show active" : "Show archived"}
              </Button>
            </div>
            {casesQ.isLoading ? (
              <p role="status">Loading permit cases…</p>
            ) : rows.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {rows.map((c: any) => {
                  const permits = c.project_permits ?? [];
                  const needs = permits.filter((p: any) =>
                    ["unknown", "needs_review", "potentially_required"].includes(
                      p.applicability_status,
                    ),
                  ).length;
                  return (
                    <Link key={c.id} to="/permits/$caseId" params={{ caseId: c.id }}>
                      <Card className="surface-editorial h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h2 className="font-semibold">{c.name}</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {c.property_address || "Address incomplete"}
                            </p>
                          </div>
                          <Badge variant="outline">
                            {c.archived_at
                              ? "Archived"
                              : c.project_id
                                ? "Underwriting-linked"
                                : "Standalone"}
                          </Badge>
                        </div>
                        <div className="mt-4 flex gap-4 text-sm">
                          <span>{permits.length} potential approvals</span>
                          <span>{needs} need review</span>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                          {c.municipality_confirmed ? c.municipality : "Municipality unconfirmed"}
                        </p>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <Card className="surface-editorial p-10 text-center">
                <ClipboardCheck className="mx-auto size-9 text-muted-foreground" />
                <p className="eyebrow mt-5">Start a reviewed workflow</p>
                <h2 className="mt-3 font-semibold">
                  {showArchived ? "No archived cases" : "No permit cases yet"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {showArchived
                    ? "Archived cases stay searchable and can be restored from their case workspace."
                    : "Start with the property and the work. You can add missing details later."}
                </p>
                {!showArchived && (
                  <Link to="/permits/new">
                    <Button className="mt-5">Start a permit project</Button>
                  </Link>
                )}
              </Card>
            )}
          </>
        )}
        <Card className="trust-note p-4 text-sm">
          <div className="flex gap-3">
            <FileWarning className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Evidence stays reviewable</p>
              <p className="mt-1 leading-6 text-muted-foreground">{PERMIT_LIMITATIONS_TEXT}</p>
              <span className="status-chip mt-3">{PERMIT_LIMITATIONS_APPROVAL_STATUS} wording</span>
            </div>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="surface-editorial metric-card">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold tracking-[-0.04em]">{value}</p>
    </Card>
  );
}
