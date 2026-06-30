import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { listProjects } from "@/lib/projects.functions";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { DealSelector } from "@/components/deal-selector";
import { CommitteePanel } from "@/components/committee-panel";
import { usePreferences } from "@/lib/preferences";

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
  const { t } = usePreferences();
  const { data: projects } = useSuspenseQuery(projectsQ);
  const [dealId, setDealId] = useState<string | null>(null);
  useEffect(() => {
    if (dealId) return;
    if (deal && projects.some((p) => p.id === deal)) setDealId(deal);
    else if (projects.length) setDealId(projects[0].id);
  }, [deal, projects, dealId]);

  return (
    <>
      <PageHeader
        eyebrow={t("page.committee.eyebrow")}
        title={t("nav.committee")}
        subtitle={t("page.committee.subtitle")}
      />
      <PageBody>
        {projects.length === 0 ? (
          <Card className="p-16 text-center elevated">
            <p className="text-sm text-muted-foreground">{t("committee.empty")}</p>
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
