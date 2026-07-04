# Security Policy

## Supported Versions

NOJV is developed as a rolling release. Only the `main` branch is supported;
older commits and tagged demos are not patched.

## Reporting a Vulnerability

**Do not open a public issue for security problems.** Use one of these
channels instead:

1. **GitHub Private Vulnerability Reporting** (preferred):
   <https://github.com/TakalaWang/NOJV/security/advisories/new>
2. **Email**: `nojv.tw@gmail.com` with subject prefix `[NOJV security]`

Please include:

- A description of the issue and the impact you observed
- Steps to reproduce, or a proof-of-concept
- The commit SHA / branch / URL where you saw the behaviour
- A suggested fix, if you have one

## What to Expect

- **Acknowledgement** within 3 working days
- **Triage and severity classification** within 7 working days
- **Fix timeline** depends on severity; critical issues are patched as soon
  as feasible
- **Coordinated disclosure** — we publish a GitHub Security Advisory after
  the fix lands on `main`. Credit is given unless you prefer to stay
  anonymous

There is no paid bug-bounty programme.

## In Scope

Reports that touch the integrity of the judging or assessment system carry
the highest priority:

- Sandbox escape from `apps/sandbox-runner` (the container that executes
  user-submitted code)
- Authentication or authorisation bypass on contest, exam, course, or
  admin routes
- IDOR or privilege escalation between users, courses, or contests
- XSS, CSRF, SSRF, SQL injection, or path traversal in `apps/web`
- Secrets leaked in committed history, CI logs, or built artifacts
- Plagiarism-detection bypass that materially undermines academic-integrity
  guarantees
- Denial of judging fairness via race conditions or scoreboard manipulation

## Out of Scope

- Findings requiring physical access, host root, or social engineering of
  administrators
- Denial-of-service via legitimate-but-expensive workloads (flag the
  concern, but please don't run the attack)
- Vulnerabilities in third-party services we depend on (Grafana, Temporal,
  better-auth, etc.) — please report those upstream
- Self-XSS, missing security headers on local-dev or demo deployments
- Outdated dependencies without a known exploitable CVE — Dependabot
  already tracks these
- Findings that only apply to a fork or a non-`main` branch

If you are unsure whether something is in scope, report it anyway. We would
rather triage a false alarm than miss a real issue.

## Related References

- [Security Requirements](../docs/operations/SECURITY.md) — defensive
  posture (sandbox isolation, seccomp, capability drop)
- [Threat Model](../docs/operations/THREAT_MODEL.md) — attacker scenarios
- [Reliability Invariants](../docs/operations/RELIABILITY.md) — failure
  modes that are not security issues
