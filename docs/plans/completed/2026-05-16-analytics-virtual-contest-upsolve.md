# Plan: Class Analytics + Virtual Contest + Upsolve (+ verified fixes)

Date: 2026-05-16
Branch: `feat/class-analytics-virtual-contest-upsolve`
Driver: autonomous overnight execution (subagent-driven, wave-based, commit per wave)

## Goal

Land three new features and a batch of audit fixes from the 2026-05-16
project review. Sequenced into waves; each wave is verified
(`typecheck` + `lint` + `test:unit`) and committed before the next.

## Wave order (priority)

1. **Schema foundation** — all Prisma changes in one migration set.
2. **Section 一 verified fixes** — `MINIMUM` strategy, Exam optimistic lock.
3. **班級分析儀表板** (class analytics) — lowest risk, read-mostly.
4. **Upsolve** — post-contest practice surface.
5. **虛擬競賽** (virtual contest) — biggest, v1 scope below.
6. **Section 二/三 fixes** — verify-first; skip false positives.

## Locked v1 designs

### Section 一 fixes

- `MINIMUM` subtask strategy: currently an exact duplicate of
  `ALL_OR_NOTHING` (`submission/scoring.ts:60-64`). Give it real
  semantics — subtask score = `min(per-case score) * weight / 100` —
  so it differs from `ALL_OR_NOTHING`. Update the comment block.
- Exam optimistic lock: add `ExamParticipation.version`, an
  `updateWithVersion` repo method, and a retry loop in
  `updateExamScores` mirroring `contest/scoring.ts`.

### Class Analytics Dashboard

- Route `/(app)/courses/[courseId]/analytics`, course-staff gated.
- Domain `course/analytics.ts` → `getCourseAnalytics(courseId)`.
- No schema change — aggregates existing `Submission` / assessment data.
- Metrics: per-assessment completion + avg score; hardest problems
  (lowest AC rate, top 5); at-risk students (no submissions / all-zero);
  course-wide verdict distribution.
- Nav link in course layout. i18n keys in en + zh-TW.

### Upsolve

- Route `/(app)/contests/[contestId]/upsolve`, visible only after
  `endsAt`. Read-only curated index.
- Domain `contest/upsolve.ts` → `getUpsolveView(contestId, userId)`:
  each contest problem + the user's solve status (solved / attempted /
  untouched). Links to the existing problem page for practice submits.
- No schema change, no gate changes in v1.

### Virtual Contest (v1)

- New model `VirtualContest` (one row = one user's replay of a past
  contest). `Submission.virtualContestId` FK tags virtual submissions.
- A user may start a virtual run only of an **ended** contest. Personal
  timer = original contest duration. Status derived from time (no
  Temporal workflow in v1).
- Scoring: `updateVirtualContestScores` mirrors contest scoring; the
  judge pipeline routes virtual submissions to it. Virtual scoreboard
  is private to the user; the original contest's final standings shown
  as static "ghost" reference rows.
- Routes: `/(app)/contests/[contestId]/virtual` to start + solve view.

## Verification per wave

`pnpm db:generate` (after schema) · `pnpm -w typecheck` · `pnpm lint`
· `pnpm test:unit` · `pnpm format:write`. Integration/e2e need a DB —
out of scope for unattended verification.

## Status log

All waves landed on the branch 2026-05-16. Final verification:
`typecheck` 10/10 · `lint` 8/8 · `test:unit` 79 files / 700 tests ·
`format` clean. Integration/e2e not run (no DB in the unattended env).

- [x] Wave 1 — schema (`VirtualContest`, `ExamParticipation.version`)
- [x] Wave 2 — section 一 fixes (MINIMUM scoring, Exam optimistic lock)
- [x] Wave 3 — class analytics
- [x] Wave 4 — upsolve
- [x] Wave 5 — virtual contest
- [x] Wave 6 — section 二/三 fixes (6a judge pipeline, 6b data layer,
      6c admin i18n + doc drift)

### Deferred (need a dedicated session — not safe to batch unattended)

- Mobile solve workspace — a real responsive editor is its own project.
- `adjustmentRules` editing UI — the rules engine exists; exposing it
  is a feature-let of its own.
- Plagiarism re-scan history archive — needs a new table + multi-point
  wiring; current trigger who/when is already recorded inline.
- Route-level integration tests (plagiarism/editorials 403 gates) —
  need a running DB; cannot be verified in the unattended env.

### Migrations

`20260516000000_add_virtual_contest_and_exam_version` and
`20260516010000_add_clarification_soft_delete` applied to the local
dev DB on 2026-05-16 via `prisma migrate deploy` (alongside 3 older
pending migrations). `prisma migrate status` → schema up to date.
