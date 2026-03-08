# Local Usable Course OJ Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the current NOJV slice into a locally usable course OJ where teachers and students can complete core flows from the UI without hand-written API calls or manual actor headers.

**Architecture:** Keep the existing API routes and persistence model. Add a shared local actor contract, expose actor switching in the web and workspace clients, and layer small client-side management panels on top of the current pages so the existing server routes become directly operable. Use server refresh after successful mutations so DB-backed read models remain the source of truth.

**Tech Stack:** Next.js App Router, React client components, Vite, Prisma, Zod, Vitest

---

### Task 1: Add a shared local actor contract

**Files:**

- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/tests/actor-session.test.ts`

**Step 1: Write the failing test**

Add tests that prove:

- actor request headers contain all `x-nojv-*` fields
- URL search params round-trip actor identity without losing role or user id

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/domain test -- actor-session.test.ts`
Expected: FAIL because the actor-session helpers do not exist.

**Step 3: Write minimal implementation**

- Add an `actorIdentitySchema`
- Export local actor presets for `admin`, `teacher`, `ta`, and `student`
- Export helpers to:
  - build request headers
  - read actor identity from `URLSearchParams`
  - write actor identity into `URLSearchParams`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/domain test -- actor-session.test.ts`
Expected: PASS

### Task 2: Wire actor switching into the web client

**Files:**

- Create: `apps/web/src/components/actor-session-provider.tsx`
- Modify: `apps/web/src/app/[locale]/layout.tsx`
- Modify: `apps/web/src/components/problem-editor.tsx`
- Modify: `apps/web/src/components/telemetry-probe.tsx`
- Modify: `apps/web/src/lib/workspace-launch.ts`
- Modify: `apps/web/tests/workspace-launch.test.ts`

**Step 1: Write the failing test**

Extend `workspace-launch.test.ts` so workspace launch URLs are expected to carry actor identity when provided.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test -- workspace-launch.test.ts`
Expected: FAIL because actor state is not part of workspace launch URLs.

**Step 3: Write minimal implementation**

- Add a client provider that:
  - loads a selected actor from localStorage
  - falls back to a shared preset
  - exposes current actor plus request headers
- Render the actor switcher in the locale header
- Update submission and integrity fetches to include actor headers
- Update workspace launch URL generation to include actor query params

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test -- workspace-launch.test.ts`
Expected: PASS

### Task 3: Add teacher and student management panels in the web UI

**Files:**

- Create: `apps/web/src/components/course-creation-panel.tsx`
- Create: `apps/web/src/components/problem-creation-panel.tsx`
- Create: `apps/web/src/components/course-management-console.tsx`
- Create: `apps/web/src/components/problem-testcase-panel.tsx`
- Modify: `apps/web/src/app/[locale]/courses/page.tsx`
- Modify: `apps/web/src/app/[locale]/problems/page.tsx`
- Modify: `apps/web/src/app/[locale]/courses/[slug]/page.tsx`
- Modify: `apps/web/src/app/[locale]/problems/[slug]/page.tsx`

**Step 1: Write the failing test**

Add a route-focused regression test file that proves:

- created courses and problems can be triggered by UI-facing helpers with actor headers
- testcase authoring requests are issued with the selected actor

Use pure helper tests where possible if React component tests are unnecessary.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test -- course-management-routes.test.ts problem-testcase-routes.test.ts`
Expected: FAIL because no UI helper path exists for these flows.

**Step 3: Write minimal implementation**

- Add a course creation form to the courses page
- Add a problem creation form to the problems page
- Add a course detail console for:
  - join with seeded tokens
  - manual member enrollment
  - attaching problems by slug
  - publishing assessments
- Add a testcase-set authoring panel to the problem detail page
- On mutation success:
  - show response status
  - refresh the page
  - navigate to the created detail page when that materially improves flow

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test -- course-management-routes.test.ts problem-testcase-routes.test.ts`
Expected: PASS

### Task 4: Propagate actor identity into the workspace app

**Files:**

- Create: `apps/workspace/src/actor-session.ts`
- Create: `apps/workspace/src/actor-session.test.ts`
- Modify: `apps/workspace/src/App.tsx`

**Step 1: Write the failing test**

Add tests proving:

- workspace actor identity can be initialized from query params
- workspace run requests can build actor headers from the selected actor

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/workspace test -- actor-session.test.ts`
Expected: FAIL because the actor-session helper does not exist.

**Step 3: Write minimal implementation**

- Parse actor identity from launch URL params
- Persist the selected actor in workspace localStorage
- Add an actor switcher to the workspace header
- Send actor headers with workspace run requests and polling requests

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/workspace test -- actor-session.test.ts`
Expected: PASS

### Task 5: Update docs and run full verification

**Files:**

- Modify: `README.md`

**Step 1: Update docs**

- Replace the claim that teacher/student flows already exist as UI surfaces if wording is inaccurate
- Document the new actor switcher and UI-based local workflow

**Step 2: Run full verification**

Run:

- `pnpm format`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm db:validate`
- `docker compose config`

Expected: all pass
