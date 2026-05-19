# Grading Feedback + Audit Viewer + Quality Batch — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add teacher grading feedback + a post-close time gate on score
overrides, a read-only audit timeline tab, four tech optimizations, and
four UX polish items.

**Architecture:** Feedback is a new `SubmissionFeedback` table + a
`packages/domain/src/feedback/` module mirroring the existing
`score-override/` module. The audit tab is a read-only domain query
merging three existing audit tables. Optimizations and UX polish are
independent, surgical changes.

**Tech Stack:** SvelteKit, Prisma 7 / PostgreSQL 18, `@nojv/domain`,
`@nojv/db`, `@nojv/core` (Zod), `@nojv/redis`, Paraglide i18n, Vitest.

**Design doc:** `docs/plans/active/2026-05-20-grading-feedback-audit-batch-design.md`

**General rules:**
- TDD: failing test first, minimal implementation, green, commit.
- After editing `apps/web/messages/*.json`, run
  `pnpm --filter @nojv/web paraglide:compile`.
- After editing `packages/db/prisma/schema/*.prisma`, run `pnpm db:generate`.
- Verify suspected-current code by reading it before editing — the
  detail in this plan was gathered by survey and may have drifted.
- Commit after every task. Branch is already `feat/grading-feedback-audit-batch`.

---

## Part 1 — Grading Feedback + Score-Override Time Gate

### Task 1.1: `SubmissionFeedback` schema + migration

**Files:**
- Modify: `packages/db/prisma/schema/submission.prisma`
- Modify: `packages/db/prisma/schema/auth.prisma` (User relations)
- Modify: `packages/db/prisma/schema/problem.prisma` (Problem relation)
- Modify: `packages/db/prisma/schema/course.prisma` (CourseAssessment relation)
- Modify: `packages/db/prisma/schema/contest.prisma` (Exam relation)
- Create: `packages/db/prisma/migrations/<timestamp>_add_submission_feedback/migration.sql`

**Step 1:** Add the model to `submission.prisma`:

```prisma
model SubmissionFeedback {
  id                 String            @id @default(cuid())
  studentUserId      String
  problemId          String
  courseAssessmentId String?
  examId             String?
  comment            String            @db.Text
  authorUserId       String?
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  student    User              @relation("SubmissionFeedbackStudent", fields: [studentUserId], references: [id], onDelete: Cascade)
  problem    Problem           @relation("SubmissionFeedbackProblem", fields: [problemId], references: [id], onDelete: Cascade)
  assessment CourseAssessment? @relation(fields: [courseAssessmentId], references: [id], onDelete: Cascade)
  exam       Exam?             @relation(fields: [examId], references: [id], onDelete: Cascade)
  author     User?             @relation("SubmissionFeedbackAuthor", fields: [authorUserId], references: [id], onDelete: SetNull)

  @@unique([courseAssessmentId, problemId, studentUserId])
  @@unique([examId, problemId, studentUserId])
  @@index([courseAssessmentId])
  @@index([examId])
}
```

**Step 2:** Add the inverse relation fields on `User` (two — student
and author), `Problem`, `CourseAssessment`, `Exam`. Match the relation
names above. Read each model first to place the field consistently
with neighbours.

**Step 3:** Run `pnpm db:generate`. Expected: success, `SubmissionFeedback`
in the generated client.

**Step 4:** Create the migration. Use `pnpm db:migrate` to generate the
SQL skeleton, then append the CHECK constraint (mirror
`20260416180001_submission_single_context_check`):

```sql
ALTER TABLE "SubmissionFeedback"
  ADD CONSTRAINT "SubmissionFeedback_single_context_chk"
  CHECK (
    (("courseAssessmentId" IS NOT NULL)::int +
     ("examId" IS NOT NULL)::int) = 1
  );
```

**Step 5:** Run `pnpm db:push` against a dev DB; confirm no error.

**Step 6:** Commit — `feat(db): add SubmissionFeedback table`.

---

