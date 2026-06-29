# Unsupervised Pilot Script

Use this script when a professional is testing Agir without live builder
guidance. The pilot is for evaluation only; no investment decision should be
made solely from Agir output.

No investment decision may be recorded from a pilot workspace without human
review and firm approval.

## Setup

1. Create workspace.
2. Confirm workspace members and roles.
3. Open Settings -> Data & privacy and review the enterprise trust controls.
4. Confirm the pilot package and expected watchpoints.

## Deal Workflow

1. Create a project from the selected pilot package.
2. Upload source documents.
3. Confirm scan status, page count, OCR confidence, and extraction status.
4. Extract assumptions.
5. Review every candidate assumption.
6. Resolve conflicts using source text and conservative policy.
7. Accept documented defaults only when the source package is genuinely missing a required input.
8. Run underwriting.
9. Inspect the main metrics and use "explain this number" on at least five figures.
10. Generate IC memo.
11. Lock or snapshot the memo before recording a decision.
12. Export the customer audit package.

## Success Criteria

- Time-to-underwriting is less than 45 minutes for a prepared package.
- No support intervention is required for upload, extraction, assumption review, underwriting, memo, or audit export.
- User can explain why the top five metrics are trusted.
- User can identify which controls are implemented and which require external SOC 2, pen-test, SSO, SCIM, legal, or operations work.

## Failure Criteria

- User cannot find the next action.
- User cannot distinguish approved, pending, defaulted, and conflicted assumptions.
- User cannot trace a displayed metric to source inputs.
- Extraction silently fabricates a required assumption.
- Audit package export is missing source documents, assumptions, reports, memo snapshots, or audit logs.
