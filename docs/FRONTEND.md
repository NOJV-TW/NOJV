# Frontend Surface

SvelteKit application with server-side rendering, client hydration, and file-based routing.

## Route Map

### (app) — Authenticated Routes

Layout at `(app)/+layout.server.ts` requires authentication; redirects to `/signin` if no session.

| Route                                                | Purpose                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/dashboard`                                         | User stats, activity chart, language/difficulty distribution, recommendations |
| `/problems`                                          | Problem listing with filters (difficulty, tags, status)                       |
| `/problems/create`                                   | Problem creation (admin/teacher)                                              |
| `/problems/[id]`                                     | Problem workspace: Monaco editor, testcases, submit/run                       |
| `/problems/[id]/edit`                                | Problem editor (admin/teacher)                                                |
| `/submissions`                                       | User submission history                                                       |
| `/contests`                                          | Contest listing, invite code join                                             |
| `/contests/create`                                   | Contest creation (admin/teacher)                                              |
| `/contests/[slug]`                                   | Contest detail and problem list                                               |
| `/contests/[slug]/problems/[problemId]`              | Contest problem workspace                                                     |
| `/contests/[slug]/scoreboard`                        | Real-time scoreboard (ICPC/IOI)                                               |
| `/courses`                                           | Course listing                                                                |
| `/courses/[slug]`                                    | Course detail                                                                 |
| `/courses/[slug]/join/[token]`                       | Join course via token                                                         |
| `/courses/[slug]/assignments/[assessmentSlug]`       | Assignment workspace                                                          |
| `/courses/[slug]/manage`                             | Course management panel (staff)                                               |
| `/courses/[slug]/manage/assessments`                 | Manage assessments                                                            |
| `/courses/[slug]/manage/members`                     | Manage members                                                                |
| `/courses/[slug]/manage/problems`                    | Manage course problems                                                        |
| `/courses/[slug]/manage/plagiarism/[assessmentSlug]` | Plagiarism reports                                                            |
| `/courses/[slug]/manage/progress`                    | Student progress matrix                                                       |
| `/assignments`                                       | Assignment listings across courses                                            |
| `/admin`                                             | Admin dashboard (platform admin only)                                         |
| `/admin/announcements`                               | Manage announcements                                                          |
| `/admin/users`                                       | User management (role assignment, disable)                                    |
| `/account`                                           | User account settings                                                         |

### (auth) — Public Auth Routes

| Route               | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `/signin`           | Sign in (email/password, GitHub, Google) |
| `/admin-signin`     | Admin-specific sign in                   |
| `/complete-profile` | Onboarding: username, email verification |
| `/verify-school`    | School email verification                |

### API Routes

| Endpoint                                   | Methods   | Purpose                                              |
| ------------------------------------------ | --------- | ---------------------------------------------------- |
| `/api/auth/[...path]`                      | GET, POST | better-auth catch-all (session, OAuth, registration) |
| `/api/submissions`                         | POST      | Create submission, dispatch to Temporal              |
| `/api/submissions/[id]`                    | GET       | Submission result and verdict                        |
| `/api/submissions/[id]/source`             | GET       | Submission source code                               |
| `/api/submissions/[id]/stream`             | GET       | SSE: poll Temporal workflow query for status         |
| `/api/events/stream`                       | GET       | SSE: real-time events (verdicts, contest, deadlines) |
| `/api/contests/[slug]/scoreboard`          | GET       | Scoreboard data from Redis                           |
| `/api/contests/[slug]/scoreboard/chart`    | GET       | Scoreboard chart data                                |
| `/api/contests/[slug]/scoreboard/unfreeze` | GET       | Unfreeze scoreboard (admin/teacher)                  |
| `/api/plagiarism/[assessmentId]`           | GET, POST | Plagiarism reports and trigger detection             |
| `/api/problems/[id]/editorials`            | GET, POST | Problem editorials (AC-gated)                        |
| `/api/problems/[id]/images`                | POST      | Upload problem image (admin/teacher)                 |
| `/api/problems/create`                     | POST      | Create problem (admin/teacher)                       |
| `/api/ip-violations`                       | GET       | IP violation logs (admin/teacher)                    |
| `/api/healthz`                             | GET       | Health check                                         |

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
