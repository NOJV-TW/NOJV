# Product Sense

## Users And Outcomes

- **Student**: submit solutions, track progress via dashboard, participate in timed contests, take course assessments and exams, view editorials after AC, join courses via invite token
- **Teacher**: create and edit problems (i18n, markdown + KaTeX, image upload), create contests and courses, manage assessments and exams (publish / archive / delete-draft lifecycle), duplicate existing courses, monitor student progress matrix, trigger plagiarism detection
- **Admin**: full platform management, user role assignment (promote/disable), system announcements, all teacher capabilities
- **Contest organizer**: timed ICPC/IOI competitions with real-time scoreboard, scoreboard freeze/unfreeze, IP binding and whitelisting, page lock, submit cooldown
- **Exam proctor**: session-based course exams with start/heartbeat/end lifecycle, IP pinning, page-lock visibility enforcement, submissions matrix for grading review

## Shipped Scope

### Problems

- Problem listing with filters (difficulty, tags, solved status)
- Problem creation and editing (admin/teacher)
- i18n problem statements (en, zh-TW) with markdown + KaTeX rendering
- Image upload via drag-and-drop / paste into markdown textareas (S3-compatible storage)
- Monaco Editor code workspace with multi-language support
- Testcase management (hidden and sample testcases)
- Problem templates and judge configuration

### Submissions

- Code submission from problem workspace
- Real-time submission status via SSE (Temporal workflow query with DB fallback)
- Submission history page
- Source code viewing (ownership-gated)
- Sandbox execution in Docker (local) or Kubernetes (production)
- Verdict computation with subtask scoring

### Contests

- Contest creation with ICPC or IOI scoring modes
- Timed contest lifecycle managed by Temporal workflows
- Real-time scoreboard with chart visualization
- Scoreboard freeze and admin-controlled unfreeze
- IP binding (block or notify mode) and IP whitelisting
- Page lock (browser visibility API enforcement)
- Per-contest submit cooldown (Redis-backed)
- Invite code join flow

### Post-Contest

- Upsolve — after a contest ends, a read-only index of every contest problem with the viewer's solve status (solved / attempted / untouched), linking to the ordinary problem page for practice submits
- Virtual contests — replay an ended contest on a personal timer equal to the original duration; submissions are tagged with the virtual run and scored privately, with the original final standings shown as static "ghost" reference rows

### Courses

- Course creation and management
- Join tokens for student enrollment
- Course roles: teacher, TA, student
- Assessment management with open/due/close lifecycle (Temporal-managed)
- Assessment Settings tab: publish / archive / revert-to-draft / delete-draft with status-aware field locks
- Editable Problems tab: attach / detach / reorder / per-problem points (locked once assessment opens)
- Course duplication: single-transaction copy of course + assessments + exams + problem attachments (new copy drops to draft)
- Class stats aggregation (submittedUsers / totalStudents / avgScore) and per-student myStatus (solved/total) rendered on list pages
- Practice-after-close: students retain problem access after assessment/contest/exam ends, submissions no longer attributed to the original context
- Student progress matrix
- Course-scoped problem management

### Grading (post-close)

- Grading drawer on the manager submissions matrix — opens once the context has closed (`closesAt`/`endsAt < now`); before that the entry button is hidden and a "grading available after close" note is shown in its place
- Score overrides (existing) are now gated to post-close on assignment + exam + contest; `platformRole === "admin"` bypasses the gate for emergency fixes
- Per-cell student-visible feedback comments on assignment + exam (no contest feedback); students see the comment on the assignment / exam detail page and on the submission detail page once the context has closed
- Audit timeline tab on assignment / exam / contest manage pages — merged reverse-chronological view of lifecycle transitions, score-override changes, and rejudges (staff-only)

### Class Analytics

- Course-staff analytics dashboard, aggregating existing submission and assessment data (no schema of its own)
- Per-assessment completion rate and average score
- Hardest problems — lowest AC rate, top 5
- At-risk students — no submissions or all-zero scores
- Course-wide verdict distribution

