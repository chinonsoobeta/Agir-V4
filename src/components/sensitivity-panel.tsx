// WS3 / 3B. Flexible sensitivity UI. Flex any driver and re-run the PURE engine
// client-side: a tornado (each driver +/- a step), a single-variable breakeven, and
// a 2-variable scenario grid. Every number shown is a real runUnderwriting output
// (computed in useMemo over the base input) -- nothing is synthesized.

import { useDeferredValue, useMemo, useState } from "react";
import {
  runUnderwriting,
  tornado,
  breakeven,
  grid2d,
  linspace,
  SENSITIVITY_VARS,
  SENSITIVITY_METRICS,
  type UnderwritingInput,
} from "@/lib/engine";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { SectionLabel, Eyebrow } from "@/components/decision-ui";
import { Activity } from "lucide-react";

const METRIC_BY_KEY = Object.fromEntries(SENSITIVITY_METRICS.map((m) => [m.key, m]));
const VAR_BY_KEY = Object.fromEntries(SENSITIVITY_VARS.map((v) => [v.key, v]));

const DEFAULT_TARGET: Record<string, number> = {
  irr: 15,
  equity_multiple: 1.5,
  dscr: 1.2,
  profit_on_cost: 15,
  yield_on_cost: 6,
  development_profit: 0,
  debt_yield: 8,
  cash_on_cash: 8,
};

function fmtMetric(v: number, unit: "%" | "x" | "$"): string {
  if (!Number.isFinite(v)) return "n/m";
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "x") return `${v.toFixed(2)}x`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
}

function fmtVar(v: number, unit: string): string {
  if (unit === "%") return `${v.toFixed(2)}%`;
  if (unit === "$")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  if (unit === "yr") return `${Math.round(v)}yr`;
  return v.toFixed(0); // index
}

// Grid axis range for a driver: index drivers sweep 90..110; others +/-10% of base.
function axisRange(input: UnderwritingInput, varKey: string): number[] {
  const v = VAR_BY_KEY[varKey];
  const base = v.read(input);
  if (v.unit === "index") return linspace(90, 110, 5);
  const spread = Math.abs(base) * 0.1 || 1;
  return linspace(base - spread, base + spread, 5);
}

