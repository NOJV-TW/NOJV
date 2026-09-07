# Assignment and exam problem weights

Approved implementation plan: preserve raw problem and submission scores; teachers set a total (default 100) and per-problem percentages. Persist allocated points on activity links. Published allocations must sum to the total. New problems start at zero; provide explicit equal distribution. Overrides remain raw. Allow grading changes after close without a reason or allocation audit history. Recompute exam participation scores through durable work with revision checks; assignments calculate on read. Preserve legacy totals and scores through migration.

## Checkpoints

- [x] Schema, lossless backfill, shared allocation validation and decimal scoring
- [x] Create/update/copy/publish contracts and durable convergence
- [x] All official score readers, raw submission display and zero-weight states
- [x] Percentage editor below the question list on both activities, dynamic problem selection, post-close edits
- [x] Unit, integration, migration rehearsal, browser verification and CI checks

## Acceptance

A=80/100 at 40%, B=50/100 at 60%, total=100 yields 62. Full marks yield the configured total. Mixed raw maxima, Advanced mode, overrides, late penalties, zero-weight and missing submissions work consistently. Activity weights are independent. Reordering and unrelated saves cannot round legacy allocations. Removed problems retain submissions and feedback. Concurrent grading changes and judging cannot persist an obsolete revision. Migration leaves every existing official grade unchanged.

## Boundaries

Contest scoring and problem versioning remain unchanged. Production deployment follows verification on a database copy; do not migrate the running development database used by other worktrees. See [assignments](../../specs/assignments.md), [exams](../../specs/exams.md), and [testing](../../runbooks/testing.md).

## Verification (2026-09-08)

- `pnpm ci:verify` passed: formatting, repository guards, builds, typechecks, lint, 2,817 unit tests and 41 component tests.
- Playwright passed all 3 new flows: closed assignment allocation/rescaling/validation on mobile; closed exam equal distribution with 33.34/33.33/33.33 preservation; empty exam draft save and exact-ID restoration. The default test port was occupied by another worktree, so this run used a temporary 5194 override with its own marked PostgreSQL database. The override was removed after verification.
- Database regressions cover closed edits, raw overrides, zero allocations, retained private draft identity across course staff, stale editor/writeback rejection, participant-entry serialization, decimal-boundary totals, course copy, and unchanged saves. The migration regression replays the actual SQL against isolated old-schema tables, including Advanced maximum 240 and Standard maximum 200.
- Local database-copy rehearsal compared 41 existing per-problem grades and 30 activity totals: zero changes. Neither assignment-after-close nor exam-after-end context records were present in that copy. The detailed rehearsal artifact remains local and is not committed.
- Independent review verified the Decimal aggregation, participant lock, historical picker authorization, decimal statistics, and empty/closed editor fixes; no remaining high-impact defects were found in those paths.
- Before the UI simplification, the full integration run passed: 82 files, 578 tests. Production migration, deployment, and production participation convergence have not run.

- Follow-up user requirements: both weight editors now sit below the question list; allocation reasons and audit history are removed. Detached question IDs preserve exact-ID restoration. Live inputs update Save immediately and total edits rescale from their focus-time allocation to avoid cumulative rounding. The final revision passed `pnpm ci:verify`, 12 focused database regressions, and all 3 browser flows (the assignment flow was rerun independently after a concurrent build interrupted it). Independent review found no correctness or security regressions.

## Mainline integration

Integrated current course-roster identities and late-submission policy. Course overrides use membership IDs; exam aggregates consistently exclude submissions at or after the deadline. Partial exam updates leave unrelated settings and allocations unchanged. Latest integration regression: five database tests passed, including a submission exactly at the exam deadline and lossless migration SQL replay. Final full repository and integration verification is in progress.
