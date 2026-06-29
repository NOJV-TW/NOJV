# Rejudge + Score Override Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship both teacher-correction primitives described in `2026-04-19-rejudge-and-score-override-design.md` — extend the existing rejudge infrastructure with new scopes, audit log, and permissions; add the score-override data model, API, scoring integration, and UI.

**Architecture:** Rejudge reuses the existing `rejudgeWorkflow` + `submissionJudgeWorkflow` and threads a `forRejudge` flag so the child can snapshot the submission before overwriting. Score override is a new model with a single `resolveFinalScore` gateway that every scoreboard / stats / matrix reader funnels through. Both features share the `canOperateOnSubmission` authz helper derived from the submission-context permission memory.

**Tech Stack:** Prisma 7, `@nojv/application`, `@nojv/temporal`, `@nojv/job-dispatch`, SvelteKit 5, Bits UI dialogs, Vitest, paraglide.

**Reference design:** `docs/plans/active/2026-04-19-rejudge-and-score-override-design.md`.

**Prerequisite:** Feature #1 notification plan has no direct dependency here (rejudge emits no notification, override emits no notification) — these plans are independently executable.

**Conventions:** Same as notification plan (see `2026-04-19-notification-center-plan.md`). Routes use cuid URLs (`[problemId]`, `[contestId]`, `[courseId]`, `[assessmentId]`, `[examId]`, `[submissionId]`) per the 2026-04-16 unification.

---

## Phase 1 — Rejudge: extend input + authz + audit log

### Task 1: Extend `RejudgeInput` to a discriminated union

**Files:**

- Modify: `packages/temporal/src/types.ts`

**Step 1: Rewrite the interface**

Replace the existing:

```ts
export interface RejudgeInput {
  problemId: string;
  contestId?: string;
  assessmentId?: string;
}
```

with:

```ts
export type RejudgeInput =
  | {
      mode: "batch";
      problemId: string;
      contestId?: string;
      assessmentId?: string;
      examId?: string;
      userIds?: string[];
      since?: string; // ISO date
      until?: string; // ISO date
      triggeredByUserId: string;
    }
  | {
      mode: "single";
      submissionId: string;
      triggeredByUserId: string;
    };
```

**Step 2: Fix resulting type errors in workflow + dispatch**

`packages/temporal/src/workflows/rejudge.ts` and `packages/job-dispatch/src/dispatch.ts` will now fail to typecheck. Update both:

- `dispatchRejudge` derives the `workflowId` suffix from either `submissionId` (single mode) or the first non-null of `{examId, contestId, assessmentId, problemId}` (batch mode).
- `rejudgeWorkflow` switches on `input.mode`: single mode just fetches one submission; batch mode calls the existing `fetchSubmissionIdsForRejudge(batchInput)`.

**Step 3: Typecheck**

Run: `pnpm -w typecheck`
Expected: 0 errors.

**Step 4: Commit**

```bash
git add packages/temporal/src/types.ts packages/temporal/src/workflows/rejudge.ts packages/job-dispatch/src/dispatch.ts
git commit -m "feat(temporal): RejudgeInput discriminated union (single + batch)"
```

---

### Task 2: Extend `findForRejudge` domain query

**Files:**

- Modify: `packages/application/src/submission/judge-context.ts:223`

**Step 1: Extend the signature to cover new fields**

```ts
export async function findForRejudge(input: {
  problemId: string;
  contestId?: string;
  assessmentId?: string;
  examId?: string;
  userIds?: string[];
  since?: Date;
  until?: Date;
}): Promise<{ submissionId: string; draft: SubmissionDraft }[]> {
  const where: Prisma.SubmissionWhereInput = {
    problemId: input.problemId,
    sampleOnly: false,
  };

  if (input.contestId) where.contestId = input.contestId;
  if (input.assessmentId) where.courseAssessmentId = input.assessmentId;
  if (input.examId) where.examId = input.examId; // confirm column name on Submission
  if (input.userIds && input.userIds.length > 0) where.userId = { in: input.userIds };
  if (input.since || input.until) {
    where.createdAt = {};
    if (input.since) where.createdAt.gte = input.since;
    if (input.until) where.createdAt.lte = input.until;
  }

  const submissions = await submissionRepo.findForRejudge(where);
  return submissions.map((s) => ({
    submissionId: s.id,
    draft: {/* same as today */},
  }));
}
```

