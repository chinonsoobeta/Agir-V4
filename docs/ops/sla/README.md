# SLA / uptime evidence

`npm run sla:probe` (see `scripts/sla-probe.mjs`) hits `/api/health` on
`PROBE_TARGET`, appends the sample to `uptime-samples.jsonl`, and writes a
rolling `sla-summary.json` (availability, p50/p95 latency vs the configured SLO).

Both generated files are git-ignored - they are runtime evidence. For a real
availability SLA, run this on a schedule from **outside** the deployment (an
external synthetic monitor), since a probe co-located with the app can't observe
the app being down. See `docs/compliance/enabler-status.md`.
