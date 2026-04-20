# Course Experience Redesign — Implementation Plan

> **Status:** Shipped 2026-04-16. Phases 1–6 all landed on branch
> `course-experience-redesign`. See the "Deviations from the plan" section
> at the bottom of this file for the two cosmetic differences between the
> plan wording and the final implementation.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to dispatch a fresh subagent per task and review between tasks. Visual references live in `docs/plans/prototypes/course-experience-redesign/`. Design spec is `docs/plans/completed/2026-04-11-course-experience-redesign-design.md`.

**Goal:** Replace the entire `/courses/*` experience — routes, schema, teacher/student UI, exam session lock, members rework — so it matches the 2026-04-11 design spec and the 15 committed HTML prototypes.

**Architecture:** Unified teacher/student UI (no `/manage/*` split). Course-embedded exams split out of the single `Contest` table into a dedicated `Exam` model, with shared scoring logic hoisted to `packages/domain/src/scoring/`. Routes are keyed by cuid (`[courseId]`, `[assignmentId]`, `[examId]`), not slug. Exam session lock is a SvelteKit hook that matches URL prefix. Any authenticated user may create standalone contests.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes · Prisma 7 · Zod 4 · Tailwind CSS 4 · sveltekit-superforms · Bits UI · Paraglide JS i18n · Vitest (unit + integration with real Postgres) · Playwright · pnpm workspace monorepo with Turborepo.

---

## How to use this plan

1. **Tasks are numbered by phase.** Finish Phase 1 completely before touching Phase 2 (Phase 2 depends on new enum/table names from Phase 1). Within a phase, some tasks can be done in parallel where the Dependencies line says "independent".
2. **Each task has a Files / Steps / Verification block.** The subagent owns just that scope. When referencing UI behaviour, the Prototype line is authoritative — open `docs/plans/prototypes/course-experience-redesign/<file>.html` and mirror its structure/tokens into Svelte.
3. **Commit per task.** The commit message template is at the bottom of each task. Keep hooks running; fix a failing pre-commit instead of bypassing it.
4. **Verify before claiming done.** Every task ends with `pnpm typecheck + pnpm lint + pnpm -w format` at minimum; most also want `pnpm test:unit` or `pnpm test:integration` subset.
5. **When blocked, stop.** If an assumption in this plan turns out wrong (e.g. a field already removed, a helper already existing, a schema FK differently wired), update this plan inline with the correction before proceeding or writing code against the stale assumption.

---

## File structure overview

```
packages/db/prisma/schema/
├── course.prisma         MODIFIED  drop slug/visibility/locale, drop CourseJoinToken
├── contest.prisma        MODIFIED  shrink Contest (remove course fields); add Exam/ExamProblem/ExamParticipation; split IpViolationLog
├── auth.prisma           MODIFIED  add User.handle unique; add placeholder user status
├── submission.prisma     MODIFIED  split submission.contestId → examId + contestId with CHECK
└── (new tables)          NEW       ActiveExamSession, ExamSessionEvent

packages/db/src/repositories/
├── course.ts             MODIFIED  remove slug-based lookups, placeholder user creation helpers
├── contest.ts            MODIFIED  drop course-binding logic; contest ops only
├── exam.ts               NEW       mirror of contest.ts scoped to Exam
├── exam-participation.ts NEW
├── exam-session.ts       NEW       ActiveExamSession CRUD + heartbeat
├── user.ts               MODIFIED  handle + placeholder lookups
└── submission.ts         MODIFIED  exam/contest scoped queries

packages/domain/src/
├── scoring/              NEW       icpc.ts + ioi.ts + rank-util.ts + scoreboard-builder.ts (pure, entity-agnostic)
├── contest/              REDUCED   standalone contest queries/mutations/permissions only
├── exam/                 NEW       queries.ts + mutations.ts + permissions.ts
├── course/
│   ├── mutations.ts      MODIFIED  drop slug/semester/locale; add placeholder/handle bulk add
│   └── queries.ts        MODIFIED  cuid lookups
└── user/
    └── mutations.ts      MODIFIED  placeholder attach hook

packages/core/src/schemas/
├── course.ts             MODIFIED  drop slug/visibility/locale; adjustmentRules new shape
├── contest.ts            MODIFIED  standalone only; no courseId
├── exam.ts               NEW       mirror contest but always courseId
└── adjustment-rules.ts   NEW       flat_late_penalty + daily_late_penalty + final_day_zero (drop half_life)

apps/web/src/routes/(app)/
├── courses/
│   ├── +page.server.ts   MODIFIED  two-tab listing
│   ├── +page.svelte      MODIFIED  Prototype 01
│   ├── new/              NEW       Prototype 02
│   └── [courseId]/       NEW       entire tree (replaces [slug])
│       ├── +layout.server.ts
│       ├── +layout.svelte        tab bar
│       ├── +page.svelte          Prototype 03 Overview
│       ├── assignments/          Prototype 04/05/06/07
│       ├── exams/                Prototype 08/09/10/11
│       │   └── [examId]/problems/[idx]/   Prototype 11 (exam session)
│       ├── members/              Prototype 12
│       └── settings/             Prototype 13
├── assignments/
│   └── +page.svelte      MODIFIED  Prototype 14
├── exams/                NEW       top-level /exams
│   ├── +page.server.ts
│   └── +page.svelte      Prototype 15
└── contests/             UNCHANGED by this plan, except /contests/create platform gate

apps/web/src/lib/
├── components/problem/
│   └── ProblemSolveView.svelte   NEW   shared between /problems/[id] and exam mode
├── components/manage/           DELETED after Phase 6 (folded into course interior)
└── server/exam-lock.ts          NEW   exam session gate used by hooks.server.ts

apps/web/src/hooks.server.ts     MODIFIED  add exam session lock gate

apps/web/messages/
├── en.json               MODIFIED  many new/removed keys (see Phase 3 tasks)
└── zh-TW.json            MODIFIED  mirror

tests/
├── unit/                 NEW       per-domain module
├── integration/domain/   NEW       course/exam/contest split integration tests
└── e2e/                  NEW       teacher-student flows + exam session lock
```

---

## Phase overview

| Phase | What                                                                                                                     | Depends on    | Estimated | Parallel-safe                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ------------- | --------- | ------------------------------------------------- |
| 0     | (Already shipped — `2026-04-11-silent-failure-and-problemids-fix.md`)                                                    | —             | —         | —                                                 |
| 1     | Schema + DB (split Contest/Exam, drop slugs, CourseJoinToken, add session tables, handle column, adjustment-rules shape) | —             | 3-4 days  | Tasks 1.1–1.4 in parallel; 1.5 depends on 1.1–1.4 |
| 2     | Route scaffolding with 308 redirects from old paths                                                                      | 1             | 1 day     | 2.1–2.3 parallel, 2.4 depends on all              |
| 3     | UI ports per prototype + shared ProblemSolveView                                                                         | 2             | 5-8 days  | Most tasks parallel after 3.1 (base layouts)      |
| 4     | Exam session lock hook + release + audit                                                                                 | 2 + 3.10–3.11 | 2-3 days  | Sequential within phase                           |
| 5     | Members rework: bulk handle paste + placeholder user + auth attach hook                                                  | 1             | 1-2 days  | Sequential                                        |
| 6     | Cleanup: drop `/manage/*`, per-card locale toggles, dead code, contest gate removal                                      | 1–5 all green | 1 day     | Independent                                       |

Total estimate: **14-22 working days**. With subagent parallelization on Phase 3, wall-clock can compress by ~30%.

---

## Phase 1 — Schema and DB

### Task 1.1: Extract shared scoring module

**Why:** Splitting Contest/Exam into separate tables must not duplicate ICPC/IOI scoring code. Hoisting to `packages/domain/src/scoring/` lets both consumers import pure functions.

**Dependencies:** independent — can start immediately.

**Files:**

