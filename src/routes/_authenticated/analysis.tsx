import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { listProjects } from "@/lib/projects.functions";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { DealSelector } from "@/components/deal-selector";
import { AnalysisPanel } from "@/components/analysis-panel";

const projectsQ = queryOptions({ queryKey: ["projects"], queryFn: () => listProjects() });

export const Route = createFileRoute("/_authenticated/analysis")({
  head: () => ({ meta: [{ title: "Analysis | Agir" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    deal: typeof s.deal === "string" ? s.deal : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQ),
  component: AnalysisPage,
});

function AnalysisPage() {
  const { deal } = Route.useSearch();
  const { data: projects } = useSuspenseQuery(projectsQ);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const dealId =
    selectedDealId ??
    (deal && projects.some((project) => project.id === deal) ? deal : (projects[0]?.id ?? null));

  return (
    <>
      <PageHeader
        eyebrow="Underwriting"
        title="Analysis"
        subtitle="Base case, stress, sensitivity, drivers and covenants: what breaks the deal."
      />
      <PageBody>
        {projects.length === 0 ? (
          <Card className="surface-editorial p-16 text-center">
            <p className="eyebrow mb-3">Evidence-backed analysis</p>
            <p className="text-sm text-muted-foreground">Create a deal to run analysis.</p>
          </Card>
        ) : (
          <>
            <DealSelector projects={projects} value={dealId} onChange={setSelectedDealId} />
            {dealId && <AnalysisPanel key={dealId} projectId={dealId} />}
          </>
        )}
      </PageBody>
    </>
  );
}
