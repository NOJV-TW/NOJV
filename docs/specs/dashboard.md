# Feature: Student Dashboard

Acceptance spec for `/dashboard` — a user-scoped overview of a student's
own activity and ability. Shows a 30-day activity heatmap, difficulty /
verdict / tag analytics, and recent submissions. Strictly
read-your-own: no teacher or admin "view another user" lens exists on
this surface.

**Doc drift to flag**: `PRODUCT_SENSE.md § User Dashboard` lists
"problem-solving recommendations" under shipped scope, but the current
implementation renders tag proficiency and difficulty distribution
without a recommender — there is no personalized "next problem" query.
This spec treats recommendations as out-of-scope and captures the drift
in Open Questions.

## User Stories

- As a **student**, I want to see how many days I've practiced in the
  last 30 and which days were active, so that I can keep a streak.
- As a **student**, I want AC count + attempt count + AC rate at the
  top of the page, so that I have a quick pulse on my progress.
- As a **student**, I want to see which tags I'm strong in (top 8 by AC
  count), so that I know where to broaden.
- As a **student**, I want a donut of my AC problems by difficulty, so
  that I can tell if I'm stuck at easy or pushing into hard.
- As a **student**, I want a verdict distribution (AC / WA / TLE / MLE /
  RE / CE / queued) with AC% in the center, so that I can see where my
  non-AC attempts are going.
- As a **student**, I want the 10 most recent submissions listed with
  problem + verdict + timestamp, so that I can jump back into
  in-progress problems.

## Scope

### In scope

- Route `/dashboard` — auth-gated via `requireAuth(event)`,
  strictly actor-scoped.
- `getDashboardView(userId)` fan-out: stats + recent submissions +
  `analytics` (byDifficulty / byLanguage / byVerdict / byTag).
- `userDailyActivityRepo.findRange(userId, from, to)` — 30-day window
  with UTC-midnight boundaries.
- `UserDailyActivity` table: composite PK `(userId, date)`,
  `submissionCount` + `acCount` counters, UTC-midnight date bucket.
- Daily-activity writes: Temporal submission-judge activity
  `stats.updateUserStats(submission)` fires after every judged
  submission (both AC and non-AC).
- Top-N aggregation: `aggregateByTag` returns the top 8 by AC count,
  sorted descending, with stable ordering on ties.
- Charts: `ActivityHeatmap` (30-day cells), EChart donuts for
  difficulty and verdict, horizontal bar for tag proficiency.
- Empty state per chart
  (`hasHeatmapData` / `hasDifficultyData` / `hasVerdictData` /
  `hasTagData`) — replaces the chart with an `EmptyState` component.
- 15 paraglide keys under `dashboard_*` (en + zh-TW).

### Out of scope

- **Personalized recommendations**: no next-problem recommender today.
  Tag proficiency ranks owned tags, not suggests new problems.
- **Teacher / admin view of another user's dashboard**: no such route.
  Teachers use the course progress matrix (separate feature).
- **Date range picker**: the 30-day window is fixed; no UI to shift it
  or widen it.
- **Streak counter / "current streak: N days" callout**: the heatmap
  visualizes cells but does not compute streak length.
- **Achievements, levels, or badges**: not modeled.
- **Cross-course assignment list**: lives on `/assignments` (covered by
  `assignments.md`).
- **Team or org scoreboard contribution**: per-user only.
- **Timezone selection**: buckets are UTC-aligned and non-configurable.

## Acceptance Criteria

### Server load

- GIVEN an unauthenticated request to `/dashboard`,
  WHEN the load runs,
  THEN SvelteKit redirects to the sign-in flow via `requireAuth(event)`.
- GIVEN an authenticated request,
  WHEN the load runs,
  THEN `getDashboardView(actor.userId)` and
  `userDailyActivityRepo.findRange(userId, from, to)` resolve in
  parallel; the response carries `stats`, `recentSubmissions`,
  `analytics`, `dailyActivity`, `username`.
- GIVEN an actor with zero submissions,
  WHEN the load runs,
  THEN `stats.totalAc === 0`, `stats.totalAttempts === 0`,
  `recentSubmissions === []`, and every `analytics.*` array is empty.

### Activity heatmap

- GIVEN the actor submitted on 5 of the last 30 days,
  WHEN `findRange(userId, fromUtcMidnight, toUtcMidnight)` runs with a
  30-day window,
  THEN the DB returns 5 rows; the page fills the remaining 25 days with
  zero-count placeholders for rendering.
