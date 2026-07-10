# Agir: Deterministic Development Underwriting

Agir is a project-finance underwriting terminal for real estate development deals. It ingests deal documents, extracts the assumptions deterministically, runs a deterministic underwriting engine, and produces auditable investment memos and stakeholder reports (PDF / DOCX / XLSX).

The defining principle: **every financial number is deterministic and traceable.** A language model may classify extracted candidates or write prose, but it never invents a value. Each figure is verified by a numeric-provenance check before it reaches a screen or a report.

---

## Core principles

1. **Deterministic, not model output.** All underwriting math is pure functions over approved inputs.
2. **No invented numbers.** The LLM is optional and may only write prose around already-computed values. With no API key, the app is fully deterministic.
3. **Provenance-verified.** Every memo and report runs a numeric-provenance verifier: each numeric token must trace to an approved/calculated/default-accepted input, an engine output, a reconciliation figure, or simple arithmetic over those. Orphan numbers flag the artifact `needs_review` rather than being silently emitted.
4. **Fail closed.** When required inputs are missing or conflicting, underwriting is blocked and the UI says exactly what is missing: it never fills gaps on its own.
5. **Auditable.** Every persisted output carries `formula_text`; inputs carry `source = extracted | analyst | default` and a status (`approved | default_accepted | calculated | extracted | conflicting | rejected`).

---

## What it does

### 1. Assumption extraction (deterministic)

- Parses uploaded documents (PDF, XLSX/XLS, CSV, TXT, best-effort DOCX) into text.
- A regex candidate extractor lifts currency, percent, bps, ratios, units, SF, rents, and durations with their surrounding label/context.
- A deterministic **alias mapper** (no LLM) maps each candidate to a canonical assumption key using line-scoped label proximity and unit/kind compatibility. An optional AI pass only classifies candidates the deterministic mapper leaves unresolved, and can never override it or mint a value.
- Conflicting values for one key are preserved as a `conflicting` assumption (e.g. a documented exit-cap conflict) and block underwriting until resolved.
- "Run Extraction" returns a structured **debug trace** (per-document download/parse/candidate counts) surfaced in the UI.

### 2. Deterministic underwriting engine (`src/lib/engine`)

Pure TypeScript. Computes TDC, GPR/EGI/NOI, yield on cost, development spread, exit value, DSCR, equity multiple, IRR (or "not meaningful" on an equity wipeout: never a misleading 0.00%), plus a base case and five stress scenarios, reconciliation flags, a risk register, and a verdict. It is **fail-closed**: it reads only `approved` / `default_accepted` rows.

### 3. Investment memo generator

- A deterministic IC memorandum built from approved assumptions + engine outputs (stat strip, verdict banner, KPI cards, sources & uses, revenue build, scenario analysis, covenant compliance, risks, reconciliation flags, required actions, document sources, footnotes).
- Optional AI-assisted prose when `ANTHROPIC_API_KEY` is set; numbers stay deterministic either way and are provenance-verified.
- Exports to **PDF** (jsPDF) and **DOCX** (`docx`).

### 4. Reports

Four stakeholder reports generated from deterministic outputs only, each with a readiness check, in-app preview, and persisted history:

| Report               | PDF | DOCX | XLSX |
| -------------------- | :-: | :--: | :--: |
| Investor Report      |  ✓  |  ✓   |  ✓   |
| Lender Package       |  ✓  |  ✓   |  ✓   |
| Executive Summary    |  ✓  |  ✓   |      |
| Internal Team Report |  ✓  |      |  ✓   |

Reports fail closed (e.g. "Run deterministic underwriting before generating this report"), surface unresolved reconciliation errors prominently, and disclose default-accepted inputs.

### 5. Investment operating console

- A live executive overview for pipeline capital, weighted opportunity value, decision scores, risk exceptions, velocity, and upcoming close dates.
- Searchable deal flow with source, probability, target-close tracking, status management, and realtime refresh.
- Deal-execution milestones for diligence, financing, legal, and closing work, including blockers and overdue items.
- Market-signal tracking for cap rates, rents, vacancy, construction costs, financing benchmarks, and other decision context.
- Integration connection registry for CRM, data warehouse, document, spreadsheet, webhook, and internal API workflows.
- Portfolio-level concentration, confidence, risk, and pipeline-velocity insights derived from deterministic decision outputs.
- Persistent light/dark/system themes and English/French workspace navigation.

---

## Core formulas

