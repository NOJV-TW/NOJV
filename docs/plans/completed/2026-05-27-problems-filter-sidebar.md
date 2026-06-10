# Problems Filter Sidebar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the public problem-library filters into a left sidebar (with a mobile drawer), add Status / Problem-Type / Judge-Method filters, and add a per-user bookmark feature.

**Architecture:** Filters stay URL-`searchParams`-driven (server `load` re-runs on change, instant apply). The new sidebar is a single `ProblemFilterSidebar.svelte` rendered inline on `lg+` and inside a Bits-UI `Dialog` drawer on small screens. Bookmarks get a new `ProblemBookmark` table; judge-method filtering reads the existing `judgeConfig` JSON (no denormalized column). Status counts are computed server-side over the public+published base set, only for authenticated users.

**Tech Stack:** SvelteKit 5 (runes), Prisma 7, Postgres 18, Zod 4, `@nojv/domain` query/mutation layer, Vitest integration tests, Paraglide i18n (en + zh-TW).

---

## Conventions used below

- Difficulty/judge labels reuse existing helpers in `problem-display.ts` (`renderProblemType`, `renderJudgeMethod`).
- Actual enum values (NOT the reference mockup labels): `ProblemType` = `full_source | multi_file | special_env`; `JudgeType` = `standard | checker | interactive`.
- Status filter is **single-select** (radio): `solved | attempted | untried | bookmarked` (+ implicit "all" = no param).
- Filters combine with **AND**; multi-select (`types`, `judgeMethods`, `tags`) are CSV in the URL.
- Run integration tests with `pnpm test:integration` (real Postgres). Run `pnpm db:generate` after any schema edit.

---

## Phase 1 — Data model: bookmarks

### Task 1: Add `ProblemBookmark` model + migration

**Files:**

- Modify: `packages/db/prisma/schema/problem.prisma` (add model + relation on `Problem`)
- Modify: `packages/db/prisma/schema/auth.prisma` (add reverse relation on `User`)
- Create: `packages/db/prisma/migrations/20260527000000_add_problem_bookmark/migration.sql`

**Step 1: Add the model to `problem.prisma`** (after the `Problem` model)

```prisma
model ProblemBookmark {
  id        String   @id @default(cuid())
  userId    String
  problemId String
  createdAt DateTime @default(now())

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  problem Problem @relation(fields: [problemId], references: [id], onDelete: Cascade)

  @@unique([userId, problemId])
  @@index([userId, createdAt])
}
```

**Step 2:** In `Problem` model relations block add: `bookmarks ProblemBookmark[]`
**Step 3:** In `User` model relations block (auth.prisma) add: `problemBookmarks ProblemBookmark[]`

