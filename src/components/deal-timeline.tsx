import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  FileText,
  ClipboardCheck,
  LineChart,
  Gavel,
  CheckCircle2,
  FileBarChart,
  Plug,
  History,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/lib/preferences";
import { getDealTimeline } from "@/lib/timeline.functions";
import type { TimelineCategory } from "@/lib/timeline";

const CATEGORY: Record<TimelineCategory, { icon: any; cls: string }> = {
  deal: { icon: Briefcase, cls: "bg-primary/12 text-primary" },
  document: { icon: FileText, cls: "bg-chart-2/12 text-chart-2" },
  assumption: { icon: ClipboardCheck, cls: "bg-warning/12 text-warning" },
  underwriting: { icon: LineChart, cls: "bg-primary/12 text-primary" },
  decision: { icon: Gavel, cls: "bg-success/12 text-success" },
  milestone: { icon: CheckCircle2, cls: "bg-success/12 text-success" },
  report: { icon: FileBarChart, cls: "bg-chart-2/12 text-chart-2" },
  integration: { icon: Plug, cls: "bg-muted text-muted-foreground" },
  memo: { icon: FileText, cls: "bg-primary/12 text-primary" },
};

export function DealTimeline({ projectId }: { projectId: string }) {
  const { fmt, t } = usePreferences();
  const { data: events, isLoading } = useQuery({
    queryKey: ["timeline", projectId],
    queryFn: () => getDealTimeline({ data: { project_id: projectId } }),
  });

  if (isLoading) {
    return (
      <Card className="p-12 text-center text-sm text-muted-foreground elevated">
        <Loader2 className="size-5 animate-spin mx-auto mb-2" />
        {t("common.loading")}
      </Card>
    );
  }

  if (!events || events.length === 0) {
    return (
      <Card className="p-12 text-center elevated">
        <History className="size-6 text-muted-foreground/50 mx-auto mb-2" />
        <p className="text-sm font-medium">{t("empty.timeline.title")}</p>
        <p className="text-sm text-muted-foreground mt-1">{t("empty.timeline.body")}</p>
      </Card>
    );
  }

  return (
    <Card className="p-5 md:p-6 elevated">
      <ol className="relative">
        {events.map((e, i) => {
          const meta = CATEGORY[e.category] ?? CATEGORY.deal;
          const Icon = meta.icon;
          const last = i === events.length - 1;
          return (
            <li key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
              {!last && (
                <span className="absolute left-[15px] top-9 bottom-0 w-px bg-border" aria-hidden />
              )}
              <div
                className={cn(
                  "size-8 rounded-full flex items-center justify-center shrink-0 z-10",
                  meta.cls,
                )}
              >
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1 -mt-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm font-medium">{e.title}</span>
                  <span className="num text-[11px] text-muted-foreground whitespace-nowrap">
                    {fmt.date(e.at, { dateStyle: "medium", timeStyle: "short" } as any)}
                  </span>
                </div>
                {e.detail && (
                  <p className="text-xs text-muted-foreground mt-0.5 break-words">{e.detail}</p>
                )}
                {e.actor && (
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">by {e.actor}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
