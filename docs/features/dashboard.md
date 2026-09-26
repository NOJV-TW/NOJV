# Feature: Student Dashboard

Acceptance spec for `/dashboard`: the signed-in user's own ability overview (stats, one-year heatmap, difficulty/verdict/language/tag charts, recent submissions), plus an anonymous site-wide view at `?view=server`. It is strictly read-your-own; there is no lens onto another user (UI-19). Day bucketing happens in the browser (WEB-06).

## Key code

- `packages/application/src/user/queries.ts` — `getDashboardView`, `aggregateByTag`
- `packages/application/src/user/activity.ts` — `getSubmissionActivity`
- `packages/application/src/platform/index.ts` — `getPlatformOverview`
- `apps/web/src/lib/utils/activity.ts` — `buildActivityModel`
- `apps/web/src/routes/(app)/dashboard/+page.server.ts`, `+page.svelte`
- `apps/web/src/lib/components/features/dashboard/` — `ActivityHeatmap`, `WelcomeGuide`, `PlatformOverview`; `apps/web/src/lib/components/primitives/charts/EChart.svelte`
- Tests: `tests/unit/web/activity-model.test.ts`, `tests/unit/application/dashboard-view.test.ts`, `user-analytics-helpers.test.ts`, `platform-overview.test.ts`, `tests/e2e/dashboard.test.ts`

There is no activity table: surfaces read `Submission` rows directly.

Out of scope: viewing another user's dashboard (teachers use the course progress matrix), a date-range picker, achievements or badges, a timezone setting, team scoreboards. The cross-course assignment list lives at `/assignments`.

## Acceptance criteria

### Server load

- Unauthenticated requests redirect to sign-in (`requireAuth`). `getDashboardView(actor.userId)` always uses the actor; there is no `?userId=` override, and admins see their own data.
- The load awaits `getDashboardView` and returns `stats`, `recentSubmissions`, `analytics`, `username`, and `streamed.activity`, a streamed `{ at, ac }[]` of ISO timestamps. The activity query runs only when `stats.totalAttempts > 0`; otherwise it resolves to `[]`.
- Zero submissions: `totalAc === 0`, `totalAttempts === 0`, `recentSubmissions === []`, empty analytics, and `WelcomeGuide` (staff or student CTAs) replaces the body.

### Activity heatmap

- `getSubmissionActivity(userId, since)` returns non-sample, non-reference-solution submissions from the last 366 days with their current status, so rejudges show on the next load.
- `buildActivityModel(events, now, 365)` produces `heatmapDays`: exactly 365 entries from local day D−364 to D, keyed `YYYY-MM-DD` in the browser's timezone, zero-filled. Older events are dropped.
- Submissions at 23:30 on D and 00:30 on D+1 local time fall in different buckets.
- "Practice days" counts `heatmapDays` entries with `submissionCount > 0`. The model also computes streak and weekly trend, which no card renders.

### Stats

- `totalAc` = distinct solved problems, `totalAttemptedProblems` = distinct attempted problems, `totalAttempts` = non-sample submissions with a result verdict.
- AC rate = `totalAc / totalAttemptedProblems`, counted per problem, not per submission; zero attempts shows `0%`, never `NaN%`.

### Charts

- Tags: `aggregateByTag` returns the top 20 tags by AC count, ties broken alphabetically; the bar chart shows 7 rows and scrolls. No tags → empty state.
- Difficulty: AC problems in fixed `easy`, `medium`, `hard` order.
- Verdict: donut of verdict counts with the AC rate in the center (`0%` when there are no ACs).
- Language: donut of submission counts by language.
- Each chart shows an `EmptyState` when its data is empty (`hasHeatmapData`, `hasDifficultyData`, `hasVerdictData`, `hasTagData`, `hasLanguageData`).

### Recent submissions

- Up to the 10 most recent submissions, newest first, with problem and verdict; fewer are not padded.

### Site-wide view

- A top-left `TabStrip` switches between personal (default) and site-wide (`?view=server`) using `goto` with `replaceState`. Any other `view` value shows the personal view, including `WelcomeGuide` and the student-tour `data-tour` targets.
- `getPlatformOverview()` is a Redis read-through cache (`nojv:cache:platform-overview`, 300 s TTL, single-flight lock) over one 30-day submission query plus user and public-problem counts.
- It shows four KPI cards (users, public problems, 30-day submissions, 30-day AC rate), a 30-day daily trend (submission bars, accepted line, distinct active users on a second axis), verdict and language donuts, and the top 8 public published problems by 30-day submissions linking to `/problems/{id}`.
- It shows only anonymous aggregates and never names or links a user.