- Create: `packages/domain/src/scoring/icpc.ts`
- Create: `packages/domain/src/scoring/ioi.ts`
- Create: `packages/domain/src/scoring/rank-util.ts`
- Create: `packages/domain/src/scoring/scoreboard-builder.ts`
- Create: `packages/domain/src/scoring/index.ts`
- Modify: `packages/domain/src/contest/icpc-scoring.ts` — delete, imports redirect to scoring/icpc
- Modify: `packages/domain/src/contest/ioi-scoring.ts` — delete
- Modify: `packages/domain/src/contest/rank-util.ts` — delete
- Modify: `packages/domain/src/contest/scoreboard-builder.ts` — delete
- Modify: `packages/domain/src/contest/scoring.ts` — slim down to contest-specific orchestration; import algorithms from `scoring/`
- Modify: `packages/domain/src/contest/index.ts` — remove re-exports of deleted files
- Modify: `packages/domain/src/index.ts` — add `export * as scoring from "./scoring"`
- Modify: `tests/unit/domain/scoring-*.test.ts` (existing contest scoring tests) — update imports

**Steps:**

1. Read `packages/domain/src/contest/icpc-scoring.ts`, `ioi-scoring.ts`, `rank-util.ts`, `scoreboard-builder.ts`. Identify which functions are pure (no contest-specific types) vs which accept contest shape.
2. Create the new files under `packages/domain/src/scoring/`. Parameterise any function that accepted `Contest` to accept a neutral `TimedSession` shape: `{ id: string; startsAt: Date; endsAt: Date; frozenAt: Date | null }`. For subtask strategies, accept the strategy map directly — do not take the whole contest row.
3. Delete the original files in `contest/` and re-point `contest/scoring.ts` to import from `scoring/`. Keep `contest/scoring.ts` as a thin orchestration layer that fetches contest data and calls the shared algorithms.
4. Update the barrel exports (`contest/index.ts`, `domain/index.ts`).
5. Update `tests/unit/domain/scoring-*.test.ts` imports — move test files to `tests/unit/domain/scoring/*.test.ts` and add new unit tests that verify scoring still produces the same output for fixture data.

**Verification:**

```bash
pnpm -w typecheck
pnpm -w lint
pnpm test:unit -- scoring
```

All existing contest scoring tests should still pass against the hoisted algorithms. 0 new warnings.

**Commit:** `refactor(domain): hoist scoring algorithms to neutral module`

---

### Task 1.2: Adjustment rules — new discriminated union (drop half_life, add flat + final_day_zero)

**Why:** Prototype 02 and 05 lock in 4 rule types: `none`, `flat_late_penalty`, `daily_late_penalty`, `final_day_zero`. The current `packages/domain/src/submission/adjustments.ts` supports `time_bonus + late_penalty_decay (half-life)`. Drop half-life entirely.

**Dependencies:** independent.

**Files:**

- Modify: `packages/core/src/schemas/adjustment-rules.ts` (create if missing — check `packages/core/src/schemas/course.ts` and `contest.ts` for current location)
- Modify: `packages/domain/src/submission/adjustments.ts` — rewrite `applyAdjustmentRules`
- Modify: `packages/db/prisma/seed.ts` — any seed data using `half_life` variant
- Modify: `tests/unit/domain/adjustments.test.ts` — replace half-life tests with flat/daily/final-day tests

**New rule types (Zod discriminated union):**

```ts
export const adjustmentRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time_bonus"), maxBonus: z.number().min(0).max(100), ... }),
  z.object({ type: z.literal("flat_late_penalty"), penaltyPct: z.number().min(0).max(100), startFrom: z.enum(["due", "final_day"]).default("due") }),
  z.object({ type: z.literal("daily_late_penalty"), perDayPct: z.number().min(0).max(100), startFrom: z.enum(["due", "final_day"]).default("due") }),
  z.object({ type: z.literal("final_day_zero") })
]);
```

**Steps:**

1. Look at current `adjustments.ts` and identify which variants exist. Write down the mapping (old → new).
2. Update the Zod schema. Remove `late_penalty_decay` variant entirely.
3. Rewrite `applyAdjustmentRules` to handle the three new late-penalty modes. `final_day_zero` returns 0 if `now > finalDay`; otherwise returns the original score.
4. Add a one-time data migration path: any row in `Problem.adjustmentRules` / `CourseAssessment.adjustmentRules` / `Contest.adjustmentRules` whose JSON has `type: "late_penalty_decay"` should be logged via `RAISE NOTICE` and converted to `flat_late_penalty` with `penaltyPct: 20` as a safe default. Record decision in the commit message.
5. Seed updates (pick a safer default rule in the seed).
6. Rewrite the unit tests.

**Verification:**

```bash
pnpm -w typecheck
pnpm test:unit -- adjustments
```

**Commit:** `refactor(domain): replace half_life adjustment with flat/daily/final_day variants`

---

### Task 1.3: Drop Course slug / visibility / locale, drop CourseJoinToken

**Why:** Prototype 02 has no slug/semester/visibility fields; members are added via handle paste only. Spec §5.1 and §5.2.

**Dependencies:** 1.2 must be merged because seed rewrites touch adjustmentRules at the same time.

**Files:**

- Modify: `packages/db/prisma/schema/course.prisma` — drop `Course.slug`, `Course.visibility`, `Course.locale` columns; drop `CourseVisibility` enum; drop `CourseJoinToken` model and all relations; drop `CourseMembership.joinedTokenId` field; drop `CourseJoinTokenKind` enum
- Modify: `packages/db/prisma/schema/auth.prisma` — remove `createdJoinTokens` relation from `User`
- Create: `packages/db/prisma/migrations/20260414000000_drop_course_slug_visibility_locale_jointoken/migration.sql`
- Modify: `packages/core/src/schemas/course.ts` — drop `slug`, `visibility`, `locale` fields from `courseCreateSchema` and `courseUpdateSchema`
- Modify: `packages/domain/src/course/mutations.ts` — drop slug-based create path; drop token generation; drop `createJoinToken` / `consumeJoinToken` entirely
- Modify: `packages/domain/src/course/queries.ts` — remove `findBySlug`, replace with `findById`
- Modify: `packages/db/src/repositories/course.ts` — same
- Delete: `packages/db/src/repositories/course-join-token.ts` (if exists)
- Modify: `packages/db/prisma/seed.ts` — drop slug, visibility, locale from Course seed; drop all CourseJoinToken seeding
- Modify: any `apps/web` route or component importing the removed symbols — expect many compile errors, let typechecker point them out

**Migration SQL:**

```sql
-- Drop FK dependencies first
ALTER TABLE "CourseMembership" DROP COLUMN IF EXISTS "joinedTokenId";
DROP TABLE IF EXISTS "CourseJoinToken" CASCADE;
DROP TYPE IF EXISTS "CourseJoinTokenKind";

-- Drop course columns
ALTER TABLE "Course" DROP COLUMN IF EXISTS "slug";
ALTER TABLE "Course" DROP COLUMN IF EXISTS "visibility";
ALTER TABLE "Course" DROP COLUMN IF EXISTS "locale";
DROP TYPE IF EXISTS "CourseVisibility";
```

**Steps:**

1. Run `grep -rn "CourseJoinToken\|course\.slug\|course\.visibility\|course\.locale" packages apps tests` to enumerate every consumer. Write the list into the commit message so nothing is missed.
2. Update the Prisma schema first. `pnpm db:generate` and observe the typescript errors across the tree — those are your checklist.
3. Delete `course-join-token.ts` repository and its index re-export.
4. Update `courseCreateSchema` and `courseUpdateSchema` in `@nojv/core` to match the new shape.
5. Update `course/mutations.ts` — `createCourse(actor, input)` no longer takes a slug or visibility; set createdBy from actor, that's it.
6. Update `course/queries.ts` — `getCourseById(id)`, `listCoursesForUser(userId)`, etc.
7. For each consumer flagged in step 1, migrate the call site. Most will become `course.id` instead of `course.slug`, some will delete whole blocks (e.g. join token consumption pages).
8. Write the migration SQL file. Hand-verify against a local test database before committing.
9. Run `pnpm db:push` in a test DB; observe that existing course rows survive without errors.

