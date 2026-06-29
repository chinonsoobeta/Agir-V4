# Pilot Deal Packages

Pilot packages give a first-time user realistic rails. They should be loaded in
a sandbox workspace and compared against known watchpoints.

## Included Packages

1. Rivergate
   - Mixed-use development.
   - Validates rent-roll extraction, budget extraction, lender terms, and no fabricated lease-up.

2. Summit Point Logistics Park
   - Industrial development.
   - Validates industrial rent basis, tenant lease abstracts, budgets, and lender terms.

3. Harbour Centre
   - Residential/mixed-use demo.
   - Validates conflict resolution and default acceptance.

4. Commercial Rent Roll Regression
   - Commercial/industrial synthetic regression set.
   - Validates `$ / SF` handling, scaled money, and false-positive guards.

5. OCR Stress Package
   - Scanned PDF and long appraisal fixtures.
   - Validates OCR fallback, confidence reporting, and page-cap metadata.

The canonical manifest is `src/lib/pilot-demo-packages.ts`.

## Package Review Checklist

- Confirm documents are present.
- Confirm expected assumptions are extracted.
- Confirm known absent fields stay absent.
- Confirm conflicts are visible.
- Confirm generated reports pass numeric provenance.
- Confirm audit package includes project, documents, reports, memo snapshots, and audit log.
