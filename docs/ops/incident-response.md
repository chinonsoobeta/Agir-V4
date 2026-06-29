# Incident Response Runbook

## Severity Matrix

| Severity | Definition | Response |
| --- | --- | --- |
| SEV1 | Confirmed data exposure, tenant isolation failure, or complete production outage | Page immediately, executive notification, customer comms |
| SEV2 | Major feature outage, degraded auth, report generation failure across customers | Page primary, status update within one hour |
| SEV3 | Single-customer issue, delayed extraction, recoverable data inconsistency | Triage in business hours or on-call discretion |
| SEV4 | Cosmetic or low-risk defect | Backlog with owner |

## Response Steps

1. Declare severity and incident commander.
2. Freeze risky deploys.
3. Preserve logs and audit evidence.
4. Mitigate customer impact.
5. Communicate through the status page for SEV1/SEV2.
6. Open post-incident review within two business days.

## Post-Incident Review Template

- Summary.
- Customer impact.
- Timeline.
- Root cause.
- Detection gap.
- Corrective actions.
- Owner and due date for each action.
- Regression tests or controls added.

## Evidence

- Incident ticket.
- Status-page updates.
- Relevant audit-log export.
- Deploy and CI history.
- PIR document.