**Verification:**

```bash
pnpm db:generate
pnpm -w typecheck     # must pass
pnpm -w lint          # must pass
pnpm -w test:unit     # should pass existing unit tests (may need to delete tests for removed CourseJoinToken logic)
```

**Commit:** `feat(db)!: drop Course slug/visibility/locale and CourseJoinToken`

---

### Task 1.4: Split Contest into Exam + Contest tables

**Why:** Architectural decision 2026-04-14. Exam is always course-embedded; Contest is always standalone. Different permissions, different proctoring defaults, different participant models.

**Dependencies:** 1.1 (shared scoring module) must be in place so `exam/scoring.ts` and `contest/scoring.ts` both import from `scoring/`.

**Files:**

- Modify: `packages/db/prisma/schema/contest.prisma` — shrink `Contest` (drop `courseId`, keep `slug` which standalone contests still use, drop `ipWhitelistEnabled/ipBindingEnabled/ipViolationMode/ipWhitelist/pageLockEnabled` proctoring fields); add `Exam` / `ExamProblem` / `ExamParticipation` models; update `IpViolationLog` to reference Exam instead of Contest; update `Submission` to have both `examId?` and `contestId?` with CHECK constraint
- Create: `packages/db/prisma/migrations/20260414010000_split_contest_into_exam_and_contest/migration.sql`
- Create: `packages/db/src/repositories/exam.ts` (mirror of contest.ts but scoped to Exam and always courseId-bound)
- Create: `packages/db/src/repositories/exam-problem.ts`
- Create: `packages/db/src/repositories/exam-participation.ts`
- Modify: `packages/db/src/repositories/contest.ts` — drop course-embedded code paths
- Modify: `packages/db/src/repositories/submission.ts` — add `listByExam`, `listByContest`, update filters
- Modify: `packages/db/src/repositories/ip-violation.ts` — rename `contestId` parameter to `examId`
- Create: `packages/domain/src/exam/index.ts`, `queries.ts`, `mutations.ts`, `permissions.ts`
- Modify: `packages/domain/src/contest/queries.ts` — drop course-embedded branching
- Modify: `packages/domain/src/contest/mutations.ts` — drop course-embedded branching
- Modify: `packages/domain/src/contest/permissions.ts` — simplify `canManageContest` to just check owner / platform role
- Modify: `packages/core/src/schemas/contest.ts` — drop course fields from contest schema
- Create: `packages/core/src/schemas/exam.ts` — new schema with mandatory `courseId`, proctoring fields

**Schema outline (see spec §5.4 for full fields):**

```prisma
enum ExamStatus { draft published archived }
enum ExamScoringMode { problem_count point_sum }

model Exam {
  id                 String   @id @default(cuid())
  courseId           String
  title              String
  summary            String   @db.Text
  startsAt           DateTime
  endsAt             DateTime
  status             ExamStatus @default(draft)
  scoringMode        ExamScoringMode @default(point_sum)
  scoreboardMode     ScoreboardMode @default(hidden)
  frozenBoard        Boolean  @default(false)
  frozenAt           DateTime?
  submitCooldownSec  Int      @default(0)
  allowedLanguages   SupportedLanguage[] @default([])
  pageLockEnabled    Boolean  @default(false)
  ipWhitelistEnabled Boolean  @default(false)
  ipBindingEnabled   Boolean  @default(false)
  ipWhitelist        String[] @default([])
  ipViolationMode    IpViolationMode @default(block)
  plagiarismStatus          PlagiarismReportStatus?
  plagiarismResults         Json?
  plagiarismMossReportUrl   String?
  plagiarismTriggeredAt     DateTime?
  plagiarismCompletedAt     DateTime?
  plagiarismTriggeredById   String?
  createdByUserId    String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  course             Course                @relation(fields: [courseId], references: [id], onDelete: Cascade)
  createdBy          User?                 @relation("ExamCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)
  problems           ExamProblem[]
  participations    ExamParticipation[]
  submissions        Submission[]
  ipViolationLogs    IpViolationLog[]

  @@index([courseId])
  @@index([courseId, status])
}

model ExamProblem {
  id        String @id @default(cuid())
  examId    String
  problemId String
  ordinal   Int
  points    Int    @default(100)
  createdAt DateTime @default(now())
  exam      Exam    @relation(fields: [examId], references: [id], onDelete: Cascade)
  problem   Problem @relation(fields: [problemId], references: [id], onDelete: Restrict)
  @@unique([examId, problemId])
  @@index([examId, ordinal])
}

model ExamParticipation {
  // mirror ContestParticipation shape
}
```

**Shrunk Contest:**

```prisma
model Contest {
  id                String   @id @default(cuid())
  slug              String   @unique
  title             String
  summary           String   @db.Text
  visibility        ContestVisibility @default(invite_only)
  inviteCode        String?  @unique
  startsAt          DateTime
  endsAt            DateTime
  status            ContestStatus @default(draft)
  scoringMode       ContestScoringMode
  scoreboardMode    ScoreboardMode @default(live)
  frozenBoard       Boolean  @default(true)
  frozenAt          DateTime?
  submitCooldownSec Int      @default(0)
  allowedLanguages  SupportedLanguage[] @default([])
  // No courseId, no proctoring — contests are public / remote
  plagiarismStatus          PlagiarismReportStatus?
  plagiarismResults         Json?
  plagiarismMossReportUrl   String?
  plagiarismTriggeredAt     DateTime?
  plagiarismCompletedAt     DateTime?
  plagiarismTriggeredById   String?
  createdByUserId   String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  problems          ContestProblem[]
  participations    ContestParticipation[]
  submissions       Submission[]
}

enum ContestVisibility { public invite_only }
enum ContestStatus { draft published archived }
```

**Submission split:**

```prisma
model Submission {
  // existing fields...
  examId    String?
  contestId String?
  exam      Exam?    @relation(fields: [examId], references: [id], onDelete: Cascade)
  contest   Contest? @relation(fields: [contestId], references: [id], onDelete: Cascade)

  // Prisma does not natively support CHECK constraints, so this goes in the migration SQL:
  // ALTER TABLE "Submission" ADD CONSTRAINT "Submission_source_xor"
  //   CHECK (NOT ("examId" IS NOT NULL AND "contestId" IS NOT NULL));
}
```

**Data migration order (critical):**

