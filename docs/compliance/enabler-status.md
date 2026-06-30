# Enterprise control enablers: code-complete vs. external attestation

This is the honest boundary between what is **built and testable in this repo**
and what only becomes "real" when an external party (auditor, pen-test vendor,
IdP administrator, on-call rotation, or a customer with real data) operates and
evidences it. Engineering can make a control *collectable*; it cannot self-attest.

Legend: ✅ code-complete (in repo, tested) · 🟡 code seam shipped, needs config/wiring · 🔴 external-only (no code can satisfy it).

## SSO (SAML / OIDC)

| Piece | Status | Where |
| --- | --- | --- |
| Workspace SSO config (provider, metadata URL, enforced flag) | ✅ | `compliance.functions.ts`, settings UI |
| SSO enforcement semantics documented | ✅ | `docs/security/sso-scim.md` |
| Actual SAML/OIDC assertion handling | 🔴 | Delegated to the auth provider (Supabase Auth SSO). Requires the customer IdP + provider SSO support; no app code implements the SAML handshake. |
| Break-glass owner policy | 🟡→🔴 | Documented; enforced operationally (keep ≥2 owners). |

## SCIM 2.0 provisioning

| Piece | Status | Where |
| --- | --- | --- |
| Protocol core: parse user, role-from-groups, PATCH (deactivate), response envelopes | ✅ | `src/lib/scim/scim.ts` (+ `scim.test.ts`) |
| Request handler: bearer auth, routing, CRUD, error shapes | ✅ | `src/lib/scim/handler.ts` (+ `scim-handler.test.ts`, full lifecycle) |
| HTTP route `/api/scim/v2/Users[/:id]` | ✅ | `src/routes/api/scim/v2/*` (returns SCIM-shaped 401/501 verified) |
| Supabase store (maps SCIM → `profiles` + `workspace_members`) | 🟡 | `src/lib/scim/supabase-store.server.ts`. Owner role never assignable; deactivate = deprovision; create requires prior SSO login (JIT). Needs a live IdP run to fully exercise. |
| Per-workspace provisioning tokens | 🟡 | Currently single-tenant-per-token via `SCIM_BEARER_TOKEN` + `SCIM_WORKSPACE_ID`. Multi-tenant needs a hashed-token table migration. |
| IdP-side application + group→role mapping approval | 🔴 | Customer IdP admin + contract. |

## Disaster recovery

| Piece | Status | Where |
| --- | --- | --- |
| Restore-from-backup drill (migration ledger, drift, key-table smoke) | ✅ | `scripts/restore-staging-from-backup.mjs` (`npm run restore:drill`) |
| Structured drill evidence artifact (RTO/RPO, checks, result) | ✅ | writes `docs/ops/dr-drills/restore-drill-*.json` |
| Actual backups + PITR + a real restore into staging | 🔴 | Provider/operator: configure backups, perform the restore the drill then validates. |
| Quarterly drill cadence + sign-off | 🔴 | On-call rotation; attach artifacts to the DR ticket. |

## SLA / uptime

| Piece | Status | Where |
| --- | --- | --- |
| Health/readiness endpoint (env + schema-drift checks) | ✅ | `src/routes/api/health.ts` |
| Synthetic probe: availability + p50/p95 vs SLO, rolling evidence | ✅ | `scripts/sla-probe.mjs` (`npm run sla:probe`) |
| External, scheduled, off-deployment monitoring | 🔴 | A co-located probe can't observe its own outage; needs a third-party monitor. |
| Contractual SLA targets + credits | 🔴 | Commercial/legal. |

## SOC 2 / pen test

| Piece | Status | Where |
| --- | --- | --- |
| Control documentation + readiness gap assessment | ✅ | `docs/compliance/`, `docs/security/penetration-test-readiness.md` |
| Audit hash chain, RLS proofs, drift gate, idempotent jobs (evidence-producing controls) | ✅ | existing hardening (see audit log, `npm run test:rls`, CI) |
| SOC 2 Type II report | 🔴 | External auditor over an observation window. |
| Penetration-test report + remediation evidence | 🔴 | External pen-test vendor. |

## Anonymized customer corpus (extraction confidence)

| Piece | Status | Where |
| --- | --- | --- |
| PII anonymizer (structure-preserving, deterministic) | ✅ | `src/lib/corpus/anonymize.ts` (+ `corpus-harness.test.ts`) |
| Extraction-accuracy scorecard (precision/recall/F1, tolerance) | ✅ | `src/lib/corpus/score.ts` |
| Residual-PII gate (fail-closed before sharing) | ✅ | `residualPii()` |
| The actual real anonymized corpus | 🔴 | Requires real customer documents + a data-sharing agreement. The harness makes confidence improve the moment that data arrives. |

---

### What an operator/customer must still do
1. Stand up SSO/SCIM with the customer IdP; set `SCIM_BEARER_TOKEN` + `SCIM_WORKSPACE_ID`; run a live provisioning test.
2. Enable provider backups/PITR; schedule `restore:drill` against staging; retain the evidence artifacts.
3. Run `sla:probe` from an external monitor on a schedule; wire alerting.
4. Engage a SOC 2 auditor and a pen-test vendor; supply the in-repo evidence above.
5. Execute a data-sharing agreement to obtain documents; anonymize via the harness; track the extraction scorecard over time.
