# Web App Refactor & Simplification Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Drastically simplify `apps/web` by removing over-engineering, migrating API routes to SvelteKit form actions, reorganizing components by feature, and deleting unused packages.

**Architecture:** Replace Next.js-style API routes + client-side fetch mutations with SvelteKit form actions. Flatten `lib/server/` from 16 files into 4 files. Group components into feature subdirectories. Delete `@nojv/i18n` and `@nojv/ui` packages.

**Tech Stack:** SvelteKit, Prisma, better-auth, BullMQ, svelte-i18n, Zod

---

## Overview

### Current State
- `lib/server/` has 16 files across 3 subdirectories (authorization/, data-access/)
- 11 API routes that should be form actions
- 18 components flat in `components/`
- `@nojv/i18n` (unused), `@nojv/ui` (1 use) packages
- `lib/client/course-management-client.ts` for client-side API calls

### Target State
- `lib/server/` has 4 files: `auth.ts`, `db.ts`, `queries.ts`, `queue.ts`
- Form actions in `+page.server.ts` instead of API routes
- Components grouped: `problem/`, `course/`, `manage/`, `auth/`
- `@nojv/i18n` and `@nojv/ui` deleted
- No client-side API client for mutations

### Files to Delete (total)
- `lib/server/api-handler.ts`
- `lib/server/api-errors.ts`
- `lib/server/actor-context.ts`
- `lib/server/persistence-mappers.ts`
- `lib/server/assessment-detail-loader.ts`
- `lib/server/assessment-list-loader.ts`
- `lib/server/authorization/` (entire directory: guards.ts, roles.ts, permissions.ts)
- `lib/server/data-access/` (entire directory: shared.ts, problems.ts, courses.ts, submissions.ts, integrity.ts)
- `lib/client/` (entire directory)
- `lib/auth-onboarding.ts`
- `lib/course-assessment-helpers.ts`
- `lib/problem-types.ts`
- `lib/verdict-colors.ts`
- `lib/form-styles.ts`
- `routes/api/courses/+server.ts`
- `routes/api/courses/[slug]/assessments/+server.ts`
- `routes/api/courses/[slug]/join/+server.ts`
- `routes/api/courses/[slug]/members/+server.ts`
- `routes/api/courses/[slug]/problems/+server.ts`
- `routes/api/problems/+server.ts`
- `routes/api/problems/[slug]/+server.ts`
- `routes/api/problems/[slug]/templates/+server.ts`
- `routes/api/problems/[slug]/testcase-sets/+server.ts`
- `routes/api/integrity/signals/+server.ts`
- `routes/api/runtime/stats/+server.ts`
- `routes/api/auth/send-school-verification/+server.ts`
- `routes/api/auth/verify-school/+server.ts`
- `packages/i18n/` (entire package)
- `packages/ui/` (entire package)
- `messages/` directory (moved to `lib/i18n/`)

### API Routes Kept
- `routes/api/auth/[...path]/+server.ts` — better-auth proxy (required)
- `routes/api/submissions/+server.ts` — async submission + poll URL
- `routes/api/submissions/[submissionId]/+server.ts` — polling endpoint

---

## Task 1: Delete unused packages (`@nojv/i18n`, `@nojv/ui`)

**Files:**
- Delete: `packages/i18n/` (entire directory)
- Delete: `packages/ui/` (entire directory)
- Modify: `apps/web/package.json` — remove `@nojv/i18n` and `@nojv/ui` dependencies
- Modify: `apps/web/src/lib/components/ProblemsTabs.svelte` — inline `formatAcceptanceRate`

**Step 1: Inline `formatAcceptanceRate` in ProblemsTabs.svelte**

Replace the import `import { formatAcceptanceRate } from "@nojv/ui"` with a local function:

```typescript
function formatAcceptanceRate(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}
```

Check the actual implementation in `packages/ui/src/index.ts` first to ensure the inline is correct.

**Step 2: Remove package dependencies from web's package.json**

