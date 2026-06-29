# Penetration Test Readiness

This checklist prepares Agir for an external third-party penetration test. It is
not a substitute for that test.

## Scope

- Authentication and session handling.
- Workspace RLS and tenant isolation.
- Role escalation: owner, admin, member, viewer.
- Signed document URL scope and expiry, including a signed document URL replay test.
- File upload and document parsing.
- Prompt-injection boundary for extraction and copilot features.
- SQL injection and PostgREST filter misuse.
- Rate-limit bypass on extraction, chat, reports, and upload paths.
- Audit-log tampering attempts.
- Data export authorization.

## Pre-Test Evidence

- Latest full CI verification.
- RLS smoke harness output.
- Workspace role matrix tests.
- Schema migration list.
- Seed test accounts for each role.
- Architecture diagram and data-flow notes.
- Known limitations and excluded environments.

## Remediation Tracker

| Finding               | Severity | Owner    | Status | Regression Test | Notes           |
| --------------------- | -------- | -------- | ------ | --------------- | --------------- |
| Pending external test | TBD      | Security | Open   | TBD             | Schedule vendor |

## Clean-Test Exit Criteria

- Critical and high findings remediated or accepted in writing.
- Medium findings have owner and due date.
- Regression tests added for tenant isolation, auth bypass, signed URL, or injection findings.
- Retest letter received from the external firm.
