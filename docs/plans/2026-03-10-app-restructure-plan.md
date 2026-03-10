# App Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the NOJV platform to align with the new identity model (Admin/Teacher/Student only), allow everyone to create problems, add two-tab problems page, and create cross-course assignment/exam aggregation pages.

**Architecture:** Remove `ta` from PlatformRole (TA is course-level only). Update navigation to Homepage/Problems/Courses/Assignments/Exams. Add queries for "my problems" and cross-course assessments. Add exam restriction fields (page lock, IP lock).

**Tech Stack:** Next.js 16, Prisma, PostgreSQL, next-intl, TailwindCSS, Vitest

**Design Document:** `docs/plans/2026-03-10-app-restructure-design.md`

---

## Task 1: Remove `ta` from PlatformRole enum

**Files:**

- Modify: `packages/db/prisma/schema.prisma:80-85`
- Modify: `packages/domain/src/index.ts:13`
- Modify: `packages/domain/src/index.ts:111-140` (localActorPresets)
- Modify: `apps/web/src/components/actor-session-provider.tsx:16-37`

**Step 1: Update Prisma schema — remove `ta` from PlatformRole**

In `packages/db/prisma/schema.prisma`, change:

```prisma
enum PlatformRole {
  admin
  teacher
  student
}
```

(Remove the `ta` line.)

**Step 2: Update domain types — remove `ta` from platformRoles**

In `packages/domain/src/index.ts`, change line 13:

```typescript
export const platformRoles = ["admin", "teacher", "student"] as const;
```

Also update `effectiveCourseRoles` (line 15) — keep as-is since `admin` is still a valid effective role and `ta` is still a valid course role.

**Step 3: Update localActorPresets — change TA preset to Student platformRole**

In `packages/domain/src/index.ts`, change the `ta` preset (lines 126-131):

```typescript
  ta: actorIdentitySchema.parse({
    displayName: "Ren Wu",
    email: "ren.wu@nojv.local",
    handle: "ta_ren",
    platformRole: "student",
    userId: "usr_ta_ren"
  }),
```

**Step 4: Update ActorSessionControl presets**

In `apps/web/src/components/actor-session-provider.tsx`, update the TA entry label to clarify it's a student with TA course role:

```typescript
  {
    actor: localActorPresets.ta,
    key: "ta",
    label: "TA (student)"
  },
```

**Step 5: Create migration to convert existing `ta` platform roles to `student`**

Run:

```bash
cd /Users/takala/code/NOJV && pnpm db:generate
```

Then create a manual SQL migration:

```sql
-- Convert existing platform-level TA users to student
UPDATE "User" SET "platformRole" = 'student' WHERE "platformRole" = 'ta';
-- Now safe to remove the enum value
ALTER TYPE "PlatformRole" RENAME TO "PlatformRole_old";
CREATE TYPE "PlatformRole" AS ENUM ('admin', 'teacher', 'student');
ALTER TABLE "User" ALTER COLUMN "platformRole" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "platformRole" TYPE "PlatformRole" USING "platformRole"::text::"PlatformRole";
ALTER TABLE "User" ALTER COLUMN "platformRole" SET DEFAULT 'student';
DROP TYPE "PlatformRole_old";
```

**Step 6: Verify build**

Run:

```bash
cd /Users/takala/code/NOJV && pnpm build --filter=@nojv/domain && pnpm build --filter=@nojv/db
```

**Step 7: Fix all references to platform role `ta`**

Search for `"ta"` references in platform role contexts:

- `apps/web/src/lib/server/read-model.ts:154` — `mapCourseMember` type has `"admin" | "student" | "ta" | "teacher"` — change to `"admin" | "student" | "teacher"`
- `apps/web/src/lib/server/actor-context.ts` — dev fallback defaults to "student", no change needed
- `apps/web/tests/problem-testcase-routes.test.ts:26` — mock has `"admin" | "student" | "ta" | "teacher"` — update to `"admin" | "student" | "teacher"`
- `apps/web/tests/course-authorization.test.ts` — update any test referencing platform ta

