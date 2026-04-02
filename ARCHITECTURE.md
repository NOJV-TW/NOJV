# Architecture Overview

NOJV is a production-oriented Online Judge platform. It supports competitive programming contests (ICPC/IOI scoring), course-based assessments, practice submissions, and plagiarism detection.

## System Domains

| Domain          | Purpose                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| **Problems**    | Problem statements (i18n), testcase sets, templates, judge configuration |
| **Submissions** | Code submission, sandbox execution, verdict computation                  |
| **Contests**    | Timed competitions with scoreboard, freeze, IP lock, page lock           |
| **Courses**     | Course management, memberships, join tokens, assessments                 |
| **Auth**        | Email/password + OAuth (GitHub, Google), session management, roles       |
| **Plagiarism**  | MOSS-based similarity detection for assessments and contests             |
| **Stats**       | Per-user statistics: AC count, language distribution, daily activity     |

## Layers

```
┌──────────────────────────────────────────────────────┐
│  Browser (SvelteKit SSR + client hydration)          │
│  Monaco editor, SSE streaming, Tailwind CSS 4        │
├──────────────────────────────────────────────────────┤
│  SvelteKit Server (apps/web)                         │
│  Page loads, API routes, auth, Redis pub/sub         │
├──────────────────────────────────────────────────────┤
│  Temporal Server                                     │
│  Workflow orchestration, task queues, durable timers  │
├──────────────────────────────────────────────────────┤
│  Temporal Worker (apps/worker)                       │
│  Judge activities, lifecycle activities, sandbox exec │
├──────────────────────────────────────────────────────┤
│  PostgreSQL 17          │  Redis 8                   │
│  Source of truth        │  Pub/sub, cache, scoreboard│
└──────────────────────────────────────────────────────┘
```

## Runtime Entry Points

### apps/web — SvelteKit Frontend + API

Port 5173 (dev) / 3000 (production).

Responsibilities:

- Server-rendered pages with client hydration
- RESTful API routes (`/api/*`)
- Authentication via better-auth (session + OAuth)
- Temporal workflow dispatch (submissions, plagiarism)
- Redis pub/sub for SSE real-time events
- Role-based access control (platform + course roles)

### apps/worker — Temporal Worker

Port 8080 (health check only).

Responsibilities:

- Registers Temporal workflows and activities
- Executes sandbox code in Docker or Kubernetes
- Manages contest/assessment lifecycle timers
- Runs plagiarism detection (MOSS)

Supports three deployment modes via `WORKER_MODE`:

- `all` — Both judge and platform task queues (default, for development)
- `judge` — Only sandbox-related activities (scales with submission load)
- `platform` — Only lifecycle and plagiarism activities (lightweight)

### apps/sandbox-runner — Isolated Execution Runtime

Runs inside a container with:

- `cap-drop ALL`, `no-new-privileges`, read-only rootfs, `tmpfs /tmp`
- Network isolation (`--network none`)
- PID, memory, CPU limits
- seccomp restrictions

## Shared Packages

### @nojv/core

Zod schemas and TypeScript types shared across all apps. Contains:

- Domain enums (languages, roles, statuses, verdicts)
- Validation schemas (problem, contest, course, submission)
- Judge pipeline stage definitions and configuration schemas
- Sandbox request/result interfaces and executor contract
- SSE event types and Redis connection parsing

### @nojv/db

Prisma 7 client, schema (584 lines, 20+ models), migrations, and seed script. PostgreSQL with the `pg` adapter. See [Database Schema](docs/DATABASE.md).

### @nojv/temporal

Temporal workflow and activity definitions. Exports:

- `.` — Types, task queue constants, client factory
- `./workflows` — All workflow functions
- `./activities` — All activity functions (full bundle)
- `./activities/judge` — Judge-only activity bundle (for microservice split)
- `./activities/platform` — Platform-only activity bundle

See [Temporal Workflows](docs/TEMPORAL.md).

## Cross-Cutting Concerns

### Authentication & Authorization

- **Auth library**: better-auth with Prisma adapter
- **Providers**: Email/password (bcrypt), GitHub OAuth, Google OAuth
- **Session**: Token-based with IP and user-agent tracking
- **Platform roles**: admin, teacher, student
- **Course roles**: teacher, ta, student
- **Effective role**: `max(platformRole, courseRole)` — admin overrides all

### Validation

Zod 4 schemas defined in `@nojv/core`, used in:

- SvelteKit form actions (via sveltekit-superforms)
- API route request validation
- Temporal activity input validation
- Prisma seed validation

### Internationalization

- Locales: `en`, `zh-TW` (default)
- Problem statements: per-locale in `ProblemStatementI18n` table
- UI strings: Inlang Paraglide JS
- User locale preference stored in `User.locale`

### Real-Time Events

- **Transport**: Server-Sent Events (SSE) via `/api/events/stream`
- **Broker**: Redis pub/sub on `user:{userId}` channel
- **Events**: submission verdict, contest starting/ending, assignment deadline
- **Submission polling**: Temporal `workflow.query("getStatus")` with DB fallback

## Related Docs

- [Frontend Surface](docs/FRONTEND.md)
- [Temporal Workflows](docs/TEMPORAL.md)
- [Judge Pipeline](docs/JUDGE_PIPELINE.md)
- [Database Schema](docs/DATABASE.md)
- [Redis Architecture](docs/REDIS.md)
- [Security Requirements](docs/SECURITY.md)
- [Reliability Invariants](docs/RELIABILITY.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
