# Grading Feedback + Audit Viewer + Quality Batch — Design

- **Date**: 2026-05-20
- **Status**: Design approved, pending implementation plan
- **Scope**: Four independent work areas batched into one branch

## Motivation

A functional/UX/tech audit (3 parallel Explore agents, 2026-05-20)
surfaced gaps. After filtering out "public CP platform" features that
are non-goals for this classroom-focused judge, four items were
selected for this batch:

1. **Grading feedback** — teachers can override scores but cannot
   leave a student-visible comment explaining the grade. Core gap for
   a teaching tool.
2. **Audit viewer** — `AssessmentAuditLog` / `ScoreOverrideAuditLog` /
   `SubmissionRejudgeLog` exist in the schema but no UI surfaces them.
3. **Tech optimizations** — four findings worth doing at classroom
   scale (offset-pagination etc. deliberately excluded as premature).
4. **UX polish** — empty-account dashboard, i18n holes, date locale,
   loading states.

## Part 1 — Grading Feedback + Score-Override Time Gate

### Unifying model

Grading is a **post-close activity**. Once an assignment/exam/contest
ends, course staff open the matrix, pick a cell, and may (a) set/edit a
score override with a staff-internal `reason`, (b) write a
student-visible `feedback` comment. Both are gated to post-close.

`ScoreOverride` is already keyed by `(userId, problemId, contextType,
contextId)` — the same `(student × problem × context)` granularity
chosen for feedback. Feedback is a **separate table**, not a column on
`ScoreOverride`: a teacher must be able to comment on an
already-full-score cell without creating an override.

### Data model — new `SubmissionFeedback` (`schema/submission.prisma`)

```prisma
model SubmissionFeedback {
  id                 String   @id @default(cuid())
  studentUserId      String
  problemId          String
  courseAssessmentId String?   // exactly one of these two is non-null
  examId             String?
  comment            String   @db.Text
  authorUserId       String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  student   User             @relation("SubmissionFeedbackStudent", fields: [studentUserId], references: [id], onDelete: Cascade)
  problem   Problem          @relation(fields: [problemId], references: [id], onDelete: Cascade)
  assessment CourseAssessment? @relation(fields: [courseAssessmentId], references: [id], onDelete: Cascade)
  exam      Exam?            @relation(fields: [examId], references: [id], onDelete: Cascade)
  author    User?            @relation("SubmissionFeedbackAuthor", fields: [authorUserId], references: [id], onDelete: SetNull)

  @@unique([courseAssessmentId, problemId, studentUserId])
  @@unique([examId, problemId, studentUserId])
  @@index([courseAssessmentId])
  @@index([examId])
}
```

- Dual nullable FK (assignment + exam; **no contest** — contest has
  no feedback). Migration adds a `CHECK` constraint enforcing exactly
  one of `courseAssessmentId` / `examId` is non-null.
- Postgres treats `NULL` as distinct in unique indexes, so the two
  `@@unique` lines act as partial-unique per context.

### Domain — new `packages/domain/src/feedback/`

Mirrors the existing `score-override/` module structure.

- `types.ts` — `FeedbackContext` discriminated union:
  `{ type: "assignment"; assignmentId } | { type: "exam"; examId }`.
  `to/fromContextDbFields` translate at the repo boundary.
- `mutations.ts` — `upsertFeedback` (upsert on the unique triple),
  `deleteFeedback`.
- `queries.ts` — `listFeedbackForContext` (staff), `getFeedbackForStudent`
  (student-facing; returns nothing until the context has closed).
- `permissions.ts` — write requires course teacher/TA or platform admin.

New repo `packages/db/src/repositories/submission-feedback.ts`.

### Score-override time gate

Change `score-override/permissions.ts`:

- New `assertContextClosed(context)` — reads the context's close time
  (`CourseAssessment.closesAt`, `Exam` end, `Contest.endsAt`) and
  throws `ConflictError` when `now < closeTime`.
- Wired into `assertCanSetScoreOverride` so it covers
  `createOverride` / `updateOverride` / `deleteOverride`.
- Applies to **assignment + exam + contest**.
- `platformRole === "admin"` bypasses the gate (emergency fixes).
- The same `assertContextClosed` guards `upsertFeedback` /
  `deleteFeedback`.

This is a **behavior change to the existing override feature** — the
current `canSetScoreOverride` checks role only, with no time gate.

### UI — grading drawer

Extend the existing `ScoreOverrideDrawer` into a "Grading" drawer:

- Two sections: **Score Override** (existing) + **Student Feedback**
  (new). For `contest` context the feedback section is omitted.
- New components `FeedbackList.svelte` + `FeedbackForm.svelte` mirror
  the override components (reuse student/problem dropdowns).
- New API route `/api/feedback` (GET list / PUT upsert / DELETE),
  shaped like `/api/overrides`.