Remove these lines from `apps/web/package.json` dependencies:
```
"@nojv/i18n": "workspace:*",
"@nojv/ui": "workspace:*",
```

**Step 3: Delete the package directories**

```bash
rm -rf packages/i18n packages/ui
```

**Step 4: Reinstall dependencies**

```bash
pnpm install
```

**Step 5: Verify build**

```bash
cd apps/web && pnpm check
```

**Step 6: Commit**

```bash
git add -A && git commit -m "chore: remove unused @nojv/i18n and @nojv/ui packages"
```

---

## Task 2: Consolidate `lib/server/` into 4 files

This is the core simplification. Merge 16 files into 4.

### Task 2a: Create `lib/server/auth.ts`

**Files:**
- Create: `apps/web/src/lib/server/auth.ts` (NEW — server-side auth utilities)
- Source from:
  - `lib/server/actor-context.ts` (getActorContext, ActorContext, CompletedActorContext)
  - `lib/auth-onboarding.ts` (readHandleFromAuthUser, hasActorHandle, hasCompletedHandle, isValidHandle, HANDLE_INPUT_PATTERN, readPlatformRole)
  - `lib/server/api-errors.ts` (HttpError, NotFoundError, ConflictError, ForbiddenError)
  - `lib/server/authorization/guards.ts` (requireAuth, requirePlatformRole, requireCourseRole)
  - `lib/server/authorization/roles.ts` (resolveCoursePermissionRole, resolveCoursePermission, getCoursePermissionRole)
  - `lib/server/authorization/permissions.ts` (canCreateCourse, isCourseStaff)

**Step 1: Write `lib/server/auth.ts`**

Combine all auth/authorization logic into one file. The file should export:
- Types: `ActorContext`, `CompletedActorContext`
- Error classes: `HttpError`, `NotFoundError`, `ConflictError`, `ForbiddenError`
- Actor: `getActorContext(event)`, `hasActorHandle(actor)`
- Guards: `requireAuth(event)`, `requirePlatformRole(actor, ...roles)`, `requireCourseRole(actor, courseSlug, ...roles)`
- Permissions: `canCreateCourse(platformRole)`, `isCourseStaff(role)`
- Onboarding: `readHandleFromAuthUser(user)`, `hasCompletedHandle(user)`, `isValidHandle(value)`, `HANDLE_INPUT_PATTERN`

