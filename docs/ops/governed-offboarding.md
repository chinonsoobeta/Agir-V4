# Governed user offboarding

Removing a workspace membership is the normal access-revocation path. It takes effect immediately and does not delete the account or its business records.

Deleting an authentication account is a separate retention operation. The database refuses that deletion while an older table would cascade-delete durable Property, Permit, document, or Underwriting records. Operations can call `user_deprovision_blockers(user_id)` with the service role to obtain table-level counts. The report contains counts only, not addresses, document contents, or financial values.

For each blocker, operations must choose and record one approved outcome:

1. Reassign the record to an authorized workspace owner.
2. Export it and retain it for the approved period.
3. Preserve the record with nullable attribution where the schema supports that state.
4. Delete it through the applicable reasoned retention workflow after approval.

Retry account deletion only when the blocker report is empty and all restrictive assignment, handoff, or audit references have been resolved. A blocked deletion is a safe outcome. Do not disable the trigger to make offboarding appear complete.

The retention period, customer notice, export scope, and audit-retention wording still require qualified legal and privacy approval before a production pilot can claim its offboarding gate has passed.
