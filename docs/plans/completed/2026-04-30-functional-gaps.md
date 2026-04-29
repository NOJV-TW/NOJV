# Functional Gaps Sweep (2026-04-30)

## Why

Audit on 2026-04-30 surfaced user-facing functional gaps after the
production-readiness pass. Code-quality work has converged; remaining
debt is product-shaped. This plan sweeps the agreed batch.

## Decisions taken before plan

- **(1) Password reset** — dropped. Project is third-party-login only;
  PRODUCT_SENSE.md auth section already updated to reflect this.
- **(4) Bulk operations** — dropped. Bulk-release sessions, bulk
  user/problem import, submission zip export — none have a real user
  request behind them.

## Scope

### Phase 1 — Page Layout sweep tail

Finish the four areas the active page-layout plan deferred. No new
archetype — reuse `<PageHeader>` (Index) and `<PageHero variant="hub" |
"workspace">`.

| Path                                       | Archetype | Action                                                                    |
| ------------------------------------------ | --------- | ------------------------------------------------------------------------- |
| `/contests` (`+page.svelte`)               | Index     | swap header → `<PageHeader>`                                              |
| `/contests/[slug]` (`+page.svelte`)        | Workspace | hand-rolled hero → `<PageHero variant="workspace">` + `ribbon` for status |
| `/dashboard` (`+page.svelte`)              | Index     | swap header → `<PageHeader>`                                              |
| `/admin` + sub-routes                      | Index     | swap each header block → `<PageHeader>`                                   |
| `/courses/[slug]/manage/*`                 | Workspace | swap hand-rolled hero → `<PageHero variant="workspace">`                  |
| `/(app)/+layout.svelte` horizontal padding | n/a       | already centralized in earlier phase — verify no `px-6` survives          |

### Phase 2 — Editorial CRUD + list page

Today: only `POST /api/editorials` and read via problem detail page.
Add edit + delete + browse list. Voting / comments deliberately out.

- Routes:
  - `/(app)/problems/[id]/editorials` — list page (AC-gated, same as read).
  - `/(app)/editorials/[id]/edit` — edit page (author + admin only).
- API:
  - `PUT /api/editorials/[id]` — update body / language.
  - `DELETE /api/editorials/[id]` — soft delete (mark `deletedAt`).
- Domain:
  - Add `updateEditorial(actor, id, input)` and `deleteEditorial(actor,
id)` in `packages/domain/src/editorial/mutations.ts`.
  - Permission: `actor.userId === editorial.authorId || actor.platformRole === 'admin'`.
- Schema:
  - Add nullable `deletedAt` column to `Editorial`. Filter
    `deletedAt IS NULL` in all reads.

### Phase 3 — Mobile sweep + workspace blocker

Phones can browse the site but cannot solve problems. Concrete
behavior:

- **Allowed on `< md`:** list pages, problem detail (statement),
  scoreboards, submission lists, editorials, dashboard, course detail,
  exam detail (status only), assignment detail (status only).
- **Blocked on `< md`:** the workspace pages — Monaco editor +
  submission form. Affected routes:
  - `/(app)/problems/[id]` workspace tab (when active)
  - `/(app)/contests/[slug]/problems/[problemId]`
  - `/(app)/exams/[examId]/problems/[problemId]`
  - `/(app)/assignments/[assessmentId]/problems/[problemId]`
- Block UX: render `<MobileWorkspaceBlocker>` component below the
  problem statement. Statement remains readable; editor + submit form
  hidden. Component shows "請使用桌面版瀏覽器作答" + button to open the
  problem statement in fullscreen reading mode.
- Implementation: pure CSS `hidden md:block` on the workspace section
  - visible blocker. No JS-side route guard needed.
- Sweep pass: every `(app)` page must work at `sm` width — fix any
  overflow / clipping / unreadable nav. Manual smoke test list at
  bottom of plan.

### Phase 4 — Plagiarism side-by-side diff + false-positive flags

Today: results are flat list of pairs. Add inspection + curation.

- Migration: new model `PlagiarismPairFlag`:
  ```prisma
  model PlagiarismPairFlag {
    id              String           @id @default(cuid())
    contextType     PlagiarismContext  // assessment | exam | contest
    contextId       String
    pairKey         String           // sorted "userA|userB|problemId"
    flaggedBy       String           // userId
    flaggedAt       DateTime         @default(now())
    note            String?
    @@unique([contextType, contextId, pairKey])
    @@index([contextType, contextId])
  }
  ```
- Routes:
  - `/(app)/courses/[slug]/manage/plagiarism/[assessmentSlug]/pairs/[pairId]`
    — Monaco diff editor side-by-side, two source files.
  - Optionally same shape for exam + contest plagiarism reports.
- API:
  - `POST /api/plagiarism/flag` — flag a pair as false positive.
  - `DELETE /api/plagiarism/flag/[id]` — un-flag.
- List page: filter out flagged pairs by default; toggle "顯示已標記"
  to include them.
- Domain: `flagPair(actor, contextType, contextId, pairKey, note)` +
  `unflagPair(actor, flagId)`. Permission: course staff / contest
  organizer / admin.

### Phase 5 — Dashboard widgets

Add three widgets to `/dashboard`:

- **Streak card** — consecutive days with `UserDailyActivity.acCount > 0`.
  Computed from existing table; no new column.
- **Last 7 days submission trend** — line chart of `submissionCount`
  per day. Reuse existing chart components.
- **Suggested problems** — top 5 unsolved problems whose tag set
  overlaps with the user's most-frequently-solved tags. Pure query
  over existing tables.

Implementation:

- `packages/domain/src/user/analytics.ts` — add `getStreakDays(userId)`
  and `getSuggestedProblems(userId, limit = 5)`.
- `apps/web/src/routes/(app)/dashboard/+page.server.ts` — call new
  helpers in parallel `Promise.all` with existing loaders.
- `apps/web/src/lib/components/dashboard/` — `StreakCard.svelte`,
  `WeeklyTrendCard.svelte`, `SuggestedProblemsCard.svelte`.

## Phases / sequencing

1. Phase 0 (done): doc updates.
2. **Wave A — parallel worktree agents** (no shared file conflicts
   except where noted):
   - Phase 1 (Page Layout sweep)
   - Phase 2 (Editorial CRUD)
   - Phase 3 (Mobile blocker)
   - Phase 4 (Plagiarism diff + flag)
3. **Wave B — after Wave A merges:**
   - Phase 5 (Dashboard widgets) — depends on Phase 1's `<PageHeader>`
     sweep already touching `dashboard/+page.svelte`. Run after.

## Verification

Each phase's worktree must pass:

- `pnpm -w typecheck` — 17/17 green
- `pnpm lint` — 18/18 green
- `pnpm -w format` — clean
- `pnpm test:unit` — no regressions; new tests for new domain helpers
- For Phase 4: `pnpm db:generate` after migration

## Non-goals

- No editorial upvote / comments.
- No mobile editor support — explicit non-goal.
- No bulk operations.
- No password reset flow.
- No new design tokens / colors.

## Risks

- Phase 1 + Phase 5 both edit `dashboard/+page.svelte`. Wave-B
  serialization avoids conflict.
- Phase 4 migration is the only schema change in this batch — agent
  must regenerate Prisma client and ship typecheck-green.
- Mobile blocker on contest/exam workspace routes must NOT bypass IP
  / page-lock gating — blocker is purely visual; server-side checks
  unchanged.
