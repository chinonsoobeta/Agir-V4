# Pilot remediation release gate

This runbook is the accountable handoff for the seven-phase remediation program.
It distinguishes implemented controls from evidence that only a qualified human
or production exercise can supply. No deployment, migration, or test run may
convert an external gate from `pending` to `approved`.

## Ownership

| Gate                   | Accountable role                       | Blocking evidence                                                                            |
| ---------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Municipal catalogue    | Qualified municipal catalogue reviewer | Approved category assignments, current source hashes, review notes, next-review date         |
| Legal and privacy      | Qualified counsel                      | Approved limitations, privacy, retention, and customer terms with evidence hash              |
| Accessibility          | Independent accessibility reviewer     | Keyboard, screen-reader, zoom, reduced-motion, and representative-user session report        |
| Security               | Independent security assessor          | Assessment report and closure or accepted disposition of every critical/high finding         |
| Recovery               | Production recovery exercise owner     | Timestamped restore evidence with measured RTO/RPO and document recovery proof               |
| Support and operations | Named pilot support and incident owner | Rotation, escalation path, monitoring destinations, and pilot communication procedure        |
| Engineering            | Engineering owner                      | Clean migration rehearsal, RLS, unit, browser, build, performance, cleanup, and worker gates |

Actual names and immutable evidence hashes are stored in `pilot_external_signoffs`.
The database rejects an `approved` result without a name, SHA-256 evidence hash,
and signature timestamp.

## Engineering acceptance criteria

1. Municipal sources have an observation snapshot, content hash, current status,
   and future check date. A source change or outage blocks catalogue release.
2. Every active permit category has an approved qualified-review assignment and
   a current verified rule record before its municipality can be `reviewed`.
3. Property searches use an immutable, permission-filtered 30-minute result
   session, expose an exact total, and page beyond 200 records without drift.
4. Property uploads persist status across refreshes. Collaborators can observe
   their authorized property's worker state. Failed verification is bounded to
   three reviewed retries.
5. File deletion fails closed if bytes cannot be removed. Replacement uploads
   retain the previous document and increment the explicit version edge.
6. Property deletion marks unfinished objects for bounded cleanup. Cleanup is
   complete only after both Storage deletion and database acknowledgement.
7. Browser, accessibility, RLS, migration, scale, security, recovery, build, and
   deterministic Underwriting checks satisfy the full deployment gate.

## External session evidence template

- Gate and reviewer qualification:
- Reviewer name and organization:
- Participants and assistive technology, if applicable:
- Environment and build commit:
- Tasks exercised:
- Findings by severity:
- Remediation or accepted disposition:
- Evidence location and SHA-256:
- Signed date and expiry/recheck date:
- Result: approved / rejected

An unfilled template is not approval evidence.

## Required execution

```sh
npm run permits:sources:check -- --all
npm run test
npm run test:rls
npm run test:e2e
npm run typecheck
npm run build
npm run bundle:audit
npm run audit:migrations
npm run load:tenant-db
npm run load:property-search-db
npm run restore:drill
npm run pilot:gate -- --full
```

The full gate must fail when its database, browser, production recovery, or
external evidence is unavailable. `--quick` is only a developer preflight.
