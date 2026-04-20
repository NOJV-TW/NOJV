# Dashboard Ability-Overview Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 8-section `/dashboard` page with a focused 4-section student-ability overview (hero stat bar, 30-day heatmap, tag/difficulty/verdict profile, recent submissions) and fix the Fraunces-on-CJK typography issue.

**Architecture:** Extend `getUserAnalytics` in `packages/domain` with a pure `byTag` aggregation. Add one new DOM-based heatmap component in `apps/web`. Rewrite the dashboard route's server loader + page template. Add/remove i18n keys. Nothing else in the codebase is touched.

**Tech Stack:** SvelteKit 5 (runes), TypeScript, Tailwind CSS 4, ECharts 6 (lazy), Paraglide JS, Vitest, Prisma 7.

**Spec:** [`docs/superpowers/specs/2026-04-11-dashboard-ability-redesign.md`](../specs/2026-04-11-dashboard-ability-redesign.md)

---

## File Structure

**New files:**

- `packages/domain/src/user/analytics-helpers.ts` — pure aggregation helpers (tag counting). Pure fns so they're trivial to unit-test without mocking Prisma.
- `apps/web/src/lib/components/charts/ActivityHeatmap.svelte` — 30-cell DOM heatmap with tooltips.
- `tests/unit/domain/user-analytics-helpers.test.ts` — covers the tag aggregation helper.

**Modified files:**

- `packages/domain/src/user/queries.ts` — wire the helper into `getUserAnalytics`, extend `UserAnalytics` interface with `byTag`.
- `apps/web/src/routes/(app)/dashboard/+page.server.ts` — drop courses/assessments/announcements loads.
- `apps/web/src/routes/(app)/dashboard/+page.svelte` — full rewrite per spec.
- `apps/web/messages/zh-TW.json` — add 5 new keys, remove unused ones.
- `apps/web/messages/en.json` — mirror zh-TW changes.

**Untouched (explicitly):** `Section.svelte`, `StatCard.svelte`, `Card.svelte`, `EChart.svelte`, anything in `packages/db`, Prisma schema, Header.svelte.

---

## Task 1: Pure tag-aggregation helper (TDD)

**Files:**

- Create: `packages/domain/src/user/analytics-helpers.ts`
- Create: `tests/unit/domain/user-analytics-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/domain/user-analytics-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aggregateByTag } from "@nojv/domain";

describe("aggregateByTag", () => {
  it("returns an empty array when there are no AC rows", () => {
    expect(aggregateByTag([])).toEqual([]);
  });

  it("counts each tag once per AC problem", () => {
    const rows = [
      { problem: { tags: ["dp", "graph"] } },
      { problem: { tags: ["dp", "math"] } },
      { problem: { tags: ["graph"] } },
    ];
    const result = aggregateByTag(rows);
    expect(result).toEqual([
      { tag: "dp", acCount: 2 },
      { tag: "graph", acCount: 2 },
      { tag: "math", acCount: 1 },
    ]);
  });

  it("sorts descending by acCount and caps at 8 tags", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      problem: { tags: [`tag${i}`] },
    }));
    // Add extra counts for tag0 so we can verify ordering.
    rows.push({ problem: { tags: ["tag0"] } });
    rows.push({ problem: { tags: ["tag0"] } });

    const result = aggregateByTag(rows);
    expect(result).toHaveLength(8);
    expect(result[0]).toEqual({ tag: "tag0", acCount: 3 });
    // Remaining 7 slots each have acCount=1 and are a subset of the input.
    for (let i = 1; i < result.length; i++) {
      expect(result[i].acCount).toBe(1);
    }
  });

  it("ignores problems with an empty tag list", () => {
    const rows = [{ problem: { tags: [] } }, { problem: { tags: ["dp"] } }];
    expect(aggregateByTag(rows)).toEqual([{ tag: "dp", acCount: 1 }]);
  });
});
```

The import is intentionally through the top-level `@nojv/domain` barrel (not a subpath) so no `package.json` exports surgery is needed. We'll wire the re-export in Step 4.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/unit/domain/user-analytics-helpers.test.ts
```

Expected: FAIL with an import error (`aggregateByTag` is not exported from `@nojv/domain`).

- [ ] **Step 3: Implement `aggregateByTag`**

Create `packages/domain/src/user/analytics-helpers.ts`:

```ts
export interface TagAcCount {
  tag: string;
  acCount: number;
}

