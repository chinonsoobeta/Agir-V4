# Standalone permit cases

Status: accepted for pilot engineering validation, 2026-07-10.

## Decision

`permit_cases` is the neutral ownership and workflow boundary. A case can be personal or workspace-owned and may reference one underwriting project. Existing `project_permits` rows are bridged with `case_id`; their IDs, requirements, document links, and history are preserved.

Documents use an optional `permit_case_id`. A document has one case parent, while existing join tables allow it to support multiple permits and paperwork items. A linked case document may also retain `project_id`. Detaching clears project pointers without copying or moving the Storage object.

Permit facts and case-only documents are excluded from deterministic underwriting input assembly. Catalogue and extraction results begin as review candidates, never confirmed requirements.

## Compatibility period

`project_permits.project_id` remains supported and nullable throughout the pilot. Existing `/projects/:id` links and the project Permits tab remain compatibility surfaces. Retirement of project-only permit rows requires measured zero legacy rows, a migration rehearsal, and a separately approved ADR.

## Supported local stack

- Node.js: 22–24 in production and CI.
- Supabase CLI: 2.109.0, pinned in CI.
- PostgreSQL: the version bundled by Supabase CLI 2.109.0; record `select version()` with deployment evidence.
- Supabase project: `bilvefwxklbgkplzenlr`, with analytics disabled locally for Colima compatibility.

Local credentials emitted by `supabase status` are development-only. Production URLs and credentials must never enter `.env.local`, fixtures, logs, or CI artifacts.

## Follow-up decision

Case/project attachment must use a single transactional RPC before general multi-user availability. Legal wording, municipal catalogue conclusions, usability studies, and independent penetration testing require qualified external reviewers.
