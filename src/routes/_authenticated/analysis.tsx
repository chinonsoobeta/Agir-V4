import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { listProjects } from "@/lib/projects.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { DealSelector } from "@/components/deal-selector";
import { AnalysisPanel } from "@/components/analysis-panel";

const projectsQ = queryOptions({ queryKey: ["projects"], queryFn: () => listProjects() });

export const Route = createFileRoute("/_authenticated/analysis")({
  head: () => ({ meta: [{ title: "Analysis | Agir" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ deal: typeof s.deal === "string" ? s.deal : undefined }),
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQ),
  component: AnalysisPage,
});

function AnalysisPage() {
  const { deal } = Route.useSearch();
  const { data: projects } = useSuspenseQuery(projectsQ);
  const [dealId, setDealId] = useState<string | null>(null);
  useEffect(() => {
    if (dealId) return;
    if (deal && projects.some((p: any) => p.id === deal)) setDealId(deal);
    else if (projects.length) setDealId(projects[0].id);
  }, [deal, projects, dealId]);

  return (
    <>
      <PageHeader eyebrow="Underwriting" title="Analysis" subtitle="Base case, stress, sensitivity, drivers and covenants: what breaks the deal." />
      <div className="p-8 space-y-5">
        {projects.length === 0 ? (
          <Card className="p-16 text-center elevated"><p className="text-sm text-muted-foreground">Create a deal to run analysis.</p></Card>
        ) : (
          <>
            <DealSelector projects={projects} value={dealId} onChange={setDealId} />
            {dealId && <AnalysisPanel key={dealId} projectId={dealId} />}
          </>
        )}
      </div>
    </>
  );
}