### Task 1.2: `submissionFeedbackRepo`

**Files:**
- Create: `packages/db/src/repositories/submission-feedback.ts`
- Modify: `packages/db/src/repositories/index.ts` (export it)

Mirror `score-override.ts`. Methods:
- `upsert(tx, data)` — upsert on whichever unique triple is active.
  Because the unique key differs by context, branch on
  `courseAssessmentId` vs `examId` and use Prisma's compound `where`.
- `findForContext(courseAssessmentId | examId)` → rows + `student` +
  `problem` includes.
- `findForStudentInContext(studentUserId, courseAssessmentId | examId)`.
- `deleteById(tx, id)`.

**Test:** none at repo layer (consistent with `score-override.ts`,
which has no repo test) — covered by domain tests in Task 1.3.

**Commit** — `feat(db): add submissionFeedbackRepo`.

---

### Task 1.3: `@nojv/core` feedback schemas

**Files:**
- Create: `packages/core/src/schemas/feedback.ts`
- Modify: `packages/core/src/index.ts` (or schema barrel — check how
  `editorial.ts` is exported, mirror it)

```ts
import { z } from "zod";

export const feedbackUpsertSchema = z.object({
  studentUserId: z.string().min(1),
  problemId: z.string().min(1),
  comment: z.string().trim().min(1).max(2000),
});

export type FeedbackUpsertInput = z.infer<typeof feedbackUpsertSchema>;
```

**Commit** — `feat(core): add feedback schemas`.

---

### Task 1.4: `feedback` domain module

**Files:**
- Create: `packages/domain/src/feedback/types.ts`
- Create: `packages/domain/src/feedback/permissions.ts`
- Create: `packages/domain/src/feedback/mutations.ts`
- Create: `packages/domain/src/feedback/queries.ts`
- Create: `packages/domain/src/feedback/index.ts`
- Modify: `packages/domain/src/index.ts` (`export * as feedbackDomain from "./feedback";`)
- Test: `tests/unit/domain/feedback.test.ts`

**Step 1 — `types.ts`:** mirror `score-override/types.ts` but only two
members:

```ts
export type FeedbackContext =
  | { type: "assignment"; assignmentId: string }
  | { type: "exam"; examId: string };
```

Provide `toContextDbFields` / `fromContextDbFields` returning
`{ courseAssessmentId?: string; examId?: string }`.

**Step 2 — `permissions.ts`:** `assertCanWriteFeedback(actor, context)`
— mirror `score-override/permissions.ts` `canSetScoreOverride` for the
assignment + exam branches (course teacher/TA via `Course`, or platform
admin). Reuse the `isCourseTeacherOrTa` helper pattern.

**Step 3 — write failing tests** in `tests/unit/domain/feedback.test.ts`:
- `upsertFeedback` creates then updates the same `(student, problem,
  context)` triple (one row, not two).
- `upsertFeedback` rejects a non-staff actor with `ForbiddenError`.
- `getFeedbackForStudent` returns nothing while the context is open,
  rows once closed.

Mirror fixture style from `tests/unit/domain/score-override*.test.ts`.

**Step 4 — `mutations.ts`:** `upsertFeedback(actor, { context, input })`
and `deleteFeedback(actor, id)`. Both call
`assertCanWriteFeedback` then `assertContextClosed` (the shared helper
built in Task 1.5 — import it). Set `authorUserId = actor.userId`.

**Step 5 — `queries.ts`:** `listFeedbackForContext(context)` (staff,
all rows) and `getFeedbackForStudent(studentUserId, context)` —
returns `[]` (or `null`) unless `isContextClosed(context)` is true.

**Step 6:** Run `pnpm exec vitest run tests/unit/domain/feedback.test.ts`.
Expected: PASS.

**Commit** — `feat(domain): add feedback module`.

---

### Task 1.5: Score-override post-close time gate

