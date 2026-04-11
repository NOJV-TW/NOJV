# Contest: Hide Problems Before Start + Participable/Managed Tabs

**Date:** 2026-04-11
**Status:** Design approved, pending implementation plan
**Scope:** `apps/web` contest list & detail pages, `packages/domain/src/contest`

## Problem

Two related gaps in the current contest surface:

1. **Problems leak before `startsAt`.** `getContestDetail()` unconditionally returns the full `problems` array, and the detail page only disables links in the UI — problem titles, ordinals, and points are still rendered in the DOM. A contestant can learn what's coming before the contest starts.
2. **No ownership lens on the contest list.** `/contests` lists every published contest in one stream. Contest managers (owners, course teachers, course TAs) have no easy view of "contests I run."

The user's framing: *competitions must not display problems before they begin, but general competition information is fine*. Alongside that, surface a "my contests" view for people who manage them.

## Non-Goals

- **Co-organizers for personal contests.** Explicitly dropped for this spec. Standalone (non-course) contests remain single-owner. A future spec can introduce `ContestOrganizer` + invite flow; both `canManageContest` and the tab filter are designed so that addition is a one-line extension.
- **Schema changes.** No new tables or columns. `CourseRole` already has `ta`; `Contest` already has `createdByUserId` and `courseId`.
- **Repository changes.** `contestRepo.findDetailBySlug` and friends stay untouched. The hide/reveal decision is made in the domain layer.
- **Changes to IP lock, scoreboard, participation, or the judge pipeline.**

## Design

### 1. Permission primitive

New file `packages/domain/src/contest/permissions.ts` exporting a pure function:

```ts
type ContestPermissionInput = {
  createdByUserId: string;
  courseId: string | null;
};

type CourseMembershipRow = {
  courseId: string;
  role: CourseRole;        // teacher | ta | student
  status: CourseMembershipStatus; // active | removed
};

export function canManageContest(
  userId: string | null,
  contest: ContestPermissionInput,
  courseMemberships: CourseMembershipRow[],
): boolean;
```

Rules:

1. `userId === null` → `false`
2. `contest.createdByUserId === userId` → `true`
3. `contest.courseId !== null` and there exists a membership with the same `courseId`, `role ∈ {teacher, ta}`, `status === active` → `true`
4. Otherwise → `false`

Design choices:

- **Inputs are plain data, not entities.** Callers fetch memberships however they like (single-row query for detail page, batched query for list page). This avoids N+1 and keeps the function trivially unit-testable.
- **`userId: null` is accepted** so unauthenticated callers can ask the same question without a guard at every call site.
- **The function is monotonic**: returning `true` never requires fetching more data than the caller already has. This is what lets the list page batch-resolve permissions for many contests at once.

This same primitive is consumed by the detail page, the problem solve page, and the list page tab split.

### 2. Detail page: hide problems before start

**File:** `packages/domain/src/contest/queries.ts`

Consolidate `getContestDetail(slug)` and `getContestWorkspaceData(slug, userId)` into:

```ts
getContestDetail(slug, { userId, now }): ContestDetailView
```

Flow inside the function:

1. Load the contest via the existing `contestRepo.findDetailBySlug(slug)` (problems included, unchanged).
2. If `contest.courseId !== null`, query that one user's memberships for that course in a single `findMany`. Otherwise skip.
3. Call `canManageContest(userId, contest, memberships)` → `isManager`.
4. Compute `isActive = now >= contest.startsAt && now <= contest.endsAt`.
5. Compute `problemsHidden = !isManager && now < contest.startsAt`.
6. Shape the payload:

```ts
type ContestDetailView = {
  contest: {
    id: string;
    slug: string;
    title: string;
    summary: string;
    startsAt: Date;
    endsAt: Date;
    scoringMode: ScoringMode;
    scoreboardMode: ScoreboardMode;
    allowedLanguages: SupportedLanguage[];
    ipWhitelistEnabled: boolean;
    ipBindingEnabled: boolean;
    status: 'upcoming' | 'active' | 'ended';
  };
  problems: ProblemSummary[] | null; // null when problemsHidden
  problemsHidden: boolean;
  isManager: boolean;
  participation: ContestParticipation | null;
};
```

Key choices:

- **`problems: null` instead of `[]`.** A future "contest with no problems yet" state would make `[]` ambiguous; `null` reads as "deliberately withheld."
- **`problemsHidden` is an explicit flag.** The UI should not have to re-derive "is this a hidden state" from `null`, start time, and user identity.
- **Rule applies uniformly.** No per-contest opt-in flag. If the user later wants an exception, a boolean column is easy to add; defaulting it to `true` (the safe direction) costs nothing today and prevents accidental leaks from owners who forget to check a box.

