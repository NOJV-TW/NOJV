# Admin sign-in corrections

## Goal

Fix the four reviewed admin authentication defects without changing the role model in [Security](../../operations/SECURITY.md).

## Implementation

- [x] Add failing hook regression tests; reject failed auth results before any privilege writes. Leave authenticated TOTP step-up authorization to its callers after replay and generation checks.
- [x] Recover pending regular-admin sign-in from Better Auth's signed cookie and live verification record; test missing, expired and forged challenges.
- [x] Return incomplete super-admin sessions with expired password proof to password entry, and provide a restart action for errors occurring while the page is open.
- [x] Run focused unit/integration tests, Svelte/type checks, formatting/lint and browser login journeys using the isolated allowlisted test databases.

## Validation

Use the existing tests in `tests/unit/web/passkey-auth-wiring.test.ts`, `tests/unit/web/admin-signin-action.test.ts`, `tests/e2e/super-admin-signin.test.ts`, plus focused real-auth integration coverage. Preserve unrelated workspace edits. No production deployment is included.

Focused checks passed: 71 unit tests, 20 real-auth/DB/Redis integration tests, Svelte diagnostics (0 errors/warnings), test typechecks and ESLint. All 3 Chromium browser journeys passed, including regular-admin reload, expired super-admin proof, restart, TOTP/passkey setup and recovery. Independent code review found no actionable issues. Implemented and verified locally. Publishing this isolated change through a CI-gated PR; no deployment is included.