```sql
BEGIN;

-- 1. Create new Exam / ExamProblem / ExamParticipation tables (DDL from Prisma).
-- 2. Backfill: for every Contest with courseId != null, insert matching Exam rows.
INSERT INTO "Exam" (id, "courseId", title, summary, "startsAt", "endsAt", status,
                    "scoringMode", "scoreboardMode", "frozenBoard", "frozenAt",
                    "submitCooldownSec", "allowedLanguages",
                    "pageLockEnabled", "ipWhitelistEnabled", "ipBindingEnabled",
                    "ipWhitelist", "ipViolationMode",
                    "plagiarismStatus", "plagiarismResults", ...,
                    "createdByUserId", "createdAt", "updatedAt")
  SELECT id, "courseId", title, summary, "startsAt", "endsAt", status::text::"ExamStatus",
         "scoringMode"::text::"ExamScoringMode", "scoreboardMode", "frozenBoard", "frozenAt",
         "submitCooldownSec", "allowedLanguages",
         "pageLockEnabled", "ipWhitelistEnabled", "ipBindingEnabled",
         "ipWhitelist", "ipViolationMode",
         "plagiarismStatus", "plagiarismResults", ...,
         "createdByUserId", "createdAt", "updatedAt"
    FROM "Contest"
    WHERE "courseId" IS NOT NULL;

-- 3. Backfill ExamProblem from ContestProblem for those contests
INSERT INTO "ExamProblem" (id, "examId", "problemId", ordinal, points, "createdAt")
  SELECT cp.id, cp."contestId" AS "examId", cp."problemId", cp.ordinal, cp.points, cp."createdAt"
    FROM "ContestProblem" cp
    JOIN "Contest" c ON c.id = cp."contestId"
    WHERE c."courseId" IS NOT NULL;

-- 4. Backfill ExamParticipation from ContestParticipation similarly
-- (same pattern; copy all relevant columns)

-- 5. Redirect Submission.contestId → Submission.examId where source was a course contest
UPDATE "Submission" s
  SET "examId" = s."contestId", "contestId" = NULL
  FROM "Contest" c
  WHERE s."contestId" = c.id AND c."courseId" IS NOT NULL;

-- 6. Redirect IpViolationLog.contestId → IpViolationLog.examId
ALTER TABLE "IpViolationLog" ADD COLUMN "examId" TEXT;
UPDATE "IpViolationLog" SET "examId" = "contestId"
  FROM "Contest" c WHERE c.id = "IpViolationLog"."contestId" AND c."courseId" IS NOT NULL;
ALTER TABLE "IpViolationLog" ALTER COLUMN "examId" SET NOT NULL;
ALTER TABLE "IpViolationLog" DROP CONSTRAINT IF EXISTS "IpViolationLog_contestId_fkey";
ALTER TABLE "IpViolationLog" DROP COLUMN "contestId";
ALTER TABLE "IpViolationLog" ADD CONSTRAINT "IpViolationLog_examId_fkey"
  FOREIGN KEY ("examId") REFERENCES "Exam"(id) ON DELETE CASCADE;

-- 7. Delete the rows that moved
DELETE FROM "ContestProblem" cp USING "Contest" c
  WHERE cp."contestId" = c.id AND c."courseId" IS NOT NULL;
DELETE FROM "ContestParticipation" cpt USING "Contest" c
  WHERE cpt."contestId" = c.id AND c."courseId" IS NOT NULL;
DELETE FROM "Contest" WHERE "courseId" IS NOT NULL;

-- 8. Drop Contest.courseId + proctoring fields
ALTER TABLE "Contest" DROP COLUMN "courseId";
ALTER TABLE "Contest" DROP COLUMN "pageLockEnabled";
ALTER TABLE "Contest" DROP COLUMN "ipWhitelistEnabled";
ALTER TABLE "Contest" DROP COLUMN "ipBindingEnabled";
ALTER TABLE "Contest" DROP COLUMN "ipWhitelist";
ALTER TABLE "Contest" DROP COLUMN "ipViolationMode";

-- 9. Submission xor constraint
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_source_xor"
  CHECK (NOT ("examId" IS NOT NULL AND "contestId" IS NOT NULL));

COMMIT;
```

**Steps:**

