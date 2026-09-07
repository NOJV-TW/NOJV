# Assignment and exam late submission policy

**Goal:** Give assignments and exams the same explicit on-time deadline, optional late window, final collection deadline, and fixed/daily percentage penalty. Any fraction of a late day counts as a full day.

**Architecture:** Keep `Assessment.closesAt` and `Exam.endsAt` as hard collection/lifecycle deadlines. `dueAt` is the on-time deadline; an absent or equal due date means no late window. The allow-late toggle is form state, not another persisted source of truth. Share existing adjustment scoring and UI; retain exam proctoring until `endsAt`. Percentage penalties are supported for point-sum exams only.

**Tech stack:** Existing SvelteKit, Zod, Prisma/PostgreSQL, Vitest and Playwright.

## Milestones

- [x] Core and persistence: remove `startFrom` and `final_day_zero`; use `ceil` for daily penalties; add exam `dueAt`/`adjustmentRules`; validate effective windows and score modes in mutations; preserve policy on course copy; route exam judge context through shared adjustments.
- [x] Forms and student surfaces: update assignment/exam create and settings pages with on-time deadline, allow-late toggle, conditional final deadline and penalty; remove obsolete settings; show both deadlines and penalty terms to students in English and Traditional Chinese.
- [x] Verification: cover exact deadline, 1 ms late, exactly 24 hours, 24 hours + 1 ms, final rejection, practice exclusion, exam persistence/scoring/session lifetime, invalid partial edits, and settings round trips. Run relevant unit/component/integration/E2E checks and workspace static checks.
- [x] Documentation and review: update assignment/exam specifications and database documentation; review final diff and record evidence.

## Contract and constraints

- Persist no new allow-late boolean. With the toggle off, forms send the hard deadline equal to the due date and no late penalty. With it on, final collection must be strictly later than due.
- UI `latePenalty` is null, `{ type: 'flat_late_penalty', penaltyPct }`, or `{ type: 'daily_late_penalty', perDayPct }`. The assignment settings action sends `latePenalty` so the domain preserves unrelated `time_bonus` rules and their ordering; whole-policy API updates still use `adjustmentRules`.
- No official submission at or after the hard deadline. Due equality is on-time while an open late window exists. Practice does not affect official grades.
- Existing production assignment rule JSON must be normalized in the schema migration when retired variants are removed; no runtime compatibility layer. Existing grades are not rewritten.
- Running assessments must not acquire an earlier deadline or a different penalty. Hard-deadline changes continue to reschedule exam auto-close.
- Worktree: `.worktrees/late-submission-policy`, branch `codex/late-submission-policy`, based on `d64b7b2b`; unrelated main-worktree edits are excluded.

## References

- [Assignments](../../specs/assignments.md), [Exams](../../specs/exams.md)
- [Database](../../architecture/DATABASE.md), [Testing](../../runbooks/testing.md)

## Validation evidence

- `pnpm ci:verify`: passed. Build, Svelte check (0 errors / 0 warnings), package and test typechecks, lint, formatting, 336 unit files / 2,839 tests, and 26 component files / 47 tests.
- Real PostgreSQL integration: the late-policy, problem-fork, effective-window-race and exam-session suites passed (4 files / 35 tests). After expanding late-policy coverage, its final run passed all 8 tests, including course copy, migration normalization, and preserving assignment time bonuses.
- The integration tests verify receipt-time scoring at due / +1 ms / +24 hours / +24 hours +1 ms, persistence and best scores, final cutoff, practice exclusion, session lifetime, invalid partial updates, and running-policy locks.
- Desktop/mobile creation forms were visually checked; the Impeccable detector reported no findings. The solve workspace follows the existing desktop-only product policy.
- Independent specification and code-quality reviews approved the final behavior after fixes for workspace timing and assignment time-bonus preservation.
- Test databases and Redis run on dedicated local containers (`127.0.0.1:55438` and `127.0.0.1:56388`); no production data was changed.
- `pnpm test:e2e tests/e2e/late-submission-policy.test.ts --reporter=line --retries=0`: all 3 tests passed. Both assessment types persist daily/flat penalties and normalize disabled late collection after reload; a student can enter an exam during late collection and its final-deadline countdown continues ticking.
- Integration/merge/deployment are outside this local implementation; retain this worktree for review.

## Schedule layout revision

The schedule now uses equal-width start/due fields, followed by a full-width allow-late row and aligned final-deadline/penalty controls. The percentage sits beside its penalty selector. Container queries stack the same reading order on narrow forms; existing policy locks and validation remain intact. All four assignment/exam create/settings surfaces share this composition.

Validation: Svelte check (0 errors / 0 warnings), web lint, 4 component tests and 5 form-action tests passed. Live Traditional Chinese desktop/mobile views showed no horizontal overflow; light/dark screenshots and the layout detector were checked. E2E screenshot capture now targets the schedule itself so fixed navigation cannot obscure the design in full-page captures.
