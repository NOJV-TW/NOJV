# Submission History & Problem Checkmarks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Load historical submissions in problem workspace (filtered by assessment context), show green checkmarks on solved problems in public library, and enforce exam isolation so students in active exams cannot bypass page-lock to view external submissions.

**Architecture:** Add query functions in `submission/queries.ts` and `course/queries.ts`, pass data through server load functions, render in existing Svelte components. Exam guard runs in problem page server load using `pageLockEnabled` field on CourseAssessment.

**Tech Stack:** SvelteKit, Prisma, Svelte 5 ($props, $state, $derived)

---

## Task 1: Add `listProblemSubmissions` query

Fetches a user's submission history for a specific problem, optionally filtered by assessment.

**Files:**

- Modify: `apps/web/src/lib/server/submission/queries.ts`

**Step 1: Add the query function**

Append to `apps/web/src/lib/server/submission/queries.ts`:

```typescript
export async function listProblemSubmissions(
  userId: string,
  problemSlug: string,
  assessmentFilter?: { assessmentSlug: string; courseSlug: string }
) {
  const problem = await prisma.problem.findUnique({
    where: { slug: problemSlug },
    select: { id: true }
  });

  if (!problem) return [];

  const where: {
    problemId: string;
    userId: string;
    sampleOnly: boolean;
    courseAssessmentId?: string;
  } = {
    problemId: problem.id,
    userId,
    sampleOnly: false
  };

  if (assessmentFilter) {
    const assessment = await prisma.courseAssessment.findFirst({
      where: {
        slug: assessmentFilter.assessmentSlug,
        course: { slug: assessmentFilter.courseSlug }
      },
      select: { id: true }
    });

    if (!assessment) return [];
    where.courseAssessmentId = assessment.id;
  }

  const submissions = await prisma.submission.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      language: true,
      score: true,
      sourceCode: true,
      status: true,
      runtimeMs: true,
      verdictDetail: true
    },
    take: 50
  });

  return submissions.map((s) => ({
    language: s.language,
    result: {
      accepted: s.status === "accepted",
      caseResults: Array.isArray((s.verdictDetail as any)?.caseResults)
        ? (s.verdictDetail as any).caseResults
        : undefined,
      feedback: (s.verdictDetail as any)?.feedback ?? s.status.replace(/_/g, " "),
      runtimeMs: s.runtimeMs ?? 0,
      score: s.score,
      verdict: s.status
    },
    sourceCode: s.sourceCode,
    submittedAt: s.createdAt.toISOString()
  }));
}
```

**Step 2: Verify**

Run: `pnpm --filter web check`

**Step 3: Commit**

```
feat: add listProblemSubmissions query with optional assessment filter
```

---

## Task 2: Add `getActiveExamForUser` query

Checks if a user is currently in an active page-locked exam.

**Files:**

- Modify: `apps/web/src/lib/server/course/queries.ts`

**Step 1: Add the query function**

Append to `apps/web/src/lib/server/course/queries.ts`:

```typescript
export async function getActiveExamForUser(userId: string) {
  const now = new Date();

  return prisma.courseAssessment.findFirst({
    where: {
      type: "exam",
      status: "published",
      pageLockEnabled: true,
      opensAt: { lte: now },
      closesAt: { gte: now },
      course: {
        memberships: {
          some: { userId, status: "active" }
        }
      }
    },
    select: {
      slug: true,
      course: { select: { slug: true } }
    }
  });
}
```

**Step 2: Verify**

Run: `pnpm --filter web check`

**Step 3: Commit**

```
feat: add getActiveExamForUser query for exam page-lock enforcement
```

---

## Task 3: Add `listSolvedProblemSlugs` query

Returns the set of problem slugs a user has AC'd (any context).

**Files:**

- Modify: `apps/web/src/lib/server/problem/queries.ts`

**Step 1: Add the query function**

Append to `apps/web/src/lib/server/problem/queries.ts`:

```typescript
export async function listSolvedProblemSlugs(userId: string): Promise<string[]> {
  const rows = await prisma.submission.findMany({
    distinct: ["problemId"],
    select: { problem: { select: { slug: true } } },
    where: { userId, status: "accepted", sampleOnly: false }
  });

  return rows.map((r) => r.problem.slug);
}
```