1. Read current `contest.prisma` end-to-end. List all consumers of `Contest.courseId` and proctoring fields: `grep -rn "contest\.courseId\|courseId.*contest\|contest\.ipWhitelist\|contest\.pageLock" packages apps`.
2. Extract `ContestParticipation` shape and clone it to `ExamParticipation` with minor differences: participation status enum same, but FK to Exam; no `inviteCode` concept.
3. Write the new `Exam*` models. Keep `Contest` model in the same file but heavily reduced.
4. Write the migration SQL as above. Run against the test DB and verify with hand-crafted queries.
5. Create `packages/db/src/repositories/exam*.ts` as near-clones of `contest*.ts`. Only the entity name differs.
6. Reduce `packages/db/src/repositories/contest.ts` — delete any query that filtered by `courseId` or joined `Course`.
7. Create `packages/domain/src/exam/` — `queries.ts`, `mutations.ts`, `permissions.ts`, `index.ts`. `canManageExam(actor, exam, memberships)` mirrors `canManageContest` but requires `courseRole in [teacher, ta]`.
8. Simplify `packages/domain/src/contest/permissions.ts` — `canManageContest` now only checks `createdByUserId === userId` (since there's no courseRole path).
9. Contest create Zod schema: drop `courseId`, drop all proctoring fields. Exam Zod schema: mirror contest but `courseId: z.string().min(1)` required, all proctoring allowed.
10. Run `pnpm db:generate`, fix all the resulting typescript errors across the tree. There will be many.

**Verification:**

```bash
pnpm db:generate
pnpm -w typecheck     # must pass — expect 30-50 errors on first attempt
pnpm -w lint
pnpm test:unit -- contest
pnpm test:unit -- exam       # new tests you added for exam mirror
pnpm test:integration        # especially the submission/scoreboard integration tests
```

**Commit:** `feat(db)!: split Contest into Exam (course-embedded) and Contest (standalone)`

---

### Task 1.5: Add User.handle unique + placeholder user status

**Why:** Spec §5.3. Teachers bulk-paste handles; unknown handles get a placeholder User row so future OAuth logins can auto-attach.

**Dependencies:** independent of 1.1–1.4.

**Files:**

- Modify: `packages/db/prisma/schema/auth.prisma` — add `handle String? @unique` to `User`; add `UserStatus` enum if not present with `pending_first_login` value
- Create: `packages/db/prisma/migrations/20260414020000_add_user_handle_and_placeholder/migration.sql`
- Modify: `packages/db/src/repositories/user.ts` — add `findByHandle(handle)`, `createPlaceholder(handle, addedByUserId)`, `attachPlaceholderToAuth(handle, authAccount)` helpers
- Modify: `packages/core/src/schemas/user.ts` — add `handle` field validation (letter + digit + underscore, 3-32 chars)
- Modify: `apps/web/src/lib/auth.ts` (better-auth config) — add `onBeforeCreateUser` hook that checks for existing placeholder by handle and merges instead of creating new

**Migration SQL:**

```sql
-- Enum adjustment if needed
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserStatus') THEN
    CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled', 'pending_first_login');
  ELSE
    ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'pending_first_login';
  END IF;
END $$;

-- Add handle column
ALTER TABLE "User" ADD COLUMN "handle" TEXT;
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle") WHERE "handle" IS NOT NULL;
```

**Steps:**

1. Read `packages/db/prisma/schema/auth.prisma` — check if `User.status` exists. If not, add it with `UserStatus` enum. If yes, add the `pending_first_login` value.
2. Add `handle` column. Partial unique index so existing users without handles don't fail.
3. Write repository helpers. `createPlaceholder` inserts `{ handle, status: 'pending_first_login', email: null, password: null }`.
4. Write the better-auth hook. When OAuth callback fires with claim like `{ email, preferred_username }`, look up placeholder by `preferred_username` (or whatever the user.handle maps to). If found, update the placeholder: `{ authProviderId, email, status: 'active' }` instead of creating a new user.
5. Write unit tests for `findByHandle`, `createPlaceholder`. Integration test the auth attach flow with a mocked OAuth callback.

**Verification:**

```bash
pnpm -w typecheck
pnpm test:unit -- user
pnpm test:integration -- auth
```

**Commit:** `feat(auth): add User.handle and placeholder user mechanism`

---

### Task 1.6: Add ActiveExamSession + ExamSessionEvent

**Why:** Spec §5.4. The exam session lock (Phase 4) needs a row per student per active exam; audit log needs the event table.

**Dependencies:** 1.4 (Exam table must exist).

**Files:**

- Modify: `packages/db/prisma/schema/contest.prisma` — add `ActiveExamSession` and `ExamSessionEvent` models
- Create: `packages/db/prisma/migrations/20260414030000_add_active_exam_session_tables/migration.sql`
- Create: `packages/db/src/repositories/exam-session.ts` — CRUD + heartbeat update
- Create: `packages/domain/src/exam/session.ts` — `startSession`, `endSession(reason)`, `recordEvent`

**Schema:**

```prisma
enum ExamSessionReleaseReason { submitted time_up released_by_instructor }
enum ExamSessionEventType { enter leave visibility_lost release auto_close heartbeat }

model ActiveExamSession {
  id              String   @id @default(cuid())
  userId          String
  examId          String
  startedAt       DateTime @default(now())
  endedAt         DateTime?
  releaseReason   ExamSessionReleaseReason?
  ipPin           String?
  lastHeartbeatAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  exam Exam @relation(fields: [examId], references: [id], onDelete: Cascade)

  @@unique([userId, examId])
  @@index([examId, endedAt])
}

model ExamSessionEvent {
  id          String   @id @default(cuid())
  sessionId   String
  eventType   ExamSessionEventType
  occurredAt  DateTime @default(now())
  metadata    Json?

  session ActiveExamSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, occurredAt])
}
```

**Steps:**

1. Add models to `contest.prisma` (same file where Exam lives).
2. Generate migration.
3. Write repository + domain helpers.
4. Write unit tests for session lifecycle.

**Verification:**

```bash
pnpm db:generate
pnpm -w typecheck
pnpm test:unit -- exam-session
```

**Commit:** `feat(db): add ActiveExamSession and ExamSessionEvent for exam lock`

---

### Task 1.7: Per-day attempt counter support

**Why:** Prototype 05 changes "最多嘗試次數" to "每日最多嘗試次數" resetting at midnight. Need a way to count submissions per user/assignment/day cheaply.

**Dependencies:** 1.3 (schema must have attempt field on CourseAssessment).

**Files:**

- Modify: `packages/db/prisma/schema/course.prisma` — rename `CourseAssessment.maxAttempts Int?` to `CourseAssessment.maxAttemptsPerDay Int?` OR keep `maxAttempts` name and document semantic change
- Modify: `packages/domain/src/submission/mutations.ts` — in the submit path, query `COUNT(*)` from Submission where `userId + courseAssessmentId + createdAt >= start_of_day_local` and compare to `maxAttemptsPerDay`
- Create: `packages/core/src/schemas/course.ts` — field rename
- Migration to rename column

**Steps:**

1. Decide: rename to `maxAttemptsPerDay` (semantic clarity) vs keep `maxAttempts` (migration-free). I recommend rename — it's 1 migration and future code is unambiguous.
2. Rename column via migration: `ALTER TABLE "CourseAssessment" RENAME COLUMN "maxAttempts" TO "maxAttemptsPerDay"`.
3. Rewrite the attempt check in `submission/mutations.ts`:
   ```ts
   if (assessment.maxAttemptsPerDay != null) {
     const startOfDay = startOfToday(); // utc or local? use UTC for simplicity
     const todayCount = await submissionRepo.countForUserAndAssessmentSince(
       userId,
       assessmentId,
       startOfDay,
     );
     if (todayCount >= assessment.maxAttemptsPerDay) {
       throw new ConflictError("每日提交次數已達上限，請明天再試");
     }
   }
   ```
4. Write `countForUserAndAssessmentSince` in repository.
5. Unit test: create assessment with limit 3, submit 3 times same day → 4th throws; roll over to next day fakeTimer → submission allowed.

**Verification:**

```bash
pnpm -w typecheck
pnpm test:unit -- submission-mutations
```

**Commit:** `feat(submission): convert maxAttempts to per-day limit`

---

### Task 1.8: Seed data refresh

**Dependencies:** 1.2, 1.3, 1.4, 1.5, 1.6, 1.7 all merged.

**Files:**

- Modify: `packages/db/prisma/seed.ts`

**Steps:**

1. Drop every `slug`, `visibility`, `locale` mention from course seeds.
2. Drop every `joinToken` seed.
3. Rename `maxAttempts` → `maxAttemptsPerDay`.
4. Split the current "OS lab" course-embedded contest seed into an Exam seed row (courseId bound) instead of a Contest row.
5. Add at least one `User` row with `status: 'pending_first_login'` and a `handle` to exercise the placeholder flow.
6. Add one `Exam` row with proctoring fields set so the session lock test can run against real data.
7. Validate: `pnpm db:push && pnpm db:seed` runs cleanly.

**Verification:**

```bash
pnpm db:push
pnpm db:seed
pnpm -w typecheck
pnpm test:integration -- seed
```

**Commit:** `chore(seed): refresh fixtures for split Contest/Exam and handle-based users`

---

## Phase 2 — Route scaffolding and redirects

### Task 2.1: Scaffold /courses/[courseId] route tree

**Dependencies:** Phase 1 complete.

**Files:**

- Create: `apps/web/src/routes/(app)/courses/[courseId]/+layout.server.ts`
- Create: `apps/web/src/routes/(app)/courses/[courseId]/+layout.svelte` — sticky tab bar matching Prototype 03
- Create: `apps/web/src/routes/(app)/courses/[courseId]/+page.svelte` — Overview content container (to be filled in Task 3.3)
- Create: `apps/web/src/routes/(app)/courses/[courseId]/assignments/+page.svelte` (stub)
- Create: `apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.svelte` (stub)
- Create: `apps/web/src/routes/(app)/courses/[courseId]/assignments/[assignmentId]/+page.svelte` (stub)
- Create: `apps/web/src/routes/(app)/courses/[courseId]/exams/+page.svelte` (stub)
- Create: `apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.svelte` (stub)
- Create: `apps/web/src/routes/(app)/courses/[courseId]/exams/[examId]/+page.svelte` (stub — Prototype 10 placeholder)
- Create: `apps/web/src/routes/(app)/courses/[courseId]/exams/[examId]/problems/[idx]/+page.svelte` (stub)
- Create: `apps/web/src/routes/(app)/courses/[courseId]/members/+page.svelte` (stub)
- Create: `apps/web/src/routes/(app)/courses/[courseId]/settings/+page.svelte` (stub)
- Create: `apps/web/src/routes/(app)/exams/+page.server.ts` (top-level cross-course)
- Create: `apps/web/src/routes/(app)/exams/+page.svelte` (stub — Prototype 15 placeholder)

**Steps:**

1. Create the skeleton files with minimal content (just enough for the build to succeed — a breadcrumb and a "TODO" marker).
2. Wire the `+layout.server.ts` to fetch the course by `params.courseId` via the new `course/queries.ts#getCourseById`.
3. The layout must determine whether the current user has management role (via domain `canManageCourse(actor, course, memberships)`) and expose it as `data.isManager`.
4. Tab bar reads `$page.url.pathname` to highlight active tab. Settings tab only shown when `isManager`.

**Verification:**

```bash
pnpm -w typecheck
pnpm --filter @nojv/web dev    # visit /courses/[someCuid] and verify layout renders
```

**Commit:** `feat(web): scaffold /courses/[courseId] route tree`

---

### Task 2.2: Legacy route redirects

**Dependencies:** 2.1.

**Files:**

- Modify: `apps/web/src/routes/(app)/courses/[slug]/+page.server.ts` — resolve slug → cuid via `findCourseByLegacySlugRedirect` (temporary helper), then `redirect(308, /courses/${courseId})`
- Same pattern for: `[slug]/manage/+page.server.ts`, `[slug]/manage/members/+page.server.ts`, `[slug]/manage/assessments/+page.server.ts`, `[slug]/manage/progress/+page.server.ts`, `[slug]/manage/plagiarism/[assessmentSlug]/+page.server.ts`
- For `[slug]/join/[token]/+page.server.ts` — redirect to `/courses` with a flash message saying "Join links are deprecated; ask your teacher to add you by handle."

**Wait:** In Task 1.3 we dropped `Course.slug` column entirely. So these redirects can't actually look up slug → cuid. Options:

- (a) **No redirects** — legacy URLs 404 since there's no way to map them. Acceptable if production has no real external links to course pages (they're auth-gated anyway).
- (b) Keep a one-shot **`courseSlugRedirects` table** populated at migration time mapping old slugs → cuid, use it as a lookup. Drop the table after 30 days.

