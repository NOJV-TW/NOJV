# Merge Contest + Exam & Add Language Restrictions

**Goal:** Merge Contest and CourseAssessment(exam) into a unified Contest model, then add language restriction support to Contest and CourseAssessment(assignment).

**Architecture:** Contest absorbs exam-specific fields (pageLock, ipLock, maxAttempts, scoreboardMode). CourseAssessment drops its `type` field and becomes assignment-only. Both Contest and CourseAssessment gain `allowedLanguages`. Editor filters available languages based on context (contest/assignment restrictions ∩ template availability).

**Tech Stack:** Prisma + PostgreSQL, Zod 4, SvelteKit, sveltekit-superforms

---

## Phase 1: Schema & Core Types

### Task 1: Update Prisma schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

**Changes:**

1. Remove `CourseAssessmentType` enum (no longer needed — only assignments exist)
2. Remove `exam` from `SubmissionMode` enum
3. Add fields to `Contest` model:

   ```prisma
   pageLockEnabled   Boolean                       @default(false)
   ipLockEnabled     Boolean                       @default(false)
   maxAttempts       Int?
   scoreboardMode    CourseAssessmentScoreboardMode @default(live)
   allowedLanguages  SupportedLanguage[]           @default([])
   createdByUserId   String?
   createdBy         User?    @relation("ContestCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)
   ```

   Also add `submissions Submission[]` relation and `plagiarismReports PlagiarismReport[]` relation to Contest.

4. Add to `Submission` model:
   - `contestId String?` + relation to Contest (direct, in addition to participation)
   - Update index: `@@index([contestId, problemId, createdAt])`

5. Add `PlagiarismReport`:
   - Make `courseAssessmentId` optional
   - Add `contestId String?` + relation to Contest

6. Update `CourseAssessment` model:
   - Remove `type` field
   - Remove index `@@index([courseId, type, status])` → `@@index([courseId, status])`
   - Add `allowedLanguages SupportedLanguage[] @default([])`

7. Rename `CourseAssessmentScoreboardMode` → keep name (shared by Contest and Assignment)

8. Update `User` model: add `createdContests Contest[] @relation("ContestCreator")`

**Step 1:** Apply all schema changes above.

**Step 2:** Run migration:

```bash
cd packages/db && npx prisma migrate dev --name merge-contest-exam
```

**Step 3:** Verify generated client compiles:

```bash
cd packages/db && npx prisma generate
```

---

### Task 2: Update core types & enums

**Files:**

- Modify: `packages/core/src/types.ts`

**Changes:**

1. Remove `courseAssessmentTypes` array and `courseAssessmentTypeSchema` (no longer needed)
2. Remove `CourseAssessmentType` type export
3. Update `submissionModes`: remove `"exam"` → `["practice", "contest", "assignment"]`
4. Remove `assessmentContextSchema`'s `kind` field dependency on `courseAssessmentTypeSchema` (will fix in Task 3)

**Step 1:** Apply changes.
**Step 2:** Verify build: `pnpm --filter @nojv/core build`

---

### Task 3: Update core schemas

**Files:**

- Modify: `packages/core/src/schemas/contest.ts`
- Modify: `packages/core/src/schemas/course.ts`
- Modify: `packages/core/src/schemas/submission.ts`

**contest.ts changes:**
Add new fields to `contestCreateBaseSchema`:

```typescript
const contestCreateBaseSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  courseSlug: slugSchema.optional(),
  endsAt: isoDateTimeSchema,
  frozenAt: isoDateTimeSchema.optional(),
  ipLockEnabled: z.boolean().default(false),
  maxAttempts: z.coerce.number().int().min(1).max(999).nullish(),
  pageLockEnabled: z.boolean().default(false),
  problemSlugs: z.array(slugSchema).min(1).max(32),
  scoreboardMode: assessmentScoreboardModeSchema.default("live"),
  scoringMode: contestScoringModeSchema.default("icpc"),
  slug: slugSchema,
  startsAt: isoDateTimeSchema,
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().trim().min(8).max(4_000),
  title: z.string().trim().min(3).max(120)
});
```

