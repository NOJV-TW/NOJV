# Frontend Surface

`apps/web` is the SvelteKit app (SSR + hydration, adapter-node) that serves every page and the `/api/**` endpoints. Routes are thin transport: they authenticate, validate, and call `@nojv/application`. This doc maps route groups, gates, the request pipeline, runtime boundaries and shared UI contracts. Visual rules live in [Design Rules](DESIGN.md); per-feature behavior lives in [feature specs](../features/).

## Key code

- `apps/web/src/hooks.server.ts` — request pipeline (auth, CSRF, gates, locale)
- `apps/web/src/lib/server/auth.ts` — `requireAuth`, `requireApiAuth`, `requirePlatformRole`, course-role helpers
- `apps/web/src/lib/server/shared/` — `api-handler.ts`, `action-handlers.ts`, `load-wrapper.ts`, `rate-limiter.ts`, `client-ip.ts`, SSE hub
- `apps/web/src/lib/server/hooks/` — `request-security.ts` (CSRF, security headers), `route-paths.ts`
- `apps/web/src/lib/server/exam-lock.ts`, `step-up.ts`, `problem-solve.ts`, `domain-orchestration.ts`
- `apps/web/src/lib/server/openapi/` — public / internal OpenAPI documents
- `apps/web/src/lib/services/` — client submission tracker, draft sync, `fetchWithCsrf`, browser-local run
- `apps/web/src/lib/stores/` — toast, SSE, notifications, clarifications, theme, code drafts
- `apps/web/src/lib/components/{primitives,features/<domain>}/` — domain-agnostic vs domain UI
- `apps/web/svelte.config.js` — CSP, CSRF origin setting; `apps/web/messages/{en,zh-TW}.json` — UI strings

## Route groups

Each context root enforces its gate in its layout so child routes cannot skip it (see WEB-01).

| Group / layout                             | Gate                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| root `+layout`                             | Exposes `session` and `user`; mounts `ToastProvider`, analytics                                                    |
| `(app)/+layout.server.ts`                  | Session required, else 302 `/signin`; returns user, `adminAccessActive`, draft cipher key, editor-language cookie  |
| `(app)/admin/+layout.server.ts`            | Effective role `admin` (admin mode active), else 403                                                               |
| `(app)/courses/[courseId]/+layout`         | Course staff or active member, else 403                                                                            |
| `(app)/assignments/[assignmentId]/+layout` | Course staff or active member of the owning course, else 404                                                       |
| `(app)/exams/[examId]/+layout`             | Course staff, or a student passing the exam proctoring gate                                                        |
| `(app)/contests/[contestId]/+layout`       | Proctoring gate; unpublished contests 404 unless the actor can manage them                                         |
| `(auth)`, `(public)`                       | No session required; `(public)` pages that need a user check it in their own loader                                |
| `api/**`                                   | Each handler calls `requireApiAuth` (401 no session, 403 no username) unless it is a public system or storage path |
| `docs`, `docs/internal`                    | Scalar renderers for the OpenAPI documents                                                                         |

Effective platform role: a stored `admin` acts as `student` until admin mode is active for the session (`resolveEffectivePlatformRole`, SEC-05). With admin mode active, the header's Courses / Assignments / Exams / Contests links point to `/admin/*` global lists, and the four personal list routes redirect there (WEB-08). Assignments and Exams nav items show only for students and admins in admin mode.

## Page routes

Solve pages all render `ProblemSolveView` via `loadProblemSolveData` in `lib/server/problem-solve.ts`; the loader scopes submissions to user + context + problem (WEB-01).