**Step 2: Verify**

Run: `pnpm --filter web check`

**Step 3: Commit**

```
feat: add listSolvedProblemSlugs query for problem checkmarks
```

---

## Task 4: Update problem page server load

Integrate exam guard, submission history loading, and assessment context filtering.

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/[slug]/+page.server.ts`

**Step 1: Rewrite the server load**

Replace entire file with:

```typescript
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getActiveExamForUser, getAssessmentContext } from "$lib/server/course/queries";
import { getProblemPageData } from "$lib/server/problem/queries";
import { listProblemSubmissions } from "$lib/server/submission/queries";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const { slug } = params;
  const userId = locals.user?.id ?? null;
  const course = url.searchParams.get("course");
  const assessment = url.searchParams.get("assessment");
  const contest = url.searchParams.get("contest");

  // ── Exam guard: if user is in a page-locked exam, enforce correct context ──
  if (userId) {
    const activeExam = await getActiveExamForUser(userId);

    if (activeExam) {
      const isCorrectExamContext =
        course === activeExam.course.slug && assessment === activeExam.slug;

      if (!isCorrectExamContext) {
        redirect(303, `/courses/${activeExam.course.slug}/exams/${activeExam.slug}`);
      }
    }
  }

  const problem = await getProblemPageData(slug);
  if (!problem) {
    error(404, "Problem not found");
  }

  const assessmentContext =
    course && assessment ? await getAssessmentContext(course, assessment) : null;

  const backLink = assessmentContext
    ? {
        href:
          assessmentContext.type === "exam"
            ? `/courses/${assessmentContext.courseSlug}/exams/${assessmentContext.slug}`
            : `/courses/${assessmentContext.courseSlug}/assignments/${assessmentContext.slug}`,
        type: assessmentContext.type
      }
    : undefined;

  const assessmentProp = assessmentContext
    ? {
        assessmentSlug: assessmentContext.slug,
        courseSlug: assessmentContext.courseSlug,
        kind: assessmentContext.type
      }
    : undefined;

  // ── Load submission history (filtered by assessment if present) ──
  const submissions = userId
    ? await listProblemSubmissions(
        userId,
        slug,
        assessmentContext
          ? { assessmentSlug: assessmentContext.slug, courseSlug: assessmentContext.courseSlug }
          : undefined
      )
    : [];

  return {
    assessmentProp,
    backLink,
    contestSlug: contest ?? undefined,
    problem,
    submissions
  };
};
```

**Step 2: Verify**

Run: `pnpm --filter web check`

**Step 3: Commit**

```
feat: integrate exam guard and filtered submission history in problem page
```

---

## Task 5: Update Workspace to accept initial submissions

Pass server-loaded submissions into the Workspace component so it initializes with history.

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/[slug]/+page.svelte`
- Modify: `apps/web/src/lib/components/problem/Workspace.svelte`

**Step 1: Update +page.svelte to pass submissions**

Replace entire file with:

```svelte
<script lang="ts">
  import ProblemWorkspace from "$lib/components/problem/Workspace.svelte";

  let { data } = $props();
</script>

<div
  class="flex h-[calc(100vh-7rem)] overflow-hidden rounded-[2rem] border border-border"
>
  <ProblemWorkspace
    assessment={data.assessmentProp}
    backLink={data.backLink}
    contestSlug={data.contestSlug}
    initialSubmissions={data.submissions}
    problem={data.problem}
  />
</div>
```

**Step 2: Update Workspace.svelte Props and initialization**

In `apps/web/src/lib/components/problem/Workspace.svelte`, update the Props interface and $props destructuring.

Change the Props interface (around line 34) to add `initialSubmissions`:

```typescript
interface Props {
  assessment?:
    | {
        assessmentSlug: string;
        courseSlug: string;
        kind: "assignment" | "exam";
      }
    | undefined;
  backLink?: { href: string; type: "assignment" | "exam" } | undefined;
  contestSlug?: string | undefined;
  initialSubmissions?: SubmissionEntry[];
  problem: ProblemDetail;
}
```

