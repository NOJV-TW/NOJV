# Feature: Student Dashboard

Acceptance spec for `/dashboard` — a user-scoped overview of a student's
own activity and ability. Shows a one-year activity heatmap, difficulty /
verdict / language / tag analytics, recent submissions, a current-streak
callout (`StreakCard.svelte`), a 7-day trend chart
(`WeeklyTrendCard.svelte`), and a "Suggested problems" rail
(`SuggestedProblemsCard.svelte`), all wired into
`apps/web/src/routes/(app)/dashboard/+page.svelte`. Strictly
read-your-own: no teacher or admin "view another user" lens exists on
this surface.

The heatmap, streak, and weekly trend are derived **client-side** from
raw submission timestamps so the calendar day matches the viewer's local
timezone — the server cannot bucket by day without knowing the browser
timezone. There is no pre-aggregated daily-activity table.

## User Stories

- As a **student**, I want to see which days I practiced over the past
  year, so that I can keep a streak.
- As a **student**, I want AC count + attempt count + AC rate at the
  top of the page, so that I have a quick pulse on my progress.
- As a **student**, I want to see which tags I'm strong in (top 8 by AC
  count), so that I know where to broaden.
- As a **student**, I want a donut of my AC problems by difficulty, so
  that I can tell if I'm stuck at easy or pushing into hard.
- As a **student**, I want a verdict distribution (AC / WA / TLE / MLE /
  RE / CE / queued) with AC% in the center, so that I can see where my
  non-AC attempts are going.
- As a **student**, I want the most recent submissions listed with
  problem + verdict + timestamp, so that I can jump back into
  in-progress problems.
- As a **student**, I want a current-streak callout and a 7-day trend
  chart, so that the heatmap is motivating rather than decorative.
- As a **student**, I want a short "suggested problems" rail based on my
  history, so that I have a next thing to try without leaving the
  dashboard.

## Scope

### In scope

- Route `/dashboard` — auth-gated via `requireAuth(event)`,
  strictly actor-scoped.
- `getDashboardView(userId)` fan-out: stats + recent submissions +
  `analytics` (byDifficulty / byLanguage / byVerdict / byTag).
- `getSubmissionActivity(userId, since)` — raw submission timestamps
  (`sampleOnly: false`) for the trailing ~366 days, returned as
  `{ createdAt, isAc }[]`. No server-side day aggregation.
- `getSuggestedProblems(userId)` — recommended-problem rail.
- Client-side `buildActivityModel(events, now, 365)`
  (`apps/web/src/lib/utils/activity.ts`) — buckets raw events into the
  viewer's LOCAL calendar day, producing `heatmapDays` (365 days),
  `weeklyTrend` (last 7 days), and `streakDays`.
- Top-N aggregation: `aggregateByTag` returns the top 8 by AC count,
  sorted descending, with stable ordering on ties.
- Charts: `ActivityHeatmap` (365-day cells), EChart donuts for
  difficulty / verdict / language, horizontal bar for tag proficiency.
- Empty state per chart
  (`hasHeatmapData` / `hasDifficultyData` / `hasVerdictData` /
  `hasTagData` / `hasLanguageData`) — replaces the chart with an
  `EmptyState` component.
- Current-streak card (`StreakCard.svelte`) — `streakDays` from
  `buildActivityModel`.
- 7-day trend card (`WeeklyTrendCard.svelte`) — submissions + AC per
  local day for the last 7 days.
- Suggested problems rail (`SuggestedProblemsCard.svelte`) — fed by the
  server load alongside the rest of the dashboard data.
- paraglide keys under `dashboard_*` (en + zh-TW).

### Out of scope

- **Teacher / admin view of another user's dashboard**: no such route.
  Teachers use the course progress matrix (separate feature).
- **Date range picker**: the 365-day window is fixed; no UI to shift or
  widen it.
- **Achievements, levels, or badges**: not modeled.
- **Cross-course assignment list**: lives on `/assignments` (covered by
  `assignments.md`).
- **Team or org scoreboard contribution**: per-user only.
- **Per-user timezone setting**: buckets follow the browser's local day;
  there is no explicit timezone picker.

## Acceptance Criteria

