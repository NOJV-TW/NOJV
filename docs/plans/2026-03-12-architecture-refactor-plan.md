# NOJV Architecture Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the NOJV codebase to align with SvelteKit community conventions, clean architecture, and the approved design in `docs/plans/2026-03-12-architecture-design.md`.

**Architecture:** Domain-scoped `$lib` structure (components/{domain}/ + server/{domain}/), SvelteKit-native load/actions, layout groups for auth boundaries. Moderate package splitting (core → core + sandbox + queue). Paraglide.js replaces svelte-i18n. shadcn-svelte for UI components.

**Tech Stack:** SvelteKit 2, Svelte 5, shadcn-svelte, Paraglide.js, Prisma 7, BullMQ, BetterAuth, Vitest, Playwright

**Verification command (run after every task):** `cd /Users/takala/code/NOJV && pnpm typecheck && pnpm build`

---

## Phase 1: Cleanup — Remove Anti-Cheat, Workspace, and Dead Code

### Task 1.1: Remove anti-cheat from Prisma schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

**Step 1: Remove models and enums**

Delete these models from `schema.prisma`:
- `CheatingCase` model (and all its fields/relations)
- `CheatingSignal` model (and all its fields/relations)
- `WorkspaceSession` model (and all its fields/relations)
- `WorkspaceRun` model (and all its fields/relations)

Delete these enums:
- `CheatingSignalType`
- `CheatingCaseStatus`
- `WorkspaceRunStatus`
- `WorkspaceMode`

Remove relation fields referencing these models from other models:
- `User`: remove `workspaceSessions`, `workspaceRuns`, `cheatingSignals`, `cheatingCases`
- `Problem`: remove `workspaceSessions`
- `Contest`: remove `cheatingCases`
- `ContestParticipation`: remove `workspaceSessions`, `workspaceRuns`, `cheatingSignals`
- `Course`: remove `workspaceSessions`, `workspaceRuns`, `cheatingCases`, `cheatingSignals`
- `CourseAssessment`: remove `workspaceSessions`, `workspaceRuns`, `cheatingCases`, `cheatingSignals`
- `Submission`: remove `cheatingSignals`

**Step 2: Validate schema**

Run: `cd /Users/takala/code/NOJV && pnpm db:validate`
Expected: Schema is valid

**Step 3: Generate new Prisma client**

Run: `cd /Users/takala/code/NOJV && pnpm db:generate`
Expected: Prisma client generated successfully

**Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "chore: remove anti-cheat and workspace models from schema"
```

---

### Task 1.2: Remove anti-cheat from @nojv/core

**Files:**
- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/queue.ts`

**Step 1: Clean up domain.ts**

Remove these const arrays and their Zod schemas:
- `cheatingSignalTypes` (line 26-33) + `cheatingSignalTypeSchema`
- `integritySignalSources` (line 34-38) + `integritySignalSourceSchema`
- `integrityRiskLevels` (line 40) + `integrityRiskLevelSchema`
- `workspaceModes` (line 25) + `workspaceModeSchema`
- `workspaceRunStatuses` (line 39) + `workspaceRunStatusSchema`
- `workspaceOperationStatuses` (line 59-66) + `workspaceOperationStatusSchema`

Remove these schemas:
- `workspaceFileSchema`
- `workspaceRunRequestSchema`
- `workspaceRunResultSchema`
- `workspaceRunDispatchResponseSchema`
- `workspaceRunOperationSchema`
- `cheatingSignalSchema`
- `integrityAssessmentSchema`
- `integrityCaseSchema`

Remove these types:
- `CheatingSignal`, `IntegrityAssessment`, `IntegrityCase`
- `WorkspaceFile`, `WorkspaceMode`, `WorkspaceRunDispatchResponse`
- `WorkspaceRunOperation`, `WorkspaceRunRequestInput`, `WorkspaceRunRequest`, `WorkspaceRunResult`

Remove these interfaces and functions:
- `WorkspaceSessionIdentifierInput` interface
- `buildWorkspaceSessionId()` function
- `signalWeights` record
- `evaluateIntegritySignals()` function

Keep `EditorSessionIdentifierInput` and `buildEditorSessionId()` — they are used by the editor.

**Step 2: Clean up queue.ts**

Remove `cheatingSignal` from `queueNames`:
```typescript
export const queueNames = {
  submission: "submission-judge"
} as const;
```

