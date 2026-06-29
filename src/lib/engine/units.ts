import type { BudgetInput, MezzanineInput, RevenueUnitInput, UnderwritingInput } from "./types";

declare const MoneyBrand: unique symbol;
declare const PercentBrand: unique symbol;
declare const MonthsBrand: unique symbol;
declare const PerSfBrand: unique symbol;

export type Money = number & { readonly [MoneyBrand]: "Money" };
export type Percent = number & { readonly [PercentBrand]: "PercentWhole" };
export type Months = number & { readonly [MonthsBrand]: "Months" };
export type PerSF = number & { readonly [PerSfBrand]: "AnnualDollarsPerSF" };

export const money = (value: number): Money => value as Money;
export const percent = (value: number): Percent => value as Percent;
export const months = (value: number): Months => value as Months;
export const perSf = (value: number): PerSF => value as PerSF;

export type BrandedBudgetInput = Omit<
  BudgetInput,
  "land" | "hard" | "soft" | "contingency" | "financingInterest" | "other"
> & {
  land: Money;
  hard: Money;
  soft: Money;
  contingency: Money;
  financingInterest?: Money;
  other?: Money;
};

export type BrandedRevenueUnitInput =
  | (Omit<RevenueUnitInput, "rent" | "rentBasis" | "occupancyPct"> & {
      rentBasis: "per_unit";
      rent: Money;
      occupancyPct?: Percent | null;
    })
  | (Omit<RevenueUnitInput, "rent" | "rentBasis" | "occupancyPct"> & {
      rentBasis: "per_sf";
      rent: PerSF;
      occupancyPct?: Percent | null;
    });

export type BrandedMezzanineInput = Omit<MezzanineInput, "amount" | "ratePct" | "ioMonths"> & {
  amount: Money;
  ratePct: Percent;
  ioMonths: Months;
};

export type BrandedUnderwritingInput = Omit<
  UnderwritingInput,
  | "budget"
  | "revenueProgram"
  | "constructionMonths"
  | "leaseUpMonths"
  | "stabilizedOccupancyPct"
  | "expenseRatioPct"
  | "otherIncomeAnnual"
  | "exitCapRatePct"
  | "loanAmount"
  | "interestRatePct"
  | "ioMonths"
  | "sellingCostsPct"
  | "equityAmount"
  | "rentGrowthPct"
  | "expenseGrowthPct"
  | "equityDrawMonths"
  | "mezzanine"
> & {
  budget: BrandedBudgetInput;
  revenueProgram: BrandedRevenueUnitInput[];
  constructionMonths: Months;
  leaseUpMonths: Months;
  stabilizedOccupancyPct: Percent;
  expenseRatioPct: Percent;
  otherIncomeAnnual: Money;
  exitCapRatePct: Percent;
  loanAmount: Money;
  interestRatePct: Percent;
  ioMonths: Months;
  sellingCostsPct: Percent;
  equityAmount?: Money | null;
  rentGrowthPct: Percent;
  expenseGrowthPct: Percent;
  equityDrawMonths?: Months | null;
  mezzanine?: BrandedMezzanineInput | null;
};

export function brandUnderwritingInput(input: UnderwritingInput): BrandedUnderwritingInput {
  return {
    ...input,
    budget: {
      ...input.budget,
      land: money(input.budget.land),
      hard: money(input.budget.hard),
      soft: money(input.budget.soft),
      contingency: money(input.budget.contingency),
      financingInterest:
        input.budget.financingInterest == null ? undefined : money(input.budget.financingInterest),
      other: input.budget.other == null ? undefined : money(input.budget.other),
    },
    revenueProgram: input.revenueProgram.map((row) =>
      row.rentBasis === "per_sf"
        ? {
            ...row,
            rentBasis: "per_sf" as const,
            rent: perSf(row.rent),
            occupancyPct: row.occupancyPct == null ? row.occupancyPct : percent(row.occupancyPct),
          }
        : {
            ...row,
            rentBasis: "per_unit" as const,
            rent: money(row.rent),
            occupancyPct: row.occupancyPct == null ? row.occupancyPct : percent(row.occupancyPct),
          },
    ),
    constructionMonths: months(input.constructionMonths),
    leaseUpMonths: months(input.leaseUpMonths),
    stabilizedOccupancyPct: percent(input.stabilizedOccupancyPct),
    expenseRatioPct: percent(input.expenseRatioPct),
    otherIncomeAnnual: money(input.otherIncomeAnnual),
    exitCapRatePct: percent(input.exitCapRatePct),
    loanAmount: money(input.loanAmount),
    interestRatePct: percent(input.interestRatePct),
    ioMonths: months(input.ioMonths),
    sellingCostsPct: percent(input.sellingCostsPct),
    equityAmount: input.equityAmount == null ? input.equityAmount : money(input.equityAmount),
    rentGrowthPct: percent(input.rentGrowthPct),
    expenseGrowthPct: percent(input.expenseGrowthPct),
    equityDrawMonths:
      input.equityDrawMonths == null ? input.equityDrawMonths : months(input.equityDrawMonths),
    mezzanine: input.mezzanine
      ? {
          ...input.mezzanine,
          amount: money(input.mezzanine.amount),
          ratePct: percent(input.mezzanine.ratePct),
          ioMonths: months(input.mezzanine.ioMonths),
        }
      : input.mezzanine,
  };
}
