# Table Sort And Filter Clear Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every data table sorts its ordered columns with one shared up/down-arrow control and every active column filter clears with one ✕ click.

**Architecture:** A pure `table-sort.ts` helper (state toggle, `aria-sort`, stable row sort) plus a `TableSortButton` primitive; the two existing filter primitives gain a clear button. In-memory tables sort on the client; paginated tables (submissions, live submissions, admin audit) pass the sort to the server, whose repositories already page with offset or id cursors that accept any stable `orderBy`.

**Tech Stack:** SvelteKit + Svelte 5 runes, Bits UI, Tailwind 4, `@lucide/svelte`, Paraglide, Prisma 7, Vitest (unit/component).

## Rules (agreed with the user, 2026-10-05)

- Categorical or free-text columns get a **filter**; ordered columns (dates, counts, scores, sizes) get **sort**. A column never has both.
- A table with any sortable column always has exactly one active sort. Clicking the active column flips ↓/↑; clicking another column makes it active at ↓. Sort cannot be cleared. Tables with no ordered column get no sort control.
- Inactive sortable headers show a muted ⇅; the active one shows ↑ or ↓. `<th>` carries `aria-sort`.
- An active filter shows its value with a ✕ button that resets it to empty and re-applies.
- Out of scope: contest and virtual scoreboards (rank is the order), public verdicts/environment tables, dashboard and admin-overview widgets (top 5/8/20 rows).

## Table matrix

| Table                                                           | Filters                                                                             | Sort (default **bold**)                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Course members `routes/(app)/courses/[courseId]/members/+page`  | member, email, role                                                                 | **joined ↓**                                          |
| Admin reports `routes/(app)/admin/reports/+page`                | type, content                                                                       | **reported ↓**                                        |
| Admin registry `routes/(app)/admin/registry/+page`              | tag, digest (size filter removed)                                                   | **size ↓**                                            |
| Score override list `features/score-override/ScoreOverrideList` | new: student (text), problem (select)                                               | score, **updated ↓**                                  |
| Feedback list `features/score-override/FeedbackList`            | new: student (text), problem (select)                                               | **updated ↓**                                         |
| Course gradebook `routes/(app)/courses/[courseId]/grades/+page` | new: student (text, managers only; replaces name sort)                              | activity sums, problem scores, **total ↓**            |
| Results matrix `features/course/submissions/MatrixTable`        | student (search input becomes `TableTextColumnFilter`)                              | problem scores, **total ↓**                           |
| Exam proctoring `features/course/exam/ExamProctoringTab`        | student, session, IP, new: IP pin (text)                                            | **leave attempts ↓** (only when page lock is enabled) |
| Admin users `features/admin/users/UsersTable`                   | username, email, name, role, status (role/status move to `TableSelectColumnFilter`) | **created ↓** (URL `created=asc`, unchanged)          |
| Submissions `routes/(app)/submissions/+page`                    | unchanged                                                                           | **time ↓**, score (server)                            |
| Live submissions `features/coursework/LiveSubmissionsFeed`      | unchanged                                                                           | **time ↓**, score (server)                            |
| Admin audit `routes/(app)/admin/audit/+page`                    | none (actor/action filters need backend; not this change)                           | **time ↓** (server, URL `order=asc`)                  |

Paths are relative to `apps/web/src/lib/components/` or `apps/web/src/` as written.

## Conventions for every task

- Work in `/Users/takala/code/NOJV/.worktrees/table-sort-filter` on branch `feat/table-sort-filter`.
- After editing `apps/web/messages/*.json`: `pnpm --filter @nojv/web paraglide:compile`. Edit the JSON with targeted line edits (the files contain duplicate keys; never round-trip through a JSON parser).
- Component tests mock `@lucide/svelte` with explicit export lists. Any component that now renders `X`, `ArrowUp`, `ArrowDown`, `ArrowUpDown` or `Trash2` needs those names added to every mock that renders it, or Vitest throws `No "<Icon>" export is defined on the "@lucide/svelte" mock`.
- No code comments (repo rule). No lint suppressions.
- Run a single component test: `pnpm exec vitest run --project component tests/component/web/<file>.test.ts`. Single unit test: `pnpm exec vitest run --project unit tests/unit/<path>.test.ts`.

