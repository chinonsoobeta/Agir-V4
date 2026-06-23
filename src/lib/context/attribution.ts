// Deterministic causal attribution + "what would make this a yes". Closed-form
// levers only — every number is derived from engine outputs/inputs, never
// invented, so the prose that uses them stays provenance-clean.

import type { EngineOutput, UnderwritingInput } from "../engine/types";
import { resolveBenchmark } from "./benchmarks";
import type { BenchmarkInputs, DealContext } from "./types";

const money = (n: number) => `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n))}`;

export type Driver = { factor: string; detail: string; magnitude: number };
export type WhatIfLever = { gate: string; passing: boolean; target: number; lever: string };
// derivedValues: every money() magnitude the lever/driver prose renders, so the
// memo's provenance verifier admits them.
export type Attribution = { drivers: Driver[]; levers: WhatIfLever[]; derivedValues: number[] };

export type Covenants = { minDscr?: number | null; minDebtYield?: number | null };

// Decompose the development spread into its yield-on-cost and exit-cap parts,
// and explain which side is the binding constraint relative to the cost basis.
function spreadDrivers(output: EngineOutput, input: UnderwritingInput): Driver[] {
  const v = output.values;
  const drivers: Driver[] = [];
  drivers.push({
    factor: "Yield on cost",
    detail: `NOI ${money(v.noi)} on ${money(v.tdc)} of cost = ${v.yieldOnCostPct.toFixed(2)}% going-in yield`,
    magnitude: v.yieldOnCostPct,
  });
  drivers.push({
    factor: "Exit cap",
    detail: `Capitalized at a ${input.exitCapRatePct.toFixed(2)}% exit; the ${v.developmentSpreadBps.toFixed(0)} bps spread is the cushion between the two`,
    magnitude: input.exitCapRatePct,
  });
  // Which lever moves the spread more: cost basis or exit cap.
  const costSensitivity = v.tdc > 0 ? (v.noi / v.tdc) * 100 : 0; // yoc; cutting cost lifts this
  drivers.push({
    factor: v.yieldOnCostPct < input.exitCapRatePct + 1 ? "Cost basis is the binding constraint" : "Exit assumption is the binding constraint",
    detail: v.yieldOnCostPct < input.exitCapRatePct + 1
      ? `Going-in yield (${v.yieldOnCostPct.toFixed(2)}%) sits close to the exit cap (${input.exitCapRatePct.toFixed(2)}%); the deal is priced thin to cost`
      : `Going-in yield clears the exit cap comfortably; spread is driven by favorable cost-to-NOI`,
    magnitude: costSensitivity,
  });
  return drivers;
}

export function buildAttribution(
  output: EngineOutput,
  input: UnderwritingInput,
  ctx: DealContext,
  benchInputs?: BenchmarkInputs,
  covenants?: Covenants,
): Attribution {
  const v = output.values;
  const drivers = spreadDrivers(output, input);
  const levers: WhatIfLever[] = [];
  const derivedValues: number[] = [];
  const push = (...ns: number[]) => { for (const n of ns) if (Number.isFinite(n)) derivedValues.push(Math.round(n)); };
  push(v.noi, v.tdc); // appear in driver detail

  const benchTarget = (key: string): number | null => resolveBenchmark(key, ctx, benchInputs)?.target ?? null;

  // DSCR: target is the stricter of the covenant and the contextual norm.
  const dscrTarget = Math.max(covenants?.minDscr ?? 0, benchTarget("dscr") ?? 0);
  if (dscrTarget > 0 && v.annualDebtService > 0 && input.loanAmount > 0) {
    const passing = v.dscr >= dscrTarget;
    // ADS ∝ loan at fixed rate/amort, so loan_target = loan × dscr / dscrTarget.
    const loanTarget = input.loanAmount * (v.dscr / dscrTarget);
    const cut = input.loanAmount - loanTarget;
    const noiLift = dscrTarget * v.annualDebtService - v.noi;
    push(loanTarget, cut, noiLift);
    levers.push({
      gate: "DSCR",
      passing,
      target: dscrTarget,
      lever: passing
        ? `DSCR ${v.dscr.toFixed(2)}x clears the ${dscrTarget.toFixed(2)}x bar`
        : `Reduce the loan by ${money(cut)} (to ${money(loanTarget)}) or lift NOI by ${money(noiLift)} to reach ${dscrTarget.toFixed(2)}x`,
    });
  }

  // Debt yield: target is the stricter of covenant and contextual norm.
  const dyTarget = Math.max(covenants?.minDebtYield ?? 0, benchTarget("debt_yield") ?? 0);
  if (dyTarget > 0 && input.loanAmount > 0 && v.noi > 0) {
    const passing = v.debtYieldPct >= dyTarget;
    const loanTarget = (v.noi / dyTarget) * 100;
    const cut = input.loanAmount - loanTarget;
    push(loanTarget, cut);
    levers.push({
      gate: "Debt yield",
      passing,
      target: dyTarget,
      lever: passing
        ? `Debt yield ${v.debtYieldPct.toFixed(2)}% clears the ${dyTarget.toFixed(2)}% bar`
        : `Reduce the loan by ${money(cut)} (to ${money(loanTarget)}) to reach the ${dyTarget.toFixed(2)}% debt-yield bar`,
    });
  }

  // Development spread: lift NOI or cut cost to reach the target spread over cap.
  const spreadTarget = benchTarget("development_spread");
  if (spreadTarget != null && v.tdc > 0) {
    const passing = v.developmentSpreadBps >= spreadTarget;
    const requiredYoc = input.exitCapRatePct + spreadTarget / 100; // %
    const noiTarget = (requiredYoc / 100) * v.tdc;
    const tdcTarget = v.noi / (requiredYoc / 100);
    push(noiTarget - v.noi, v.tdc - tdcTarget);
    levers.push({
      gate: "Development spread",
      passing,
      target: spreadTarget,
      lever: passing
        ? `Spread ${v.developmentSpreadBps.toFixed(0)} bps clears the ${spreadTarget.toFixed(0)} bps bar`
        : `Lift NOI by ${money(noiTarget - v.noi)} or cut cost by ${money(v.tdc - tdcTarget)} to reach a ${spreadTarget.toFixed(0)} bps spread`,
    });
  }

  return { drivers, levers, derivedValues };
}
