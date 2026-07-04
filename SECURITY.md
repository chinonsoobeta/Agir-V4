# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Agir, please report it privately
before disclosing it publicly.

**Contact**: security@agir.dev  
**Subject prefix**: `[AGIR-SEC]`  
**Encryption**: PGP key available at https://agir.dev/.well-known/pgp-key.txt

Do *not* report security vulnerabilities via public GitHub issues.

## Response SLA

| Step | Target |
|---|---|
| Acknowledgment | Within 72 hours of report |
| Triage & severity assessment | Within 5 business days |
| Fix (Critical / High) | 14 days from triage |
| Fix (Medium / Low) | Next release cycle |

## Scope

In-scope:
- The underwriting engine (`src/lib/engine/`)
- The deterministic extraction pipeline (`src/lib/extraction/`)
- API routes and authentication (`src/routes/`)
- Supabase Row-Level Security policies (`supabase/migrations/`)
- Report generation and memo output

Out of scope:
- Third-party dependencies: report issues to the upstream maintainer
- Theoretical vulnerabilities without a working proof of concept
- Attacks requiring physical access to a deployed server
- Social engineering of the Agir team

## Disclosure Policy

1. The reporter submits a private report.
2. The maintainer acknowledges, triages, and develops a fix.
3. A CVE is assigned (if applicable) and a security advisory is published on
   the Agir GitHub repository.
4. A patched release is published.
5. Fourteen days after the release, details may be disclosed publicly.

## Recognition

Reporters who responsibly disclose a verifiable vulnerability will be credited
in the release notes (unless they prefer to remain anonymous).

## Supported Versions

Only the latest release on the `main` branch receives security patches.
Older versions should be upgraded promptly.
