# Permission & Course Architecture Restructure — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Centralize permission logic, split course management into dedicated routes, and break apart oversized components.

**Architecture:** Create `lib/server/authorization/` module with pure permission checks, role resolution, and guard functions. Add `courses/[slug]/manage/` route group with layout-level auth guard. Extract management UI from monolithic `course-management-console` into focused page components.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, next-intl, @nojv/ui

---

### Task 1: Create authorization module — `permissions.ts`

**Files:**
- Create: `apps/web/src/lib/server/authorization/permissions.ts`

**Step 1: Create the permissions file**

Move all pure permission functions from `course-authorization.ts` and add `canManageCourseProblems` + `canViewManagePanel`:

```typescript
import type { EffectiveCourseRole, PlatformRole } from "@nojv/domain";

export function canCreateCourse(platformRole: PlatformRole) {
  return platformRole === "admin" || platformRole === "teacher";
}

export function canCreateProblem(platformRole: PlatformRole) {
  return platformRole === "admin" || platformRole === "teacher";
}

export function canManageCourseMembership(role: EffectiveCourseRole) {
  return role === "admin" || role === "teacher" || role === "ta";
}

export function canPublishAssessment(role: EffectiveCourseRole) {
  return role === "admin" || role === "teacher" || role === "ta";
}

export function canManageCourseProblems(role: EffectiveCourseRole) {
  return role === "admin" || role === "teacher" || role === "ta";
}

export function canViewManagePanel(role: EffectiveCourseRole) {
  return role === "admin" || role === "teacher" || role === "ta";
}
```

**Step 2: Verify no syntax errors**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -20`

---

### Task 2: Create authorization module — `roles.ts`

**Files:**
- Create: `apps/web/src/lib/server/authorization/roles.ts`
- Modify: `apps/web/src/lib/server/poc-persistence.ts` (remove `resolveCoursePermission` and `getCoursePermissionRole`)

**Step 1: Create the roles file**

Move `resolveCoursePermissionRole` from `course-authorization.ts` and `resolveCoursePermission` + `getCoursePermissionRole` from `poc-persistence.ts`:

```typescript
import { prisma, type TransactionClient } from "@nojv/db";
import type { CourseRole, EffectiveCourseRole, PlatformRole } from "@nojv/domain";

import type { PocActorContext } from "../actor-context";
import { NotFoundError } from "../api-errors";

export function resolveCoursePermissionRole(input: {
  courseRole?: CourseRole | null;
  platformRole: PlatformRole;
}): EffectiveCourseRole | null {
  if (input.platformRole === "admin") {
    return "admin";
  }

  return input.courseRole ?? null;
}

export async function resolveCoursePermission(
  tx: TransactionClient,
  courseSlug: string,
  actor: PocActorContext
) {
  const course = await tx.course.findUnique({
    where: { slug: courseSlug }
  });

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseSlug}`);
  }

  const membership = await tx.courseMembership.findUnique({
    where: {
      courseId_userId: {
        courseId: course.id,
        userId: actor.userId
      }
    }
  });

  return {
    course,
    role: resolveCoursePermissionRole({
      courseRole: membership?.role ?? null,
      platformRole: actor.platformRole
    })
  };
}

export async function getCoursePermissionRole(courseSlug: string, actor: PocActorContext) {
  return prisma.$transaction(async (tx) => {
    const { role } = await resolveCoursePermission(tx, courseSlug, actor);
    return role;
  });
}
```

**Step 2: Update `poc-persistence.ts`**

- Remove the `resolveCoursePermission` function (lines 286-308)
- Remove the `getCoursePermissionRole` export (lines 744-750)
- Change import: replace `import { resolveCoursePermissionRole } from "./course-authorization"` with `import { resolveCoursePermission, resolveCoursePermissionRole } from "./authorization"`
- The internal usages of `resolveCoursePermission` inside `poc-persistence.ts` (there are none beyond the function itself being defined) — verify and update if needed.

Note: `poc-persistence.ts` uses `resolveCoursePermission` only in its own definition (line 303 calls `resolveCoursePermissionRole` and uses local `ensureCourse`). The function `resolveCoursePermission` was only used internally by `getCoursePermissionRole`. After moving both to `roles.ts`, `poc-persistence.ts` no longer needs either.

However, `poc-persistence.ts` still uses `resolveCoursePermissionRole` directly at line 303 in some internal helpers — wait, looking again, the `resolveCoursePermission` private function at line 286 IS the one that uses `resolveCoursePermissionRole`. Since we're moving `resolveCoursePermission` entirely to `roles.ts`, we need to also provide the `ensureCourse` helper. But `ensureCourse` is a private helper in `poc-persistence.ts` used by many functions.