| Route                                              | Notes                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                                                | Public home: announcements, and visible assessments for signed-in users (UI-20)                                                                  |
| `/dashboard`                                       | Ability overview: stats, heatmap, streak, trend, distributions; `WelcomeGuide` when no submissions (UI-19)                                       |
| `/problems`                                        | List with filters and Public / My / All tabs; staff can fork published public problems                                                           |
| `/problems/[problemId]`                            | Practice workspace; left panel Description / Submissions / Discussions / Editorials (UI-05, UI-06)                                               |
| `/problems/[problemId]/edit`                       | Problem editor (section rail: Basic, Workspace for multi-file, Testcase, Judge, Reference solution)                                              |
| `/submissions`                                     | Submission history (numbered pages); `/admin/submissions` 308-redirects here                                                                     |
| `/submissions/[submissionId]`                      | Verdict, subtask tree, source; staff review and student self-view                                                                                |
| `/courses`                                         | Enrolled / Managing tabs; effective admins redirect to `/admin/courses`                                                                          |
| `/courses/new`                                     | Teacher / admin                                                                                                                                  |
| `/courses/[courseId]`                              | Course home; sub-pages `settings`, `members`, `analytics`, `grades`, `problems`, `assignments[/new]`, `exams[/new]`                              |
| `/courses/[courseId]/problems`                     | Course problem library (add from personal private or public problems)                                                                            |
| `/courses/[courseId]/grades`                       | Gradebook: staff see all students + CSV export; students see their own row                                                                       |
| `/assignments`                                     | Cross-course list (All / Open / Upcoming / Closed)                                                                                               |
| `/assignments/[assignmentId]`                      | Detail; managers get `AssessmentManageTabs`                                                                                                      |
| `/assignments/[assignmentId]/problems/[problemId]` | Solve; after close redirects to `/problems/[problemId]?ended=assignment`; archived course 403                                                    |
| `/exams`                                           | Cross-course list (All / Running / Upcoming / Ended)                                                                                             |
| `/exams/[examId]`                                  | Student: Start exam creates the `ActiveExamSession`, then the problem list and hand-in; managers get `AssessmentManageTabs`                      |
| `/exams/[examId]/problems/[problemId]`             | Requires an active exam session; managers get a preview; after end redirects to `?ended=exam` practice                                           |
| `/contests`                                        | List and invite-code join                                                                                                                        |
| `/contests/new`                                    | Teacher / admin                                                                                                                                  |
| `/contests/[contestId]`                            | Join (before or during) then Enter; managers get `AssessmentManageTabs` (no score overrides)                                                     |
| `/contests/[contestId]/problems/[problemId]`       | Non-managers: before start or not joined → contest page; after end → `/problems/[problemId]`                                                     |
| `/contests/[contestId]/scoreboard`                 | ICPC / IOI; refreshes on `scoreboard/stream` SSE (1.5 s debounce) and every 30 s while visible; frozen snapshot during freeze                    |
| `/contests/[contestId]/upsolve`                    | Post-contest per-problem solve status                                                                                                            |
| `/contests/[contestId]/virtual`                    | Time-shifted virtual run of an ended contest; solve at `virtual/problems/[problemId]`                                                            |
| `/plagiarism/pairs/[pairId]`                       | Monaco diff for a flagged pair (encoded composite id)                                                                                            |
| `/admin`                                           | Admin dashboard; sub-pages `announcements`, `reports`, `audit`, `users`, `registry`, and global `courses` / `assignments` / `exams` / `contests` |
| `/admin/registry`                                  | Browse and delete teacher judge images in the self-hosted registry (OPS-10)                                                                      |
| `/settings`                                        | Security mailbox, sign-in factors, school verification, connections, notifications, tour replay, account deletion; `/account` 301s here          |
| `/account/api-tokens`                              | API token management; every mutation needs fresh step-up (SEC-08); `verify` handles step-up and admin-mode verification                          |
| `/account/change-password`                         | Credential-password accounts; forced when `mustChangePassword`                                                                                   |
| `/signin`                                          | GitHub / Google OAuth and exam username/password                                                                                                 |
| `/admin-signin`                                    | Admin password flow; super admins continue through password setup/recovery and TOTP or passkey                                                   |
| `/complete-profile`                                | Choose a username; school-ID formats are reserved (SEC-03)                                                                                       |
| `/verify-school`                                   | Confirm school-email verification; username becomes the student ID                                                                               |
| `/users/[id]`                                      | Public profile, opt-in via `User.profilePublic`; hidden profiles 404 except to owner and admins (WEB-07)                                         |
| `/about`                                           | Project description and contributors (UI-21)                                                                                                     |
| `/legal/privacy`                                   | Privacy policy; `/legal/terms` is the terms of service                                                                                           |
| `/environment`                                     | Judge environment from `judgeEnvironment` in `@nojv/core`                                                                                        |
| `/verdicts`                                        | Verdict glossary                                                                                                                                 |
| `/guides/advanced-mode`                            | Advanced Mode authoring guide                                                                                                                    |
| `/docs`                                            | Public API reference; `/docs/internal` is the maintainer reference                                                                               |

