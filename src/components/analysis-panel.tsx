// Analysis — scenarios + underwriting merged into one decision-oriented view.
// The question is "what breaks the deal?", not "what number changed?". The
// deterministic pro-forma detail is preserved below via the underwriting panel.

import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { listFinancialOutputs, listAssumptions } from "@/lib/assumptions.functions";
import { Card } from "@/components/ui/card";
import { buildDecision } from "@/lib/decision";
import { SectionLabel, Eyebrow, TONE_TEXT } from "@/components/decision-ui";
import { UnderwritingPanel } from "@/components/underwriting-panel";
import { ArrowDownRight, ArrowUpRight, GitBranch, Activity, ShieldCheck } from "lucide-react";

const outputsQ = (pid: string) => queryOptions({ queryKey: ["outputs", pid], queryFn: () => listFinancialOutputs({ data: { project_id: pid } }) });
const assumptionsQ = (pid: string) => queryOptions({ queryKey: ["assumptions", pid], queryFn: () => listAssumptions({ data: { project_id: pid } }) });

const SCENARIO_LABELS: Record<string, string> = {
  base: "Base Case", revenue_down: "Revenue −10%", cost_overrun: "Cost +10%",
  rate_shock: "Rate +150bps", cap_expansion: "Cap +75bps", combined: "Combined Stress",
};
const STRESS_ORDER = ["revenue_down", "cost_overrun", "rate_shock", "cap_expansion", "combined"];

// Hard gates the engine uses — used to flag "what breaks the deal".
const GATES = [
  { key: "dscr", label: "DSCR", min: 1.2, unit: "x", fmt: (v: number) => `${v.toFixed(2)}x` },
  { key: "equity_multiple", label: "Equity Multiple", min: 1.0, unit: "x", fmt: (v: number) => `${v.toFixed(2)}x` },
  { key: "profit_margin", label: "Profit Margin", min: 15, unit: "%", fmt: (v: number) => `${v.toFixed(1)}%` },
];

export function AnalysisPanel({ projectId }: { projectId: string }) {
  const { data: outputs } = useSuspenseQuery(outputsQ(projectId));
  const { data: assumptions } = useSuspenseQuery(assumptionsQ(projectId));
  const decision = buildDecision(outputs as any, assumptions as any);
  const f = decision.findings;
  const scenarios = decision.norm.scenarios;
  const presentStress = STRESS_ORDER.filter((k) => scenarios[k]);

  if (!decision.hasUnderwriting) {
    return <UnderwritingPanel projectId={projectId} />;
  }

  return (
    <div className="space-y-6">
      {/* What breaks the deal — stress matrix */}
      <section>
        <div className="flex items-center gap-2 mb-3"><Activity className="size-4 text-primary" /><Eyebrow>What breaks the deal · stress matrix</Eyebrow></div>
        <Card className="overflow-x-auto elevated">
          <table className="data-grid w-full">
            <thead>
              <tr className="bg-muted/20">
                <th className="text-left">Gate</th>
                <th className="text-right text-primary">{SCENARIO_LABELS.base}</th>
                {presentStress.map((k) => <th key={k} className="text-right">{SCENARIO_LABELS[k] ?? k}</th>)}
              </tr>
            </thead>
            <tbody>
              {GATES.map((g) => (
                <tr key={g.key}>
                  <td className="font-medium">{g.label} <span className="text-muted-foreground text-[10px]">≥ {g.fmt(g.min)}</span></td>
                  {["base", ...presentStress].map((sk) => {
                    const v = scenarios[sk]?.[g.key];
                    const breaks = v != null && v < g.min;
                    return (
                      <td key={sk} className={`text-right num ${v == null ? "text-muted-foreground" : breaks ? "text-destructive font-semibold" : "text-success"}`}>
                        {v == null ? "—" : g.fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="text-xs text-muted-foreground mt-2">Red cells fall below the underwriting gate — these are the conditions under which the deal stops clearing.</p>
      </section>

      {/* Sensitivity + drivers + covenants */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-5 elevated">
          <div className="flex items-center gap-2"><GitBranch className="size-4 text-primary" /><SectionLabel>Driver Analysis</SectionLabel></div>
          <div className="mt-3 space-y-4">
            <DriverBlock title="Value drivers" icon={ArrowUpRight} tone="approve" drivers={f?.primaryDrivers ?? []} />
            <DriverBlock title="Downside drivers" icon={ArrowDownRight} tone="reject" drivers={f?.downsideDrivers ?? []} />
          </div>
        </Card>

        <Card className="p-5 elevated">
          <div className="flex items-center gap-2"><Activity className="size-4 text-primary" /><SectionLabel>Sensitivity</SectionLabel></div>
          <p className="text-xs text-muted-foreground mt-2">Worst observed value across all stress runs:</p>
          <div className="mt-3 space-y-3">
            {GATES.map((g) => {
              const worst = decision.norm.worstStress[g.key];
              const breaks = worst != null && worst < g.min;
              return (
                <div key={g.key} className="flex items-center justify-between">
                  <span className="text-sm">{g.label}</span>
                  <span className={`num text-sm ${worst == null ? "text-muted-foreground" : breaks ? "text-destructive" : "text-success"}`}>{worst == null ? "—" : g.fmt(worst)}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5 elevated">
          <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><SectionLabel>Covenant Analysis</SectionLabel></div>
          {(f?.covenants?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">No covenant findings.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {f!.covenants.slice(0, 5).map((c) => (
                <li key={c.id} className="text-sm">
                  <div className="font-medium">{c.title}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.rationale}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Findings summary */}
      {(f?.criticalFindings?.length ?? 0) > 0 && (
        <Card className="p-5 border-destructive/30 elevated">
          <SectionLabel>Findings · Critical</SectionLabel>
          <ul className="mt-3 space-y-2">
            {f!.criticalFindings.map((c) => (
              <li key={c.id} className="flex gap-2.5 text-sm">
                <span className="mt-1.5 size-1.5 rounded-full bg-destructive shrink-0" />
                <span><span className="font-medium">{c.title}.</span> <span className="text-muted-foreground">{c.rationale}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Deterministic pro-forma detail */}
      <section>
        <Eyebrow>Deterministic Pro Forma</Eyebrow>
        <div className="mt-3"><UnderwritingPanel projectId={projectId} /></div>
      </section>
    </div>
  );
}

function DriverBlock({ title, icon: Icon, tone, drivers }: { title: string; icon: any; tone: "approve" | "reject"; drivers: { rank: number; name: string; rationale: string }[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5"><Icon className={`size-3.5 ${TONE_TEXT[tone]}`} /><span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{title}</span></div>
      <ol className="mt-2 space-y-1.5">
        {drivers.slice(0, 5).map((d) => (
          <li key={d.rank} className="text-xs"><span className="num text-muted-foreground mr-1.5">{d.rank}.</span><span className="font-medium">{d.name}</span></li>
        ))}
        {drivers.length === 0 && <li className="text-xs text-muted-foreground">None ranked.</li>}
      </ol>
    </div>
  );
}