**Revised approach:** In `roles.ts`, the `resolveCoursePermission` function does its own `findUnique` + `NotFoundError` (not using the private `ensureCourse` helper). This is already how the code above is written — it's self-contained.

In `poc-persistence.ts`:
- Remove `resolveCoursePermission` (lines 286-308) and `getCoursePermissionRole` (lines 744-750)
- Remove `import { resolveCoursePermissionRole } from "./course-authorization"` entirely (line 20)
- The remaining code in `poc-persistence.ts` does NOT reference `resolveCoursePermissionRole` or `resolveCoursePermission` anymore after the removal.

**Step 3: Verify**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -30`

---

### Task 3: Create authorization module — `guards.ts` and `index.ts`

**Files:**
- Create: `apps/web/src/lib/server/authorization/guards.ts`
- Create: `apps/web/src/lib/server/authorization/index.ts`

**Step 1: Create guards.ts**

```typescript
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import type { EffectiveCourseRole, PlatformRole } from "@nojv/domain";

import { auth } from "@/lib/auth";
import { platformRoleSchema } from "@nojv/domain";

import type { PocActorContext } from "../actor-context";
import { ForbiddenError } from "../api-errors";
import { getCoursePermissionRole } from "./roles";

/**
 * Require authentication for a server component page.
 * Redirects to sign-in if not authenticated.
 */
export async function requireAuth(redirectTo?: string): Promise<PocActorContext> {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (!session?.user) {
    redirect(redirectTo ?? "/auth/signin");
  }

  const extra = session.user as Record<string, unknown>;
  const parsedRole = platformRoleSchema.safeParse(extra.platformRole);

  return {
    displayName: session.user.name ?? session.user.email,
    email: session.user.email,
    handle: (extra.handle as string) ?? "",
    platformRole: parsedRole.success ? parsedRole.data : "student",
    userId: session.user.id
  };
}

/**
 * Require specific platform roles. Throws ForbiddenError if not matched.
 */
export function requirePlatformRole(actor: PocActorContext, ...roles: PlatformRole[]): void {
  if (!roles.includes(actor.platformRole)) {
    throw new ForbiddenError("Insufficient platform role.");
  }
}

/**
 * Require specific course roles. Returns the resolved role.
 * Throws ForbiddenError if user has no role or role is not in the allowed list.
 */
export async function requireCourseRole(
  actor: PocActorContext,
  courseSlug: string,
  ...roles: EffectiveCourseRole[]
): Promise<EffectiveCourseRole> {
  const role = await getCoursePermissionRole(courseSlug, actor);

  if (!role || !roles.includes(role)) {
    throw new ForbiddenError("Insufficient course role.");
  }

  return role;
}
```

**Step 2: Create index.ts**

```typescript
export {
  canCreateCourse,
  canCreateProblem,
  canManageCourseMembership,
  canManageCourseProblems,
  canPublishAssessment,
  canViewManagePanel
} from "./permissions";

export {
  getCoursePermissionRole,
  resolveCoursePermission,
  resolveCoursePermissionRole
} from "./roles";

export {
  requireAuth,
  requireCourseRole,
  requirePlatformRole
} from "./guards";
```

**Step 3: Verify**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -30`

---

### Task 4: Update all imports to use authorization module

**Files:**
- Modify: `apps/web/src/app/api/courses/route.ts`
- Modify: `apps/web/src/app/api/courses/[slug]/members/route.ts`
- Modify: `apps/web/src/app/api/courses/[slug]/assessments/route.ts`
- Modify: `apps/web/src/app/api/courses/[slug]/problems/route.ts`
- Modify: `apps/web/src/app/api/problems/route.ts`
- Modify: `apps/web/src/app/api/problems/[slug]/testcase-sets/route.ts`

**Step 1: Update each API route**

For each file, replace:
- `import { canXxx } from "@/lib/server/course-authorization"` → `import { canXxx } from "@/lib/server/authorization"`
- `import { getCoursePermissionRole, ... } from "@/lib/server/poc-persistence"` → add `getCoursePermissionRole` to the authorization import, remove it from poc-persistence import

Example for `api/courses/[slug]/members/route.ts`:
```typescript
// Before:
import { canManageCourseMembership } from "@/lib/server/course-authorization";
import { getCoursePermissionRole, manuallyEnrollCourseMember } from "@/lib/server/poc-persistence";

// After:
import { canManageCourseMembership, getCoursePermissionRole } from "@/lib/server/authorization";
import { manuallyEnrollCourseMember } from "@/lib/server/poc-persistence";
```

