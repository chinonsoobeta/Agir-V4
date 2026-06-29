# On-Call and SLA Policy

## Operational Commitments

Binding SLA language must be approved by leadership and counsel. This file is
the operating baseline for enterprise readiness.

## SLO Draft

- Availability target: 99.9% monthly for authenticated application surfaces.
- SEV1 acknowledgement: 15 minutes.
- SEV2 acknowledgement: 60 minutes.
- Status update cadence: every 60 minutes for SEV1, every 4 hours for SEV2.

## Rotation

- Primary and secondary on-call required.
- Escalation path required for database, auth, storage, and AI/extraction vendors.
- Rotation URL is tracked in workspace compliance settings.

## Exclusions

- Customer IdP outage.
- Customer network controls.
- Planned maintenance with notice.
- Third-party outages outside Agir control, unless contract says otherwise.

## Evidence

- Paging schedule.
- Status-page incident history.
- Alert acknowledgements.
- Monthly availability report.