**Step 3: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm typecheck`
Expected: May show errors in consuming apps — fix in next tasks

**Step 4: Commit**

```bash
git add packages/core/
git commit -m "chore: remove anti-cheat and workspace schemas from @nojv/core"
```

---

### Task 1.3: Remove anti-cheat from worker

**Files:**
- Delete: `apps/worker/src/processors/cheating-signal.ts`
- Modify: `apps/worker/src/worker-app.ts`

**Step 1: Delete cheating-signal processor**

Delete `apps/worker/src/processors/cheating-signal.ts` entirely.

**Step 2: Update worker-app.ts**

Remove the cheatingSignal worker initialization. Only keep the submission worker.
Remove import of `processCheatingSignal` and the `cheatingSignal` queue name usage.

**Step 3: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/worker typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/worker/
git commit -m "chore: remove cheating-signal processor from worker"
```

---

### Task 1.4: Remove workspace and integrity from web app

**Files:**
- Modify: `apps/web/src/lib/server/db.ts` — remove workspace-related functions
- Modify: `apps/web/src/lib/server/queries.ts` — remove workspace-related queries
- Modify: `apps/web/src/lib/types.ts` — remove workspace-related types
- Modify: any routes referencing workspace or integrity
- Delete: any workspace/integrity-specific components

**Step 1: Search and remove**

Search all files under `apps/web/src/` for references to:
- `workspace` (case-insensitive) — remove workspace run/session logic
- `cheating` / `integrity` / `telemetry` — remove anti-cheat UI and logic
- `CheatingCase` / `CheatingSignal` / `WorkspaceSession` / `WorkspaceRun`

Remove:
- Workspace API routes: `apps/web/src/routes/api/workspace/` (entire directory)
- Any telemetry probe component
- Any integrity dashboard page
- i18n keys: `workspace.*`, `integrity.*`, `runtimeStats.integritySignals`, `runtimeStats.workspaceRuns`, `runtimeStats.openCases`

**Step 2: Clean up i18n JSON files**

Remove the `workspace` and `integrity` sections from:
- `apps/web/src/lib/i18n/en.json`
- `apps/web/src/lib/i18n/zh-TW.json`

Also remove `runtimeStats` section if it only references removed features.

**Step 3: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm typecheck && pnpm build`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/
git commit -m "chore: remove workspace and integrity modules from web app"
```

---

### Task 1.5: Update seed script

**Files:**
- Modify: `packages/db/prisma/seed.ts`

**Step 1: Remove references**

Remove any seed data creating:
- CheatingCase records
- CheatingSignal records
- WorkspaceSession records
- WorkspaceRun records

**Step 2: Verify seed runs**

Run: `cd /Users/takala/code/NOJV && pnpm db:seed` (requires running DB)
Expected: Seed completes without errors

**Step 3: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "chore: remove anti-cheat and workspace seed data"
```

---

## Phase 2: Package Splitting — Extract @nojv/sandbox and @nojv/queue

### Task 2.1: Create @nojv/sandbox package

**Files:**
- Create: `packages/sandbox/package.json`
- Create: `packages/sandbox/tsconfig.json`
- Create: `packages/sandbox/src/index.ts`
- Create: `packages/sandbox/src/request.ts`
- Create: `packages/sandbox/src/result.ts`
- Create: `packages/sandbox/src/languages.ts`
- Modify: `packages/core/src/sandbox.ts` → delete
- Modify: `packages/core/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@nojv/sandbox",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsdown src/index.ts --format esm --dts",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "tsdown": "catalog:",
    "typescript": "catalog:"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Move sandbox.ts content**

Split `packages/core/src/sandbox.ts` into:

`packages/sandbox/src/request.ts`:
```typescript
import type { JudgeType, Language, SubmissionType } from "@nojv/core";

export interface SandboxConfig { ... }  // from sandbox.ts
export interface SandboxTestcase { ... }
export interface SandboxRequest { ... }
```

`packages/sandbox/src/result.ts`:
```typescript
export const sandboxVerdicts = ["AC", "WA", "TLE", "MLE", "RE", "SE"] as const;
export type SandboxVerdict = (typeof sandboxVerdicts)[number];

export interface SandboxTestcaseResult { ... }
export interface SandboxResult { ... }
export interface SandboxExecutor { ... }
```

`packages/sandbox/src/languages.ts`:
```typescript
import type { Language } from "@nojv/core";

export const sourceFileNames: Record<Language, string> = { ... };
export const sourceExtensions: Record<Language, string> = { ... };
```