Apply the same pattern to all 6 files listed above.

**Step 2: Verify**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -30`

---

### Task 5: Update tests and delete old file

**Files:**
- Modify: `apps/web/tests/course-authorization.test.ts` — update import path
- Modify: `apps/web/tests/course-management-routes.test.ts` — update mock paths
- Modify: `apps/web/tests/course-route-behavior.test.ts` — update mock paths
- Modify: `apps/web/tests/problem-testcase-routes.test.ts` — update mock paths
- Delete: `apps/web/src/lib/server/course-authorization.ts`

**Step 1: Update test imports**

For `course-authorization.test.ts`:
```typescript
// Before:
import { ... } from "../src/lib/server/course-authorization";
// After:
import { ... } from "../src/lib/server/authorization";
```

For mock paths in other test files, replace:
```typescript
// Before:
vi.mock("../src/lib/server/course-authorization", () => ({ ... }))
// After:
vi.mock("../src/lib/server/authorization", () => ({ ... }))
```

And for `getCoursePermissionRole` mocks, update from:
```typescript
vi.mock("../src/lib/server/poc-persistence", () => ({ getCoursePermissionRole: ... }))
```
to:
```typescript
vi.mock("../src/lib/server/authorization", () => ({ getCoursePermissionRole: ..., canXxx: ... }))
```
(Merge the authorization mocks into a single mock call.)

**Step 2: Delete old file**

```bash
rm apps/web/src/lib/server/course-authorization.ts
```

**Step 3: Run tests**

Run: `cd apps/web && pnpm test 2>&1 | tail -30`

**Step 4: Commit**

```bash
git add apps/web/src/lib/server/authorization/ apps/web/src/lib/server/poc-persistence.ts apps/web/src/app/api/ apps/web/tests/
git add -u  # catches the deleted course-authorization.ts
git commit -m "refactor: centralize authorization into lib/server/authorization module"
```

---

### Task 6: Create manage layout with auth guard

**Files:**
- Create: `apps/web/src/app/[locale]/courses/[slug]/manage/layout.tsx`

**Step 1: Create the layout**

```typescript
import { notFound } from "next/navigation";

import { requireAuth, requireCourseRole } from "@/lib/server/authorization";
import { ManageNav } from "@/components/course-manage/manage-nav";

export const dynamic = "force-dynamic";

export default async function ManageLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const actor = await requireAuth(`/${locale}/auth/signin`);
  const role = await requireCourseRole(actor, slug, "admin", "teacher", "ta");

  return (
    <div className="space-y-6">
      <ManageNav locale={locale} role={role} slug={slug} />
      {children}
    </div>
  );
}
```

**Step 2: Create ManageNav component stub**

Create: `apps/web/src/components/course-manage/manage-nav.tsx`

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { shellClassNames } from "@nojv/ui";

import type { EffectiveCourseRole } from "@nojv/domain";

interface ManageNavProps {
  locale: string;
  role: EffectiveCourseRole;
  slug: string;
}

const navItems = [
  { href: "", label: "Overview" },
  { href: "/members", label: "Members" },
  { href: "/problems", label: "Problems" },
  { href: "/assessments", label: "Assessments" }
];

export function ManageNav({ locale, role, slug }: ManageNavProps) {
  const pathname = usePathname();
  const basePath = `/${locale}/courses/${slug}/manage`;

  return (
    <nav className={`${shellClassNames.card} flex items-center gap-1 px-3 py-2`}>
      {navItems.map((item) => {
        const fullHref = `${basePath}${item.href}`;
        const isActive =
          item.href === ""
            ? pathname === basePath
            : pathname.startsWith(fullHref);

        return (
          <Link
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-[color:var(--color-accent)] text-white"
                : "hover:bg-white/60"
            }`}
            href={fullHref}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
      <span className={`ml-auto ${shellClassNames.badge}`}>{role}</span>
    </nav>
  );
}
```

**Step 3: Verify**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -20`

---

### Task 7: Create manage overview page

**Files:**
- Create: `apps/web/src/app/[locale]/courses/[slug]/manage/page.tsx`

**Step 1: Create the page**