export function SensitivityPanel({ input }: { input: UnderwritingInput }) {
  const [metricKey, setMetricKey] = useState("irr");
  const [delta, setDelta] = useState(10);
  const [beVar, setBeVar] = useState("exit_cap_rate");
  const [target, setTarget] = useState<number>(DEFAULT_TARGET.irr);
  const [xVar, setXVar] = useState("exit_cap_rate");
  const [yVar, setYVar] = useState("cost_level");

  // Defer the control inputs so the (synchronous) engine re-runs happen against
  // the deferred snapshot. React keeps the last committed output on screen while
  // the new one computes, letting us surface a subtle "Calculating…" indicator
  // without changing any number that is ultimately shown.
  const dMetricKey = useDeferredValue(metricKey);
  const dDelta = useDeferredValue(delta);
  const dBeVar = useDeferredValue(beVar);
  const dTarget = useDeferredValue(target);
  const dXVar = useDeferredValue(xVar);
  const dYVar = useDeferredValue(yVar);
  const isCalculating =
    dMetricKey !== metricKey ||
    dDelta !== delta ||
    dBeVar !== beVar ||
    dTarget !== target ||
    dXVar !== xVar ||
    dYVar !== yVar;

  const metric = METRIC_BY_KEY[dMetricKey];
  const baseMetric = useMemo(() => metric.read(runUnderwriting(input)), [input, dMetricKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const bars = useMemo(
    () =>
      tornado(
        input,
        SENSITIVITY_VARS.map((v) => v.key),
        dDelta,
        dMetricKey,
      ),
    [input, dDelta, dMetricKey],
  );
  const be = useMemo(
    () => breakeven(input, dBeVar, dMetricKey, dTarget),
    [input, dBeVar, dMetricKey, dTarget],
  );
  const grid = useMemo(
    () => grid2d(input, dXVar, axisRange(input, dXVar), dYVar, axisRange(input, dYVar), dMetricKey),
    [input, dXVar, dYVar, dMetricKey],
  );

  // Tornado domain across all finite endpoints (+ base) for bar placement.
  const endpoints = bars.flatMap((b) => [b.lowValue, b.highValue]).filter(Number.isFinite);
  endpoints.push(baseMetric);
  const lo = Math.min(...endpoints);
  const hi = Math.max(...endpoints);
  const span = hi - lo || 1;
  const pct = (v: number) => ((v - lo) / span) * 100;

  const onMetric = (k: string) => {
    setMetricKey(k);
    setTarget(DEFAULT_TARGET[k] ?? 0);
  };

  const selectCls = "rounded border border-border bg-background px-2 py-1 text-xs";
  const triggerCls = "h-8 w-auto gap-1 text-xs";

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <Eyebrow>Flexible sensitivity · every cell is a live engine re-run</Eyebrow>
        </div>
        <div className="flex items-center gap-2">
          <Field
            label="Metric"
            className="space-y-0 flex items-center gap-2 [&>label]:text-[11px] [&>label]:text-muted-foreground"
          >
            {(f) => (
              <Select value={metricKey} onValueChange={onMetric}>
                <SelectTrigger id={f.id} className={triggerCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENSITIVITY_METRICS.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <span className="text-[11px] text-muted-foreground">base</span>
          <span className="num text-sm">{fmtMetric(baseMetric, metric.unit)}</span>
        </div>
      </div>

      {/* Announce recompletes to assistive tech; controls re-run the engine
          synchronously with no other visible feedback. */}
      <div role="status" aria-live="polite" className="sr-only">
        {isCalculating ? "Calculating…" : `Recomputed ${metric.label} sensitivity.`}
      </div>

      {/* Tornado */}
      <Card className="p-5 elevated">
        <div className="flex items-center justify-between">
          <SectionLabel>Tornado · {metric.label} sensitivity</SectionLabel>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">Flex</label>
            <Select value={String(delta)} onValueChange={(v) => setDelta(Number(v))}>
              <SelectTrigger className={triggerCls}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 20].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    +/- {d}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          {bars.map((b) => {
            const a = Number.isFinite(b.lowValue) ? b.lowValue : baseMetric;
            const c = Number.isFinite(b.highValue) ? b.highValue : baseMetric;
            const left = Math.min(pct(a), pct(c));
            const width = Math.abs(pct(c) - pct(a));
            return (
              <div key={b.key} className="flex items-center gap-3">
                <div className="w-40 shrink-0 text-xs truncate" title={b.label}>
                  {b.label}
                </div>
                <div className="flex-1 relative h-6 rounded bg-muted/30">
                  {/* base marker */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-foreground/40"
                    style={{ left: `${pct(baseMetric)}%` }}
                  />
                  <div
                    className="absolute top-1 bottom-1 rounded bg-primary/50 border border-primary/60"
                    style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
                  />
                </div>
                <div className="w-28 shrink-0 text-right num text-[11px] text-muted-foreground">
                  {fmtMetric(b.lowValue, metric.unit)} / {fmtMetric(b.highValue, metric.unit)}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Each bar flexes one driver +/- {delta}% and re-runs the engine; the vertical line is the
          base case.
        </p>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Breakeven */}
        <Card className="p-5 elevated">
          <SectionLabel>Breakeven solver</SectionLabel>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Solve</span>
            <Select value={beVar} onValueChange={setBeVar}>
              <SelectTrigger className={triggerCls}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SENSITIVITY_VARS.map((v) => (
                  <SelectItem key={v.key} value={v.key}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">so {metric.label} =</span>
            <input
              type="number"
              className={`${selectCls} w-20`}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
            <span className="text-muted-foreground">{metric.unit === "$" ? "$" : metric.unit}</span>
          </div>
          <div className="mt-4">
            {be ? (
              <div>
                <div className="num text-2xl">{fmtVar(be.value, VAR_BY_KEY[beVar].unit)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {VAR_BY_KEY[beVar].label} at which {metric.label} reaches{" "}
                  {fmtMetric(target, metric.unit)}.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No breakeven: {metric.label} does not cross {fmtMetric(target, metric.unit)} across
                the search range.
              </p>
            )}
          </div>
        </Card>

        {/* 2-variable grid */}
        <Card className="p-5 elevated">
          <div className="flex items-center justify-between">
            <SectionLabel>Scenario grid</SectionLabel>
            <div className="flex items-center gap-1.5 text-[11px]">
              <Select value={xVar} onValueChange={setXVar}>
                <SelectTrigger className={triggerCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENSITIVITY_VARS.map((v) => (
                    <SelectItem key={v.key} value={v.key}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">x</span>
              <Select value={yVar} onValueChange={setYVar}>
                <SelectTrigger className={triggerCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENSITIVITY_VARS.filter((v) => v.key !== xVar).map((v) => (
                    <SelectItem key={v.key} value={v.key}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="data-grid w-full text-[11px]">
              <thead>
                <tr className="bg-muted/20">
                  <th className="text-left">
                    {VAR_BY_KEY[yVar].label} \ {VAR_BY_KEY[xVar].label}
                  </th>
                  {grid.xs.map((x, i) => (
                    <th key={i} className="text-right num">
                      {fmtVar(x, VAR_BY_KEY[xVar].unit)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.ys.map((y, yi) => (
                  <tr key={yi}>
                    <td className="font-medium num">{fmtVar(y, VAR_BY_KEY[yVar].unit)}</td>
                    {grid.cells[yi].map((v, xi) => {
                      const ok = Number.isFinite(v) && v >= baseMetric;
                      return (
                        <td
                          key={xi}
                          className={`text-right num ${!Number.isFinite(v) ? "text-muted-foreground" : ok ? "text-success" : "text-destructive"}`}
                        >
                          {fmtMetric(v, metric.unit)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Green at or above base ({fmtMetric(baseMetric, metric.unit)}); each cell is a real
            re-run.
          </p>
        </Card>
      </div>
    </section>
  );
}
