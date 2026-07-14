# Permit pilot operations and release report

Status date: 2026-07-14

Release recommendation: Do not begin the professional pilot yet. The repository's strict automated release gate passes, but qualified legal and municipal approval, representative comprehension sessions, independent security review, a production restoration exercise, and named support and monitoring ownership are not recorded. Passing software checks is not a substitute for those external gates.

## Automated release evidence

The clean disposable-database release run on 2026-07-14 completed with 18 checks passed, 0 failed, 0 skipped, and 0 blocked. Evidence included 779 unit tests, 133 Playwright workflows across Chromium, Firefox, WebKit, and mobile Chromium, 33 live RLS/concurrency assertions, 63 fresh migrations, generated-type and schema-drift checks, deterministic underwriting golden coverage, production build and bundle checks, secret scanning, zero dependency vulnerabilities, extraction-worker contract verification, and audit-chain verification.

This proves the checked repository state, not the production operating environment. The RLS suite is intentionally destructive and is guarded for throwaway databases only.

The configured hosted Supabase database was upgraded with migrations `20260712000300` through `20260712001100` on 2026-07-14. A post-apply dry run reported zero pending migrations. No production backup restoration or alert-delivery exercise was performed by that migration operation.

## Recovery runbook

Use `docs/runbooks/standalone-permits-release.md` with `docs/ops/disaster-recovery.md`.

1. Label a database backup and record its recovery point before migration.
2. Record pre-deployment counts with `docs/sql/permit-release-verification.sql`.
3. Apply migrations to a disposable copy first. Run fresh and upgrade paths.
4. Verify permit cases, permits, requirements, documents, links, assignments, handoffs, and history counts.
5. For an integrity failure, disable Permit mode and restore the labelled backup. Do not delete or move Storage objects.
6. Run document reference recovery and audit-chain verification after restoration.
7. Record actual recovery point objective, recovery time objective, elapsed recovery time, operator, result, and follow-up work.

No restoration drill is recorded for this release, so the operational gate fails.

## Monitoring and alerts

| Signal                          | Initial threshold                                        | Action                                                | Data minimization                                       |
| ------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Authorization denials           | More than 20 per user or 100 per workspace in 15 minutes | Security review and possible session revocation       | User, workspace, route, object type, decision code only |
| Candidate backlog               | More than 50 open or 10 overdue for 24 hours             | Notify catalogue review owner                         | No address or document content                          |
| Stale sources                   | Any source used by an active case becomes stale          | Mark stale, queue review, notify source owner         | Rule and authority IDs only                             |
| Source unavailable or changed   | Any transition                                           | Fail closed and create review item                    | URL, hash, status, timestamp                            |
| Upload failures                 | More than 5 percent over 30 minutes                      | Operations review; preserve recoverable pending state | File type, size band, failure code, no filename         |
| Invitation failures             | More than 5 for one workspace in 30 minutes              | Support and security review                           | Workspace, domain, failure code                         |
| Handoff failures                | More than 3 for one case in 30 minutes                   | Support review                                        | Case ID and transition code                             |
| Extraction verification backlog | Oldest queued job exceeds 15 minutes                     | Worker incident                                       | Job and document IDs, no content                        |

Alerts must identify an on-call owner before pilot activation. Production alert delivery is not configured or verified in this release.

## Support and incident plan

- Required owners: pilot support owner, engineering incident commander, security lead, catalogue review owner, and product owner.
- User-facing route: in-product support action and `support@agir.app`. The mailbox and service level must be confirmed before use.
- Severity 1: cross-workspace access, document exposure, audit forgery, data loss, or unsupported conclusion presented as confirmed. Disable the affected feature and begin the security incident process.
- Severity 2: upload, invitation, handoff, source review, or candidate generation unavailable for a cohort. Preserve data, communicate the limitation, and track recovery.
- Rollback criteria: failed integrity query, authorization regression, migration mismatch, unexplained underwriting golden change, or required gate skipped.
- Known issues belong in a dated register with owner, impact, workaround, and closure evidence.

## Pilot onboarding

1. Product owner records the organization, professional role, intended municipality, intended case type, onboarding date, and support owner.
2. Any authenticated user can currently enter Permits and Underwriting by explicit product decision. The legacy `pilot_user_access` records remain available for cohort operations and reporting, but do not gate product entry.
3. Support explains candidate versus requirement, unknown versus not required, user-provided versus source-supported, source review versus professional confirmation, and applicability versus workflow status.
4. The participant completes a case creation, candidate review, document upload, assignment, handoff, and history walkthrough.
5. Support records misunderstandings without collecting complete addresses or document contents for analytics.

## Pilot offboarding

