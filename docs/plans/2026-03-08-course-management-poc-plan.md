# Course Management POC Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the Online Judge POC so it supports course management with four-tier RBAC, course-scoped problem usage, assignments, exams, and join flows.

**Architecture:** Keep the existing monorepo boundaries. Expand the Prisma model so courses, memberships, assignments, and course-scoped assessments connect directly to the existing problem, contest, submission, workspace, and integrity records. Add role-aware Next.js surfaces plus POC persistence helpers so the same vertical slice is runnable without introducing a full production auth stack.

**Tech Stack:** Next.js, Vite, Prisma, PostgreSQL, Redis, BullMQ, Zod, Vitest, Tailwind CSS, i18n

---

### Task 1: Define shared course-domain contracts

**Files:**

- Modify: `packages/domain/src/index.ts`
- Create: `apps/web/tests/course-domain.test.ts`

**Step 1: Write the failing test**

- Add tests that prove:
  - course roles validate as `admin | teacher | ta | student`
  - course join requests support `qr_code | join_code | manual_invite`
  - assignments require valid open and due windows
  - course assessments differentiate `assignment` vs `exam`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test`
Expected: FAIL because the new schemas and exported helpers do not exist.

**Step 3: Write minimal implementation**

- Add Zod enums and schemas for:
  - course roles
  - course visibility / problem visibility
  - join methods
  - assessment kinds and states
  - teacher course creation
  - student join requests
  - assignment / exam summaries

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test`
Expected: PASS.

### Task 2: Expand the Prisma schema for courses and course assessments

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/index.ts`

**Step 1: Write the failing test**

- The red check is Prisma validation after adding references in TypeScript but before the schema exists.

**Step 2: Verify red**

Run: `pnpm db:validate`
Expected: FAIL until the new enums, models, and relations are added correctly.

**Step 3: Write minimal implementation**

- Add enums for:
  - `PlatformRole`
  - `CourseRole`
  - `CourseVisibility`
  - `CourseMembershipStatus`
  - `CourseJoinMethod`
  - `ProblemVisibility`
  - `CourseAssessmentType`
  - `CourseAssessmentStatus`
- Extend `User` with platform role and authored / managed relations.
- Add models for:
  - `Course`
  - `CourseMembership`
  - `CourseJoinToken`
  - `ProblemAuthoring`
  - `CourseProblem`
  - `CourseAssessment`
  - `CourseAssessmentProblem`
- Add optional links from `Contest`, `Submission`, `WorkspaceSession`, `WorkspaceRun`, `CheatingCase`, and `CheatingSignal` into course / assessment context where needed.

**Step 4: Run validation**

Run: `pnpm db:validate`
Expected: PASS.

### Task 3: Add tested persistence and seed helpers for course POC data

**Files:**

- Create: `apps/web/tests/course-persistence-mappers.test.ts`
- Create: `apps/web/src/lib/server/course-poc-data.ts`
- Modify: `apps/web/src/lib/server/persistence-mappers.ts`
- Modify: `apps/web/src/lib/server/poc-persistence.ts`
- Modify: `apps/web/src/lib/demo-data.ts`

**Step 1: Write the failing test**

- Add tests that prove:
  - role resolution prefers course-level role over platform defaults
  - assignment status derives correctly from open / due / close windows
  - exam vs assignment scoreboard mode is derived deterministically

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test`
Expected: FAIL because the new mapper helpers and course POC data do not exist.

**Step 3: Write minimal implementation**

- Add deterministic POC course data with:
  - at least one teacher-managed course
  - TA and student memberships
  - join code and QR enrollment entries
  - public and private problems
  - one assignment and one exam
- Add persistence helpers that upsert course, memberships, assessments, and course-problem links into Prisma.
- Keep the current demo identity model, but make role and course context explicit instead of implicit.

**Step 4: Run tests**

Run: `pnpm --filter @nojv/web test`
Expected: PASS.

### Task 4: Add course join and teacher management APIs

**Files:**

- Create: `apps/web/src/app/api/courses/route.ts`
- Create: `apps/web/src/app/api/courses/[slug]/join/route.ts`
- Create: `apps/web/src/app/api/courses/[slug]/members/route.ts`
- Create: `apps/web/src/app/api/courses/[slug]/assessments/route.ts`
- Modify: `apps/web/src/lib/server/poc-persistence.ts`
- Modify: `apps/web/src/lib/server/queue.ts` only if new queue interaction is truly required

**Step 1: Write the failing test**

