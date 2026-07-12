# Permit catalogue pilot review

## Release status

The software catalogue is ready for controlled internal review. It is **not a substitute for
municipal or legal advice**, and it must not be labelled professionally reviewed until the sign-off
table below is completed by qualified reviewers independent of the implementation team.

The active pilot target contains 84 municipal category rows (six municipalities × fourteen categories) plus an
external-authority directory. An `unknown` row means the reviewed official source set did not
support a category-specific conclusion. `Potentially applicable` describes the source catalogue,
not the project: generated project candidates still begin with unknown applicability and no
required/not-required assertion.

## Independent reviewer checklist

For each municipality, the reviewer must export `permit_rule_review_queue`, compare every active
rule with the linked official source, and record a `permit_rule_reviews` row.

- Confirm the issuing authority and authority scope.
- Confirm that the source URL is official and currently accessible.
- Confirm source title and excerpt accurately represent the page.
- Confirm category and permit/approval name.
- Confirm applicability language does not imply a project-specific conclusion.
- Confirm every required document is explicitly listed by the source.
- Confirm every duration is copied from the source and is not a generic estimate.
- Confirm external, regional, utility, health, provincial, federal, and Indigenous/treaty
  authorities are not represented as the municipality.
- Confirm unknown fields remain unknown.
- Record reviewer identity, date, notes, next review date, and source-content hash.

| Municipality      | Reviewer | Organization/qualification | Review date | Result         |
| ----------------- | -------- | -------------------------- | ----------- | -------------- |
| City of Vancouver | Pending  | Pending                    | Pending     | Not signed off |
| City of Burnaby   | Pending  | Pending                    | Pending     | Not signed off |
| City of Richmond  | Pending  | Pending                    | Pending     | Not signed off |
| City of Surrey    | Pending  | Pending                    | Pending     | Not signed off |
| City of Coquitlam | Pending  | Pending                    | Pending     | Not signed off |
| City of Kelowna   | Pending  | Pending                    | Pending     | Not signed off |

## Source monitoring

`npm run permits:sources:update` runs the scheduled service-role review. It normalizes visible page
content, stores SHA-256 hashes, records unavailable/changed sources, and moves affected rules to
`needs_review`. It never accepts changed content as verified automatically. The weekly scheduled
workflow fails loudly when credentials are missing or any source changes/becomes unavailable.

An initial local baseline on July 10, 2026 checked the earlier rule and source set. Some Vancouver, Kelowna,
provincial, and health-authority pages rejected or did not complete automated retrieval. Those are
review alerts, not evidence that the source or permit does not exist, and require manual review.

New Westminster rows remain historical evidence from the earlier catalogue version and are inactive for the approved pilot cohort. Coquitlam rows begin as pending review. No municipality is professionally reviewed until a qualified reviewer records the result above and in `permit_rule_reviews`.

## Zoning boundary

`authoritative_land_data_sources` is a disabled-by-default integration registry. Activating a source
requires approved licensing, address/parcel match testing, municipal-boundary handling, update
cadence, bylaw versioning, and an explicit product/security review. No current source performs an
automatic zoning determination or zoning-change analysis.

## Underwriting boundary

Permit tables and extraction candidates are absent from underwriting input assembly. Permit cost,
duration, dates, and status cannot become assumptions or financial outputs through this feature.
Any future integration requires a separately approved deterministic design and new golden tests.
