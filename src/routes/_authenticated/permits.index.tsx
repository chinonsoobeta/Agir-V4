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
import { ClipboardCheck, FileWarning, Plus, Search } from "lucide-react";
import { PERMIT_LIMITATIONS_TEXT } from "@/lib/permit-limitations";
export const Route = createFileRoute("/_authenticated/permits/")({
  head: () => ({ meta: [{ title: "Permits | Agir" }] }),
  component: PermitDashboard,
});
function PermitDashboard() {
  const { activeWorkspace } = useWorkspace();
  const [search, setSearch] = useState("");
  const workspaceId = activeWorkspace?.name === "Personal workspace" ? null : activeWorkspace?.id;
  const { data = [], isLoading } = useQuery({
    queryKey: ["permit-cases", workspaceId],
    queryFn: () => listPermitCases({ data: { workspace_id: workspaceId } }),
  });
  const q = search.toLowerCase();
  const rows = data.filter((c: any) =>
    `${c.name} ${c.property_address ?? ""} ${c.municipality ?? ""} ${(c.project_permits ?? []).map((p: any) => p.name).join(" ")}`
      .toLowerCase()
      .includes(q),
  );
  const review = data.filter((c: any) =>
    (c.project_permits ?? []).some((p: any) =>
      ["unknown", "needs_review", "potentially_required"].includes(p.applicability_status),
    ),
  ).length;
  const missing = data.reduce(
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
        subtitle="Evidence-backed planning and tracking, separate from underwriting assumptions."
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
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Active cases" value={data.length} />
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
        </div>
        {isLoading ? (
          <p>Loading permit cases…</p>
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
                  <Card className="h-full p-5 transition-colors hover:border-primary/50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">{c.name}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {c.property_address || "Address incomplete"}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {c.project_id ? "Underwriting-linked" : "Standalone"}
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
          <Card className="p-10 text-center">
            <ClipboardCheck className="mx-auto size-9 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">No permit cases yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Start with what you know. Missing information can remain explicitly unknown.
            </p>
            <Link to="/permits/new">
              <Button className="mt-5">Start a permit project</Button>
            </Link>
          </Card>
        )}
        <Card className="border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <div className="flex gap-3">
            <FileWarning className="mt-0.5 size-4 shrink-0" />
            <p>{PERMIT_LIMITATIONS_TEXT}</p>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </Card>
  );
}