```typescript
import { notFound } from "next/navigation";

import { setRequestLocale } from "next-intl/server";
import { shellClassNames } from "@nojv/ui";

import { getCoursePageData } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function ManageOverviewPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const courseData = await getCoursePageData(slug);

  if (!courseData) {
    notFound();
  }

  const { course, problems } = courseData;

  return (
    <section className={`${shellClassNames.cardStrong} px-6 py-8`}>
      <p className={shellClassNames.eyebrow}>Manage / {course.slug}</p>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl">{course.title}</h2>
      <p className="mt-4 text-[color:var(--color-muted)]">{course.description}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className={`${shellClassNames.card} px-4 py-4`}>
          <p className="text-sm text-[color:var(--color-muted)]">Members</p>
          <p className="mt-2 text-2xl font-semibold">{course.members.length}</p>
        </div>
        <div className={`${shellClassNames.card} px-4 py-4`}>
          <p className="text-sm text-[color:var(--color-muted)]">Assessments</p>
          <p className="mt-2 text-2xl font-semibold">{course.assessments.length}</p>
        </div>
        <div className={`${shellClassNames.card} px-4 py-4`}>
          <p className="text-sm text-[color:var(--color-muted)]">Problems</p>
          <p className="mt-2 text-2xl font-semibold">{problems.length}</p>
        </div>
      </div>
    </section>
  );
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -20`

---

### Task 8: Create manage members page

**Files:**
- Create: `apps/web/src/components/course-manage/manage-members.tsx`
- Create: `apps/web/src/app/[locale]/courses/[slug]/manage/members/page.tsx`

**Step 1: Create manage-members component**

Extract the member list from `course-membership-panel.tsx` and the enrollment form from `course-management-console.tsx`:

```typescript
"use client";

import { startTransition, useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { shellClassNames } from "@nojv/ui";

import { enrollCourseMemberMutation } from "@/lib/client/course-management-client";
import type { CoursePocMember } from "@/lib/server/read-model";

interface ManageMembersProps {
  courseSlug: string;
  courseTitle: string;
  members: CoursePocMember[];
}

export function ManageMembers({ courseSlug, courseTitle, members }: ManageMembersProps) {
  const router = useRouter();
  const [enrollName, setEnrollName] = useState("");
  const [enrollEmail, setEnrollEmail] = useState("");
  const [enrollHandle, setEnrollHandle] = useState("");
  const [enrollRole, setEnrollRole] = useState<"student" | "ta" | "teacher">("student");
  const [enrollStatus, setEnrollStatus] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);

  const inputClassName =
    "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";

  async function handleManualEnrollment(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsEnrolling(true);
    setEnrollError(null);
    setEnrollStatus(null);

    try {
      await enrollCourseMemberMutation({
        courseSlug,
        displayName: enrollName,
        email: enrollEmail,
        handle: enrollHandle,
        role: enrollRole
      });
      setEnrollStatus(`Enrolled ${enrollName} into ${courseTitle}.`);
      setEnrollName("");
      setEnrollEmail("");
      setEnrollHandle("");
      startTransition(() => {
        router.refresh();
      });
    } catch (issue) {
      setEnrollError(issue instanceof Error ? issue.message : "Manual enrollment failed.");
    } finally {
      setIsEnrolling(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.card} px-5 py-5`}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-2xl font-semibold">Members</h3>
          <span className={shellClassNames.badge}>{members.length}</span>
        </div>
        <div className="mt-5 space-y-3">
          {members.map((member) => (
            <article
              className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
              key={member.userId}
            >
              <div>
                <p className="text-lg font-semibold">{member.displayName}</p>
                <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                  {member.handle} · {member.email}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  {member.courseRole}
                </p>
                <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                  via {member.joinedVia.replaceAll("_", " ")}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`${shellClassNames.card} px-5 py-5`}>
        <h3 className="text-2xl font-semibold">Enroll Member</h3>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => void handleManualEnrollment(event)}
        >
          <input
            className={inputClassName}
            onChange={(event) => setEnrollName(event.target.value)}
            placeholder="Display name"
            required
            value={enrollName}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className={inputClassName}
              onChange={(event) => setEnrollEmail(event.target.value)}
              placeholder="Email"
              required
              type="email"
              value={enrollEmail}
            />
            <input
              className={inputClassName}
              onChange={(event) => setEnrollHandle(event.target.value)}
              placeholder="Handle"
              required
              value={enrollHandle}
            />
          </div>
          <select
            className={inputClassName}
            onChange={(event) =>
              setEnrollRole(event.target.value as "student" | "ta" | "teacher")
            }
            value={enrollRole}
          >
            <option value="student">student</option>
            <option value="ta">ta</option>
            <option value="teacher">teacher</option>
          </select>
          <button
            className="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isEnrolling}
            type="submit"
          >
            {isEnrolling ? "Enrolling..." : "Enroll Member"}
          </button>
        </form>
        {enrollStatus ? <p className="mt-4 text-sm text-emerald-700">{enrollStatus}</p> : null}
        {enrollError ? <p className="mt-4 text-sm text-red-700">{enrollError}</p> : null}
      </section>
    </div>
  );
}
```

Note: The `enrollCourseMemberMutation` currently takes an `actor` second argument. We need to check whether the client mutation functions pass actor headers. Looking at the current `course-management-console.tsx`, it passes `actor` from `useActorSession()`. The client mutation function likely sends these as dev headers. For the manage pages, since the layout already verified auth, we can either:
- Keep passing actor from a client hook (for dev mode header support)
- Or simplify and just call the API without dev headers (prod uses session cookies)

**For now**, keep the existing pattern — the manage components will NOT pass actor to mutations since the session cookie handles auth. Check `course-management-client.ts` to see if actor param is required or optional. If required, make it optional.

**Step 2: Create the page**

```typescript
import { notFound } from "next/navigation";

