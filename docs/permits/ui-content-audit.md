# Permits-first UI and content audit

Status date: 2026-07-11

## Summary

The standalone permit case path has a useful fail-closed foundation. It keeps municipality confirmation, zoning uncertainty, candidate status, applicability, workflow status, and documents separate. The surrounding product still presents underwriting as the default experience, so the first authenticated screen, landing page, authentication copy, navigation, and pilot controls require permits-first changes.

## Journey findings

| Surface                                      | What it currently suggests                              | Finding                        | Required change or verification                                                                                     |
| -------------------------------------------- | ------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Landing page                                 | Agir is a real estate investment workspace              | Blocking positioning mismatch  | Lead with permit research and workflow; retain Underwriting as Preview; name the six municipalities and limitations |
| Authentication and recovery                  | Sign-in opens an investment workspace                   | Blocking terminology mismatch  | Use property project workspace and default successful authentication to Permits                                     |
| First authenticated screen                   | Dashboard and underwriting navigation                   | Blocking default-mode mismatch | Open Permit cases for pilot users                                                                                   |
| Product switcher                             | Two modes, with Underwriting first and no release label | Partial                        | Put Permits first; label Underwriting Preview; explain unavailable access                                           |
| Mobile navigation                            | Both modes are operable                                 | Partial                        | Preserve mode label, status announcement, and 44 pixel targets after entitlement changes                            |
| Permit case list                             | Clear case search and explicit potential approvals      | Good foundation                | Add reviewed-coverage and stale/conflicting-source summaries                                                        |
| New case                                     | Clear guided flow and explicit unknown zoning           | Good foundation                | Add municipality coverage message and avoid treating autocomplete as confirmation                                   |
| Case overview                                | Distinguishes standalone and linked cases               | Good foundation                | Add assignment, handoff, pending review, and source freshness summaries                                             |
| Candidate review                             | Starts unknown and does not auto-confirm requirements   | Good foundation                | Show source review date, freshness, official-source state, reviewer, and confirmation states in one review panel    |
| Paperwork                                    | Supports checklist records                              | Partial                        | Add source provenance, assignment, due dates, and unresolved state filters                                          |
| Documents                                    | Supports signed staged upload and case-scoped listing   | Partial                        | Add cancellation, replacement history, retry, explicit opening errors, and mobile capture verification              |
| Sharing and handoff                          | Workspace team management exists outside the case       | Missing case workflow          | Add case collaborators, assignment, handoff notes, acceptance, rejection, and history                               |
| History                                      | Shows case and permit history                           | Partial                        | Render previous and new values, actor, reason, related record, and provenance consistently                          |
| Settings                                     | Workspace roles and data controls exist                 | Partial                        | Add pilot access status, Underwriting Preview entitlement, legal-copy status, and support route                     |
| Empty, loading, error, offline, unauthorized | Mixed coverage                                          | Partial                        | Add route-specific recovery actions and offline language that never implies successful retrieval                    |

## Accessibility and responsive audit

- Existing strengths: skip link, semantic tabs, labelled product radiogroup, live mode announcement, keyboard address listbox, focus-managed Radix dialogs, and minimum-height mobile actions.
- Automated coverage is not complete for every permit state. There is no recorded screen-reader walkthrough.
- Professional tables need a narrow-screen card representation wherever material columns would otherwise disappear.
- Error summaries need focus management on multi-step forms. Field-level errors must be associated with their controls.
- Source freshness, unavailable state, and confirmation status must use text and icons, not colour alone.
- Manual verification remains required at phone, tablet, laptop, wide desktop, and 200 percent zoom, with reduced motion enabled.

## Copy rules adopted

- Company category: Property research and workflow system.
- Signed-in environment: Property project workspace.
- Permit product: Permit research and workflow.
- Financial product: Underwriting, Preview.
- Unknown, not reviewed, potential, user provided, source supported, professionally confirmed, municipally confirmed, stale source, and conflicting evidence remain distinct terms.
- No new copy may use an em dash or imply completeness, guaranteed requirements, automatic zoning confirmation, or professional review that has not occurred.