**course.ts changes:**

1. `assessmentContextSchema`: remove `kind` field (always assignment now) → simplify to just `{ assessmentSlug, courseSlug }`
2. `courseAssessmentCreateSchema`: remove `type` field, add `allowedLanguages: z.array(languageSchema).max(8).default([])`

**submission.ts changes:**

- `assessmentContextSchema` reference update (no `kind`)
- No other changes needed (mode derivation moves to server logic)

**Step 1:** Apply changes.
**Step 2:** Verify build: `pnpm --filter @nojv/core build`

---

## Phase 2: Server Logic

### Task 4: Update contest queries

**Files:**

- Modify: `apps/web/src/lib/server/contest/queries.ts`

**Changes:**

1. Update `listPublicContests()`: include new fields in select (scoreboardMode, allowedLanguages, etc.)
2. Update `listCourseContests()`: same
3. Update `getContestDetail()`: include new fields, include submissions relation for exam-like behavior
4. Update `getContestWorkspaceData()`: include allowedLanguages in returned data
5. Add `getActiveContestForUser(userId)`: check if user has active pageLock-enabled contest (replaces `getActiveExamForUser`)
6. Update all return types to include new fields

**Step 1:** Apply changes.
**Step 2:** Verify TypeScript: `pnpm --filter web check`

---

### Task 5: Update contest mutations

**Files:**

- Modify: `apps/web/src/lib/server/contest/mutations.ts`

**Changes:**

1. `createContestRecord()`: handle new fields (pageLockEnabled, ipLockEnabled, maxAttempts, scoreboardMode, allowedLanguages, createdByUserId)
2. `updateContestRecord()`: same
3. `ensureContestParticipation()`: handle maxAttempts check (moved from assessment)
4. Add language validation to contest submission path: reject if language not in allowedLanguages (when non-empty)

**Step 1:** Apply changes.
**Step 2:** Verify TypeScript: `pnpm --filter web check`

---

### Task 6: Update submission mutations

**Files:**

- Modify: `apps/web/src/lib/server/submission/mutations.ts`

**Changes:**

1. Remove exam-specific code path (courseAssessment with type=exam)
2. Mode derivation: `contestSlug → "contest"`, `assessment → "assignment"`, else `"practice"` (no more "exam")
3. Add language restriction validation:
   ```typescript
   // For contest submissions
   if (
     contest?.allowedLanguages.length &&
     !contest.allowedLanguages.includes(payload.language)
   ) {
     throw new ForbiddenError("Language not allowed in this contest");
   }
   // For assignment submissions
   if (
     assessment?.allowedLanguages.length &&
     !assessment.allowedLanguages.includes(payload.language)
   ) {
     throw new ForbiddenError("Language not allowed in this assignment");
   }
   ```
4. Add template language validation:
   ```typescript
   if (problem.submissionType === "function") {
     const templateLanguages = problem.templates.map((t) => t.language);
     if (!templateLanguages.includes(payload.language)) {
       throw new ForbiddenError("No template available for this language");
     }
   }
   ```
5. Store `contestId` directly on Submission (in addition to `contestParticipationId`)

**Step 1:** Apply changes.
**Step 2:** Verify TypeScript: `pnpm --filter web check`

---

### Task 7: Update course assessment (assignment-only)

**Files:**

- Modify: `apps/web/src/lib/server/course/queries.ts`
- Modify: `apps/web/src/lib/server/course/mutations.ts`

**queries.ts changes:**

1. `CourseAssessmentRecord` interface: remove `type` field, add `allowedLanguages`
2. `mapAssessmentRecord()`: remove type mapping, add allowedLanguages
3. `listUserAssessments()`: remove `type` parameter — always returns assignments
4. `createAssessmentDetailLoader()`: remove `type` parameter, hardcode assignment behavior
5. `createAssessmentListLoader()`: remove `type` parameter
6. `getActiveExamForUser()`: DELETE (replaced by `getActiveContestForUser` in contest queries)
7. `getAssessmentContext()`: return without `kind` field

