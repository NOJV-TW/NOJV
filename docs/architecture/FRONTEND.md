# Frontend Surface

SvelteKit application with server-side rendering, client hydration, and file-based routing.

## Route Map

### (app) — Authenticated Routes

Layout at `(app)/+layout.server.ts` requires authentication; redirects to `/signin` if no session.

| Route                                                | Purpose                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`                                         | User stats, activity heatmap, streak / weekly-trend / suggested problems cards, language + difficulty distribution                                                                                                                                                                                          |
| `/problems`                                          | Problem listing with filters (difficulty, tags, status)                                                                                                                                                                                                                                                     |
| `/problems/[problemId]`                              | Problem workspace: Monaco editor, testcases, submit/run. Left panel tabs include Editorials (AC-gated; author/admin exempt) and Discussions (any signed-in user; both blocked during active exams/contests) — list, article with votes/reports/two-level comments, and compose all live inside the panel    |
| `/problems/[problemId]/edit`                         | Problem editor (admin/teacher)                                                                                                                                                                                                                                                                              |
| `/submissions`                                       | User submission history                                                                                                                                                                                                                                                                                     |
| `/submissions/[submissionId]`                        | Submission detail — verdict, subtask results, source                                                                                                                                                                                                                                                        |
| `/contests`                                          | Contest listing, invite code join                                                                                                                                                                                                                                                                           |
| `/contests/new`                                      | Contest creation (any authenticated user)                                                                                                                                                                                                                                                                   |
| `/contests/[contestId]`                              | Contest detail. Student view shows **Join** (allowed before and during the contest) until joined, then **Enter**; joining registers a participant. Manager view exposes sub-tabs: Overview / Submissions / Plagiarism / Clarifications / Audit / Settings                                                   |
| `/contests/[contestId]/problems/[problemId]`         | Contest problem workspace. Requires prior join — non-participants redirect to `/contests/[contestId]` (managers auto-joined); post-end redirects to `/problems/[problemId]`                                                                                                                                 |
| `/contests/[contestId]/scoreboard`                   | Scoreboard (ICPC/IOI). Polls every 30 s; reads frozen snapshot when the contest is in its freeze window                                                                                                                                                                                                     |
| `/contests/[contestId]/upsolve`                      | Post-contest upsolve index — per-problem solve status, links to practice (visible after the contest ends)                                                                                                                                                                                                   |
| `/contests/[contestId]/virtual`                      | Start / run a virtual contest — personal time-shifted replay of an ended contest                                                                                                                                                                                                                            |
| `/contests/[contestId]/virtual/problems/[problemId]` | In-virtual-contest problem workspace                                                                                                                                                                                                                                                                        |
| `/courses`                                           | Course listing (Enrolled / Managing tabs)                                                                                                                                                                                                                                                                   |
| `/courses/new`                                       | Course creation (admin/teacher)                                                                                                                                                                                                                                                                             |
| `/courses/[courseId]`                                | Course home — overview, announcements, assignments/exams summary                                                                                                                                                                                                                                            |
| `/courses/[courseId]/settings`                       | Course settings + Copy course + archive (teacher/admin)                                                                                                                                                                                                                                                     |
| `/courses/[courseId]/members`                        | Member management (teacher/admin)                                                                                                                                                                                                                                                                           |
| `/courses/[courseId]/analytics`                      | Class analytics dashboard — completion, hardest problems, at-risk students, verdict distribution (course staff)                                                                                                                                                                                             |
| `/courses/[courseId]/grades`                         | Course gradebook — per-problem raw best scores across all published assignments and exams; staff see every student + CSV export, students see only their own row                                                                                                                                            |
| `/courses/[courseId]/assignments`                    | Course-scoped assignment list                                                                                                                                                                                                                                                                               |
| `/courses/[courseId]/assignments/new`                | Create assignment (teacher/admin)                                                                                                                                                                                                                                                                           |
| `/courses/[courseId]/exams`                          | Course-scoped exam list                                                                                                                                                                                                                                                                                     |
| `/courses/[courseId]/exams/new`                      | Create exam (teacher/admin)                                                                                                                                                                                                                                                                                 |
| `/assignments`                                       | Cross-course assignment list (All / Open / Upcoming / Closed tabs)                                                                                                                                                                                                                                          |
| `/assignments/[assignmentId]`                        | Assignment detail. Manager view exposes sub-tabs: Problems / Submissions / Results / Plagiarism / Audit / Settings / Clarifications                                                                                                                                                                         |
| `/assignments/[assignmentId]/problems/[problemId]`   | Assignment problem workspace (post-close redirects to bare practice)                                                                                                                                                                                                                                        |
| `/exams`                                             | Cross-course exam list (All / Running / Upcoming / Ended tabs)                                                                                                                                                                                                                                              |
| `/exams/[examId]`                                    | Exam detail. Student: **Start exam** creates a per-student `ActiveExamSession`; once the session is live (`hasActiveSession`) the page shows an assignment-style problem list. Manager view exposes sub-tabs Problems / Submissions / Results / Plagiarism / Proctoring / Audit / Settings / Clarifications |
| `/exams/[examId]/problems/[problemId]`               | In-exam problem workspace (gated by active exam session)                                                                                                                                                                                                                                                    |
| `/plagiarism/pairs/[pairId]`                         | Pair-level Monaco diff for a flagged submission pair (assessment / exam / contest contexts; encoded composite id)                                                                                                                                                                                           |
| `/admin`                                             | Admin dashboard (platform admin only)                                                                                                                                                                                                                                                                       |
| `/admin/announcements`                               | Manage announcements                                                                                                                                                                                                                                                                                        |
| `/admin/reports`                                     | Review reported posts and comments                                                                                                                                                                                                                                                                          |
| `/admin/submissions`                                 | Platform-wide submission view (paged, filterable)                                                                                                                                                                                                                                                           |
| `/admin/audit`                                       | Admin action audit log                                                                                                                                                                                                                                                                                      |
| `/admin/users`                                       | User management (role assignment, disable, delete)                                                                                                                                                                                                                                                          |
| `/settings`                                          | User settings — email, security (password / 2FA / passkey), school verification, sign-in connections, notification preferences, tour replay. `/account` 301-redirects here; profile fields (avatar, name, username, role) are edited on `/users/[id]`                                                       |

### (auth) — Public Auth Routes

| Route               | Purpose                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/signin`           | Sign in — GitHub / Google OAuth only (general users do not use password sign-in)                                 |
| `/admin-signin`     | Password sign in. Reserved for admin and the seeded test accounts; rate-limited 5 attempts / 15 min per IP       |
| `/complete-profile` | Onboarding: username, email verification                                                                         |
| `/verify-school`    | School-email verification flow (parses the email domain, attaches a school + student-id placeholder if eligible) |

