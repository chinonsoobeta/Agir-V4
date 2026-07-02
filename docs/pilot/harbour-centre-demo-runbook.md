# Harbour Centre Underwriting Demo

Use this path for a deterministic pilot session. It does not require external AI; AI controls may be enabled, but the baseline flow works through fixture-backed documents, approved assumptions, and the TypeScript underwriting engine.

## Launch

```bash
AGIR_SCHEMA_COMPAT_MODE=demo npm run dev
```

Open the app, sign in with a local/demo user, then seed **Harbour Centre** from the demo picker. Harbour is the pre-seeded demo package with verified assumptions, realistic uploaded documents, a documented exit-cap conflict, and missing/defaultable inputs for the readiness gate.

## Session Flow

1. Open the Harbour Centre project.
2. Go to Documents and confirm the offering, rent roll, budget, term-sheet, and appraisal-style sources are present.
3. Go to Assumptions and run extraction if you want to show the pipeline; otherwise use the pre-seeded review register.
4. Open the conflict center and show the exit-cap conflict with source/provenance visible.
5. Resolve one conflict by choosing the documented conservative value, then approve the remaining critical assumptions.
6. Go to Underwriting. If the run is blocked, use the readiness list to accept static defaults or resolve the named blockers.
7. Run underwriting and show verdict, TDC, DSCR, LTC, profit/yield metrics, risk flags, and reconciliation flags.
8. Generate the memo/report. The report must present deterministic financial outputs; AI prose, if enabled, is verified and falls back to the deterministic template on model failure.
9. Open the audit/provenance trail and show extraction, approval, conflict resolution, underwriting, and memo events.

## Expected Moments

- One conflict/provenance moment is visible before underwriting.
- Underwriting runs only after approval/default acceptance.
- Demo schema compatibility is explicit through `AGIR_SCHEMA_COMPAT_MODE=demo`; staging and production should run strict mode.
- Final numbers are stable because approved assumptions and the deterministic engine own the financial outputs.