interface AcRow {
  problem: { tags: string[] };
}

const MAX_TAGS = 8;

/**
 * Count AC problems per topic tag. One AC problem contributes +1 to every
 * tag it carries. Result is sorted descending by count and capped at 8 entries
 * so the dashboard tag bar chart stays legible.
 */
export function aggregateByTag(rows: readonly AcRow[]): TagAcCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.problem.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, acCount]) => ({ tag, acCount }))
    .sort((a, b) => b.acCount - a.acCount)
    .slice(0, MAX_TAGS);
}
```

- [ ] **Step 4: Re-export from the package barrels**

Edit `packages/domain/src/user/index.ts` — append:

```ts
export { aggregateByTag } from "./analytics-helpers";
export type { TagAcCount } from "./analytics-helpers";
```

Verify `packages/domain/src/index.ts` re-exports everything from `./user` (it almost certainly does — look for a line like `export * from "./user"` or a namespace re-export). If it uses a namespace pattern, make sure `aggregateByTag` and `TagAcCount` are reachable as named exports from `@nojv/domain`. If they are not reachable, add:

```ts
export { aggregateByTag } from "./user/analytics-helpers";
export type { TagAcCount } from "./user/analytics-helpers";
```

to `packages/domain/src/index.ts`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run tests/unit/domain/user-analytics-helpers.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/user/analytics-helpers.ts \
        packages/domain/src/user/index.ts \
        packages/domain/src/index.ts \
        tests/unit/domain/user-analytics-helpers.test.ts
git commit -m "feat(domain): add aggregateByTag helper for user analytics"
```

---

## Task 2: Wire `byTag` into `getUserAnalytics`

**Files:**

- Modify: `packages/domain/src/user/queries.ts` (interface `UserAnalytics` + function `getUserAnalytics`)

- [ ] **Step 1: Update the `UserAnalytics` interface**

Open `packages/domain/src/user/queries.ts`. Find the interface (currently at ~line 96):

```ts
export interface UserAnalytics {
  byDifficulty: { difficulty: "easy" | "medium" | "hard"; acCount: number }[];
  byLanguage: { language: string; count: number }[];
  byVerdict: { status: string; count: number }[];
}
```

Replace it with:

```ts
export interface UserAnalytics {
  byDifficulty: { difficulty: "easy" | "medium" | "hard"; acCount: number }[];
  byLanguage: { language: string; count: number }[];
  byVerdict: { status: string; count: number }[];
  byTag: { tag: string; acCount: number }[];
}
```

- [ ] **Step 2: Import and call `aggregateByTag`**

At the top of `queries.ts`, add the import next to the existing `@nojv/db` import:

```ts
import { aggregateByTag } from "./analytics-helpers";
```

Find `getUserAnalytics` (around line 102). Locate the `return { ... }` block at the end. Replace the return with:

```ts
return {
  byDifficulty: (["easy", "medium", "hard"] as const).map((d) => ({
    difficulty: d,
    acCount: difficultyCounts[d],
  })),
  byLanguage: languageGroups.map((g) => ({ language: g.language, count: g._count._all })),
  byVerdict: verdictGroups.map((g) => ({ status: g.status, count: g._count._all })),
  byTag: aggregateByTag(acProblems),
};
```

