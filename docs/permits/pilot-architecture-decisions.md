# Permits-first pilot architecture decisions

Status date: 2026-07-11

## Approved implementation decisions

1. Permit cases remain the neutral aggregate. An underwriting project is an optional link, not a parent required for case creation.
2. Workspace roles remain owner, administrator, member, and viewer. Permit assignment and handoff reference workspace members instead of introducing a second access-control system.
3. Product access is independent from workspace role. Permits access and Underwriting Preview entitlement are allowlisted per user. An entitlement never changes record ownership.
4. Candidate review, applicability, workflow, source freshness, document review, municipality confirmation, professional confirmation, and municipal confirmation remain independent states.
5. Legal copy is versioned data with draft, approved, effective, and superseded states. Only qualified reviewers may supply approval evidence. The application must not infer approval from deployment.
6. Catalogue rows remain historical evidence when stale or superseded. Changed or unavailable sources create review work and never change a candidate into a confirmed requirement.
7. Handoffs are explicit state transitions. Acceptance changes current responsibility while immutable history preserves the previous responsible person, actor, note, and timestamp.
8. Pilot analytics use municipality, workflow event, coarse case type, and durations. They do not store full addresses, filenames, document text, or extracted text.
9. GIS, parcel lookup, zoning inference, and ArcGIS integration remain disabled and out of scope.

## External decisions and approvals

- Legal and privacy wording requires qualified approval.
- Each municipal catalogue requires a named, qualified reviewer and recorded review.
- Production allowlist membership and support ownership require product-owner decisions.
- Notification delivery channels, retention periods, ownership transfer, and personal-case succession require product and legal approval.
- General availability requires independent security review and a recorded restoration drill.

## Implementation order

1. Correct product positioning, default mode, and Underwriting Preview access.
2. Correct the municipality cohort and expose review freshness.
3. Complete case assignment, handoff, source review, feedback, and legal-copy infrastructure.
4. Complete document replacement, cancellation, and recovery UI.
5. Run fresh and upgrade migrations, live RLS, browser, accessibility, security, build, and rollback exercises.
6. Populate external approvals and release evidence. Do not advance a gate without its evidence.