import { setRequestLocale } from "next-intl/server";

import { getCoursePageData } from "@/lib/server/read-model";
import { ManageMembers } from "@/components/course-manage/manage-members";

export const dynamic = "force-dynamic";

export default async function ManageMembersPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const courseData = await getCoursePageData(slug);

  if (!courseData) {
    notFound();
  }

  return (
    <ManageMembers
      courseSlug={slug}
      courseTitle={courseData.course.title}
      members={courseData.course.members}
    />
  );
}
```

**Step 3: Verify**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -20`

---

### Task 9: Create manage problems page

**Files:**
- Create: `apps/web/src/components/course-manage/manage-problems.tsx`
- Create: `apps/web/src/app/[locale]/courses/[slug]/manage/problems/page.tsx`

**Step 1: Create manage-problems component**

Extract from `course-management-console.tsx` the problem attachment form:

```typescript
"use client";

import { startTransition, useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { shellClassNames } from "@nojv/ui";

import { attachProblemToCourseMutation } from "@/lib/client/course-management-client";
import type { CourseProblemCatalogEntry } from "@/lib/server/read-model";

interface ManageProblemsProps {
  courseSlug: string;
  courseTitle: string;
  problems: CourseProblemCatalogEntry[];
}

export function ManageProblems({ courseSlug, courseTitle, problems }: ManageProblemsProps) {
  const router = useRouter();
  const [problemSlug, setProblemSlug] = useState("");
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);

  const inputClassName =
    "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";

  async function handleAttachProblem(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAttaching(true);
    setAttachError(null);
    setAttachStatus(null);

    try {
      await attachProblemToCourseMutation({
        courseSlug,
        problemSlug
      });
      setAttachStatus(`Attached ${problemSlug} to ${courseTitle}.`);
      setProblemSlug("");
      startTransition(() => {
        router.refresh();
      });
    } catch (issue) {
      setAttachError(issue instanceof Error ? issue.message : "Problem attachment failed.");
    } finally {
      setIsAttaching(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.card} px-5 py-5`}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-2xl font-semibold">Course Problems</h3>
          <span className={shellClassNames.badge}>{problems.length}</span>
        </div>
        <div className="mt-5 grid gap-3">
          {problems.map((problem) => (
            <article
              className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
              key={problem.slug}
            >
              <div>
                <p className="text-lg font-semibold">{problem.title}</p>
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">{problem.summary}</p>
              </div>
              <div className="text-right">
                <span className={shellClassNames.badge}>{problem.visibility}</span>
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                  by {problem.authorHandle}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`${shellClassNames.card} px-5 py-5`}>
        <h3 className="text-2xl font-semibold">Attach Problem</h3>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => void handleAttachProblem(event)}
        >
          <input
            className={inputClassName}
            onChange={(event) => setProblemSlug(event.target.value)}
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            placeholder="problem-slug"
            required
            value={problemSlug}
          />
          <button
            className="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isAttaching}
            type="submit"
          >
            {isAttaching ? "Attaching..." : "Attach Problem"}
          </button>
        </form>
        {attachStatus ? <p className="mt-4 text-sm text-emerald-700">{attachStatus}</p> : null}
        {attachError ? <p className="mt-4 text-sm text-red-700">{attachError}</p> : null}
      </section>
    </div>
  );
}
```

**Step 2: Create the page**

```typescript
import { notFound } from "next/navigation";

import { setRequestLocale } from "next-intl/server";

import { getCoursePageData } from "@/lib/server/read-model";
import { ManageProblems } from "@/components/course-manage/manage-problems";

