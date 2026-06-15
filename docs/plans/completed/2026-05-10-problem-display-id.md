# Problem `displayId` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every problem a human-readable sequential `displayId` (1, 2, 3...) for UI display, while keeping the existing cuid as the durable primary key for URLs, FKs, and API surface.

**Architecture:** Add an `Int @unique @default(autoincrement())` column on `Problem`, backed by a Postgres sequence. A single migration adds the column, backfills existing rows by `createdAt ASC`, and pins the sequence to continue from the highest assigned value. Domain selects forward `displayId` to the frontend; a small format helper (`formatProblemDisplayName`) standardises the `#42 標題` rendering.

**Tech Stack:** Prisma 7, PostgreSQL 18, Zod 4 (`@nojv/core`), SvelteKit + paraglide-js (i18n), Vitest (unit + integration), Playwright (E2E).

**Reference spec:** `docs/superpowers/specs/2026-05-10-problem-display-id-design.md`

---

## Task 1: Add `displayId` column with migration & backfill

**Files:**

- Modify: `packages/db/prisma/schema/problem.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_problem_display_id/migration.sql`

- [ ] **Step 1: Update Prisma schema**

In `packages/db/prisma/schema/problem.prisma`, add `displayId` to the `Problem` model directly under `id`:

```prisma
model Problem {
  id        String  @id @default(cuid())
  displayId Int     @unique @default(autoincrement())
  title     String
  // ... rest unchanged
}
```

Do NOT add an extra `@@index([displayId])` — `@unique` already creates a btree index.

- [ ] **Step 2: Generate the migration timestamp directory**

Use the existing migration filename convention (`YYYYMMDDhhmmss_description`). Pick a timestamp later than `20260506122742_problem_advanced_required_paths`. Example: `20260510120000_add_problem_display_id`.

```bash
mkdir -p packages/db/prisma/migrations/20260510120000_add_problem_display_id
```

- [ ] **Step 3: Write the migration SQL**

Create `packages/db/prisma/migrations/20260510120000_add_problem_display_id/migration.sql`:

```sql
-- Add displayId as nullable first to avoid blocking concurrent inserts.
ALTER TABLE "Problem" ADD COLUMN "displayId" INTEGER;

-- Backfill: assign sequential numbers to existing rows ordered by createdAt
-- (id breaks ties so the result is deterministic).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "Problem"
)
UPDATE "Problem" p
SET "displayId" = ranked.rn
FROM ranked
WHERE p.id = ranked.id;

-- Create the sequence Prisma's @default(autoincrement()) expects, owned by
-- the column so Postgres tears it down with the table.
CREATE SEQUENCE "Problem_displayId_seq" AS INTEGER OWNED BY "Problem"."displayId";

-- Pin sequence to continue from MAX(displayId) + 1; COALESCE handles empty tables.
SELECT setval(
  '"Problem_displayId_seq"',
  COALESCE((SELECT MAX("displayId") FROM "Problem"), 0) + 1,
  false
);

-- Lock the column down: NOT NULL, default from sequence, UNIQUE constraint.
ALTER TABLE "Problem"
  ALTER COLUMN "displayId" SET NOT NULL,
  ALTER COLUMN "displayId" SET DEFAULT nextval('"Problem_displayId_seq"');
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_displayId_key" UNIQUE ("displayId");
```

- [ ] **Step 4: Apply the migration to the local dev DB**

```bash
pnpm db:migrate
```

Expected: Prisma reports the new migration applied. No drift warnings.

- [ ] **Step 5: Regenerate the Prisma client**

```bash
pnpm db:generate
```

- [ ] **Step 6: Manual verification of backfill ordering**

Open a psql shell against the dev DB and confirm existing rows have `displayId` filled in `createdAt` order, and that the sequence is positioned correctly:

```bash
psql "$DATABASE_URL" -c '
  SELECT "displayId", "createdAt", id
  FROM "Problem"
  ORDER BY "createdAt" ASC, id ASC
  LIMIT 10;
'
psql "$DATABASE_URL" -c "SELECT last_value, is_called FROM \"Problem_displayId_seq\";"
```

Expected: `displayId` increases monotonically alongside `createdAt`. Sequence `last_value` equals `MAX(displayId) + 1` with `is_called = false` (so the next `nextval` returns exactly `MAX + 1`).

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema/problem.prisma \
        packages/db/prisma/migrations/20260510120000_add_problem_display_id
