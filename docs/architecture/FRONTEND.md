# Frontend Surface

SvelteKit application with server-side rendering, client hydration, and file-based routing.

## Route Map

### (app) — Authenticated Routes

Layout at `(app)/+layout.server.ts` requires authentication; redirects to `/signin` if no session.

| Route                                                | Purpose                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`                                         | User stats, activity heatmap, streak / weekly-trend / suggested problems cards, language + difficulty distribution                              |
| `/problems`                                          | Problem listing with filters (difficulty, tags, status)                                                                                         |
| `/problems/[problemId]`                              | Problem workspace: Monaco editor, testcases, submit/run                                                                                         |
| `/problems/[problemId]/edit`                         | Problem editor (admin/teacher)                                                                                                                  |
| `/problems/[problemId]/editorials`                   | Editorial list for a problem (AC-gated visibility)                                                                                              |
| `/submissions`                                       | User submission history                                                                                                                         |
| `/submissions/[submissionId]`                        | Submission detail — verdict, subtask results, source                                                                                            |
| `/editorials/[id]/edit`                              | Editorial edit form (author or staff)                                                                                                           |
| `/contests`                                          | Contest listing, invite code join                                                                                                               |
| `/contests/new`                                      | Contest creation (any authenticated user)                                                                                                       |
| `/contests/[contestId]`                              | Contest detail. Manager view exposes sub-tabs: Overview / Submissions / Plagiarism / Clarifications / Audit / Settings                          |
| `/contests/[contestId]/problems/[problemId]`         | Contest problem workspace (post-end redirects to `/problems/[problemId]`)                                                                       |
| `/contests/[contestId]/scoreboard`                   | Scoreboard (ICPC/IOI). Polls every 30 s; reads frozen snapshot when the contest is in its freeze window                                         |
| `/contests/[contestId]/upsolve`                      | Post-contest upsolve index — per-problem solve status, links to practice (visible after the contest ends)                                       |
| `/contests/[contestId]/virtual`                      | Start / run a virtual contest — personal time-shifted replay of an ended contest                                                                |
| `/contests/[contestId]/virtual/problems/[problemId]` | In-virtual-contest problem workspace                                                                                                            |
| `/courses`                                           | Course listing (Enrolled / Managing tabs)                                                                                                       |
| `/courses/new`                                       | Course creation (admin/teacher)                                                                                                                 |
| `/courses/[courseId]`                                | Course home — overview, announcements, assignments/exams summary                                                                                |
| `/courses/[courseId]/settings`                       | Course settings + Copy course + archive (teacher/admin)                                                                                         |
| `/courses/[courseId]/members`                        | Member management (teacher/admin)                                                                                                               |
| `/courses/[courseId]/analytics`                      | Class analytics dashboard — completion, hardest problems, at-risk students, verdict distribution (course staff)                                 |
| `/courses/[courseId]/assignments`                    | Course-scoped assignment list                                                                                                                   |
| `/courses/[courseId]/assignments/new`                | Create assignment (teacher/admin)                                                                                                               |
| `/courses/[courseId]/exams`                          | Course-scoped exam list                                                                                                                         |
| `/courses/[courseId]/exams/new`                      | Create exam (teacher/admin)                                                                                                                     |
| `/assignments`                                       | Cross-course assignment list (All / Open / Upcoming / Closed tabs)                                                                              |
| `/assignments/[assignmentId]`                        | Assignment detail. Manager view exposes sub-tabs: Problems / Submissions / Results / Plagiarism / Audit / Settings / Clarifications             |
| `/assignments/[assignmentId]/problems/[problemId]`   | Assignment problem workspace (post-close redirects to bare practice)                                                                            |
| `/exams`                                             | Cross-course exam list (All / Running / Upcoming / Ended tabs)                                                                                  |
| `/exams/[examId]`                                    | Exam detail — start screen (student) or sub-tabs Problems / Submissions / Results / Plagiarism / Proctoring / Audit / Settings / Clarifications |
| `/exams/[examId]/problems/[problemId]`               | In-exam problem workspace (gated by active exam session)                                                                                        |
| `/plagiarism/pairs/[pairId]`                         | Pair-level Monaco diff for a flagged submission pair (assessment / exam / contest contexts; encoded composite id)                               |
| `/admin`                                             | Admin dashboard (platform admin only)                                                                                                           |
| `/admin/content/announcements`                       | Manage announcements                                                                                                                            |
| `/admin/content/editorial-reports`                   | Review reported editorials                                                                                                                      |
| `/admin/rejudges`                                    | Rejudge log (paged, filterable by problem) + stale-submission pending-timeout setting                                                           |
| `/admin/system/users`                                | User management (role assignment, disable)                                                                                                      |
| `/account`                                           | User account settings (display name, locale, avatar)                                                                                            |

### (auth) — Public Auth Routes

| Route               | Purpose                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/signin`           | Sign in — GitHub / Google OAuth only (general users do not use password sign-in)                                 |
| `/admin-signin`     | Password sign in. Reserved for admin and the seeded test accounts; rate-limited 5 attempts / 15 min per IP       |
| `/complete-profile` | Onboarding: username, email verification                                                                         |
| `/verify-school`    | School-email verification flow (parses the email domain, attaches a school + student-id placeholder if eligible) |