### Public Routes

| Route                   | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/about`                | Project description, links, contributor names                                                                                                                                                                                                                                                                                                                                                                                              |
| `/users/[id]`           | Public user profile — activity heatmap, difficulty/language distributions, solved public problems. Opt-in via the owner-only visibility toggle on the page itself (`User.profilePublic`, default off), alongside a share (copy link) button; private profiles 404 for everyone except the owner and admins. UserMenu links here. Owners also edit their avatar, display name, username, and see their platform role here (owner-only card) |
| `/legal/privacy`        | Privacy policy                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/legal/terms`          | Terms of service                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/docs`                 | Scalar API reference page for the public OpenAPI document                                                                                                                                                                                                                                                                                                                                                                                  |
| `/docs/internal`        | Scalar API reference page for the internal (maintainer) document                                                                                                                                                                                                                                                                                                                                                                           |
| `/guides/advanced-mode` | Advanced Mode authoring guide for instructors (image-ref workflow)                                                                                                                                                                                                                                                                                                                                                                         |

### API Routes

| Endpoint                                                      | Methods            | Purpose                                                                                        |
| ------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `/api/auth/[...path]`                                         | GET, POST          | better-auth catch-all (session, OAuth, registration). POST sign-in/email/username rate-limited |
| `/api/livez`                                                  | GET                | Dependency-free process probe. Always returns `{ alive: true }` while HTTP can be served       |
| `/api/readyz`                                                 | GET                | Traffic-readiness probe. Returns only `{ ready }`; PostgreSQL + Redis gate the status          |
| `/api/admin/healthz`                                          | GET                | Admin-only mirror returning per-subsystem `{ postgres, redis, temporal }` detail               |
| `/api/openapi.public.json`                                    | GET                | Public OpenAPI 3.1 document (documentation-only; describes existing routes)                    |
| `/api/openapi.internal.json`                                  | GET                | Internal OpenAPI 3.1 document (broader maintainer surface, not a compatibility contract)       |
| `/api/submissions`                                            | POST               | Create submission, dispatch to Temporal                                                        |
| `/api/submissions/[id]`                                       | GET                | Submission result and verdict                                                                  |
| `/api/submissions/[id]/source`                                | GET                | Submission source code                                                                         |
| `/api/submissions/[id]/rejudge`                               | POST               | Rejudge a single submission (admin/teacher)                                                    |
| `/api/rejudges`                                               | POST               | Batch rejudge by problem/context filters                                                       |
| `/api/rejudges/[workflowId]`                                  | GET                | Rejudge progress `{ completed, total }` (Temporal `getProgress` query) for the progress bar    |
| `/api/rejudges/[workflowId]/cancel`                           | POST               | Cancel an in-flight batch rejudge (cancels the parent workflow)                                |
| `/api/events/stream`                                          | GET                | SSE: real-time events (verdicts, contest, deadlines, clarifications, notifications)            |
| `/api/contests/[id]/scoreboard`                               | GET                | Scoreboard data (computed on read from Postgres via `buildScoreboard`)                         |
| `/api/contests/[id]/scoreboard/chart`                         | GET                | Scoreboard chart data                                                                          |
| `/api/plagiarism/[assignmentId]/reports`                      | GET, POST          | List plagiarism reports (GET) / trigger detection (POST)                                       |
| `/api/plagiarism/[assignmentId]/sources/[userId]/[problemId]` | GET                | Fetch a participant's submission source for a flagged pair                                     |
| `/api/plagiarism-flags`                                       | POST               | Flag a plagiarism pair (admin/teacher)                                                         |
| `/api/plagiarism-flags/[id]`                                  | DELETE             | Remove a plagiarism flag                                                                       |
| `/api/problems`                                               | POST               | Create problem (email-verified users)                                                          |
| `/api/problems/[id]`                                          | DELETE             | Delete a problem (owner / staff)                                                               |
| `/api/problems/advanced-scaffold`                             | GET                | Download the special_env starter templates (run / grade / service images + README)             |
| `/api/problems/[id]/bookmark`                                 | POST               | Toggle the practice-list bookmark for a problem                                                |
| `/api/problems/[id]/bundle`                                   | GET, POST          | Download / upload the problem testcase + workspace bundle (zip)                                |
| `/api/problems/[id]/checker`                                  | POST               | Upload the checker (DOMjudge validator) script                                                 |
| `/api/problems/[id]/interactor`                               | POST               | Upload the interactor script                                                                   |
| `/api/problems/[id]/workspace/files`                          | POST               | Upload / replace a workspace file                                                              |
| `/api/problems/[id]/storage-usage`                            | GET                | Per-problem object-storage usage                                                               |
| `/api/problems/[id]/posts`                                    | GET, POST          | Problem posts, `?type=editorial\|discussion` (editorial view AC-gated; blocked during exams)   |
| `/api/problems/[id]/images`                                   | POST               | Upload problem image (magic-number validated)                                                  |
| `/api/images/proxy`                                           | GET                | Fetch/cache a third-party Markdown image without exposing the viewer to its host               |
| `/api/uploads/image`                                          | POST               | Generic image upload (announcements, problem posts)                                            |
| `/api/account/avatar`                                         | PUT, DELETE        | Replace / remove account avatar                                                                |
| `/api/notifications`                                          | GET, PATCH, DELETE | List + bulk mark-read (`{action:"markAllRead"}`) + bulk clear-read (`?status=read`)            |
| `/api/notifications/[id]`                                     | PATCH, DELETE      | Mark one notification read (body: `{read:true}`) / drop one                                    |
| `/api/notifications/unread-count`                             | GET                | Unread notification count                                                                      |
| `/api/clarifications`                                         | GET, POST          | Clarifications list / new                                                                      |
| `/api/clarifications/[id]`                                    | PATCH              | Answer or dismiss a clarification                                                              |
| `/api/clarifications/[id]/replies`                            | POST               | Canned-reply / templated answer                                                                |
| `/api/posts/[id]`                                             | GET, PATCH, DELETE | Read / edit / soft-delete a post (author or admin for writes)                                  |
| `/api/posts/[id]/votes`                                       | POST               | Cast / change an up-or-down vote on a post                                                     |
| `/api/posts/[id]/comments`                                    | GET, POST          | List / add comments on a post (one-level replies)                                              |
| `/api/posts/[id]/reports`                                     | POST               | File a report against a post (feeds the admin moderation queue)                                |
| `/api/comments/[id]`                                          | DELETE             | Soft-delete a comment (author or admin)                                                        |
| `/api/comments/[id]/reports`                                  | POST               | File a report against a comment (feeds the admin moderation queue)                             |
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
- **Job dispatch**: routes call `@nojv/application` orchestration functions (`dispatchSubmissionJudge`, `dispatchPlagiarismCheck`, etc.). `apps/web/src/lib/server/domain-orchestration.ts` wires those functions to the `@nojv/temporal` root dispatch/query helpers at process startup; route handlers should not import raw Temporal helpers directly
- **Redis**: Pub/sub and rate-limiter Redis access via `@nojv/redis` (`getRedis`, `createSubscriber`, key registry)
- **Rate limits**: `apiHandler` / `writeApiHandler` wrap read / write routes; form actions compose through `withRateLimit` in `action-handlers.ts` (which calls the internal `consumeFormRateLimitInternal(event)`); `signInRateLimiter` enforced from `hooks.server.ts` on password sign-in routes. All key on `getClientIp(event)` (Cloudflare-aware)
- **CSRF**: `hooks.server.ts` rejects `/api/**` non-GET requests without `X-Requested-With: fetch` (better-auth path exempt). Same-origin Origin header also enforced

### Client-Side (`+page.svelte`)

- **State**: Svelte stores for toast notifications, SSE client
- **Editor**: Monaco Editor for code submission (`Editor.svelte` / `MonacoScriptEditor.svelte`); advanced-mode workspaces use `AdvancedModeWorkspace.svelte` plus the `features/problem/workspace/` set
- **Markdown**: marked + marked-katex-extension for problem statements; rendered through DOMPurify with a KaTeX-aware allowlist and same-origin rewriting for remote images
- **Forms**: sveltekit-superforms + Zod for validated form handling
- **Image upload**: `ImageDropZone` component — drag-and-drop / paste images into markdown textareas
- **Charts**: ECharts for dashboard statistics
- **SSE**: EventSource for real-time submission status and contest events

## Shared UI Contracts

- `ProblemWorkspace.svelte` owns the problem-solving surface: split-pane layout with problem statement (left) and Monaco code editor (right), resizable divider, submission panel, and testcase results.
- `MarkdownRenderer` renders problem statements, problem posts, and input/output format descriptions using `marked` + KaTeX + DOMPurify. Remote HTTPS image sources are rewritten at render time to `/api/images/proxy`; existing stored Markdown does not change.
- `ImageDropZone` wraps textareas with drag-and-drop and paste image upload support. Used in problem editor for statement, inputFormat, and outputFormat fields.
- `TagInput` provides tag management with add/remove for problem categorization.
- `Editor.svelte` / `MonacoScriptEditor.svelte` wrap the Monaco editor instance with language selection, theme support, and template loading.
- `AssessmentHero` + `StatRail`/`StatTile` are the shared detail-page shell across the assignment / exam / contest surfaces (one hero + a 4-stat rail); the list pages render `AssessmentRow` glass strips in a `grid gap-2`. The visual grammar (per-type identity accents, hero/row anatomy) lives in [Design Rules → Assessment surfaces](./DESIGN.md#assessment-surfaces).
- `MatrixView` is shared between contests, assignments, and exams — one component, three contexts, identical cells (`{score, attempts, state}`).
- `ExamProctoringTab` reads the IP violation log per exam — staff-only.
- `PlagiarismPairDiff` renders the Monaco diff for a flagged submission pair; the page itself lives at `/plagiarism/pairs/[pairId]`.
- `ScoreOverrideDrawer` is the manager grading surface on the submissions matrix; hosts `ScoreOverrideList` / `ScoreOverrideForm` plus `FeedbackList` / `FeedbackForm` (feedback section omitted in contest context). Entry button is hidden until the context closes.
- `AuditTimeline` renders the merged audit log feed (lifecycle + score override + rejudge) on the Audit tab of the assignment / exam / contest manage pages — staff-only.
- `WelcomeGuide` replaces the dashboard chart blocks for accounts with zero submissions.
- `Skeleton` and `SkeletonTable` cover loading states; the grading drawer uses the table variant while editor and chart surfaces use the base primitive.
- `formatDateTime` / `formatDate` / `formatTime` (`$lib/utils/datetime.ts`) bind `Intl.DateTimeFormat` to the active Paraglide `getLocale()` — use these instead of bare `toLocale*` calls so the rendered string matches the user's UI language.
- Form validation uses `sveltekit-superforms` with Zod schemas from `@nojv/core`. Error messages are displayed inline with i18n support.
- Status badges, difficulty labels, and verdict chips use consistent color coding across all surfaces.
- ECharts powers the dashboard statistics: activity heatmap, language distribution, difficulty breakdown.

## Internationalization

- Locales: `en` (`baseLocale`, default), `zh-TW`. Unprefixed routes serve `en`; only `/zh-TW` is URL-prefixed
- Problem statements are not localized: one `ProblemStatement` row per problem, title on `Problem.title`
- UI strings: Inlang Paraglide JS with message files in `apps/web/messages/{en,zh-TW}.json` (compiled into `apps/web/src/lib/paraglide/`)
- User locale preference stored in `User.locale`

## Real-Time Events

- **Transport**: Server-Sent Events (SSE) via `/api/events/stream`
- **Broker**: Redis pub/sub via `@nojv/redis`
- **Channels**: `user:{userId}`, `notification:{userId}`, `contest:{contestId}`, `assessment:{assessmentId}`, `clarification:{contextType}:{contextId}` — see [Redis Architecture](REDIS.md)
- **Events**: submission verdict, contest starting/ending, assignment deadline, notifications, clarification updates
- **Submission polling**: Temporal `workflow.query("getStatus")` with DB fallback

## Accessibility

Component-level a11y is built on accessible primitives plus explicit ARIA on
the hand-rolled controls. Evidence by surface:

| Concern                        | Pattern (where)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessible primitives          | Dialogs and selects build on **Bits UI** (`bits-ui`) — dialogs (`role="dialog"`, `aria-modal`, focus trap), selects (`aria-expanded`/`aria-controls`/`aria-haspopup`). Tabs are **hand-rolled** (Bits UI `Tabs` is not used): the editor bottom panel has full roving-tabindex + arrow-key nav, while the exam/contest/assignment manage sub-tabs set `role="tab"`/`aria-selected` (or `aria-current` on link bars) with varying keyboard completeness — consolidating onto one accessible Tabs primitive is tracked tech debt. |
| Form validation                | Inputs/buttons/select-triggers carry `aria-invalid` (`primitives/ui/{input,button,select}`); the error `<p>` is linked via `aria-describedby` and announced with `role="alert"` (e.g. `AssignmentBasicSection`, `ExamBasicSettings`, `ContestSettingsTab`, `SchoolVerification`).                                                                                                                                                                                                                                               |
| Toggle / current state         | `aria-pressed` on toggles (language switch in `Header`), `aria-current` on active nav, `aria-checked`/`aria-disabled` where relevant.                                                                                                                                                                                                                                                                                                                                                                                           |
| Async status (live region)     | `aria-live` + `aria-atomic` announce toasts and judge status without focus change; `aria-busy` marks in-flight controls.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Icon-only controls             | `aria-label` names icon buttons; decorative icons are `aria-hidden` so they don't pollute the accessibility tree.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Color is never the sole signal | Verdicts pair color with text/short codes (`VerdictBadge`, `CaseResultGrid`) so colour-blind users still distinguish AC/WA/TLE/…                                                                                                                                                                                                                                                                                                                                                                                                |

Bare (non-Bits) `<input>` controls are flagged by `svelte-check`'s a11y lint, so
missing labels/roles fail `pnpm check` rather than shipping silently.

## Related Docs

- [Design Rules](./DESIGN.md)
- [Product Sense](../product/PRODUCT_SENSE.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [Security Requirements](../operations/SECURITY.md)
