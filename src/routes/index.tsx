import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileClock,
  FileText,
  Menu,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PERMIT_MUNICIPALITIES } from "@/lib/permit-municipalities";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agir | Permit research and workflow" },
      {
        name: "description",
        content:
          "Agir is a property research and workflow system for assembling, reviewing, sharing, and tracking permit information.",
      },
      { property: "og:title", content: "Agir | Permit research and workflow" },
      {
        property: "og:description",
        content:
          "Keep permit sources, review dates, documents, unresolved questions, and responsibility together.",
      },
    ],
  }),
  component: LandingPage,
});

const municipalities = PERMIT_MUNICIPALITIES;

const permitCapabilities = [
  {
    icon: ClipboardCheck,
    title: "Review potential permits",
    body: "Compare possible approvals, keep the source, and record what still needs checking.",
  },
  {
    icon: FileClock,
    title: "Keep sources and dates visible",
    body: "Retain official URLs, review dates, freshness, known gaps, and explicit unknowns.",
  },
  {
    icon: FileText,
    title: "Track paperwork and documents",
    body: "Keep applications, checklist items, dates, files, and review status with the permit case.",
  },
  {
    icon: Users,
    title: "Share responsibility",
    body: "Work with authorized collaborators, assign responsibility, and preserve handoff history.",
  },
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

  const primaryTo = hasSession ? "/permits" : "/auth";
  const primaryLabel = hasSession ? "Open permit workspace" : "Get started";

  return (
    <main className="landing min-h-screen overflow-hidden bg-[#f6f7fc] text-[#0d2436]">
      <header className="relative z-50 border-b border-[#183046]/10 bg-[#f6f7fc]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link to="/" className="flex items-center gap-3" aria-label="Agir home">
            <BrandMark />
            <span className="text-xl font-semibold">Agir</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-[#3b456e] lg:flex">
            <a href="#permits">Permit workflow</a>
            <a href="#coverage">Coverage</a>
            <a href="#underwriting">Underwriting Preview</a>
            <a href="#trust">Limitations and data</a>
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            {!hasSession && (
              <Link to="/auth">
                <Button variant="ghost">Sign in</Button>
              </Link>
            )}
            <Link to={primaryTo}>
              <Button className="rounded-full bg-[#00628e] px-5 text-white hover:bg-[#00537f]">
                {primaryLabel}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </Link>
          </div>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-full border border-[#183046]/15 lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-landing-navigation"
            aria-label="Toggle navigation"
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {menuOpen && (
          <div
            id="mobile-landing-navigation"
            className="border-t border-[#183046]/10 px-5 py-5 lg:hidden"
          >
            <nav className="flex flex-col gap-4 text-sm font-medium" aria-label="Landing page">
              <a href="#permits" onClick={() => setMenuOpen(false)}>
                Permit workflow
              </a>
              <a href="#coverage" onClick={() => setMenuOpen(false)}>
                Coverage
              </a>
              <a href="#underwriting" onClick={() => setMenuOpen(false)}>
                Underwriting Preview
              </a>
              <a href="#trust" onClick={() => setMenuOpen(false)}>
                Limitations and data
              </a>
            </nav>
            <Link to={primaryTo}>
              <Button className="mt-5 w-full rounded-full bg-[#00628e] text-white">
                {primaryLabel}
              </Button>
            </Link>
          </div>
        )}
      </header>

      <section className="relative border-b border-[#183046]/10">
        <div className="landing-grid absolute inset-0 opacity-50" />
        <div className="relative mx-auto grid max-w-[1440px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-12 lg:py-28">
          <div className="max-w-3xl">
            <p className="inline-flex rounded-full border border-[#00628e]/20 bg-white/75 px-3 py-1.5 text-xs font-semibold text-[#00628e]">
              Property research and workflow system
            </p>
            <h1 className="mt-7 text-balance text-5xl font-semibold leading-[1.02] sm:text-6xl lg:text-7xl">
              Keep permit research clear and organized.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-[#505c80] sm:text-xl">
              Agir helps professionals assemble, review, source, share, hand off, and track permit
              information by property or project.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link to={primaryTo}>
                <Button className="h-12 w-full rounded-full bg-[#00628e] px-6 text-base text-white hover:bg-[#00537f] sm:w-auto">
                  {primaryLabel}
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              </Link>
              <a href="#permits">
                <Button
                  variant="outline"
                  className="h-12 w-full rounded-full px-6 text-base sm:w-auto"
                >
                  See the permit workflow
                </Button>
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#505c80]">
              {["Built for project teams", "Clear gaps", "Source and review history"].map(
                (item) => (
                  <span key={item} className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-[#00628e]" />
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>
          <Card className="border-[#183046]/10 bg-[#0d2436] p-7 text-white shadow-2xl sm:p-9">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8ec5e0]">
              Permit case
            </p>
            <h2 className="mt-3 text-2xl font-semibold">Renovation review</h2>
            <dl className="mt-7 space-y-3 text-sm">
              <CaseState label="Municipality" value="Confirmed by user" />
              <CaseState label="Zoning" value="Unknown" />
              <CaseState label="Possible approvals" value="Not confirmed" />
              <CaseState label="Source check" value="Review date shown" />
              <CaseState label="Responsibility" value="Assigned to project team" />
            </dl>
            <p className="mt-7 border-t border-white/10 pt-5 text-sm leading-6 text-[#b6c6d6]">
              Keeping a possible approval does not make it a legal requirement. Confirm important
              decisions with the authority or a qualified professional.
            </p>
          </Card>
        </div>
      </section>

      <section id="permits" className="mx-auto max-w-[1440px] px-5 py-24 sm:px-8 lg:px-12">
        <SectionIntro
          eyebrow="Permit research and workflow"
          title="Keep every source, file, and task with the property."
          body="Agir is designed for builders, permit consultants, architects, contractors, engineers, experienced property owners, and professional project teams."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {permitCapabilities.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="border-[#183046]/10 bg-white/80 p-6">
              <div className="flex size-11 items-center justify-center rounded-xl bg-[#daebf7] text-[#00628e]">
                <Icon className="size-5" />
              </div>
              <h3 className="mt-7 text-xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#646d92]">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="coverage" className="bg-[#e4f0fa]">
        <div className="mx-auto max-w-[1440px] px-5 py-24 sm:px-8 lg:px-12">
          <SectionIntro
            eyebrow="Coverage boundaries"
            title="Create cases across 22 British Columbia municipalities."
            body="All 21 Metro Vancouver municipalities plus Kelowna are available. Each jurisdiction has a dated official-source inventory; project-specific permit decisions still require case evidence and qualified review."
          />
          <div className="mt-10 flex flex-wrap gap-3">
            {municipalities.map((name) => (
              <span
                key={name}
                className="rounded-full border border-[#183046]/15 bg-white px-4 py-2 text-sm font-medium"
              >
                {name}
              </span>
            ))}
          </div>
          <p className="mt-7 max-w-3xl text-sm leading-6 text-[#505c80]">
            A municipality being researched does not mean its catalogue is professionally approved.
            Unreviewed categories remain clearly marked, and missing coverage never means that no
            permit is required.
          </p>
        </div>
      </section>

      <section
        id="underwriting"
        className="mx-auto grid max-w-[1440px] gap-10 px-5 py-24 sm:px-8 lg:grid-cols-2 lg:items-center lg:px-12"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#00628e]">
            Separate product mode
          </p>
          <h2 className="mt-5 text-4xl font-semibold sm:text-5xl">
            Underwriting <span className="text-[#00628e]">Preview</span>
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#646d92]">
            Agir also provides deterministic underwriting and decision workflows. Underwriting is
            available to signed-in users as a Preview and remains separate from Permits.
          </p>
        </div>
        <Card className="border-[#183046]/10 bg-white p-7">
          <h3 className="text-lg font-semibold">A strict product boundary</h3>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-[#505c80]">
            <li>Financial outputs use approved inputs and deterministic calculations.</li>
            <li>Permit information does not enter underwriting through implicit coupling.</li>
            <li>Case-only documents are excluded from underwriting inputs.</li>
            <li>Existing authorized bookmarks remain separate from permit cases.</li>
          </ul>
        </Card>
      </section>

      <section id="trust" className="bg-[#0d2436] text-white">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:px-12">
          <div>
            <ShieldCheck className="size-8 text-[#8ec5e0]" />
            <h2 className="mt-5 text-4xl font-semibold">State the limits directly.</h2>
            <p className="mt-5 text-lg leading-8 text-[#b6c6d6]">
              Agir preserves unknowns, unavailable sources, conflicting evidence, and stale reviews.
              It does not infer zoning from address autocomplete or turn missing evidence into a
              conclusion.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Access and data</h3>
            <p className="mt-4 text-sm leading-7 text-[#b6c6d6]">
              Sign-in and workspace roles control access. Document access uses authenticated,
              case-scoped authorization. Pilot analytics are designed to avoid document contents and
              complete addresses.
            </p>
            <p className="mt-4 text-sm leading-7 text-[#b6c6d6]">
              Legal, privacy, municipal, operational, comprehension, and security reviews must be
              recorded before Agir can be described as pilot-ready.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#183046]/10 px-5 py-10 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="font-semibold">Agir</p>
              <p className="text-sm text-[#646d92]">Property research and workflow system</p>
            </div>
          </div>
          <div className="flex gap-5 text-sm text-[#505c80]">
            <Link to="/auth">Sign in</Link>
            <a href="#trust">Limitations and data</a>
            <span>© {new Date().getFullYear()} Agir</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function BrandMark() {
  return (
    <span className="flex size-9 items-center justify-center rounded-lg bg-[#00628e] text-white">
      <Building2 className="size-[18px]" />
    </span>
  );
}

function SectionIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#00628e]">{eyebrow}</p>
      <h2 className="mt-5 text-4xl font-semibold leading-tight sm:text-5xl">{title}</h2>
      <p className="mt-5 text-lg leading-8 text-[#465270]">{body}</p>
    </div>
  );
}

function CaseState({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
      <dt className="text-[#b6c6d6]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