Check `packages/db/prisma/schema/submission.prisma` for the actual column used for exam context — if `Submission.examId` doesn't exist, confirm how exam submissions attach (might be via `examParticipationId` or a combined field). Adjust accordingly.

**Step 2: Commit**

```bash
git add packages/application/src/submission/judge-context.ts
git commit -m "feat(domain): findForRejudge supports exam / userIds / date range"
```

---

### Task 3: Add single-submission fetch path for `rejudgeWorkflow`

**Files:**

- Modify: `packages/temporal/src/activities/judge.ts` — add `fetchSingleSubmissionForRejudge`
- Modify: `packages/temporal/src/workflows/rejudge.ts` — branch on mode

**Step 1: Add the activity**

```ts
// activities/judge.ts
export async function fetchSingleSubmissionForRejudge(submissionId: string) {
  return submissionDomain.findOneForRejudge(submissionId);
}
```

Add `submissionDomain.findOneForRejudge(submissionId)` returning `{ submissionId; draft } | null`.

**Step 2: Branch in the workflow**

```ts
export async function rejudgeWorkflow(input: RejudgeInput): Promise<void> {
  let completed = 0;
  let total = 0;
  setHandler(getProgressQuery, () => ({ completed, total }));

  let targets: { submissionId: string; draft: SubmissionDraft }[];
  if (input.mode === "single") {
    const one = await judge.fetchSingleSubmissionForRejudge(input.submissionId);
    targets = one ? [one] : [];
  } else {
    targets = await judge.fetchSubmissionIdsForRejudge(input);
  }

  total = targets.length;
  if (total === 0) return;
  // ... existing batching + executeChild loop, pass { forRejudge: true, triggeredByUserId: input.triggeredByUserId }
}
```

**Step 3: Commit**

```bash
git commit -m "feat(temporal): single-submission rejudge workflow path"
```

---

### Task 4: Add `SubmissionRejudgeLog` schema + migration

**Files:**

- Modify: `packages/db/prisma/schema/submission.prisma` — add the model
- Create: migration file under `packages/db/prisma/migrations/`

**Step 1: Add model**

```prisma
model SubmissionRejudgeLog {
  id               String   @id @default(cuid())
  submissionId     String
  rejudgedByUserId String?
  oldVerdict       String
  oldScore         Int
  oldResultJson    Json?
  newVerdict       String
  newScore         Int
  newResultJson    Json?
  createdAt        DateTime @default(now())

  submission       Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  rejudgedBy       User?      @relation(fields: [rejudgedByUserId], references: [id], onDelete: SetNull)

  @@index([submissionId, createdAt(sort: Desc)])
  @@index([rejudgedByUserId, createdAt(sort: Desc)])
}
```

Add the back-relations on `Submission` and `User`.

**Step 2: Generate migration**

Hand-write under `packages/db/prisma/migrations/20260419130000_add_submission_rejudge_log/migration.sql`. `pnpm db:generate && pnpm db:push` and verify with `\d`.

**Step 3: Commit**

```bash
git commit -m "feat(db): SubmissionRejudgeLog audit table"
```

---

### Task 5: Thread `forRejudge` flag through `submissionJudgeWorkflow` + snapshot on entry

**Files:**

- Modify: `packages/temporal/src/types.ts` — extend `SubmissionJudgeInput`
- Modify: `packages/temporal/src/workflows/submission-judge.ts`
- Modify: `packages/temporal/src/activities/judge.ts`
- Modify: `packages/application/src/submission/mutations.ts`

**Step 1: Extend the input type**

```ts
export interface SubmissionJudgeInput {
  submissionId: string;
  draft: SubmissionDraft;
  forRejudge?: { triggeredByUserId: string }; // present only on rejudge runs
}
```

**Step 2: Add `snapshotForRejudge` activity**

Before `executeSandbox` in `submissionJudgeWorkflow`, if `input.forRejudge` is set, call:

```ts
await judge.snapshotSubmissionForRejudge(
  input.submissionId,
  input.forRejudge.triggeredByUserId,
);
```

The activity reads the current `Submission` row and writes a `SubmissionRejudgeLog` row with `old*` fields populated and `new*` left null (updated later on completion). Simpler alternative: one-pass log written on completion with both old and new — implementer's call. Either is fine as long as the audit captures pre/post.

**Step 3: On completion, update the log's `new*` fields**

After `completeSubmission`, if `input.forRejudge`, call `judge.finalizeRejudgeLog(submissionId, triggeredByUserId, newVerdict, newScore, newResultJson)` which updates the most recent log row for this submission from the same triggerer.