---

### Task 1: `table-sort` helper

**Files:**

- Create: `apps/web/src/lib/utils/table-sort.ts`
- Test: `tests/unit/web/table-sort.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { ariaSort, sortDirection, sortRows, toggleSort } from "$lib/utils/table-sort";

describe("table sort", () => {
  it("flips the active column and starts a new column descending", () => {
    expect(toggleSort({ key: "joined", direction: "desc" }, "joined")).toEqual({
      key: "joined",
      direction: "asc",
    });
    expect(toggleSort({ key: "joined", direction: "asc" }, "joined")).toEqual({
      key: "joined",
      direction: "desc",
    });
    expect(toggleSort({ key: "joined", direction: "asc" }, "score")).toEqual({
      key: "score",
      direction: "desc",
    });
  });

  it("reports the direction only for the active column", () => {
    const sort = { key: "joined", direction: "asc" } as const;
    expect(sortDirection(sort, "joined")).toBe("asc");
    expect(sortDirection(sort, "score")).toBeNull();
    expect(ariaSort("asc")).toBe("ascending");
    expect(ariaSort("desc")).toBe("descending");
    expect(ariaSort(null)).toBe("none");
  });

  it("sorts a copy stably in both directions", () => {
    const rows = [
      { id: "a", n: 2 },
      { id: "b", n: 1 },
      { id: "c", n: 2 },
    ];
    expect(sortRows(rows, "asc", (row) => row.n).map((row) => row.id)).toEqual(["b", "a", "c"]);
    expect(sortRows(rows, "desc", (row) => row.n).map((row) => row.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
});
```

Check `tests/unit/web/*.test.ts` for how `$lib` resolves in the unit project; if it doesn't, import via `../../../apps/web/src/lib/utils/table-sort`.

**Step 2:** `pnpm exec vitest run --project unit tests/unit/web/table-sort.test.ts` → FAIL (module not found).

**Step 3: Implement**

```ts
export type SortDirection = "asc" | "desc";

export interface TableSort<K extends string = string> {
  key: K;
  direction: SortDirection;
}

export function toggleSort<K extends string>(sort: TableSort<K>, key: K): TableSort<K> {
  if (sort.key !== key) return { key, direction: "desc" };
  return { key, direction: sort.direction === "desc" ? "asc" : "desc" };
}

export function sortDirection<K extends string>(
  sort: TableSort<K>,
  key: K,
): SortDirection | null {
  return sort.key === key ? sort.direction : null;
}

export function ariaSort(direction: SortDirection | null): "ascending" | "descending" | "none" {
  if (direction === "asc") return "ascending";
  return direction === "desc" ? "descending" : "none";
}

export function sortRows<T>(
  rows: readonly T[],
  direction: SortDirection,
  value: (row: T) => number | string,
): T[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    return left < right ? -sign : left > right ? sign : 0;
  });
}
```

**Step 4:** rerun → PASS.

**Step 5:** `git add apps/web/src/lib/utils/table-sort.ts tests/unit/web/table-sort.test.ts && git commit -m "feat(web): add a shared table sort helper"`

---

### Task 2: `TableSortButton` primitive

**Files:**

- Create: `apps/web/src/lib/components/primitives/ui/TableSortButton.svelte`
- Test: `tests/component/web/table-sort-button.test.ts`

**Step 1: Failing test** — mount with `direction: null`, `"asc"`, `"desc"`; assert the button's accessible text is the label, clicking calls `onclick` once, and the rendered icon differs per state. Mock `@lucide/svelte` so `ArrowUp`, `ArrowDown`, `ArrowUpDown` each render a distinct marker (follow the pattern in `tests/component/web/course-member-roles.test.ts`; use a tiny fixture component or `data-icon` spans) and assert which one is present.

**Step 2:** run → FAIL.

**Step 3: Implement**

