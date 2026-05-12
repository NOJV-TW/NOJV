# Frontend Surface

SvelteKit application with server-side rendering, client hydration, and file-based routing.

## Route Map

### (app) — Authenticated Routes

Layout at `(app)/+layout.server.ts` requires authentication; redirects to `/signin` if no session.

| Route                                              | Purpose                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/dashboard`                                       | User stats, activity chart, language/difficulty distribution, recommendations              |
| `/problems`                                        | Problem listing with filters (difficulty, tags, status)                                    |
| `/problems/[problemId]`                            | Problem workspace: Monaco editor, testcases, submit/run                                    |
| `/problems/[problemId]/edit`                       | Problem editor (admin/teacher)                                                             |
| `/submissions`                                     | User submission history                                                                    |
| `/contests`                                        | Contest listing, invite code join                                                          |
| `/contests/new`                                    | Contest creation (any authenticated user)                                                  |
| `/contests/[contestId]`                            | Contest detail and problem list                                                            |
| `/contests/[contestId]/problems/[problemId]`       | Contest problem workspace (post-close redirects to `/problems/[problemId]`)                |
| `/contests/[contestId]/scoreboard`                 | Real-time scoreboard (ICPC/IOI)                                                            |
| `/courses`                                         | Course listing (Enrolled / Managing tabs)                                                  |
| `/courses/new`                                     | Course creation (admin/teacher)                                                            |
| `/courses/[courseId]`                              | Course home — overview, announcements, assignments/exams summary                           |
| `/courses/[courseId]/settings`                     | Course settings + Copy course + archive (teacher/admin)                                    |
| `/courses/[courseId]/members`                      | Member management (teacher/admin)                                                          |
| `/courses/[courseId]/assignments`                  | Course-scoped assignment list                                                              |
| `/courses/[courseId]/assignments/new`              | Create assignment (teacher/admin)                                                          |
| `/courses/[courseId]/exams`                        | Course-scoped exam list                                                                    |
| `/courses/[courseId]/exams/new`                    | Create exam (teacher/admin)                                                                |
| `/assignments`                                     | Cross-course assignment list (All / Open / Upcoming / Closed tabs)                         |
| `/assignments/[assessmentId]`                      | Assignment detail — Problems / Submissions / Plagiarism / Settings sub-tabs (manager view) |
| `/assignments/[assessmentId]/problems/[problemId]` | Assignment problem workspace (post-close redirects to bare practice)                       |
| `/exams`                                           | Cross-course exam list (All / Running / Upcoming / Ended tabs)                             |
| `/exams/[examId]`                                  | Exam detail — start screen (student) or Problems / Submissions / Settings (manager)        |
| `/exams/[examId]/problems/[problemId]`             | In-exam problem workspace (gated by active exam session)                                   |
| `/admin`                                           | Admin dashboard (platform admin only)                                                      |
| `/admin/announcements`                             | Manage announcements                                                                       |
| `/admin/users`                                     | User management (role assignment, disable)                                                 |
| `/account`                                         | User account settings                                                                      |

### (auth) — Public Auth Routes

| Route               | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `/signin`           | Sign in (email/password, GitHub, Google) |
| `/admin-signin`     | Admin-specific sign in                   |
| `/complete-profile` | Onboarding: username, email verification |

### API Routes

| Endpoint                                | Methods       | Purpose                                                    |
| --------------------------------------- | ------------- | ---------------------------------------------------------- |
| `/api/auth/[...path]`                   | GET, POST     | better-auth catch-all (session, OAuth, registration)       |
| `/api/submissions`                      | POST          | Create submission, dispatch to Temporal                    |
| `/api/submissions/[id]`                 | GET           | Submission result and verdict                              |
| `/api/submissions/[id]/source`          | GET           | Submission source code                                     |
| `/api/submissions/[id]/stream`          | GET           | SSE: poll Temporal workflow query for status               |
| `/api/submissions/[id]/rejudge`         | POST          | Rejudge a single submission (admin/teacher)                |
| `/api/rejudges`                         | POST          | Batch rejudge by problem/context filters                   |
| `/api/events/stream`                    | GET           | SSE: real-time events (verdicts, contest, deadlines)       |
| `/api/contests/[id]/scoreboard`         | GET           | Scoreboard data from Redis                                 |
| `/api/contests/[id]/scoreboard/chart`   | GET           | Scoreboard chart data                                      |
| `/api/exam-sessions/[examId]/heartbeat` | POST          | Record page-lock heartbeat / visibility events             |
| `/api/plagiarism/[assignmentId]`        | GET, POST     | Plagiarism reports and trigger detection                   |
| `/api/plagiarism-flags`                 | POST          | Flag a plagiarism pair (admin/teacher)                     |
| `/api/plagiarism-flags/[id]`            | DELETE        | Remove a plagiarism flag                                   |
| `/api/problems`                         | POST          | Create problem (admin/teacher)                             |
| `/api/problems/[id]/editorials`         | GET, POST     | Problem editorials (AC-gated)                              |
| `/api/problems/[id]/images`             | POST          | Upload problem image (admin/teacher)                       |
| `/api/problems/[id]/advanced-image`     | POST          | Upload advanced-mode judge image                           |
| `/api/notifications`                    | PATCH         | Bulk mark notifications read (body: `{action:"read-all"}`) |
| `/api/notifications/[id]`               | PATCH         | Mark one notification read (body: `{read:true}`)           |
| `/api/notifications/recent`             | GET           | Recent notifications                                       |
| `/api/notifications/unread-count`       | GET           | Unread notification count                                  |
| `/api/clarifications`                   | GET, POST     | Clarifications list / new                                  |
| `/api/clarifications/[id]`              | PATCH         | Answer or dismiss a clarification                          |
| `/api/clarifications/[id]/replies`      | POST          | Canned-reply / templated answer                            |
| `/api/editorials/[id]`                  | PATCH, DELETE | Edit / soft-delete editorial                               |
| `/api/overrides`                        | GET, POST     | List / create score overrides                              |
| `/api/overrides/[id]`                   | PATCH, DELETE | Update / remove score override                             |
| `/api/ip-violations`                    | GET           | IP violation logs (admin/teacher)                          |
| `/api/healthz`                          | GET           | Health check                                               |

## Runtime Boundaries

### Server-Side (`+page.server.ts`, `+server.ts`)

- **Auth**: `requireAuth(event)` for pages, `requireApiAuth(event)` for APIs
- **Roles**: `requirePlatformRole(actor, ...roles)` for admin/teacher gates
- **Course access**: `isCourseStaff(role)`, `resolveEffectiveCourseRole(platformRole, courseRole)`
- **Database**: Prisma queries through `@nojv/db`
- **Job dispatch**: Temporal client via `@nojv/temporal` (`getTemporalClient()`)
- **Redis**: Pub/sub, cache, scoreboard via `$lib/server/redis.ts`

### Client-Side (`+page.svelte`)

- **State**: Svelte stores for toast notifications, SSE client
- **Editor**: Monaco Editor for code submission
- **Markdown**: marked + marked-katex-extension for problem statements
- **Forms**: sveltekit-superforms + Zod for validated form handling
- **Image upload**: `ImageDropZone` component — drag-and-drop / paste images into markdown textareas
- **Charts**: ECharts for dashboard statistics
- **SSE**: EventSource for real-time submission status and contest events

## Shared UI Contracts

- `Workspace` owns the problem-solving surface: split-pane layout with problem statement (left) and Monaco code editor (right), resizable divider, submission panel, and testcase results.
- `MarkdownRenderer` renders problem statements, editorials, and input/output format descriptions using `marked` + KaTeX + DOMPurify.
- `ImageDropZone` wraps textareas with drag-and-drop and paste image upload support. Used in problem editor for statement, inputFormat, and outputFormat fields.
- `TagInput` provides tag management with add/remove for problem categorization.
- `MonacoEditor` wraps the Monaco editor instance with language selection, theme support, and template loading.
- Form validation uses `sveltekit-superforms` with Zod schemas from `@nojv/core`. Error messages are displayed inline with i18n support.
- Status badges, difficulty labels, and verdict chips use consistent color coding across all surfaces.
- ECharts powers the dashboard statistics: activity heatmap, language distribution, difficulty breakdown.

## Internationalization

- Locales: `en`, `zh-TW` (default)
- Problem statements: per-locale in `ProblemStatementI18n` table
- UI strings: Inlang Paraglide JS with message files in `project.inlang/`
- User locale preference stored in `User.locale`

## Real-Time Events

- **Transport**: Server-Sent Events (SSE) via `/api/events/stream`
- **Broker**: Redis pub/sub via `@nojv/redis`
- **Events**: submission verdict, contest starting/ending, assignment deadline
- **Submission polling**: Temporal `workflow.query("getStatus")` with DB fallback

## Related Docs

- [Design Rules](DESIGN.md)
- [Product Sense](PRODUCT_SENSE.md)
- [Architecture Overview](../ARCHITECTURE.md)
- [Security Requirements](SECURITY.md)