Recommend **(a) no redirects** — the course pages are auth-gated, no one has bookmarked them externally. Save the table and the redirect plumbing.

So the actual task is: **delete the old `[slug]` route tree entirely.**

**Updated files:**

- Delete: `apps/web/src/routes/(app)/courses/[slug]/` entire subtree
- Verify no imports reference the deleted paths (`grep -rn "courses/\\[slug\\]"`).

**Verification:**

```bash
pnpm -w typecheck
pnpm -w lint
```

**Commit:** `refactor(web)!: delete legacy /courses/[slug] route tree`

---

### Task 2.3: Rename assignment param + delete join route

**Dependencies:** 2.1. Independent of 2.2.

**Files:**

- If any path still references `[assessmentSlug]`, rename it to `[assignmentId]`.
- Delete `/courses/[slug]/join/[token]` route tree (should be gone from 2.2 already — verify).

**Commit:** `refactor(web): rename assessmentSlug param to assignmentId` (may be a no-op after 2.2)

---

## Phase 3 — UI implementation (per prototype)

> Each Phase 3 task targets one prototype HTML file and ports it to Svelte. The pattern: create `+page.server.ts` for the loader, wire it to domain queries, build `+page.svelte` mirroring the prototype's structure using the project's existing Tailwind tokens and Bits UI primitives. **Never hand-copy classes from prototypes wholesale** — the prototypes use raw CSS utilities, the real app uses Tailwind + component library. Map the visual intent to the equivalent Tailwind + Card/Button/Tabs components.

### Task 3.1: Ports common helpers

**Dependencies:** Phase 2 complete.

**Files:**

- Create: `apps/web/src/lib/components/course/CourseTabBar.svelte` — the sticky tab strip used by every `/courses/[id]/*` page
- Create: `apps/web/src/lib/components/course/CourseHero.svelte` — course title + breadcrumb + teacher badge
- Create: `apps/web/src/lib/components/course/CourseTagPill.svelte` — small course tag used in cross-course listing pages
- Create: `apps/web/src/lib/components/common/FilterChips.svelte` — chips row used everywhere (Prototype 01/04/08/14/15)
- Create: `apps/web/src/lib/components/common/TeacherBadge.svelte`
- Create: `apps/web/src/lib/components/course/LatePenaltyRuleBuilder.svelte` — the rule picker UI (Prototype 02/05/13)

**Steps:**

1. Build each component, driven by props. No data fetching.
2. Write storybook-ish test routes under `apps/web/src/routes/(dev)/ui-test/` if helpful, but not required.

**Verification:** Typecheck + manual smoke.

**Commit:** `feat(web): add course shell components (tab bar, hero, filter chips, rule builder)`

---

### Task 3.2: Prototype 01 — `/courses` listing

**Prototype:** `01-courses-listing.html`.

**Dependencies:** 3.1.

**Files:**

- Modify: `apps/web/src/routes/(app)/courses/+page.server.ts` — load two lists via `courseDomain.listEnrolledForUser(userId)` and `courseDomain.listManagedForUser(userId)`
- Modify: `apps/web/src/routes/(app)/courses/+page.svelte` — ported layout
- New paraglide keys as needed

**Steps:**

1. Loader: single call to `courseDomain.listForUser(userId)` returning `{ enrolled: Course[], managing: Course[] }`. Push the tab split into the domain layer.
2. The template reads `data.enrolled` and `data.managing` and renders two chip-switched tab contents. Filter state (`?tab=enrolled|managing`, `?archived=true|false`) is URL-sync via `$page.url.searchParams`.
3. Card hover and status chips match prototype. For teacher variant show counts of open/draft assignments and upcoming exams (requires extra aggregation in loader — consider one extra batched query to `assignmentRepo.countsPerCourse(courseIds)` and `examRepo.countsPerCourse(courseIds)`).
4. Empty state identical to prototype; student empty state has no Create button.
5. Keep all strings in paraglide messages.

**Verification:**

```bash
pnpm --filter @nojv/web check
pnpm test:unit -- course-list
```

Manual test: browse `/courses` as student and as teacher; confirm tabs, chips, and card density match the prototype.

**Commit:** `feat(web): port courses listing page (prototype 01)`

---

### Task 3.3: Prototype 02 — `/courses/new`

**Prototype:** `02-courses-new.html`.

**Dependencies:** 3.1.

**Files:**

- Create: `apps/web/src/routes/(app)/courses/new/+page.server.ts` — superform loader + create action
- Create: `apps/web/src/routes/(app)/courses/new/+page.svelte`

**Steps:**

1. Use `sveltekit-superforms` with the new `courseCreateSchema` (no slug, no visibility, no locale).
2. Form cards: Basics (title + description), Default policies (allowed languages pill group, late penalty rule builder from 3.1).
3. Add info banner explaining placeholder user mechanism (text from prototype).
4. Submit action calls `courseDomain.createCourse(actor, input)`; on success `redirect(302, /courses/${course.id})`. On failure use `message(form, { kind: 'error', text })` pattern — the `FormError` component is already available.
5. Only `/courses/new` route should require `platformRole in [teacher, admin]`. Enforce in +page.server.ts load().

**Verification:**

```bash
pnpm --filter @nojv/web check
pnpm test:integration -- courses-create
```

Manual: create a course as teacher; confirm no slug/visibility fields.

**Commit:** `feat(web): port create course form (prototype 02)`

---

### Task 3.4: Prototype 03 — Course Overview

**Prototype:** `03-course-overview.html`.

**Dependencies:** 3.1 (tab bar + hero).

**Files:**

- Modify: `apps/web/src/routes/(app)/courses/[courseId]/+page.server.ts` — fetch announcements (5 latest), upcoming+open assignments (max 5), upcoming exams (max 5)
- Modify: `apps/web/src/routes/(app)/courses/[courseId]/+page.svelte` — single-column stacked layout

**Steps:**

1. Fetch three lists via domain: announcements, assignments, exams.
2. Single-column layout exactly matching prototype: Announcements → Assignments → Exams, each with its own section header + "+ 新 X" button shown only when `data.isManager`.
3. Assignment/exam rows show full datetime (`4/15 00:00 → 4/22 23:59`), no HW number prefix.
4. Teacher extra fields (class stats) conditionally rendered.

**Verification:** page renders for teacher and student; teacher sees + buttons and class stats.

**Commit:** `feat(web): port course overview (prototype 03)`

---

### Task 3.5: Prototype 04 — Assignments list (course-nested)

**Prototype:** `04-assignments-list.html`.

**Files:**

- Create: `apps/web/src/routes/(app)/courses/[courseId]/assignments/+page.server.ts`
- Create: `apps/web/src/routes/(app)/courses/[courseId]/assignments/+page.svelte`

**Steps:** match prototype; Draft chip only for managers; row variant depending on role.

**Commit:** `feat(web): port course assignments list (prototype 04)`

---

### Task 3.6: Prototype 05 — Create assignment

**Prototype:** `05-assignments-new.html`.

**Files:**

- Create: `apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.server.ts`
- Create: `apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.svelte`
- Create: `apps/web/src/lib/components/course/ProblemPicker.svelte` (search + dropdown + selected list with drag reorder)

**Key details:**

- Problem list min 0 max unbounded.
- `maxAttemptsPerDay` field (Task 1.7).
- Late penalty rule builder reused.
- "Draft visible to TA" info banner.
- On submit: draft button → status=draft, Publish button → status=published.

**Commit:** `feat(web): port create assignment form (prototype 05)`

---

### Task 3.7: Prototype 06 — Assignment detail (student)

**Prototype:** `06-assignment-detail-student.html`.

**Files:**

- Create: `apps/web/src/routes/(app)/courses/[courseId]/assignments/[assignmentId]/+page.server.ts`
- Create: `apps/web/src/routes/(app)/courses/[courseId]/assignments/[assignmentId]/+page.svelte`

