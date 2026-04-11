# Dashboard Redesign — Student Ability Overview

**Date:** 2026-04-11
**Scope:** `apps/web/src/routes/(app)/dashboard/+page.svelte` and its server loader, plus a small addition to `packages/domain/src/user/queries.ts` and one new chart component.
**Status:** Approved for implementation.

## Problem

The current `/dashboard` page bundles eight unrelated sections (welcome, 3 stat cards, activity line chart, 3-chart analytics grid, courses, upcoming assessments, announcements, recent activity, recommendations) on one screen. Two concrete complaints:

1. **Information overload.** Courses, assessments, announcements, and recommendations all duplicate content that already lives on dedicated routes (`/courses`, `/assignments`, `/problems`). The page loses its purpose.
2. **Typography dissonance.** Every section heading is rendered with `font-display` (Fraunces, a Latin serif) at `text-title-lg` (30px). Chinese glyphs fall back to the system sans-serif, producing a visually jarring serif-Latin + sans-Chinese mix on every heading. The repeated 30px headings also break the vertical rhythm, so the page reads as a stack of equally-important cards with no hierarchy.

## Goal

Re-cast `/dashboard` as a **student ability overview** — a concise "how am I doing" page built around four focused sections, with typography that respects the CJK-heavy content.

## Non-Goals

- No changes to any other route. Courses/assessments/announcements continue to live on their own pages and are **not** re-homed.
- No new database tables, Prisma migrations, or Redis keys. All charts derive from data already persisted (`Submission`, `Problem.tags`, `Problem.difficulty`, `UserDailyActivity`).
- No changes to the global design tokens in `app.css`. This redesign uses only existing tokens.
- No changes to the `Header` component, route guard, or `requireAuth` flow.

## Final Layout

Four sections, top to bottom, all inside the existing `space-y-6` container:

### Section 1 — Hero Bar (replaces welcome + 3 StatCards)

A single `Card variant="surface" size="lg"` containing:

- **Row 1:** greeting `Hi, {username}` rendered with `font-sans text-title-sm font-semibold` (Manrope, 20px) on the left. On the right, a muted caption (`text-caption text-muted-foreground`) reading `近 30 天`.
- **Row 2:** four inline stat cells in `grid grid-cols-2 md:grid-cols-4 gap-6`. The 2nd, 3rd, and 4th cells get `md:border-l md:border-border-subtle md:pl-6` so the divider only appears on desktop (where cells sit side-by-side). Each cell:
  - Number: `font-sans text-headline font-semibold tabular-nums` (36px Manrope, not Fraunces).
  - Label: `text-caption text-muted-foreground` (12px), **no `uppercase`, no `tracking-wide`** — these look wrong on CJK text.

Four KPIs:

| Cell | Value | Source |
| --- | --- | --- |
| 已解題 | `stats.totalAc` | existing `getUserDashboard` |
| 嘗試題數 | `stats.totalAttempts` | existing |
| 通過率 | `acRate` (formatted %) | existing derived value |
| 練習天數 | count of `dailyActivity` rows where `submissionCount > 0` | computed inline in `+page.svelte` from existing `dailyActivity` |

The existing `StatCard` component is **not** used on this page anymore. It stays in `$lib/components/ui/` for other routes.

### Section 2 — Activity Heatmap (replaces activity line chart)

A GitHub-contribution-style 30-day heatmap. Replaces the current `activityOption` line chart entirely.

**New component:** `apps/web/src/lib/components/charts/ActivityHeatmap.svelte`.

- Props: `{ data: { date: string; acCount: number; submissionCount: number }[] }`.
- Renders a single horizontal strip of **30 rounded squares** (one per UTC day) using CSS grid: `grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1`. No ECharts — pure DOM is enough for 30 cells and keeps bundle size down.
- Four intensity tiers based on `acCount`:
  - `0` → `bg-[color:var(--muted)]/40`
  - `1` → `bg-[color:color-mix(in_oklch,var(--chart-5)_30%,transparent)]`
  - `2–3` → `bg-[color:color-mix(in_oklch,var(--chart-5)_60%,transparent)]`
  - `≥4` → `bg-[color:var(--chart-5)]`
- Each cell is a `<div>` with `role="img"` and `aria-label="{date}: {acCount} AC / {submissionCount} submissions"`, plus a Bits UI `Tooltip` on hover showing the same.
- Cell size: `h-4 w-4 rounded-[3px]` on mobile, `h-5 w-5` from `sm:` up.
- Empty state: if every cell is zero, render the existing `EmptyState` with `icon={LineChart}` and `dashboard_noActivity` / `dashboard_startPracticing` messages.

Wrapped in the same `<Card variant="surface" size="lg"><Section>` pattern as other sections.

### Section 3 — Ability Profile (1 + 2 layout)

A new sub-grid replacing the current 3-column analytics grid:

```
┌────────────────────────────────────────────────┐
│  主題熟練度 (tag proficiency bar)  — full width │
└────────────────────────────────────────────────┘
┌─────────────────────────┬──────────────────────┐
│  難度分布 donut          │  通過率分布 donut     │
└─────────────────────────┴──────────────────────┘
```