export const dynamic = "force-dynamic";

export default async function ManageProblemsPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const courseData = await getCoursePageData(slug);

  if (!courseData) {
    notFound();
  }

  return (
    <ManageProblems
      courseSlug={slug}
      courseTitle={courseData.course.title}
      problems={courseData.problems}
    />
  );
}
```

**Step 3: Verify**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -20`

---

### Task 10: Create manage assessments page

**Files:**
- Create: `apps/web/src/components/course-manage/manage-assessments.tsx`
- Create: `apps/web/src/app/[locale]/courses/[slug]/manage/assessments/page.tsx`

**Step 1: Create manage-assessments component**

Extract the assessment publish form from `course-management-console.tsx` and the assessment list:

```typescript
"use client";

import { startTransition, useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { shellClassNames } from "@nojv/ui";

import { publishCourseAssessmentMutation } from "@/lib/client/course-management-client";
import type { CoursePocAssessment } from "@/lib/server/read-model";

interface ManageAssessmentsProps {
  courseSlug: string;
  assessments: CoursePocAssessment[];
  problemSlugs: string[];
}

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${String(year)}-${month}-${day}T${hours}:${minutes}`;
}

function createDefaultAssessmentWindow() {
  const opensAt = new Date();
  const dueAt = new Date(opensAt.getTime() + 1000 * 60 * 60 * 24 * 7);
  const closesAt = new Date(dueAt.getTime() + 1000 * 60 * 60 * 24);

  return {
    closesAt: toDateTimeLocalValue(closesAt),
    dueAt: toDateTimeLocalValue(dueAt),
    opensAt: toDateTimeLocalValue(opensAt)
  };
}

export function ManageAssessments({
  courseSlug,
  assessments,
  problemSlugs
}: ManageAssessmentsProps) {
  const router = useRouter();
  const defaultWindow = createDefaultAssessmentWindow();

  const inputClassName =
    "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";
  const textareaClassName = `${inputClassName} min-h-24 resize-y`;

  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assessmentSlug, setAssessmentSlug] = useState("");
  const [assessmentType, setAssessmentType] = useState<"assignment" | "exam">("assignment");
  const [assessmentSummary, setAssessmentSummary] = useState("");
  const [scoreboardMode, setScoreboardMode] = useState<"hidden" | "live" | "frozen">("hidden");
  const [problemSlugsText, setProblemSlugsText] = useState(problemSlugs.join(", "));
  const [opensAt, setOpensAt] = useState(defaultWindow.opensAt);
  const [dueAt, setDueAt] = useState(defaultWindow.dueAt);
  const [closesAt, setClosesAt] = useState(defaultWindow.closesAt);
  const [assessmentStatus, setAssessmentStatus] = useState<string | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  async function handlePublishAssessment(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPublishing(true);
    setAssessmentError(null);
    setAssessmentStatus(null);

    try {
      await publishCourseAssessmentMutation({
        closesAt: new Date(closesAt).toISOString(),
        courseSlug,
        dueAt: new Date(dueAt).toISOString(),
        opensAt: new Date(opensAt).toISOString(),
        problemSlugs: problemSlugsText
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
        scoreboardMode,
        slug: assessmentSlug,
        summary: assessmentSummary,
        title: assessmentTitle,
        type: assessmentType
      });
      setAssessmentStatus(`Published ${assessmentTitle}.`);
      startTransition(() => {
        router.refresh();
      });
    } catch (issue) {
      setAssessmentError(issue instanceof Error ? issue.message : "Assessment publish failed.");
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.card} px-5 py-5`}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-2xl font-semibold">Assessments</h3>
          <span className={shellClassNames.badge}>{assessments.length}</span>
        </div>
        <div className="mt-5 grid gap-3">
          {assessments.map((assessment) => (
            <article
              className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
              key={assessment.slug}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                    {assessment.type}
                  </p>
                  <p className="mt-2 text-lg font-semibold">{assessment.title}</p>
                  <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                    {assessment.summary}
                  </p>
                </div>
                <span className={shellClassNames.badge}>
                  {assessment.problemSlugs.length} problems
                </span>
              </div>
              <p className="mt-3 text-sm text-[color:var(--color-muted)]">
                {assessment.opensAt.slice(0, 10)} → {assessment.closesAt.slice(0, 10)}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${shellClassNames.card} px-5 py-5`}>
        <h3 className="text-2xl font-semibold">Publish Assessment</h3>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => void handlePublishAssessment(event)}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className={inputClassName}
              onChange={(event) => setAssessmentTitle(event.target.value)}
              placeholder="Assessment title"
              required
              value={assessmentTitle}
            />
            <input
              className={inputClassName}
              onChange={(event) => setAssessmentSlug(event.target.value)}
              pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
              placeholder="assessment-slug"
              required
              value={assessmentSlug}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              className={inputClassName}
              onChange={(event) =>
                setAssessmentType(event.target.value as "assignment" | "exam")
              }
              value={assessmentType}
            >
              <option value="assignment">assignment</option>
              <option value="exam">exam</option>
            </select>
            <select
              className={inputClassName}
              onChange={(event) =>
                setScoreboardMode(event.target.value as "hidden" | "live" | "frozen")
              }
              value={scoreboardMode}
            >
              <option value="hidden">hidden</option>
              <option value="live">live</option>
              <option value="frozen">frozen</option>
            </select>
          </div>
          <textarea
            className={textareaClassName}
            onChange={(event) => setAssessmentSummary(event.target.value)}
            placeholder="Assessment summary"
            required
            value={assessmentSummary}
          />
          <textarea
            className={textareaClassName}
            onChange={(event) => setProblemSlugsText(event.target.value)}
            placeholder="problem-one, problem-two"
            required
            value={problemSlugsText}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <input
              className={inputClassName}
              onChange={(event) => setOpensAt(event.target.value)}
              required
              type="datetime-local"
              value={opensAt}
            />
            <input
              className={inputClassName}
              onChange={(event) => setDueAt(event.target.value)}
              required
              type="datetime-local"
              value={dueAt}
            />
            <input
              className={inputClassName}
              onChange={(event) => setClosesAt(event.target.value)}
              required
              type="datetime-local"
              value={closesAt}
            />
          </div>
          <button
            className="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isPublishing}
            type="submit"
          >
            {isPublishing ? "Publishing..." : "Publish Assessment"}
          </button>
        </form>
        {assessmentStatus ? (
          <p className="mt-4 text-sm text-emerald-700">{assessmentStatus}</p>
        ) : null}
        {assessmentError ? (
          <p className="mt-4 text-sm text-red-700">{assessmentError}</p>
        ) : null}
      </section>
    </div>
  );
}
```

**Step 2: Create the page**

```typescript
import { notFound } from "next/navigation";