`packages/sandbox/src/index.ts`:
```typescript
export * from "./request";
export * from "./result";
export * from "./languages";
```

**Step 4: Delete packages/core/src/sandbox.ts**

Remove `export * from "./sandbox"` from `packages/core/src/index.ts`.

**Step 5: Add @nojv/sandbox to pnpm-workspace.yaml**

It's already covered by `packages/*` glob — no change needed.

**Step 6: Install and build**

Run: `cd /Users/takala/code/NOJV && pnpm install && pnpm --filter @nojv/sandbox build`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add packages/sandbox/ packages/core/
git commit -m "feat: extract @nojv/sandbox package from @nojv/core"
```

---

### Task 2.2: Create @nojv/queue package

**Files:**
- Create: `packages/queue/package.json`
- Create: `packages/queue/tsconfig.json`
- Create: `packages/queue/src/index.ts`
- Create: `packages/queue/src/names.ts`
- Create: `packages/queue/src/jobs.ts`
- Modify: `packages/core/src/queue.ts` → delete
- Modify: `packages/core/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@nojv/queue",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "dependencies": {
    "@nojv/core": "workspace:*"
  },
  "scripts": {
    "build": "tsdown src/index.ts --format esm --dts",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "tsdown": "catalog:",
    "typescript": "catalog:"
  }
}
```

**Step 2: Move queue.ts content**

`packages/queue/src/names.ts`:
```typescript
export const queueNames = {
  submission: "submission-judge"
} as const;
```

`packages/queue/src/jobs.ts`:
```typescript
import { submissionDraftSchema } from "@nojv/core";
import { z } from "zod";

export const defaultJobOptions = {
  attempts: 3,
  removeOnComplete: 250,
  removeOnFail: 500
} as const;

export const submissionJudgeJobSchema = z.object({
  draft: submissionDraftSchema,
  submissionId: z.string().trim().min(1)
});

export type SubmissionJudgeJob = z.infer<typeof submissionJudgeJobSchema>;
```

`packages/queue/src/index.ts`:
```typescript
export * from "./names";
export * from "./jobs";
```

**Step 3: Delete packages/core/src/queue.ts**

Remove `export * from "./queue"` from `packages/core/src/index.ts`.

**Step 4: Install and build**

Run: `cd /Users/takala/code/NOJV && pnpm install && pnpm --filter @nojv/queue build`

**Step 5: Commit**

```bash
git add packages/queue/ packages/core/
git commit -m "feat: extract @nojv/queue package from @nojv/core"
```

---

### Task 2.3: Reorganize @nojv/core into schemas/

**Files:**
- Create: `packages/core/src/schemas/problem.ts`
- Create: `packages/core/src/schemas/course.ts`
- Create: `packages/core/src/schemas/contest.ts`
- Create: `packages/core/src/schemas/submission.ts`
- Create: `packages/core/src/types.ts` (rename from shared constants in domain.ts)
- Delete: `packages/core/src/domain.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Split domain.ts**

`packages/core/src/types.ts` — shared enums and base schemas:
```typescript
// Language, role, locale enums + their Zod schemas
// slugSchema, isoDateTimeSchema, sourceCodeSchema, userIdSchema
// EditorSessionIdentifierInput, buildEditorSessionId()
```

`packages/core/src/schemas/problem.ts`:
```typescript
// problemTemplateSchema, problemCreateSchema, problemUpdateSchema
// problemTestcaseCaseSchema, problemJudgeTestcaseSchema, problemTestcaseSetCreateSchema
// problemOverviewSchema
// + their inferred types
```

`packages/core/src/schemas/course.ts`:
```typescript
// courseCreateSchema, courseJoinRequestSchema, courseProblemAttachSchema
// manualCourseEnrollmentSchema, assessmentContextSchema, courseAssessmentCreateSchema
// courseAssessmentSummarySchema
// + their inferred types
```

`packages/core/src/schemas/contest.ts`:
```typescript
// contestSessionSchema
// + its inferred type
```

`packages/core/src/schemas/submission.ts`:
```typescript
// submissionDraftSchema, submissionResultSchema, testcaseResultItemSchema
// submissionDispatchResponseSchema, submissionOperationSchema
// + their inferred types
```

