// Shared institutional decision primitives — used across the deal page,
// Investment Committee, Portfolio and Analysis. These encode the platform's
// colour discipline: green = approval, red = material risk, amber = conditions,
// neutral for everything else.

import { cn } from "@/lib/utils";
import type { DecisionRecommendation, RiskRating, ScoreComponent } from "@/lib/decision";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, RISK_TONE } from "@/lib/decision";

export type Tone = "approve" | "condition" | "return" | "reject" | "neutral";

export const TONE_TEXT: Record<Tone, string> = {
  approve: "text-success",
  condition: "text-warning",
  return: "text-chart-2",
  reject: "text-destructive",
  neutral: "text-foreground",
};

export const TONE_CHIP: Record<Tone, string> = {
  approve: "bg-success/15 text-success border-success/30",
  condition: "bg-warning/15 text-warning border-warning/30",
  return: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  reject: "bg-destructive/15 text-destructive border-destructive/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

export const TONE_SOLID: Record<Tone, string> = {
  approve: "bg-success text-white",
  condition: "bg-warning text-black",
  return: "bg-chart-2 text-white",
  reject: "bg-destructive text-white",
  neutral: "bg-muted text-foreground",
};

export function RecommendationPill({ rec, className }: { rec: DecisionRecommendation; className?: string }) {
  const tone = RECOMMENDATION_TONE[rec];
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider", TONE_CHIP[tone], className)}>
      <span className={cn("size-1.5 rounded-full", tone === "approve" ? "bg-success" : tone === "condition" ? "bg-warning" : tone === "return" ? "bg-chart-2" : "bg-destructive")} />
      {RECOMMENDATION_LABEL[rec]}
    </span>
  );
}

export function RiskPill({ rating, className }: { rating: RiskRating; className?: string }) {
  const tone = RISK_TONE[rating];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider", TONE_CHIP[tone], className)}>
      {rating} Risk
    </span>
  );
}

// Big circular gauge for the headline scores.
export function ScoreDial({
  value,
  label,
  sub,
  tone = "neutral",
  size = 132,
}: {
  value: number | null;
  label: string;
  sub?: string;
  tone?: Tone;
  size?: number;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color =
    tone === "approve" ? "var(--color-success)"
    : tone === "condition" ? "var(--color-warning)"
    : tone === "return" ? "var(--color-chart-2)"
    : tone === "reject" ? "var(--color-destructive)"
    : "var(--color-primary)";
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={`${dash} ${c}`}
            style={{ transition: "stroke-dasharray 700ms cubic-bezier(.4,0,.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="num text-3xl font-semibold leading-none">{value == null ? "—" : Math.round(value)}</div>
          {value != null && <div className="text-[10px] text-muted-foreground mt-0.5">/ 100</div>}
        </div>
      </div>
      <div className="mt-3 text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// A horizontal score breakdown bar list.
export function ScoreBreakdown({ components }: { components: ScoreComponent[] }) {
  if (!components.length) return null;
  return (
    <div className="space-y-2.5">
      {components.map((c) => (
        <div key={c.label}>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-foreground/80">{c.label}</span>
            <span className="num text-muted-foreground">{Math.round(c.score)} <span className="text-muted-foreground/60">· {Math.round(c.weight * 100)}%</span></span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, c.score)}%`,
                background: c.score >= 66 ? "var(--color-success)" : c.score >= 40 ? "var(--color-warning)" : "var(--color-destructive)",
              }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{c.detail}</div>
        </div>
      ))}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-[10px] uppercase tracking-widest text-muted-foreground font-semibold", className)}>{children}</div>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">{children}</div>;
}