**mutations.ts changes:**

1. `createCourseAssessmentRecord()`: remove `type` from payload, always create as assignment
2. Add `allowedLanguages` to creation

**Step 1:** Apply changes.
**Step 2:** Verify TypeScript: `pnpm --filter web check`

---

## Phase 3: Routes & Pages

### Task 8: Update contest routes

**Files:**

- Modify: `apps/web/src/routes/(app)/contests/create/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/contests/create/+page.svelte`
- Modify: `apps/web/src/routes/(app)/contests/[slug]/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/contests/[slug]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/contests/[slug]/problems/[problemSlug]/+page.server.ts`

**Changes:**

1. Contest create form: add fields for pageLockEnabled, ipLockEnabled, maxAttempts, scoreboardMode, allowedLanguages
2. Contest detail page: show new fields
3. Contest workspace: pass `allowedLanguages` to editor component

**Step 1:** Apply changes.
**Step 2:** Verify by visiting contest pages in browser.

---

### Task 9: Merge exam routes into contest

**Files:**

- Modify: `apps/web/src/routes/(app)/exams/+page.server.ts` — redirect to contest list or remove
- Modify: `apps/web/src/routes/(app)/exams/+page.svelte` — remove or redirect
- Modify: `apps/web/src/routes/(app)/courses/[slug]/exams/` — remove entire directory (exams now go through contest routes)

**Changes:**

1. Exams list page (`/exams`): either remove or redirect to `/contests`
2. Course exam pages: remove (course-linked contests are accessed via `/contests/[slug]`)
3. Update any links pointing to exam routes

**Step 1:** Apply changes.
**Step 2:** Verify no broken links.

---

### Task 10: Update assessment routes (assignment-only)

**Files:**

- Modify: `apps/web/src/routes/(app)/assignments/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/courses/[slug]/assignments/[assessmentSlug]/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/courses/[slug]/manage/assessments/+page.server.ts`

**Changes:**

1. Assignments list: remove type parameter from loader
2. Assignment detail: remove type parameter
3. Manage assessments: remove exam creation option, add allowedLanguages field, remove type selector

**Step 1:** Apply changes.
**Step 2:** Verify by visiting assignment pages in browser.

---

