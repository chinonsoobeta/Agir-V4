# Data Governance Policy

## Scope

This policy covers customer deal data, uploaded documents, user profile data,
generated reports, audit logs, extraction candidates, and underwriting outputs.

## Retention

- Default workspace data retention: 2555 days unless the customer contract says otherwise.
- Audit-log retention minimum: 365 days.
- Deletion requests must be logged in `data_governance_requests`.
- Retention exceptions must identify customer, workspace, reason, approver, and expiry.

## Deletion

Deletion is a controlled workflow:

1. Log a `deletion` data-governance request.
2. Confirm requester authority and customer scope.
3. Export required audit evidence before deletion.
4. Delete application records and storage objects through RLS or service-role maintenance tooling.
5. Record completion evidence URL or ticket ID.
6. Preserve immutable audit events unless legal requirements demand a separate redaction process.

## Export

Customer export requests should include:

- Workspace audit-log CSV.
- Project reports and generated memo artifacts.
- Source document inventory.
- Assumptions and approved underwriting inputs.
- User/member list for the workspace.

## Residency

Data residency commitments are tracked per workspace. A binding residency promise
requires cloud-region architecture, subprocessors aligned to that region, and a
contractual security exhibit reviewed by counsel.

## Encryption

Supported posture values:

- Platform managed.
- Per tenant.
- Customer managed.

Customer-managed keys require a separate KMS integration and operational runbook.