Implemented as two rows:

```svelte
<div class="grid gap-4">
  <Card>…tag chart (full width)…</Card>
  <div class="grid gap-4 lg:grid-cols-2">
    <Card>…difficulty donut…</Card>
    <Card>…verdict donut…</Card>
  </div>
</div>
```

#### 3a — 主題熟練度 (Tag Proficiency)

Horizontal ECharts bar chart, top 8 tags by AC count.

**Data:** extend `getUserAnalytics` in `packages/domain/src/user/queries.ts` to also return `byTag`:

```ts
export interface UserAnalytics {
  byDifficulty: { difficulty: "easy" | "medium" | "hard"; acCount: number }[];
  byLanguage: { language: string; count: number }[];  // kept for other callers; this page stops rendering it
  byVerdict: { status: string; count: number }[];
  byTag: { tag: string; acCount: number }[];          // NEW — sorted desc, capped at 8
}
```

Implementation inside `getUserAnalytics`:

```ts
const tagCounts = new Map<string, number>();
for (const row of acProblems) {
  for (const tag of row.problem.tags) {
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
}
const byTag = [...tagCounts.entries()]
  .map(([tag, acCount]) => ({ tag, acCount }))
  .sort((a, b) => b.acCount - a.acCount)
  .slice(0, 8);
```

`acProblems` is already fetched above — no new query. `Problem.tags` is already selected by `submissionRepo.findDistinctAcByUser` (confirmed in the current domain code that flatMaps `.problem.tags`).

**Chart option:** horizontal bar, `grid.left: 96` to fit tag labels, `itemStyle: { color: "var(--chart-3)", borderRadius: [0, 4, 4, 0] }`, `barMaxWidth: 18`. Height `h-64` (slightly taller than other charts to accommodate 8 rows).

Empty state: if `byTag.length === 0`, render `EmptyState` with `icon={PieChart}` and title `尚無 AC 紀錄`.

#### 3b — 難度分布 (Difficulty Donut)

Same `difficultyOption` as today — donut with easy/medium/hard coloring. **No structural change.** Just moves into the 2-column row and shrinks to half width.

#### 3c — 通過率分布 (Verdict Donut, AC-framed)

Reuses existing `analytics.byVerdict` data, but the option is rewritten so the AC slice is visually dominant:

- `accepted` slice: `color: var(--chart-5)` (primary accent) with `borderWidth: 3, borderColor: var(--color-panel)` and a larger radius bump via a custom `emphasis` state.
- All non-AC slices: muted color ramp from the existing `verdictPalette` but at `0.5` opacity so they read as "the remainder" rather than individually competing for attention.
- Donut hole center label shows the AC rate via ECharts `title`: `{ text: acRate, subtext: "通過率", left: "center", top: "38%", textStyle: { fontSize: 28, fontWeight: 600 }, subtextStyle: { fontSize: 12 } }`.

Title: `通過率分布`. Empty state identical pattern to the others.

### Section 4 — 最近提交 (recent submissions)

Structurally identical to the current `dashboard_recentActivity` card — same list of up to 5 `recentSubmissions`, same `Badge` + `timeAgo` rendering. The only change is the heading style (see Typography Rules below).

## Removed From This Page

Delete the following from `+page.svelte` and its `+page.server.ts` load:

- `courses` section + `listCourseCards` call + `courses` in the returned payload.
- `upcomingAssessments` section + `listUpcomingAssessments` call + all `deriveAssessmentWindowState` / `windowStateColorClass` usage in this loader.
- `announcements` section + `listAnnouncements` call + `mappedAnnouncements` transform + `DEFAULT_LOCALE` import.
- `recommendations` section + `data.recommendations` usage. (Note: `recommendations` is currently produced inside `getUserDashboard`. Do **not** delete it from the domain function — other callers may use it; just stop rendering it on this page.)
- The entire language bar chart block + `languageOption` + `hasLanguageData`.
- The old 3-column analytics grid wrapper.
- Unused icon imports after removal: `BookOpen`, `CalendarClock`, `Megaphone`, `Lightbulb`, `Code2` (only if no remaining usage — verify before deleting).

`listCourseCards`, `listUpcomingAssessments`, `listAnnouncements` remain in `packages/domain` — they're used by other routes and must not be deleted.

## Typography Rules (applies to this page only)

1. **Section headings** (`h2` inside `Section` header snippet): the `Section.svelte` component hard-codes `font-display` (Fraunces) via scoped styles. Two options:
   - **Chosen:** render headings inline in the `Card` without the `Section` header snippet, using `<h2 class="mb-4 text-title-sm font-semibold">…</h2>`. This bypasses the Fraunces rule without touching `Section.svelte`, so other pages that depend on the display font (contest titles, course views) are unaffected.
   - Rejected: modifying `Section.svelte` — would ripple across the app.
