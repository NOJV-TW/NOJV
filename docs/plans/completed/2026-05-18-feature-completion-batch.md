# Feature-Completion Batch Implementation Plan

> **For Claude:** Execute wave-by-wave. Verify (`typecheck` + `lint` + `test:unit`) and commit per wave.

**Goal:** Close the open feature gaps surfaced by the 2026-05-18 project review — adjustment-rule editability (A), doc drift (B), six spec-level gaps (D2–D7), and Redis dead-code removal (E).

**Architecture:** Nine independent workstreams sequenced into waves. Wave 0 lands all schema in one migration; the rest are mostly disjoint and verified + committed individually.

**Tech Stack:** SvelteKit, Prisma 7 / PostgreSQL, Zod 4, `@nojv/domain` business layer, Paraglide i18n, Vitest.

**Branch:** `feat/feature-completion-batch-2026-05-18`

---

## Scope decisions (locked 2026-05-18)

- **A** — Make the existing late-penalty rule editable in the assignment **settings tab** (currently only settable at creation). `time_bonus` is **not** exposed (user decision — it is a runtime-performance bonus, out of scope here).
- **D1** (IP whitelist CSV import) — **excluded** by user; not in this batch.
- **D5** — Investigation found the copy-course dialog **already** has an editable title input and the domain already takes a `newTitle` param. D5 reduces to hardening: replace the action's manual string check with a Zod schema. See Wave 7.
- **E** — Delete `cache.ts` + `cooldown.ts`; both are dead (0 call sites).

---

## Wave 0 — Schema foundation

**Goal:** One migration adding the two tables D6 and D7 need.

**Files:**

- Modify: `packages/db/prisma/schema/course.prisma` — add `AssessmentAuditLog` + `enum AssessmentAuditAction`.
- Modify: `packages/db/prisma/schema/submission.prisma` — add `EditorialReport` + `enum EditorialReportStatus`; add back-relation on `Editorial`.
- Create: `packages/db/prisma/migrations/20260518000000_add_assessment_audit_and_editorial_report/migration.sql`

**`AssessmentAuditLog`:**

```prisma
enum AssessmentAuditAction {
  publish
  revert_to_draft
  delete_draft
}

model AssessmentAuditLog {
  id           String                @id @default(cuid())
  assessmentId String                // plain string — row must survive delete_draft
  courseId     String
  actorUserId  String?               // null = system (Temporal auto-publish)
  action       AssessmentAuditAction
  createdAt    DateTime              @default(now())
  course       Course                @relation(fields: [courseId], references: [id], onDelete: Cascade)
  actor        User?                 @relation(fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([assessmentId, createdAt])
  @@index([courseId, createdAt])
}
```

`assessmentId` is intentionally not an FK — `delete_draft` removes the `CourseAssessment` row and the audit entry must outlive it.

**`EditorialReport`:**

```prisma
enum EditorialReportStatus {
  open
  resolved
  dismissed
}

model EditorialReport {
  id               String                @id @default(cuid())
  editorialId      String
  reportedByUserId String
  reason           String                @db.Text
  status           EditorialReportStatus  @default(open)
  resolvedByUserId String?
  resolvedAt       DateTime?
  createdAt        DateTime               @default(now())
  editorial        Editorial              @relation(fields: [editorialId], references: [id], onDelete: Cascade)
  reportedBy       User                   @relation("EditorialReportReporter", fields: [reportedByUserId], references: [id], onDelete: Cascade)
  resolvedBy       User?                  @relation("EditorialReportResolver", fields: [resolvedByUserId], references: [id], onDelete: SetNull)

  @@unique([editorialId, reportedByUserId])  // one report per user per editorial
  @@index([status, createdAt])
}
```

Add the matching back-relations on `Course`, `User`, `Editorial`.

**Verify:** `pnpm db:generate` clean → `pnpm -w typecheck`.

---

## Wave 1 — E: delete Redis dead code

**Files:**

- Delete: `packages/redis/src/cache.ts`, `packages/redis/src/cooldown.ts`
- Modify: `packages/redis/src/index.ts` — drop the two re-export lines.
- Check + modify: `packages/temporal/src/activities/redis.ts` — drop any re-export of cache/cooldown.
- Delete: any `tests/unit/redis/cache*` / `cooldown*` test files.
- Modify: `docs/architecture/REDIS.md` — remove the cache.ts / cooldown.ts paragraphs (≈ lines 21, 25, 80).

**Approach:** `rg 'cacheGet|cacheSet|cacheDel|setCooldown|checkCooldown'` first — confirm 0 non-test, non-self references before deleting.

**Verify:** `pnpm -w typecheck` + `pnpm lint` + `pnpm test:unit`.

---

