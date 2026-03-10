# Codebase Clarity Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clarify the active NOJV architecture by removing stale `POC` naming from runtime code, splitting the oversized web persistence layer into focused modules, and updating active documentation to describe the current topology only.

**Architecture:** Keep the current three-app topology (`web`, `worker`, `sandbox-runner`) and the existing runtime behavior. Refactor for clarity, not novelty: preserve public call sites, replace misleading legacy names, and move persistence concerns into small server-side modules with a barrel export so API routes stay stable while the internal structure becomes explicit.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7, Vitest, Turborepo

---

### Task 1: Rename stale `POC` helper surfaces to current domain language

**Files:**
- Create: `apps/web/src/lib/server/course-assessment-helpers.ts`
- Delete: `apps/web/src/lib/server/course-poc-helpers.ts`
- Modify: `apps/web/src/components/assessment-list-page.tsx`
- Modify: `apps/web/src/components/course-assessment-board.tsx`
- Modify: `apps/web/src/components/course-assessment-page.tsx`
- Modify: `apps/web/tests/course-poc-helpers.test.ts`
- Modify: `apps/web/src/lib/server/read-model.ts`

**Step 1: Write the failing validation**

Run:
```bash
rg -n "course-poc-helpers|CoursePoc" apps/web/src apps/web/tests
```
Expected: matches present.

**Step 2: Write minimal implementation**

Rename the helper module to `course-assessment-helpers.ts`, update imports, and rename `CoursePoc*` types in `read-model.ts` to `Course*` / `CourseAssessment*` names that describe current behavior rather than historical bootstrap context.

**Step 3: Run targeted test**

Run:
```bash
pnpm --filter @nojv/web test -- course-poc-helpers.test.ts
```
Expected: PASS after updating the test path/name.

### Task 2: Split `persistence.ts` into focused server data-access modules

**Files:**
- Create: `apps/web/src/lib/server/data-access/shared.ts`
- Create: `apps/web/src/lib/server/data-access/submissions.ts`
- Create: `apps/web/src/lib/server/data-access/workspace-runs.ts`
- Create: `apps/web/src/lib/server/data-access/integrity.ts`
- Create: `apps/web/src/lib/server/data-access/courses.ts`
- Create: `apps/web/src/lib/server/data-access/problems.ts`
- Create: `apps/web/src/lib/server/data-access/runtime-stats.ts`
- Create: `apps/web/src/lib/server/data-access/index.ts`
- Modify: `apps/web/src/lib/server/persistence.ts`

**Step 1: Write the failing validation**

Run:
```bash
wc -l apps/web/src/lib/server/persistence.ts
```
Expected: file is far larger than a focused module and still mixes unrelated concerns.

**Step 2: Write minimal implementation**

Move shared actor/course/problem lookup helpers into `shared.ts`, then split exported persistence functions by responsibility:
- submissions
- workspace runs
- integrity signals
- courses and enrollments
- problems and testcase sets
- runtime stats

Keep `apps/web/src/lib/server/persistence.ts` as a tiny compatibility barrel that re-exports from `data-access`.

**Step 3: Remove stale runtime wording while moving code**

Replace fallback/demo identifiers such as `poc-user`, `@poc.nojv.local`, `POC ...`, and `poc/<mode>:latest` with neutral local-runtime names that match the current product language.

**Step 4: Run targeted tests**

Run:
```bash
pnpm --filter @nojv/web test -- course-management-routes.test.ts course-route-behavior.test.ts problem-testcase-routes.test.ts db-read-model.test.ts judge-operations.test.ts
```
Expected: PASS

### Task 3: Update active documentation and API naming to match the cleaned architecture

**Files:**
- Modify: `README.md`
- Modify: `apps/web/src/app/api/runtime/stats/route.ts`
- Modify: `apps/web/src/lib/server/data-access/runtime-stats.ts`
- Modify: `apps/web/src/components/runtime-stats.tsx` if labels need alignment

**Step 1: Write the failing validation**

Run:
```bash
rg -n "POC|poc" README.md apps/web/src/app/api/runtime/stats/route.ts apps/web/src/lib/server apps/web/src/components/runtime-stats.tsx
```
Expected: active runtime code or docs still contain stale references.

**Step 2: Write minimal implementation**

Rename `getPocRuntimeStats` to `getRuntimeStats`, update the route import, and rewrite active README sections so they describe the current architecture without historical `POC` framing.

**Step 3: Run validation**

Run:
```bash
rg -n "course-poc-helpers|CoursePoc|getPocRuntimeStats|poc-user|@poc\\.nojv\\.local|POC " apps/web/src apps/web/tests README.md
```
Expected: no matches in active runtime code and tests.

### Task 4: Verify the cleanup end-to-end

**Files:**
- Modify as needed based on verification output

**Step 1: Run focused lint, tests, and typecheck**

Run:
```bash
pnpm --filter @nojv/web lint
pnpm --filter @nojv/web test -- course-management-routes.test.ts course-route-behavior.test.ts problem-testcase-routes.test.ts db-read-model.test.ts judge-operations.test.ts problem-editor.test.tsx auth-route.test.ts
pnpm --filter @nojv/web typecheck
pnpm --filter @nojv/worker typecheck
```

**Step 2: Run repo-level smoke verification for touched docs/config**

Run:
```bash
docker compose config
```

**Step 3: Commit**

```bash
git add README.md apps/web/src apps/web/tests docs/plans/2026-03-10-codebase-clarity-cleanup-plan.md
git commit -m "refactor: clarify runtime architecture and remove stale naming"
```