**Step 4: Commit**

```bash
git commit -m "feat(temporal): snapshot submission rejudge log before/after re-judge"
```

---

### Task 6: Shared authz helper `canOperateOnSubmission`

**Files:**

- Create: `packages/application/src/submission/authz.ts`
- Modify: `packages/application/src/submission/index.ts` (re-export)
- Test: `tests/unit/domain/submission-authz.test.ts`

**Step 1: Write the failing test**

Cover the matrix from the memory:

- Admin → always allowed
- Practice submission → problem author allowed, other user denied
- Assignment submission → course teacher/TA allowed, unrelated teacher denied
- Exam submission → course teacher/TA allowed
- Contest submission → contest organizer allowed, unrelated contest organizer denied

**Step 2: Implement**

```ts
export async function canOperateOnSubmission(
  actor: ActorContext,
  submission: {
    id: string;
    userId: string;
    problemId: string;
    contestId?: string | null;
    courseAssessmentId?: string | null;
    examId?: string | null;
  },
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;

  if (submission.contestId) {
    const contest = await contestRepo.findById(submission.contestId);
    return contest?.createdByUserId === actor.userId;
  }

  if (submission.courseAssessmentId) {
    const assessment = await courseAssessmentRepo.findById(submission.courseAssessmentId);
    if (!assessment) return false;
    return isCourseTeacherOrTa(actor.userId, assessment.courseId);
  }

  if (submission.examId) {
    const exam = await examRepo.findById(submission.examId);
    if (!exam) return false;
    return isCourseTeacherOrTa(actor.userId, exam.courseId);
  }

  // practice context — problem author only
  const problem = await problemRepo.findById(submission.problemId);
  return problem?.createdByUserId === actor.userId;
}

export async function assertCanOperateOnSubmission(actor, submission) {
  if (!(await canOperateOnSubmission(actor, submission))) {
    throw new ForbiddenError("Not permitted to operate on this submission.");
  }
}
```

`isCourseTeacherOrTa(userId, courseId)` likely already exists under `packages/application/src/course/*`; reuse. If not, implement: `CourseMembership` where role in (teacher, ta) and status = active.

**Step 3: Commit**

```bash
git commit -m "feat(domain): canOperateOnSubmission authz helper"
```

---

### Task 7: Batch-scope authz `assertBatchRejudgeAccess`

**Files:**

- Modify: `packages/application/src/submission/authz.ts`
- Test: `tests/unit/domain/batch-rejudge-authz.test.ts`

**Step 1: Implement**

```ts
export async function assertBatchRejudgeAccess(
  actor: ActorContext,
  input: Exclude<RejudgeInput, { mode: "single" }>,
): Promise<void> {
  if (actor.platformRole === "admin") return;

  // If a specific context is set, check that one.
  if (input.contestId) {
    /* must be organizer */
  } else if (input.assessmentId) {
    /* must be course teacher/TA */
  } else if (input.examId) {
    /* must be course teacher/TA */
  } else {
    // Unscoped batch on a bare problemId — only problem author (practice) is allowed, and then only if no mixed-context submissions match.
    const problem = await problemRepo.findById(input.problemId);
    if (problem?.createdByUserId !== actor.userId) {
      throw new ForbiddenError(
        "Batch rejudge without a context scope is limited to the problem author.",
      );
    }
    const anyNonPractice = await submissionRepo.anyMatch({
      problemId: input.problemId,
      OR: [
        { contestId: { not: null } },
        { courseAssessmentId: { not: null } },
        { examId: { not: null } },
      ],
    });
    if (anyNonPractice) {
      throw new ForbiddenError(
        "Batch rejudge includes non-practice submissions; scope to a specific context.",
      );
    }
  }
}
```

Implementation note: keep the query count bounded. Prefer `findFirst` + `select id` for the "any non-practice" check.

**Step 2: Commit**

```bash
git commit -m "feat(domain): batch rejudge authz enforcement"
```

---

### Task 8: API route — `POST /api/rejudge`

**Files:**

- Create: `apps/web/src/routes/api/rejudge/+server.ts`

**Step 1: Implement**