import { setRequestLocale } from "next-intl/server";

import { getCoursePageData } from "@/lib/server/read-model";
import { ManageAssessments } from "@/components/course-manage/manage-assessments";

export const dynamic = "force-dynamic";

export default async function ManageAssessmentsPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const courseData = await getCoursePageData(slug);

  if (!courseData) {
    notFound();
  }

  return (
    <ManageAssessments
      assessments={courseData.course.assessments}
      courseSlug={slug}
      problemSlugs={courseData.course.problemSlugs}
    />
  );
}
```

**Step 3: Verify**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -20`

**Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/courses/[slug]/manage/ apps/web/src/components/course-manage/
git commit -m "feat: add course management routes with dedicated pages for members, problems, and assessments"
```

---

### Task 11: Update course detail page (student view) and clean up

**Files:**
- Modify: `apps/web/src/app/[locale]/courses/[slug]/page.tsx`
- Delete: `apps/web/src/components/course-management-console.tsx`
- Delete: `apps/web/src/components/course-membership-panel.tsx`

**Step 1: Update course detail page**

Remove `CourseManagementConsole` and `CourseMembershipPanel` imports and usage. Add a "Manage" link for authorized users. The page becomes student-focused:

```typescript
import Link from "next/link";
import { notFound } from "next/navigation";

import { getTranslations, setRequestLocale } from "next-intl/server";
import { shellClassNames } from "@nojv/ui";