`acProblems` is already in scope from the existing `Promise.all` — no new query needed.

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @nojv/domain build
```

Expected: no TypeScript errors. If `TagAcCount` is surfaced as a return type mismatch, align the `byTag` entry shape — both sides use `{ tag: string; acCount: number }` so this should Just Work.

- [ ] **Step 4: Re-run the helper test to confirm nothing regressed**

```bash
pnpm vitest run tests/unit/domain/user-analytics-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/user/queries.ts
git commit -m "feat(domain): expose byTag from getUserAnalytics"
```

---

## Task 3: `ActivityHeatmap.svelte` component

**Files:**

- Create: `apps/web/src/lib/components/charts/ActivityHeatmap.svelte`

Rationale: 30 DOM cells render faster and with less bundle cost than spinning up an ECharts calendar. We have no Svelte component test harness in this repo, so visual verification happens in Task 7 via `pnpm --filter web dev`.

- [ ] **Step 1: Create the component**

Create `apps/web/src/lib/components/charts/ActivityHeatmap.svelte` with exactly this content:

```svelte
<script lang="ts">
  import * as Tooltip from "$lib/components/ui/tooltip";

  interface HeatmapDay {
    date: string;
    acCount: number;
    submissionCount: number;
  }

  interface Props {
    data: HeatmapDay[];
    class?: string;
  }

  let { data, class: className = "" }: Props = $props();

  function intensityClass(acCount: number): string {
    if (acCount <= 0) return "bg-[color:var(--muted)]/40";
    if (acCount === 1)
      return "bg-[color:color-mix(in_oklch,var(--chart-5)_30%,transparent)]";
    if (acCount <= 3)
      return "bg-[color:color-mix(in_oklch,var(--chart-5)_60%,transparent)]";
    return "bg-[color:var(--chart-5)]";
  }

  function formatLabel(day: HeatmapDay): string {
    return `${day.date} — ${day.acCount} AC / ${day.submissionCount} submissions`;
  }
</script>

<div
  class="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1 {className}"
  role="group"
  aria-label="30-day activity heatmap"
>
  {#each data as day (day.date)}
    <Tooltip.Root>
      <Tooltip.Trigger>
        <div
          class="h-4 w-full rounded-[3px] transition-colors duration-fast sm:h-5 {intensityClass(
            day.acCount
          )}"
          role="img"
          aria-label={formatLabel(day)}
        ></div>
      </Tooltip.Trigger>
      <Tooltip.Content>
        {formatLabel(day)}
      </Tooltip.Content>
    </Tooltip.Root>
  {/each}
</div>
```

- [ ] **Step 2: Verify the Tooltip import path**

The spec relies on an existing styled Bits UI Tooltip wrapper under `$lib/components/ui/tooltip`. Verify:

```bash
ls apps/web/src/lib/components/ui/tooltip
```

Expected: a directory containing `index.ts` (or `index.js`) that re-exports `Root`, `Trigger`, `Content`, `Portal`. If the path differs (for example `$lib/components/ui/Tooltip.svelte`), change the `import * as Tooltip from "$lib/components/ui/tooltip"` line accordingly and use the API the existing wrapper exposes. **Do not** add a new Tooltip wrapper.

If no tooltip wrapper exists at all, fall back to a native `title={formatLabel(day)}` attribute on the cell `<div>` and delete the `Tooltip.*` JSX. Flag this in the commit message.

- [ ] **Step 3: Build the web app to catch template/type errors**

```bash
pnpm --filter web check
```

Expected: no errors. If svelte-check complains about the Tooltip import, apply the fallback from Step 2.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/charts/ActivityHeatmap.svelte
git commit -m "feat(web): add ActivityHeatmap component for dashboard"
```

---

## Task 4: i18n — add new keys

**Files:**

- Modify: `apps/web/messages/zh-TW.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Add keys to zh-TW.json**

Open `apps/web/messages/zh-TW.json`. Locate the alphabetically-ordered `dashboard_*` block (starts around line 390). Add these keys in alphabetical order:

```json
  "dashboard_last30Days": "近 30 天",
  "dashboard_noTagData": "尚無 AC 紀錄",
  "dashboard_practiceDays": "練習天數",
  "dashboard_tagProficiency": "主題熟練度",
  "dashboard_verdictDistribution": "通過率分布",
```

Preserve alphabetical ordering relative to neighbors. JSON must remain valid (commas, quoting).

- [ ] **Step 2: Mirror in en.json**

Open `apps/web/messages/en.json`. Add the parallel keys:

```json
  "dashboard_last30Days": "Last 30 days",
  "dashboard_noTagData": "No AC records yet",
  "dashboard_practiceDays": "Practice Days",
  "dashboard_tagProficiency": "Topic Proficiency",
  "dashboard_verdictDistribution": "Pass Rate",
