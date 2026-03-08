# Productionization Tranche 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current heuristic judge path with real testcase-backed judging and teacher-managed testcase authoring so the platform becomes a usable course OJ instead of only a demonstrator.

**Architecture:** Keep the existing monorepo boundaries. Store testcase metadata and testcase bodies in PostgreSQL through Prisma so authoring and judging share one source of truth. Reuse the existing worker and sandbox boundaries for actual code execution, but add a submission runner that materializes source plus testcase input into the sandbox and diffs stdout against expected output.

**Tech Stack:** Next.js, Prisma, PostgreSQL, BullMQ, Docker sandbox, Zod, Vitest

---

### Task 1: Define failing tests for testcase authoring

**Files:**

- Create: `apps/web/tests/problem-testcase-routes.test.ts`
- Modify: `apps/web/src/app/api/problems/route.ts`
- Create: `apps/web/src/app/api/problems/[slug]/testcase-sets/route.ts`

**Step 1: Write the failing test**

Write route tests that assert:

- a teacher can create a problem
- the same teacher can attach hidden and sample testcase sets with concrete cases
- a student cannot create testcase sets

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test -- --run tests/problem-testcase-routes.test.ts`
Expected: FAIL because the route and persistence helpers do not exist.

**Step 3: Write minimal implementation**

Add the route module and wire it to a persistence helper that validates actor role and payload shape.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test -- --run tests/problem-testcase-routes.test.ts`
Expected: PASS

### Task 2: Define failing tests for real submission judging

**Files:**

- Create: `apps/worker/tests/submission-runner.test.ts`
- Modify: `apps/worker/src/processors.ts`
- Create: `apps/worker/src/services/submission-runner.ts`

**Step 1: Write the failing test**

Write tests that assert:

- a Python solution is accepted when all testcase outputs match
- a wrong solution returns `wrong_answer`
- an unsupported language returns `compile_error`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/worker test -- --run tests/submission-runner.test.ts`
Expected: FAIL because no real submission runner exists.

**Step 3: Write minimal implementation**

Add a pure runner interface first, then implement sandbox-backed execution with a minimal language command map.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/worker test -- --run tests/submission-runner.test.ts`
Expected: PASS

### Task 3: Expand the schema for testcase authoring

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_testcases/migration.sql`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/course-schemas.test.ts`

**Step 1: Write the failing test**

Add domain tests for testcase authoring payloads:

- testcase set name, visibility, and weighted cases validate
- testcase case stdin/expected stdout are required

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/domain test`
Expected: FAIL because testcase authoring schemas do not exist.

**Step 3: Write minimal implementation**

Add:

- testcase authoring Zod schemas
- Prisma `Testcase` child model under `TestcaseSet`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/domain test && pnpm db:validate`
Expected: PASS

### Task 4: Persist testcase sets and cases

**Files:**

- Modify: `apps/web/src/lib/server/poc-persistence.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/src/problem-authoring.ts`
- Test: `apps/web/tests/problem-testcase-routes.test.ts`

**Step 1: Write the failing test**

Extend the route test to assert persisted testcase sets and cases can be fetched from Prisma.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test -- --run tests/problem-testcase-routes.test.ts`
Expected: FAIL because persistence does not create testcase rows.

**Step 3: Write minimal implementation**

Persist:

- testcase sets under a problem
- ordered testcase rows under each set
- author ownership checks

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test -- --run tests/problem-testcase-routes.test.ts`
Expected: PASS

### Task 5: Judge submissions against persisted testcases

**Files:**

- Modify: `packages/db/src/problem-authoring.ts`
- Modify: `apps/worker/src/processors.ts`
- Create: `apps/worker/src/services/submission-runner.ts`
- Modify: `apps/worker/src/env.ts` only if new runner config is required
- Test: `apps/worker/tests/submission-runner.test.ts`

**Step 1: Write the failing test**

Add worker tests for:

- fetching persisted testcase data
- diffing expected stdout
- returning normalized verdicts

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/worker test -- --run tests/submission-runner.test.ts`
Expected: FAIL because the processor still uses the heuristic.

**Step 3: Write minimal implementation**

Implement a runner that:

- fetches testcase rows for the problem
- materializes source into a temp workspace
- executes a language-specific command inside sandbox
- compares stdout with expected stdout
- returns accepted / wrong_answer / compile_error

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/worker test -- --run tests/submission-runner.test.ts`
Expected: PASS

### Task 6: Verify end-to-end and document the new boundary

**Files:**

- Modify: `README.md`
- Modify: `docs/reports/2026-03-08-prod-gcp-architecture-report.md`

**Step 1: Run verification**

Run:

```bash
pnpm ci:verify
```

Then run a local smoke that:

- creates a teacher-authored problem
- uploads testcase sets
- submits a correct and incorrect solution

Expected: authoring succeeds and submission verdicts reflect testcase output matching.

**Step 2: Document**

Update README and the production report to state:

- testcase authoring is now real
- heuristic judging is removed for authored problems
- remaining production gap is still real auth/session and richer detector breadth