## Wave 2 — B: doc sync

**Files:**

- Modify: `docs/product/PRODUCT_SENSE.md` — add three Shipped-Scope subsections:
  - **Class Analytics** — `/(app)/courses/[courseId]/analytics`, course-staff gated: per-assessment completion + avg score, hardest problems, at-risk students, verdict distribution.
  - **Virtual Contest** — replay an ended contest on a personal timer; private scoreboard with original final standings as ghost rows.
  - **Upsolve** — post-contest practice index per contest problem with solve status.
- Modify: `docs/architecture/FRONTEND.md` — add the three routes to the route map.
- `git mv docs/plans/active/2026-05-16-analytics-virtual-contest-upsolve.md docs/plans/completed/`
- Modify: `docs/operations/QUALITY_SCORE.md` — add a 2026-05-18 doc-drift entry for this batch.

**Verify:** `pnpm format` (markdown only — no code).

---

## Wave 3 — A: late-penalty editable in settings tab

**Files:**

- Modify: `packages/core/src/schemas/course.ts`
  - `assessmentSettingsFormSchema`: add `latePenalty: adjustmentRuleSchema.nullable().default(null)`.
  - `courseAssessmentUpdateSchema`: add `adjustmentRules: adjustmentRulesSchema.optional()`.
- Modify: `packages/domain/src/course/assignment-detail.ts` — `AssignmentDetail` interface + query return the stored late-penalty rule (extract from `adjustmentRules` JSON; the late-penalty member is the non-`time_bonus` rule). Ensure `assessmentRepo.findById` selects `adjustmentRules`.
- Modify: `packages/domain/src/assignment/mutations.ts` — `updateAssignmentRecord`: when `payload.adjustmentRules !== undefined`, write `updateData.adjustmentRules`. The existing `assertFieldsAllowedForStatus` already blocks all writes on `closed`; no extra lock needed.
- Modify: `apps/web/src/routes/(app)/assignments/[assignmentId]/+page.server.ts`
  - `load`: hydrate `latePenalty` into the `settingsForm` from `detail`.
  - `updateSettings`: read `form.data.latePenalty`, set `payload.adjustmentRules = form.data.latePenalty ? [form.data.latePenalty] : []`.
- Modify: `apps/web/src/lib/components/features/course/assignment/AssignmentSettingsTab.svelte` — render `LatePenaltyRuleBuilder` (existing component) bound to `$form.latePenalty`, disabled when `!editableBasics`. Place inside the "submission" section.

**Tests:** `tests/unit/domain/assignment-mutations.test.ts` — add cases: `updateAssignmentRecord` writes `adjustmentRules`; closed assignment rejects the change.

**Verify:** `pnpm db:generate` not needed (no schema). `typecheck` + `lint` + `test:unit`.

---

## Wave 4 — D2: IpViolationLog retention cap

**Files:**

- Modify: `packages/db/src/repositories/ip-violation.ts` — add `IP_VIOLATION_RETENTION_PER_EXAM = 2000`; after the `withTx(tx).create(...)`, run a `ROW_NUMBER()` set-based DELETE partitioned by `examId`, mirroring `capRetentionForUsers` in `notification.ts`.
- Test: `tests/unit/domain/ip-violation-retention.test.ts` (or extend an existing repo test) — verify rows beyond the cap are pruned.

**Approach:** Cap on write — `checkIpLock` already wraps the create in a tx; the prune DELETE joins that tx. Partition `PARTITION BY "examId" ORDER BY "createdAt" DESC`, delete `rn > 2000`.

**Verify:** `typecheck` + `lint` + `test:unit`.

---

## Wave 5 — D3: dashboard heatmap local-timezone + 1-year window

**Problem:** `UserDailyActivity` is aggregated per **UTC** calendar day; the heatmap, streak, and weekly-trend force UTC interpretation client-side (`T00:00:00Z`, `getUTCDay()`), so non-UTC users see shifted squares. Window is hard-capped at 30 days.

**Approach (client-side conversion, no schema change):** Compute the heatmap / streak / weekly-trend **client-side from raw submission timestamps** in the browser's local timezone. Stop reading the UTC-bucketed `UserDailyActivity` for the dashboard.

**Files:**

