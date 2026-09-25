# Product Sense

NOJV is a single-institution online judge for university programming courses: practice problems, course assignments and exams, and standalone contests, judged in a hardened sandbox. This page states who it serves, what is shipped and what is deliberately not built. Acceptance behavior lives in the [feature specs](../features/); rationale lives in the [decision log](../decisions/README.md).

## Key code

- `apps/web/src/routes/(app)/` — signed-in product surface (`problems`, `submissions`, `courses`, `assignments`, `exams`, `contests`, `dashboard`, `settings`, `admin`)
- `apps/web/src/routes/(public)/` — home, public profiles, about/legal, guides, verdicts; `apps/web/src/routes/(auth)/` — sign-in, onboarding, admin sign-in, school verification
- `packages/application/src/<domain>/` — business rules per domain

## Users

| Role                    | Can do                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Student                 | Solve and submit, track progress on the dashboard, join contests, take assignments and exams, use problem posts. Once email-verified, may create and own private problems. Enrollment is teacher-driven only. |
| Course TA               | Manage the course's activities, library, grading and proctoring; may publish public problems and fork; may remove students only (ASM-05).                                                                     |
| Teacher (platform role) | Everything a course manager does, plus creating contests and courses, publishing public problems and forking.                                                                                                 |
| Admin                   | Platform management after explicit admin-mode elevation (SEC-05): users, announcements, moderation, platform-wide lists, emergency grading fixes.                                                             |

## Shipped scope

### Problems

- Three types: `full_source`, `multi_file` (workspace files with editable/readonly/hidden visibility) and `special_env` (Advanced Mode, teacher-built images; creation needs an admin-granted permission) (PRB-01, PRB-12, JDG-16).
- Judge modes: standard token compare, checker, interactor; subtasks score all-or-nothing (JDG-01 to JDG-04). Samples are presentation data, not testcases (PRB-03).
- One Markdown + KaTeX statement per problem; images uploaded by drag-and-drop or paste to object storage (PRB-05).
- Library with URL filters (difficulty, tags, solved / attempted / untried / bookmarked) and full-text search (PRB-14).
- Ownership: any email-verified user may create private problems. Publishing requires an accepted, current private reference solution (PRB-09). Platform teachers/admins and active course teachers/TAs may publish public problems, which creates a publisher-owned public copy; the owner can grant a one-time `adminMayPublish` consent, which is not a review request (PRB-11, UI-02).
- Forks: teachers, admins and active course staff can fork published public problems into independent private drafts with lineage (PRB-10).

### Submissions

- Monaco workspace (desktop only), optional in-browser test runs (JDG-15), official judging in Docker or Kubernetes sandboxes ([Judge Pipeline](../architecture/JUDGE_PIPELINE.md)).
- Live status over SSE with polling fallback (PRB-21); history and ownership-gated source view.
- `system_error` never costs an attempt (PRB-16); rejudges are audited (PRB-18).

### Courses

- Teacher-driven enrollment by pasted usernames; roster rows exist before accounts and bind when the matching username appears (ASM-03, ASM-04). Username formats: bare NTNU student IDs, `ntu_` / `ntust_` prefixes, or general usernames; prefixes are never inferred.
- Roles: teacher, TA, student. One course UI for every role (ASM-02).
- Staff-only problem library at `/courses/[courseId]/problems`: share own private problems (including drafts), import public ones as forks, and co-edit shared private problems as an active teacher/TA (PRB-10).
- Assignments with due/close deadlines, late penalties and per-problem daily attempt caps ([spec](../features/assignments.md)).
- Course copy into a fresh draft course ([spec](../features/copy-course.md)).
- Gradebook at `/courses/[courseId]/grades`: allocated activity points per problem across published assignments and exams, overrides applied, chronological columns; staff see every student (including pending roster rows) and export CSV; students see only their own row (ASM-16).
- Staff analytics: per-activity completion rate and average, top 5 hardest problems, at-risk students, verdict distribution; derived from existing data (ASM-09).
- Practice after close: participants keep problem access at `/problems/[id]` without affecting grades (PRB-20).

### Exams

- Course-scoped timed exams with sessions, hand-in, optional page lock and IP whitelist/binding, and optional temporary exam passwords ([Exams](../features/exams.md), [Proctoring](../features/proctoring.md)).

### Grading

- Activity point allocation separate from raw problem scores (ASM-16).
- After close: score overrides with required reasons and per-cell student-visible feedback on assignments and exams; admins bypass the close gate. Contests have neither (ASM-17, ASM-18).
- Staff audit timeline per activity (lifecycle, overrides, rejudges) (ASM-14).
- Shared clarification board for assignments, exams and contests (ASM-10, ASM-11).

### Contests

- Standalone contests, public or invite-only, with `problem_count`, `weighted_count` or `point_sum` scoring, per-contest penalty minutes, submit cooldown, live/hidden/frozen scoreboards with chart, and Temporal-managed lifecycle ([spec](../features/contests.md)).
- Upsolve and virtual contests after the end (ASM-09).

### Plagiarism

- Staff-triggered Dolos checks per assignment, exam or contest with pair diff and false-positive flags ([spec](../features/plagiarism.md)).

### Problem posts

- Editorials (after AC) and discussions in the practice workspace panel, with votes, comments, reports and an admin moderation queue ([spec](../features/posts.md)).

### Dashboard and profiles

- Personal dashboard and an anonymous site-wide view ([spec](../features/dashboard.md)).
- Public profiles at `/users/[id]`: opt-in via `User.profilePublic`; hidden profiles return 404 except to the owner and admins in admin mode (WEB-07).

### Accounts and security

- Sign-in with GitHub or Google OAuth; no public sign-up or password reset; admins are bootstrapped with credentials (SEC-01). Students may also use an expiring exam password when an exam enables it ([contract](../features/exams.md#temporary-exam-sign-in)).
- Linked provider accounts are the login identity; `User.email` is the fixed security mailbox and never merges accounts; an optional notification email receives everything else (SEC-02).
- Username is chosen once at onboarding (school-ID formats reserved); only school verification replaces it with the verified student ID (SEC-03).
- Factors, admin mode and super-admin login: [Login and security](../features/login-security.md).
- Personal API tokens with scopes and step-up (SEC-07, SEC-08).

### Platform

- In-site notifications with opt-out email (WEB-04, UI-03); onboarding tours (UI-22); system announcements.
- Admin: user role and disable management, platform-wide course, assignment, exam and contest lists independent of enrollment (WEB-08).
- UI in English and Traditional Chinese via Paraglide (UI-07); mobile is read-only (UI-13).

## Tradeoff rules

- PostgreSQL is the source of truth; Redis holds only rebuildable state (DAT-10) and Temporal runs async orchestration (DAT-13).
- Authentication and authorization are separate: OAuth proves identity, local roles decide permissions.
- Business logic lives in `@nojv/application`; web routes and worker activities stay thin (ENG-02).
- File bodies live in S3-compatible object storage, never in Postgres (DAT-06).

## Non-goals

- AI-assisted judging or grading beyond the standard, checker and interactor modes.
- Real-time collaborative problem editing.
- Multi-tenant deployment; one institution per instance.
- Native mobile apps, and any solving workspace below the `md` breakpoint: phones can browse statements, scoreboards, lists, editorials and the dashboard, but the editor and submit form are replaced by `<MobileWorkspaceBlocker>` (UI-13).
- Public email/password registration or self-serve password reset.
- CSV user import or submission zip export.
- Problem review queues or moderation of student-authored problems (PRB-11).
- Remote proctoring (webcam, screen recording, lockdown browser).
