# Exam submission finality

**Goal:** A student who confirms end exam cannot reopen that exam or submit again, while instructor release still allows re-entry.

**Architecture:** Keep the existing session release reason and Participation submitted status. End the session and mark participation submitted in one transaction; reject submitted state before any start mutation. Serialize student start, end, and exam submission admission using the existing per-user advisory lock. Expose the student's own session state to the detail page and replace its start controls with a submitted notice.

**Tech stack:** TypeScript, Prisma/PostgreSQL, SvelteKit, Vitest, Playwright. No schema changes or new dependencies.

## Milestones

- [x] Establish clean worktree and targeted session-test baseline.
- [x] Add failing regression checks in `tests/unit/domain/exam-session.test.ts` and `tests/integration/api/exam-session.test.ts`: submitted re-entry denied, repeated end idempotent, participation finalized, instructor release still re-enterable.
- [x] Fix `packages/application/src/exam/session.ts`, `packages/db/src/repositories/participation.ts`, and exam submission admission in `packages/application/src/submission/mutations.ts`.
- [x] Update exam detail loader/page, localized submitted notice, and the existing exam workspace Playwright scenario.
- [x] Run targeted unit and database checks, browser scenario, relevant type/lint checks; update `docs/specs/exams.md` with the verified contract.

## Validation

- `pnpm exec vitest run --project unit tests/unit/domain/exam-session.test.ts tests/unit/domain/exam-session-participation.test.ts tests/unit/domain/exam-session-mutations.test.ts tests/unit/domain/submission-mutations.test.ts tests/unit/domain/submission-mutations-boundaries.test.ts`
- Run exam session and submission confinement integration files against an isolated, explicitly marked local test database.
- Run `tests/e2e/exams.test.ts` exam workspace scenario against an isolated E2E database.
- `pnpm --filter @nojv/application typecheck`, `pnpm --filter @nojv/web check`, touched-file ESLint and Prettier.

## Constraints and risks

- Main checkout has unrelated ongoing edits; all changes stay in `.worktrees/exam-submission-finality` on `codex/exam-submission-finality`.
- Already accepted submissions may finish judging after hand-in; finality applies to admission of new submissions.
- Previously erased release reasons cannot be reconstructed by this fix; no historical data rewrite is included.
- Follow [exam specification](../../specs/exams.md) and [testing strategy](../../runbooks/testing.md). No deployment requested.

## Verification evidence

- Implementation and local verification complete on `codex/exam-submission-finality`; PR integration is CI-gated. Deployment is outside this change.
- Baseline: 24 session unit tests passed before changes.
- Regression evidence: submitted re-entry, final participation, and idempotent hand-in tests failed before the fix; instructor-release/stale-tab regression also failed before its correction.
- Final targeted unit run: 132 tests in 14 files passed.
- Final real-database run: 28 tests in 2 files passed against a separate PostgreSQL 18 container at loopback port 5548, with the required test database identity markers.
- Chromium: 1 exam workspace scenario passed, including confirmed hand-in, submitted notice, reload, denied direct restart, and denied direct problem access.
- Application typecheck, web svelte-check (0 errors / 0 warnings), test TypeScript checks, and touched production-file ESLint passed.
- Independent review identified instructor-release/stale-tab finality; fixed and re-reviewed with no remaining material findings.
