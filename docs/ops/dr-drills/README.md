# Disaster-recovery drill evidence

`npm run restore:drill` (see `scripts/restore-staging-from-backup.mjs`) writes a
timestamped `restore-drill-<iso>.json` evidence record into this directory after
each run: backup label, measured RTO/RPO (passed via `RESTORE_RTO_SECONDS` /
`RESTORE_RPO_SECONDS`), per-check results, failures, and verification duration.

The generated `*.json` records are git-ignored - they are runtime evidence, not
source. Collect them from CI artifacts or your evidence store (e.g. attach to the
quarterly DR drill ticket) to satisfy the SOC 2 availability criteria. Committing
a curated subset as audit evidence is fine; do it deliberately, not by default.
