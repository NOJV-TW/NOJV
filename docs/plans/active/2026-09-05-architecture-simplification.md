# Architecture simplification and explicit failures

## Goal and constraints

Implement the accepted whole-repository review from `5a4943c9`: preserve the
Web/application/repository boundaries, Docker and Kubernetes backends, Temporal,
durable outbox, Redis, MFA, and sandbox isolation. Add no dependencies and make no
production data or deployment changes.

## Milestones

- [x] Preserve judge languages and use one validated sandbox output contract.
- [x] Reject incomplete or corrupt judging data and retain operator diagnostics.
- [x] Unify flat testcase payloads and read only the requested case.
- [x] Report real rejudge states, including queued dispatch and confirmed cancellation.
- [x] Remove swallowed Web errors and retain actionable validation and server logs.
- [x] Remove unused UI/storage code and simplify keyboard/menu behavior.
- [x] Update architecture, database, reliability, and quality documentation.
- [x] Pass targeted regressions, `pnpm ci:verify`, affected integration tests,
      Docker/Kubernetes contracts, and browser checks.

## Validation and evidence

Baseline review: 329 unit files / 2,720 tests passed. Regression coverage must include
missing/duplicate/out-of-range testcase results, C++ and Python judges, malformed
persisted configuration, JSON 400/413 with no write, dependency outages, rejudge
ownership/terminal states, menu focus, editor shortcuts, and MFA behavior.

Use only the explicitly marked local test databases described in
[Testing Strategy](../../runbooks/testing.md). Record executed checks and remaining
limitations here before completion. No integration/E2E result implies production
verification.

## Progress

- Isolated implementation in `.worktrees/architecture-simplification` on
  `codex/architecture-simplification`.
- Cross-review preserved explicit platform-failure diagnostics before completeness
  checks and kept Advanced sample results independent of public sample counts.
- Browser testing exposed a regular-admin unenhanced sign-in response missing its
  destination. The server now supplies `/dashboard` for both password-only and MFA
  responses; authorization and elevation rules are unchanged.
- Required source and team-output reads now preserve I/O failures. Explicitly naming
  a missing entry file cannot silently execute the default source instead.

## Executed validation

- Affected local DB/domain/upload/export integration: 9 files / 36 tests passed.
  The added automatic-recovery rejudge identity case subsequently passed with the
  complete 4-test rejudge-state file.
- Final sandbox image `8e60a6ef07bfb8502ebc432b00223a899649ca9c4cfaa1316837b35dca9b159e`:
  5 Docker/runner integration files / 85 tests passed, including real Python/C++
  judges, flat payload isolation, and explicit missing-entry failure.
- Seed Docker smoke: 70 tests passed, including Advanced run/grade execution.
- Real local Kubernetes: full suite 13 tests passed; the final source-read-only
  image change was rechecked with standard and interactive execution (2 passed).
  The temporary k3d cluster, namespaces, network, volume and kubeconfig were removed;
  the existing `orbstack` context was preserved.
- Browser checks: 20 tests passed across the main run and the corrected
  regular-admin MFA rerun: account-menu keys/focus, Ctrl/Cmd save and submit, exam
  countdown/end-session, regular-admin elevation/reuse/sign-in, and super-admin
  TOTP/passkeys.
- `pnpm ci:verify` passed: formatting, repository guards, builds, package and test
  typechecks, lint, 332 unit files / 2,802 tests, and 22 component files / 35 tests.
  No production environment was changed or verified.

Implementation and verification are complete on the isolated branch. This plan
remains active until the change is reviewed and merged.