Update the $props destructuring (line 45):

```typescript
let { assessment, backLink, contestSlug, initialSubmissions, problem }: Props = $props();
```

Change the submissions state initialization (line 48) from:

```typescript
let submissions = $state<SubmissionEntry[]>([]);
```

to:

```typescript
let submissions = $state<SubmissionEntry[]>(initialSubmissions ?? []);
```

**Step 3: Verify**

Run: `pnpm --filter web check`

**Step 4: Commit**

```
feat: initialize problem workspace with server-loaded submission history
```

---

## Task 6: Update problems list page with checkmarks

Show green checkmark next to solved problem titles in the public library.

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/+page.server.ts`
- Modify: `apps/web/src/lib/components/problem/Tabs.svelte`

**Step 1: Add solvedSlugs to server load**

Replace `apps/web/src/routes/(app)/problems/+page.server.ts`:

```typescript
import type { PageServerLoad } from "./$types";
import {
  listEditableProblems,
  listProblemCards,
  listSolvedProblemSlugs
} from "$lib/server/problem/queries";

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id ?? null;

  const [publicProblems, editableProblems, solvedSlugs] = await Promise.all([
    listProblemCards(),
    userId ? listEditableProblems(userId) : Promise.resolve(null),
    userId ? listSolvedProblemSlugs(userId) : Promise.resolve([])
  ]);

  return {
    editableProblems,
    publicProblems,
    showCreate: !!userId,
    solvedSlugs
  };
};
```

**Step 2: Update Tabs.svelte Props**

In `apps/web/src/lib/components/problem/Tabs.svelte`, add `solvedSlugs` to the Props interface (around line 27):

```typescript
interface Props {
  editableProblems: EditableProblemCard[] | null;
  publicProblems: ProblemCard[];
  showCreate?: boolean;
  solvedSlugs?: string[];
}
```

Update $props (line 33):

```typescript
let { editableProblems, publicProblems, showCreate, solvedSlugs }: Props = $props();
```

Add a derived Set (after line 33):

```typescript
let solvedSet = $derived(new Set(solvedSlugs ?? []));
```

**Step 3: Add checkmark to problem card**

In the public problem list `{#each}` block (around line 262), add a checkmark before the slug. Change the inner `<div>` from:

```svelte
        <div>
          <p
            class="text-sm uppercase tracking-[0.18em] text-muted-foreground"
          >
            {problem.slug}
          </p>
          <h3 class="mt-2 text-2xl font-semibold">{problem.title}</h3>
        </div>
```

to:

```svelte
        <div>
          <p
            class="text-sm uppercase tracking-[0.18em] text-muted-foreground"
          >
            {problem.slug}
          </p>
          <div class="mt-2 flex items-center gap-2">
            {#if solvedSet.has(problem.slug)}
              <span class="text-emerald-500" title="Solved">
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </span>
            {/if}
            <h3 class="text-2xl font-semibold">{problem.title}</h3>
          </div>
        </div>
```

**Step 4: Pass solvedSlugs from page to component**

Check the problems page (`apps/web/src/routes/(app)/problems/+page.svelte`) — it should pass `solvedSlugs` to the `Tabs` component. Read this file first and add the prop.

**Step 5: Verify**

Run: `pnpm --filter web check`

**Step 6: Commit**

```
feat: show green checkmark on solved problems in public library
```

---

## Summary of Changes

| Task | File                                       | What                                                  |
| ---- | ------------------------------------------ | ----------------------------------------------------- |
| 1    | `submission/queries.ts`                    | Add `listProblemSubmissions()` with assessment filter |
| 2    | `course/queries.ts`                        | Add `getActiveExamForUser()`                          |
| 3    | `problem/queries.ts`                       | Add `listSolvedProblemSlugs()`                        |
| 4    | `problems/[slug]/+page.server.ts`          | Exam guard + load filtered submissions                |
| 5    | `+page.svelte` + `Workspace.svelte`        | Pass & init with historical submissions               |
| 6    | `problems/+page.server.ts` + `Tabs.svelte` | Green checkmark on solved problems                    |