```typescript
// apps/web/src/lib/server/auth.ts
import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { prisma, type TransactionClient } from "@nojv/db";
import {
  platformRoleSchema,
  type CourseRole,
  type EffectiveCourseRole,
  type PlatformRole
} from "@nojv/domain";

// --- Error classes ---

export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found.") { super(message, 404); }
}

export class ConflictError extends HttpError {
  constructor(message = "Resource already exists.") { super(message, 409); }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden.") { super(message, 403); }
}

// --- Actor context ---

export interface ActorContext {
  displayName: string;
  email: string;
  handle: string | null;
  platformRole: PlatformRole;
  userId: string;
}

export type CompletedActorContext = ActorContext & { handle: string };

function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readHandleFromAuthUser(user: Record<string, unknown>): string | null {
  const handle = readStringValue(user.username);
  return handle && handle.length > 0 ? handle : null;
}

export function readPlatformRole(user: unknown): string {
  return readStringValue((user as Record<string, unknown> | undefined)?.platformRole) ?? "student";
}

export function hasCompletedHandle(user: Record<string, unknown>): boolean {
  return readHandleFromAuthUser(user) !== null;
}

export function hasActorHandle<T extends { handle: string | null }>(
  actor: T
): actor is T & { handle: string } {
  return typeof actor.handle === "string" && actor.handle.length > 0;
}

export const HANDLE_INPUT_PATTERN = "[a-z0-9._-]{3,64}";
const handlePattern = /^[a-z0-9._-]{3,64}$/;

export function isValidHandle(value: string): boolean {
  return handlePattern.test(value);
}

export function getActorContext(event: RequestEvent): ActorContext | null {
  const user = event.locals.user;
  if (!user) return null;

  const extra = user as Record<string, unknown>;
  const parsedRole = platformRoleSchema.safeParse(extra.platformRole);

  return {
    displayName: user.name,
    email: user.email,
    handle: readHandleFromAuthUser(extra),
    platformRole: parsedRole.success ? parsedRole.data : "student",
    userId: user.id
  };
}

// --- Guards ---

export async function requireAuth(event: RequestEvent, redirectTo?: string): Promise<CompletedActorContext> {
  const actor = getActorContext(event);
  if (!actor) redirect(302, redirectTo ?? "/");
  if (!actor.handle) redirect(302, "/auth/complete-profile");
  return actor as CompletedActorContext;
}

export function requirePlatformRole(actor: ActorContext, ...roles: PlatformRole[]): void {
  if (!roles.includes(actor.platformRole)) {
    throw new ForbiddenError("Insufficient platform role.");
  }
}

// --- Course role resolution ---

export function resolveCoursePermissionRole(input: {
  courseRole?: CourseRole | null;
  platformRole: PlatformRole;
}): EffectiveCourseRole | null {
  if (input.platformRole === "admin") return "admin";
  return input.courseRole ?? null;
}

export async function getCoursePermissionRole(courseSlug: string, actor: ActorContext) {
  const course = await prisma.course.findUnique({ where: { slug: courseSlug } });
  if (!course) throw new NotFoundError(`Course not found: ${courseSlug}`);

  const membership = await prisma.courseMembership.findUnique({
    where: { courseId_userId: { courseId: course.id, userId: actor.userId } }
  });

  return resolveCoursePermissionRole({
    courseRole: membership?.role ?? null,
    platformRole: actor.platformRole
  });
}

export async function requireCourseRole(
  actor: ActorContext,
  courseSlug: string,
  ...roles: EffectiveCourseRole[]
): Promise<EffectiveCourseRole> {
  const role = await getCoursePermissionRole(courseSlug, actor);
  if (!role || !roles.includes(role)) {
    throw new ForbiddenError("Insufficient course role.");
  }
  return role;
}

// --- Permission checks ---

export function canCreateCourse(platformRole: PlatformRole) {
  return platformRole === "admin" || platformRole === "teacher";
}

export function isCourseStaff(role: EffectiveCourseRole) {
  return role === "admin" || role === "teacher" || role === "ta";
}

export { isReservedHandle } from "$lib/school.ts";
```

**Step 2: Verify no compile errors**

```bash
cd apps/web && pnpm check
```

### Task 2b: Create `lib/server/db.ts`

**Files:**
- Create: `apps/web/src/lib/server/db.ts` (NEW — all data mutations)
- Source from:
  - `lib/server/data-access/shared.ts` (ensureUser, createProblemDefinition, requireProblem, requireCourse, requireContest, requireCourseAssessment, ensureContestParticipation, assertCourseProblemAccess, sanitizeIdentitySegment, getRuntimeStats)
  - `lib/server/data-access/problems.ts` (createProblemRecord, updateProblemRecord, createProblemTestcaseSetRecord, replaceTemplates)
  - `lib/server/data-access/courses.ts` (createCourseRecord, joinCourseRecord, manuallyEnrollCourseMember, attachProblemToCourseRecord, createCourseAssessmentRecord)
  - `lib/server/data-access/submissions.ts` (createQueuedSubmissionRecord)
  - `lib/server/data-access/integrity.ts` (persistCheatingSignals)

**Step 1: Write `lib/server/db.ts`**

Consolidate all data-access files into one file. Keep the same function signatures. Organize with comment section headers:

```
// --- Shared helpers ---
// --- Problem mutations ---
// --- Course mutations ---
// --- Submission mutations ---
// --- Integrity ---
```