git commit -m "feat(db): add Problem.displayId with backfill"
```

---

## Task 2: Integration test for `displayId` allocation

**Files:**

- Create: `tests/integration/db/problem-display-id.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { createTestProblem, testPrisma } from "../../fixtures/factories";

describe("Problem.displayId (real DB)", () => {
  it("assigns unique, monotonically increasing displayIds to new problems", async () => {
    const baseline = (await testPrisma.problem.aggregate({ _max: { displayId: true } }))._max
      .displayId;
    const start = baseline ?? 0;

    const a = await createTestProblem();
    const b = await createTestProblem();
    const c = await createTestProblem();

    expect(a.displayId).toBe(start + 1);
    expect(b.displayId).toBe(start + 2);
    expect(c.displayId).toBe(start + 3);
  });

  it("never reuses a displayId after deletion", async () => {
    const a = await createTestProblem();
    const skippedId = a.displayId;

    await testPrisma.problem.delete({ where: { id: a.id } });

    const b = await createTestProblem();
    expect(b.displayId).toBeGreaterThan(skippedId);
  });
});
```

- [ ] **Step 2: Run test and verify it passes**

```bash
pnpm test:integration -- problem-display-id
```

Expected: both tests pass. (If the column / sequence wiring is wrong, the first assertion fails with `displayId` undefined or non-sequential.)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/db/problem-display-id.test.ts
git commit -m "test(db): assert Problem.displayId allocation"
```

---

## Task 3: Expose `displayId` through repository select shapes

**Files:**

- Modify: `packages/db/src/repositories/selects.ts`
- Modify: `packages/db/src/repositories/problem.ts:108-113`

- [ ] **Step 1: Add `displayId` to the three Problem mini-selects**

Update `packages/db/src/repositories/selects.ts`:

```ts
// Problem ref — id + title only; the go-to shape for list rows, nested selects, and link targets.
export const problemMiniSelect = {
  id: true,
  displayId: true,
  title: true,
} satisfies Prisma.ProblemSelect;

// Problem preview — mini fields plus localised statements for preview surfaces.
export const problemPreviewSelect = {
  id: true,
  displayId: true,
  title: true,
  statements: true,
} satisfies Prisma.ProblemSelect;

// Problem teacher mini — adds `difficulty` for teacher-facing problem lists on exam/assessment detail pages.
export const problemTeacherMiniSelect = {
  id: true,
  displayId: true,
  title: true,
  difficulty: true,
} satisfies Prisma.ProblemSelect;
```

- [ ] **Step 2: Add `displayId` to the bare `select` in `findRecommendations`**

In `packages/db/src/repositories/problem.ts:108`, expand the inline select inside `findRecommendations` so that the recommendation list also carries the new field:

```ts
      select: {
        id: true,
        displayId: true,
        title: true,
        tags: true,
        difficulty: true,
      },
```

(`findById`, `findDetailById`, `listWithCounts`, and `listEditable` use full-row reads or `include`, so `displayId` is automatic — no change needed.)

- [ ] **Step 3: Type-check**

```bash
pnpm -C packages/db tsc --noEmit
```

Expected: passes. (If a consumer destructures `problemMiniSelect` results without expecting `displayId`, TS will flag it now — fix the consumer in the same task.)

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/repositories/selects.ts packages/db/src/repositories/problem.ts
git commit -m "feat(db): include displayId in Problem repo selects"
```

---

## Task 4: Surface `displayId` in core Zod schemas and domain query mappers

**Files:**

- Modify: `packages/core/src/schemas/problem.ts:180-186`
- Modify: `packages/application/src/problem/queries.ts` (interfaces `ProblemDetail`, `ProblemCardWithStatus`; mappers `mapPersistedProblemDetail`, `listProblemCards`, `listEditableProblems`)

- [ ] **Step 1: Add `displayId` to `problemOverviewSchema`**

```ts
export const problemOverviewSchema = z.object({
  acceptanceRate: z.number().min(0).max(1),
  difficulty: problemDifficultySchema,
  displayId: z.number().int().positive(),
  id: z.string().min(1),
  title: z.string().min(1),
  totalSubmissions: z.number().int().nonnegative(),
});
```

- [ ] **Step 2: Add `displayId` to the two cross-package interfaces**

In `packages/application/src/problem/queries.ts`:

`ProblemDetail` (around line 27) — add `displayId: number;` next to `id: string;`.

`ProblemCardWithStatus` (around line 245) — add `displayId: number;` next to `id: string;`.

- [ ] **Step 3: Update `mapPersistedProblemDetail`**

Around line 142, extend the input parameter type to allow `displayId: number`. In the return object (around line 207–231), add `displayId: problem.displayId,` next to `id: problem.id,`.

- [ ] **Step 4: Update `listProblemCards` mapping**

In the `persistedProblems.map(...)` block around line 334–352, add `displayId: problem.displayId,` next to `id: problem.id,`.

- [ ] **Step 5: Update `listEditableProblems` mapping**

In the `problems.map(...)` block around line 360–374, add `displayId: problem.displayId,` next to `id: problem.id,`.

- [ ] **Step 6: Sweep for any other mapper that strips fields**

```bash
grep -rn "id:.*problem\.id\|id: persistedProblem\.id\|title: persistedProblem\.title" packages/application/src/
```

For each match outside the three mappers above, ensure the returned object also contains `displayId: <source>.displayId`. Pass-through spreads (`return problem;`) need no change.

- [ ] **Step 7: Type-check**

```bash
pnpm -C packages/core tsc --noEmit
pnpm -C packages/application tsc --noEmit
```

Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/schemas/problem.ts packages/application/src/problem/queries.ts
git commit -m "feat(core,domain): expose Problem.displayId to consumers"
```