### Public Static Routes

| Route            | Purpose                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `/about`         | Project description, links, contributor names                    |
| `/legal/privacy` | Privacy policy                                                   |
| `/legal/terms`   | Terms of service                                                 |
| `/docs`          | Scalar API reference page for the public OpenAPI document        |
| `/docs/internal` | Scalar API reference page for the internal (maintainer) document |

### API Routes

| Endpoint                                                      | Methods            | Purpose                                                                                        |
| ------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `/api/auth/[...path]`                                         | GET, POST          | better-auth catch-all (session, OAuth, registration). POST sign-in/email/username rate-limited |
| `/api/healthz`                                                | GET                | Public liveness probe. Returns `{ ok }` with HTTP 200 or 503                                   |
| `/api/admin/healthz`                                          | GET                | Admin-only mirror returning per-subsystem `{ postgres, redis, temporal }` detail               |
| `/api/openapi.public.json`                                    | GET                | Public OpenAPI 3.1 document (documentation-only; describes existing routes)                    |
| `/api/openapi.internal.json`                                  | GET                | Internal OpenAPI 3.1 document (broader maintainer surface, not a compatibility contract)       |
| `/api/submissions`                                            | POST               | Create submission, dispatch to Temporal                                                        |
| `/api/submissions/[id]`                                       | GET                | Submission result and verdict                                                                  |
| `/api/submissions/[id]/source`                                | GET                | Submission source code                                                                         |
| `/api/submissions/[id]/stream`                                | GET                | SSE: poll Temporal workflow query for status                                                   |
| `/api/submissions/[id]/rejudge`                               | POST               | Rejudge a single submission (admin/teacher)                                                    |
| `/api/rejudges`                                               | POST               | Batch rejudge by problem/context filters                                                       |
| `/api/rejudges/[workflowId]`                                  | GET                | Rejudge progress `{ completed, total }` (Temporal `getProgress` query) for the progress bar    |
| `/api/rejudges/[workflowId]/cancel`                           | POST               | Cancel an in-flight batch rejudge (cancels the parent workflow)                                |
| `/api/events/stream`                                          | GET                | SSE: real-time events (verdicts, contest, deadlines, clarifications, notifications)            |
| `/api/contests/[id]/scoreboard`                               | GET                | Scoreboard data from Redis (or DB rebuild fallback)                                            |
| `/api/contests/[id]/scoreboard/chart`                         | GET                | Scoreboard chart data                                                                          |
| `/api/exam-sessions/[examId]/heartbeat`                       | POST               | Record page-lock heartbeat / visibility events                                                 |
| `/api/plagiarism/[assignmentId]/reports`                      | GET, POST          | List plagiarism reports (GET) / trigger detection (POST)                                       |
| `/api/plagiarism/[assignmentId]/sources/[userId]/[problemId]` | GET                | Fetch a participant's submission source for a flagged pair                                     |
| `/api/plagiarism-flags`                                       | POST               | Flag a plagiarism pair (admin/teacher)                                                         |
| `/api/plagiarism-flags/[id]`                                  | DELETE             | Remove a plagiarism flag                                                                       |
| `/api/problems`                                               | POST               | Create problem (email-verified users)                                                          |
| `/api/problems/[id]`                                          | DELETE             | Delete a problem (owner / staff)                                                               |
| `/api/problems/advanced-scaffold`                             | GET                | Stream the advanced-mode starter project zip                                                   |
| `/api/problems/[id]/bookmark`                                 | POST               | Toggle the practice-list bookmark for a problem                                                |
| `/api/problems/[id]/bundle`                                   | GET, POST          | Download / upload the problem testcase + workspace bundle (zip)                                |
| `/api/problems/[id]/checker`                                  | POST               | Upload the checker (DOMjudge validator) script                                                 |
| `/api/problems/[id]/interactor`                               | POST               | Upload the interactor script                                                                   |
| `/api/problems/[id]/workspace/files`                          | POST               | Upload / replace a workspace file                                                              |
| `/api/problems/[id]/storage-usage`                            | GET                | Per-problem object-storage usage                                                               |
| `/api/problems/[id]/editorials`                               | GET, POST          | Problem editorials (AC-gated)                                                                  |
| `/api/problems/[id]/images`                                   | POST               | Upload problem image (magic-number validated)                                                  |
| `/api/problems/[id]/advanced-image`                           | POST               | Upload advanced-mode judge image tarball                                                       |
| `/api/uploads/image`                                          | POST               | Generic image upload (announcements, editorials)                                               |
| `/api/account/avatar`                                         | PUT, DELETE        | Replace / remove account avatar                                                                |
| `/api/notifications`                                          | GET, PATCH, DELETE | List + bulk mark-read (`{action:"markAllRead"}`) + bulk clear-read (`?status=read`)            |
| `/api/notifications/[id]`                                     | PATCH, DELETE      | Mark one notification read (body: `{read:true}`) / drop one                                    |
| `/api/notifications/unread-count`                             | GET                | Unread notification count                                                                      |
| `/api/clarifications`                                         | GET, POST          | Clarifications list / new                                                                      |
| `/api/clarifications/[id]`                                    | PATCH              | Answer or dismiss a clarification                                                              |
| `/api/clarifications/[id]/replies`                            | POST               | Canned-reply / templated answer                                                                |
| `/api/editorials/[id]`                                        | PATCH, DELETE      | Edit / soft-delete editorial                                                                   |
| `/api/editorials/[id]/votes`                                  | POST               | Cast / change an up-or-down vote on an editorial                                               |
| `/api/editorials/[id]/reports`                                | POST               | File a report against an editorial (feeds the admin moderation queue)                          |
| `/api/overrides`                                              | GET, POST          | List / create score overrides (writes gated post-close, admin bypass)                          |
| `/api/overrides/[id]`                                         | PATCH, DELETE      | Update / remove score override (writes gated post-close, admin bypass)                         |
| `/api/feedback`                                               | GET, PUT           | List / upsert per-cell grading feedback (assignment + exam; writes gated post-close)           |
| `/api/feedback/[id]`                                          | DELETE             | Delete a feedback row (writes gated post-close)                                                |
| `/api/exams/[examId]/ip-violations`                           | GET                | IP violation logs (manager/admin). Surfaced in the Exam → Proctoring sub-tab                   |

