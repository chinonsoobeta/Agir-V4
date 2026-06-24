import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Circle, ArrowRight, Sparkles, X, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { usePreferences, type TranslationKey } from "@/lib/preferences";
import {
  ONBOARDING_STEPS,
  getOnboardingState,
  setOnboardingDismissed,
} from "@/lib/preferences.functions";
import { seedHarbourCentre } from "@/lib/demo.functions";

const LOCAL_KEY = "agir-onboarding-dismissed";

function localDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LOCAL_KEY) === "1";
}

/**
 * First-run guided checklist. Completion is derived from real data on the
 * server (never a stored flag), so it always reflects what the user has
 * actually done. Dismissible + resumable; degrades to localStorage when the
 * preferences table has not yet been applied.
 */
export function OnboardingChecklist() {
  const { t, tx } = usePreferences();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dismissedLocal, setDismissedLocal] = useState(localDismissed);

  const stateQ = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => getOnboardingState(),
    staleTime: 30_000,
  });

  const dismissFn = useServerFn(setOnboardingDismissed);
  const dismiss = useMutation({
    mutationFn: () => dismissFn({ data: { dismissed: true } }),
    onSuccess: () => {
      if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_KEY, "1");
      setDismissedLocal(true);
      qc.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: () => toast.error("Could not save: hidden for this session"),
  });

  const seedFn = useServerFn(seedHarbourCentre);
  const seed = useMutation({
    mutationFn: () => seedFn(),
    onSuccess: (project: any) => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success("Guided demo loaded: opening deal");
      if (project?.id) navigate({ to: "/projects/$id", params: { id: project.id } });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not load demo"),
  });

  const state = stateQ.data;
  // Don't flash before we know; respect dismissal from either source.
  if (!state || dismissedLocal || state.dismissed) return null;

  const doneMap = new Map(state.steps.map((s) => [s.key, s.done]));
  const pct = Math.round((state.doneCount / state.total) * 100);

  if (state.allDone) {
    return (
      <Card className="p-5 elevated border-success/30 bg-success/5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-md bg-success/15 text-success flex items-center justify-center shrink-0">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">{t("onb.complete")}</div>
            <p className="text-sm text-muted-foreground mt-0.5">{t("onb.completeBody")}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dismiss.mutate()}
            disabled={dismiss.isPending}
          >
            {t("action.dismiss")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 md:p-6 elevated border-primary/25">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="size-9 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="display text-lg font-semibold">{t("onb.title")}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{t("onb.subtitle")}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={t("action.dismissAll")}
          title={t("action.dismissAll")}
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Progress value={pct} className="h-2 flex-1" />
        <span className="num text-xs text-muted-foreground whitespace-nowrap">
          {tx("onb.progress", { done: state.doneCount, total: state.total })}
        </span>
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {ONBOARDING_STEPS.map((step, i) => {
          const done = doneMap.get(step.key) ?? false;
          const isNext = !done && step.key === state.nextStep;
          return (
            <li key={step.key}>
              <Link
                to={step.to as string}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 transition-colors min-h-[44px]",
                  done
                    ? "border-success/30 bg-success/5"
                    : isNext
                      ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                      : "border-border hover:bg-accent/40",
                )}
              >
                {done ? (
                  <CheckCircle2 className="size-5 text-success shrink-0 mt-0.5" />
                ) : (
                  <Circle
                    className={cn(
                      "size-5 shrink-0 mt-0.5",
                      isNext ? "text-primary" : "text-muted-foreground/50",
                    )}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="num text-[10px] text-muted-foreground">{i + 1}</span>
                    <span
                      className={cn(
                        "text-sm font-medium truncate",
                        done && "text-muted-foreground line-through",
                      )}
                    >
                      {t(step.titleKey as TranslationKey)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t(step.bodyKey as TranslationKey)}
                  </p>
                </div>
                {isNext && <ArrowRight className="size-4 text-primary shrink-0 mt-0.5" />}
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <span className="text-xs text-muted-foreground flex-1 min-w-[12rem]">
          {t("onb.demoHint")}
        </span>
        <Button variant="outline" size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
          <Rocket className="size-4 mr-1.5" />
          {seed.isPending ? t("common.loading") : t("onb.loadDemo")}
        </Button>
      </div>
    </Card>
  );
}