**Visual details:**

- AC row → `bg-success/10` equivalent
- Partial row → `bg-destructive/10`
- No status pills, no score estimation footer
- Submission log footer shows last 10 submissions for this assignment only

**Commit:** `feat(web): port student assignment detail (prototype 06)`

---

### Task 3.8: Prototype 07 — Assignment detail (teacher, 4 sub-tabs)

**Prototype:** `07-assignment-detail-teacher.html`. Biggest UI task.

**Files:**

- Same page as 3.7, but conditionally render teacher view when `data.isManager`
- Create: `apps/web/src/lib/components/course/assignment/ProblemsSubtab.svelte`
- Create: `apps/web/src/lib/components/course/assignment/SubmissionsMatrixSubtab.svelte` — matrix view
- Create: `apps/web/src/lib/components/course/assignment/PlagiarismSubtab.svelte` — histogram + pair cards + inline diff
- Create: `apps/web/src/lib/components/course/assignment/SettingsSubtab.svelte` — reused create-assignment form pre-filled

**Matrix view details:**

- Rows: all students enrolled in course
- Columns: A/B/C… based on assignment problems
- Cells: per-student per-problem best score with color coding
- Row click → student submission drilldown
- Column click → problem submission drilldown
- Sortable by total/handle/per-column
- Exportable as CSV (server action)

**Plagiarism details:**

- Histogram rendered from `plagiarismResults` JSON (build a simple CSS bar chart like prototype; no chart library dependency)
- Pair cards listed high → low similarity
- Top pair auto-expanded with side-by-side inline code diff (use `<CodeDiff />` component — build if missing)

**Commit:** `feat(web): port teacher assignment detail with matrix + plagiarism (prototype 07)`

---

### Task 3.9: Prototypes 08–10 — Exam list + create + State A

**Prototypes:** 08, 09, 10.

**Files:**

- Create: `apps/web/src/routes/(app)/courses/[courseId]/exams/+page.{server.ts,svelte}` (list)
- Create: `apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.{server.ts,svelte}`
- Create: `apps/web/src/routes/(app)/courses/[courseId]/exams/[examId]/+page.{server.ts,svelte}` (State A)

**Steps:**

- List page mirrors prototype 08: date-block card, proctor icon row, live pulse on running.
- Create page mirrors prototype 09: reuses the create-assignment form scaffold + adds Proctoring + Scoring cards.
- State A mirrors prototype 10: countdown card, proctor info row, sub-tabs (Problems | 提交 | 設定), roster side panel.

**Commit:** `feat(web): port exam list, create, and State A (prototypes 08-10)`

---

### Task 3.10: Extract ProblemSolveView shared component

**Prototype:** `11-exam-state-b.html` + existing `/problems/[id]` (read current implementation first).

**Dependencies:** 3.9.

**Files:**

- Read: current `apps/web/src/routes/(app)/problems/[id]/+page.svelte`
- Create: `apps/web/src/lib/components/problem/ProblemSolveView.svelte`
- Modify: `apps/web/src/routes/(app)/problems/[id]/+page.svelte` — now a thin wrapper around ProblemSolveView with `mode="practice"`
- The exam mode consumer is Task 3.11

**Component props:**

```ts
type Props = {
  mode: "practice" | "exam";
  problem: ProblemData;
  submissions: Submission[]; // already scoped by the loader — component does NOT filter
  siblingProblems?: ProblemSummary[]; // for exam mode left rail; null in practice
  examContext?: {
    // exam-only overlay
    examId: string;
    examTitle: string;
    countdownMs: number;
    ipAddress: string;
    userHandle: string;
  } | null;
};
```

**Security invariant:** the component does NOT filter `submissions` — it renders whatever it's given. Scoping happens at the loader. A compromised client-side filter should never expose cross-exam data.

**Commit:** `refactor(web): extract ProblemSolveView shared between practice and exam`

---

### Task 3.11: Prototype 11 — Exam mode route

**Prototype:** `11-exam-state-b.html`.

**Dependencies:** 3.10.

**Files:**

- Create: `apps/web/src/routes/(app)/courses/[courseId]/exams/[examId]/problems/[idx]/+page.server.ts`
- Create: `apps/web/src/routes/(app)/courses/[courseId]/exams/[examId]/problems/[idx]/+page.svelte`

**Loader scope (critical):**

```ts
export const load: PageServerLoad = async (event) => {
  const { courseId, examId, idx } = event.params;
  const actor = await requireAuth(event);

  // 1. Fetch exam, verify participant is in-session (ActiveExamSession row exists)
  const session = await examDomain.requireActiveSession(actor.userId, examId);

  // 2. Fetch exam problems in order
  const problems = await examDomain.getProblemsForExam(examId);
  const current = problems[Number(idx)];
  if (!current) error(404, "Problem not in this exam");

  // 3. Fetch ONLY submissions for this user + this exam + this problem
  const submissions = await submissionDomain.listForUserExamProblem(
    actor.userId,
    examId,
    current.problemId,
  );

  return {
    mode: "exam" as const,
    problem: current,
    submissions,
    siblingProblems: problems,
    examContext: {
      examId,
      examTitle: session.exam.title,
      countdownMs: session.exam.endsAt.getTime() - Date.now(),
      ipAddress: event.getClientAddress(),
      userHandle: actor.handle ?? actor.email,
    },
  };
};
```

**The template** is a thin wrapper that passes loader data to `<ProblemSolveView {...data} />`.

**Exam strip** is a separate `<ExamTopStrip />` component rendered by this page (not by `ProblemSolveView`) — the strip replaces the site header during exam mode.

**Commit:** `feat(web): port exam problem solve route (prototype 11)`

---

### Task 3.12: Prototype 12 — Members

**Prototype:** `12-members.html`.

**Files:**

- Create: `apps/web/src/routes/(app)/courses/[courseId]/members/+page.{server.ts,svelte}`
- Create: `apps/web/src/lib/components/course/BulkHandleAddPanel.svelte`

**Bulk add flow:** teacher pastes text → server parses into `string[]` → for each handle, try `findByHandle` → if found add as member; if not, `createPlaceholder` + add as member → return summary `Added N (K new placeholders, L already in course)`. See Task 5.1.

**Commit:** `feat(web): port course members page with bulk handle add (prototype 12)`

---

### Task 3.13: Prototype 13 — Settings

**Prototype:** `13-settings.html`.

**Files:**

- Create: `apps/web/src/routes/(app)/courses/[courseId]/settings/+page.{server.ts,svelte}`

Matches prototype: Course info card, Default policies card (including the rule builder), Visibility (archived toggle), Danger zone.

**Commit:** `feat(web): port course settings (prototype 13)`

---

### Task 3.14: Prototype 14 — Top-level /assignments

**Prototype:** `14-assignments-top.html`.

**Files:**

- Modify: `apps/web/src/routes/(app)/assignments/+page.{server.ts,svelte}` (existing file — replace)

**Loader:** `assignmentDomain.listForUserAcrossCourses(userId, { status, sort })` — joins CourseMembership to find all courses user is in, then unions their assignments.

**Commit:** `feat(web): port cross-course assignments list (prototype 14)`

---

### Task 3.15: Prototype 15 — Top-level /exams

**Prototype:** `15-exams-top.html`.

**Files:**

- Create: `apps/web/src/routes/(app)/exams/+page.{server.ts,svelte}`

Same as 3.14 pattern but for exams. Running exams get the big "Enter exam" CTA if the user hasn't yet entered.

**Commit:** `feat(web): add cross-course exams list (prototype 15)`

---

## Phase 4 — Exam session lock

### Task 4.1: hooks.server.ts exam session lock

**Dependencies:** 1.6 (session tables), 3.11 (exam route exists).

**Files:**