- Total development cost before financing = land + hard + soft + contingency
- Interest reserve = loan × interest rate × `(construction + lease-up months) / 12` × average outstanding factor
- TDC = pre-financing cost + interest reserve
- GPR = Σ (units × monthly rent × 12) or (SF × $/SF) per component
- EGI = Σ (component GPR × occupancy) + other income
- NOI = EGI − operating expenses
- Yield on cost = NOI / TDC · Development spread = yield − exit cap
- Exit value = NOI / exit cap · Development profit = exit value − TDC
- LTC = loan / TDC · DSCR = NOI / annual debt service
- Equity multiple = distributions / equity · IRR solved from the equity cash-flow vector (not computable without a sign change)

---

## Tech stack

- **Framework:** TanStack Start (React 19, TanStack Router/Query), Vite, Tailwind v4, shadcn/ui
- **Backend:** Supabase (Postgres + Auth + Storage), fail-closed RLS
- **Docs/exports:** `unpdf` (read), `xlsx` (read/write), `jspdf` (PDF), `docx` (DOCX)
- **AI (optional):** `@ai-sdk/anthropic`: prose only
- **Tests:** Vitest

---

## Local development

Requires **Node >=22 <25** (the Supabase realtime client needs native WebSocket; Node 20 will not run the app). The range is enforced in `package.json`; `.nvmrc` pins the local default to Node 22.

```bash
nvm install 22 && nvm use 22
npm install
cp .env.example .env.local       # fill in Supabase values (see below)
npm run dev                       # http://127.0.0.1:8081
```

### Running fully locally with no cloud account

A local Supabase stack provides auth, Postgres, and Storage with no cloud credentials:

```bash
# one-time tooling (macOS): a container runtime + the Supabase CLI
brew install colima docker supabase/tap/supabase
colima start --cpu 2 --memory 4 --disk 30
supabase start                    # prints local URL + keys
supabase db reset                 # applies migrations + seed
```

Put the values from `supabase status -o env` into `.env.local`: both the `SUPABASE_*` and the browser-side `VITE_SUPABASE_*` copies. Seeded demo login: `maple.heights@example.com` / `password123`.

Notes:

- `supabase/config.toml` disables the analytics/vector service, which otherwise fails under colima's Docker socket.
- The `documents` storage bucket is not created by migrations: create it once: `insert into storage.buckets (id,name,public) values ('documents','documents',false)`.
- The dev server launches on Node 22 via `.claude/dev-node22.sh`.

### AI is optional

Leave `ANTHROPIC_API_KEY` unset and the memo/report generators use the deterministic template. Set it to enable AI-assisted prose: financial figures remain deterministic and provenance-verified.

---

## Verify

```bash
npm run test     # Vitest: engine, extraction, memo, and reports suites
npm run build    # production build
```

### Browser workflow checks

Playwright runs against a real rendered app and the seeded demo user. Start a
local Supabase stack, export the `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` values from `supabase status -o env`, then run:

```bash
node scripts/ensure-demo-user.mjs
npm run test:e2e
```

Set `E2E_BASE_URL` to target an already-running app. The Harbour Centre E2E
spec exercises document visibility, assumption provenance/confidence, explicit
conflict resolution, fail-closed blocked underwriting controls, memo readiness,
and audit signals without external AI credentials.

### Upload security and full confidence gate

Document uploads use a short-lived server-authorized pending record. The
browser can upload only to the signed path bound to that record; Agir then
downloads, measures, scans, and hashes the object on the server before it
creates a usable document. Client metadata and client hashes are never
authoritative. Run `npm run uploads:cleanup` on a trusted scheduler every 15
minutes to remove expired reservations.

For the non-skipping local release-equivalent gate, start Supabase, export its
URL/anon/service/database values, seed the demo user, install Chromium, then
run `npm run confidence:full`. It fails rather than skipping RLS, audit-chain,
or browser proof when the environment is absent.

---

## Project layout

```
src/lib/engine/            Deterministic underwriting engine (pure)
src/lib/assumption-*.ts    Candidate extraction + deterministic alias mapping
src/lib/memo-*.ts          IC memo model, PDF/DOCX renderers, provenance
src/lib/reports/           Report registry, data loader, builders, XLSX renderer
src/lib/*.functions.ts     TanStack server functions (assumptions, underwriting, memo, reports)
src/routes/                App routes (dashboard, projects, assumptions, underwriting, reports)
supabase/                  Migrations, seed, config
```

> The deterministic underwriting engine in `src/lib/engine` is the source of truth for every financial number. Treat it as fixed: features build _around_ it, never inside it.