**Step 8: Run tests**

```bash
cd /Users/takala/code/NOJV && pnpm test
```

**Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/domain/src/index.ts apps/web/src/components/actor-session-provider.tsx apps/web/src/lib/server/read-model.ts apps/web/tests/
git commit -m "refactor: remove ta from PlatformRole — TA is course-level only"
```

---

## Task 2: Add exam restriction fields to CourseAssessment

**Files:**

- Modify: `packages/db/prisma/schema.prisma:361-387`
- Modify: `packages/domain/src/index.ts` (courseAssessmentCreateSchema)

**Step 1: Add fields to CourseAssessment model in schema**

In `packages/db/prisma/schema.prisma`, add after `scoreboardMode` field (line 369):

```prisma
  pageLockEnabled Boolean                       @default(false)
  ipLockEnabled   Boolean                       @default(false)
```

**Step 2: Update courseAssessmentCreateSchema in domain**

In `packages/domain/src/index.ts`, add to `courseAssessmentCreateSchema` object (inside `.object({...})`):

```typescript
    ipLockEnabled: z.boolean().default(false),
    pageLockEnabled: z.boolean().default(false),
```

**Step 3: Generate Prisma client and create migration**

```bash
cd /Users/takala/code/NOJV && pnpm db:generate
```

**Step 4: Verify build**

```bash
cd /Users/takala/code/NOJV && pnpm build --filter=@nojv/domain && pnpm build --filter=@nojv/db
```

**Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/domain/src/index.ts
git commit -m "feat: add pageLockEnabled and ipLockEnabled fields to CourseAssessment"
```

---

## Task 3: Update seed data to match design (4 accounts)

**Files:**

- Modify: `packages/db/prisma/seed.ts`

**Step 1: Rewrite seed to 4 accounts matching design**

Replace user creation section with 4 accounts:

| Handle     | Display Name | Platform Role | Password    |
| ---------- | ------------ | ------------- | ----------- |
| admin      | Admin        | admin         | password123 |
| teacher    | Teacher      | teacher       | password123 |
| ta-student | TA Student   | student       | password123 |
| student    | Student      | student       | password123 |

User IDs:

- `usr_admin` (admin)
- `usr_teacher` (teacher)
- `usr_ta_student` (student — to be promoted to TA in course)
- `usr_student` (student)

Update all course memberships accordingly:

- Course owner: `usr_teacher`
- Course teacher membership: `usr_teacher`
- Course TA membership: `usr_ta_student` (courseRole: `ta`)
- Course student membership: `usr_student`

Keep problems, contests, assessments structure similar but authored by `usr_teacher`.

**Step 2: Run seed to verify**

```bash
cd /Users/takala/code/NOJV && pnpm db:seed
```

