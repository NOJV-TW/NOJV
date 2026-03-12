# Authorization Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close 4 authorization gaps: course data leakage via query params, unenrolled submission to assessments, unrestricted contest auto-join, and client-controlled submission mode.

**Architecture:** Add authorization checks at the mutation/query layer using existing `resolveCoursePermission()` and `requireCourseRole()` in `auth.ts`. Keep changes minimal — add checks to existing functions rather than creating new abstractions.

**Tech Stack:** SvelteKit, Prisma, Zod, existing `auth.ts` permission system

---

## Task 1: Gate `getCoursePageData` — problem page caller

The problem page's `+page.server.ts` calls `getCoursePageData(course)` with an untrusted query param. Any logged-in user can read any course's members, join tokens, and assessments.

**Fix:** In the problem page loader, only return minimal course context needed for navigation (assessment info for back-link), not the full course data. The course layout (`courses/[slug]/+layout.server.ts`) is fine since the user is already on the course page.

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/[slug]/+page.server.ts`
- Modify: `apps/web/src/lib/server/course/queries.ts` (add a minimal query)

**Step 1: Add `getAssessmentContext` to course queries**

A lightweight query that only returns the assessment slug, type, and course slug — no members, no join tokens.

In `apps/web/src/lib/server/course/queries.ts`, add:

```typescript
export async function getAssessmentContext(courseSlug: string, assessmentSlug: string) {
  const assessment = await prisma.courseAssessment.findFirst({
    select: {
      course: { select: { slug: true } },
      slug: true,
      type: true
    },
    where: {
      course: { slug: courseSlug },
      slug: assessmentSlug,
      status: "published"
    }
  });

  return assessment
    ? { courseSlug: assessment.course.slug, slug: assessment.slug, type: assessment.type }
    : null;
}
```

**Step 2: Update problem page loader to use minimal query**

Replace `getCoursePageData` call in `+page.server.ts` with `getAssessmentContext`:

```typescript
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getAssessmentContext } from "$lib/server/course/queries";
import { getProblemPageData } from "$lib/server/problem/queries";

export const load: PageServerLoad = async ({ params, url }) => {
  const { slug } = params;
  const course = url.searchParams.get("course");
  const assessment = url.searchParams.get("assessment");
  const contest = url.searchParams.get("contest");

  const problem = await getProblemPageData(slug);
  if (!problem) {
    error(404, "Problem not found");
  }

  // Only fetch minimal assessment context — no member/token data exposed
  const assessmentContext =
    course && assessment ? await getAssessmentContext(course, assessment) : null;

  const backLink = assessmentContext
    ? {
        href:
          assessmentContext.type === "exam"
            ? `/courses/${assessmentContext.courseSlug}/exams/${assessmentContext.slug}`
            : `/courses/${assessmentContext.courseSlug}/assignments/${assessmentContext.slug}`,
        label: assessmentContext.type === "exam" ? "Back to Exam" : "Back to Assignment"
      }
    : undefined;

  const assessmentProp = assessmentContext
    ? {
        assessmentSlug: assessmentContext.slug,
        courseSlug: assessmentContext.courseSlug,
        kind: assessmentContext.type
      }
    : undefined;

  return {
    assessmentProp,
    backLink,
    contestSlug: contest ?? undefined,
    problem
  };
};
```

**Step 3: Verify**

Run: `pnpm --filter web check`
Expected: no type errors.

**Step 4: Commit**

```
fix(security): replace getCoursePageData in problem page with minimal assessment query

Prevents leaking course members, join tokens, and full assessment details
through the ?course= query parameter.
```

---

## Task 2: Require course enrollment for assessment submissions

`createQueuedSubmissionRecord` calls `requireCourseAssessment()` which only checks the assessment exists — not that the user is enrolled. Any authenticated user can submit to any course's assessment.

**Fix:** Add enrollment check in `createQueuedSubmissionRecord` using existing `resolveCoursePermission`.

**Files:**

- Modify: `apps/web/src/lib/server/submission/mutations.ts`

**Step 1: Add enrollment check after requireCourseAssessment**

```typescript
import { prisma } from "@nojv/db";
import type { SubmissionDraft } from "@nojv/core";

import type { CompletedActorContext } from "../auth";
import { ForbiddenError } from "../auth";
import { ensureUser } from "../user/mutations";
import { requireCourseAssessment } from "../course/mutations";
import { requireProblem } from "../problem/mutations";
import { ensureContestParticipation } from "../contest/mutations";

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: CompletedActorContext
) {
  const problem = await requireProblem(prisma, payload.problemSlug);
  const courseContext = payload.assessment
    ? await requireCourseAssessment(
        prisma,
        payload.assessment.courseSlug,
        payload.assessment.assessmentSlug
      )
    : null;

  // ── Authorization: verify user is enrolled in the course ──
  if (courseContext) {
    const membership = await prisma.courseMembership.findUnique({
      where: {
        courseId_userId: {
          courseId: courseContext.course.id,
          userId: actor.userId
        }
      }
    });

    if (!membership || membership.status !== "active") {
      throw new ForbiddenError("You are not enrolled in this course.");
    }
  }

  return prisma.$transaction(async (tx) => {
    // ... rest unchanged
  });
}
```

**Step 2: Verify**

Run: `pnpm --filter web check`

**Step 3: Commit**

```
fix(security): require course enrollment before assessment submission

