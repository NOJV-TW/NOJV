# Product Sense

## Users And Outcomes

- **Student**: submit solutions, track progress via dashboard, participate in timed contests and course assessments, view editorials after AC, join courses via invite token
- **Teacher**: create and edit problems (i18n, markdown + KaTeX, image upload), create contests and courses, manage assessments, monitor student progress matrix, trigger plagiarism detection
- **Admin**: full platform management, user role assignment (promote/disable), system announcements, all teacher capabilities
- **Contest organizer**: timed ICPC/IOI competitions with real-time scoreboard, scoreboard freeze/unfreeze, IP binding and whitelisting, page lock, submit cooldown

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

### Courses

- Course creation and management
- Join tokens for student enrollment
- Course roles: teacher, TA, student
- Assessment management with open/due/close lifecycle (Temporal-managed)
- Student progress matrix
- Course-scoped problem management

### Plagiarism Detection

- MOSS-based similarity detection
- Triggered per assessment or contest (admin/teacher)
- Results stored as JSON in PostgreSQL
- Dedicated plagiarism report view per assessment

### Editorials

- Community-contributed editorials per problem
- AC-gated: only visible after solving the problem
- Create and read via API endpoints

### User Dashboard

- Activity chart (daily submission history)
- Language distribution statistics
- Difficulty distribution statistics
- Problem-solving recommendations

### Authentication

- Email/password sign-in (bcrypt)
- GitHub OAuth
- Google OAuth
- Profile completion and email verification flow
- Admin-specific sign-in page

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

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Frontend Surface](FRONTEND.md)
- [Security Requirements](SECURITY.md)
