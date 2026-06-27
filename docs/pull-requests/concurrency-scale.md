# Concurrency and Scale Pass

## Race safety

- Assumption review writes now use optimistic concurrency on `assumptions.current_version`.
- A stale concurrent approve/modify/reject writes zero rows and returns: `Assumption changed while you were reviewing it. Refresh and retry.`
- Before `runFullUnderwriting` executes the deterministic engine, approved/modified review rows are checked against the engine-readable tables. If an approval is mid-propagation or a stale engine row would be used, the run fails closed with a retry message.

## N+1 loader review

- `loadReportData` issues one project query, one parallel sweep across report tables, and one batched `assumption_versions.in("assumption_id", ids)` query. Regression test coverage proves multiple assumptions do not trigger per-assumption version queries.
- `listPortfolio` already batches portfolio data with one query each for projects, outputs, assumptions, decisions, and documents, then groups in memory by `project_id`.
- `compareDeals` already batches selected projects, outputs, and assumptions with `in("project_id", ids)`.

Observed report-loader reduction versus the naive pattern: for `N` assumptions, assumption version loading stays at `1` query instead of `N`.

## Large-document extraction

- Candidate extraction remains bounded by `EXTRACTION_TEXT_SCAN_CHAR_LIMIT = 40,000` characters per document before candidate ranking/classification.
- Focused local run: `bytes=1115010`, `scanned_chars=40000`, `candidates=805`, `elapsed_ms=7.3`.
- OCR page-cap metadata remains surfaced through `ocr_pages_processed`, `ocr_total_pages`, and `ocr_truncated`; the existing mocked scanned-PDF test asserts the cap is visible to callers.
