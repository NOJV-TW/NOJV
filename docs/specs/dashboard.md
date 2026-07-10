# Feature: Student Dashboard

Acceptance spec for `/dashboard` — a user-scoped overview of a student's
own activity and ability. Shows an at-a-glance stats block (solved count,
attempts, AC rate, practice days), a one-year activity heatmap,
difficulty / verdict / language / tag analytics, and recent submissions,
all wired into `apps/web/src/routes/(app)/dashboard/+page.svelte`.
Strictly read-your-own: no teacher or admin "view another user" lens
exists on this surface. A top-left toggle switches to an anonymous
site-wide overview (see "Site-wide view toggle" below).

The heatmap and the practice-days stat are derived **client-side** from
raw submission timestamps so the calendar day matches the viewer's local
timezone — the server cannot bucket by day without knowing the browser
timezone. There is no pre-aggregated daily-activity table.

## User Stories

- As a **student**, I want to see which days I practiced over the past
  year, so that I can keep a regular habit.
- As a **student**, I want AC count + attempt count + AC rate at the
  top of the page, so that I have a quick pulse on my progress.
- As a **student**, I want to see which tags I'm strong in (top 20 by AC
  count, scrollable bar chart), so that I know where to broaden.
- As a **student**, I want a donut of my AC problems by difficulty, so
  that I can tell if I'm stuck at easy or pushing into hard.
- As a **student**, I want a verdict distribution (AC / WA / TLE / MLE /
  RE / CE / queued) with AC% in the center, so that I can see where my
  non-AC attempts are going.
- As a **student**, I want the most recent submissions listed with
  problem + verdict + timestamp, so that I can jump back into
  in-progress problems.

## Scope

### In scope

- Route `/dashboard` — auth-gated via `requireAuth(event)`,
  strictly actor-scoped.
- `getDashboardView(userId)` fan-out: stats + recent submissions +
  `analytics` (byDifficulty / byLanguage / byVerdict / byTag).
- `getSubmissionActivity(userId, since)` — raw submission timestamps
  (`sampleOnly: false`) for the trailing ~366 days, returned as
  `{ createdAt, isAc }[]`. No server-side day aggregation.
- Client-side `buildActivityModel(events, now, 365)`
  (`apps/web/src/lib/utils/activity.ts`) — buckets raw events into the
  viewer's LOCAL calendar day. The page consumes `heatmapDays` (365
  days) for the heatmap and the practice-days stat; the model's
  `weeklyTrend` and `streakDays` fields are still computed and
  unit-tested but no card renders them since the streak / weekly-trend /
  suggested-problems cards were removed (PR #175, 2026-06-30).
- Top-N aggregation: `aggregateByTag` returns the top 20 by AC count,
  sorted descending, ties broken alphabetically by tag (deterministic
  across loads).
- Charts: `ActivityHeatmap` (365-day cells), EChart donuts for
  difficulty / verdict / language, horizontal bar for tag proficiency
  (7 rows visible, scrollable when more).
- Empty state per chart
  (`hasHeatmapData` / `hasDifficultyData` / `hasVerdictData` /
  `hasTagData` / `hasLanguageData`) — replaces the chart with an
  `EmptyState` component.
- Zero-submission onboarding state (`WelcomeGuide.svelte`) — replaces
  the entire personal dashboard body, with staff vs student CTA sets.
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
- **Streak / weekly-trend / suggested-problems cards**: removed in
  PR #175 (2026-06-30); not planned for return.

## Acceptance Criteria

### Server load

- GIVEN an unauthenticated request to `/dashboard`,
  WHEN the load runs,
  THEN SvelteKit redirects to the sign-in flow via `requireAuth(event)`.
- GIVEN an authenticated request,
  WHEN the load runs,
  THEN `getDashboardView(actor.userId)` is awaited (so the shell can
  decide between `<WelcomeGuide />` and the dashboard body); the
  response carries top-level `stats`, `recentSubmissions`, `analytics`,
  `username`, plus a nested `streamed` object. `streamed.activity` (an
  `{ at, ac }[]` array of ISO timestamps) is a STREAMED promise, kicked
  off only when `hasActivity` (`stats.totalAttempts > 0`); otherwise it
  resolves to an empty array without hitting the heavier query.
- GIVEN an actor with zero submissions,
  WHEN the load runs,
  THEN `stats.totalAc === 0`, `stats.totalAttempts === 0`,
  `recentSubmissions === []`, `streamed.activity` resolves to `[]` (the
  `hasActivity` gate is false, so the query is skipped), and every
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

- GIVEN the actor's AC set spans 25 distinct tags,
  WHEN `aggregateByTag` runs,
  THEN only the top 20 by count are returned, sorted descending.
- GIVEN a tie in AC counts,
  WHEN the sort is applied,
  THEN the tie is broken alphabetically by tag — no flicker between
  loads of otherwise unchanged data.

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

### Site-wide view toggle

The top-left `TabStrip` switches between the personal overview (default)
and a site-wide overview (`?view=server`). The site-wide view shows only
anonymous aggregates — it never names or links any user, so it does not
conflict with the private-by-default profile model.

- GIVEN any authenticated user loads `/dashboard?view=server`,
  WHEN the load runs,
  THEN `platformDomain.getPlatformOverview()` is fetched alongside the
  personal view data — a Redis read-through cache
  (`nojv:cache:platform-overview`, 300 s TTL) in front of one 30-day
  submission window query plus total user / public problem counts.
- GIVEN the site-wide view renders,
  WHEN data is present,
  THEN it shows: four KPI stat cards (users, public problems, 30-day
  submissions, 30-day AC rate), a 30-day daily trend chart (submission
  bars, accepted line, distinct-active-users line on a second axis),
  verdict and language donuts for the same window, and a "trending
  problems" table listing only `public` + `published` problems (top 8 by
  30-day submission count, linking to `/problems/{id}`).
