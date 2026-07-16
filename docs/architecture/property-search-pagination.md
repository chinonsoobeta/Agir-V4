# Property search pagination decision

Status: accepted
Date: 2026-07-15

## Decision

Property catalogue search uses read-only keyset pagination ordered by
`(updated_at DESC, id DESC)`. Every page calls `search_properties_page`, and
PostgreSQL RLS evaluates the caller's current access for that request.

The application does not create immutable search sessions, store property
snapshots, or claim an exact total count.

## Why

Search is primarily a read operation. Materializing every matching property
created write amplification, large JSON snapshots, cleanup pressure, cursor
eviction across tabs, fixed expiry failures, and delayed access revocation.

Keyset pagination keeps the hot path read-only and bounded. A page requests
`limit + 1` rows, returns `limit`, and derives `has more` from the extra row.
The cursor contains the last visible row's `updated_at` and `id`.

## Consistency contract

- Current authorization wins over snapshot consistency. Removing workspace
  access takes effect on the next page request.
- Rows unchanged during traversal are not duplicated or skipped.
- A row updated while a user is paging may move earlier in the ordering. The UI
  describes the result as a live catalogue and supports refresh.
- The UI reports how many properties are currently loaded. It does not present
  that number as an exact total.
- Search remains a GET because it performs no application writes.

## Performance and operations

- Page size is capped at 100 in the application and 200 in the database RPC.
- The load gate traverses a large fixture, checks every ID is returned once,
  verifies the retired session-item table does not grow, and enforces a latency
  budget.
- Search-session tables remain service-only during their retirement window.
  They may be dropped in a later cleanup migration after production confirms no
  legacy client depends on them.

## Reconsideration threshold

Immutable snapshots require a new ADR and evidence that live keyset movement is
materially harming users. Any future snapshot design must use POST creation,
store only ordered identifiers/sort keys, recheck current access on every page,
avoid silent eviction, expose expiry and truncation explicitly, and clean up
outside the search request path.