```ts
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { requireAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { submissionDomain, submissionRepo } from "@nojv/application";
import { dispatchRejudge } from "@nojv/job-dispatch";
import type { RequestHandler } from "./$types";

const singleSchema = z.object({ mode: z.literal("single"), submissionId: z.string().min(1) });
const batchSchema = z.object({
  mode: z.literal("batch"),
  problemId: z.string().min(1),
  contestId: z.string().optional(),
  assessmentId: z.string().optional(),
  examId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
});
const bodySchema = z.discriminatedUnion("mode", [singleSchema, batchSchema]);

export const POST: RequestHandler = apiHandler(async (event) => {
  const actor = requireAuth(event);
  await consumeFormRateLimit(event, `rejudge:${actor.userId}`);
  const body = bodySchema.parse(await event.request.json());

  if (body.mode === "single") {
    const submission = await submissionRepo.findById(body.submissionId);
    if (!submission) return new Response("Not found", { status: 404 });
    await submissionDomain.assertCanOperateOnSubmission(actor, submission);
    await dispatchRejudge({
      mode: "single",
      submissionId: submission.id,
      triggeredByUserId: actor.userId,
    });
    return json({ queued: 1 });
  }

  await submissionDomain.assertBatchRejudgeAccess(actor, body);
  await dispatchRejudge({ ...body, triggeredByUserId: actor.userId });
  return json({ queued: "batch-dispatched" });
});
```

**Step 2: Commit**

```bash
git commit -m "feat(web): POST /api/rejudge (single + batch)"
```

---

### Task 9: Integration test — single-submission rejudge round trip

**Files:**

- Create: `tests/integration/rejudge/single-mode.test.ts`

Seed a problem, submit code that scores 50, assert `Submission.score = 50`; then modify the problem's testcase via a domain call, call `POST /api/rejudge` in single mode as admin, await workflow completion, assert `Submission.score` changed and a `SubmissionRejudgeLog` row exists with matching `oldScore`.

Practical note: integration tests talk to a running Temporal dev server — use the existing helper patterns; if no such helper exists, polling `submissionRepo.findById` until `updatedAt > before` is acceptable with a 30s deadline.

Commit:

```bash
git commit -m "test: rejudge single-mode integration test"
```

---

## Phase 2 — Rejudge UI

### Task 10: Rejudge button on problem admin page (batch)

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte` — add a "Rejudge submissions" button in the admin actions area
- Create: `apps/web/src/lib/components/problem/RejudgeDialog.svelte` — modal with optional filters (contestId / assessmentId / examId / userIds comma-separated / date range)

The dialog `POST`s to `/api/rejudge` in batch mode, then shows a toast "Queued for rejudge" and closes. No progress UI per design.

**Step 1: Implement dialog + button**

**Step 2: Commit**

```bash
git commit -m "feat(web): rejudge dialog on problem admin page"
```

---

### Task 11: Rejudge button on submission detail page (single)

**Files:**

- Identify the submission detail page. If none exists as a standalone page, the existing submission modal from the submissions list works — search for `SubmissionDetail` / `SubmissionModal` components.
- Add a button visible only when `canOperateOnSubmission(actor, submission)` — check via a server-side flag passed to the component.

`POST /api/rejudge` with `{ mode: "single", submissionId }`. Toast + refresh.

**Step 2: Commit**

```bash
git commit -m "feat(web): single-submission rejudge button"
```

---

## Phase 3 — Score Override data model + domain

### Task 12: Add `ScoreOverride` + `ScoreOverrideAuditLog` schemas

**Files:**

- Modify: `packages/db/prisma/schema/submission.prisma` (or a new `override.prisma`) — add both models + enums
- Create: migration

```prisma
enum OverrideContextType { assignment exam contest }
enum ScoreOverrideAction { create update delete }