### Server load

- GIVEN an unauthenticated request to `/dashboard`,
  WHEN the load runs,
  THEN SvelteKit redirects to the sign-in flow via `requireAuth(event)`.
- GIVEN an authenticated request,
  WHEN the load runs,
  THEN `getDashboardView(actor.userId)`,
  `getSubmissionActivity(actor.userId, since)`, and
  `getSuggestedProblems(actor.userId)` resolve in parallel; the response
  carries `stats`, `recentSubmissions`, `analytics`, `activity` (an
  `{ at, ac }[]` array of ISO timestamps), `suggestedProblems`, and
  `username`.
- GIVEN an actor with zero submissions,
  WHEN the load runs,
  THEN `stats.totalAc === 0`, `stats.totalAttempts === 0`,
  `recentSubmissions === []`, `activity === []`, and every
  `analytics.*` array is empty.

### Activity heatmap

- GIVEN the actor submitted on 5 of the last 365 local days,
  WHEN `buildActivityModel(activity, now, 365)` runs,
  THEN `heatmapDays` has exactly 365 entries — 5 with
  `submissionCount > 0` and the other 360 zero-filled for rendering.
- GIVEN the current local date is D,
  WHEN the heatmap window is computed,
  THEN `heatmapDays` spans `D − 364` through `D` inclusive, each entry
  keyed by its local `YYYY-MM-DD`.
- GIVEN a submission at `23:30` local time on D and another at `00:30`
  local time on D+1,
  WHEN the events are bucketed,
  THEN they fall into two distinct local-day buckets.
- GIVEN the viewer's browser is in a non-UTC timezone,
  WHEN the heatmap renders,
  THEN buckets follow the browser's local calendar day — not UTC — so
  the squares match what the user perceives as "today".

### Streak

- GIVEN the actor has ≥1 AC on each of the last 4 consecutive local days
  including today,
  WHEN `computeStreak` runs,
  THEN `streakDays === 4`.
- GIVEN no AC today but ≥1 AC yesterday and the two days before,
  WHEN `computeStreak` runs,
  THEN `streakDays === 3` — today is a grace day so the streak does not
  vanish before the user has solved anything that day.
- GIVEN no AC today and no AC yesterday,
  WHEN `computeStreak` runs,
  THEN `streakDays === 0`.

### Weekly trend

- GIVEN the heatmap model is built,
  WHEN the weekly-trend card renders,
  THEN it shows the last 7 entries of `heatmapDays` (`weeklyTrend`),
  each with `submissionCount` and `acCount` for that local day.

### Stats and AC rate

- GIVEN 12 accepted distinct `(userId, problemId)` rows and 30 total
  submissions,
  WHEN the page renders the top stats block,
  THEN `totalAc = 12`, `totalAttempts = 30`, `acRate ≈ 40%`.
- GIVEN zero attempts,
  WHEN the AC rate is computed,
  THEN the display falls back to `0%` — never `NaN%`.
- GIVEN the heatmap model,
  WHEN the "practice days" stat is computed,
  THEN it counts `heatmapDays` entries with `submissionCount > 0`.

### Tag proficiency

- GIVEN the actor's AC set spans 15 distinct tags,
  WHEN `aggregateByTag` runs,
  THEN only the top 8 by count are returned, sorted descending.
- GIVEN a tie at the #8 / #9 boundary,
  WHEN the cut-off is applied,
  THEN the tie is broken by stable sort — no flicker between loads of
  otherwise unchanged data.

### Difficulty distribution

- GIVEN AC problems across all three difficulties,
  WHEN `analytics.byDifficulty` is computed,
  THEN the donut shows three segments (`easy`, `medium`, `hard`).
- GIVEN zero AC problems,
  WHEN the chart would render,
  THEN `hasDifficultyData === false` and an `EmptyState` replaces the
  donut.

### Verdict distribution

- GIVEN 100 submissions split 40 AC / 30 WA / 20 TLE / 10 RE,
  WHEN `analytics.byVerdict` is computed,
  THEN the donut renders 4 segments; the center text shows the AC rate
  as a percent.