- Add route tests that prove:
  - a teacher can create a course
  - a student can join via join code
  - a QR join token resolves to the same membership flow
  - a teacher can manually add a student and auto-create the account
  - only teacher / TA / admin can create assessments

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test`
Expected: FAIL because the routes and permission checks do not exist.

**Step 3: Write minimal implementation**

- Implement POC header-driven actor resolution.
- Add course creation, join, membership insertion, and assessment creation routes.
- Enforce the four-tier permissions:
  - admin: global oversight
  - teacher: course owner / manager
  - ta: limited course staff
  - student: participant only
- Manual student insertion must auto-create a user record when the email / handle is missing.

**Step 4: Run tests**

Run: `pnpm --filter @nojv/web test`
Expected: PASS.

### Task 5: Build course, assignment, and exam surfaces in Next.js

**Files:**

- Create: `apps/web/src/components/course-membership-panel.tsx`
- Create: `apps/web/src/components/course-assessment-board.tsx`
- Create: `apps/web/src/components/course-problem-shelf.tsx`
- Create: `apps/web/src/app/[locale]/courses/page.tsx`
- Create: `apps/web/src/app/[locale]/courses/[slug]/page.tsx`
- Create: `apps/web/src/app/[locale]/courses/[slug]/assignments/[assessmentSlug]/page.tsx`
- Create: `apps/web/src/app/[locale]/courses/[slug]/exams/[assessmentSlug]/page.tsx`
- Modify: `apps/web/src/app/[locale]/layout.tsx`
- Modify: `apps/web/src/app/[locale]/page.tsx`
- Modify: `apps/web/src/app/[locale]/problems/page.tsx`
- Modify: `apps/web/src/app/[locale]/problems/[slug]/page.tsx`
- Modify: `packages/i18n/src/index.ts`

**Step 1: Write the failing test**

- Add render-level tests for:
  - course list page showing teacher-owned courses
  - course detail page showing join methods, members, private/public problem pools
  - assignment page showing time windows and coursework framing
  - exam page showing contest-style scoreboard framing

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test`
Expected: FAIL because the routes and components do not exist.

**Step 3: Write minimal implementation**

- Add a course navigation entry.
- Add a course list and course detail experience.
- Add a teacher-facing assessment board that distinguishes:
  - assignments: deadline and open / close window emphasis
  - exams: contest-like timing and live / frozen rank emphasis
- Surface public vs private problem origin and course inclusion.

**Step 4: Run tests**

Run: `pnpm --filter @nojv/web test`
Expected: PASS.

### Task 6: Link assessments into existing submission and workspace flows

**Files:**

- Modify: `packages/domain/src/index.ts`
- Modify: `apps/web/src/components/problem-editor.tsx`
- Modify: `apps/workspace/src/App.tsx`
- Modify: `apps/web/src/app/api/submissions/route.ts`
- Modify: `apps/web/src/app/api/workspace/runs/route.ts`
- Modify: `apps/web/src/lib/server/poc-persistence.ts`
- Modify: `apps/worker/src/processors.ts` only if payload handling needs to preserve assessment context

**Step 1: Write the failing test**

- Add tests that prove:
  - assignment-linked submissions persist course assessment context
  - exam-linked workspace runs use contest-grade restrictions
  - assignment pages still allow assignment-mode workspace behavior

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test`
Expected: FAIL because the payloads and persistence do not carry assessment context.

**Step 3: Write minimal implementation**

- Extend submission and workspace request payloads with optional course / assessment context.
- Persist that context into the appropriate linked records.
- Keep contest exam pages stricter than assignment pages.

**Step 4: Run tests**

Run: `pnpm --filter @nojv/web test`
Expected: PASS.

### Task 7: Update documentation and verify the expanded POC

**Files:**

- Modify: `README.md`
- Create: `docs/reports/2026-03-08-course-management-poc-report.md`
- Modify: `docs/reports/2026-03-08-poc-architecture-report.md`

**Step 1: Write the report**

- Document:
  - role model
  - course / assignment / exam architecture
  - join flows
  - residual risks
  - scalability / k8s implications of adding course traffic

**Step 2: Run repository verification**

Run: `pnpm ci:verify`
Expected: PASS.

**Step 3: Run runtime verification**

Run:

```bash
pnpm db:push
pnpm dev
```

Then verify:

- course creation route works
- join code and QR code join work
- teacher manual add creates a student account
- assignment and exam pages render with distinct framing
- submission / workspace / integrity records still persist with the new course context
