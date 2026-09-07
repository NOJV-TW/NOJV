# Product Sense

## Users And Outcomes

- **Student**: submit solutions, track progress via dashboard, participate in timed contests, take course assessments and exams, join per-problem discussions and view editorials after AC; once their email is verified they may also create and own problems; course enrollment is teacher-driven (no self-serve join token)
- **Teacher**: create and edit problems (i18n, markdown + KaTeX, image upload), create contests and courses, manage assessments and exams (publish / archive / delete-draft lifecycle), duplicate existing courses, monitor student progress matrix, trigger plagiarism detection
- **Admin**: full platform management, user role assignment (promote/disable), system announcements, all teacher capabilities
- **Contest organizer**: timed ICPC/IOI competitions with real-time scoreboard, scoreboard freeze/unfreeze, IP binding and whitelisting, page lock, submit cooldown
- **Exam proctor**: session-based course exams with start/end lifecycle, IP pinning, page-lock visibility enforcement, submissions matrix for grading review

## Implemented Scope

This describes repository behavior; release and deployment verification are tracked separately.

### Problems

- Problem listing with filters (difficulty, tags, solved status)
- Problem creation: any email-verified user (including students) may create, own, and publish private problems. Teachers, admins, and users who are active TAs in any non-archived course may publish public problems. Any private-problem owner may separately grant one-time `adminMayPublish` consent; this is not a review request, queue, or publication guarantee.
- Standard publication requires an accepted current private reference solution. Publishing a private problem publicly creates a publisher-owned public copy; the private source and its course sharing remain intact. An admin publishing for another owner requires and consumes that owner's one-time consent. Course co-editors can publish a private draft for use and maintain its reference solution, but cannot grant public consent or change ownership merely through co-edit access.
- Published public problems can be forked manually by teachers, admins, and users currently serving as a course TA. A fork is an independent private draft with direct-source lineage, copied judge content, and a private snapshot of the current accepted reference solution; later edits do not synchronize between copies.
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
- Per-contest submit cooldown (PostgreSQL advisory locks)
- Invite code join flow

### Post-Contest

- Upsolve — after a contest ends, a read-only index of every contest problem with the viewer's solve status (solved / attempted / untouched), linking to the ordinary problem page for practice submits
- Virtual contests — replay an ended contest on a personal timer equal to the original duration; submissions are tagged with the virtual run and scored privately, with the original final standings shown as static "ghost" reference rows

### Courses

- Course creation and management
- Teacher-driven enrollment by full username, with durable roster rows before an account exists. Teachers use bare NTNU student IDs, `ntu_` / `ntust_` prefixes for NTU / NTUST, or general usernames; prefixes are never inferred.
- Students and TAs bind automatically when the matching account obtains its username. School verification keeps the existing account and its credentials/submissions; a school roster collision keeps the school row and its conflicting role, scores, and feedback. A general rename keeps the already-linked row. If either enrollment was removed, the merged enrollment stays removed until a teacher restores it; existing owner/teacher membership protections still apply. Nonconflicting data and both audit histories survive.
- Teachers can correct an unlinked roster username without changing its membership ID, grades, feedback, role, or enrollment dates. An existing account links immediately if it has no other membership in the course. Conflicting course memberships and already-linked roster identities cannot be overwritten by this action.
- Course roles: teacher, TA, student
- Assessment management with open/due/close lifecycle (Temporal-managed)
- Assessment Settings tab: publish / archive / revert-to-draft / delete-draft with status-aware field locks
- Editable Problems tab: attach / detach / reorder / per-problem points (locked once assessment opens)
- Course duplication: single-transaction copy of course + assessments + exams + problem attachments (new copy drops to draft)
- Class stats aggregation (submittedUsers / totalStudents / avgScore) and per-student myStatus (solved/total) rendered on list pages
- Practice-after-close: students retain problem access after assessment/contest/exam ends, submissions no longer attributed to the original context
- Student progress matrix, gradebook, analytics roster, and CSV include pending students; activity counts still represent actual submissions/participations. Notifications target only linked users.
- Course gradebook (`/courses/[courseId]/grades`) — per-problem raw best scores (overrides applied) across all published assignments and exams, chronological columns with per-problem max; staff see every student plus CSV export, students see only their own row; no weighting or normalization by design (teachers compute ratios from the CSV)
- Staff-only course library at `/courses/[courseId]/problems`: share one's own private problems including drafts, import public problems, search by title/ID/owner, and inspect sources and activity usage. Problems retain individual owners; the library has no create-problem button.
- Bound active teachers and TAs can co-edit private library problems, including content, testcases and reference solutions. Platform student status does not disqualify an active TA. Pending usernames and removed memberships grant no access. Archived libraries remain readable without editing/add/remove controls.
- Assignment and exam selection reuses an actor-owned private problem or a private problem already shared with that course. Every newly selected published public problem, including the actor's own, becomes an actor-owned private fork. Existing references loaded from DB retain their IDs; activity pickers offer published candidates and preserve selected historical drafts. Activities, forks and library relations commit atomically.
- Detaching activity problems keeps library sharing. Removing a library entry leaves the individual problem intact and rejects activity/history references. Copying a course cannot extend another owner's private sharing; it reuses owned private problems and forks public sources once per distinct problem. See [Database](../architecture/DATABASE.md) and the [problem permissions plan](../plans/active/2026-09-08-problem-permissions.md).

