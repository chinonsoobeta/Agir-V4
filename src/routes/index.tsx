import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Check,
  CircleCheck,
  FileCheck2,
  Gauge,
  Menu,
  Network,
  Radar,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agir | Real estate investment decisions, made clear" },
      {
        name: "description",
        content:
          "Agir brings deal flow, deterministic underwriting, investment decisions, execution, and portfolio reporting into one clear workspace.",
      },
      { property: "og:title", content: "Agir | Real estate investment decisions, made clear" },
      {
        property: "og:description",
        content:
          "Move from source to close with traceable numbers, a live pipeline, and a shared record of every decision.",
      },
    ],
  }),
  component: LandingPage,
});

const platformFeatures = [
  {
    icon: BriefcaseBusiness,
    title: "See the full deal pipeline",
    body: "Track every opportunity, owner, deadline, and next step from first look through closing.",
  },
  {
    icon: ShieldCheck,
    title: "Trust the underwriting",
    body: "Every financial output comes from approved inputs and deterministic calculations. Source evidence stays attached.",
  },
  {
    icon: Workflow,
    title: "Keep execution moving",
    body: "Give diligence, financing, legal, and closing work a clear owner. Blockers and overdue items stay visible.",
  },
  {
    icon: BarChart3,
    title: "Report without rebuilding",
    body: "Turn current deal data into committee packages, portfolio reports, and clean exports without another spreadsheet pass.",
  },
  {
    icon: Radar,
    title: "Watch markets and risk",
    body: "Follow market signals, concentration, confidence gaps, downside cases, and portfolio exposure in the same place.",
  },
  {
    icon: Network,
    title: "Connect the tools you use",
    body: "Bring documents, models, CRM records, and internal data into a governed workflow with a visible audit trail.",
  },
] as const;

const lifecycle = [
  ["01", "Source", "Capture the opportunity, relationship, market, and timing."],
  ["02", "Review", "Upload documents and approve the assumptions that matter."],
  ["03", "Underwrite", "Run the base case and stress cases with traceable formulas."],
  ["04", "Decide", "Bring one recommendation and its supporting evidence to committee."],
  ["05", "Close", "Manage milestones, blockers, conditions, and final deliverables."],
] as const;