**Step 3: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "refactor: simplify seed to 4 accounts matching app restructure design"
```

---

## Task 4: Update permissions — everyone can create problems

**Files:**

- Modify: `apps/web/src/lib/server/authorization/permissions.ts:7-9`
- Modify: `apps/web/src/app/api/problems/route.ts:10-12`
- Modify: `apps/web/src/app/api/problems/[slug]/testcase-sets/route.ts:10-12`
- Modify: `apps/web/tests/course-authorization.test.ts`

**Step 1: Update the test first (TDD)**

In `apps/web/tests/course-authorization.test.ts`, update the canCreateProblem test:

```typescript
it("allows all authenticated users to create problems", () => {
  expect(canCreateProblem("teacher")).toBe(true);
  expect(canCreateProblem("admin")).toBe(true);
  expect(canCreateProblem("student")).toBe(true);
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/takala/code/NOJV && pnpm vitest run apps/web/tests/course-authorization.test.ts
```

Expected: FAIL — student returns false

**Step 3: Update canCreateProblem to always return true**

In `apps/web/src/lib/server/authorization/permissions.ts`:

```typescript
export function canCreateProblem(_platformRole: PlatformRole) {
  return true;
}
```

**Step 4: Update API route error messages**

In `apps/web/src/app/api/problems/route.ts`, remove the canCreateProblem guard entirely (or keep for unauthenticated — but `withAuth` already handles that). Remove lines 10-12:

```typescript
// Remove: if (!canCreateProblem(actor.platformRole)) { ... }
```

In `apps/web/src/app/api/problems/[slug]/testcase-sets/route.ts`, keep the guard but update message:

```typescript
// Keep: testcase management still requires problem authorship check
// The canCreateProblem check here is actually wrong — should check problem ownership
// For now, remove the guard since withAuth ensures authentication
```

Actually, looking at this more carefully: `canCreateProblem` is used as a gate for both creating problems AND managing testcases. The design says everyone can create problems. For testcase management, the check should be whether the user is the problem author or has edit permission. For this task, just remove the `canCreateProblem` guards from both routes since `withAuth` already ensures authentication. Problem ownership checks are handled by `assertCourseProblemAccess` in persistence.

**Step 5: Update the mock in problem-testcase-routes.test.ts**

In `apps/web/tests/problem-testcase-routes.test.ts`, update the mock:

```typescript
canCreateProblem: vi.fn(() => true);
```

**Step 6: Run tests**

```bash
cd /Users/takala/code/NOJV && pnpm vitest run
```

**Step 7: Commit**

```bash
git add apps/web/src/lib/server/authorization/permissions.ts apps/web/src/app/api/problems/ apps/web/tests/
git commit -m "feat: allow all authenticated users to create problems"
```

---

## Task 5: Update navigation to match design

**Files:**

- Modify: `apps/web/src/app/[locale]/layout.tsx:36-43`
- Modify: `apps/web/messages/en.json` (navigation section)
- Modify: `apps/web/messages/zh-TW.json` (navigation section)

**Step 1: Add i18n keys for assignments and exams navigation**

In `apps/web/messages/en.json`, update `navigation`:

```json
"navigation": {
  "assignments": "Assignments",
  "courses": "Courses",
  "dashboard": "Overview",
  "exams": "Exams",
  "problems": "Problems"
}
```

In `apps/web/messages/zh-TW.json`, update `navigation`:

```json
"navigation": {
  "assignments": "作業",
  "courses": "課程",
  "dashboard": "總覽",
  "exams": "考試",
  "problems": "題庫"
}
```

Remove `contests`, `submissions`, `integrity`, `workspace` from both files' navigation section.

**Step 2: Update navItems in layout**

In `apps/web/src/app/[locale]/layout.tsx`, replace navItems:

```typescript
const navItems = [
  { href: `/${locale}`, label: tNav("dashboard") },
  { href: `/${locale}/problems`, label: tNav("problems") },
  { href: `/${locale}/courses`, label: tNav("courses") },
  { href: `/${locale}/assignments`, label: tNav("assignments") },
  { href: `/${locale}/exams`, label: tNav("exams") }
];
```

**Step 3: Verify dev server renders correctly**

```bash
cd /Users/takala/code/NOJV && pnpm dev --filter=web
```

Navigate to `http://localhost:3000` and confirm nav shows: Overview / Problems / Courses / Assignments / Exams

**Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/layout.tsx apps/web/messages/
git commit -m "feat: update navigation to Homepage/Problems/Courses/Assignments/Exams"
```

---

## Task 6: Problems page — two tabs (Public Library / My Problems)

**Files:**

- Modify: `apps/web/src/lib/server/read-model.ts` (add `listEditableProblems` query)
- Modify: `apps/web/src/app/[locale]/problems/page.tsx`
- Create: `apps/web/src/components/problems-tabs.tsx` (client component for tab switching)
- Modify: `apps/web/messages/en.json` (add problems tab labels)
- Modify: `apps/web/messages/zh-TW.json`

**Step 1: Add i18n keys for problem tabs**

In `apps/web/messages/en.json`, add a `problems` section:

```json
"problems": {
  "createNew": "Create new problem",
  "empty": "No problems yet.",
  "myProblems": "My Problems",
  "myProblemsEmpty": "You haven't created any problems yet.",
  "publicLibrary": "Public Library"
}
```

In `apps/web/messages/zh-TW.json`:

```json
"problems": {
  "createNew": "建立新題目",
  "empty": "尚無題目。",
  "myProblems": "我的題目",
  "myProblemsEmpty": "你尚未建立任何題目。",
  "publicLibrary": "公開題庫"
}
```

**Step 2: Add `listEditableProblems` query to read-model**

In `apps/web/src/lib/server/read-model.ts`, add:

```typescript
export async function listEditableProblems(userId: string) {
  const problems = await prisma.problem.findMany({
    include: {
      _count: { select: { submissions: true } }
    },
    orderBy: { createdAt: "desc" },
    where: {
      OR: [
        { authorId: userId },
        {
          assessmentLinks: {
            some: {
              assessment: {
                course: {
                  memberships: {
                    some: {
                      userId,
                      role: { in: ["teacher", "ta"] },
                      status: "active"
                    }
                  }
                }
              }
            }
          }
        }
      ]
    }
  });

  return problems.map((problem) => ({
    difficulty: problem.difficulty as "easy" | "hard" | "medium",
    slug: problem.slug,
    title: problem.defaultTitle,
    totalSubmissions: problem._count.submissions,
    visibility: problem.visibility
  }));
}
```

This query finds problems where:

- User is the author, OR
- Problem is linked to an assessment in a course where the user is teacher/TA

**Step 3: Create ProblemsTabs client component**

Create `apps/web/src/components/problems-tabs.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { formatAcceptanceRate, shellClassNames } from "@nojv/ui";

type ProblemCard = {
  acceptanceRate: number;
  difficulty: "easy" | "hard" | "medium";
  slug: string;
  title: string;
  totalSubmissions: number;
};

type EditableProblemCard = {
  difficulty: "easy" | "hard" | "medium";
  slug: string;
  title: string;
  totalSubmissions: number;
  visibility: "private" | "public";
};

export function ProblemsTabs({
  editableProblems,
  publicProblems
}: {
  editableProblems: EditableProblemCard[] | null;
  publicProblems: ProblemCard[];
}) {
  const [tab, setTab] = useState<"public" | "mine">("public");
  const locale = useLocale();
  const tProblems = useTranslations("problems");
  const tCommon = useTranslations("common");

  return (
    <>
      <div className="flex gap-2">
        <button
          className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
            tab === "public"
              ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
              : "border-[color:var(--color-border)] hover:-translate-y-0.5 hover:bg-white/70"
          }`}
          onClick={() => setTab("public")}
          type="button"
        >
          {tProblems("publicLibrary")}
        </button>
        {editableProblems !== null && (
          <button
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              tab === "mine"
                ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
                : "border-[color:var(--color-border)] hover:-translate-y-0.5 hover:bg-white/70"
            }`}
            onClick={() => setTab("mine")}
            type="button"
          >
            {tProblems("myProblems")}
          </button>
        )}
      </div>

      {tab === "public" && (
        <section className="grid gap-4">
          {publicProblems.length === 0 && (
            <p className="text-sm text-[color:var(--color-muted)]">{tProblems("empty")}</p>
          )}
          {publicProblems.map((problem) => (
            <Link
              className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.8fr_0.8fr] sm:items-center`}
              href={`/${locale}/problems/${problem.slug}`}
              key={problem.slug}
            >
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  {problem.slug}
                </p>
                <h3 className="mt-2 text-2xl font-semibold">{problem.title}</h3>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">
                  {tCommon("difficulty")}
                </p>
                <p className="mt-1 text-lg font-semibold capitalize">{problem.difficulty}</p>
              </div>
              <div className="sm:text-right">
                <p className="text-sm text-[color:var(--color-muted)]">
                  {tCommon("acceptance")}
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {formatAcceptanceRate(problem.acceptanceRate)}
                </p>
              </div>
            </Link>
          ))}
        </section>
      )}

      {tab === "mine" && editableProblems !== null && (
        <section className="grid gap-4">
          {editableProblems.length === 0 && (
            <p className="text-sm text-[color:var(--color-muted)]">
              {tProblems("myProblemsEmpty")}
            </p>
          )}
          {editableProblems.map((problem) => (
            <Link
              className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr] sm:items-center`}
              href={`/${locale}/problems/${problem.slug}`}
              key={problem.slug}
            >
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  {problem.slug}
                </p>
                <h3 className="mt-2 text-2xl font-semibold">{problem.title}</h3>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">
                  {tCommon("difficulty")}
                </p>
                <p className="mt-1 text-lg font-semibold capitalize">{problem.difficulty}</p>
              </div>
              <div className="sm:text-right">
                <span
                  className={`${shellClassNames.badge} ${
                    problem.visibility === "public" ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {problem.visibility}
                </span>
              </div>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
```

**Step 4: Rewrite the problems page to use tabs**

Replace `apps/web/src/app/[locale]/problems/page.tsx`:

```tsx
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";

import { shellClassNames } from "@nojv/ui";

import { ProblemCreationPanel } from "@/components/problem-creation-panel";
import { ProblemsTabs } from "@/components/problems-tabs";
import { auth } from "@/lib/auth";
import { listEditableProblems, listProblemCards } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function ProblemsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tNav = await getTranslations("navigation");

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? null;

  const [publicProblems, editableProblems] = await Promise.all([
    listProblemCards(),
    userId ? listEditableProblems(userId) : Promise.resolve(null)
  ]);

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">{tNav("problems")}</h2>
      </section>

      <ProblemCreationPanel />
      <ProblemsTabs editableProblems={editableProblems} publicProblems={publicProblems} />
    </div>
  );
}
```

**Step 5: Verify**

```bash
cd /Users/takala/code/NOJV && pnpm build --filter=web
```

**Step 6: Commit**

```bash
git add apps/web/src/lib/server/read-model.ts apps/web/src/app/[locale]/problems/page.tsx apps/web/src/components/problems-tabs.tsx apps/web/messages/
git commit -m "feat: add two-tab problems page (Public Library / My Problems)"
```

---

## Task 7: Create cross-course Assignments aggregation page

**Files:**

- Modify: `apps/web/src/lib/server/read-model.ts` (add `listUserAssessments` query)
- Create: `apps/web/src/app/[locale]/assignments/page.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`

**Step 1: Add i18n keys**

In `apps/web/messages/en.json`, add:

```json
"assignmentsList": {
  "course": "Course",
  "due": "Due",
  "empty": "No assignments yet.",
  "heading": "Assignments",
  "opens": "Opens",
  "signInRequired": "Please sign in to view your assignments.",
  "status": "Status"
}
```

In `apps/web/messages/zh-TW.json`:

```json
"assignmentsList": {
  "course": "課程",
  "due": "截止",
  "empty": "尚無作業。",
  "heading": "作業",
  "opens": "開放",
  "signInRequired": "請先登入以查看作業。",
  "status": "狀態"
}
```

**Step 2: Add `listUserAssessments` query**

In `apps/web/src/lib/server/read-model.ts`, add:

```typescript
export async function listUserAssessments(userId: string, type: CourseAssessmentType) {
  const assessments = await prisma.courseAssessment.findMany({
    include: {
      course: { select: { slug: true, title: true } },
      problems: {
        include: { problem: { select: { slug: true } } },
        orderBy: { ordinal: "asc" }
      }
    },
    orderBy: { opensAt: "desc" },
    where: {
      course: {
        memberships: {
          some: { userId, status: "active" }
        }
      },
      status: "published",
      type
    }
  });

  return assessments.map((a) => ({
    closesAt: a.closesAt.toISOString(),
    courseSlug: a.course.slug,
    courseTitle: a.course.title,
    dueAt: a.dueAt.toISOString(),
    opensAt: a.opensAt.toISOString(),
    problemCount: a.problems.length,
    scoreboardMode: a.scoreboardMode,
    slug: a.slug,
    summary: a.summary,
    title: a.title
  }));
}
```

**Step 3: Create assignments page**

Create `apps/web/src/app/[locale]/assignments/page.tsx`:

```tsx
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";

import { shellClassNames } from "@nojv/ui";

import { auth } from "@/lib/auth";
import { deriveAssessmentWindowState } from "@/lib/server/course-poc-helpers";
import { listUserAssessments } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("assignmentsList");

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return (
      <div className="space-y-6">
        <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
          <h2 className="font-[family-name:var(--font-display)] text-3xl">{t("heading")}</h2>
        </section>
        <p className="text-sm text-[color:var(--color-muted)]">{t("signInRequired")}</p>
      </div>
    );
  }

  const assignments = await listUserAssessments(userId, "assignment");
  const now = new Date();

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">{t("heading")}</h2>
      </section>

      {assignments.length === 0 && (
        <p className="text-sm text-[color:var(--color-muted)]">{t("empty")}</p>
      )}

      <section className="grid gap-4">
        {assignments.map((a) => {
          const windowState = deriveAssessmentWindowState({
            closesAt: new Date(a.closesAt),
            dueAt: new Date(a.dueAt),
            now,
            opensAt: new Date(a.opensAt)
          });

          return (
            <Link
              className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr_0.4fr] sm:items-center`}
              href={`/${locale}/courses/${a.courseSlug}/assignments/${a.slug}`}
              key={`${a.courseSlug}-${a.slug}`}
            >
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{a.courseTitle}</p>
                <h3 className="mt-1 text-xl font-semibold">{a.title}</h3>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{t("opens")}</p>
                <p className="mt-1 text-sm">{new Date(a.opensAt).toLocaleDateString(locale)}</p>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{t("due")}</p>
                <p className="mt-1 text-sm">{new Date(a.dueAt).toLocaleDateString(locale)}</p>
              </div>
              <div className="sm:text-right">
                <span
                  className={`${shellClassNames.badge} ${
                    windowState === "open"
                      ? "text-emerald-600"
                      : windowState === "upcoming"
                        ? "text-blue-600"
                        : windowState === "grace"
                          ? "text-amber-600"
                          : "text-[color:var(--color-muted)]"
                  }`}
                >
                  {windowState}
                </span>
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
```

**Step 4: Verify build**

```bash
cd /Users/takala/code/NOJV && pnpm build --filter=web
```

**Step 5: Commit**

```bash
git add apps/web/src/lib/server/read-model.ts apps/web/src/app/[locale]/assignments/ apps/web/messages/
git commit -m "feat: add cross-course assignments aggregation page"
```

---

## Task 8: Create cross-course Exams aggregation page

**Files:**

- Create: `apps/web/src/app/[locale]/exams/page.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`

**Step 1: Add i18n keys**

In `apps/web/messages/en.json`, add:

```json
"examsList": {
  "course": "Course",
  "due": "Due",
  "empty": "No exams yet.",
  "heading": "Exams",
  "opens": "Opens",
  "signInRequired": "Please sign in to view your exams.",
  "status": "Status"
}
```

In `apps/web/messages/zh-TW.json`:

```json
"examsList": {
  "course": "課程",
  "due": "截止",
  "empty": "尚無考試。",
  "heading": "考試",
  "opens": "開放",
  "signInRequired": "請先登入以查看考試。",
  "status": "狀態"
}
```

**Step 2: Create exams page**

Create `apps/web/src/app/[locale]/exams/page.tsx` (nearly identical to assignments page but with `type: "exam"`):

```tsx
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";

import { shellClassNames } from "@nojv/ui";

import { auth } from "@/lib/auth";
import { deriveAssessmentWindowState } from "@/lib/server/course-poc-helpers";
import { listUserAssessments } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function ExamsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("examsList");

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return (
      <div className="space-y-6">
        <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
          <h2 className="font-[family-name:var(--font-display)] text-3xl">{t("heading")}</h2>
        </section>
        <p className="text-sm text-[color:var(--color-muted)]">{t("signInRequired")}</p>
      </div>
    );
  }

  const exams = await listUserAssessments(userId, "exam");
  const now = new Date();

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">{t("heading")}</h2>
      </section>

      {exams.length === 0 && (
        <p className="text-sm text-[color:var(--color-muted)]">{t("empty")}</p>
      )}

      <section className="grid gap-4">
        {exams.map((e) => {
          const windowState = deriveAssessmentWindowState({
            closesAt: new Date(e.closesAt),
            dueAt: new Date(e.dueAt),
            now,
            opensAt: new Date(e.opensAt)
          });

          return (
            <Link
              className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr_0.4fr] sm:items-center`}
              href={`/${locale}/courses/${e.courseSlug}/exams/${e.slug}`}
              key={`${e.courseSlug}-${e.slug}`}
            >
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{e.courseTitle}</p>
                <h3 className="mt-1 text-xl font-semibold">{e.title}</h3>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{t("opens")}</p>
                <p className="mt-1 text-sm">{new Date(e.opensAt).toLocaleDateString(locale)}</p>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{t("due")}</p>
                <p className="mt-1 text-sm">{new Date(e.dueAt).toLocaleDateString(locale)}</p>
              </div>
              <div className="sm:text-right">
                <span
                  className={`${shellClassNames.badge} ${
                    windowState === "open"
                      ? "text-emerald-600"
                      : windowState === "upcoming"
                        ? "text-blue-600"
                        : windowState === "grace"
                          ? "text-amber-600"
                          : "text-[color:var(--color-muted)]"
                  }`}
                >
                  {windowState}
                </span>
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
```

**Step 3: Verify build**

```bash
cd /Users/takala/code/NOJV && pnpm build --filter=web
```

**Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/exams/ apps/web/messages/
git commit -m "feat: add cross-course exams aggregation page"
```

---

## Task 9: Move course join route to `/courses/[slug]/join/[token]`

**Files:**

- Move: `apps/web/src/app/[locale]/join/[slug]/page.tsx` → `apps/web/src/app/[locale]/courses/[slug]/join/[token]/page.tsx`
- Update: all references to the join route

**Step 1: Create the new route directory and page**

Create `apps/web/src/app/[locale]/courses/[slug]/join/[token]/page.tsx` by copying from the existing join page but updating params to use `token` instead of query params:

Read the existing page first, then adapt it for the new route structure where the token is in the URL path instead of query params.

**Step 2: Update references to the join route**

Search for references to `/join/` in the codebase and update them to point to the new route.

Key places:

- `apps/web/src/components/course-join-panel.tsx` — join links
- `apps/web/src/app/[locale]/courses/[slug]/page.tsx` — join button links

**Step 3: Remove old join route**

Delete `apps/web/src/app/[locale]/join/` directory.

**Step 4: Verify build**

```bash
cd /Users/takala/code/NOJV && pnpm build --filter=web
```

**Step 5: Commit**

```bash
git add apps/web/src/app/[locale]/courses/[slug]/join/ apps/web/src/components/
git rm -r apps/web/src/app/[locale]/join/
git commit -m "refactor: move course join route to /courses/[slug]/join/[token]"
```

---

## Execution Notes

### Dependencies between tasks:

- Task 1 (PlatformRole) must be done first — other tasks may reference it
- Task 2 (exam fields) is independent
- Task 3 (seed) depends on Task 1
- Task 4 (permissions) depends on Task 1
- Task 5 (navigation) is independent
- Task 6 (problems tabs) is independent
- Task 7 (assignments page) depends on Task 5 (nav link exists)
- Task 8 (exams page) depends on Task 5 (nav link exists)
- Task 9 (join route) is independent

### Parallelization:

- Tasks 2, 5 can run in parallel with Task 1
- Tasks 6, 9 can run in parallel
- Tasks 7, 8 can run in parallel after Task 5

### Migration strategy:

For Tasks 1 and 2, rather than using `prisma migrate dev` (which may fail on enum changes), use `prisma db push` for development or write manual SQL migrations.