`packages/core/src/index.ts`:
```typescript
export * from "./types";
export * from "./schemas/problem";
export * from "./schemas/course";
export * from "./schemas/contest";
export * from "./schemas/submission";
```

**Step 2: Verify all exports are preserved**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/core build && pnpm typecheck`
Expected: All downstream packages still compile

**Step 3: Commit**

```bash
git add packages/core/
git commit -m "refactor: reorganize @nojv/core into schemas/ directory"
```

---

### Task 2.4: Update all import paths

**Files:**
- Modify: `apps/worker/package.json` — add `@nojv/sandbox`, `@nojv/queue` deps
- Modify: `apps/worker/src/**/*.ts` — update imports from `@nojv/core` to `@nojv/sandbox` or `@nojv/queue`
- Modify: `apps/sandbox-runner/package.json` — add `@nojv/sandbox` dep
- Modify: `apps/sandbox-runner/src/**/*.ts` — update sandbox imports
- Modify: `apps/web/package.json` — add `@nojv/queue` dep
- Modify: `apps/web/src/lib/server/queue.ts` — update queue imports

**Step 1: Update worker**

In `apps/worker/package.json`, add:
```json
"@nojv/sandbox": "workspace:*",
"@nojv/queue": "workspace:*"
```

Update imports in worker files:
- `import { SandboxRequest, SandboxResult, SandboxExecutor, ... } from "@nojv/sandbox"`
- `import { queueNames, submissionJudgeJobSchema, ... } from "@nojv/queue"`

**Step 2: Update sandbox-runner**

In `apps/sandbox-runner/package.json`, add:
```json
"@nojv/sandbox": "workspace:*"
```

Update imports:
- `import { SandboxVerdict, SandboxTestcaseResult, sourceFileNames, ... } from "@nojv/sandbox"`

**Step 3: Update web**

In `apps/web/package.json`, add:
```json
"@nojv/queue": "workspace:*"
```

Update `apps/web/src/lib/server/queue.ts`:
- `import { queueNames, defaultJobOptions, ... } from "@nojv/queue"`

**Step 4: Install and verify**

Run: `cd /Users/takala/code/NOJV && pnpm install && pnpm typecheck && pnpm build`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/ packages/ pnpm-lock.yaml
git commit -m "refactor: update imports for @nojv/sandbox and @nojv/queue packages"
```

---

## Phase 3: Tooling Centralization

### Task 3.1: Create tooling/ directory

**Files:**
- Create: `tooling/typescript/base.json`
- Create: `tooling/eslint/base.mjs`
- Create: `tooling/prettier/base.mjs`
- Modify: `tsconfig.base.json` → `extends` from tooling
- Modify: `eslint.config.mjs` → import from tooling
- Modify: `pnpm-workspace.yaml` — add `tooling/*`

**Step 1: Move TypeScript base config**

Copy `tsconfig.base.json` content to `tooling/typescript/base.json`.
Update root `tsconfig.base.json` to:
```json
{
  "extends": "./tooling/typescript/base.json"
}
```

**Step 2: Move ESLint base config**

Extract shared rules from `eslint.config.mjs` into `tooling/eslint/base.mjs`.
Root `eslint.config.mjs` imports and re-exports from tooling.

**Step 3: Move Prettier config**

Create `tooling/prettier/base.mjs` with current prettier settings.