model ScoreOverride {
  id              String              @id @default(cuid())
  userId          String
  problemId       String
  contextType     OverrideContextType
  contextId       String
  overrideScore   Int
  reason          String              @db.Text
  createdByUserId String
  updatedByUserId String
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  user      User    @relation("ScoreOverrideUser", fields: [userId], references: [id], onDelete: Cascade)
  problem   Problem @relation(fields: [problemId], references: [id], onDelete: Cascade)
  createdBy User?   @relation("ScoreOverrideCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)
  updatedBy User?   @relation("ScoreOverrideEditor", fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@unique([userId, problemId, contextType, contextId])
  @@index([contextType, contextId])
}

model ScoreOverrideAuditLog {
  id              String              @id @default(cuid())
  overrideId      String?
  userId          String
  problemId       String
  contextType     OverrideContextType
  contextId       String
  action          ScoreOverrideAction
  oldScore        Int?
  newScore        Int?
  oldReason       String?
  newReason       String?
  changedByUserId String?
  createdAt       DateTime            @default(now())

  override  ScoreOverride? @relation(fields: [overrideId], references: [id], onDelete: SetNull)
  changedBy User?          @relation(fields: [changedByUserId], references: [id], onDelete: SetNull)

  @@index([contextType, contextId, createdAt(sort: Desc)])
  @@index([userId, problemId, createdAt(sort: Desc)])
}
```

Add back-relations on `User` and `Problem` (5 total).

**Step 2: Migration + generate + push**

```bash
pnpm db:generate && pnpm db:push
git commit -m "feat(db): ScoreOverride + audit log"
```

---

### Task 13: Repository

**Files:**

- Create: `packages/db/src/repositories/score-override.ts`
- Modify: `packages/db/src/repositories/index.ts`

CRUD + `listByContext(contextType, contextId)`. Patterns match `notification.ts` / `announcement.ts`.

Commit `feat(db): score override repository`.

---

### Task 14: Domain module with audited write-through

**Files:**

- Create: `packages/application/src/score-override/index.ts`
- Create: `packages/application/src/score-override/authz.ts`
- Modify: `packages/application/src/index.ts` (barrel)
- Test: `tests/unit/domain/score-override.test.ts`

**Step 1: Failing tests** for create/update/delete each writing an audit row.

**Step 2: Implement**

All three mutations wrap in `prisma.$transaction(async (tx) => { ... })`:

- `create`: write `ScoreOverride`, then `ScoreOverrideAuditLog` with `action: create`, `oldScore: null`, `newScore: overrideScore`, `oldReason: null`, `newReason: reason`.
- `update`: read current row, write audit with old/new pair, update row.
- `delete`: read current row, write audit, delete row.

Authz helper `canSetScoreOverride(actor, contextType, contextId)` — same matrix as `canOperateOnSubmission` except no practice branch.

**Step 3: Commit**

```bash
git commit -m "feat(domain): score override with audit log"
```

---

### Task 15: `resolveFinalScore` integration

**Files:**

- Modify: `packages/application/src/submission/scoring.ts`
- Modify: every reader — class stats aggregation, ICPC/IOI scoreboard builders, exam submissions matrix, per-student assessment grade view

**Step 1: Add the helper**

```ts
export async function resolveFinalScore(
  userId: string,
  problemId: string,
  context: { contextType: OverrideContextType; contextId: string },
) {
  const override = await scoreOverrideRepo.findUnique({
    userId,
    problemId,
    contextType: context.contextType,
    contextId: context.contextId,
  });
  if (override) return { score: override.overrideScore, source: "override" as const };
  const best = await submissionRepo.findBestScore(userId, problemId, context);
  return { score: best?.score ?? 0, source: "submission" as const };
}
```

**Step 2: Route all readers through it**

Grep for `findBestScore` and scoreboard aggregation; wherever the final per-problem score is computed for a student in an assignment/exam/contest context, replace direct best-score reads with `resolveFinalScore`.

Expected surfaces (confirm by grep):

- `packages/application/src/scoring/point-sum.ts`
- `packages/application/src/scoring/problem-count.ts`
- `packages/application/src/scoring/scoreboard-builder.ts`
- `packages/application/src/course/progress.ts` (class stats)
- `packages/application/src/exam/queries.ts` (submissions matrix)

**Step 3: On override mutation, invalidate scoreboards**

`create`/`update`/`delete` should, after commit, enqueue:

- `contest` → `updateScoreboard(contestId)` via existing activity
- `exam` → equivalent updater if exists, else direct Redis write
- `assignment` → touch class-stats cache if cached; otherwise no-op (reads recompute live)

**Step 4: Commit**

```bash
git commit -m "feat(domain): resolveFinalScore routes override over submission"
```

---

### Task 16: API routes

**Files:**

- Create: `apps/web/src/routes/api/overrides/+server.ts` (GET list, POST create)
- Create: `apps/web/src/routes/api/overrides/[id]/+server.ts` (PATCH, DELETE)

Zod schemas:

```ts
const createSchema = z.object({
  userId: z.string().min(1),
  problemId: z.string().min(1),
  contextType: z.enum(["assignment", "exam", "contest"]),
  contextId: z.string().min(1),
  overrideScore: z.number().int().min(0),
  reason: z.string().min(1).max(500),
});
const patchSchema = z.object({
  overrideScore: z.number().int().min(0).optional(),
  reason: z.string().min(1).max(500).optional(),
});
```

All routes: `requireAuth` + `canSetScoreOverride` check + `consumeFormRateLimit`.

Commit `feat(web): score override API routes`.

---

## Phase 4 — Score Override UI

### Task 17: Staff drawer on manage pages

**Files:**

- Create: `apps/web/src/lib/components/score-override/ScoreOverrideDrawer.svelte`
- Create: `apps/web/src/lib/components/score-override/ScoreOverrideForm.svelte`
- Create: `apps/web/src/lib/components/score-override/ScoreOverrideList.svelte`
- Mount on:
  - `apps/web/src/routes/(app)/assignments/[assessmentId]/+page.svelte` (staff-only section)
  - `apps/web/src/routes/(app)/exams/[examId]/+page.svelte` (staff-only section)
  - `apps/web/src/routes/(app)/contests/[contestId]/+page.svelte` (staff-only section)

Drawer opens from a "Manage grade overrides" button visible only when the actor has `canSetScoreOverride` permission for that context. Form fields per design. List shows existing overrides with edit + delete actions.

Commit `feat(web): score override staff drawer`.

---

### Task 18: Student "adjusted" marker

**Files:**

- Modify: the student-facing assignment/exam/contest detail page row renderers where a per-problem score shows

Add a small icon + i18n-tooltip when `source === "override"` on the returned final score. No reason shown.

Commit `feat(web): student-facing override marker`.

---

### Task 19: i18n keys

**Files:**

- Modify: `apps/web/messages/en.json`, `zh-TW.json`

Add (paraglide key → English → zh-TW):

```
override_staff_title              "Score Overrides"                 "成績人工調整"
override_staff_addBtn             "New Override"                    "新增調整"
override_staff_editBtn            "Edit"                            "編輯"
override_staff_deleteBtn          "Delete"                          "刪除"
override_staff_fieldStudent       "Student"                         "學生"
override_staff_fieldProblem       "Problem"                         "題目"
override_staff_fieldScore         "Score"                           "分數"
override_staff_fieldReason        "Reason (staff-only)"             "原因（僅 staff 可見）"
override_staff_reasonMinError     "Reason is required"              "必須填寫原因"

override_student_marker           "This score has been manually adjusted by a teacher."   "此分數已由老師人工調整"

rejudge_dialog_title              "Rejudge submissions"             "重新判分"
rejudge_dialog_filterCtx          "Filter by context (optional)"    "依範圍篩選（選填）"
rejudge_dialog_submitBtn          "Queue rejudge"                   "送出重判"
rejudge_single_button             "Rejudge this submission"         "重判此提交"
rejudge_toast_queued              "{count} submissions queued"      "已送出 {count} 筆重判"
```

Compile paraglide: `pnpm --filter @nojv/web exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`

Commit `i18n: rejudge + override strings`.

---

## Final Verification

```bash
pnpm -w typecheck          # 17/17 green
pnpm lint                  # 18/18 green
pnpm -w format             # clean
pnpm test:unit             # new authz + override tests green
pnpm test:integration      # rejudge round-trip + override-scoreboard green
```

Manual smoke:

1. As admin: rejudge a submission in single mode → verify `SubmissionRejudgeLog` has a new row, score updated.
2. As course teacher: open assignment, add override 80 for a student, reason "test" → student-side marker appears; scoreboard reflects 80.
3. Edit override → audit log has a row with `action = update`, `oldScore`/`newScore` set.
4. Delete override → audit log has `action = delete`, student sees submission-based score again.
5. As problem author (non-admin, non-course-staff): try to rejudge a submission that's in an assignment → 403.

---

## Notes for the Implementer

- Do NOT add a `RejudgeRun` aggregate table / progress UI / cancellation. Fire-and-forget per design.
- Override is scoped to assignment/exam/contest only. Practice overrides are explicitly out of scope.
- Reason is always required on create/update. Do not loosen to "optional with default string".
- Student never sees the reason — make sure `/api/overrides` never returns `reason` to non-staff callers. Easiest: separate projection helpers `projectForStaff` / `projectForStudent`.
- If scoreboard invalidation turns out to be expensive, ship with a simple "re-run updateScoreboard" call; ring-fence optimizations for a later pass.
- For the rejudge authz batch case ("bare problemId"): the Q&A in the design memo gives problem authors rejudge rights only in practice context — respect that even when they batch-rejudge their own problem.

---

## Related

- Design: `docs/plans/active/2026-04-19-rejudge-and-score-override-design.md`
- Memory: submission operation permission rule (`.claude/projects/.../memory/project_submission_permission_rule.md`)