Import errors from `./auth` instead of `../api-errors`. Import `DEFAULT_LOCALE` from `$lib/i18n`. Replace `import { ... } from "../persistence-mappers"` with direct `import { ... } from "@nojv/db"`.

**Step 2: Verify no compile errors**

```bash
cd apps/web && pnpm check
```

### Task 2c: Create `lib/server/queries.ts`

**Files:**
- Create: `apps/web/src/lib/server/queries.ts` (NEW — all read-only queries)
- Source from:
  - `lib/server/read-model.ts` (all exported query functions + types + mapping helpers)
  - `lib/server/assessment-detail-loader.ts` (createAssessmentDetailLoader)
  - `lib/server/assessment-list-loader.ts` (createAssessmentListLoader)

**Step 1: Write `lib/server/queries.ts`**

Move the entire content of `read-model.ts` here, plus absorb the two assessment loader functions. Replace imports:
- `from "../problem-types"` → `from "$lib/types"`
- `from "../i18n"` → `from "$lib/i18n"`
- Add the assessment loader imports: `from "$lib/types"` for `deriveAssessmentWindowState`, `deriveAssessmentPresentation`, `windowStateColorClass`

**Step 2: Verify no compile errors**

```bash
cd apps/web && pnpm check
```

### Task 2d: Delete old files

**Step 1: Delete all replaced files**

```bash
cd apps/web/src/lib
rm -rf server/api-handler.ts server/api-errors.ts server/actor-context.ts
rm -rf server/persistence-mappers.ts
rm -rf server/assessment-detail-loader.ts server/assessment-list-loader.ts
rm -rf server/authorization/
rm -rf server/data-access/
rm -rf server/read-model.ts
rm -rf client/
rm -f auth-onboarding.ts course-assessment-helpers.ts problem-types.ts verdict-colors.ts form-styles.ts
```

**Step 2: Verify build**

```bash
cd apps/web && pnpm check
```

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor: consolidate lib/server/ from 16 files to 4"
```

---

## Task 3: Create `lib/types.ts` (merged utility types)

**Files:**
- Create: `apps/web/src/lib/types.ts`
- Source from:
  - `lib/problem-types.ts` (TemplateInfo, ProblemDetail, ContestDetail, starterByLanguage)
  - `lib/verdict-colors.ts` (verdictColor, formatVerdictLabel)
  - `lib/course-assessment-helpers.ts` (AssessmentWindowState, deriveAssessmentWindowState, deriveAssessmentPresentation, windowStateColorClass, AssessmentPresentation)

**Step 1: Write `lib/types.ts`**

Combine all three files into one, organized with section headers:

```
// --- Problem types ---
// --- Verdict display ---
// --- Assessment helpers ---
```

**Step 2: Verify no compile errors**

```bash
cd apps/web && pnpm check
```

---

## Task 4: Reorganize i18n and messages

**Files:**
- Move: `messages/en.json` → `apps/web/src/lib/i18n/en.json`
- Move: `messages/zh-TW.json` → `apps/web/src/lib/i18n/zh-TW.json`
- Modify: `apps/web/src/lib/i18n/index.ts` — update import paths
- Delete: `messages/` directory

**Step 1: Move message files**

```bash
mv apps/web/messages/en.json apps/web/src/lib/i18n/en.json
mv apps/web/messages/zh-TW.json apps/web/src/lib/i18n/zh-TW.json
rmdir apps/web/messages
```

**Step 2: Update `i18n/index.ts` import paths**

Change:
```typescript
register("en", () => import("../../../messages/en.json"));
register("zh-TW", () => import("../../../messages/zh-TW.json"));
```
To:
```typescript
register("en", () => import("./en.json"));
register("zh-TW", () => import("./zh-TW.json"));
```

**Step 3: Verify build**

```bash
cd apps/web && pnpm check
```

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: move i18n messages into lib/i18n/, create lib/types.ts"
```

---

## Task 5: Rename `school-verification.ts` → `school.ts`

