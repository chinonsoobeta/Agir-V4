#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const dealsArg = process.argv.find((arg) => arg.startsWith("--deals="));
const dealCount = Math.max(
  1,
  Number(dealsArg?.split("=")[1] ?? process.env.TENANT_LOAD_DEALS ?? 1000),
);
const assumptionsPerDeal = Number(process.env.TENANT_LOAD_ASSUMPTIONS ?? 64);
const outputsPerDeal = Number(process.env.TENANT_LOAD_OUTPUTS ?? 48);

const started = performance.now();
const portfolio = [];
for (let deal = 0; deal < dealCount; deal += 1) {
  const assumptions = Array.from({ length: assumptionsPerDeal }, (_, index) => ({
    field_key: `field_${index}`,
    value_numeric: deal * 100 + index,
    status: index % 7 === 0 ? "needs_review" : "approved",
  }));
  const outputs = Array.from({ length: outputsPerDeal }, (_, index) => ({
    metric_key: `metric_${index}`,
    value_numeric: (deal + 1) * (index + 1),
    scenario_key: index % 3 === 0 ? "downside" : "base",
  }));
  portfolio.push({ id: `deal_${deal}`, assumptions, outputs });
}

const unresolved = portfolio.reduce(
  (sum, deal) => sum + deal.assumptions.filter((a) => a.status !== "approved").length,
  0,
);
const baseOutputTotal = portfolio.reduce(
  (sum, deal) =>
    sum +
    deal.outputs
      .filter((output) => output.scenario_key === "base")
      .reduce((inner, output) => inner + output.value_numeric, 0),
  0,
);
const elapsedMs = performance.now() - started;
const maxMs = Number(process.env.TENANT_LOAD_MAX_MS ?? 750);

console.log(
  `[tenant-scale-load] deals=${dealCount} assumptions=${dealCount * assumptionsPerDeal} outputs=${dealCount * outputsPerDeal} unresolved=${unresolved} baseOutputTotal=${baseOutputTotal.toFixed(0)} elapsedMs=${elapsedMs.toFixed(1)}`,
);

if (elapsedMs > maxMs) {
  console.error(`[tenant-scale-load] exceeded ${maxMs}ms budget.`);
  process.exit(1);
}