- Create: `packages/domain/src/user/activity.ts` — `getSubmissionActivity(userId, since: Date): Promise<{ createdAt: Date; isAc: boolean }[]>` — lightweight select of the user's submissions in the window.
- Modify: `apps/web/src/routes/(app)/dashboard/+page.server.ts` — drop `utcDayOffset` / UTC bucketing; load raw activity for the last 365 days; pass timestamps to the page.
- Modify: `apps/web/src/lib/components/features/dashboard/ActivityHeatmap.svelte` — bucket timestamps by **local** day (`new Date(ts)` → local Y/M/D key); grid alignment via `getDay()` not `getUTCDay()`; render a 365-day window.
- Modify: `StreakCard` path — compute streak client-side from the same local-day buckets (consecutive local days with ≥1 AC, today grace day).
- Modify: `WeeklyTrendCard.svelte` — last 7 local days from the same buckets.
- Modify: i18n — `dashboard_last30Days` → a 1-year-window label; `ActivityHeatmap` aria-label.
- `packages/domain/src/user/analytics.ts` `getStreakDays` — leave for any non-dashboard caller, or delete if dashboard was its only consumer (verify with `rg`).

**Tests:** `tests/unit` — a pure local-day bucketing helper test (extract bucketing into a testable function).

**Verify:** `typecheck` + `lint` + `test:unit`.

---

## Wave 6 — D4: bulk + per-session exam release UI

**Problem:** `releaseSessionAsInstructor` exists in the domain but is wired to **no UI** — staff currently cannot release sessions at all.

**Files:**

- Modify: `packages/domain/src/exam/session.ts` — add `releaseAllSessionsAsInstructor(actor, { examId }): Promise<{ released: number }>` — same staff check as `releaseSessionAsInstructor`, loops `examSessionRepo.findAllActiveForExam`, ends each + records the `release` event in one transaction.
- Modify: `apps/web/src/routes/(app)/exams/[examId]/+page.server.ts` — add form actions `releaseStudentSession` (wires existing `releaseSessionAsInstructor`) and `releaseAllSessions`; `load` (manager branch) returns the active-session list.
- Create: `apps/web/src/lib/components/features/course/exam/ExamSessionsPanel.svelte` — staff-only panel: active-session list with per-row release + a "release all" button + count. Surface it under a tab/section on the exam page.
- i18n keys for the panel (en + zh-TW).

**Tests:** `tests/integration/api/exam-session.test.ts` — add a `releaseAllSessionsAsInstructor` case (integration; needs DB).

**Verify:** `typecheck` + `lint` + `test:unit`.

---

## Wave 7 — D5: copy-course title validation hardening

**Files:**

- Modify: `packages/core/src/schemas/course.ts` — add `copyCourseSchema = z.object({ newTitle: z.string().trim().min(3).max(120) })`.
- Modify: `apps/web/src/routes/(app)/courses/[courseId]/settings/+page.server.ts` — `copyCourse` action validates the form with `copyCourseSchema` instead of the manual `typeof` check; return a field error on failure.
- Modify: `docs/specs/copy-course.md` — drop the stale "hard-coded `(copy)` suffix" open question; the dialog already takes a custom title.

**Verify:** `typecheck` + `lint`.

---

## Wave 8 — D6: assessment lifecycle audit log

**Files:**

- Create: `packages/db/src/repositories/assessment-audit.ts` — `create` (tx-capable), `listByAssessment(assessmentId, take)`.
- Modify: `packages/db/src/repositories/index.ts` — export it.
- Modify: `packages/domain/src/assignment/mutations.ts` — in `publishAssignment`, `revertAssignmentToDraft`, `deleteAssignmentDraft`, insert an audit row in the existing transaction (`actorUserId` = `actor.userId`); in `markAssignmentPublished` (Temporal) insert with `actorUserId: null`.
- Modify: `packages/domain/src/course/assignment-detail.ts` — `AssignmentDetail` returns recent audit entries (actor display name + action + time).
- Modify: `apps/web/src/lib/components/features/course/assignment/AssignmentLifecycleSection.svelte` — render a compact history list.
- i18n keys for the three action labels (en + zh-TW).

**Tests:** `tests/unit/domain/assignment-mutations.test.ts` — assert an audit row is written on publish / revert / delete.

**Verify:** `typecheck` + `lint` + `test:unit`.

---

## Wave 9 — D7: editorial moderation + rejudge grandfather

**Files:**

- Create: `packages/db/src/repositories/editorial-report.ts` — `create`, `listByStatus`, `updateStatus`.
- Modify: `packages/db/src/repositories/index.ts` — export it.
- Create: `packages/domain/src/editorial/reports.ts`
  - `reportEditorial(actor, editorialId, reason)` — any authenticated user; one per `(editorial, user)` (unique constraint); cannot report your own.
  - `listEditorialReports(actor, status)` — admin-only.
  - `resolveEditorialReport(actor, reportId, action: "resolve" | "dismiss")` — admin-only; `resolve` soft-deletes the editorial + marks the report `resolved`; `dismiss` marks `dismissed`.