**Files:**
- Create: `packages/domain/src/shared/context-window.ts`
- Modify: `packages/domain/src/score-override/permissions.ts`
- Modify: `packages/domain/src/score-override/mutations.ts` (if the
  gate is enforced in mutations rather than permissions — see Step 2)
- Test: `tests/unit/domain/context-window.test.ts`
- Test: existing `tests/unit/domain/score-override*.test.ts` (fixtures)

**Step 1 — write failing test** for `context-window.ts`:
- `isContextClosed` true when `now > closesAt` (assignment) /
  `endsAt` (exam, contest), false otherwise.
- `assertContextClosed` throws `ConflictError` on an open context.

**Step 2 — implement `context-window.ts`:**

```ts
// isContextClosed / assertContextClosed accept a context union that
// covers assignment | exam | contest (superset of FeedbackContext).
// Reads CourseAssessment.closesAt, Exam.endsAt, Contest.endsAt.
// Throws ConflictError("Grading is only available after the
// assignment/exam/contest has closed.") when still open.
```

Take a `{ type, id }`-style discriminated union covering all three
contexts so both `score-override` and `feedback` can call it. Confirm
field names by reading the schema (`CourseAssessment.closesAt`,
`Exam.endsAt`, `Contest.endsAt`).

**Step 3 — wire into score-override:** in `assertCanSetScoreOverride`
(or at the top of each of `createOverride` / `updateOverride` /
`deleteOverride` in `mutations.ts`), after the role check, call
`assertContextClosed`. Skip the gate when `actor.platformRole ===
"admin"`. Decide placement by reading the current code: if the admin
bypass already lives in `canSetScoreOverride`, gate inside
`assertCanSetScoreOverride` after a non-admin passes the role check.

**Step 4 — fix existing override tests:** the new gate will fail tests
that override scores on an open context. Update those fixtures to use
a closed context (`closesAt`/`endsAt` in the past), or add an explicit
"override blocked while open" test and adjust the rest.

**Step 5:** Run `pnpm exec vitest run tests/unit/domain/`. Expected: PASS.

**Commit** — `feat(domain): gate score overrides + feedback to post-close`.

---

### Task 1.6: `/api/feedback` route

**Files:**
- Create: `apps/web/src/routes/api/feedback/+server.ts`
- Create: `apps/web/src/routes/api/feedback/[id]/+server.ts`
- Test: `tests/integration/` (mirror the `/api/overrides` integration
  test if one exists; else add `tests/integration/api/feedback.test.ts`)

Mirror `apps/web/src/routes/api/overrides/+server.ts`:
- `GET` (`apiHandler`) — query `?type=assignment&assignmentId=…` or
  `?type=exam&examId=…`; returns `{ items }`.
- `PUT` (`writeApiHandler`) — body `{ context, ...feedbackUpsertSchema }`;
  calls `feedbackDomain.upsertFeedback`.
- `[id]/DELETE` (`writeApiHandler`) — `feedbackDomain.deleteFeedback`.
- Auth via `requireApiAuth(event)`.

**Test:** PUT on an open context returns 409; on a closed context
returns 200 and the row is readable via GET.

**Commit** — `feat(web): add /api/feedback route`.

---

### Task 1.7: Grading drawer UI