```

- [ ] **Step 3: Regenerate Paraglide message module**

Paraglide generates the `$lib/paraglide/messages.js` module at dev/build time. Trigger it:

```bash
pnpm --filter web check
```

Expected: no errors; generated message module includes the new keys (`m.dashboard_tagProficiency`, etc.).

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/zh-TW.json apps/web/messages/en.json
git commit -m "i18n(web): add dashboard redesign keys"
```

---

## Task 5: Trim the dashboard server loader

**Files:**

- Modify: `apps/web/src/routes/(app)/dashboard/+page.server.ts`

- [ ] **Step 1: Replace the file**

Overwrite `apps/web/src/routes/(app)/dashboard/+page.server.ts` with:

```ts
import { requireAuth } from "$lib/server/auth";
import { userDomain } from "@nojv/domain";
import { userDailyActivityRepo } from "@nojv/db";

import type { PageServerLoad } from "./$types";

const { getUserDashboard, getUserAnalytics } = userDomain;

const ACTIVITY_DAYS = 30;

/** Midnight UTC for the day `n` days before now (inclusive lower bound). */
function utcDayOffset(daysBack: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack),
  );
}

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);

  const from = utcDayOffset(ACTIVITY_DAYS - 1);
  const to = utcDayOffset(0);

  const [{ stats, recentSubmissions }, dailyActivity, analytics] = await Promise.all([
    getUserDashboard(actor.userId),
    userDailyActivityRepo.findRange(actor.userId, from, to),
    getUserAnalytics(actor.userId),
  ]);

  return {
    stats,
    recentSubmissions,
    username: actor.username,
    analytics,
    dailyActivity: dailyActivity
      .slice()
      .reverse()
      .map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        acCount: row.acCount,
        submissionCount: row.submissionCount,
      })),
  };
};
```

Changes from the old file:

- `courseDomain` import removed
- `DEFAULT_LOCALE` import removed
- `deriveAssessmentWindowState`, `windowStateColorClass` imports removed
- `courses`, `upcomingAssessments`, `announcements` loads removed
- `mappedAssessments` and `mappedAnnouncements` transforms removed
- `recommendations` dropped from the return payload (still computed inside `getUserDashboard`, just not forwarded)

- [ ] **Step 2: Run svelte-check to catch downstream type errors**

```bash
pnpm --filter web check
```

