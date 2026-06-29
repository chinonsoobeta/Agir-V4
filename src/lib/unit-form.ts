// UI form-state boundary for branded units (Tier-follow-on hardening).
//
// Brands (Money / Percent / Months / PerSF) were applied at the engine boundary
// (engine/units.ts). This module pushes the SAME discipline out to where raw
// user input first becomes a number -- the underwriting form. A form field
// parses its string through the matching parser, which strips presentation
// noise ($, %, commas, whitespace), validates the magnitude against the unit's
// plausible domain (the same bounds the engine input-validation gate uses), and
// returns a BRANDED value. A field that should hold a Percent can no longer be
// assigned a Money by mistake, and an implausible entry is rejected at the edge
// instead of flowing inward.

import {
  money,
  months,
  percent,
  perSf,
  type Money,
  type Months,
  type Percent,
  type PerSF,
} from "./engine/units";

export type FieldParse<T> = { ok: true; value: T } | { ok: false; error: string };

function toNumber(raw: string | number): number {
  if (typeof raw === "number") return raw;
  // Strip currency symbols, thousands separators, percent signs, whitespace.
  const cleaned = raw.replace(/[$,%\s]/g, "").replace(/[()]/g, (m) => (m === "(" ? "-" : ""));
  return cleaned === "" ? Number.NaN : Number(cleaned);
}

function parseInDomain<T>(
  raw: string | number,
  brand: (n: number) => T,
  domain: { min: number; max: number; label: string },
): FieldParse<T> {
  const n = toNumber(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `${domain.label} must be a number.` };
  if (n < domain.min || n > domain.max) {
    return { ok: false, error: `${domain.label} must be between ${domain.min} and ${domain.max}.` };
  }
  return { ok: true, value: brand(n) };
}

// Money: non-negative, capped well above any real single line (a sign/scale slip
// is rejected, not silently accepted).
export function parseMoneyField(raw: string | number): FieldParse<Money> {
  return parseInDomain(raw, money, { min: 0, max: 1e12, label: "Amount" });
}

// Whole-percent (35 means 35%, never 0.35). Bounded to the rate/ratio domains the
// engine plausibility gate accepts.
export function parsePercentField(
  raw: string | number,
  opts: { min?: number; max?: number; label?: string } = {},
): FieldParse<Percent> {
  return parseInDomain(raw, percent, {
    min: opts.min ?? 0,
    max: opts.max ?? 100,
    label: opts.label ?? "Percentage",
  });
}

export function parseMonthsField(raw: string | number): FieldParse<Months> {
  return parseInDomain(raw, months, { min: 0, max: 1200, label: "Months" });
}

export function parsePerSfField(raw: string | number): FieldParse<PerSF> {
  return parseInDomain(raw, perSf, { min: 0, max: 100_000, label: "Rent ($/SF)" });
}

// Format a branded value for display. Kept unit-explicit so a Percent is never
// rendered with a $ and vice versa.
export function formatMoney(value: Money): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
export function formatPercent(value: Percent, digits = 2): string {
  return `${value.toFixed(digits)}%`;
}
export function formatPerSf(value: PerSF, digits = 2): string {
  return `$${value.toFixed(digits)}/SF`;
}
