import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isMissingRelation } from "./db-compat";

// ---------------------------------------------------------------------------
// Onboarding: a guided first-run checklist whose completion is DERIVED from
// real data (not a stored flag), so it can never lie about progress. The only
// stored state is whether the user dismissed it. Reaching a real underwriting
// result should take ~15 minutes with no admin involvement.
// ---------------------------------------------------------------------------

export type OnboardingStepKey =
  | "createDeal"
  | "uploadDocs"
  | "reviewAssumptions"
  | "runUnderwriting"
  | "prepareCommittee"
  | "addMilestones";

export const ONBOARDING_STEPS: {
  key: OnboardingStepKey;
  titleKey: string;
  bodyKey: string;
  to: string;
}[] = [
  {
    key: "createDeal",
    titleKey: "onb.step.createDeal.title",
    bodyKey: "onb.step.createDeal.body",
    to: "/deals",
  },
  {
    key: "uploadDocs",
    titleKey: "onb.step.uploadDocs.title",
    bodyKey: "onb.step.uploadDocs.body",
    to: "/documents",
  },
  {
    key: "reviewAssumptions",
    titleKey: "onb.step.reviewAssumptions.title",
    bodyKey: "onb.step.reviewAssumptions.body",
    to: "/assumptions",
  },
  {
    key: "runUnderwriting",
    titleKey: "onb.step.runUnderwriting.title",
    bodyKey: "onb.step.runUnderwriting.body",
    to: "/analysis",
  },
  {
    key: "prepareCommittee",
    titleKey: "onb.step.prepareCommittee.title",
    bodyKey: "onb.step.prepareCommittee.body",
    to: "/committee",
  },
  {
    key: "addMilestones",
    titleKey: "onb.step.addMilestones.title",
    bodyKey: "onb.step.addMilestones.body",
    to: "/execution",
  },
];

export type OnboardingCounts = Record<OnboardingStepKey, number>;

export type OnboardingProgress = {
  steps: { key: OnboardingStepKey; done: boolean }[];
  doneCount: number;
  total: number;
  allDone: boolean;
  /** First incomplete step: the "resume here" target. */
  nextStep: OnboardingStepKey | null;
};

/** Pure, deterministic mapping of data counts -> checklist progress. Unit-tested. */
export function computeOnboardingProgress(counts: Partial<OnboardingCounts>): OnboardingProgress {
  const steps = ONBOARDING_STEPS.map((s) => ({ key: s.key, done: (counts[s.key] ?? 0) > 0 }));
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done)?.key ?? null;
  return {
    steps,
    doneCount,
    total: steps.length,
    allDone: doneCount === steps.length,
    nextStep: next,
  };
}

const REVIEWED_ASSUMPTION_STATUSES = ["approved", "modified", "default_accepted", "calculated"];

async function headCount(supabase: any, table: string, build?: (q: any) => any): Promise<number> {
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  if (isMissingRelation(error)) return 0;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export const getOnboardingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as any;

    const [
      createDeal,
      uploadDocs,
      reviewAssumptions,
      runUnderwriting,
      prepareCommittee,
      addMilestones,
    ] = await Promise.all([
      headCount(supabase, "projects"),
      headCount(supabase, "documents"),
      headCount(supabase, "assumptions", (q) => q.in("status", REVIEWED_ASSUMPTION_STATUSES)),
      headCount(supabase, "financial_outputs"),
      headCount(supabase, "decision_logs"),
      headCount(supabase, "deal_milestones"),
    ]);

    const progress = computeOnboardingProgress({
      createDeal,
      uploadDocs,
      reviewAssumptions,
      runUnderwriting,
      prepareCommittee,
      addMilestones,
    });

    // Stored dismissal flag: degrade gracefully if the table is not applied yet.
    let dismissed = false;
    let completedAt: string | null = null;
    const { data: pref, error } = await supabase
      .from("user_preferences")
      .select("onboarding_dismissed, onboarding_completed_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!isMissingRelation(error) && !error && pref) {
      dismissed = Boolean(pref.onboarding_dismissed);
      completedAt = pref.onboarding_completed_at ?? null;
    }

    return { ...progress, dismissed, completedAt };
  });

export const setOnboardingDismissed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => z.object({ dismissed: z.boolean() }).parse(v))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { error } = await supabase.from("user_preferences").upsert(
      {
        user_id: context.userId,
        onboarding_dismissed: data.dismissed,
        onboarding_completed_at: data.dismissed ? new Date().toISOString() : null,
      },
      { onConflict: "user_id" },
    );
    // Missing table: report not-persisted so the client can hold the flag locally.
    if (isMissingRelation(error)) return { ok: true, persisted: false, dismissed: data.dismissed };
    if (error) throw new Error(error.message);
    return { ok: true, persisted: true, dismissed: data.dismissed };
  });

// ---------------------------------------------------------------------------
// Generic preference bag (saved views, notification + column prefs). Stored in
// user_preferences.data JSONB. Migration-safe; returns {} when unavailable.
// ---------------------------------------------------------------------------

export const getPreferenceData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as any;
    const { data, error } = await supabase
      .from("user_preferences")
      .select("data")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (isMissingRelation(error) || error || !data) return {} as Record<string, any>;
    return (data.data ?? {}) as Record<string, any>;
  });

export const savePreferenceData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => z.object({ key: z.string().min(1).max(80), value: z.any() }).parse(v))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: existing } = await supabase
      .from("user_preferences")
      .select("data")
      .eq("user_id", context.userId)
      .maybeSingle();
    const merged = { ...((existing?.data as Record<string, any>) ?? {}), [data.key]: data.value };
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: context.userId, data: merged }, { onConflict: "user_id" });
    if (isMissingRelation(error)) return { ok: true, persisted: false, data: merged };
    if (error) throw new Error(error.message);
    return { ok: true, persisted: true, data: merged };
  });