**Step 4: Write the migration SQL** (mirror an existing migration's quoting style)

```sql
CREATE TABLE "ProblemBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProblemBookmark_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProblemBookmark_userId_problemId_key" ON "ProblemBookmark"("userId", "problemId");
CREATE INDEX "ProblemBookmark_userId_createdAt_idx" ON "ProblemBookmark"("userId", "createdAt");
ALTER TABLE "ProblemBookmark" ADD CONSTRAINT "ProblemBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemBookmark" ADD CONSTRAINT "ProblemBookmark_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**Step 5:** Run `pnpm db:generate` then `pnpm db:push` (dev DB). Expected: client regenerates, table created.
**Step 6: Commit** — `feat(db): add ProblemBookmark model + migration`

---

### Task 2: Bookmark repository

**Files:**

- Create: `packages/db/src/repositories/problem-bookmark.ts`
- Modify: `packages/db/src/repositories/index.ts` (export)

```ts
import { prisma } from "../client";

export const problemBookmarkRepo = {
  isBookmarked(userId: string, problemId: string) {
    return prisma.problemBookmark.findUnique({
      where: { userId_problemId: { userId, problemId } },
    });
  },
  add(userId: string, problemId: string) {
    return prisma.problemBookmark.upsert({
      where: { userId_problemId: { userId, problemId } },
      create: { userId, problemId },
      update: {},
    });
  },
  remove(userId: string, problemId: string) {
    return prisma.problemBookmark.deleteMany({ where: { userId, problemId } });
  },
  /** problemIds the user has bookmarked, limited to the given set. */
  async listBookmarkedIds(userId: string, problemIds: string[]): Promise<Set<string>> {
    if (problemIds.length === 0) return new Set();
    const rows = await prisma.problemBookmark.findMany({
      where: { userId, problemId: { in: problemIds } },
      select: { problemId: true },
    });
    return new Set(rows.map((r) => r.problemId));
  },
};
```

Add `export { problemBookmarkRepo } from "./problem-bookmark";` to `index.ts`.

**Commit** — `feat(db): add problemBookmarkRepo`

---

## Phase 2 — Domain: bookmark mutation + extended filters

### Task 3: `toggleBookmark` domain mutation

**Files:**

- Create or extend: `packages/domain/src/problem/bookmarks.ts`
- Modify: `packages/domain/src/problem/index.ts` (re-export under `problemDomain`)
- Test: `tests/integration/domain/problem-bookmark.test.ts`

**Step 1: Failing integration test** — seed a user + published problem; assert `toggleBookmark` flips state and is idempotent per direction.

```ts
// toggle on → bookmarked true; toggle again → false; isBookmarked reflects it
```

**Step 2: Implement**

```ts
import { problemBookmarkRepo, problemRepo } from "@nojv/db";
import { NotFoundError } from "../shared/errors";

export async function toggleBookmark(
  userId: string,
  problemId: string,
): Promise<{ bookmarked: boolean }> {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  const existing = await problemBookmarkRepo.isBookmarked(userId, problemId);
  if (existing) {
    await problemBookmarkRepo.remove(userId, problemId);
    return { bookmarked: false };
  }
  await problemBookmarkRepo.add(userId, problemId);
  return { bookmarked: true };
}
```

**Step 3:** Run test → PASS. **Step 4: Commit** — `feat(domain): add toggleBookmark`

---

### Task 4: Extend `listProblemCards` with status/type/judge filters + statusCounts + per-card `bookmarked`

**Files:**

- Modify: `packages/domain/src/problem/queries.ts:206-326`
- Test: `tests/integration/domain/problem-list-filters.test.ts`

**Step 1: Write failing integration tests** covering:

- `types: ["multi_file"]` returns only multi_file problems.
- `judgeMethods: ["checker"]` returns only checker problems; a problem with `judgeConfig = null` counts as `standard` (matched by `judgeMethods: ["standard"]`, excluded by `["checker"]`).
- `judgeMethods` filter excludes `special_env` problems.
- `status: "solved"` (with a userId who AC'd one problem) returns only that problem; `"untried"` excludes it; `"attempted"` returns problems with submissions but no AC; `"bookmarked"` returns only bookmarked.
- `statusCounts` returns `{ all, solved, attempted, untried, bookmarked }` summing correctly (solved+attempted+untried === all) when `userId` set; `null` when no userId.
- each returned card has `bookmarked: boolean`.

**Step 2: Extend `ProblemListParams`**

```ts
export interface ProblemListParams {
  difficulty?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  q?: string | undefined;
  sort?: "asc" | "desc" | undefined;
  tags?: string[] | undefined;
  types?: ProblemType[] | undefined;
  judgeMethods?: JudgeType[] | undefined;
  status?: "solved" | "attempted" | "untried" | "bookmarked" | undefined;
  userId?: string | null | undefined;
}
```

**Step 3: Build the extra `where` clauses** (inside `listProblemCards`, after the existing tags block). Use a local `and: Prisma.ProblemWhereInput[]` collected into `where.AND`.

```ts
const and: Prisma.ProblemWhereInput[] = [];

if (params.types && params.types.length > 0) {
  where.type = { in: params.types };
}

// Judge method lives in judgeConfig JSON (null => "standard"). special_env has
// no judge method, so any judge-method filter excludes it.
if (
  params.judgeMethods &&
  params.judgeMethods.length > 0 &&
  params.judgeMethods.length < judgeTypes.length
) {
  const or: Prisma.ProblemWhereInput[] = [];
  for (const jm of params.judgeMethods) {
    if (jm === "standard") {
      or.push({ judgeConfig: { equals: Prisma.DbNull } });
      or.push({ judgeConfig: { path: ["type"], equals: "standard" } });
    } else {
      or.push({ judgeConfig: { path: ["type"], equals: jm } });
    }
  }
  and.push({ type: { not: "special_env" } });
  and.push({ OR: or });
}

// Status (per-user). Requires userId; ignored otherwise.
if (params.userId && params.status) {
  const uid = params.userId;
  const tried = { some: { userId: uid, sampleOnly: false } };
  const accepted = { some: { userId: uid, sampleOnly: false, status: "accepted" } };
  const noneAccepted = { none: { userId: uid, sampleOnly: false, status: "accepted" } };
  const untried = { none: { userId: uid, sampleOnly: false } };
  if (params.status === "solved") and.push({ submissions: accepted });
  else if (params.status === "attempted")
    and.push({ submissions: tried }, { submissions: noneAccepted });
  else if (params.status === "untried") and.push({ submissions: untried });
  else if (params.status === "bookmarked") and.push({ bookmarks: { some: { userId: uid } } });
}

if (and.length > 0) where.AND = and;
```

Add imports at top of file: `judgeTypes` and `JudgeType`, `ProblemType` from `@nojv/core`; `Prisma` is already imported (verify).

**Step 4: statusCounts** — after computing `totalCount`/`persistedProblems`, add a parallel block (only when `params.userId`). Counts are over the **base** public+published set (ignore other selected filters) so the numbers match the mockup's partition:

```ts
const baseWhere: Prisma.ProblemWhereInput = { visibility: "public", status: "published" };
let statusCounts: ProblemStatusCounts | null = null;
if (params.userId) {
  const uid = params.userId;
  const [all, solved, attempted, bookmarked] = await Promise.all([
    problemRepo.count(baseWhere),
    problemRepo.count({
      ...baseWhere,
      submissions: { some: { userId: uid, sampleOnly: false, status: "accepted" } },
    }),
    problemRepo.count({
      ...baseWhere,
      AND: [
        { submissions: { some: { userId: uid, sampleOnly: false } } },
        { submissions: { none: { userId: uid, sampleOnly: false, status: "accepted" } } },
      ],
    }),
    problemRepo.count({ ...baseWhere, bookmarks: { some: { userId: uid } } }),
  ]);
  statusCounts = { all, solved, attempted, untried: all - solved - attempted, bookmarked };
}
```

Add to result type:

```ts
export interface ProblemStatusCounts {
  all: number;
  solved: number;
  attempted: number;
  untried: number;
  bookmarked: number;
}
export interface ProblemListResult {
  page: number;
  pageSize: number;
  problems: ProblemCardWithStatus[];
  totalCount: number;
  statusCounts: ProblemStatusCounts | null;
}
```

**Step 5: per-card `bookmarked`** — after `problemIds` is known, add to the existing `Promise.all` (alongside userStats/userSubmissions):

```ts
params.userId && problemIds.length > 0
  ? problemBookmarkRepo.listBookmarkedIds(params.userId, problemIds)
  : new Set<string>(),
```

Add `bookmarked: bookmarkedIds.has(problem.id)` to each mapped card, and `bookmarked: boolean` to `ProblemCardWithStatus`. Return `statusCounts` in the result.

**Step 6:** Run integration tests → PASS. **Step 7: Commit** — `feat(domain): status/type/judge filters + bookmark status + statusCounts`

---

## Phase 3 — API + page loader

### Task 5: Bookmark toggle endpoint

**Files:**

- Create: `apps/web/src/routes/api/problems/[id]/bookmark/+server.ts`
- Test: `tests/integration/web/problem-bookmark-api.test.ts` (if route-level harness exists; else cover via domain test only)

Use existing API helpers (`writeApiHandler` / `requireApiAuth` per `reference_web_helpers`). POST toggles:

```ts
import { problemDomain } from "@nojv/domain";
import { writeApiHandler, requireApiAuth } from "$lib/server/...";

export const POST = writeApiHandler(async (event) => {
  const { user } = requireApiAuth(event);
  const result = await problemDomain.toggleBookmark(user.id, event.params.id);
  return result; // { bookmarked }
});
```

Confirm exact helper names/signatures from a sibling route (e.g. `api/problems/[id]/editorials/+server.ts`).

**Commit** — `feat(web): bookmark toggle API`

---

### Task 6: Wire new params into `/problems` loader

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/+page.server.ts`

Parse `types`, `judgeMethods` (CSV → filtered enum arrays via `problemTypeSchema`/`judgeTypeSchema` safeParse), and `status` (validate against the 4 values). Pass to `listProblemCards`. `publicResult` now carries `statusCounts` + per-card `bookmarked` automatically.

**Commit** — `feat(web): parse sidebar filter params`

---

## Phase 4 — Frontend

### Task 7: `ProblemFilterSidebar.svelte`

**Files:**

- Create: `apps/web/src/lib/components/features/problem/listings/ProblemFilterSidebar.svelte`

Props: `publicResult` (for `statusCounts` + tag derivation), `loggedIn: boolean`. Reads/writes URL via the same `updateUrl` pattern currently in `PublicProblemsTab` (move that helper in, or duplicate minimally). Sections in order:

- **Search** — debounced input (`q`), 300ms (existing logic).
- **STATUS** — render with `FilterChips` (single-select) using `statusCounts`; only when `loggedIn`. Options: all / solved / attempted / untried / bookmarked.
- **DIFFICULTY** — `FilterChips` single-select (all/easy/medium/hard).
- **PROBLEM TYPE** — checkbox rows (multi). Toggle CSV `types`. Labels via `renderProblemType`.
- **JUDGE METHOD** — checkbox rows (multi). Toggle CSV `judgeMethods`. Labels via `renderJudgeMethod(type, jt)` — pass a non-special type so it renders the method name.
- **TAGS** — pill toggles (existing `togglePublicTag`).
- **Footer** — Reset (clears all params → `goto("?")`) + sort-direction button (existing `toggleSort`).

Checkbox row markup: a `<button role="checkbox" aria-checked>` with a square indicator + label, matching `DESIGN.md` tokens (`text-caption`, `rounded`, `border-border`, active = `border-primary bg-primary/10`). No new checkbox primitive unless one already exists.

**Section heading style:** small uppercase muted label (`text-micro font-semibold uppercase tracking-wide text-muted-foreground`) like the mockup's `STATUS` / `DIFFICULTY`.

**Commit** — `feat(web): ProblemFilterSidebar component`

---

### Task 8: Two-column layout + mobile drawer in `PublicProblemsTab`

**Files:**

- Modify: `apps/web/src/lib/components/features/problem/listings/PublicProblemsTab.svelte`

- Wrap content in `lg:grid lg:grid-cols-[280px_1fr] lg:gap-8`.
- Left column (`lg` only, `hidden lg:block`): `<div class="sticky top-6"><ProblemFilterSidebar .../></div>`.
- Right column: the existing card list `<section>` + pagination (remove the old inline filter block — it moves into the sidebar).
- Above the list on `< lg`: a **「篩選」** button (`lg:hidden`) that opens a `Dialog` (Bits UI) whose content renders the same `ProblemFilterSidebar`. Use `dialog-content` with a left/right sheet style if trivial; otherwise a centered dialog is acceptable for v1.
- Active-filter count badge on the 篩選 button is nice-to-have, skip for v1 (YAGNI).

Keep the public/mine tab toggle + create button where they are in `ProblemTabs.svelte` (above this component) — unchanged.

**Commit** — `feat(web): problems left filter sidebar + mobile drawer`

---

### Task 9: Bookmark button on list cards

**Files:**

- Modify: `apps/web/src/lib/components/features/problem/listings/PublicProblemsTab.svelte` (card grid)
- Possibly create: `apps/web/src/lib/components/features/problem/listings/BookmarkButton.svelte` (shared by card + detail page)

`BookmarkButton` props: `problemId: string`, `bookmarked: boolean`. On click (stop propagation — card is an `<a>`): optimistic toggle, `POST /api/problems/{id}/bookmark` via `fetchWithCsrf`, revert on failure. Icon: `Bookmark` / filled when active (`@lucide/svelte`).

Add it to each card; ensure click doesn't navigate (the card is wrapped in `<a>` — put the button outside the `<a>` or call `e.preventDefault(); e.stopPropagation()`). Only render when `loggedIn`.

**Commit** — `feat(web): bookmark button on problem cards`

---

### Task 10: Bookmark button on problem detail page

**Files:**

- Modify: `apps/web/src/lib/types.ts` (add `bookmarked?: boolean` to `ProblemDetail`)
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/+page.server.ts` (compute `bookmarked` from `locals.user` + `problemBookmarkRepo`/domain, attach to returned problem)
- Modify: `apps/web/src/lib/components/features/problem/left-panel/ProblemDescriptionPanel.svelte:18-43` (render `BookmarkButton` in the title flex row, only when logged in)

The `problem` object already threads down to `ProblemDescriptionPanel`, so no extra prop drilling — just read `problem.bookmarked` and `problem.id`. Expose a domain helper `isBookmarked(userId, problemId)` if not already, and call it in the loader.

**Commit** — `feat(web): bookmark button on problem detail`

---

### Task 11: i18n keys

**Files:**

- Modify: `apps/web/messages/en.json`, `apps/web/messages/zh-TW.json`
- Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide` (per MEMORY lesson)

New keys (en / zh-TW):

- `problems_filterStatus` ("Status" / "狀態"), `problems_statusAll` ("All"/"全部"), `problems_statusSolved` ("Solved"/"已解"), `problems_statusAttemptedFilter` ("Attempted"/"嘗試過"), `problems_statusUntried` ("Untried"/"未嘗試"), `problems_statusBookmarked` ("Bookmarked"/"已收藏")
- `problems_filterProblemType` ("Problem type"/"題型"), `problems_filterJudgeMethod` ("Judge method"/"評測方式")
- `problems_filterTags` ("Tags"/"標籤"), `problems_filterReset` ("Reset"/"重設"), `problems_openFilters` ("Filters"/"篩選")
- `problems_bookmarkAdd` ("Bookmark"/"加入收藏"), `problems_bookmarkRemove` ("Remove bookmark"/"取消收藏")

Reuse `common_difficulty`, existing `problems_filterByDifficulty/Tag`, sort keys.

**Commit** — `feat(web): i18n for filter sidebar + bookmarks`

---

## Phase 5 — Verify

### Task 12: Full verification

Run, in order, and confirm each is green before claiming done (superpowers:verification-before-completion):

- `pnpm db:generate`
- `pnpm -w typecheck`
- `pnpm lint`
- `pnpm -w format`
- `pnpm test:unit`
- `pnpm test:integration`

Manually load `/problems` (logged in + logged out), exercise each filter, toggle a bookmark on a card and on the detail page, resize to mobile and open the drawer.

**Commit** — `test: verify problems filter sidebar` (if any test files changed) and update MEMORY.

---

## Out of scope (YAGNI)

- No active-filter count badge on the mobile 篩選 button (v1).
- No saved/shared filter presets.
- No bookmark on the "my problems" tab (author view).
- No denormalized `judgeType` column (JSON path filtering instead).
- Status counts ignore other active filters (match mockup's partition; simplest correct behavior).