2. **No `uppercase` + `tracking-wide`** on any label on this page. They're designed for Latin captions and look wrong in Chinese.
3. **Numbers** use `font-sans tabular-nums`, never `font-display`.
4. **Size scale on this page:**
   - Greeting: `text-title-sm` (20px) semibold
   - Stat numbers: `text-headline` (36px) semibold tabular-nums
   - Card/section titles: `text-title-sm` (20px) semibold — **not** `text-title-lg`
   - Body: `text-body-sm` (14px)
   - Captions: `text-caption` (12px), no uppercase

## i18n Changes

`apps/web/messages/zh-TW.json` and `en.json`:

- **Add:**
  - `dashboard_practiceDays` → `練習天數` / `Practice Days`
  - `dashboard_last30Days` → `近 30 天` / `Last 30 days`
  - `dashboard_tagProficiency` → `主題熟練度` / `Topic Proficiency`
  - `dashboard_verdictDistribution` → `通過率分布` / `Pass Rate`
  - `dashboard_noTagData` → `尚無 AC 紀錄` / `No AC records yet`
- **Remove (no longer used anywhere — verify with grep before deleting):**
  - `dashboard_recommendations`
  - `dashboard_noRecommendations`
  - `dashboard_recommendationsEmptyDescription`
  - `dashboard_languageDist` (verify: may still be referenced elsewhere)
- **Keep:** `dashboard_welcome`, `dashboard_totalAc`, `dashboard_totalAttempts`, `dashboard_acRate`, `dashboard_activityChart`, `dashboard_difficultyDist`, `dashboard_recentActivity`, `dashboard_noActivity`, `dashboard_startPracticing`, `dashboard_browseProblems`.

Existing hard-coded Chinese strings in the current `+page.svelte` (`已解難度分布`, `語言提交分布`, `判題結果分布`, `我的課程`, etc.) — remove with their sections, no i18n migration needed for deleted content.

## Server Loader Changes

`apps/web/src/routes/(app)/dashboard/+page.server.ts`:

- Drop from `Promise.all`: `listCourseCards`, `listUpcomingAssessments`, `listAnnouncements`.
- Drop: `mappedAssessments`, `mappedAnnouncements`, `DEFAULT_LOCALE` import, `deriveAssessmentWindowState` + `windowStateColorClass` imports.
- Return payload is reduced to:
  ```ts
  {
    stats,
    recentSubmissions,
    username: actor.username,
    analytics,      // now includes byTag
    dailyActivity   // unchanged
  }
  ```
- `recommendations` stays out of the returned payload (the `getUserDashboard` domain fn still computes it; the loader just doesn't forward it).

## Files Touched

| File | Change |
| --- | --- |
| `packages/domain/src/user/queries.ts` | Add `byTag` to `UserAnalytics` + populate in `getUserAnalytics` |
| `apps/web/src/lib/components/charts/ActivityHeatmap.svelte` | **New.** 30-day DOM-based heatmap with tooltips |
| `apps/web/src/routes/(app)/dashboard/+page.svelte` | Full rewrite per layout above |
| `apps/web/src/routes/(app)/dashboard/+page.server.ts` | Remove courses/assessments/announcements loads |
| `apps/web/messages/zh-TW.json` | Add 5 new keys, remove 3-4 unused keys |
| `apps/web/messages/en.json` | Mirror the zh-TW changes |

No changes to `packages/db`, no Prisma migrations, no Temporal workflow changes, no test infrastructure changes.

## Testing

- **Unit:** `packages/domain` has existing Vitest tests for `getUserAnalytics`. Add one case verifying `byTag` returns top-8 sorted descending, with multi-tag AC problems counted under every tag they carry.
- **Visual:** manually verify in both light and dark mode via `pnpm --filter web dev`, with:
  - A user who has AC submissions → all charts populated
  - A user with zero submissions → every empty state renders with the correct icon and copy
  - Narrow viewport (`sm`) → hero bar collapses 4 cells to 2×2 grid, ability profile stacks vertically
- **Lint/type:** `pnpm lint` and `pnpm build` (or `pnpm --filter web check`) must pass.

## Risks & Mitigations

1. **Hidden consumers of removed i18n keys.** Before deleting any `dashboard_*` key, `grep -r "dashboard_recommendations" apps/web/src` — if only `+page.svelte` references it, safe to delete; otherwise leave it.
2. **`recentSubmissions` shape drift.** The recent activity section depends on `sub.problem.id`, `sub.problem.title`, `sub.status`, `sub.language`, `sub.createdAt`. Verify `submissionRepo.findRecentByUser` still returns these — no change expected, just a preflight.
3. **Heatmap on narrow screens.** 30 cells × `w-5` = 150px + gaps, which fits any viewport ≥ 320px. No special mobile handling needed, but confirm visually.
4. **`byLanguage` staying in the type** means other callers (if any) are unaffected. Grep confirms no other caller today; leaving it keeps the diff surgical.

## Out of Scope / Follow-ups

- Longer-range heatmap (90/365 days) — can ship later as a view toggle.
- Tag taxonomy grouping (e.g., "DP family", "Graph family") — requires a curated tag map which this project doesn't have.
- Percentile / rank among peers — requires cross-user queries not currently cached.
