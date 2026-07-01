import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ClipboardCheck,
  FileText,
  type LucideIcon,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DemoPackagePicker } from "@/components/demo-package-picker";

const DEMO_STEPS = [
  {
    title: "Seed Harbour Centre",
    body: "Start with the seedable package so every tester sees the same source documents, conflicts, and expected outputs.",
    href: "/deals",
  },
  {
    title: "Review assumptions",
    body: "Open the deal, inspect source-backed assumptions, resolve the exit-cap conflict, and accept documented defaults only where inputs are missing.",
    href: "/assumptions",
  },
  {
    title: "Run underwriting",
    body: "Run the deterministic engine, check the key metrics, and use provenance/explanation affordances before trusting a number.",
    href: "/analysis",
  },
  {
    title: "Generate memo and reports",
    body: "Produce the IC memo and report artifacts, then confirm downloads and the audit package are present.",
    href: "/reports",
  },
] as const;

export function DemoGuide() {
  return (
    <section className="rounded-lg border border-primary/25 bg-primary/5 p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            <ClipboardCheck className="size-3.5" />
            Unsupervised demo guide
          </div>
          <h2 className="display mt-2 text-xl font-semibold">Run the same pilot path every time</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Use this route for a professional evaluator: seeded demo first, then one nonconfidential
            real deal. Agir is decision-support for evaluation; outputs require human review before
            any investment decision.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DemoPackagePicker
            trigger={
              <Button size="sm">
                Seed demo deal
                <ArrowRight className="ml-1.5 size-4" />
              </Button>
            }
          />
          <Link to="/settings" search={{ section: "data" }}>
            <Button variant="outline" size="sm">
              Trust controls
            </Button>
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {DEMO_STEPS.map((step, index) => (
          <Link
            key={step.title}
            to={step.href}
            className="group rounded-md border bg-background/70 p-3"
          >
            <div className="flex items-start gap-2.5">
              <div className="num flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-xs text-primary">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold group-hover:text-primary">{step.title}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.body}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <Card className="mt-4 border-border/70 bg-background/70 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Guardrail
            icon={ShieldCheck}
            title="Success"
            body="No route crashes, source documents visible, assumptions traceable, memo/report/audit artifacts download."
          />
          <Guardrail
            icon={FileText}
            title="Known watchpoints"
            body="Conflicts and defaults should be obvious; fabricated extraction values or orphan numbers are demo blockers."
          />
          <Guardrail
            icon={MessageSquareText}
            title="Feedback"
            body="Capture what confused the tester, what looked wrong, and whether they would review a real deal in Agir."
          />
        </div>
      </Card>
    </section>
  );
}

function Guardrail({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded bg-success/10 text-success">
        <Icon className="size-3.5" />
      </div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