Prevents unenrolled users from submitting to any course's assessments
by checking active membership before creating submission records.
```

---

## Task 3: Validate contest window in `ensureContestParticipation`

`ensureContestParticipation` auto-creates participation records without checking if the contest is published, active, or within its time window.

**Fix:** Add checks for contest visibility and time window.

**Files:**

- Modify: `apps/web/src/lib/server/contest/mutations.ts`

**Step 1: Add contest window and visibility checks**

```typescript
import type { TransactionClient } from "@nojv/db";

import { ForbiddenError, NotFoundError } from "../auth";

export async function requireContest(tx: TransactionClient, contestSlug: string) {
  const contest = await tx.contest.findUnique({
    where: { slug: contestSlug }
  });

  if (!contest) {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  return contest;
}

export async function ensureContestParticipation(
  tx: TransactionClient,
  userId: string,
  contestSlug: string
) {
  const contest = await requireContest(tx, contestSlug);

  // ── Authorization: contest must be published and within time window ──
  if (contest.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  const now = new Date();
  if (now < contest.startsAt) {
    throw new ForbiddenError("Contest has not started yet.");
  }
  if (now > contest.endsAt) {
    throw new ForbiddenError("Contest has ended.");
  }

  return tx.contestParticipation.upsert({
    create: {
      contestId: contest.id,
      startedAt: new Date(),
      status: "active",
      userId
    },
    update: {
      status: "active"
    },
    where: {
      contestId_userId: {
        contestId: contest.id,
        userId
      }
    }
  });
}
```

**Step 2: Verify**

Run: `pnpm --filter web check`

**Step 3: Commit**

```
fix(security): validate contest visibility and time window before participation

Prevents auto-enrollment in unpublished, not-yet-started, or ended contests.
```

---

## Task 4: Move submission mode determination to server

The client picks the `mode` field based on query parameter presence (`contestSlug ? "contest" : ...`). An attacker can craft arbitrary mode values.

**Fix:** Derive `mode` on the server from the actual assessment/contest context, ignoring the client-provided `mode`. Make `mode` optional in the draft schema and override it server-side.

**Files:**

- Modify: `packages/core/src/schemas/submission.ts` (make mode optional)
- Modify: `apps/web/src/lib/server/submission/mutations.ts` (derive mode)

**Step 1: Make `mode` optional in schema, remove client-side refinements**

In `packages/core/src/schemas/submission.ts`, change `mode` to optional and remove the `superRefine` that validates client-provided mode:

```typescript
export const submissionDraftSchema = z.object({
  assessment: assessmentContextSchema.optional(),
  contestSlug: slugSchema.optional(),
  language: languageSchema,
  mode: submissionModeSchema.optional(),
  problemSlug: slugSchema,
  sampleOnly: z.boolean().optional(),
  sourceCode: sourceCodeSchema
});
```

**Step 2: Derive mode server-side in `createQueuedSubmissionRecord`**

After the enrollment check (Task 2), add mode derivation:

```typescript
// ── Derive mode from server context, ignore client-provided mode ──
let mode: "assignment" | "contest" | "exam" | "practice";
if (payload.contestSlug) {
  mode = "contest";
} else if (courseContext) {
  mode = courseContext.assessment.type; // "assignment" | "exam"
} else {
  mode = "practice";
}
```

Use this `mode` in the `tx.submission.create` data instead of `payload.mode`.

**Step 3: Update SubmissionDraft type**

Since `mode` is now optional, ensure `SubmissionDraft` type reflects this. The `z.infer` already handles this automatically.

**Step 4: Verify**

Run: `pnpm --filter @nojv/core check && pnpm --filter web check`
Expected: no type errors (the Editor.svelte can still send `mode` — it'll just be ignored).

**Step 5: Commit**

```
fix(security): derive submission mode server-side instead of trusting client

Mode is now determined from actual assessment type and contest context,
preventing client-side manipulation of submission categorization.
```

---

## Summary of Changes

| Task | File                              | What                                                    |
| ---- | --------------------------------- | ------------------------------------------------------- |
| 1    | `course/queries.ts`               | Add `getAssessmentContext()` minimal query              |
| 1    | `problems/[slug]/+page.server.ts` | Replace `getCoursePageData` with `getAssessmentContext` |
| 2    | `submission/mutations.ts`         | Add enrollment check before assessment submission       |
| 3    | `contest/mutations.ts`            | Validate visibility + time window                       |
| 4    | `core/schemas/submission.ts`      | Make `mode` optional                                    |
| 4    | `submission/mutations.ts`         | Derive mode from server context                         |