import { CourseAssessmentBoard } from "@/components/course-assessment-board";
import { CourseJoinPanel } from "@/components/course-join-panel";
import { CourseProblemShelf } from "@/components/course-problem-shelf";
import { getCoursePageData } from "@/lib/server/read-model";
import { getActorContext } from "@/lib/server/actor-context";
import { canViewManagePanel, getCoursePermissionRole } from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export default async function CourseDetailPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const [tNav, tCourse, tCommon] = await Promise.all([
    getTranslations("navigation"),
    getTranslations("courseDetail"),
    getTranslations("common")
  ]);
  const courseData = await getCoursePageData(slug);
  const course = courseData?.course;

  if (!course) {
    notFound();
  }

  // Check if current user can see manage link
  let showManageLink = false;
  try {
    // getActorContext needs a Request, but for server components we use a different approach
    // We'll use a simpler check: try to resolve role via the authorization module
    // For now, we'll skip this and add the manage link unconditionally in dev,
    // or use requireAuth in a try-catch
  } catch {
    // Not authenticated or no role — don't show manage link
  }

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className={shellClassNames.eyebrow}>
              {tNav("courses")} / {course.slug}
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
              {course.title}
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
              {course.description}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tCommon("members")}</p>
              <p className="mt-2 text-lg font-semibold">{course.members.length}</p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tCommon("assessments")}</p>
              <p className="mt-2 text-lg font-semibold">{course.assessments.length}</p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tCourse("problemPool")}</p>
              <p className="mt-2 text-lg font-semibold">{course.problemSlugs.length}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-6">
        <CourseAssessmentBoard
          assessments={course.assessments}
          courseSlug={course.slug}
        />
        <CourseProblemShelf
          courseSlug={course.slug}
          problems={courseData.problems}
        />
        <CourseJoinPanel
          courseSlug={course.slug}
          joinChannels={course.joinChannels}
        />
      </div>
    </div>
  );
}
```

Note: The "manage link" logic needs `requireAuth` which redirects. For the course detail page we don't want to require auth — unauthenticated users should still see the course. We'll handle the manage link by doing a soft auth check. Replace the placeholder section above with:

```typescript
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getCoursePermissionRole, canViewManagePanel } from "@/lib/server/authorization";
```

And in the component body, before the return:

```typescript
  let showManageLink = false;
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) {
    const parsedRole = platformRoleSchema.safeParse(
      (session.user as Record<string, unknown>).platformRole
    );
    const actor = {
      displayName: session.user.name ?? session.user.email,
      email: session.user.email,
      handle: ((session.user as Record<string, unknown>).handle as string) ?? "",
      platformRole: parsedRole.success ? parsedRole.data : "student" as const,
      userId: session.user.id
    };
    const role = await getCoursePermissionRole(slug, actor);
    showManageLink = role !== null && canViewManagePanel(role);
  }
```

Then in the JSX, after the course title section, conditionally render:
```tsx
{showManageLink ? (
  <Link
    className="inline-flex rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5"
    href={`/${locale}/courses/${slug}/manage`}
  >
    Manage Course
  </Link>
) : null}
```

This is getting complex in the plan. **Simplification:** Just add the manage link and let the manage layout handle the actual auth. If a student clicks the link, the layout guard will redirect them. This is simpler and still secure.

**Simplified approach for course detail page:** Just remove management components, keep the rest, and add a simple manage link:

```tsx
<Link
  className={`${shellClassNames.badge} transition hover:-translate-y-0.5`}
  href={`/${locale}/courses/${slug}/manage`}
>
  Manage →
</Link>
```

Place this in the header area. The manage layout handles auth.

**Step 2: Delete old files**

```bash
rm apps/web/src/components/course-management-console.tsx
rm apps/web/src/components/course-membership-panel.tsx
```

**Step 3: Check for remaining imports of deleted files**

Run: `grep -r "course-management-console\|course-membership-panel" apps/web/src/ --include="*.ts" --include="*.tsx"`

If any references remain, update them.

**Step 4: Verify**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -30`

---

### Task 12: Update client mutation functions

**Files:**
- Modify: `apps/web/src/lib/client/course-management-client.ts`

**Step 1: Make actor parameter optional**

The current mutation functions take `actor` as a second parameter for dev header injection. Since the manage pages use session cookies, make `actor` optional in all mutation functions. If `actor` is not provided, don't send the dev headers (rely on session cookie).

Check the current signature pattern and make `actor?` optional. The fetch calls should conditionally include headers only when actor is provided.

**Step 2: Verify**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json 2>&1 | head -20`

**Step 3: Run tests**

Run: `cd apps/web && pnpm test 2>&1 | tail -30`

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: simplify course detail page to student view, extract management to /manage routes"
```

---

### Task 13: Final verification

**Step 1: Type check**

Run: `npx tsc --noEmit --pretty -p apps/web/tsconfig.json`

**Step 2: Run all tests**

Run: `cd apps/web && pnpm test`

**Step 3: Dev server smoke test**

Run: `cd apps/web && pnpm dev` and verify:
- `/en/courses` loads
- `/en/courses/{slug}` shows student view without management console
- `/en/courses/{slug}/manage` shows management nav + overview
- `/en/courses/{slug}/manage/members` shows member list + enroll form
- `/en/courses/{slug}/manage/problems` shows problem list + attach form
- `/en/courses/{slug}/manage/assessments` shows assessment list + publish form

**Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: address post-refactor issues"
```