- The drawer entry button is **hidden until the context has closed**;
  before close the manage page shows a one-line "grading available
  after close" note.

### UI — student-facing feedback

- assignment-detail / exam-detail pages: per-problem row shows that
  student's feedback for that problem (when present).
- submission detail page: shows feedback for the same problem.
- Read-only, via `getFeedbackForStudent` (already close-gated).

## Part 2 — Audit Timeline Tab

A read-only viewer over **existing** audit tables. No new audit tables
(e.g. `PlagiarismTriggerLog` is explicitly out of scope).

- New "Audit" tab on the assignment / exam / contest manage pages.
- New `AuditTimeline.svelte` — reverse-chronological merged timeline;
  each row = timestamp + actor + action + detail (score `old→new`,
  rejudge verdict change, lifecycle event).
- New domain query `listAuditTimelineForContext(context)` merges and
  sorts:
  - assignment: `AssessmentAuditLog` (lifecycle) +
    `ScoreOverrideAuditLog` + `SubmissionRejudgeLog`
  - exam / contest: `ScoreOverrideAuditLog` + `SubmissionRejudgeLog`
    (no lifecycle audit log exists for those)
- `SubmissionRejudgeLog` is keyed by `submissionId` → query the
  context's submissions first, then join their logs.
- Permission: course teacher/TA + platform admin.

## Part 3 — Tech Optimizations

- **C1 — search double query.** `listProblemCards`
  (`packages/domain/src/problem/queries.ts:249`) runs `fullTextSearch`
  AND `likeSearch` in parallel every search. Make `likeSearch` a real
  fallback: run it only when `fullTextSearch` returns zero rows. Fix
  the misleading "fallback" comment.
- **C2 — large component split.** `exams/[examId]/+page.svelte` (719
  lines) and `assignments/[assignmentId]/+page.svelte` (562 lines):
  extract each tab into a child component. Done **together with the
  Part 2 Audit tab** so the new tab lands cleanly.
- **C3 — admin dashboard cache.** `getAdminDashboard` runs 12
  aggregations per load. Wrap in a Redis 5-minute TTL cache via the
  existing `@nojv/redis` cache module.
- **C4 — duplicate repo methods.** `contestRepo.listPublished()` and
  `listParticipable()` run identical queries — consolidate to one.

**Deliberately excluded** (premature at classroom scale): offset →
cursor pagination, unbounded cross-course assignment fetch.

## Part 4 — UX Polish

- **D1 — empty-account dashboard.** When the user has zero
  submissions, conditionally render a welcome/onboarding card (CTAs to
  `/problems`, `/courses`) instead of five empty charts.
- **D2 — i18n holes.** Extract to Paraglide messages (en + zh-TW):
  `JudgeTab` language dropdown, `EditorBottomPanel` "Case N", admin
  role names, `PointSumCell` / `SolveCountCell` pending/try, dialog
  "Close".
- **D3 — date/time.** New shared `formatDateTime` helper bound to
  Paraglide `getLocale()`, with a timezone abbreviation on absolute
  times. Sweep out bare `toLocaleString()` calls. No user timezone
  preference setting (YAGNI).
- **D4 — loading states.** New `Skeleton` primitive; used by the
  grading drawer's on-open fetch and the dashboard analytics via
  SvelteKit `{#await}` deferred load. List pages keep relying on SSR —
  no dedicated skeletons there.

**Deliberately not done**: a confirm dialog on the editor's local
testcase delete — that data is unsaved client-side state; a confirm
dialog there is over-design.

## Build Sequence

1. Part 1 data + domain (schema, migration, `feedback/` module,
   override time gate) — most other work depends on none of it but it
   is the riskiest, so land first.
2. Part 1 + Part 2 UI together (both touch the manage pages; do the
   C2 component split here so the audit tab and grading drawer land in
   already-split files).
3. Part 3 C1 / C3 / C4 — independent, small.
4. Part 4 D1–D4 — independent, frontend-only.
5. Doc sync: `PRODUCT_SENSE.md` (Shipped Scope), `FRONTEND.md` (routes
   - components), the relevant `docs/specs/*.md`, `QUALITY_SCORE.md`
     ledger entry. Move this design doc to `docs/plans/completed/`.

## Testing

- Domain unit tests: `feedback` mutations/queries/permissions, the
  override time gate (open vs closed context, admin bypass),
  `listAuditTimelineForContext` merge/sort.
- Integration tests: `/api/feedback` route, close-gate 409 on override
  before close.
- Regression: existing score-override tests must still pass with the
  new gate (fixtures may need a closed context).

## Verification

`pnpm -w typecheck`, `pnpm lint`, `pnpm -w format`, `pnpm test:unit`,
`pnpm test:integration` all green before merge.