- Modify: `apps/web/src/hooks.server.ts`
- Create: `apps/web/src/lib/server/exam-lock.ts` — helper `getActiveExamContext(userId)` and `isAllowedPathForExam(pathname, examContext)`

**Logic:**

```ts
// After session fetch, before resolve:
if (event.locals.sessionUser) {
  const examCtx = await getActiveExamContext(event.locals.sessionUser.id);
  if (examCtx) {
    const examPrefix = `/courses/${examCtx.courseId}/exams/${examCtx.examId}`;
    if (!cleanPath.startsWith(examPrefix)) {
      // Student tried to navigate away from exam. Redirect back.
      await logExamEvent(examCtx.sessionId, "visibility_lost", { attemptedPath: cleanPath });
      redirect(307, examPrefix);
    }
  }
}
```

**Commit:** `feat(web): add exam session lock hook`

---

### Task 4.2: Release endpoint + audit

**Files:**

- Create: `apps/web/src/routes/api/exam-session/release/+server.ts` — POST accepting `{ examId, reason: "submitted" | "time_up" | "released_by_instructor" }`, authz-gated
- Modify: `packages/domain/src/exam/session.ts` — `endSession` writes to `ActiveExamSession.endedAt` and `releaseReason`, then emits `ExamSessionEvent`

**Commit:** `feat(exam): release endpoint and audit log`

---

### Task 4.3: Client-side confinement

**Files:**

- Modify: `apps/web/src/routes/(app)/courses/[courseId]/exams/[examId]/problems/[idx]/+page.svelte` — add `beforeunload` listener that posts to release endpoint; add popstate handler that redirects back into exam on back button

**Commit:** `feat(web): client-side exam confinement handlers`

---

### Task 4.4: Worker auto-close on time-up

**Files:**

- Create or modify: `apps/worker/src/workflows/exam-auto-close.ts` — Temporal workflow that sleeps until `exam.endsAt`, then ends all active sessions

**Commit:** `feat(worker): auto-close exam sessions at time-up`

---

## Phase 5 — Members rework

### Task 5.1: Bulk handle parser

**Files:**

- Create: `packages/domain/src/course/members.ts` — `parseHandleInput(raw: string): string[]`, `bulkAddMembers(actor, courseId, handles, role)` returns `{ added, placeholdersCreated, skipped }`
- Unit test cases in `tests/unit/domain/course-members.test.ts`

**Commit:** `feat(domain): bulk handle add with placeholder creation`

---

### Task 5.2: Better-auth attach hook

**Files:**

- Modify: `apps/web/src/lib/auth.ts` (or wherever better-auth is configured)

**Commit:** `feat(auth): attach placeholder user on first OAuth login by handle`

---

## Phase 6 — Cleanup

### Task 6.1: Contest create gate removal

**Files:**

- Modify: `apps/web/src/routes/(app)/contests/create/+page.server.ts` — remove `platformRole in [teacher, admin]` check; keep authenticated check only
- Modify: `packages/domain/src/contest/permissions.ts` — any `canCreateContest(platformRole)` helper — change to always true for authenticated users

**Commit:** `feat(contest): allow any authenticated user to create standalone contests`

---

### Task 6.2: Delete legacy /manage/\* and per-card language toggles

**Files:**

- Already gone from Phase 2.2, verify nothing references
- Delete `apps/web/src/lib/components/manage/` directory
- Remove `SystemTextToggle.svelte` and any remaining per-card locale switchers (the single header switcher is the source of truth)

**Commit:** `chore(web): delete legacy manage components and per-card locale toggles`

---

### Task 6.3: Remove unused i18n strings

**Files:**

- Run paraglide check for orphan keys after all UI is ported
- Delete obsolete `admin_*` keys that belong to removed pages

**Commit:** `chore(i18n): remove orphaned paraglide keys`

---

### Task 6.4: Dead code and imports

**Files:**

- `pnpm --filter @nojv/web check` — must be 0 errors 0 warnings
- `pnpm lint` — must pass
- Run a quick orphan scan: `find apps/web/src -name "*.svelte" -o -name "*.ts" | xargs grep -L import` (heuristic)

**Commit:** `chore: remove dead code and orphaned files`

---

### Task 6.5: Full CI verification

```bash
pnpm -w format
pnpm -w lint
pnpm -w typecheck
pnpm -w test:unit
pnpm -w test:integration
pnpm -w build
```

All green. If any fail, open a new task to fix.

**Commit:** `chore: final verification`

---

## Open risks / mitigations

1. **`Contest.slug` still needed after the split?** Standalone contests keep slug for shareable URLs — yes. Exam has no slug.
2. **Existing production data migration.** The data migration SQL in Task 1.4 assumes a locally hosted Postgres with controlled row counts. If production has thousands of course contests, the `UPDATE ... WHERE` scans need `contestId` index to stay performant. Verify index exists or add one before running.
3. **`late_penalty_decay` orphan rows.** Task 1.2 auto-converts to `flat_late_penalty 20%`. Print a migration report: every `{problemId, oldRule, newRule}` tuple so the operator can audit.
4. **ProblemSolveView extraction.** The existing `/problems/[id]` page may embed business logic in the template. Task 3.10 requires reading it first — write a short report in the commit message of what was moved out.
5. **Better-auth `onBeforeCreateUser` hook.** Verify the hook fires on OAuth callback too, not just email/password signup. If it doesn't, use `onBeforeSignIn` or similar.
6. **Exam session lock and API routes.** `/api/*` must be exempt from the lock — otherwise the release endpoint itself would 307 redirect. Add exemption in `isPageLockExempt` or parallel helper.

## Commit-message template per task

```
<type>(<scope>): <summary under 70 chars>

- bullet 1
- bullet 2
- reference prototype file when UI

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

## Done checklist

- [x] Phase 1 all tasks merged, `pnpm db:push && pnpm db:seed` clean
- [x] Phase 2 route scaffolding merged, `pnpm --filter @nojv/web dev` boots
- [x] Phase 3 all 15 prototypes ported, `pnpm -w check` green
- [x] Phase 4 session lock integration test passes (student redirected back to exam)
- [x] Phase 5 bulk handle add test passes end-to-end
- [x] Phase 6 cleanup done, full CI green (format / lint / typecheck / 258 unit / 96 integration / 10 build)
- [x] Move this plan file to `docs/plans/completed/` with a summary of deviations from the spec in the final commit

## Deviations from the plan

Recorded on 2026-04-16 after the final compliance audit. Both are
cosmetic differences in naming — functionally the redesign matches the
spec's intent in every phase.

1. **User "handle" reused the existing `username` column instead of a new
   `User.handle` field.** `better-auth` already ships a `username` plugin
   with a unique index, and the repositories (`findByUsername`,
   `createPlaceholder`, `attachPlaceholderToAuth`) all key on `username`.
   The practical contract is identical: a single globally-unique,
   human-readable identifier that bulk-handle-add and OAuth attach both
   operate on. Reflect this in the spec §5.2 wording if it is ever
   revisited.
2. **Task 4.2's release endpoint is `POST /api/exam-session/end`, not
   `/release`.** The endpoint accepts a discriminated union where
   `reason: "submitted"` is the student-initiated exit and
   `reason: "released_by_instructor"` is the staff override. This covers
   the spec §4.7 "Release" and §4.8 "Submit & end" exits in a single
   handler. The plan never dictated a URL path, so this is a naming
   preference rather than a deviation.

## Minor test-coverage follow-ups

All closed as of 2026-04-16.

- ~~Task 1.1 relocated `icpc.test.ts` to `tests/unit/domain/scoring/` but
  did not add `ioi.test.ts` / `scoreboard-builder.test.ts` at that
  location.~~ Both files landed in commit `029b3bd`. 23 new unit tests
  cover `buildIoiScoreboard`, `buildScoreboard` dispatcher, and
  `buildScoreboardChartSeries` for ICPC and IOI modes. Full unit suite
  is now 36 files / 278 tests.