### 3. Problem solve page: admit managers early

**File:** `apps/web/src/routes/(app)/contests/[slug]/problems/[problemId]/+page.server.ts`

Current behaviour: redirects out if `now < startsAt` or `now > endsAt`. Update: before redirecting on the `now < startsAt` branch, resolve `canManageContest`; if `true`, admit the request. The `now > endsAt` branch is unchanged (ended contests remain read-only for everyone — managers can still see submissions elsewhere).

Rationale: owners and course teachers/TAs need to preview problem pages while authoring the contest. Without this admit, `+page.svelte` could offer a "preview" link but the destination would bounce them back.

### 4. Detail page UI: placeholder and link gating

**File:** `apps/web/src/routes/(app)/contests/[slug]/+page.svelte`

Replace the current problems section with a conditional:

```svelte
{#if data.problemsHidden}
  <section class="contest-problems-hidden">
    <Lock />
    <h2>{m.contestDetail_problemsHiddenTitle()}</h2>
    <p>{m.contestDetail_problemsHiddenBody()}</p>
    <!-- reuses the existing startsIn countdown composition -->
  </section>
{:else}
  <!-- existing problems section, with one tweak -->
{/if}
```

The one tweak to the existing section: where the current code computes

```svelte
{@const href = isActive ? `/contests/${contest.slug}/problems/${p.id}` : null}
```

change to

```svelte
{@const href = (isActive || data.isManager) ? `/contests/${contest.slug}/problems/${p.id}` : null}
```

This lets a manager click through to the problem page before start, matching §3.

**What the placeholder shows:**

- Lock icon (lucide `Lock`)
- Title: *Problems are not yet available* / *題目尚未公開*
- Body: *Problems will be revealed when the contest starts.* / *本競賽的題目將於開始時公開。*
- Countdown to `startsAt` (reuses the existing `contests_startsIn` string composition)

**What the placeholder does NOT show:**

- Problem count
- Total points
- Any per-problem metadata

This matches the user's choice (the strictest of the three levels discussed during brainstorming).

**Why we keep the surrounding layout:** header, meta, scoreboard, and any other sibling sections are untouched. Only the "list of problems" slot is swapped. This keeps the visual weight of the page stable when the contest transitions from upcoming to active (the placeholder dissolves, the list appears, nothing else reflows).

### 5. List page: participable vs managed tabs

**Files:**
- `packages/domain/src/contest/queries.ts` — new function
- `apps/web/src/routes/(app)/contests/+page.server.ts` — call the new function
- `apps/web/src/routes/(app)/contests/+page.svelte` — tabs UI

New domain function:

```ts
listContestsForUser(userId: string | null, now: Date): {
  participable: ContestListItem[];
  managed: ContestListItem[];
}
```

**"Participable" rules:**

- `visibility = 'published'`
- Either standalone (`courseId = null`) and accessible to everyone
- Or `courseId` set and the user has an active `student` membership in that course
- **Excluding** any contest the user manages (prevents a contest from appearing in both tabs)
- Sorted by `startsAt desc` (upcoming/recent first)

**"Managed" rules:**

- `createdByUserId = userId` (standalone contests the user owns)
- Or `courseId` set and the user has an active `teacher` or `ta` membership in that course
- Includes all visibilities (`draft`, `published`, `archived`) so owners can manage their drafts
- Sorted by `updatedAt desc` (most recently edited first)

**Query strategy (avoid N+1):**

1. Fetch the user's active course memberships once, keyed by role.
2. Derive three `courseId` lists: `{teacher, ta, student}`.
3. Issue two contest queries:
   - Managed: `createdByUserId = userId OR courseId IN teacherOrTaCourses`
   - Participable: `visibility = 'published' AND (courseId IS NULL OR courseId IN studentCourses)`
4. In memory: subtract `managed` from `participable` (by id) so nothing is double-counted.
5. Sort each list per the rules above.

For an unauthenticated caller (`userId = null`), skip the membership query, skip the managed query, and return `managed: []` with participable restricted to standalone published contests.

**Edge: user is both `teacher` and `student` in the same course.** Teacher wins — the contest appears only in `managed`. This falls out naturally from step 4 (subtract managed from participable).

**UI:**

- Bits UI `Tabs` component at the top of `/contests`.
- Two tabs: *Participable* (default), *Managed*.
- Tab state synced to URL via `?tab=managed` so links are shareable and refresh-stable.
- Each tab renders the existing contest card list (unchanged card markup).
- Managed cards additionally show a small `visibility` badge (`draft` / `published` / `archived`) so owners can tell a draft from a live contest at a glance.
- Empty states:
  - Participable empty → `contests_emptyParticipable`
  - Managed empty → `contests_emptyManaged` (always shown rather than hiding the tab, so the UI is stable as users gain/lose managed contests)