- GIVEN all submissions are CE only,
  WHEN the donut renders,
  THEN the AC-rate center reads `0%` (not `NaN%`).

### Recent submissions

- GIVEN the actor has more than 10 submissions,
  WHEN the page loads,
  THEN `recentSubmissions` is the 10 most recent by `createdAt desc`,
  each with the problem reference and verdict.
- GIVEN fewer than 10 submissions,
  WHEN the page loads,
  THEN the list is shorter — no padding.

### Access scoping

- GIVEN user A loads `/dashboard`,
  WHEN the server reads the URL,
  THEN `getDashboardView(A.userId)` is called — there is no
  `?userId=` override.
- GIVEN an admin actor loads `/dashboard`,
  WHEN the page renders,
  THEN they see their OWN stats; no admin lens or user picker exists on
  this route.

## Edge Cases & Failure Modes

- **Brand-new user, zero submissions**: all charts render empty states;
  no errors.
- **Submission rejudged (AC↔non-AC)**: `getSubmissionActivity` reads the
  submission's CURRENT `status`, so a rejudge that flips the verdict is
  reflected on the next dashboard load automatically — there is no
  pre-aggregated counter to delta-adjust.
- **Timezone other than UTC**: the heatmap, streak, and weekly trend
  follow the browser's local calendar day. A user whose device clock
  changes timezone sees buckets shift with it.
- **Submissions older than the window**: the server query uses a
  generous ~366-day lower bound; `buildActivityModel` keeps only the
  trailing 365 local days, so anything older is silently dropped.
- **Zero tags on AC problems**: `aggregateByTag` returns `[]`; the bar
  chart renders its empty state.
- **Sample-only submissions**: excluded from `getSubmissionActivity`
  (`sampleOnly: false` filter), and `stats.totalAttempts` /
  `analytics.byVerdict` already exclude sample-only testcase runs.

## Implementation References

### Domain

- `packages/domain/src/user/queries.ts` — `getDashboardView`,
  `aggregateByTag` (top-8 cut, stable sort).
- `packages/domain/src/user/activity.ts` — `getSubmissionActivity` (raw
  submission timestamps for the activity surfaces).
- `packages/domain/src/user/analytics.ts` — `getSuggestedProblems`.

### Schema

- No dedicated table. The activity surfaces read `Submission` rows
  directly (`packages/db/prisma/schema/submission.prisma`). The former
  `UserDailyActivity` pre-aggregation table — and its repository and
  Temporal write activities — were removed 2026-05-18 when the dashboard
  moved to client-side local-day bucketing.

### Client

- `apps/web/src/lib/utils/activity.ts` — `buildActivityModel`
  (local-day bucketing, `computeStreak`, weekly-trend slice).

### Routes / Components

- `apps/web/src/routes/(app)/dashboard/+page.server.ts` — server load.
- `apps/web/src/routes/(app)/dashboard/+page.svelte` — chart
  composition + empty states.
- `apps/web/src/lib/components/features/dashboard/StreakCard.svelte` —
  current consecutive-day streak callout.
- `apps/web/src/lib/components/features/dashboard/WeeklyTrendCard.svelte`
  — 7-day submissions/AC trend.
- `apps/web/src/lib/components/features/dashboard/SuggestedProblemsCard.svelte`
  — recommended-problem rail.
- `apps/web/src/lib/components/features/dashboard/ActivityHeatmap.svelte`
  — heatmap.
- `apps/web/src/lib/components/primitives/charts/EChart.svelte` — shared
  ECharts wrapper used by the donuts and bar chart.

### Tests

- `tests/unit/web/activity-model.test.ts` — covers `buildActivityModel`
  local-day bucketing, the streak grace-day rule, and the weekly-trend
  slice.
- `tests/unit/domain/dashboard-view.test.ts` — covers
  `getDashboardView` zero-submission baseline, totalAc / totalAttempts
  derivation, fixed easy→medium→hard ordering, language / verdict
  group-row flattening, and byTag top-8 cut.
- `tests/unit/domain/user-analytics-helpers.test.ts` — covers
  `aggregateByTag` including the stable-sort-on-ties invariant.
- **Still missing**: an E2E test for empty-state rendering on a
  brand-new user.