1. Change pilot status to paused, then offboarded. Revoke workspace membership and Underwriting Preview entitlement as applicable.
2. Resolve or transfer shared-case ownership, active assignments, pending handoffs, and pending invitations.
3. Offer a documented export format for cases, permits, paperwork, source references, history, and document metadata. Document bytes require separately authorized export.
4. Process deletion through the existing governance request workflow. Preserve the limited audit evidence required by the approved retention policy.
5. Clean abandoned uploads and verify document references before deleting objects.
6. Record completion, retained categories, retention basis, support owner, and confirmation sent to the user.

Retention wording and deletion limitations require legal and privacy approval.

## Accessibility report

Implemented foundations include a skip link, semantic tabs, labelled radiogroups and progress bars, active-mode announcement, keyboard address suggestions, minimum touch targets, focus handling, reduced-motion handling, and responsive layouts. Automated axe and keyboard coverage passes across the supported Chromium, Firefox, WebKit, and mobile-Chromium matrix.

Still required:

- Manual keyboard walkthrough with representative users, including focus return and error recovery.
- VoiceOver and NVDA walkthroughs.
- Recorded 200 percent zoom review of every material state.
- A facilitated comprehension and accessibility session with representative property professionals.

The accessibility gate fails until these checks are recorded.

## Security review

Implemented controls include authenticated server functions, workspace and personal-case RLS, viewer read-only policies, removed-member revocation, case-scoped and pending-upload document access, signed uploads and downloads, filename guards, safe source URL constraints, append-only history grants, fixed security-definer search paths, rate limits, worker-token revocation checks, and transactional case linking.

Required evidence remains:

- Independent security review with no unresolved critical or high-severity issue.
- Production role-change and token-revocation exercise during active sessions.

The security gate fails until these checks are recorded.

## Deployment checklist

- [ ] Approved legal and privacy copy is effective and rendered.
- [ ] Six municipality reviews are signed and current.
- [ ] Support, incident, catalogue, and monitoring owners are named.
- [x] Formatting, lint, TypeScript, and generated database types pass.
- [x] Fresh migration, upgrade migration, migration safety, and schema drift pass in the disposable release environment.
- [x] Permit unit, document, collaboration, handoff, live RLS, and Storage tests pass.
- [x] Browser E2E and automated accessibility checks pass on Chromium, Firefox, WebKit, and mobile Chromium.
- [x] Underwriting golden regression passes unchanged.
- [x] Production build and bundle audit pass.
- [x] Secret and dependency scans pass with zero dependency vulnerabilities.
- [ ] Backup restoration and document recovery drills pass.
- [ ] Monitoring, alerts, incident ownership, rollback, and known-issues register are active.
- [ ] No required check is skipped, disabled, pending indefinitely, or omitted.

## Feedback and analytics plan

Users can flag sources, rules, candidates, permits, document extraction, authority identity, review dates, and catalogue gaps. Preserve the original record and store reason, reporter, timestamp, related evidence, review status, resolver, and resolution.

Collect time to first case, time to first reviewed candidate, unknown counts, candidate decision reasons, handoff completion, upload failure codes, catalogue gaps, authorization denials, support workflow, stale or conflicting source cases, and workflow completion. Do not collect full addresses, filenames, document contents, or extracted text merely for analytics.

## Final release gates

| Gate                | Result         | Reason                                                                                                                    |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Legal and privacy   | Failed         | Draft infrastructure exists; qualified approval does not                                                                  |
| Standalone workflow | Automated pass | Unit, browser, migration, Storage, and live-RLS proof pass; representative production workflow exercise remains           |
| Collaboration       | Automated pass | Assignment, handoff, sharing, revocation, and authorization checks pass; notification operations remain external          |
| Operational         | Failed         | Restoration drill, alerts, and named owners are not recorded                                                              |
| Comprehension       | Failed         | Representative professional study is not recorded                                                                         |
| Security            | Failed         | Automated security checks pass; independent review and production revocation exercise are not recorded                    |
| Pilot               | Failed         | The strict automated gate passes, but the external legal, municipal, comprehension, security, and operations gates do not |

## Known risks and catalogue gaps

- The requested municipal footprint is represented in the catalogue, but only seven municipalities have partial research coverage; fifteen are not started and none has qualified approval recorded.
- Many category rows intentionally remain unknown because a category-specific official determination is not recorded.
- Source retrieval can fail or be blocked. Unavailable is not interpreted as not required.
- Notification delivery and complete professional review operations remain incomplete.
- Property search currently evaluates the newest 200 property records; cursor pagination and direct upload from the canonical Property file area remain follow-up work. Existing deal and permit documents can be linked to a Property.
- Legal and privacy wording is draft only.

## Recommended rollout sequence

1. Internal engineering environment with fresh database and all automated gates.
2. Named internal reviewers using the currently open authenticated access policy.
3. Qualified municipal, legal, privacy, security, accessibility, and professional workflow review.
4. Restoration drill and alert exercise.
5. Small named professional cohort in one reviewed municipality with daily support review.
6. Add municipalities one at a time only after catalogue and support evidence is current.
7. Consider broader access only after every release gate passes and product ownership explicitly approves it.
