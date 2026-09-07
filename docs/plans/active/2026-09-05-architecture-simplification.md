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

## Independent review follow-up

Three independent agents reviewed judging, Web behavior, and domain/data/Temporal
contracts. Review reproductions found two judging gaps: Docker workspace paths
could collide with flat testcase payloads, and conflicting validator indices could
collapse to one Accepted result. Both Docker source writers now use opaque keys;
both backends validate the complete validator index set before constructing maps.

Web review found a join dialog that ignored general action errors and two
Superforms actions whose authorization failures omitted the required form object.
The affected views now display failures and preserve the form contract without
allowing unauthorized writes. Course announcement create/edit/pin/delete actions
also display failures, preserve input or confirmation state, and pass unexpected
errors and redirects back to SvelteKit.

The full browser run also exposed stale layout selectors and two MFA tests that
queried a hardcoded Redis container instead of `REDIS_URL`. Keyboard checks now
wait for the menu's observable opening/positioning state. The AC/editorial happy
path uses an independent GCD problem: warmup-sum belongs to an active assignment,
whose post restriction correctly remains in force even after AC. Shared post
access now reports this activity restriction explicitly instead of telling an
already accepted student to solve the problem again.

Inspecting the browser run's actual judge outcomes found an older multi-file C
fixture that omitted `main.c` from the complete source manifest and accepted any
terminal verdict, including compilation errors. The fixture now submits all three
files and requires Accepted when judge workers are enabled.

The first full integration run exposed missing mailer settings in the local test
environment and a deployment script selecting global Prisma 7.2 instead of the
workspace version. The scripts now prioritize their package binaries, and the
test harness includes an incompatible executable earlier in the inherited PATH.
The testing runbook records the required mailer settings.

Verification after the review fixes:

- `pnpm ci:verify` passed: 334 unit files / 2,817 tests, 24 component files /
  41 tests, build, typechecks, lint, formatting and repository guards.
- Complete integration suite passed: 80 files / 573 tests, including real Docker
  and seed judging, notification transactions, storage migration history, and
  live Temporal completed/failed/running/cancelled rejudge progress.
- Real local Kubernetes suite passed: 13 / 13 tests, with a separate live
  NetworkPolicy allow/deny probe. All owned cluster resources and the private
  kubeconfig were removed; the original `orbstack` context and kubeconfig hash
  were unchanged.
- Complete browser suite passed: 204 / 204 tests, with no retries or skipped tests,
  against the isolated `nojv_e2e_test` database, Redis and Temporal namespace.
  Real judge/platform workers processed submissions, including multi-file C AC,
  Advanced AC/WA, and the GCD AC required for editorial access. Coverage includes
  account-menu keyboard/focus behavior,
  Ctrl/Cmd save and submit, exam countdown/end-session, regular-admin MFA elevation,
  super-admin TOTP/passkey sign-in, and session isolation.

This plan remains active until the change is reviewed and merged.