- Create: `apps/web/src/routes/api/editorials/[id]/reports/+server.ts` — `POST` report.
- Modify: editorial UI — add a "report" button to `EditorialListPanel.svelte` and the editorial list page.
- Create: `apps/web/src/routes/(app)/admin/content/editorial-reports/+page.{server.ts,svelte}` — admin moderation queue (list open reports, resolve / dismiss).
- Modify: `apps/web/src/routes/(app)/admin/+layout.svelte` — add the tab.
- **Rejudge grandfather:** modify the AC-gate so editorial visibility also passes when the viewer has **authored a non-deleted editorial** for that problem.
  - Modify: `packages/domain/src/editorial/queries.ts` — `hasUserAcProblem` callers also accept "has authored an editorial here". Add `canViewEditorials(userId, problemId) = hasUserAcProblem || hasAuthoredEditorial`.
  - Modify: `requireProblemWithAc` in `api/problems/[id]/editorials/+server.ts`, the editorials list `+page.server.ts`, and `editorials/[id]/edit/+page.server.ts` to use `canViewEditorials`.
  - Modify: `ProblemLeftPanel.svelte` `hasAc` derive — also true when the viewer authored an editorial (pass a flag from the loader).
- i18n keys (en + zh-TW).

**Tests:** `tests/unit/domain/` — `reportEditorial` (dup rejected, self-report rejected), `resolveEditorialReport` (admin-only, soft-deletes on resolve), `canViewEditorials` grandfather path.

**Verify:** `typecheck` + `lint` + `test:unit`.

---

## Verification per wave

`pnpm db:generate` (waves touching schema) · `pnpm -w typecheck` · `pnpm lint` · `pnpm test:unit` · `pnpm format:write`. Integration/E2E need a DB — run if available, otherwise note as deferred.

After every message editing `apps/web/messages/*.json`, recompile Paraglide:
`pnpm --filter @nojv/web exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`

## Status log

All waves landed on `feat/feature-completion-batch-2026-05-18` on
2026-05-18, one commit per wave. Final verification: `pnpm -w
typecheck` 10/10 · `pnpm lint` 8/8 · `pnpm test:unit` 81 files / 713
tests · `pnpm format` clean. Integration/E2E not run (no NOJV DB
reachable in this environment).

- [x] Wave 0 — schema (`AssessmentAuditLog`, `EditorialReport`)
- [x] Wave 1 — E (redis dead code)
- [x] Wave 2 — B (doc sync)
- [x] Wave 3 — A (late-penalty editable)
- [x] Wave 4 — D2 (IpViolationLog retention)
- [x] Wave 5 — D3 (dashboard timezone + range)
- [x] Wave 6 — D4 (exam session release UI)
- [x] Wave 7 — D5 (copy-course validation)
- [x] Wave 8 — D6 (assessment audit log)
- [x] Wave 9 — D7 (editorial moderation)
- [x] Wave 10 — follow-up: removed the now-dead `UserDailyActivity`
      subsystem (table, repo, queries, Temporal activities, tests).

### Verification against a real DB (2026-05-18)

Once the unrelated `tbite` stack was stopped and NOJV's own Postgres
bound port 5432:

- `pnpm db:migrate` applied both migrations — schema in sync.
- `pnpm test:integration` → 25 files / 326 tests green.
- `pnpm test:e2e` (with `NOJV_E2E_RUN_JUDGE=1`): the first run was
  117 passed / 33 failed — all 33 **pre-existing E2E suite rot** (the
  suite is `local only, not in CI` and had drifted across the audit
  rounds), none caused by this batch. Repaired in-place (see below);
  final run **161 passed / 0 failed / 6 skipped**.

### E2E suite repair (2026-05-18)

The 33-failure sweep also surfaced a genuine pre-existing bug:

- **Worker bundle** — `rejudge.ts` value-imported `JUDGE_TASK_QUEUE`
  from the `@nojv/temporal` barrel, pulling `@temporalio/client` into
  the workflow bundle → `Worker.create` rejected it and the worker
  crashed on startup. Fixed: `executeChild` inherits the parent's
  judge task queue, so the import is gone.

Test-side repairs: rate-limiter dev multiplier lifted (turbo strict
env mode blocked the cleaner env-flag route); stale admin URLs; the
REST-refactored `{ type, assignmentId }` context shape for
overrides/clarifications; `/api/notifications` (not `/recent`) +
`markAllRead`; SvelteKit form-action envelope assertions for
scoreboard/exams; `PATCH` (not `PUT`) for editorial update; tightened
strict-mode selectors; account-edit hydration wait; scoreboard heading
rename; `hw-demo-active` (open) for the clarification-ask test;
deleted `contest-hidden-problems.test.ts` (tested removed tab UI).

### Follow-ups

- New route-level integration tests for the release / report flows are
  not written yet.
