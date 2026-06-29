import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { listProjects } from "@/lib/projects.functions";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { DealSelector } from "@/components/deal-selector";
import { CommitteePanel } from "@/components/committee-panel";

const projectsQ = queryOptions({ queryKey: ["projects"], queryFn: () => listProjects() });

export const Route = createFileRoute("/_authenticated/committee")({
  head: () => ({ meta: [{ title: "Investment Committee | Agir" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    deal: typeof s.deal === "string" ? s.deal : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQ),
  component: CommitteePage,
});

function CommitteePage() {
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
      <PageHeader
        eyebrow="Decision"
        title="Investment Committee"
        subtitle="Recommendation, conditions, and the recorded decision: with a permanent audit trail."
      />
      <PageBody>
        {projects.length === 0 ? (
          <Card className="p-16 text-center elevated">
            <p className="text-sm text-muted-foreground">No deals to bring to committee yet.</p>
          </Card>
        ) : (
          <>
            <DealSelector projects={projects} value={dealId} onChange={setDealId} />
            {dealId && <CommitteePanel key={dealId} projectId={dealId} />}
          </>
        )}
      </PageBody>
    </>
  );
}