### Exams

- Course-scoped timed exams (separate from standalone Contests)
- Exam Settings tab: basic info, scoring mode, scoreboard mode, allowed languages, submit cooldown, proctoring (page lock / IP binding / IP whitelist / violation mode), lifecycle (publish / archive / delete-draft) with status-aware field locks
- Editable Problems tab: attach / detach / reorder / per-problem points (locked once exam starts)
- Submissions sub-tab: students × problems matrix with best score + attempt count, CSV export, search, sort, pagination
- Session-based proctoring: `?/startExam` form action binds the student IP pin; `/api/exam-sessions/[examId]/heartbeat` records visibility events; `?/releaseSession` form action closes the session
- Page lock confines the student to `/exams/[examId]/*` while the session is active
- Student post-close review block on the detail page — links fall back to ordinary practice URLs

### Plagiarism Detection

- Dolos-based AST similarity detection (self-hosted, in-process)
- Triggered per assessment or contest (admin/teacher)
- Results stored as JSON in PostgreSQL
- Dedicated plagiarism report view per assessment
- Side-by-side Monaco diff viewer for any flagged pair (assessment context)
- Staff can mark pairs as false positives (`PlagiarismPairFlag`); flagged pairs hidden from list by default with toggle to reveal

### Editorials

- Community-contributed editorials per problem
- AC-gated: only visible after solving the problem
- Create / read / edit / soft-delete via API; soft-deleted rows filtered from every read path
- Dedicated paginated list page (`/(app)/problems/[problemId]/editorials`)
- Per-editorial edit page; author or admin only

### User Dashboard

- Activity chart (daily submission history)
- Language distribution statistics
- Difficulty distribution statistics
- Streak card — consecutive days with at least one AC (today's grace day applies)
- Last-7-days submission trend
- Suggested problems — top 5 unsolved problems whose tags overlap with the user's most-AC'd tags

### Authentication

- Third-party sign-in only — GitHub OAuth + Google OAuth (no public email/password flow)
- Profile completion and email verification flow on first OAuth sign-in
- Admin-specific sign-in page (seeded credentials only — no self-serve email/password registration, no password-reset flow)

### Administration

- Admin dashboard
- User management (role assignment, disable accounts)
- System announcements (create, manage)

### Real-Time Events

- SSE event stream for submission verdicts, contest events, and deadline notifications
- Redis pub/sub as event broker

## Tradeoff Rules

- PostgreSQL is the business source of truth; Redis and Temporal are derived/ephemeral.
- Prefer Temporal workflows over custom queue logic for long-running orchestration.
- Keep authentication and authorization separate; OAuth proves identity, local RBAC decides permissions.
- Keep business logic in `@nojv/domain`; presentation layers (web, temporal activities) stay thin.
- Prefer S3-compatible storage over custom blob solutions for portability.
- Problem statements support i18n; UI strings use Paraglide JS.

## Explicit Non-Goals For This Phase

- No AI-assisted judging or auto-grading beyond exact/checker/interactive modes
- No real-time collaborative editing of problems
- No multi-tenant deployment (single institution per instance)
- No mobile-native application
- No mobile workspace — phones can browse the site (statements, scoreboards, lists, editorials, dashboard) but the Monaco editor + submission form are hidden below `md` and replaced by `<MobileWorkspaceBlocker>` directing users to the desktop
- No public email/password registration or self-serve password reset; admin uses seeded credentials only, all other users sign in via GitHub or Google
- No bulk operations (no bulk session release, no CSV user import, no submission zip export)
- No editorial voting / comments / moderation queue beyond admin soft-delete

## Related Docs

- [Architecture Overview](../architecture/ARCHITECTURE.md)
- [Frontend Surface](../architecture/FRONTEND.md)
- [Security Requirements](../operations/SECURITY.md)