**Files:**
- Rename: `lib/school-verification.ts` → `lib/school.ts`
- Update all imports referencing the old path

**Step 1: Rename file**

```bash
mv apps/web/src/lib/school-verification.ts apps/web/src/lib/school.ts
```

**Step 2: Update imports**

Search for `$lib/school-verification` and replace with `$lib/school` in all files. Key files:
- `lib/server/auth.ts` (the re-export)
- `routes/account/+page.server.ts`

**Step 3: Verify build**

```bash
cd apps/web && pnpm check
```

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: rename school-verification.ts to school.ts"
```

---

## Task 6: Reorganize components by feature

**Files:**
- Create directories: `components/problem/`, `components/course/`, `components/manage/`, `components/auth/`
- Move and rename components:

```
components/ProblemWorkspace.svelte     → components/problem/Workspace.svelte
components/ProblemEditor.svelte        → components/problem/Editor.svelte
components/ProblemCreationPanel.svelte  → components/problem/CreationPanel.svelte
components/ProblemsTabs.svelte         → components/problem/Tabs.svelte

components/CourseAssessmentBoard.svelte → components/course/AssessmentBoard.svelte
components/CourseJoinPanel.svelte       → components/course/JoinPanel.svelte
components/CourseJoinCallToAction.svelte → components/course/JoinCallToAction.svelte
components/CourseProblemShelf.svelte    → components/course/ProblemShelf.svelte

components/ManageProblems.svelte       → components/manage/Problems.svelte
components/ManageMembers.svelte        → components/manage/Members.svelte
components/ManageAssessments.svelte    → components/manage/Assessments.svelte

components/UserAuthMenu.svelte         → components/auth/UserMenu.svelte
components/OAuthButtons.svelte         → components/auth/OAuthButtons.svelte
components/SchoolVerificationSection.svelte → components/auth/SchoolVerification.svelte
```

Keep at top level:
```
components/Header.svelte
components/MarkdownRenderer.svelte
components/TelemetryProbe.svelte
components/AssessmentListView.svelte
```

**Step 1: Create directories and move files**

```bash
cd apps/web/src/lib/components
mkdir -p problem course manage auth

mv ProblemWorkspace.svelte problem/Workspace.svelte
mv ProblemEditor.svelte problem/Editor.svelte
mv ProblemCreationPanel.svelte problem/CreationPanel.svelte
mv ProblemsTabs.svelte problem/Tabs.svelte

mv CourseAssessmentBoard.svelte course/AssessmentBoard.svelte
mv CourseJoinPanel.svelte course/JoinPanel.svelte
mv CourseJoinCallToAction.svelte course/JoinCallToAction.svelte
mv CourseProblemShelf.svelte course/ProblemShelf.svelte

mv ManageProblems.svelte manage/Problems.svelte
mv ManageMembers.svelte manage/Members.svelte
mv ManageAssessments.svelte manage/Assessments.svelte

mv UserAuthMenu.svelte auth/UserMenu.svelte
mv OAuthButtons.svelte auth/OAuthButtons.svelte
mv SchoolVerificationSection.svelte auth/SchoolVerification.svelte
```

**Step 2: Update ALL imports across the codebase**

Search for every import of `$lib/components/ProblemWorkspace` and replace with `$lib/components/problem/Workspace`, etc. This affects all `+page.svelte` files and any cross-component imports.

Key mapping:
```
$lib/components/ProblemWorkspace      → $lib/components/problem/Workspace
$lib/components/ProblemEditor         → $lib/components/problem/Editor
$lib/components/ProblemCreationPanel  → $lib/components/problem/CreationPanel
$lib/components/ProblemsTabs          → $lib/components/problem/Tabs
$lib/components/CourseAssessmentBoard → $lib/components/course/AssessmentBoard
$lib/components/CourseJoinPanel       → $lib/components/course/JoinPanel
$lib/components/CourseJoinCallToAction → $lib/components/course/JoinCallToAction
$lib/components/CourseProblemShelf    → $lib/components/course/ProblemShelf
$lib/components/ManageProblems        → $lib/components/manage/Problems
$lib/components/ManageMembers         → $lib/components/manage/Members
$lib/components/ManageAssessments     → $lib/components/manage/Assessments
$lib/components/UserAuthMenu          → $lib/components/auth/UserMenu
$lib/components/OAuthButtons          → $lib/components/auth/OAuthButtons
$lib/components/SchoolVerificationSection → $lib/components/auth/SchoolVerification
```

**Step 3: Verify build**

```bash
cd apps/web && pnpm check
```

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: organize components into feature subdirectories"
```