function LandingPage() {
  const [hasSession, setHasSession] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setHasSession(Boolean(data.session));
    });
    return () => {
      active = false;
    };
  }, []);

  const primaryTo = hasSession ? "/dashboard" : "/auth";
  const primaryLabel = hasSession ? "Open workspace" : "Start with Agir";

  return (
    <main className="landing min-h-screen overflow-hidden bg-[#f6f7fc] text-[#0f1430]">
      <header className="relative z-50 border-b border-[#1e2750]/10 bg-[#f6f7fc]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link to="/" className="flex items-center gap-3" aria-label="Agir home">
            <BrandMark />
            <span className="text-xl font-semibold tracking-[-0.03em]">Agir</span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-[#3b456e] lg:flex">
            <a href="#platform" className="transition-colors hover:text-[#4460e6]">
              Platform
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-[#4460e6]">
              How it works
            </a>
            <a href="#why-agir" className="transition-colors hover:text-[#4460e6]">
              Why Agir
            </a>
            <a href="#security" className="transition-colors hover:text-[#4460e6]">
              Data integrity
            </a>
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            {!hasSession && (
              <Link to="/auth">
                <Button
                  variant="ghost"
                  className="text-[#1e2750] hover:bg-[#ecebfb] hover:text-[#4460e6]"
                >
                  Sign in
                </Button>
              </Link>
            )}
            <Link to={primaryTo}>
              <Button className="rounded-full bg-[#3a52d6] px-5 text-white hover:bg-[#2f43c0]">
                {primaryLabel}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </Link>
          </div>

          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-full border border-[#1e2750]/15 lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Toggle navigation"
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-[#1e2750]/10 bg-[#f6f7fc] px-5 py-5 lg:hidden">
            <nav className="flex flex-col gap-4 text-sm font-medium">
              <a href="#platform" onClick={() => setMenuOpen(false)}>
                Platform
              </a>
              <a href="#how-it-works" onClick={() => setMenuOpen(false)}>
                How it works
              </a>
              <a href="#why-agir" onClick={() => setMenuOpen(false)}>
                Why Agir
              </a>
              <a href="#security" onClick={() => setMenuOpen(false)}>
                Data integrity
              </a>
            </nav>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {!hasSession && (
                <Link to="/auth">
                  <Button variant="outline" className="w-full rounded-full">
                    Sign in
                  </Button>
                </Link>
              )}
              <Link to={primaryTo} className={hasSession ? "col-span-2" : ""}>
                <Button className="w-full rounded-full bg-[#3a52d6] text-white">
                  {primaryLabel}
                </Button>
              </Link>
            </div>
          </div>
        )}
      </header>

      <section className="relative">
        <div className="landing-grid absolute inset-0 opacity-60" />
        <div className="absolute -left-40 top-28 size-[34rem] rounded-full bg-[#e1e6fb] blur-3xl" />
        <div className="absolute -right-52 top-8 size-[38rem] rounded-full bg-[#dce7fa] blur-3xl" />

        <div className="relative mx-auto grid max-w-[1440px] gap-12 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:px-12 lg:pb-28 lg:pt-28">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#3a52d6]/20 bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#3a52d6] shadow-sm">
              <Sparkles className="size-3.5" />
              Built for real estate investment teams
            </div>
            <h1 className="mt-7 text-balance text-[3.4rem] font-semibold leading-[0.98] tracking-[-0.065em] sm:text-[4.6rem] lg:text-[5.2rem]">
              Make the call with better evidence.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[#505c80] sm:text-xl">
              Agir gives your team one place to find the best opportunities, underwrite them with
              traceable numbers, and move approved deals to close.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link to={primaryTo}>
                <Button className="h-12 w-full rounded-full bg-[#3a52d6] px-6 text-base text-white shadow-[0_10px_30px_-12px_rgba(11,107,75,0.65)] hover:bg-[#2f43c0] sm:w-auto">
                  {primaryLabel}
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              </Link>
              <a href="#platform">
                <Button
                  variant="outline"
                  className="h-12 w-full rounded-full border-[#1e2750]/20 bg-white/60 px-6 text-base text-[#1e2750] hover:bg-white sm:w-auto"
                >
                  See the platform
                </Button>
              </a>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#505c80]">
              {["No invented numbers", "Source-linked assumptions", "Setup in minutes"].map(
                (item) => (
                  <span key={item} className="flex items-center gap-2">
                    <CircleCheck className="size-4 text-[#3a52d6]" />
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section className="border-y border-[#1e2750]/10 bg-[#15193a] text-white">
        <div className="mx-auto grid max-w-[1440px] gap-8 px-5 py-8 sm:grid-cols-3 sm:px-8 lg:px-12">
          <ProofPoint value="One view" label="Pipeline, underwriting, decisions, and execution" />
          <ProofPoint
            value="Every figure"
            label="Linked to an input, formula, or source document"
          />
          <ProofPoint value="Every handoff" label="Owned, dated, and visible to the team" />
        </div>
      </section>

      <section
        id="platform"
        className="mx-auto max-w-[1440px] px-5 py-24 sm:px-8 lg:px-12 lg:py-32"
      >
        <SectionIntro
          eyebrow="A practical operating system"
          title="The work stays connected from first look to final close."
          body="Agir replaces status hunting and duplicate spreadsheets with a shared record of the deal, the decision, and the work still ahead."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {platformFeatures.map(({ icon: Icon, title, body }, index) => (
            <Card
              key={title}
              className="group border-[#1e2750]/10 bg-white/75 p-6 shadow-[0_18px_50px_-38px_rgba(16,36,30,0.45)] transition-all hover:-translate-y-1 hover:border-[#3a52d6]/30 hover:bg-white"
            >
              <div className="flex items-start justify-between">
                <div className="flex size-11 items-center justify-center rounded-xl bg-[#eaedfd] text-[#3a52d6]">
                  <Icon className="size-5" />
                </div>
                <span className="font-mono text-xs text-[#8a93b4]">0{index + 1}</span>
              </div>
              <h3 className="mt-8 text-xl font-semibold tracking-[-0.025em]">{title}</h3>
              <p className="mt-3 leading-7 text-[#646d92]">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="bg-[#ecebfb]">
        <div className="mx-auto max-w-[1440px] px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
          <SectionIntro
            eyebrow="One continuous record"
            title="A deal should not restart every time it changes hands."
            body="The source documents, approved assumptions, committee rationale, and closing work remain attached to the same deal record."
          />
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-[#1e2750]/10 bg-[#1e2750]/10 lg:grid-cols-5">
            {lifecycle.map(([number, title, body]) => (
              <div key={number} className="bg-[#f6f7fc] p-6 lg:min-h-64">
                <div className="font-mono text-xs text-[#3a52d6]">{number}</div>
                <h3 className="mt-8 text-2xl font-semibold tracking-[-0.035em]">{title}</h3>
                <p className="mt-4 text-sm leading-6 text-[#646d92]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="why-agir"
        className="mx-auto grid max-w-[1440px] gap-14 px-5 py-24 sm:px-8 lg:grid-cols-2 lg:items-center lg:px-12 lg:py-32"
      >
        <div>
          <div className="inline-flex size-12 items-center justify-center rounded-xl bg-[#15193a] text-white">
            <Gauge className="size-6" />
          </div>
          <h2 className="mt-7 max-w-xl text-4xl font-semibold leading-tight tracking-[-0.05em] sm:text-5xl">
            Strong controls should make work easier, not heavier.
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[#646d92]">
            Agir starts with a usable workflow. Teams can add structure as they grow without waiting
            for a consultant to configure the basics.
          </p>
        </div>
        <div className="grid gap-3">
          {[
            [
              "Start quickly",
              "Create a deal, upload documents, and reach a real underwriting result without a long setup project.",
            ],
            [
              "Change the workflow yourself",
              "Manage views, filters, milestones, reports, themes, and language from the product.",
            ],
            [
              "Keep the interface focused",
              "The next decision and next action appear before the supporting detail.",
            ],
            [
              "Take the data with you",
              "Export reports and structured data in formats the rest of your team can use.",
            ],
          ].map(([title, body]) => (
            <div
              key={title}
              className="flex gap-4 rounded-xl border border-[#1e2750]/10 bg-white/75 p-5"
            >
              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#e7ebfc] text-[#3a52d6]">
                <Check className="size-3.5" />
              </div>
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-[#646d92]">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="security" className="px-5 pb-24 sm:px-8 lg:px-12 lg:pb-32">
        <div className="mx-auto grid max-w-[1344px] overflow-hidden rounded-[2rem] bg-[#15193a] text-white lg:grid-cols-[1.05fr_0.95fr]">
          <div className="p-8 sm:p-12 lg:p-16">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#a7baff]">
              Deterministic by design
            </div>
            <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">
              The explanation can be intelligent. The numbers must be exact.
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#c6cdea]">
              Agir separates financial calculation from generated prose. The engine uses approved
              inputs, records its formulas, and stops when required data is missing or conflicting.
            </p>
            <Link to={primaryTo}>
              <Button className="mt-8 rounded-full bg-[#a78bfa] px-6 text-[#1e2750] hover:bg-[#9472f0]">
                {primaryLabel}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </Link>
          </div>
          <div className="relative min-h-[26rem] border-t border-white/10 bg-[#1e2750] p-8 sm:p-12 lg:border-l lg:border-t-0">
            <IntegrityStack />
          </div>
        </div>
      </section>

      <footer className="border-t border-[#1e2750]/10 bg-[#f1f3fd]">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-5 py-10 sm:px-8 md:flex-row md:items-end md:justify-between lg:px-12">
          <div>
            <div className="flex items-center gap-3">
              <BrandMark />
              <span className="text-xl font-semibold">Agir</span>
            </div>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#646d92]">
              A real estate investment workspace built for clear decisions and accountable
              execution.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#505c80]">
            <Link to="/auth" className="hover:text-[#3a52d6]">
              Sign in
            </Link>
            <a href="#platform" className="hover:text-[#3a52d6]">
              Platform
            </a>
            <a href="#security" className="hover:text-[#3a52d6]">
              Data integrity
            </a>
            <span>© {new Date().getFullYear()} Agir</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function BrandMark() {
  return (
    <span className="flex size-9 items-center justify-center rounded-lg bg-[#3a52d6] text-base font-semibold text-white shadow-sm">
      A
    </span>
  );
}

function SectionIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="max-w-3xl">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#3a52d6]">
        {eyebrow}
      </div>
      <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.05em] sm:text-5xl">
        {title}
      </h2>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-[#646d92]">{body}</p>
    </div>
  );
}

function ProofPoint({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-white/10 sm:border-r sm:pr-8 last:border-r-0">
      <div className="text-xl font-semibold tracking-[-0.025em]">{value}</div>
      <div className="mt-1 text-sm leading-6 text-[#b6bedf]">{label}</div>
    </div>
  );
}

function ProductPreview() {
  const stages = [
    ["Screening", "6", "$148M"],
    ["Underwriting", "4", "$93M"],
    ["Committee", "2", "$61M"],
  ] as const;

  return (
    <div className="relative mx-auto w-full max-w-3xl lg:ml-auto">
      <div className="absolute -inset-5 rounded-[2rem] bg-gradient-to-br from-[#c4b5fd]/30 to-[#9db8e8]/30 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-[#1e2750]/15 bg-[#fbfcff] shadow-[0_35px_80px_-32px_rgba(16,36,30,0.55)]">
        <div className="flex h-12 items-center justify-between border-b border-[#1e2750]/10 bg-white px-4">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-[#ff746c]" />
            <span className="size-2.5 rounded-full bg-[#f4c34e]" />
            <span className="size-2.5 rounded-full bg-[#86a3ff]" />
          </div>
          <div className="rounded-full bg-[#eef1fc] px-3 py-1 font-mono text-[9px] uppercase tracking-widest text-[#646d92]">
            Live investment overview
          </div>
          <div className="size-6 rounded-full bg-[#1e2750] text-center text-[9px] leading-6 text-white">
            MH
          </div>
        </div>

        <div className="grid min-h-[31rem] sm:grid-cols-[8rem_1fr]">
          <div className="hidden border-r border-[#1e2750]/10 bg-[#f1f3fd] p-3 sm:block">
            <div className="mb-5 flex items-center gap-2 px-2 py-2">
              <BrandMark />
              <span className="font-semibold">Agir</span>
            </div>
            {["Overview", "Portfolio", "Deal flow", "Execution", "Reports"].map((item, index) => (
              <div
                key={item}
                className={`mb-1 rounded-md px-2.5 py-2 text-[10px] ${index === 0 ? "bg-white font-semibold text-[#3a52d6] shadow-sm" : "text-[#6e7799]"}`}
              >
                {item}
              </div>
            ))}
          </div>

          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#8a93b4]">
                  Investment overview
                </div>
                <div className="mt-1 text-xl font-semibold tracking-[-0.04em]">Good morning</div>
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-[#e7ebfc] px-2 py-1 text-[9px] font-semibold text-[#3a52d6]">
                <span className="size-1.5 rounded-full bg-[#5a78f7]" />
                Live
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <PreviewMetric label="Active deals" value="12" />
              <PreviewMetric label="Gross pipeline" value="$302M" />
              <PreviewMetric label="Avg score" value="74" />
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-xl border border-[#1e2750]/10 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold">Pipeline flow</span>
                  <span className="text-[9px] text-[#8a93b4]">Manage</span>
                </div>
                <div className="mt-4 space-y-4">
                  {stages.map(([stage, count, capital], index) => (
                    <div key={stage}>
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="font-medium">
                          {stage} <span className="text-[#9199b8]">{count}</span>
                        </span>
                        <span className="font-mono">{capital}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eef1fc]">
                        <div
                          className="h-full rounded-full bg-[#4b66ef]"
                          style={{ width: `${82 - index * 21}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#1e2750]/10 bg-[#1e2750] p-3 text-white">
                <div className="text-[9px] uppercase tracking-widest text-[#b6bedf]">
                  Decision ready
                </div>
                <div className="mt-3 text-sm font-semibold">Harbour Centre</div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="font-mono text-3xl">82</div>
                    <div className="text-[8px] text-[#b6bedf]">Investment score</div>
                  </div>
                  <div className="rounded-full bg-[#a78bfa] px-2 py-1 text-[8px] font-semibold text-[#1e2750]">
                    PROCEED
                  </div>
                </div>
                <div className="mt-4 border-t border-white/10 pt-3 text-[9px] leading-4 text-[#ccd2ee]">
                  Returns clear the base hurdles. Resolve two closing conditions before funding.
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-[#1e2750]/10 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold">Priority deals</span>
                <span className="text-[9px] text-[#8a93b4]">Confidence</span>
              </div>
              <div className="mt-2 divide-y divide-[#1e2750]/8">
                {[
                  ["Harbour Centre", "Vancouver industrial", "82"],
                  ["King Street", "Toronto mixed use", "76"],
                  ["Northgate", "Calgary multifamily", "69"],
                ].map(([name, detail, score]) => (
                  <div key={name} className="grid grid-cols-[1fr_auto] items-center gap-3 py-2">
                    <div>
                      <div className="text-[9px] font-semibold">{name}</div>
                      <div className="text-[8px] text-[#8a93b4]">{detail}</div>
                    </div>
                    <div className="font-mono text-xs text-[#3a52d6]">{score}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#1e2750]/10 bg-white p-3">
      <div className="text-[8px] uppercase tracking-wider text-[#8a93b4]">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function IntegrityStack() {
  return (
    <div className="relative mx-auto flex h-full max-w-sm flex-col justify-center">
      {[
        {
          icon: FileCheck2,
          title: "Approved input",
          detail: "Exit cap rate · 5.25%",
          accent: "bg-[#a78bfa] text-[#1e2750]",
        },
        {
          icon: Building2,
          title: "Source evidence",
          detail: "Lender term sheet · page 4",
          accent: "bg-[#b9d8ff] text-[#1e2750]",
        },
        {
          icon: ShieldCheck,
          title: "Engine output",
          detail: "DSCR · 1.42x · formula recorded",
          accent: "bg-[#a7baff] text-[#1e2750]",
        },
      ].map(({ icon: Icon, title, detail, accent }, index) => (
        <div
          key={title}
          className="relative mb-3 flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur"
          style={{ marginLeft: `${index * 1.5}rem` }}
        >
          <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${accent}`}>
            <Icon className="size-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 font-mono text-[10px] text-[#c2c9e8]">{detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