Expected: the server file compiles. `+page.svelte` will now fail because `data.courses`, `data.upcomingAssessments`, `data.announcements`, and `data.recommendations` no longer exist — **that is expected** and is fixed in Task 6.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/\(app\)/dashboard/+page.server.ts
git commit -m "refactor(web): trim dashboard loader to ability-overview fields"
```

---

## Task 6: Rewrite `dashboard/+page.svelte`

**Files:**

- Modify: `apps/web/src/routes/(app)/dashboard/+page.svelte`

- [ ] **Step 1: Replace the entire file**

Overwrite `apps/web/src/routes/(app)/dashboard/+page.svelte` with:

```svelte
<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { Code2, LineChart, PieChart } from "@lucide/svelte";
  import EChart from "$lib/components/charts/EChart.svelte";
  import ActivityHeatmap from "$lib/components/charts/ActivityHeatmap.svelte";
  import { Card } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import { formatVerdictLabel } from "$lib/types";
  import type { BadgeVariant } from "$lib/components/ui/badge";
  import type { EChartsOption } from "echarts";

  let { data } = $props();

  const stats = $derived(data.stats);
  const analytics = $derived(data.analytics);
  const dailyActivity = $derived(data.dailyActivity);

  const acRate = $derived(
    stats.totalAttempts > 0
      ? ((stats.totalAc / stats.totalAttempts) * 100).toFixed(1) + "%"
      : "0%"
  );

  const practiceDays = $derived(
    dailyActivity.filter((d) => d.submissionCount > 0).length
  );

  const hasHeatmapData = $derived(dailyActivity.some((d) => d.acCount > 0));
  const hasDifficultyData = $derived(
    analytics.byDifficulty.some((d) => d.acCount > 0)
  );
  const hasVerdictData = $derived(analytics.byVerdict.length > 0);
  const hasTagData = $derived(analytics.byTag.length > 0);

  // Difficulty palette — aligned with the tag pill colours in the problem list.
  const difficultyColor: Record<string, string> = {
    easy: "#10b981",
    medium: "#f59e0b",
    hard: "#ef4444"
  };

  const difficultyOption: EChartsOption = $derived({
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: "var(--color-panel)",
          borderWidth: 2
        },
        label: { show: false },
        data: analytics.byDifficulty.map((d) => ({
          name: d.difficulty,
          value: d.acCount,
          itemStyle: { color: difficultyColor[d.difficulty] }
        }))
      }
    ]
  });

  const verdictPalette: Record<string, string> = {
    accepted: "var(--chart-5)",
    wrong_answer: "rgba(239, 68, 68, 0.5)",
    time_limit_exceeded: "rgba(245, 158, 11, 0.5)",
    memory_limit_exceeded: "rgba(249, 115, 22, 0.5)",
    runtime_error: "rgba(168, 85, 247, 0.5)",
    compile_error: "rgba(239, 68, 68, 0.35)",
    queued: "rgba(148, 163, 184, 0.5)",
    compiling: "rgba(148, 163, 184, 0.5)",
    running: "rgba(148, 163, 184, 0.5)"
  };

  const verdictOption: EChartsOption = $derived({
    title: {
      text: acRate,
      subtext: m.dashboard_acRate(),
      left: "center",
      top: "34%",
      textStyle: { fontSize: 26, fontWeight: 600 },
      subtextStyle: { fontSize: 12 }
    },
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, textStyle: { fontSize: 11 }, type: "scroll" },
    series: [
      {
        type: "pie",
        radius: ["55%", "75%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: "var(--color-panel)",
          borderWidth: 2
        },
        label: { show: false },
        data: analytics.byVerdict.map((v) => ({
          name: formatVerdictLabel(v.status),
          value: v.count,
          itemStyle: {
            color: verdictPalette[v.status] ?? "rgba(100, 116, 139, 0.5)",
            borderWidth: v.status === "accepted" ? 3 : 2
          }
        }))
      }
    ]
  });

  const tagOption: EChartsOption = $derived({
    grid: { left: 96, right: 24, top: 8, bottom: 24 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", axisLabel: { fontSize: 11 }, minInterval: 1 },
    yAxis: {
      type: "category",
      inverse: true,
      data: analytics.byTag.map((g) => g.tag),
      axisLabel: { fontSize: 12 }
    },
    series: [
      {
        type: "bar",
        data: analytics.byTag.map((g) => g.acCount),
        itemStyle: { color: "var(--chart-3)", borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 18
      }
    ]
  });

  function verdictToBadgeVariant(status: string): BadgeVariant {
    switch (status) {
      case "accepted":
        return "verdict-ac";
      case "wrong_answer":
        return "verdict-wa";
      case "time_limit_exceeded":
        return "verdict-tle";
      case "memory_limit_exceeded":
        return "verdict-mle";
      case "runtime_error":
        return "verdict-re";
      case "compile_error":
        return "verdict-ce";
      case "queued":
      case "compiling":
      case "running":
        return "verdict-pending";
      default:
        return "muted";
    }
  }

  function timeAgo(date: Date | string): string {
    const now = Date.now();
    const then = new Date(date).getTime();
    const diffMs = now - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
</script>

<div class="space-y-6">
  <!-- Section 1 — Hero Bar -->
  <Card variant="surface" size="lg">
    <div class="flex flex-col gap-6">
      <div class="flex items-baseline justify-between gap-4">
        <h2 class="text-title-sm font-semibold">
          {m.dashboard_welcome({ username: data.username })}
        </h2>
        <span class="text-caption text-muted-foreground">
          {m.dashboard_last30Days()}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-6 md:grid-cols-4">
        <div class="flex flex-col gap-1">
          <span class="text-caption text-muted-foreground">
            {m.dashboard_totalAc()}
          </span>
          <span class="text-headline font-semibold tabular-nums">
            {stats.totalAc}
          </span>
        </div>
        <div class="flex flex-col gap-1 md:border-l md:border-border-subtle md:pl-6">
          <span class="text-caption text-muted-foreground">
            {m.dashboard_totalAttempts()}
          </span>
          <span class="text-headline font-semibold tabular-nums">
            {stats.totalAttempts}
          </span>
        </div>
        <div class="flex flex-col gap-1 md:border-l md:border-border-subtle md:pl-6">
          <span class="text-caption text-muted-foreground">
            {m.dashboard_acRate()}
          </span>
          <span class="text-headline font-semibold tabular-nums">{acRate}</span>
        </div>
        <div class="flex flex-col gap-1 md:border-l md:border-border-subtle md:pl-6">
          <span class="text-caption text-muted-foreground">
            {m.dashboard_practiceDays()}
          </span>
          <span class="text-headline font-semibold tabular-nums">
            {practiceDays}
          </span>
        </div>
      </div>
    </div>
  </Card>

  <!-- Section 2 — Activity Heatmap -->
  <Card variant="surface" size="lg">
    <h2 class="mb-4 text-title-sm font-semibold">
      {m.dashboard_activityChart()}
    </h2>
    {#if hasHeatmapData}
      <ActivityHeatmap data={dailyActivity} />
    {:else}
      <EmptyState
        variant="minimal"
        icon={LineChart}
        title={m.dashboard_noActivity()}
        description={m.dashboard_startPracticing()}
      />
    {/if}
  </Card>

  <!-- Section 3 — Ability Profile -->
  <div class="grid gap-4">
    <Card variant="surface" size="lg">
      <h2 class="mb-4 text-title-sm font-semibold">
        {m.dashboard_tagProficiency()}
      </h2>
      {#if hasTagData}
        <EChart option={tagOption} class="h-64 w-full" />
      {:else}
        <EmptyState
          variant="minimal"
          icon={PieChart}
          title={m.dashboard_noTagData()}
        />
      {/if}
    </Card>

    <div class="grid gap-4 lg:grid-cols-2">
      <Card variant="surface" size="lg">
        <h2 class="mb-4 text-title-sm font-semibold">
          {m.dashboard_difficultyDist()}
        </h2>
        {#if hasDifficultyData}
          <EChart option={difficultyOption} class="h-56 w-full" />
        {:else}
          <EmptyState
            variant="minimal"
            icon={PieChart}
            title={m.dashboard_noTagData()}
          />
        {/if}
      </Card>

      <Card variant="surface" size="lg">
        <h2 class="mb-4 text-title-sm font-semibold">
          {m.dashboard_verdictDistribution()}
        </h2>
        {#if hasVerdictData}
          <EChart option={verdictOption} class="h-56 w-full" />
        {:else}
          <EmptyState
            variant="minimal"
            icon={PieChart}
            title={m.dashboard_noTagData()}
          />
        {/if}
      </Card>
    </div>
  </div>

  <!-- Section 4 — Recent Submissions -->
  <Card variant="surface" size="lg">
    <h2 class="mb-4 text-title-sm font-semibold">
      {m.dashboard_recentActivity()}
    </h2>
    {#if data.recentSubmissions.length > 0}
      <ul class="space-y-3">
        {#each data.recentSubmissions.slice(0, 5) as sub (sub.id)}
          <li class="flex items-center gap-3 text-body-sm">
            <time
              class="shrink-0 text-caption text-muted-foreground tabular-nums"
            >
              {timeAgo(sub.createdAt)}
            </time>
            <Badge variant={verdictToBadgeVariant(sub.status)} size="sm">
              {formatVerdictLabel(sub.status)}
            </Badge>
            <a
              href="/problems/{sub.problem.id}"
              class="truncate hover:underline"
            >
              {sub.problem.title}
            </a>
            <span class="shrink-0 text-caption text-muted-foreground">
              ({sub.language})
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <EmptyState
        variant="minimal"
        icon={Code2}
        title={m.dashboard_noActivity()}
        description={m.dashboard_startPracticing()}
        actionHref="/problems"
        actionLabel={m.dashboard_browseProblems()}
      />
    {/if}
  </Card>
</div>
```

Notes on this rewrite:

- No `Section.svelte` — each Card has an inline `<h2 class="mb-4 text-title-sm font-semibold">` so Fraunces never touches CJK headings on this page.
- No `StatCard.svelte` — hero bar is one card with four flex cells.
- `verdictPalette` uses rgba with 0.5 alpha for non-AC verdicts so AC dominates visually.
- `tagOption` uses `inverse: true` on yAxis so the highest count sits on top.
- All conditional empty-state icons reuse `PieChart` and `LineChart` from `@lucide/svelte` — no new icon deps.

- [ ] **Step 2: svelte-check**

```bash
pnpm --filter web check
```

Expected: no errors. Common issues:

- If `Card` import path differs from `$lib/components/ui/card` → adjust to match other routes (e.g., `/problems/+page.svelte` imports Card the same way this file did).
- If `text-headline` is not a recognized Tailwind utility → confirm `app.css` defines `--text-headline` in the `@theme` block (it does, per line 157/315 of `app.css`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/\(app\)/dashboard/+page.svelte
git commit -m "feat(web): redesign dashboard as student ability overview"
```

---

## Task 7: Remove unused i18n keys + full verification

**Files:**

- Modify: `apps/web/messages/zh-TW.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Grep for remaining usages of soon-to-be-deleted keys**

For each of these keys, verify they are no longer referenced by any `apps/web/src` file:

```bash
for key in dashboard_recommendations dashboard_noRecommendations dashboard_recommendationsEmptyDescription dashboard_languageDist; do
  echo "=== $key ==="
  grep -rn "$key\|m\.$key" apps/web/src || echo "  (no usages)"
done
```

Expected: each key reports "no usages". If any key still has a usage, **do not delete it** and note the surviving usage in the final commit message.

- [ ] **Step 2: Delete unused keys from zh-TW.json**

Remove the lines for `dashboard_recommendations`, `dashboard_noRecommendations`, `dashboard_recommendationsEmptyDescription`, and `dashboard_languageDist` from `apps/web/messages/zh-TW.json`. Keep the JSON valid (watch trailing commas).

- [ ] **Step 3: Mirror deletions in en.json**

Same set of keys deleted from `apps/web/messages/en.json`.

- [ ] **Step 4: Full verification pass**

Run, in order:

```bash
pnpm --filter web check
pnpm lint
pnpm vitest run tests/unit/domain/user-analytics-helpers.test.ts
```

Expected: all three pass. The lint command covers the whole repo because ESLint is configured at the root.

- [ ] **Step 5: Manual visual smoke test**

```bash
pnpm --filter web dev
```

Open the dashboard route (`http://localhost:<port>/dashboard`, whatever port dev prints). Sign in as an account that has AC submissions. Verify in **both light and dark mode** (toggle via the header button):

- Hero bar: four numbers render with Manrope (not serif), no uppercase on labels, `md:border-l` dividers show at ≥ `md:` breakpoint.
- Heatmap: 30 cells, tooltip works on hover, intensity shading reflects AC counts.
- Tag chart: top-8 tags sorted descending, tag label visible on the left axis.
- Difficulty donut: three slices (easy/medium/hard).
- Verdict donut: AC slice visually dominant, other slices muted, center shows AC rate.
- Recent submissions: ≤ 5 rows, badge + link render.
- Resize browser to < 768px: hero bar collapses to 2×2, ability profile donuts stack vertically, heatmap still fits.

Then sign in as a **fresh account with no submissions** (or create one via the DB) and verify every empty state renders with its icon and copy.

- [ ] **Step 6: Commit**

```bash
git add apps/web/messages/zh-TW.json apps/web/messages/en.json
git commit -m "i18n(web): drop dashboard keys no longer referenced"
```

---

## Summary of commits this plan produces

1. `feat(domain): add aggregateByTag helper for user analytics`
2. `feat(domain): expose byTag from getUserAnalytics`
3. `feat(web): add ActivityHeatmap component for dashboard`
4. `i18n(web): add dashboard redesign keys`
5. `refactor(web): trim dashboard loader to ability-overview fields`
6. `feat(web): redesign dashboard as student ability overview`
7. `i18n(web): drop dashboard keys no longer referenced`

Seven small, atomic commits. Each task is independently reviewable.