### Grading (post-close)

- Grading drawer on the manager submissions matrix — opens once the context has closed (`closesAt`/`endsAt < now`); before that the entry button is hidden and a "grading available after close" note is shown in its place
- Score overrides (existing) are now gated to post-close on assignment + exam + contest; `platformRole === "admin"` bypasses the gate for emergency fixes
- Pending students can receive assignment/exam manual scores and feedback after close without participation or submissions; staff permissions and point-sum scoring rules still apply.
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
- Session-based proctoring: `?/startExam` form action binds the student IP pin; the page-lock handle hook records `visibility_lost` events on off-path navigation; `?/releaseSession` form action closes the session; `?/releaseAllSessions` lets an instructor release every active session at once
- Page lock confines the student to `/exams/[examId]/*` while the session is active
- Student post-close review block on the detail page — links fall back to ordinary practice URLs

### Plagiarism Detection

- Dolos-based AST similarity detection (self-hosted, in-process)
- Triggered per assessment or contest (admin/teacher)
- Results stored as JSON in PostgreSQL
- Dedicated plagiarism report view per assessment
- Side-by-side Monaco diff viewer for any flagged pair (assessment context)
- Staff can mark pairs as false positives (`PlagiarismPairFlag`); flagged pairs hidden from list by default with toggle to reveal

### Problem Posts (Editorials & Discussions)

- Community-contributed posts per problem, two types on one model (`ProblemPost`): editorials (solution writeups) and discussions (open Q&A)
- Editorials AC-gated: only visible after solving the problem (author/admin exempt); discussions open to any signed-in user
- Both types blocked server-side while a live contest / assignment / exam re-uses the problem; only the practice workspace renders the tabs
- Entire experience lives in the problem workspace left panel (LeetCode-style: list → article → compose); no standalone pages
- Create / read / edit / soft-delete via API; soft-deleted rows filtered from every read path
- Up/down voting per post (`PostVote`, one vote per user) with top-voted sorting
- Two-level comments (comment + reply) with tombstones for deleted comments
- User-filed reports against posts and comments (`ContentReport`) feeding a unified admin moderation queue at `/admin/reports` (resolve soft-deletes the target and notifies its author; dismiss closes the report)

### User Dashboard

- Activity heatmap (daily submission history, bucketed by the browser's local day)
- At-a-glance stats — solved count, attempts, AC rate, practice days
- Topic proficiency plus difficulty / verdict / language distribution charts
- Recent submissions list
- Site-wide overview toggle (`?view=server`) — anonymous platform aggregates: KPI cards, 30-day submission trend, verdict / language donuts, trending public problems

### Public User Profiles

- Public profile page at `/users/[id]` — avatar, activity heatmap, difficulty/language distributions, solved public-problem list
- Private by default (`User.profilePublic`); the owner opts in from Settings, after which the page is visible without signing in
- Private profiles return 404 to everyone except the owner and admins (in admin mode)

### Authentication

- Third-party sign-in only — GitHub OAuth + Google OAuth (no public email/password flow)
- Profile completion and email verification flow on first OAuth sign-in
- Admin-specific credential sign-in page. Regular admins explicitly enter admin mode after TOTP/passkey verification; super admins use password plus TOTP/passkey and receive admin access directly.
- Super admins cannot use or link OAuth. First login changes the seeded password and sets up TOTP or passkey; password-first backup-code/email recovery grants factor setup only.

### Administration

- Admin dashboard
- User management (role assignment, disable accounts)
- System announcements (create, manage)
- Platform-wide course, assignment, exam, and contest lists that do not depend on the admin's course enrollment

### Real-Time Events

- SSE event stream for submission verdicts, contest events, and deadline notifications
- Redis pub/sub as event broker

## Tradeoff Rules

- PostgreSQL is the business source of truth; Redis and Temporal are derived/ephemeral.
- Prefer Temporal workflows over custom queue logic for long-running orchestration.
- Keep authentication and authorization separate; OAuth proves identity, local RBAC decides permissions.
- Keep business logic in `@nojv/application`; presentation layers (web, temporal activities) stay thin.
- Prefer S3-compatible storage over custom blob solutions for portability.
- Problem statements support i18n; UI strings use Paraglide JS.

## Explicit Non-Goals For This Phase

- No AI-assisted judging or auto-grading beyond exact/checker/interactive modes
- No real-time collaborative editing of problems
- No multi-tenant deployment (single institution per instance)
- No mobile-native application
- No mobile workspace — phones can browse the site (statements, scoreboards, lists, editorials, dashboard) but the Monaco editor + submission form are hidden below `md` and replaced by `<MobileWorkspaceBlocker>` directing users to the desktop
- No public email/password registration or self-serve password reset; admin uses seeded credentials only, all other users sign in via GitHub or Google
- No CSV user import, no submission zip export

## Related Docs

- [Architecture Overview](../architecture/ARCHITECTURE.md)
- [Frontend Surface](../architecture/FRONTEND.md)
- [Security Requirements](../operations/SECURITY.md)