## API routes

The HTTP API reference is the OpenAPI document (`/api/openapi.public.json`, `/api/openapi.internal.json`, rendered at `/docs`); `tests/unit/openapi-contract.test.ts` fails when a route is undocumented or a documented path has no handler (ENG-05). Business rules for each endpoint live in the owning `@nojv/application` domain.

| Family                                     | Notes                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth/[...path]`                      | better-auth catch-all; auth and sign-in rate limits applied in the hook                                                             |
| `/api/livez`                               | Process probe; with `/api/readyz` (Postgres + Redis) and `/api/release` bypasses the pipeline (OPS-15)                              |
| `/api/admin/healthz`                       | Admin-only per-subsystem detail                                                                                                     |
| `/api/submissions`                         | POST create + dispatch; GET history or workspace cursor pages; `status`, `pending`, `[id]`, `[id]/source`, `[id]/rejudge`           |
| `/api/rejudges`                            | Batch rejudge POST, active rejudges GET; `[workflowId]` progress and `[workflowId]/cancel`                                          |
| `/api/drafts`                              | Server code drafts GET/PUT (`draftApiHandler`, WEB-05)                                                                              |
| `/api/problems`                            | List / create; `[id]` delete, bundle, checker, interactor, workspace files, testcases, images, posts, fork, bookmark, storage usage |
| `/api/problems/advanced-scaffold`          | Advanced Mode starter templates                                                                                                     |
| `/api/posts/[id]`                          | Posts, votes, comments, reports; `/api/comments/[id]` delete and reports                                                            |
| `/api/clarifications`                      | List / create; `[id]` answer, dismiss, delete; `[id]/replies`                                                                       |
| `/api/overrides`                           | Score overrides; `/api/feedback` grading feedback (writes gated post-close)                                                         |
| `/api/plagiarism/[assignmentId]/reports`   | Reports and detection trigger; `sources/...` pair sources; `/api/plagiarism-flags` curation                                         |
| `/api/exams/[examId]/ip-violations`        | Proctoring IP log for managers                                                                                                      |
| `/api/contests/[id]/scoreboard`            | Built from Postgres on read (DAT-11); `chart` sub-route                                                                             |
| `/api/notifications`                       | List, bulk mark-read / clear; `[id]`; `unread-count`                                                                                |
| `/api/events/stream`                       | SSE per user                                                                                                                        |
| `/api/images/proxy`                        | SSRF-safe third-party Markdown image proxy (SEC-11)                                                                                 |
| `/api/uploads/image`                       | Generic image upload; `/api/account/avatar` avatar PUT/DELETE                                                                       |
| `/api/storage/avatars/[userId]/[filename]` | Object-storage reads (also `problem-images`, `user-content-images`)                                                                 |
| `/api/admin-mode`                          | Enter / exit admin mode (may return `verificationRequired`)                                                                         |
| `/api/api-token-access`                    | Whether the token page needs factor setup or step-up                                                                                |
| `/api/account/onboarding-tour`             | Claim the one-time onboarding tour (UI-22)                                                                                          |
| `/api/registry/token`                      | Docker registry token endpoint (Basic credentials, not cookies)                                                                     |

## Request pipeline

`handle` in `hooks.server.ts` runs in this order; importing `$lib/server/otel` must stay first.

1. Assign `x-request-id` (valid incoming id or UUID). `/api/livez`, `/api/readyz`, `/api/release` resolve immediately.
2. Strip a `/zh-TW` path prefix for path-based checks.
3. Bearer API token: only routes allowed by `apiTokenDomain.findApiTokenRouteRule`, else 403 (SEC-07).
4. CSRF (`enforceCsrf`): for non-GET/HEAD/OPTIONS, form content types must be same-origin (Origin required); `/api/**` additionally rejects a foreign Origin and, outside `/api/auth`, requires `X-Requested-With: fetch` (`fetchWithCsrf` sets it). Token-authenticated allowed routes and `/api/registry/token` are exempt. SvelteKit's own origin check is disabled in `svelte.config.js` for the registry endpoint.
5. `/api/auth/**`: auth rate limit; password and exam-password sign-in limits; then resolve.
6. Load the session; exam-password sessions cannot manage account security.
7. Consume step-up handoff; disabled accounts are signed out (`/signin?error=account-disabled`); users without a username go to `/complete-profile`.
8. Super-admin session age limit, forced password change, admin-mode resolution, and super-admin verification (`/admin-signin`).
9. Exam gate: with an active exam session, the proctoring gate runs (fail closed with 503). With page lock, disallowed API calls are 403 and other pages record `visibility_lost` and 307 to the exam (ASM-19, ASM-20).
10. Paraglide middleware, then resolve; security headers are set on every response.

Security headers, CSP and exam rules are specified in [Security Requirements](../operations/SECURITY.md). Rate-limit keys and limits are in [Redis Architecture](REDIS.md#rate-limiting).

## Runtime boundaries

### Server (`+page.server.ts`, `+layout.server.ts`, `+server.ts`)

- Auth: `requireAuth(event)` for pages (redirects), `requireApiAuth(event)` for APIs (throws `HttpError`); `requirePlatformRole(actor, ...roles)`; `getCoursePermissionRole`, `isCourseManager`, `isCourseMember`, `canCreateCourse`. Application errors and security helpers are imported from `@nojv/application` directly.
- Business logic and data access go through `@nojv/application`; `@nojv/db` is imported only for auth wiring (ENG-02).
- Workflow dispatch: routes call application orchestration functions; `lib/server/domain-orchestration.ts` binds them to `@nojv/temporal` at startup. Routes never import raw Temporal helpers.
- Wrappers: `apiHandler` / `writeApiHandler` / `draftApiHandler` / `registryTokenApiHandler` rate-limit and map errors for API routes; form actions use `withAction` / `withRateLimit` / `withRateLimitActions` (WEB-02); loaders use `handleLoad` (see [Domain error handling](DESIGN.md#domain-error-handling)).
- JSON bodies go through `readJsonBody` / `assertJsonBodyWithinLimit` (1 MiB default).
- Client IP comes only from `getClientIp(event)` (SEC-09).

### Client (`+page.svelte`)

- Editor: Monaco via `features/problem/editors/Editor.svelte` and `primitives/ui/MonacoScriptEditor.svelte`; Advanced Mode uses `AdvancedModeWorkspace.svelte`. No solving workspace below `md` (`MobileWorkspaceBlocker`, UI-13).
- Browser Test runs locally through WASM-OJ (`lib/services/browser-local-run.ts`, JDG-15).
- Forms: `sveltekit-superforms` with `@nojv/core` Zod schemas; errors inline and translated.
- Markdown: `MarkdownRenderer` → `lib/utils/markdown.ts` (`marked` + KaTeX + DOMPurify); remote HTTPS images rewrite to `/api/images/proxy` at render time.
- Charts: ECharts, lazily imported by `primitives/charts/EChart.svelte`.
- Dates: `formatDateTime` / `formatDate` / `formatTime` in `lib/utils/datetime.ts` bind `Intl.DateTimeFormat` to the active locale; do not call bare `toLocale*`.
- `(app)/+layout.svelte` starts the submission tracker, SSE, notifications and onboarding tours.

## Submission tracking

- `lib/services/submission-tracker.ts` lives in the `(app)` session, independent of editor instances; pending work is rediscovered via `/api/submissions/pending` after reload or reconnect.
- One scheduler polls `/api/submissions/status` every 5 s in batches of at most 100 ids; SSE wakes it early. Reads time out after 10 s; failures back off to 30 s. Logout aborts and clears state.
- State is keyed by `status`, `judgeGeneration`, `updatedAt`: older responses never overwrite newer runs, and queued/running rejudges expose no stale result. Terminal summaries do not need the result blob; detailed-result reads retry separately.
- Routes carrying submission data call `depends("submission:data")` and are invalidated by the tracker. Teacher edit drafts and grading revisions survive refresh; configuration forms ignore page-data rebinding.
- Workspace history loads cursor batches of 50 on scroll; teacher and standalone histories use numbered 50-row pages anchored to a time/id snapshot. New rows appear behind an explicit "view latest" prompt.
- Batch rejudge dialogs recover progress for active rejudges from `GET /api/rejudges`.

## Real-time events

- `/api/events/stream`: SSE over Redis pub/sub on the user, notification, and authorized clarification (plus staff) channels — verdicts, notifications, clarification updates.
- `/contests/[contestId]/scoreboard/stream`: contest channel, used only as a refresh nudge.
- Channel names and payloads: [Redis Architecture](REDIS.md).

## Shared UI contracts

- `ProblemWorkspace.svelte` (`features/problem/layouts/`): resizable split pane (left 42% default, 20–80%, persisted, arrow-key resizable `role="separator"`); `ProblemLeftPanel` tabs; editor with bottom test/results panel.
- `AssessmentManageTabs`: Problems (default) / Submissions / Results (Grades, Plagiarism, Audit) / Proctoring (exam only: Credentials, IP records) / Clarifications when allowed / Settings, persisted in `?tab=` (UI-17).
- `MatrixView`: one grade matrix for contests, assignments and exams. Assignments and exams open `ScoreOverrideDrawer` (override + feedback lists/forms) from a cell; contests are read-only (ASM-17).
- `AuditTimeline`: merged lifecycle, override and rejudge feed on the Audit tab (contests: rejudge only).
- `ExamProctoringTab`: exam IP violation log. `PlagiarismPairDiff`: pair diff page.
- `AssessmentHero` + `StatRail`/`StatTile` for detail pages, `AssessmentRow` for lists; visuals in [Design Rules](DESIGN.md#assessment-surfaces).
- Table filters: `TableTextColumnFilter` and `TableSelectColumnFilter` (Bits UI menus, UI-12); filter headers stay visible on empty results; tables scroll horizontally on narrow screens.
- `ImageDropZone` for Markdown textareas (problem statement fields, announcements); `TagSelect` for problem tags.
- `Skeleton` / `SkeletonTable` for loading states.

## Internationalization

- Paraglide JS, locales `en` (base) and `zh-TW`; messages in `apps/web/messages/*.json`, compiled to `src/lib/paraglide/` (`pnpm -F @nojv/web paraglide:compile`). All UI text ships in both (UI-07).
- Locale strategy: `PARAGLIDE_LOCALE` cookie, then base locale. One site-level switcher in the header (UI-08).
- Problem statements are not localized (one `ProblemStatement` per problem). System announcements store per-locale translations.

## Accessibility

| Concern                 | Pattern                                                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives              | Dialogs, selects, tooltips, popovers on Bits UI. Tabs are hand-rolled: the workspace left panel and editor bottom panel use roving tabindex + arrow keys; manage tabs set `role="tab"` / `aria-selected` or `aria-current` with varying keyboard support |
| Form validation         | `aria-invalid` on input/button/select; error linked via `aria-describedby` with `role="alert"`                                                                                                                                                           |
| State                   | `aria-pressed` on toggles (locale buttons), `aria-current` on active nav                                                                                                                                                                                 |
| Live regions            | `aria-live` + `aria-atomic` for toasts and judge status; `aria-busy` on in-flight controls                                                                                                                                                               |
| Icon-only controls      | `aria-label`; decorative icons `aria-hidden`                                                                                                                                                                                                             |
| Color never sole signal | Verdicts pair color with short codes (`VerdictBadge`, `CaseResultGrid`)                                                                                                                                                                                  |

`svelte-check` a11y lint (`pnpm -F @nojv/web check`) fails on missing labels and roles.