**Files:**
- Create: `apps/web/src/lib/components/features/score-override/FeedbackList.svelte`
- Create: `apps/web/src/lib/components/features/score-override/FeedbackForm.svelte`
- Modify: `apps/web/src/lib/components/features/score-override/ScoreOverrideDrawer.svelte`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/zh-TW.json`

**Step 1:** Add `m.feedback_staff_*` message keys (section title, empty
list, comment label, save/delete, "grading available after close"
note). Run `pnpm --filter @nojv/web paraglide:compile`.

**Step 2:** `FeedbackList.svelte` + `FeedbackForm.svelte` — mirror
`ScoreOverrideList.svelte` / `ScoreOverrideForm.svelte`. Form fields:
student dropdown, problem dropdown, comment textarea. Submits to
`PUT /api/feedback`; delete via `DELETE /api/feedback/[id]`.

**Step 3:** In `ScoreOverrideDrawer.svelte`, add a second `<section>`
below the override section rendering `FeedbackList` + `FeedbackForm`.
Render the feedback section only when `contextType !== "contest"`.
Update `Dialog.Title` to a grading-oriented label.

**Step 4:** In the three manage pages
(`assignments|exams|contests/[id]/+page.svelte`), hide the drawer entry
button until the context is closed; when open, show a one-line note.
Compute closed state from the close-time field already in `data`.

**Step 5:** Manual check via `pnpm dev` — closed context shows the
button, drawer shows both sections; open context hides it.

**Commit** — `feat(web): grading drawer with feedback section`.

---

### Task 1.8: Student-facing feedback display

**Files:**
- Modify: `apps/web/src/routes/(app)/assignments/[assignmentId]/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/exams/[examId]/+page.server.ts`
- Modify: submission detail loader
  (`apps/web/src/routes/(app)/submissions/[submissionId]/+page.server.ts`)
- Modify: the corresponding `+page.svelte` files + per-problem components

**Step 1:** In each student-mode loader, call
`feedbackDomain.getFeedbackForStudent(actor.userId, context)` and add
the result to the returned data.

**Step 2:** In the per-problem UI (assignment-detail / exam-detail
student view, and submission detail), render the feedback comment when
present, labelled with `m.feedback_student_label()`.

**Step 3:** Manual check — student sees feedback only after the
context closes.

**Commit** — `feat(web): show grading feedback to students`.

---

## Part 2 — Audit Timeline Tab

### Task 2.1: `listAuditTimelineForContext` domain query

**Files:**
- Create: `packages/domain/src/audit/queries.ts`
- Create: `packages/domain/src/audit/index.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/db/src/repositories/submission-rejudge-log.ts` (add
  a `listForSubmissionIds(ids)` method if absent)
- Test: `tests/unit/domain/audit-timeline.test.ts`

**Step 1 — write failing test:** `listAuditTimelineForContext` for an
assignment returns a single reverse-chronological array merging a
lifecycle event, a score-override audit event, and a rejudge event.

**Step 2 — implement.** Define a normalized `AuditEvent` union:

```ts
type AuditEvent = {
  at: Date;
  actorUserId: string | null;
  kind: "lifecycle" | "score_override" | "rejudge";
  detail: Record<string, unknown>; // kind-specific
};
```

Fetch per context:
- assignment: `assessmentAuditLogRepo.listForAssessment` +
  `scoreOverrideAuditLogRepo.listForContext("assignment", id)` +
  rejudge logs for the assignment's submissions.
- exam / contest: score-override audit + rejudge logs only.

For rejudge logs: query the context's submission IDs first
(`submissionRepo`), then `listForSubmissionIds`. Merge all, sort by
`at` descending.

**Step 3:** Run `pnpm exec vitest run tests/unit/domain/audit-timeline.test.ts`.
Expected: PASS.

**Commit** — `feat(domain): add audit timeline query`.

---

### Task 2.2: `AuditTimeline.svelte`

**Files:**
- Create: `apps/web/src/lib/components/features/audit/AuditTimeline.svelte`
- Modify: `apps/web/messages/en.json`, `zh-TW.json`

Read-only vertical timeline. Each row: timestamp (via the new
`formatDateTime` helper from Task 4.3 — if Part 4 not yet done, use
a plain locale format and revisit), actor name, a kind badge, and a
human detail line (`score 60 → 80`, `verdict WA → AC`, `published`).
Add `m.audit_*` keys. Run `paraglide:compile`.

**Commit** — `feat(web): add AuditTimeline component`.

---

### Task 2.3: Audit tab + manage-page component split (C2)

**Files:**
- Modify: `apps/web/src/routes/(app)/assignments/[assignmentId]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/exams/[examId]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/contests/[contestId]/+page.svelte`
- Modify: the three matching `+page.server.ts`
- Create: extracted tab child components as needed

**Step 1 — split (C2):** The exam page (~719 lines) and assignment
page (~562 lines) inline every tab body. Extract each remaining inline
tab block into a child component under
`apps/web/src/lib/components/features/{exam,assignment}/tabs/` (follow
the existing `AssignmentSettingsTab` / `AssignmentProblemsTab`
precedent). Do NOT change behaviour — pure extraction. Verify with
`pnpm --filter @nojv/web check`.

**Step 2 — add the Audit tab:** add `"audit"` to the `SubTabKey` union
and `subTabs` array (staff-only) in all three pages; render
`<AuditTimeline>` for it.

**Step 3 — load data:** in each `+page.server.ts` staff branch, add
`auditDomain.listAuditTimelineForContext(context)` to the parallel
`Promise.all`.

**Step 4:** `pnpm --filter @nojv/web check` → 0 errors. Manual check —
audit tab shows merged events for each context type.

**Commit** — `feat(web): audit tab + manage-page tab extraction`.

---

## Part 3 — Tech Optimizations

### Task 3.1: Search fallback (C1)

**Files:**
- Modify: `packages/domain/src/problem/queries.ts` (~line 247-258)
- Test: `tests/unit/domain/` (problem-queries test if present)

`listProblemCards` currently runs `fullTextSearch` and `likeSearch` in
a single `Promise.all`. Change to: run `fullTextSearch` first; only if
it returns zero rows, run `likeSearch`. Fix the comment to say
"fallback" accurately.

**Test:** if a problem-queries test exists, add a case asserting
`likeSearch` is not consulted when FTS has hits (spy/mock). If no such
test harness exists, skip the test and rely on `check` + manual.

**Commit** — `perf(domain): make problem search LIKE a true fallback`.

---

### Task 3.2: Admin dashboard Redis cache (C3)

**Files:**
- Modify: `packages/redis/src/keys.ts` (add `adminDashboard` key)
- Modify: `packages/domain/src/admin/index.ts`

**Note:** `@nojv/redis` exposes no generic cache module — use
`getRedis()` directly.

**Step 1:** Add to `keys`: `adminDashboard: () => "nojv:cache:admin-dashboard"`.

**Step 2:** In `getAdminDashboard`, before the 12 queries:
`GET` the key; if present, `JSON.parse` and return. After computing,
`SET` with `EX` 300 (`redis.set(key, JSON.stringify(result), "EX", 300)`).
Wrap cache reads/writes in try/catch so a Redis hiccup falls through
to a live computation (mirror the best-effort pattern in
`score-override/mutations.ts` `invalidateScoreboardForOverride`).

**Step 3:** `pnpm --filter @nojv/domain typecheck`. Manual check — two
quick dashboard loads, second is cache-served.

**Commit** — `perf(domain): cache admin dashboard aggregates (5m TTL)`.

---

### Task 3.3: Merge duplicate contest repo methods (C4)

**Files:**
- Modify: `packages/db/src/repositories/contest.ts` (~line 50-73)
- Modify: `packages/domain/src/contest/queries.ts` (callers)

`listPublished()` and `listParticipable()` are byte-identical. Keep
one (`listPublished`), delete the other, update both call sites in
`contest/queries.ts`.

**Step 1:** Run `pnpm exec vitest run tests/unit/domain/` before — note
the pass count.

**Step 2:** Make the change.

**Step 3:** Run typecheck + the same tests — same pass count, 0 type
errors.

**Commit** — `refactor(db): merge duplicate contest list methods`.

---

## Part 4 — UX Polish

### Task 4.1: Shared `formatDateTime` helper (D3)

**Files:**
- Create: `apps/web/src/lib/utils/datetime.ts`
- Test: `tests/unit/` (if web utils are unit-tested; else skip)

`formatDateTime(value, opts?)` — wraps `Intl.DateTimeFormat` bound to
Paraglide `getLocale()`, appends a timezone short name for absolute
times. Export `formatDate` / `formatTime` variants as needed.

Then sweep bare `toLocaleString()` / `toLocaleDateString()` /
`toLocaleTimeString()` calls (grep `apps/web/src`) onto this helper.
This is a wide but mechanical change — do it in one commit, verify with
`pnpm --filter @nojv/web check`.

**Commit** — `feat(web): locale-bound datetime formatting helper`.

---

### Task 4.2: i18n holes (D2)

**Files:**
- Modify: `apps/web/messages/en.json`, `zh-TW.json`
- Modify: `JudgeTab.svelte`, `EditorBottomPanel.svelte`,
  admin users `FilterBar.svelte` / `UsersTable.svelte`,
  `PointSumCell.svelte`, `SolveCountCell.svelte`,
  `primitives/ui/dialog/dialog-content.svelte`

Extract each hard-coded string identified in the design doc to a
Paraglide key. Programming-language labels: a single
`m.common_language_<id>()` set or a lookup map. Run
`pnpm --filter @nojv/web paraglide:compile`. Verify with `check`.

**Commit** — `i18n(web): extract remaining hard-coded strings`.

---

### Task 4.3: Empty-account dashboard (D1)

**Files:**
- Create: `apps/web/src/lib/components/features/dashboard/WelcomeGuide.svelte`
- Modify: `apps/web/src/routes/(app)/dashboard/+page.svelte`

`WelcomeGuide.svelte` — a single card: welcome line + CTA buttons to
`/problems` and `/courses`. In `+page.svelte`, when the user has zero
submissions (derive from `stats` — confirm the field, e.g.
`stats.totalAttempts === 0`), render `<WelcomeGuide />` instead of the
five chart blocks.

**Commit** — `feat(web): welcome guide for empty-account dashboard`.

---

### Task 4.4: Skeleton primitive + deferred dashboard (D4)

**Files:**
- Create: `apps/web/src/lib/components/primitives/ui/skeleton/skeleton.svelte`
  (+ `index.ts`)
- Modify: `apps/web/src/lib/components/features/score-override/ScoreOverrideDrawer.svelte`
- Modify: `apps/web/src/routes/(app)/dashboard/+page.server.ts` + `+page.svelte`

**Step 1:** `Skeleton.svelte` — a pulsing placeholder block, props for
width/height/class. Match the design system (`DESIGN.md` tokens).

**Step 2:** Use `<Skeleton>` in `ScoreOverrideDrawer` while
`loading` (replacing the current text placeholder), for both the
override and feedback lists.

**Step 3:** In the dashboard loader, return the heavy analytics as an
un-awaited promise (SvelteKit streaming); in `+page.svelte` render the
chart blocks inside `{#await}` with `<Skeleton>` fallbacks. Keep
`WelcomeGuide` (Task 4.3) on the resolved branch.

**Step 4:** `pnpm --filter @nojv/web check` + manual check.

**Commit** — `feat(web): skeleton loading states`.

---

## Final: Verification + Doc Sync

### Task 5.1: Full verification

Run and confirm green:
- `pnpm -w typecheck`
- `pnpm lint`
- `pnpm -w format`
- `pnpm test:unit`
- `pnpm test:integration`

Fix anything red before proceeding.

### Task 5.2: Doc sync

**Files:**
- `docs/product/PRODUCT_SENSE.md` — add grading feedback + audit
  viewer under Shipped Scope; note the override post-close gate.
- `docs/architecture/FRONTEND.md` — `/api/feedback` route, audit tab,
  new components.
- `docs/specs/assignments.md`, `exams.md`, `contests.md` — feedback +
  override-gate behaviour; resolve the relevant open questions.
- `docs/operations/QUALITY_SCORE.md` — ledger entry for this batch.
- `git mv docs/plans/active/2026-05-20-grading-feedback-audit-batch*.md
  docs/plans/completed/`.

**Commit** — `docs: sync for grading feedback + audit batch`.

### Task 5.3: Finish the branch

Use superpowers:finishing-a-development-branch to choose merge / PR.