---

## Task 5: Add `formatProblemDisplayName` utility + i18n message (with unit test)

**Files:**

- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`
- Create: `apps/web/src/lib/utils/format-problem-display-name.ts`
- Create: `tests/unit/web/format-problem-display-name.test.ts`

- [ ] **Step 1: Add the i18n message in both locales**

In `apps/web/messages/en.json` (alphabetical position next to other `common_*` keys):

```json
  "common_problemDisplayId": "#{id}",
```

In `apps/web/messages/zh-TW.json`:

```json
  "common_problemDisplayId": "#{id}",
```

- [ ] **Step 2: Write the failing unit test**

Create `tests/unit/web/format-problem-display-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatProblemDisplayName } from "../../../apps/web/src/lib/utils/format-problem-display-name";

describe("formatProblemDisplayName", () => {
  it("prepends the display id followed by a single space and the title", () => {
    expect(formatProblemDisplayName({ displayId: 42, title: "Binary Search" })).toBe(
      "#42 Binary Search",
    );
  });

  it("handles non-ASCII titles unchanged", () => {
    expect(formatProblemDisplayName({ displayId: 7, title: "二分搜尋" })).toBe("#7 二分搜尋");
  });

  it("preserves whitespace already inside the title", () => {
    expect(formatProblemDisplayName({ displayId: 1, title: "  spaced  " })).toBe(
      "#1   spaced  ",
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm test:unit -- format-problem-display-name
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Implement the helper**

Create `apps/web/src/lib/utils/format-problem-display-name.ts`:

```ts
import { m } from "$lib/paraglide/messages.js";

export function formatProblemDisplayName(input: { displayId: number; title: string }): string {
  return `${m.common_problemDisplayId({ id: input.displayId })} ${input.title}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test:unit -- format-problem-display-name
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/messages/en.json apps/web/messages/zh-TW.json \
        apps/web/src/lib/utils/format-problem-display-name.ts \
        tests/unit/web/format-problem-display-name.test.ts
git commit -m "feat(web): add formatProblemDisplayName utility"
```

---

## Task 6: Replace cuid display in `/courses/[courseId]/exams/new`

**Files:**

- Modify: `apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.svelte:209`
- Modify: `apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.svelte:258`
- Modify: `apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.server.ts` (if loader hand-picks problem fields)

- [ ] **Step 1: Confirm loader passes `displayId` to the page**

Open `apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.server.ts`. If the loader returns problems via a hand-built shape, add `displayId` to it. If it pipes through `problemTeacherMiniSelect` (or full rows) the field is already present after Task 3 — no change.

- [ ] **Step 2: Replace the truncated cuid in the candidate list**

Around line 209 of `+page.svelte`:

```svelte
<span class="text-caption text-muted-foreground tabular-nums">
  #{problem.displayId}
</span>
```

(Remove the existing `{problem.id.slice(0, 14)}` span entirely; the `#NN` form is the new identifier shown to teachers.)

- [ ] **Step 3: Replace the cuid in the selected list**

Around line 258 of `+page.svelte`:

```svelte
<span class="text-caption text-muted-foreground tabular-nums">
  #{problem.displayId}
</span>
```

(Replaces `{problem.id}`.)

- [ ] **Step 4: Manual smoke test**

```bash
pnpm dev
```

Open `/courses/<any course id>/exams/new`, confirm the candidate cards show `#1`, `#2`... in place of the previous truncated cuid; selecting one shows the same id in the right-hand selected list.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.svelte \
        apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.server.ts
git commit -m "feat(web): show displayId on exam new problem selector"
```

---

## Task 7: Replace cuid display in `/courses/[courseId]/assignments/new`

**Files:**

- Modify: `apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.svelte:229`
- Modify: `apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.svelte:281`
- Modify: `apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.server.ts` (if loader hand-picks problem fields)

- [ ] **Step 1: Confirm loader passes `displayId`**

Same audit as Task 6 step 1. Add `displayId` to any hand-built returned shape; pass-through requires no change.

- [ ] **Step 2: Replace the cuid in the candidate list**

Around line 229 of `+page.svelte`:

```svelte
<span class="text-caption text-muted-foreground tabular-nums">
  #{problem.displayId}
</span>
```

- [ ] **Step 3: Replace the cuid in the selected list**

Around line 281 of `+page.svelte`:

```svelte
<span class="text-caption text-muted-foreground tabular-nums">
  #{problem.displayId}
</span>
```

- [ ] **Step 4: Manual smoke test**

`/courses/<id>/assignments/new` shows `#NN` instead of cuid in both panels.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.svelte \
        apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.server.ts
git commit -m "feat(web): show displayId on assignment new problem selector"
```

---

## Task 8: Add `#N` prefix to public + mine problem lists (`Tabs.svelte`)

**Files:**

- Modify: `apps/web/src/lib/components/problem/Tabs.svelte:444` (public branch)
- Modify: `apps/web/src/lib/components/problem/Tabs.svelte:625` (mine branch)
- Modify: `apps/web/src/routes/(app)/problems/+page.server.ts` (if loader hand-picks problem fields)

- [ ] **Step 1: Confirm both list payloads include `displayId`**

`apps/web/src/routes/(app)/problems/+page.server.ts` calls `listProblemCards` and `listEditableProblems` — both updated in Task 4. No additional loader change is needed. (Sanity-check by opening the file and confirming the two functions are still the data source.)

- [ ] **Step 2: Import the helper at the top of `Tabs.svelte`**

In the `<script>` section of `Tabs.svelte`:

```ts
import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
```

- [ ] **Step 3: Update the public branch title rendering**

Around line 444 (public list `<h3>`):

```svelte
<h3 class="text-title font-semibold">{formatProblemDisplayName(problem)}</h3>
```

- [ ] **Step 4: Update the mine branch title rendering**

Around line 625:

```svelte
<h3 class="text-title font-semibold">{formatProblemDisplayName(problem)}</h3>
```

- [ ] **Step 5: Manual smoke test**

```bash
pnpm dev
```

`/problems` (public tab) and `/problems?tab=mine` (mine tab) both render titles as `#NN <title>`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/problem/Tabs.svelte \
        apps/web/src/routes/(app)/problems/+page.server.ts
git commit -m "feat(web): prefix problem list titles with #displayId"
```

---

## Task 9: Add `#N` prefix to problem detail header (`ProblemLeftPanel`)

**Files:**

- Modify: `apps/web/src/lib/components/problem/ProblemLeftPanel.svelte:253`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/+page.server.ts` (if needed)

- [ ] **Step 1: Confirm loader returns `displayId`**

`/problems/[problemId]/+page.server.ts` calls `getProblemPageData`. Verify the returned `data.problem` shape includes `displayId` (Task 4 added it). If a custom shape strips it before sending to the page, fix that.

- [ ] **Step 2: Update the header**

Around line 253 of `ProblemLeftPanel.svelte`:

```svelte
<h1 class="text-body-lg font-semibold leading-snug">
  {formatProblemDisplayName(problem)}
</h1>
```

Add the import inside the existing `<script>` block:

```ts
import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
```

- [ ] **Step 3: Manual smoke test**

`/problems/<cuid>` heading shows `#NN <title>`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/problem/ProblemLeftPanel.svelte \
        apps/web/src/routes/(app)/problems/[problemId]/+page.server.ts
git commit -m "feat(web): prefix problem detail heading with #displayId"
```

---

## Task 10: Add `#N` prefix to problem edit page header

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte:166`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.server.ts` (if needed)

- [ ] **Step 1: Confirm loader returns `displayId`**

The loader uses `getProblemPageData`; should be available after Task 4.

- [ ] **Step 2: Update the heading**

In `+page.svelte`, replace the heading (line 165–167):

```svelte
<h1 class="font-display text-title-lg">
  {data.problem.title === "Untitled Problem"
    ? m.admin_createProblem()
    : formatProblemDisplayName(data.problem)}
</h1>
```

Add import to `<script>`:

```ts
import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
```

(`Untitled Problem` is a sentinel for new draft creation — keep that branch unprefixed.)

- [ ] **Step 3: Manual smoke test**

Open `/problems/<cuid>/edit` for an existing problem; heading shows `#NN <title>`. Open the create flow (`/problems/new` → redirects into edit with title `Untitled Problem`); heading still shows `m.admin_createProblem()` with no `#NN`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte \
        apps/web/src/routes/(app)/problems/[problemId]/edit/+page.server.ts
git commit -m "feat(web): prefix problem edit heading with #displayId"
```

---

## Task 11: Add `#N` prefix to editorials views

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/[problemId]/editorials/+page.svelte:69`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/editorials/+page.server.ts:47`
- Modify: `apps/web/src/routes/(app)/editorials/[id]/edit/+page.svelte:55`
- Modify: `apps/web/src/routes/(app)/editorials/[id]/edit/+page.server.ts:36`

- [ ] **Step 1: Add `displayId` to the explicit `problem` shape returned by the loaders**

In `apps/web/src/routes/(app)/problems/[problemId]/editorials/+page.server.ts:47`:

```ts
problem: { id: problem.id, displayId: problem.displayId, title: problem.title },
```

In `apps/web/src/routes/(app)/editorials/[id]/edit/+page.server.ts:36`:

```ts
problem: problem
  ? { id: problem.id, displayId: problem.displayId, title: problem.title }
  : null,
```

- [ ] **Step 2: Update the editorials list link**

In `apps/web/src/routes/(app)/problems/[problemId]/editorials/+page.svelte`, around line 68–70:

```svelte
<a href="/problems/{data.problem.id}" class="text-primary hover:underline">
  {formatProblemDisplayName(data.problem)}
</a>
```

Add the import to the `<script>` block.

- [ ] **Step 3: Update the editorial edit back link**

In `apps/web/src/routes/(app)/editorials/[id]/edit/+page.svelte` around line 55:

```svelte
<a href="/problems/{data.problem.id}/editorials" class="text-primary hover:underline">
  ← {formatProblemDisplayName(data.problem)}
</a>
```

Add the import.

- [ ] **Step 4: Manual smoke test**

Open `/problems/<cuid>/editorials` then click the link to `/editorials/<id>/edit`; both titles show `#NN <title>`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/(app)/problems/[problemId]/editorials/+page.svelte \
        apps/web/src/routes/(app)/problems/[problemId]/editorials/+page.server.ts \
        apps/web/src/routes/(app)/editorials/[id]/edit/+page.svelte \
        apps/web/src/routes/(app)/editorials/[id]/edit/+page.server.ts
git commit -m "feat(web): prefix editorial views with #displayId"
```

---

## Task 12: Add `#N` prefix to dashboard, submission detail, and admin list

**Files:**

- Modify: `apps/web/src/routes/(app)/dashboard/+page.svelte:416` (+ its server loader)
- Modify: `apps/web/src/routes/(app)/dashboard/+page.server.ts` (if `submissions` rows hand-pick problem fields)
- Modify: `apps/web/src/routes/(app)/submissions/[submissionId]/+page.svelte:31`
- Modify: `apps/web/src/routes/(app)/submissions/[submissionId]/+page.server.ts` (if needed)
- Modify: `apps/web/src/routes/(app)/admin/+page.svelte:361` (+ its server loader)
- Modify: `apps/web/src/routes/(app)/admin/+page.server.ts` (if needed)

- [ ] **Step 1: Audit each loader for `problem` projection**

For each of dashboard, submissions detail, and admin, open the matching `+page.server.ts`. If the response includes `submission.problem` or `row.problem` selected via `problemMiniSelect` / pass-through, no work required. If the loader hand-picks fields, add `displayId`.

- [ ] **Step 2: Update the dashboard recent-submissions row**

In `apps/web/src/routes/(app)/dashboard/+page.svelte`, around line 413–417:

```svelte
<a href="/problems/{sub.problem.id}" class="hover:underline">
  {formatProblemDisplayName(sub.problem)}
</a>
```

Add the import.

- [ ] **Step 3: Update the submission detail breadcrumb**

In `apps/web/src/routes/(app)/submissions/[submissionId]/+page.svelte`, around line 31:

```svelte
<span class="text-muted-foreground">{formatProblemDisplayName(submission.problem)}</span>
```

Add the import.

- [ ] **Step 4: Update the admin row**

In `apps/web/src/routes/(app)/admin/+page.svelte`, around line 361:

```svelte
<a class="hover:underline" href="/problems/{row.problem.id}">
  {formatProblemDisplayName(row.problem)}
</a>
```

Add the import.

- [ ] **Step 5: Manual smoke test**

`/dashboard`, `/submissions/<sub-id>`, and `/admin` all render `#NN <title>` for problem references.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/(app)/dashboard/+page.svelte \
        apps/web/src/routes/(app)/dashboard/+page.server.ts \
        apps/web/src/routes/(app)/submissions/[submissionId]/+page.svelte \
        apps/web/src/routes/(app)/submissions/[submissionId]/+page.server.ts \
        apps/web/src/routes/(app)/admin/+page.svelte \
        apps/web/src/routes/(app)/admin/+page.server.ts
git commit -m "feat(web): prefix dashboard/submissions/admin problem rows with #displayId"
```

---

## Task 13: Add `#N` prefix to assignment / exam detail pages

**Files:**

- Modify: `apps/web/src/routes/(app)/assignments/[assessmentId]/+page.svelte:264`
- Modify: `apps/web/src/routes/(app)/assignments/[assessmentId]/+page.server.ts` (if needed)
- Audit + update the matching exam detail page if it shows the same title shape (check `apps/web/src/routes/(app)/courses/[courseId]/exams/[examId]/+page.svelte` and `apps/web/src/routes/(app)/courses/[courseId]/assignments/[assessmentId]/+page.svelte`)

- [ ] **Step 1: Audit loader output**

For each route, ensure `problem` carries `displayId`. Most should be using `problemTeacherMiniSelect` or full rows after Task 3.

- [ ] **Step 2: Update the assignment detail problem rows**

In `apps/web/src/routes/(app)/assignments/[assessmentId]/+page.svelte` around line 264:

```svelte
<div class="text-body-lg font-semibold tracking-[-0.01em]">
  {formatProblemDisplayName(problem)}
</div>
```

Add the import.

- [ ] **Step 3: Replicate to any sibling exam / assignment detail pages**

Search for `{problem.title}` across `apps/web/src/routes/(app)/courses/[courseId]/`:

```bash
grep -rn "{problem\.title}\|{problem\.title }\|{ problem\.title }" \
  apps/web/src/routes/\(app\)/courses/\[courseId\]/ \
  apps/web/src/routes/\(app\)/assignments/\[assessmentId\]/ \
  apps/web/src/routes/\(app\)/exams/
```

For each match still rendering bare `{problem.title}`, replace with `{formatProblemDisplayName(problem)}` and ensure the matching loader carries `displayId`.

- [ ] **Step 4: Manual smoke test**

Open an assignment detail and an exam detail (manager view); each problem row shows `#NN <title>`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/\(app\)/assignments \
        apps/web/src/routes/\(app\)/courses
git commit -m "feat(web): prefix assignment & exam problem rows with #displayId"
```

---

## Task 14: E2E coverage + final verification

**Files:**

- Modify: `tests/e2e/problem-lifecycle.test.ts`

- [ ] **Step 1: Add an assertion to `problem-lifecycle.test.ts`**

In whichever step the test navigates to a published problem detail page, add:

```ts
await expect(page.getByRole("heading", { level: 1 })).toHaveText(/#\d+\s.+/);
```

Pick the heading locator that matches the `<h1>` rendered by `ProblemLeftPanel.svelte`; if the existing test already locates it, append the regex assertion alongside the title check.

- [ ] **Step 2: Run the targeted E2E test**

```bash
pnpm test:e2e -- problem-lifecycle
```

Expected: PASS, including the new heading regex assertion.

- [ ] **Step 3: Run the full CI verify**

```bash
pnpm ci:verify
```

Expected: lint, format, typecheck, unit, integration all green. (E2E is excluded from CI per repo convention.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/problem-lifecycle.test.ts
git commit -m "test(e2e): assert displayId prefix on problem heading"
```

---

## Out of Scope

- No new “lookup by `displayId`” query / API. URLs continue to use cuid.
- No reuse of deleted `displayId`s. Sequence advances forward only.
- No per-author or per-course numbering. Single global sequence.
- No data backfill stress-testing — the migration runs in one transaction; if it fails on prod it rolls back cleanly.