```svelte
<script lang="ts">
  import { ArrowDown, ArrowUp, ArrowUpDown } from "@lucide/svelte";
  import { cn } from "$lib/utils/css.js";
  import type { SortDirection } from "$lib/utils/table-sort";

  interface Props {
    label: string;
    direction: SortDirection | null;
    onclick: () => void;
    class?: string;
  }

  let { label, direction, onclick, class: className }: Props = $props();
</script>

<button
  type="button"
  class={cn(
    "-ml-1 inline-flex h-8 items-center gap-1.5 rounded-sm px-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    direction ? "text-primary hover:bg-primary/10" : "hover:bg-muted hover:text-foreground",
    className,
  )}
  {onclick}
>
  <span>{label}</span>
  {#if direction === "asc"}
    <ArrowUp aria-hidden="true" class="size-3.5 shrink-0" />
  {:else if direction === "desc"}
    <ArrowDown aria-hidden="true" class="size-3.5 shrink-0" />
  {:else}
    <ArrowUpDown aria-hidden="true" class="size-3.5 shrink-0 opacity-50" />
  {/if}
</button>
```

**Step 4:** run → PASS. **Step 5:** commit `feat(web): add TableSortButton`.

---

### Task 3: Clear button on both filter primitives

**Files:**

- Modify: `apps/web/src/lib/components/primitives/ui/TableTextColumnFilter.svelte`
- Modify: `apps/web/src/lib/components/primitives/ui/TableSelectColumnFilter.svelte`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/zh-TW.json` (next to `common_applyFilter`)
- Test: `tests/component/web/table-column-filters.test.ts`

Messages:

- en: `"common_clearFilter": "Clear filter: {label}"`, zh-TW: `"common_clearFilter": "清除篩選：{label}"`
- en: `"common_updatedAt": "Updated"`, zh-TW: `"common_updatedAt": "更新時間"` (used in Task 7)

**Step 1: Failing test**

- Text filter mounted with `value: "alice"` and an `onApply` spy: a button named `Clear filter: <filterLabel>` exists; clicking it empties the bound value (assert through a wrapper or the `onApply` spy plus the chip disappearing) and calls `onApply` once. With `value: ""` no clear button.
- Select filter mounted with `value: "ta"` and an `onChange` spy: clear button exists; clicking calls `onChange("")` and the trigger shows `label` again.

**Step 2:** run → FAIL.

**Step 3: Implement**

`TableTextColumnFilter.svelte`: import `X` from `@lucide/svelte` and `m`; add

```ts
function clearFilter() {
  value = "";
  draft = "";
  onApply?.();
}
```

and replace the trailing `{#if value}` chip with:

```svelte
{#if value}
  <span
    class="inline-flex max-w-32 items-center gap-0.5 rounded-sm bg-primary/10 py-0.5 pl-1.5 pr-0.5 text-caption font-medium normal-case tracking-normal text-primary"
  >
    <span class="truncate" title={value}>{value}</span>
    <button
      type="button"
      class="shrink-0 rounded-sm p-0.5 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={m.common_clearFilter({ label: filterLabel })}
      onclick={clearFilter}
    >
      <X aria-hidden="true" class="size-3" />
    </button>
  </span>
{/if}
```

`TableSelectColumnFilter.svelte`: wrap the existing `<Select.Root>` in `<div class="flex min-w-0 items-center gap-1">`; after it add

```svelte
{#if value}
  <button
    type="button"
    class="shrink-0 rounded-sm p-0.5 text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    aria-label={m.common_clearFilter({ label: filterLabel })}
    onclick={() => handleChange("")}
  >
    <X aria-hidden="true" class="size-3" />
  </button>
{/if}
```

**Step 4:** `pnpm --filter @nojv/web paraglide:compile`, run the test → PASS.

**Step 5:** Run the whole component project (`pnpm test:component`). Add `X` to every `@lucide/svelte` mock that now fails. Commit `feat(web): clear column filters with one click`.

---

### Task 4: Course members — joined sort, fix icon mocks

**Files:**

- Modify: `apps/web/src/routes/(app)/courses/[courseId]/members/+page.svelte` (already has the red trash button with tooltip and the email filter from earlier in this branch)
- Modify: `tests/component/web/course-member-removal.test.ts`, `tests/component/web/course-member-roles.test.ts`
- Test: add a case to `tests/component/web/course-member-roles.test.ts` (or a new `course-members-table.test.ts`)

**Steps:**

1. Failing test: three members joined on different dates in role order; default render lists newest first and the joined `<th>` has `aria-sort="descending"`; clicking the joined sort button reverses the order and sets `ascending`.
2. Run → FAIL (also currently fails on the missing `Trash2` mock — add `Trash2`, `X`, `ArrowUp`, `ArrowDown`, `ArrowUpDown` to both mocks first, then confirm only the new assertions fail).
3. Implement: `let sort = $state<TableSort<"joined">>({ key: "joined", direction: "desc" });` and make `filtered` end with `sortRows(rows, sort.direction, (member) => member.joinedAt)` (ISO strings compare correctly). Header:
   ```svelte
   <th scope="col" class="…" aria-sort={ariaSort(sortDirection(sort, "joined"))}>
     <TableSortButton
       label={m.members_joinedLabel()}
       direction={sortDirection(sort, "joined")}
       onclick={() => (sort = toggleSort(sort, "joined"))}
     />
   </th>
   ```
4. Run both member test files → PASS.
5. Commit `feat(web): sort course members by join date`.

---

### Task 5: Admin reports — reported-date sort

**Files:** Modify `apps/web/src/routes/(app)/admin/reports/+page.svelte`.

Steps: `sort` state `{ key: "reported", direction: "desc" }`; `filteredReports` → `sortRows(filtered, sort.direction, (r) => r.createdAt)` (check the type of `createdAt` in `data.reports`; use `new Date(x).getTime()` if it is a `Date`). Wrap the `adminReports_colReported` header in `TableSortButton` with `aria-sort`. There is no component test for this page; cover it in the browser check (Task 15). Commit `feat(web): sort admin reports by report date`.

---

### Task 6: Admin registry — size becomes sort

**Files:** Modify `apps/web/src/routes/(app)/admin/registry/+page.svelte`; messages (remove `admin_registry_filterSize` from both locales if nothing else uses it — `grep -rn admin_registry_filterSize apps tests`).

Steps: delete `sizeFilter` and its matcher in `filteredTags`; return `sortRows(matches, sort.direction, (t) => t.size ?? -1)` with `sort` state `{ key: "size", direction: "desc" }` shared by every repository table (like the filters). Replace the size `TableTextColumnFilter` with `TableSortButton` + `aria-sort`. Commit `feat(web): sort registry tags by size`.

---

### Task 7: Score override and feedback lists — student/problem filters, score/updated sort

**Files:**

- Modify: `apps/web/src/lib/components/features/score-override/ScoreOverrideList.svelte`, `FeedbackList.svelte`
- Test: `tests/component/web/score-override-list.test.ts` (new)

Steps:

1. Failing test for `ScoreOverrideList`: three rows (two students, two problems, distinct scores and `updatedAt`); default order newest `updatedAt` first; clicking the score sort orders by score descending; the student text filter (open popover, type, Enter) leaves only matching rows; the problem select filter narrows to one problem.
2. Implement in both lists:
   - `let studentFilter = $state(""); let problemFilter = $state("");`
   - `const visibleRows = $derived(sortRows(rows.filter(matches), sort.direction, value))` where `matches` tests `studentLabel(row.<membershipId>).toLocaleLowerCase().includes(query)` and `!problemFilter || row.problemId === problemFilter`; `value` returns `row.overrideScore` for `"score"` else `row.updatedAt`.
   - Student header → `TableTextColumnFilter` (`filterLabel` = the existing field label, `inputId` `override-student-filter` / `feedback-student-filter`).
   - Problem header → `TableSelectColumnFilter` with options from the `problems` prop (`{ value: p.id, label: p.title }`).
   - Score header (override only) and the empty updated header → `TableSortButton` (`m.common_updatedAt()` as the updated label).
   - Render `visibleRows`; when it is empty but `rows` is not, show one full-width row with `m.submissions_noMatches()` so the filters stay reachable (UI-12).
3. The outer wrapper is `overflow-hidden`; popovers are portaled, so leave it.
4. Run → PASS. Commit `feat(web): filter and sort score override and feedback lists`.

---

### Task 8: Course gradebook — student filter, arrow sort, total default

**Files:** Modify `apps/web/src/routes/(app)/courses/[courseId]/grades/+page.svelte`; Test: extend `tests/component/web/course-gradebook-page.test.ts`.

Steps:

1. Failing test: manager view with two students; default order is total descending and the total `<th>` has `aria-sort="descending"`; clicking a problem header sorts by that score descending; the student filter hides the non-matching row.
2. Implement:
   - Replace `sortKey`/`sortDescending`/`toggleSort` with `let sort = $state<TableSort>({ key: "total", direction: "desc" });` and compute `sortedRows` with `sortRows(filteredRows, sort.direction, sortValue)` where `sortValue` keeps the existing activity/problem logic (drop the `"name"` branch; missing problem scores stay `-1`).
   - `let studentFilter = $state("")`; filter by `name` or `username`. Show `TableTextColumnFilter` in the student header only when `isManager`; otherwise keep the plain label.
   - Activity, problem and total headers use `TableSortButton` (problem: `label` = ordinal, the max-points span stays below the button; activity: `label` = `column.contextTitle`) and `aria-sort` on their `<th>`.
   - CSV export keeps exporting all rows (unchanged).
3. Run → PASS. Commit `feat(web): gradebook student filter and arrow sort`.

---

### Task 9: Results matrix — shared controls

**Files:** Modify `MatrixTable.svelte` and `MatrixView.svelte` under `apps/web/src/lib/components/features/course/submissions/`; Test: update `tests/component/web/matrix-view-header.test.ts`.

Steps:

1. Update the test first: search now happens through the `TableTextColumnFilter` popover (button named by `labels.searchPlaceholder()`, type, Enter); problem sort assertions keep checking row order and `aria-sort`.
2. `MatrixView`: replace `sortKey`/`sortDirection`/`toggleSort` with a `TableSort` state (default `{ key: "total", direction: "desc" }`) and `toggleSort` from the helper; keep the existing comparator (missing cell = `-Infinity`, ties by handle). Pass `sort` and `onsort` to the table.
3. `MatrixTable`: the student header renders `TableTextColumnFilter` (`label` = `labels.student()`, `filterLabel` = `labels.searchPlaceholder()`, `bind:value={search}`). Problem headers render `TableSortButton label={problem.letter}` with the max-points span below; total renders `TableSortButton label={labels.total()}`. Remove the `" ↓"`/`" ↑"` suffixes.
4. Check the other `MatrixView` consumers' tests (`assessment-grades-tab.test.ts`) still pass. Commit `feat(web): matrix uses shared sort and filter controls`.

---

### Task 10: Exam proctoring — IP pin filter, leave-attempt sort

**Files:** Modify `apps/web/src/lib/components/features/course/exam/ExamProctoringTab.svelte`; Test: extend `tests/component/web/exam-proctoring-tab.test.ts`.

Steps:

1. Failing tests: with `pageLockEnabled`, rows default to most leave attempts first and the column has `aria-sort="descending"`; clicking flips to ascending. With `ipBindingEnabled`, the IP pin filter keeps only rows whose pin contains the query. Without page lock there is no sort button.
2. Implement: `let ipPinFilter = $state("")` added to `filtered`; `let sort = $state<TableSort<"leaves">>({ key: "leaves", direction: "desc" })`; `const visible = $derived(pageLockEnabled ? sortRows(filtered, sort.direction, (row) => row.leaveAttempts) : filtered)`; leave-attempts header → `TableSortButton` + `aria-sort`; IP pin header → `TableTextColumnFilter` (`filterLabel` = `m.examProctoring_colIpPin()`, `inputId` `exam-proctoring-ip-pin-filter`).
3. Run → PASS. Commit `feat(web): proctoring roster IP pin filter and leave sort`.

---

### Task 11: Admin users — shared role/status filters, arrow created sort

**Files:**

- Modify: `apps/web/src/lib/components/features/admin/users/UsersTable.svelte`
- Modify: messages — remove `admin_usersNewestFirst`, `admin_usersOldestFirst`, `admin_usersSortCreated` if no longer referenced
- Modify: `tests/e2e/admin.test.ts` (role/status/created steps)

Steps:

1. Replace the two hand-rolled role/status popovers with `TableSelectColumnFilter` (`label` = `m.admin_usersRole()` / `m.admin_usersStatus()`, `filterLabel` = `m.admin_usersFilterRole()` / `m.admin_usersFilterStatus()`, `allLabel` = `m.admin_usersFilterAll()`, options without the `""` entry, `bind:value`, `onChange={() => onApply()}`). Delete `roleFilterOpen`, `statusFilterOpen`, `applyRoleFilter`, `applyStatusFilter`, `roleFilterOptions`, `statusFilterOptions`.
2. Replace the created popover with `TableSortButton label={m.admin_usersCreated()} direction={createdAtOrder} onclick={() => { createdAtOrder = createdAtOrder === "desc" ? "asc" : "desc"; onApply(); }}`; keep `aria-sort` on the `<th>`. Delete `createdAtOrderOpen`, `createdAtOrderOptions`, `applyCreatedAtOrder`.
3. Remove now-unused imports (`ArrowUp`, `ArrowDown`, `ListFilter`, `Popover`, `CircleCheck` only if no other use remains — `CircleCheck` is used elsewhere in the file).
4. Update `tests/e2e/admin.test.ts`: role/status steps open the select trigger (`getByRole("combobox", { name: "Filter role" })`) and pick `getByRole("option", { name: "Teacher" })`; created step clicks `getByRole("button", { name: "Created" })` and asserts `created=asc` and `aria-sort="ascending"` on the created column header. The e2e suite is not in CI; run just this file if the e2e stack is available, otherwise note it.
5. `pnpm --filter @nojv/web exec svelte-check --threshold error` → 0 errors. Commit `feat(web): admin users table uses shared filter and sort controls`.

---

### Task 12: Submission history sort on the server

**Files:**

- Modify: `packages/db/src/repositories/submission/shared.ts` (export the sort type), `packages/db/src/repositories/submission/history.ts` (`listHistoryPage`)
- Modify: `packages/application/src/submission/history.ts` (`HistoryOptions`, `historyPage`)
- Modify: `apps/web/src/routes/api/submissions/+server.ts` (`historyQuerySchema`)
- Test: `tests/unit/db/submission-history.test.ts`, `tests/unit/web/submission-queries.test.ts`

**Step 1: Failing tests**

- Repo: `listHistoryPage({ …, sort: { key: "score", direction: "asc" } })` calls `findMany` with `orderBy: [{ score: "asc" }, { createdAt: "desc" }, { id: "desc" }]`; `sort: { key: "createdAt", direction: "asc" }` → `[{ createdAt: "asc" }, { id: "asc" }]`; no sort keeps `[{ createdAt: "desc" }, { id: "desc" }]`. The snapshot boundary and counts are unchanged.
- Application: `listUserSubmissions({ …, sort })` forwards `sort` to the repo.

**Step 2:** run → FAIL.

**Step 3: Implement**

`shared.ts`:

```ts
export interface SubmissionHistorySort {
  key: "createdAt" | "score";
  direction: "asc" | "desc";
}
```

`history.ts` (repo): add `sort?: SubmissionHistorySort` to the input and

```ts
const orderBy: Prisma.SubmissionOrderByWithRelationInput[] =
  input.sort?.key === "score"
    ? [{ score: input.sort.direction }, { createdAt: "desc" }, { id: "desc" }]
    : [{ createdAt: input.sort?.direction ?? "desc" }, { id: input.sort?.direction ?? "desc" }];
```

used only by the row `findMany` (the snapshot `findFirst` keeps `createdAt desc`, which defines the boundary).

Application: add `sort?: SubmissionHistorySort` to `HistoryOptions`, pass `...(opts.sort ? { sort: opts.sort } : {})` into `listHistoryPage`. Export the type through `@nojv/db` the same way `SubmissionHistoryFilters` is reachable.

API: add to `historyQuerySchema`

```ts
sort: z.enum(["createdAt", "score"]).optional(),
order: z.enum(["asc", "desc"]).optional(),
```

and to `options`: `...(query.sort || query.order ? { sort: { key: query.sort ?? "createdAt", direction: query.order ?? "desc" } } : {})`.

**Step 4:** run both unit files → PASS. `pnpm build --filter="./packages/*"` so the web app sees the new types.

**Step 5:** commit `feat(submissions): sort history by time or score on the server`.

---

### Task 13: Submissions page and live feed — time/score sort buttons

**Files:**

- Modify: `apps/web/src/routes/(app)/submissions/+page.svelte`, `apps/web/src/lib/components/features/coursework/LiveSubmissionsFeed.svelte`
- Test: `tests/component/web/submissions-page-table.test.ts`, `tests/component/web/live-submissions-feed.test.ts`

Steps:

1. Failing tests: clicking the score sort issues a `/api/submissions` request with `sort=score&order=desc`; clicking time (active by default) issues `order=asc` without `sort=score`; `aria-sort` follows. Follow the existing query-param assertions in these files.
2. Implement in both: `let sort = $state<TableSort<"createdAt" | "score">>({ key: "createdAt", direction: "desc" });` In the `baseQuery` builder: `if (sort.key !== "createdAt") query.set("sort", sort.key); if (sort.direction !== "desc") query.set("order", sort.direction);` Time and score headers → `TableSortButton` + `aria-sort`. Changing `sort` re-runs the history effect exactly like a filter change (page resets to 1).
3. Run → PASS. Commit `feat(web): sort submission tables by time or score`.

---

### Task 14: Admin audit — time order

**Files:**

- Modify: `packages/db/src/repositories/admin-audit.ts` (`listPaged`), `packages/application/src/audit/admin-audit.ts` (`listAdminAuditPaged`)
- Modify: `apps/web/src/routes/(app)/admin/audit/+page.server.ts`, `+page.svelte`
- Test: a unit test next to existing audit tests (`grep -rln adminAuditLogRepo tests`; else `tests/unit/db/admin-audit-paging.test.ts` mocking `prisma.adminAuditLog.findMany` like `tests/unit/db/submission-history.test.ts`)

Steps:

1. Failing test: `listPaged({ limit: 50, order: "asc" })` passes `orderBy: [{ createdAt: "asc" }, { id: "asc" }]`; default stays `desc`.
2. Implement: `order?: "asc" | "desc"` through repo → domain; loader reads `url.searchParams.get("order") === "asc" ? "asc" : "desc"` and returns it; page builds `nextHref` keeping `order=asc` when set; the time header becomes `TableSortButton` whose click `goto`s `?order=asc` or `?` (drops the cursor).
3. Run → PASS. Commit `feat(admin): order the audit log by time in either direction`.

---

### Task 15: Docs, full verification, browser check

**Files:**

- Modify: `docs/architecture/DESIGN.md` — add `TableSortButton` to the Custom primitives row; after "Tables are feature-specific…" add the filter-vs-sort rule, the always-one-sort rule, the ✕ clear, and `aria-sort`.
- Modify: `docs/decisions/product-ui.md` UI-12 — extend it with the categorical-filter / ordered-sort split and the single-active-sort rule (keep the decided date; add the PR as an additional source once the PR exists).
- Grep living docs for the admin users "Newest first/Oldest first" menu or the registry size filter and update them: `grep -rn -i "oldest first\|newest first\|filter.*size" docs/architecture docs/features docs/product docs/runbooks`.
- Delete: `docs/superpowers/plans/2026-10-05-table-sort-filter.md` in the final commit.

Verification (all must pass before claiming done; component tests and `typecheck:tests` are not part of `test:unit`/`lint`):

```bash
pnpm format
pnpm lint
pnpm --filter @nojv/web exec svelte-check --threshold error
pnpm typecheck:tests
pnpm test:unit
pnpm test:component
```

Browser check with the `web` dev server against this worktree (`cp ../../.env .env` already done; packages built): as `teacher@nojv.local` visit the course members, gradebook and an assignment's results/submissions tabs; as the admin dev user visit `/admin/users`, `/admin/audit`, `/admin/reports`, `/admin/registry` if reachable; confirm arrows, `aria-sort`, ✕ clears, and server sorts change the request query. Screenshot the members and submissions tables.

Commit `docs: table sort and filter conventions` (including the plan deletion), then open the PR.
