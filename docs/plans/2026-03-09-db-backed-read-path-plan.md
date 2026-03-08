# DB-Backed Read Path Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make course and problem functionality truly end-to-end by rendering persisted PostgreSQL records in the web surfaces instead of only seeded fixture data.

**Architecture:** Keep the existing seeded slice as built-in fixture content, but introduce a server-side read model that merges persisted Prisma records with those fixtures by slug. Add the missing problem summary field to the schema so newly authored problems have enough data to render list and detail pages without synthetic placeholders.

**Tech Stack:** Next.js 16 app router, Prisma 7, PostgreSQL, TypeScript 5.9, Vitest 4

---

### Task 1: Persist Problem Summaries

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_problem_summary/migration.sql`
- Modify: `apps/web/src/lib/server/poc-persistence.ts`
- Test: `apps/web/tests/db-read-model.test.ts`

**Step 1: Write the failing test**

```ts
it("maps persisted problems with summaries into the public catalog", async () => {
  prisma.problem.findMany.mockResolvedValue([
    {
      slug: "compiler-intro",
      defaultTitle: "Compiler Intro",
      difficulty: "easy",
      summary: "Introductory parser warmup.",
      visibility: "public",
      submissions: [{ status: "accepted" }, { status: "wrong_answer" }]
    }
  ]);

  const cards = await listProblemCards();

  expect(cards).toContainEqual(
    expect.objectContaining({
      slug: "compiler-intro",
      title: "Compiler Intro"
    })
  );
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test -- db-read-model.test.ts`
Expected: FAIL because the DB read model does not exist and the Prisma schema still lacks `Problem.summary`.

**Step 3: Write minimal implementation**

Add `summary` to `Problem`, persist it from `createProblemRecord` / `ensureProblem`, and create the migration SQL.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test -- db-read-model.test.ts`
Expected: PASS

### Task 2: Build The Course And Problem Read Model

**Files:**

- Create: `apps/web/src/lib/server/read-model.ts`
- Modify: `apps/web/src/lib/demo-data.ts`
- Modify: `apps/web/src/lib/course-poc-data.ts`
- Test: `apps/web/tests/db-read-model.test.ts`

**Step 1: Write the failing test**

```ts
it("returns persisted course details with members, join channels, problems, and assessments", async () => {
  prisma.course.findUnique.mockResolvedValue(...);

  const detail = await getCoursePageData("compiler-design-2026");

  expect(detail?.course.title).toBe("Compiler Design");
  expect(detail?.assessments).toHaveLength(1);
  expect(detail?.problems[0]?.slug).toBe("compiler-intro");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test -- db-read-model.test.ts`
Expected: FAIL because the server read-model functions do not exist.

**Step 3: Write minimal implementation**

Create async helpers that:

- query Prisma for persisted courses/problems
- map results into the shapes expected by existing components
- merge persisted records with seeded fixture content by slug
- derive acceptance rate and sample cases for persisted problems

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test -- db-read-model.test.ts`
Expected: PASS

### Task 3: Wire Pages To Persisted Data

**Files:**

- Modify: `apps/web/src/app/[locale]/courses/page.tsx`
- Modify: `apps/web/src/app/[locale]/courses/[slug]/page.tsx`
- Modify: `apps/web/src/app/[locale]/courses/[slug]/assignments/[assessmentSlug]/page.tsx`
- Modify: `apps/web/src/app/[locale]/courses/[slug]/exams/[assessmentSlug]/page.tsx`
- Modify: `apps/web/src/app/[locale]/problems/page.tsx`
- Modify: `apps/web/src/app/[locale]/problems/[slug]/page.tsx`
- Modify: `apps/web/src/app/api/courses/route.ts`
- Create: `apps/web/tests/course-route-behavior.test.ts`

**Step 1: Write the failing test**

```ts
it("returns persisted courses from GET /api/courses", async () => {
  listCourseCards.mockResolvedValue([
    {
      slug: "compiler-design-2026",
      title: "Compiler Design",
      memberCount: 3,
      assessmentCount: 1
    }
  ]);

  const { GET } = await import("../src/app/api/courses/route");
  const response = await GET();

  await expect(response.json()).resolves.toEqual({
    courses: [
      {
        slug: "compiler-design-2026",
        title: "Compiler Design",
        memberCount: 3,
        assessmentCount: 1
      }
    ]
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test -- course-route-behavior.test.ts`
Expected: FAIL because the route still returns fixture-only `courseCards`.

**Step 3: Write minimal implementation**

Swap the pages and route to the async read-model helpers. Mark DB-backed pages as dynamic so build-time rendering does not freeze fixture-only output.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test -- course-route-behavior.test.ts`
Expected: PASS

### Task 4: Verify End-To-End Readiness

**Files:**

- Modify: `README.md`

**Step 1: Run focused verification**

Run: `pnpm --filter @nojv/web test -- db-read-model.test.ts course-route-behavior.test.ts`
Expected: PASS

**Step 2: Run repository verification**

Run: `pnpm format && pnpm lint && pnpm test && pnpm build`
Expected: PASS

**Step 3: Run schema verification**

Run: `pnpm db:validate`
Expected: PASS

**Step 4: Update docs**

Document that teacher-authored problems and courses now surface directly in the web UI after creation.