---

## Task 7: Migrate API routes to form actions

This is the largest task. Each API route becomes a form action in the corresponding `+page.server.ts`.

### Task 7a: Course mutations → form actions

**Files:**
- Delete: `routes/api/courses/+server.ts`
- Delete: `routes/api/courses/[slug]/assessments/+server.ts`
- Delete: `routes/api/courses/[slug]/join/+server.ts`
- Delete: `routes/api/courses/[slug]/members/+server.ts`
- Delete: `routes/api/courses/[slug]/problems/+server.ts`
- Modify: `routes/courses/+page.server.ts` — add `create` action
- Modify: `routes/courses/[slug]/manage/assessments/+page.server.ts` — add `create` action
- Modify: `routes/courses/[slug]/join/[token]/+page.server.ts` — add `join` action
- Modify: `routes/courses/[slug]/manage/members/+page.server.ts` — add `enroll` action
- Modify: `routes/courses/[slug]/manage/problems/+page.server.ts` — add `attach` action
- Modify: components that used client-side fetch to use `use:enhance` form submission

**Step 1: Add form actions to page server files**

For each page, add an `actions` export. Example for courses:

```typescript
// routes/courses/+page.server.ts
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { courseCreateSchema } from "@nojv/domain";
import { createCourseRecord } from "$lib/server/db";
import { canCreateCourse, getActorContext, requireAuth } from "$lib/server/auth";
import { listCourseCards, listUserCourseCards } from "$lib/server/queries";

export const load: PageServerLoad = async (event) => {
  const actor = getActorContext(event);
  const isStaff = actor ? canCreateCourse(actor.platformRole) : false;
  const courses = isStaff
    ? await listCourseCards()
    : actor
      ? await listUserCourseCards(actor.userId)
      : [];
  return { courses };
};

export const actions: Actions = {
  create: async (event) => {
    const actor = await requireAuth(event);
    if (!canCreateCourse(actor.platformRole)) {
      return fail(403, { error: "Only teachers or admins can create courses." });
    }
    const data = await event.request.json();
    const payload = courseCreateSchema.parse(data);
    const result = await createCourseRecord(actor, payload);
    return { success: true, slug: result.course.slug };
  }
};
```

Apply the same pattern for all 5 course-related API routes.

**Step 2: Update components to use form actions**

Components that previously called `createCourseMutation()`, `joinCourseMutation()`, etc. from `course-management-client.ts` should now submit forms. Two approaches:
- Use SvelteKit's `use:enhance` for progressive enhancement
- Or use `fetch` to POST to `?/actionName` for components that need JSON payloads

For complex JSON payloads (like assessments with nested arrays), use fetch to the form action:

```typescript
const response = await fetch('?/create', {
  method: 'POST',
  body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json' }
});
```

**Step 3: Delete old API route files**

```bash
rm -rf apps/web/src/routes/api/courses/
```

**Step 4: Verify build**

```bash
cd apps/web && pnpm check
```

### Task 7b: Problem mutations → form actions

**Files:**
- Delete: `routes/api/problems/+server.ts`
- Delete: `routes/api/problems/[slug]/+server.ts`
- Delete: `routes/api/problems/[slug]/templates/+server.ts`
- Delete: `routes/api/problems/[slug]/testcase-sets/+server.ts`
- Modify: `routes/problems/create/+page.server.ts` — add `create` action
- Modify: `routes/problems/[slug]/edit/+page.server.ts` — add `update`, `updateTemplates`, `createTestcaseSet` actions