## Runtime Boundaries

### Server-Side (`+page.server.ts`, `+server.ts`)

- **Auth**: `requireAuth(event)` for pages, `requireApiAuth(event)` for APIs
- **Roles**: `requirePlatformRole(actor, ...roles)` for admin/teacher gates
- **Course access**: `isCourseStaff(role)`, `resolveEffectiveCourseRole(platformRole, courseRole)`
- **Database**: Repositories exported from `@nojv/db`. Domain layer is the default path; routes that read structural data (e.g. announcement listings, layout loaders) may import repositories directly
- **Job dispatch**: Temporal via `@nojv/temporal` root entry, typically re-exported through `@nojv/domain` (`dispatchSubmissionJudge`, `dispatchPlagiarismCheck`, etc.). Workflow queries via `querySubmissionStatus` / `queryRejudgeProgress` / `queryPlagiarismStatus`
- **Redis**: Pub/sub and rate-limiter Redis access via `@nojv/redis` (`getRedis`, `createSubscriber`, key registry)
- **Rate limits**: `apiHandler` / `writeApiHandler` wrap read / write routes; form actions compose through `withRateLimit` in `action-handlers.ts` (which calls the internal `consumeFormRateLimitInternal(event)`); `signInRateLimiter` enforced from `hooks.server.ts` on password sign-in routes. All key on `getClientIp(event)` (Cloudflare-aware)
- **CSRF**: `hooks.server.ts` rejects `/api/**` non-GET requests without `X-Requested-With: fetch` (better-auth path exempt). Same-origin Origin header also enforced