- Unauthenticated: both tabs visible; managed tab shows "sign in to see contests you manage" empty state.

### 6. i18n keys

Add to both `en.json` and `zh-TW.json`:

| Key | English | 繁體中文 |
|---|---|---|
| `contests_tabParticipable` | Participable | 可參加的 |
| `contests_tabManaged` | My contests | 我的競賽 |
| `contests_emptyParticipable` | No contests available right now. | 目前沒有可參加的競賽。 |
| `contests_emptyManaged` | You don't manage any contests yet. | 您還沒有主辦任何競賽。 |
| `contests_visibilityDraft` | Draft | 草稿 |
| `contests_visibilityArchived` | Archived | 已封存 |
| `contestDetail_problemsHiddenTitle` | Problems are not yet available | 題目尚未公開 |
| `contestDetail_problemsHiddenBody` | Problems will be revealed when the contest starts. | 本競賽的題目將於開始時公開。 |

## Edge Cases

1. **`now === startsAt` exactly.** `problemsHidden = now < startsAt` is strict-less-than, so the instant of `startsAt` reveals problems.
2. **Draft contests.** Non-managers already 404 at the existing visibility check — unchanged. Managers see drafts regardless of time (`isManager` short-circuits the hidden branch).
3. **Archived contests (`now > endsAt`).** Never trigger `problemsHidden`. Existing ended-contest UI is untouched.
4. **Standalone contest (`courseId = null`).** `canManageContest` only checks `createdByUserId`; the course membership query is skipped.
5. **Unauthenticated user.** `userId = null` → never a manager. List page still renders with managed empty state.
6. **Dual-role course member (teacher + student).** Teacher role wins for tab classification.
7. **Course deletion.** `Contest.courseId` has `onDelete: Cascade`, so this case does not need special handling.
8. **Clock skew.** `now` is computed once per request in `+page.server.ts` using `new Date()`, then passed through. Avoids divergence between the hidden check and the status computation.

## Testing

### Unit (Vitest, `packages/domain`)

- `canManageContest` — six cases: owner, course teacher, course TA, course student, stranger, unauthenticated.
- `getContestDetail` — `problemsHidden` truth table:
  - (manager, before start) → `false`, problems present
  - (manager, active) → `false`, problems present
  - (non-manager, before start) → `true`, `problems === null`
  - (non-manager, active) → `false`, problems present
  - (non-manager, ended) → `false`, problems present
- `listContestsForUser` — classification:
  - User-created standalone contest → managed only
  - Course contest where user is teacher → managed only
  - Course contest where user is TA → managed only
  - Course contest where user is student → participable only
  - Public standalone contest → participable only
  - Contest user both created and teaches → managed, not duplicated in participable
  - Unauthenticated → managed empty, participable = all public standalone

### Integration (Vitest, `apps/web` routes)

- `GET /contests/[slug]` — non-manager before `startsAt`: JSON payload contains no problem ids, titles, or points anywhere.
- `GET /contests/[slug]/problems/[id]` — non-manager before `startsAt` → 303 redirect; manager → 200.
- `GET /contests` — `?tab=managed` returns the managed set; no `?tab` or `?tab=participable` returns the participable set.

### E2E (Playwright, local only)

- Student viewing an upcoming contest sees placeholder, does not see any problem title in the DOM.
- Course teacher viewing the same contest sees the full problem list.
- Student visiting `/contests` can switch tabs; managed tab is empty.

## File Impact Summary

| File | Change |
|---|---|
| `packages/domain/src/contest/permissions.ts` | **New** — `canManageContest()` |
| `packages/domain/src/contest/queries.ts` | `getContestDetail` signature + `problemsHidden` shaping; new `listContestsForUser` |
| `apps/web/src/routes/(app)/contests/+page.server.ts` | Call `listContestsForUser`, pass through `tab` query param |
| `apps/web/src/routes/(app)/contests/+page.svelte` | Bits UI Tabs, visibility badges, empty states |
| `apps/web/src/routes/(app)/contests/[slug]/+page.server.ts` | Pass `userId`, `now` to domain |
| `apps/web/src/routes/(app)/contests/[slug]/+page.svelte` | `{#if problemsHidden}` branch, `isManager` in link href |
| `apps/web/src/routes/(app)/contests/[slug]/problems/[problemId]/+page.server.ts` | Admit managers before `startsAt` |
| `apps/web/messages/en.json` | 8 new keys |
| `apps/web/messages/zh-TW.json` | 8 new keys |
| `tests/` | Unit + integration + E2E as above |

**Untouched:** Prisma schema, `contestRepo`, `ContestParticipation` logic, IP lock, scoreboard, judge pipeline.