- GIVEN the current UTC date is D,
  WHEN the heatmap window is computed,
  THEN `from = D - 29 days` and `to = D`, both at UTC midnight,
  inclusive on both ends.
- GIVEN a submission at `23:59:59Z` on D and another at `00:00:01Z` on
  D+1,
  WHEN `updateUserStats` runs for each,
  THEN two distinct `UserDailyActivity` rows are upserted (one for D,
  one for D+1). Submissions near UTC midnight never merge.

### Stats and AC rate

- GIVEN 12 accepted distinct `(userId, problemId)` rows and 30 total
  submissions,
  WHEN the page renders the top stats block,
  THEN `totalAc = 12`, `totalAttempts = 30`, `acRate ≈ 40%`.
- GIVEN zero attempts,
  WHEN the AC rate is computed,
  THEN the display is a dash / fallback — never `NaN%`.

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
- **Submission rejudged from AC to WA**: `totalAc` reflects the
  up-to-date state because it's queried, not cached. However,
  `UserDailyActivity.acCount` for that day does not decrement — rejudge
  does NOT fire `updateUserStats` for the verdict flip. This is a known
  minor drift: correct values live on the `byVerdict` query; the
  heatmap's `acCount` is best-effort.
- **Timezone != UTC**: heatmap cells are UTC-aligned. Users outside UTC
  may see "today" as yesterday depending on local time. No override.
- **User deleted**: `UserDailyActivity.user` has `onDelete: Cascade` —
  daily rows drop with the user.
- **Zero tags on AC problems**: `aggregateByTag` returns `[]`; the bar
  chart renders its empty state.
- **Sample-only submissions**: `stats.totalAttempts` and
  `analytics.byVerdict` already exclude sample-only testcase runs.

## Implementation References

### Domain

- `packages/domain/src/user/queries.ts` — `getDashboardView`.
- `packages/domain/src/user/analytics-helpers.ts` — `aggregateByTag`
  (top-8 cut, stable sort).
- `packages/domain/src/user/stats.ts` — `updateUserStats` (called from
  the Temporal activity).

### Schema

- `packages/db/prisma/schema/submission.prisma` — `UserDailyActivity`
  (composite PK `(userId, date)`, `submissionCount`, `acCount`).
- `packages/db/src/repositories/user-daily-activity.ts` — `findRange`,
  `increment`.

### Temporal

- `packages/temporal/src/workflows/submission-judge.ts` — calls
  `stats.updateUserStats` after the verdict write.
- `packages/temporal/src/activities/stats.ts` — thin re-export of the
  domain function.

### Routes / API

- `apps/web/src/routes/(app)/dashboard/+page.server.ts` — server load.
- `apps/web/src/routes/(app)/dashboard/+page.svelte` — chart
  composition + empty states.
- `apps/web/src/lib/components/charts/ActivityHeatmap.svelte` — heatmap.
- `apps/web/src/lib/components/charts/EChart.svelte` — shared ECharts
  wrapper used by the donuts and bar chart.

### Tests

- **Gap**: no dedicated `dashboard*.test.ts`.
  `tests/unit/web/db-read-model.test.ts` covers a different
  `getDashboardStats()` (platform-wide counts), which is unrelated.
  Target coverage:
  - Domain: `getDashboardView` fan-out shape.
  - Domain: `aggregateByTag` top-8 cut + stable order on ties.
  - Integration: `updateUserStats` upsert across the UTC midnight
    boundary.
  - E2E: empty-state rendering for a brand-new user.

## Open Questions / TODO

- **Doc drift**: `PRODUCT_SENSE.md § User Dashboard` mentions
  "problem-solving recommendations" — not shipped. Either build the
  recommender or strike the bullet from PRODUCT_SENSE.md.
- **Rejudge drift**: rejudge does not fire `updateUserStats`, so
  `UserDailyActivity.acCount` silently drifts when rejudges overturn
  verdicts. Consider a delta-update on verdict-change in the rejudge
  path, or document the drift as intentional.
- **Timezone handling**: a per-user timezone setting (or client-side
  UTC→local conversion) would make the heatmap more meaningful for
  non-UTC users.
- **Date range**: users cannot see history beyond 30 days. A "view all
  time" or "month picker" would require extending
  `userDailyActivityRepo.findRange` usage and new UI.
- **Streak counter**: trivial to compute from `dailyActivity` on the
  client; would make the heatmap motivating rather than decorative.