### Client-Side (`+page.svelte`)

- **State**: Svelte stores for toast notifications, SSE client
- **Editor**: Monaco Editor for code submission (`Editor.svelte` / `MonacoScriptEditor.svelte`); advanced-mode workspaces use `AdvancedModeWorkspace.svelte` plus the `features/problem/workspace/` set
- **Markdown**: marked + marked-katex-extension for problem statements; rendered through DOMPurify with a KaTeX-aware allowlist
- **Forms**: sveltekit-superforms + Zod for validated form handling
- **Image upload**: `ImageDropZone` component — drag-and-drop / paste images into markdown textareas
- **Charts**: ECharts for dashboard statistics
- **SSE**: EventSource for real-time submission status and contest events

## Shared UI Contracts

- `ProblemWorkspace.svelte` owns the problem-solving surface: split-pane layout with problem statement (left) and Monaco code editor (right), resizable divider, submission panel, and testcase results.
- `MarkdownRenderer` renders problem statements, editorials, and input/output format descriptions using `marked` + KaTeX + DOMPurify.
- `ImageDropZone` wraps textareas with drag-and-drop and paste image upload support. Used in problem editor for statement, inputFormat, and outputFormat fields.
- `TagInput` provides tag management with add/remove for problem categorization.
- `Editor.svelte` / `MonacoScriptEditor.svelte` wrap the Monaco editor instance with language selection, theme support, and template loading.
- `MatrixView` is shared between contests, assignments, and exams — one component, three contexts, identical cells (`{score, attempts, state}`).
- `ExamProctoringTab` reads the IP violation log per exam — staff-only.
- `PlagiarismPairDiff` renders the Monaco diff for a flagged submission pair; the page itself lives at `/plagiarism/pairs/[pairId]`.
- `ScoreOverrideDrawer` is the manager grading surface on the submissions matrix; hosts `ScoreOverrideList` / `ScoreOverrideForm` plus `FeedbackList` / `FeedbackForm` (feedback section omitted in contest context). Entry button is hidden until the context closes.
- `AuditTimeline` renders the merged audit log feed (lifecycle + score override + rejudge) on the Audit tab of the assignment / exam / contest manage pages — staff-only.
- `WelcomeGuide` replaces the dashboard chart blocks for accounts with zero submissions.
- `Skeleton` primitives (`SkeletonCard` / `SkeletonText` / `SkeletonStat` / `SkeletonList` / `SkeletonTable`) cover loading states; consumed by the grading drawer on open and by the dashboard's `{#await data.streamed.*}` deferred panels (`getSubmissionActivity` / `getSuggestedProblems`).
- `formatDateTime` / `formatDate` / `formatTime` (`$lib/utils/datetime.ts`) bind `Intl.DateTimeFormat` to the active Paraglide `getLocale()` — use these instead of bare `toLocale*` calls so the rendered string matches the user's UI language.
- Form validation uses `sveltekit-superforms` with Zod schemas from `@nojv/core`. Error messages are displayed inline with i18n support.
- Status badges, difficulty labels, and verdict chips use consistent color coding across all surfaces.
- ECharts powers the dashboard statistics: activity heatmap, language distribution, difficulty breakdown.