**Step 4: Update pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tooling/*"
```

**Step 5: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm install && pnpm lint && pnpm typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add tooling/ tsconfig.base.json eslint.config.mjs pnpm-workspace.yaml
git commit -m "refactor: centralize tooling configs into tooling/ directory"
```

---

## Phase 4: Web App Route Restructure — Layout Groups

### Task 4.1: Create (auth) and (app) layout groups

**Files:**
- Create: `apps/web/src/routes/(auth)/+layout.svelte`
- Create: `apps/web/src/routes/(app)/+layout.server.ts` — auth guard
- Create: `apps/web/src/routes/(app)/+layout.svelte`
- Move: auth routes into `(auth)/`
- Move: app routes into `(app)/`

**Step 1: Create (auth) layout group**

Create `apps/web/src/routes/(auth)/+layout.svelte` — minimal layout (no sidebar/nav, just centered container).

Move these routes into `(auth)/`:
- `auth/signin/` → `(auth)/signin/`
- `auth/signup/` → `(auth)/signup/`
- `auth/admin-signin/` → `(auth)/admin-signin/`
- `auth/complete-profile/` → `(auth)/complete-profile/`
- `auth/verify-school/` → `(auth)/verify-school/`

**Step 2: Create (app) layout group**

Create `apps/web/src/routes/(app)/+layout.server.ts`:
```typescript
import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async (event) => {
  const session = event.locals.session;
  if (!session) {
    redirect(303, "/signin");
  }
  return { user: event.locals.user };
};
```

Create `apps/web/src/routes/(app)/+layout.svelte` — main app layout with Header.

Move these routes into `(app)/`:
- `problems/` → `(app)/problems/`
- `courses/` → `(app)/courses/`
- `submissions/` → `(app)/submissions/`
- `assignments/` → `(app)/assignments/`
- `exams/` → `(app)/exams/`
- `account/` → `(app)/account/`

**Step 3: Keep root layout minimal**

Root `+layout.svelte` should only provide:
- HTML lang attribute
- Global CSS
- Paraglide provider (later)
- `{@render children()}`

**Step 4: Update internal links**

Search for `href="/auth/` and update to `href="/` (since (auth) is a grouping, URLs don't change).
Actually — layout groups don't affect URLs, so `/signin` stays `/signin`, `/problems` stays `/problems`. No link changes needed IF routes are placed correctly.

Note: Currently routes are at `/auth/signin`. Moving to `(auth)/signin/` means the URL becomes `/signin` (dropping the `/auth` prefix). If we want to keep `/auth/signin`, put routes at `(auth)/auth/signin/`. Decide based on preference.

**Recommended:** Drop the `/auth/` prefix — cleaner URLs:
- `/signin`, `/signup`, `/complete-profile`

**Step 5: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web build`
Expected: Build succeeds

**Step 6: Update navigation links**

Search all files for old auth URLs (`/auth/signin`, etc.) and update to new paths.

**Step 7: Commit**

```bash
git add apps/web/src/routes/
git commit -m "refactor: reorganize routes into (auth) and (app) layout groups"
```

---

### Task 4.2: Create admin layout group

**Files:**
- Create: `apps/web/src/routes/(app)/admin/+layout.server.ts`

**Step 1: Admin guard**

```typescript
import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async (event) => {
  const user = event.locals.user;
  if (!user || user.platformRole !== "admin") {
    redirect(303, "/");
  }
};
```

**Step 2: Commit**

```bash
git add apps/web/src/routes/
git commit -m "feat: add admin layout guard"
```

---

### Task 4.3: Create course manage layout guard

**Files:**
- Create: `apps/web/src/routes/(app)/courses/[slug]/manage/+layout.server.ts`

**Step 1: Permission guard**

This layout server load should check that the user has teacher/ta/admin role for the course. Extract the logic from existing per-route checks.

**Step 2: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web build`

**Step 3: Commit**

```bash
git add apps/web/src/routes/
git commit -m "feat: add course manage layout guard"
```

---

## Phase 5: Web App Lib Restructure — Domain-Scoped

### Task 5.1: Split server/db.ts into domain modules

**Files:**
- Create: `apps/web/src/lib/server/problem/mutations.ts`
- Create: `apps/web/src/lib/server/course/mutations.ts`
- Create: `apps/web/src/lib/server/submission/mutations.ts`
- Modify: `apps/web/src/lib/server/db.ts` — keep only shared helpers (ensureUser, prisma client)

**Step 1: Extract problem mutations**

Move from `db.ts` to `server/problem/mutations.ts`:
- `createProblemDefinition()`
- `createProblemTestcaseSetRecord()` (or similar)
- Any problem update functions

**Step 2: Extract course mutations**

Move from `db.ts` to `server/course/mutations.ts`:
- `createCourseRecord()`
- `attachProblemToCourseRecord()`
- `joinCourseRecord()`
- `manuallyEnrollCourseMember()`
- `createCourseAssessmentRecord()`

**Step 3: Extract submission mutations**

Move from `db.ts` to `server/submission/mutations.ts`:
- `createQueuedSubmissionRecord()`

**Step 4: Update db.ts**

Keep only shared utilities:
- `ensureUser()`
- Prisma client re-export (if any)

**Step 5: Update imports in routes**

All route `+page.server.ts` files that import from `$lib/server/db` need to update to import from the new domain paths.

**Step 6: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm typecheck && pnpm build`

**Step 7: Commit**

```bash
git add apps/web/src/lib/server/
git commit -m "refactor: split server/db.ts into domain mutation modules"
```

---

### Task 5.2: Split server/queries.ts into domain modules

**Files:**
- Create: `apps/web/src/lib/server/problem/queries.ts`
- Create: `apps/web/src/lib/server/course/queries.ts`
- Create: `apps/web/src/lib/server/contest/queries.ts`
- Create: `apps/web/src/lib/server/submission/queries.ts`
- Delete: `apps/web/src/lib/server/queries.ts`

**Step 1: Extract problem queries**

Move to `server/problem/queries.ts`:
- `listProblemCards()`
- `listEditableProblems()`
- `getProblemPageData()`

**Step 2: Extract course queries**

Move to `server/course/queries.ts`:
- `getCoursePageData()`
- `createAssessmentDetailLoader()`
- `createAssessmentListLoader()`

**Step 3: Extract contest queries**

Move to `server/contest/queries.ts`:
- Any contest-related query functions

**Step 4: Extract submission queries**

Move to `server/submission/queries.ts`:
- Any submission listing/detail queries

**Step 5: Update all route imports**

Update all `+page.server.ts` files to import from new paths.

**Step 6: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm typecheck && pnpm build`

**Step 7: Commit**

```bash
git add apps/web/src/
git commit -m "refactor: split server/queries.ts into domain query modules"
```

---

### Task 5.3: Reorganize components into domain directories

**Files:**
- Move problem components to `lib/components/problem/`
- Move course components to `lib/components/course/`
- Move contest components to `lib/components/contest/`
- Move layout components to `lib/components/layout/`

**Step 1: Create directory structure**

```bash
mkdir -p apps/web/src/lib/components/{problem,course,contest,layout}
```

**Step 2: Move components**

Map existing component files to new locations:

Problem:
- `Editor.svelte` → `components/problem/editor.svelte`
- `Workspace.svelte` → `components/problem/workspace.svelte`
- `CreationPanel.svelte` → `components/problem/creation-panel.svelte`
- `Tabs.svelte` (problem listing) → `components/problem/problem-list.svelte`

Course:
- `AssessmentBoard.svelte` → `components/course/assessment-board.svelte`
- `JoinPanel.svelte` → `components/course/join-panel.svelte`
- `ProblemShelf.svelte` → `components/course/problem-shelf.svelte`
- `JoinCallToAction.svelte` → `components/course/join-cta.svelte`
- `AssessmentListView.svelte` → `components/course/assessment-list-view.svelte`

Course manage:
- `Problems.svelte` → `components/course/manage-problems.svelte`
- `Assessments.svelte` → `components/course/manage-assessments.svelte`
- `Members.svelte` → `components/course/manage-members.svelte`

Layout:
- `Header.svelte` → `components/layout/header.svelte`
- `UserMenu.svelte` → `components/layout/user-menu.svelte`
- `OAuthButtons.svelte` → `components/layout/oauth-buttons.svelte`
- `MarkdownRenderer.svelte` → `components/layout/markdown-renderer.svelte` (or keep in a `shared/` dir)

**Step 3: Rename to lowercase kebab-case**

Follow SvelteKit community convention of lowercase filenames for components.

**Step 4: Update all imports**

Update all `+page.svelte` and other component files that import these components.

**Step 5: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm typecheck && pnpm build`

**Step 6: Commit**

```bash
git add apps/web/src/lib/components/ apps/web/src/routes/
git commit -m "refactor: reorganize components into domain directories"
```

---

## Phase 6: shadcn-svelte Integration

### Task 6.1: Initialize shadcn-svelte

**Step 1: Install**

Run: `cd /Users/takala/code/NOJV/apps/web && npx shadcn-svelte@latest init`

Follow prompts:
- Style: Default (or New York — match current aesthetic)
- Base color: match current design
- CSS variables: yes
- Components path: `$lib/components/ui`

**Step 2: Verify config created**

Check that `components.json` is created in `apps/web/`.

**Step 3: Add commonly needed components**

```bash
npx shadcn-svelte@latest add button
npx shadcn-svelte@latest add input
npx shadcn-svelte@latest add select
npx shadcn-svelte@latest add table
npx shadcn-svelte@latest add tabs
npx shadcn-svelte@latest add dialog
npx shadcn-svelte@latest add badge
npx shadcn-svelte@latest add card
npx shadcn-svelte@latest add dropdown-menu
```

**Step 4: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web build`

**Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: initialize shadcn-svelte with base UI components"
```

---

### Task 6.2: Gradually replace hand-crafted UI

This task is ongoing — replace existing hand-crafted elements with shadcn-svelte components one component at a time. Each replacement should be a separate commit.

Priority order:
1. Buttons (replace custom button styles with `<Button>`)
2. Form inputs (replace `<input>` with `<Input>`)
3. Tables (submission list, member table → `<Table>`)
4. Tabs (problem workspace tabs → `<Tabs>`)
5. Dialogs/modals
6. Dropdowns (user menu → `<DropdownMenu>`)
7. Badges (difficulty, verdict → `<Badge>`)
8. Cards (course cards, assessment cards → `<Card>`)

**Approach:** Replace incrementally. Don't rewrite entire pages — just swap individual elements.

---

## Phase 7: Paraglide.js Migration

### Task 7.1: Install and configure Paraglide

**Step 1: Install**

Run:
```bash
cd /Users/takala/code/NOJV/apps/web
pnpm add -D @inlang/paraglide-sveltekit
npx @inlang/paraglide-sveltekit init
```

**Step 2: Configure project.inlang/settings.json**

```json
{
  "$schema": "https://inlang.com/schema/project-settings",
  "sourceLanguageTag": "en",
  "languageTags": ["en", "zh-TW"],
  "modules": [
    "https://cdn.jsdelivr.net/npm/@inlang/message-lint-rule-empty-pattern@latest/dist/index.js",
    "https://cdn.jsdelivr.net/npm/@inlang/message-lint-rule-missing-translation@latest/dist/index.js",
    "https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@latest/dist/index.js"
  ],
  "plugin.inlang.messageFormat": {
    "pathPattern": "./messages/{languageTag}.json"
  }
}
```

**Step 3: Move translation files**

- Copy `apps/web/src/lib/i18n/en.json` → `apps/web/messages/en.json`
- Copy `apps/web/src/lib/i18n/zh-TW.json` → `apps/web/messages/zh-TW.json`

**Step 4: Update vite.config.ts**

```typescript
import { paraglide } from "@inlang/paraglide-sveltekit/vite";

export default defineConfig({
  plugins: [
    paraglide({
      project: "./project.inlang",
      outdir: "./src/lib/paraglide"
    }),
    tailwindcss(),
    sveltekit()
  ]
});
```

**Step 5: Update svelte.config.js**

Add `i18n` configuration if needed by Paraglide.

**Step 6: Build to generate paraglide output**

Run: `cd /Users/takala/code/NOJV/apps/web && pnpm build`
Expected: `src/lib/paraglide/` is generated

**Step 7: Add paraglide output to .gitignore**

Add `src/lib/paraglide/` to `apps/web/.gitignore`.

**Step 8: Commit**

```bash
git add apps/web/
git commit -m "feat: install and configure Paraglide.js"
```

---

### Task 7.2: Integrate Paraglide into layouts

**Files:**
- Modify: `apps/web/src/routes/+layout.svelte`
- Modify: `apps/web/src/routes/+layout.server.ts`
- Modify: `apps/web/src/hooks.server.ts`

**Step 1: Setup ParaglideJS in root layout**

Follow Paraglide-SvelteKit docs for:
- `handle` hook in `hooks.server.ts` for locale detection
- `ParaglideJS` component in root `+layout.svelte`
- Language switcher integration

**Step 2: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web build`

**Step 3: Commit**

```bash
git add apps/web/src/
git commit -m "feat: integrate Paraglide into SvelteKit layouts and hooks"
```

---

### Task 7.3: Migrate all $t() calls to m.()

**Step 1: Search for all $t usage**

Run grep for `\$t\(` across all `.svelte` and `.ts` files in `apps/web/src/`.

**Step 2: Replace systematically**

For each file, replace:
- `$t('key.subkey')` → `m.key_subkey()`
- `$t('key.subkey', { name })` → `m.key_subkey({ name })`

Note: Paraglide uses `_` as separator in function names by default. Adjust key format in message files if needed.

**Step 3: Remove svelte-i18n**

- Delete `apps/web/src/lib/i18n/` directory
- Remove `svelte-i18n` from `apps/web/package.json`
- Remove any `import { t } from 'svelte-i18n'` imports
- Remove `import "$lib/i18n"` from layouts

Run: `cd /Users/takala/code/NOJV/apps/web && pnpm remove svelte-i18n`

**Step 4: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm typecheck && pnpm build`
Expected: PASS — any missing translation keys will be TypeScript errors

**Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: migrate all i18n from svelte-i18n to Paraglide.js"
```

---

## Phase 8: BetterAuth Cleanup

### Task 8.1: Remove dev header fallback

**Files:**
- Modify: `apps/web/src/lib/server/auth.ts`

**Step 1: Clean up getActorContext**

Remove the dev header fallback logic (`x-nojv-*` headers).
`getActorContext()` should only read from `event.locals.session` / `event.locals.user` (set by BetterAuth in hooks.server.ts).

**Step 2: Remove ActorSessionControl dev switcher**

If there's a dev-only role switcher component, remove it or gate it properly.

**Step 3: Verify**

Run: `cd /Users/takala/code/NOJV && pnpm typecheck && pnpm build`

**Step 4: Commit**

```bash
git add apps/web/src/lib/server/auth.ts
git commit -m "chore: remove dev header fallback from auth, BetterAuth only"
```

---

## Phase 9: Testing Structure

### Task 9.1: Set up test directory structure

**Files:**
- Create: `apps/web/tests/unit/`
- Create: `apps/web/tests/integration/`
- Create: `apps/web/tests/e2e/`
- Modify: `apps/web/vitest.config.ts`
- Modify: `apps/web/playwright.config.ts`

**Step 1: Create directories**

```bash
mkdir -p apps/web/tests/{unit,integration,e2e/fixtures}
mkdir -p apps/web/tests/integration/{problem,course,submission}
```

**Step 2: Configure Vitest for unit + integration**

Update `apps/web/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node"
  }
});
```

**Step 3: Add a sample unit test**

Create `apps/web/tests/unit/types.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { deriveAssessmentWindowState } from "$lib/types";

describe("deriveAssessmentWindowState", () => {
  it("returns 'upcoming' when now is before opensAt", () => {
    const state = deriveAssessmentWindowState(
      new Date("2099-01-01"),
      new Date("2099-01-02"),
      new Date("2099-01-03"),
      new Date("2024-01-01")
    );
    expect(state).toBe("upcoming");
  });
});
```

**Step 4: Verify test runs**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web test`
Expected: Sample test passes

**Step 5: Commit**

```bash
git add apps/web/tests/ apps/web/vitest.config.ts
git commit -m "feat: set up layered test structure with sample unit test"
```

---

## Execution Order Summary

| Phase | Task | Description | Depends On |
|-------|------|-------------|------------|
| 1 | 1.1 | Remove anti-cheat from Prisma schema | — |
| 1 | 1.2 | Remove anti-cheat from @nojv/core | — |
| 1 | 1.3 | Remove anti-cheat from worker | 1.2 |
| 1 | 1.4 | Remove workspace/integrity from web | 1.1, 1.2 |
| 1 | 1.5 | Update seed script | 1.1 |
| 2 | 2.1 | Create @nojv/sandbox | 1.2 |
| 2 | 2.2 | Create @nojv/queue | 1.2 |
| 2 | 2.3 | Reorganize @nojv/core schemas | 2.1, 2.2 |
| 2 | 2.4 | Update all import paths | 2.1, 2.2, 2.3 |
| 3 | 3.1 | Tooling centralization | — |
| 4 | 4.1 | Route layout groups | 1.4 |
| 4 | 4.2 | Admin layout guard | 4.1 |
| 4 | 4.3 | Course manage layout guard | 4.1 |
| 5 | 5.1 | Split server/db.ts | 1.4 |
| 5 | 5.2 | Split server/queries.ts | 5.1 |
| 5 | 5.3 | Reorganize components | 4.1 |
| 6 | 6.1 | Initialize shadcn-svelte | 5.3 |
| 6 | 6.2 | Replace hand-crafted UI | 6.1 |
| 7 | 7.1 | Install Paraglide | — |
| 7 | 7.2 | Integrate into layouts | 7.1 |
| 7 | 7.3 | Migrate $t() to m.() | 7.2 |
| 8 | 8.1 | BetterAuth cleanup | — |
| 9 | 9.1 | Test structure | 5.2 |

### Parallelizable groups:
- **Group A (independent):** Phase 1 (1.1 + 1.2 can start in parallel), Phase 3, Phase 7.1, Phase 8
- **Group B (after Phase 1):** Phase 2, Phase 4, Phase 5
- **Group C (after Phase 5):** Phase 6, Phase 9
