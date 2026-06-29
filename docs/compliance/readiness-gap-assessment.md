# Enterprise Compliance Readiness Gap Assessment

This assessment separates controls Agir can enforce in product from controls that
require company operations, counsel, auditors, or third-party vendors.

## Implemented in Product

- Workspace roles: owner, admin, member, viewer.
- Admin/member management UI in Settings.
- RLS-backed tenant isolation and role write-hardening.
- Append-only audit logs with workspace-scoped export.
- Data-governance request tracking for export, deletion, DPA, retention, audit, and residency review.
- Deterministic underwriting provenance gates and signed report provenance manifests.
- Ephemeral migration/RLS smoke harness.
- Enterprise compliance posture fields for SSO, SCIM, DPA, encryption mode, RTO/RPO, pen test, DR drill, SOC 2 observation, on-call, and status page.

## Ready for Vendor or Operator Completion

- SSO/SAML: product state and runbook exist; production enablement requires IdP metadata and Supabase/Auth configuration.
- SCIM: product state and provisioning runbook exist; production enablement requires IdP app/token exchange.
- SOC 2 Type II: evidence binder exists; report requires Vanta/Drata or equivalent, control operation, and an external auditor over an observation window.
- Penetration test: readiness scope exists; attestation requires an external firm and remediation cycle.
- Disaster recovery: RTO/RPO fields and drill runbook exist; evidence requires a successful production-like restore drill.
- On-call/SLA: policy templates exist; enforceability requires a staffed rotation, paging provider, and approved commercial SLA.
- DPA/security exhibit: workflow and status tracking exist; approved terms require counsel.
- Tenant/customer-managed encryption: posture tracking exists; customer-managed key delivery requires cloud/KMS architecture work.

## Procurement Packet

Provide these artifacts during enterprise review:

- `docs/compliance/soc2/evidence-binder.md`
- `docs/security/penetration-test-readiness.md`
- `docs/security/sso-scim.md`
- `docs/compliance/data-governance.md`
- `docs/ops/incident-response.md`
- `docs/ops/on-call-sla.md`
- `docs/ops/disaster-recovery.md`
- Latest `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run build` results.
- Latest external pen-test report and SOC 2 report when available.

## Open External Dependencies

1. Choose compliance automation vendor.
2. Select SOC 2 auditor.
3. Select penetration-testing firm.
4. Approve DPA, SLA, security exhibit, and subprocessor list with counsel.
5. Stand up paging and status-page providers.
6. Run and record a restore drill against a production-like Supabase environment.