- GIVEN no `view` query param (or any value other than `server`),
  WHEN the page renders,
  THEN the personal view shows, unchanged — including `WelcomeGuide` for
  zero-submission users and the `data-tour` targets used by the student
  onboarding tour.
- GIVEN the toggle is clicked,
  WHEN the view changes,
  THEN the URL is updated via `goto` with `replaceState` so the choice
  survives refresh but does not pollute history.

## Edge Cases & Failure Modes

- **Brand-new user, zero submissions**: all charts render empty states;
  no errors.
- **Submission rejudged (AC↔non-AC)**: `getSubmissionActivity` reads the
  submission's CURRENT `status`, so a rejudge that flips the verdict is
  reflected on the next dashboard load automatically — there is no
  pre-aggregated counter to delta-adjust.
- **Timezone other than UTC**: the heatmap and practice-days stat
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

- `packages/application/src/user/queries.ts` — `getDashboardView`,
  `aggregateByTag` (top-20 cut, alphabetical tie-break).
- `packages/application/src/user/activity.ts` — `getSubmissionActivity` (raw
  submission timestamps for the activity surfaces).
- `packages/application/src/platform/index.ts` — `getPlatformOverview`
  (site-wide view; cached aggregates).

### Schema

- No dedicated table. The activity surfaces read `Submission` rows
  directly (`packages/db/prisma/schema/submission.prisma`). The former
  `UserDailyActivity` pre-aggregation table — and its repository and
  Temporal write activities — were removed 2026-05-18 when the dashboard
  moved to client-side local-day bucketing.

### Client

- `apps/web/src/lib/utils/activity.ts` — `buildActivityModel`
  (local-day bucketing; also computes `computeStreak` / weekly-trend
  fields that no card currently renders).

### Routes / Components

- `apps/web/src/routes/(app)/dashboard/+page.server.ts` — server load.
- `apps/web/src/routes/(app)/dashboard/+page.svelte` — view toggle,
  chart composition + empty states.
- `apps/web/src/lib/components/features/dashboard/ActivityHeatmap.svelte`
  — heatmap.
- `apps/web/src/lib/components/features/dashboard/WelcomeGuide.svelte`
  — zero-submission onboarding state.
- `apps/web/src/lib/components/features/dashboard/PlatformOverview.svelte`
  — site-wide view body.
- `apps/web/src/lib/components/primitives/charts/EChart.svelte` — shared
  ECharts wrapper used by the donuts and bar chart.

### Tests

- `tests/unit/web/activity-model.test.ts` — covers `buildActivityModel`
  local-day bucketing plus the model's streak grace-day rule and
  weekly-trend slice (util-level behavior).
- `tests/unit/domain/dashboard-view.test.ts` — covers
  `getDashboardView` zero-submission baseline, totalAc / totalAttempts
  derivation, fixed easy→medium→hard ordering, language / verdict
  group-row flattening, and byTag top-20 cut.
- `tests/unit/domain/user-analytics-helpers.test.ts` — covers
  `aggregateByTag` including the alphabetical tie-break invariant.
- `tests/unit/domain/platform-overview.test.ts` — covers
  `getPlatformOverview` aggregation, cache revive, and the single-flight
  lock paths.
- `tests/e2e/dashboard.test.ts` — covers auth redirect, seeded dashboard
  rendering for student / teacher / admin, brand-new-user onboarding
  empty-state rendering, and the site-wide view toggle.