## Internationalization

- Locales: `en` (`baseLocale`, default), `zh-TW`. Unprefixed routes serve `en`; only `/zh-TW` is URL-prefixed
- Problem statements: per-locale in `ProblemStatementI18n` table
- UI strings: Inlang Paraglide JS with message files in `apps/web/messages/{en,zh-TW}.json` (compiled into `apps/web/src/lib/paraglide/`)
- User locale preference stored in `User.locale`
- Note: `/admin/+page.svelte` carries a small hand-rolled EN/ZH dictionary instead of using paraglide. Tracked as known drift — fold into paraglide if the admin landing grows past a couple of strings

## Real-Time Events

- **Transport**: Server-Sent Events (SSE) via `/api/events/stream`
- **Broker**: Redis pub/sub via `@nojv/redis`
- **Channels**: `user:{userId}`, `notification:{userId}`, `contest:{contestId}`, `assessment:{assessmentId}`, `clarification:{contextType}:{contextId}` — see [Redis Architecture](REDIS.md)
- **Events**: submission verdict, contest starting/ending, assignment deadline, notifications, clarification updates
- **Submission polling**: Temporal `workflow.query("getStatus")` with DB fallback

## Accessibility

Component-level a11y is built on accessible primitives plus explicit ARIA on
the hand-rolled controls. Evidence by surface:

| Concern                        | Pattern (where)                                                                                                                                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessible primitives          | 21 components build on **Bits UI** (`bits-ui`) — dialogs (`role="dialog"`, `aria-modal`), tabs (`role="tab"`/`"tablist"`, `aria-selected`, `aria-orientation`), selects (`aria-expanded`/`aria-controls`/`aria-haspopup`), giving focus trap + keyboard nav for free.             |
| Form validation                | Inputs/buttons/select-triggers carry `aria-invalid` (`primitives/ui/{input,button,select}`); the error `<p>` is linked via `aria-describedby` and announced with `role="alert"` (e.g. `AssignmentBasicSection`, `ExamBasicSettings`, `ContestSettingsTab`, `SchoolVerification`). |
| Toggle / current state         | `aria-pressed` on toggles (language switch in `Header`), `aria-current` on active nav, `aria-checked`/`aria-disabled` where relevant.                                                                                                                                             |
| Async status (live region)     | `aria-live` + `aria-atomic` announce toasts and judge status without focus change; `aria-busy` marks in-flight controls.                                                                                                                                                          |
| Icon-only controls             | `aria-label` names icon buttons; decorative icons are `aria-hidden` so they don't pollute the accessibility tree.                                                                                                                                                                 |
| Color is never the sole signal | Verdicts pair color with text/short codes (`VerdictBadge`, `CaseResultGrid`) so colour-blind users still distinguish AC/WA/TLE/…                                                                                                                                                  |

Bare (non-Bits) `<input>` controls are flagged by `svelte-check`'s a11y lint, so
missing labels/roles fail `pnpm check` rather than shipping silently.

## Related Docs

- [Design Rules](./DESIGN.md)
- [Product Sense](../product/PRODUCT_SENSE.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [Security Requirements](../operations/SECURITY.md)
