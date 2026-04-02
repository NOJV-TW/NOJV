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
| `/problems/[slug]`                                   | Problem workspace: Monaco editor, testcases, submit/run                       |
| `/problems/[slug]/edit`                              | Problem editor (admin/teacher)                                                |
| `/submissions`                                       | User submission history                                                       |
| `/contests`                                          | Contest listing, invite code join                                             |
| `/contests/create`                                   | Contest creation (admin/teacher)                                              |
| `/contests/[slug]`                                   | Contest detail and problem list                                               |
| `/contests/[slug]/problems/[problemSlug]`            | Contest problem workspace                                                     |
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
| `/api/problems/[slug]/editorials`          | GET, POST | Problem editorials (AC-gated)                        |
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
- **Charts**: ECharts for dashboard statistics
- **SSE**: EventSource for real-time submission status and contest events

## Auth Flow

1. User signs in via `/signin` (email/password or OAuth)
2. better-auth creates session token, stored in cookie
3. `hooks.server.ts` resolves session on every request via `auth.api.getSession()`
4. `locals.user` and `locals.session` are available in all server-side code
5. `(app)/+layout.server.ts` redirects to `/signin` if no session
6. Profile completion required (`/complete-profile`) before accessing content

## Permission Model

| Platform Role | Capabilities                                          |
| ------------- | ----------------------------------------------------- |
| admin         | Full access, user management, all course management   |
| teacher       | Create courses/contests/problems, manage own courses  |
| student       | Submit solutions, join courses/contests, view content |

| Course Role | Capabilities                                               |
| ----------- | ---------------------------------------------------------- |
| teacher     | Full course management, grade export, plagiarism detection |
| ta          | Member management, progress viewing                        |
| student     | Submit assignments, view content                           |

Effective role = `max(platformRole, courseRole)`. Admin overrides everything.

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Security Requirements](SECURITY.md)
- [Temporal Workflows](TEMPORAL.md)