**Step 1: Add form actions**

```typescript
// routes/problems/create/+page.server.ts
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { problemCreateSchema } from "@nojv/domain";
import { createProblemRecord } from "$lib/server/db";
import { requireAuth } from "$lib/server/auth";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, "/problems");
  return {};
};

export const actions: Actions = {
  create: async (event) => {
    const actor = await requireAuth(event);
    const data = await event.request.json();
    const payload = problemCreateSchema.parse(data);
    const problem = await createProblemRecord(actor, payload);
    return { success: true, slug: problem.slug };
  }
};
```

For edit page, add multiple actions (`update`, `updateTemplates`, `createTestcaseSet`).

**Step 2: Update ProblemCreationPanel and ProblemEditor components**

Replace `fetch("/api/problems", ...)` calls with `fetch("?/create", ...)` or form submission.

**Step 3: Delete old API route files**

```bash
rm -f apps/web/src/routes/api/problems/+server.ts
rm -rf apps/web/src/routes/api/problems/[slug]/
```

Note: Keep `routes/api/problems/` directory only if it has remaining files. Check first.

**Step 4: Verify build**

```bash
cd apps/web && pnpm check
```

### Task 7c: Auth-related API routes → form actions

**Files:**
- Delete: `routes/api/auth/send-school-verification/+server.ts`
- Delete: `routes/api/auth/verify-school/+server.ts`
- Modify: `routes/auth/signup/+page.server.ts` — add `sendVerification` action (or create this file)
- Modify: `routes/auth/complete-profile/+page.server.ts` — add `verifySchool` action

Move the school verification logic (send email via Resend, verify token) into form actions.

**Step 1: Move school verification send into auth route**

Create `routes/auth/signup/+page.server.ts` if it doesn't exist, with a `sendVerification` action.

**Step 2: Move verify-school into complete-profile or a dedicated page**

Note: verify-school is a GET endpoint (email callback link). This can't be a form action. Options:
- Keep it as a standalone `+server.ts` at a different path
- Or convert to a `+page.server.ts` load function that processes the token

Recommended: Move to `routes/auth/verify-school/+page.server.ts` as a load function that processes the token and redirects.

**Step 3: Delete old API route files**

```bash
rm -rf apps/web/src/routes/api/auth/send-school-verification/
rm -rf apps/web/src/routes/api/auth/verify-school/
```

**Step 4: Verify build**

```bash
cd apps/web && pnpm check
```

### Task 7d: Remove remaining unused API routes

**Files:**
- Delete: `routes/api/integrity/` (entire directory — TelemetryProbe not active)
- Delete: `routes/api/runtime/` (entire directory — stats not actively needed)

**Step 1: Delete**

```bash
rm -rf apps/web/src/routes/api/integrity/
rm -rf apps/web/src/routes/api/runtime/
```

**Step 2: Update TelemetryProbe component**

If TelemetryProbe references `/api/integrity/signals`, remove that fetch call. The component already renders null, so it may be safe to simplify it further or delete it entirely.

**Step 3: Verify build**

```bash
cd apps/web && pnpm check
```

**Step 4: Commit all form action migration**

```bash
git add -A && git commit -m "refactor: migrate API routes to SvelteKit form actions"
```

---

## Task 8: Simplify remaining API routes

**Files:**
- Modify: `routes/api/submissions/+server.ts` — inline auth logic (no more `withAuth`)
- Modify: `routes/api/submissions/[submissionId]/+server.ts` — inline auth logic

**Step 1: Inline auth in submission routes**

Replace `withAuth(handler)` pattern with direct auth checks:

```typescript
// routes/api/submissions/+server.ts
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getActorContext, hasActorHandle, HttpError } from "$lib/server/auth";
import { ZodError } from "zod";

export const POST: RequestHandler = async (event) => {
  try {
    const actor = getActorContext(event);
    if (!actor) return json({ message: "Authentication required." }, { status: 401 });
    if (!hasActorHandle(actor)) return json({ message: "Complete your handle first." }, { status: 403 });

    // ... existing handler logic
  } catch (error) {
    if (error instanceof ZodError) return json({ issues: error.issues }, { status: 400 });
    if (error instanceof HttpError) return json({ message: error.message }, { status: error.status });
    return json({ message: "Internal server error." }, { status: 500 });
  }
};
```

**Step 2: Verify build**

```bash
cd apps/web && pnpm check
```

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor: inline auth in remaining API routes"
```

---

## Task 9: Update all import paths across routes and components

After all the structural changes, do a comprehensive import sweep.

**Step 1: Search and fix all broken imports**

Key replacements:
```
$lib/server/read-model          → $lib/server/queries
$lib/server/actor-context       → $lib/server/auth
$lib/server/api-errors          → $lib/server/auth
$lib/server/api-handler         → (deleted, inlined)
$lib/server/authorization/guards → $lib/server/auth
$lib/server/authorization/permissions → $lib/server/auth
$lib/server/authorization/roles  → $lib/server/auth
$lib/server/data-access/shared   → $lib/server/db
$lib/server/data-access/problems → $lib/server/db
$lib/server/data-access/courses  → $lib/server/db
$lib/server/data-access/submissions → $lib/server/db
$lib/server/data-access/integrity → $lib/server/db
$lib/server/persistence-mappers  → @nojv/db (direct)
$lib/server/assessment-detail-loader → $lib/server/queries
$lib/server/assessment-list-loader → $lib/server/queries
$lib/client/course-management-client → (deleted, use form actions)
$lib/auth-onboarding            → $lib/server/auth
$lib/problem-types              → $lib/types
$lib/verdict-colors             → $lib/types
$lib/course-assessment-helpers  → $lib/types
$lib/form-styles                → (deleted, inline classes)
$lib/school-verification        → $lib/school
@nojv/ui                        → (deleted, inlined)
@nojv/i18n                      → (deleted)
```

**Step 2: Run full check**

```bash
cd apps/web && pnpm check
```

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor: fix all import paths after restructure"
```

---

## Task 10: Inline form-styles and clean up

**Step 1: Find all usages of form-styles imports**

Search for `$lib/form-styles` and replace with inline Tailwind classes.

The three constants were:
```
inputClassName = "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
authInputClassName = "rounded-lg border border-[color:var(--color-border)] px-3 py-2"
submitButtonClassName = "rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
```

Inline these directly in the components that use them.

**Step 2: Verify build**

```bash
cd apps/web && pnpm check
```

**Step 3: Final commit**

```bash
git add -A && git commit -m "refactor: inline form styles, complete web app simplification"
```

---

## Task 11: Final verification

**Step 1: Full type check**

```bash
cd apps/web && pnpm check
```

**Step 2: Lint**

```bash
cd apps/web && pnpm lint
```

**Step 3: Run tests**

```bash
cd apps/web && pnpm test
```

**Step 4: Dev server smoke test**

```bash
cd apps/web && pnpm dev
```

Manually verify:
- Home page loads
- Problems page loads
- Course page loads
- Auth pages load

**Step 5: Verify worker still builds** (packages unchanged)

```bash
cd apps/worker && pnpm check
```

---

## Summary of changes

| Metric | Before | After |
|--------|--------|-------|
| `lib/server/` files | 16 | 4 |
| `lib/server/` directories | 3 | 0 |
| `lib/` root utility files | 7 | 3 (`auth-client.ts`, `types.ts`, `school.ts`) |
| API route files | 16 | 3 |
| Component directories | 0 | 4 |
| Packages | 5 | 3 |
| Total web files | ~104 | ~65 |