### Task 11: Update problem page route

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/[slug]/+page.server.ts`

**Changes:**

1. `assessmentContext`: no longer needs `kind` field
2. Pass `allowedLanguages` from contest or assessment context to the page data

**Step 1:** Apply changes.

---

## Phase 4: Components & Language Restrictions

### Task 12: Update Editor.svelte — language filtering

**Files:**

- Modify: `apps/web/src/lib/components/problem/Editor.svelte`

**Changes:**
This is the core language restriction implementation on the frontend.

1. Add prop: `allowedLanguages?: Language[]`
2. Compute available languages:

   ```typescript
   let availableLanguages = $derived.by(() => {
     let langs = [...supportedLanguages];

     // Filter by contest/assignment restriction
     if (allowedLanguages && allowedLanguages.length > 0) {
       langs = langs.filter((l) => allowedLanguages!.includes(l));
     }

     // Filter by template availability (function-mode problems)
     if (problem.submissionType === "function") {
       const templateLangs = Object.keys(problem.templates) as Language[];
       langs = langs.filter((l) => templateLangs.includes(l));
     }

     return langs;
   });
   ```

3. Update language dropdown to use `availableLanguages` instead of `supportedLanguages`
4. Auto-select first available language if current selection becomes invalid
5. Disable Run/Submit if no languages available (edge case)

**Step 1:** Apply changes.
**Step 2:** Verify dropdown only shows allowed languages.

---

### Task 13: Update Workspace.svelte — pass language context

**Files:**

- Modify: `apps/web/src/lib/components/problem/Workspace.svelte`

**Changes:**

1. Accept `allowedLanguages` prop
2. Pass it through to `ProblemEditor`

**Step 1:** Apply changes.

---

### Task 14: Update contest management components

**Files:**

- Modify: `apps/web/src/lib/components/manage/Contests.svelte`
- Modify: `apps/web/src/routes/(app)/contests/create/+page.svelte`

**Changes:**

1. Add language selector UI (multi-select checkboxes for allowed languages)
2. Add pageLock, ipLock, maxAttempts, scoreboardMode fields
3. Display allowedLanguages in contest list

**Step 1:** Apply changes.

---

### Task 15: Update assignment management components

**Files:**

- Modify: `apps/web/src/lib/components/manage/Assessments.svelte`

**Changes:**

1. Remove type (assignment/exam) selector — always assignment
2. Add language selector UI (same as contest)
3. Remove exam-specific logic

**Step 1:** Apply changes.

---

### Task 16: Update remaining components

**Files:**

- Modify: `apps/web/src/lib/components/course/AssessmentListView.svelte` — remove type-based display
- Modify: `apps/web/src/lib/components/course/AssessmentBoard.svelte` — remove type-based display
- Modify: `apps/web/src/lib/components/contest/ContestListView.svelte` — add new field display

**Step 1:** Apply changes.

---

## Phase 5: Cleanup

### Task 17: Update types.ts (frontend)

**Files:**

- Modify: `apps/web/src/lib/types.ts`

**Changes:**

1. `assessmentPath()`: remove type parameter, always use "assignments"
2. `deriveAssessmentPresentation()`: simplify (always assignment)
3. Remove `CourseAssessmentType` references
4. Update `ProblemDetail`: consider adding `allowedLanguages` if needed from context

**Step 1:** Apply changes.

---

### Task 18: Update submission queries & related

**Files:**

- Modify: `apps/web/src/lib/server/submission/queries.ts`
- Modify: `apps/web/src/lib/server/contest/scoring.ts`
- Modify: `apps/web/src/lib/server/contest/scoreboard.ts`

**Changes:**

1. Submission queries: handle that `mode` no longer has "exam" value
2. Scoring: use contestId on Submission for direct lookup (optional optimization)
3. Scoreboard: support scoreboardMode from Contest model

**Step 1:** Apply changes.

---

### Task 19: Update plagiarism

**Files:**

- Modify: `apps/web/src/routes/api/plagiarism/[assessmentId]/+server.ts`
- Modify: `apps/web/src/routes/(app)/courses/[slug]/manage/plagiarism/[assessmentSlug]/+page.server.ts`

**Changes:**

1. Support both Contest and CourseAssessment as plagiarism targets
2. Or: create a separate plagiarism route for contests

**Step 1:** Apply changes.

---

### Task 20: Update seed data

**Files:**

- Modify: `packages/db/prisma/seed.ts`

**Changes:**

1. Convert "midterm" exam to a Contest record (course-linked)
2. Remove exam-type CourseAssessment creation
3. Add allowedLanguages examples to seed data
4. Verify seed runs clean: `pnpm db:seed`

**Step 1:** Apply changes.
**Step 2:** Run seed: `cd packages/db && pnpm db:seed`

---

### Task 21: Update tests & i18n

**Files:**

- Modify: `apps/web/tests/unit/course-assessment-helpers.test.ts`
- Modify: i18n message files as needed

**Changes:**

1. Remove exam-related test cases from assessment helpers
2. Update `deriveAssessmentPresentation` tests
3. Update i18n: remove exam-specific keys, add language restriction labels

**Step 1:** Apply changes.
**Step 2:** Run tests: `pnpm --filter web test`

---

### Task 22: Final verification

**Steps:**

1. `pnpm --filter @nojv/core build` — core package compiles
2. `pnpm --filter web check` — TypeScript checks pass
3. `cd packages/db && npx prisma migrate dev` — migration clean
4. `pnpm db:seed` — seed runs without errors
5. `pnpm --filter web test` — all tests pass
6. Manual browser test:
   - Create contest with allowedLanguages → editor only shows those languages
   - Create assignment with allowedLanguages → editor only shows those languages
   - Function-mode problem → editor intersects allowed + template languages
   - Submit with disallowed language via API → rejected
   - Practice mode → all languages (or template-restricted) available
