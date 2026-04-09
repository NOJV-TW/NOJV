# Architecture Overview

NOJV is a production-oriented Online Judge platform. It supports competitive programming contests (ICPC/IOI scoring), course-based assessments, practice submissions, and plagiarism detection.

## Multi-Tier Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1st Tier                                                            │
│                                                                     │
│  User Interface    Svelte components (browser rendering)            │
│                                                                     │
│  Presentation      SvelteKit server load / form actions (BFF)       │
│                    Temporal activities (worker-side controllers)    │
├─────────────────────────────────────────────────────────────────────┤
│ 2nd Tier                                                            │
│                                                                     │
│  Service           @nojv/domain                                     │
│                    contest/ course/ problem/ submission/ user/      │
│                    editorial/ plagiarism/ announcement/             │
├─────────────────────────────────────────────────────────────────────┤
│ 3rd Tier                                                            │
│                                                                     │
│  Persistence       @nojv/db (repositories, not raw Prisma client)   │
│                                                                     │
│  Data              PostgreSQL 18, Redis 8                           │
├─────────────────────────────────────────────────────────────────────┤
│ Infrastructure (cross-cutting, any layer may use)                   │
│                                                                     │
│  @nojv/core          Zod schemas, DTO types, enums, contracts       │
│  @nojv/redis         Pub/sub, cache, key registry, TTL policies     │
│  @nojv/job-dispatch  Temporal client wrapper, stable dispatch API   │
│  @nojv/storage       S3-compatible object storage (images)          │
│  tooling/            ESLint, Prettier, TypeScript configs           │
└─────────────────────────────────────────────────────────────────────┘
```

Dependency direction is strictly top-down: `UI → Presentation → Service → Persistence → Data`. Infrastructure is cross-cutting and may be used by any layer.

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

## Package Structure

```
packages/
  core/             Zod schemas, DTO types, enums, contracts (zero deps)
  db/               Prisma schema, migrations, repositories (depends: core)
  redis/            Connection, key registry, pub/sub, cache (depends: core)
  job-dispatch/     Temporal client wrapper, dispatch API (depends: core)
  storage/          S3-compatible object storage for images (depends: none)
  temporal/         Workflows + activities (depends: core, domain, redis)
  domain/           Business logic (depends: core, db, redis, job-dispatch)

apps/
  web/              SvelteKit BFF (depends: core, domain)
  worker/           Temporal worker boot (depends: core, temporal, db, redis)
  sandbox-runner/   Isolated sandbox (depends: core only)
```

### Dependency Graph

```
                    core
                   ↗  ↑  ↖
                 db  redis  job-dispatch   storage
                  ↖   ↑   ↗                 ↑
                   domain                   web
                  ↗       ↖
           temporal        web
              ↑
           worker
```

No cycles. `domain` → `job-dispatch` for dispatching workflows. `temporal` → `domain` for activity logic. `domain` never imports `temporal`.

### Dependency Rules

| Package          | May import                            | Must NOT import                   |
| ---------------- | ------------------------------------- | --------------------------------- |
| `core`           | (nothing)                             | everything                        |
| `db`             | `core`                                | domain, redis, job-dispatch       |
| `redis`          | `core`                                | domain, db, job-dispatch          |
| `job-dispatch`   | `core`                                | domain, db, redis, temporal       |
| `domain`         | `core`, `db`, `redis`, `job-dispatch` | temporal, web, worker             |
| `temporal`       | `core`, `domain`, `redis`             | db, job-dispatch, web             |
| `storage`        | (nothing)                             | everything                        |
| `web`            | `core`, `domain`, `storage`           | db, redis, job-dispatch, temporal |
| `worker`         | `core`, `temporal`, `db`, `redis`     | domain, job-dispatch, web         |
| `sandbox-runner` | `core`                                | everything else                   |

## Runtime Entry Points

### apps/web — SvelteKit BFF

Port 5173 (dev) / 3000 (production).

Responsibilities:

- Server-rendered pages with client hydration (User Interface tier)
- Server load functions and form actions as Presentation layer
- Session validation via better-auth
- Calls `@nojv/domain` for all business logic — **zero business logic in this layer**
- Role-based access control (platform + course roles)

Does NOT directly access: database, Redis, Temporal.

### apps/worker — Temporal Worker

Port 8080 (health check only).

Responsibilities:

- Registers Temporal workflows and activities
- Activities act as Presentation layer (worker-side controllers)
- Activities call `@nojv/domain` data functions for business logic
- Executes sandbox code in Docker or Kubernetes

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

Only depends on `@nojv/core` for the sandbox contract. Can be rewritten in any language.

## Shared Packages

### @nojv/core

Zod schemas and TypeScript types shared across all apps. Zero dependencies. Contains:

- Domain enums (languages, roles, statuses, verdicts)
- DTO type definitions (all domain functions return these)
- Validation schemas (problem, contest, course, submission)
- Judge pipeline stage definitions and configuration schemas
- Sandbox request/result interfaces and executor contract
- SSE event types and Redis connection parsing
- Shared event config schema (used by both Contest and CourseAssessment)

### @nojv/db

Prisma 7 schema, migrations, and **repository objects**. PostgreSQL with the `pg` adapter.

- Prisma client is internal — not exported from the package
- Only repositories are exported (one per domain entity)
- Domain layer accesses data exclusively through repositories

See [Database Schema](docs/DATABASE.md).

### @nojv/redis

Centralized Redis operations. Contains:

- Key registry — all Redis key patterns defined as functions
- Pub/sub — SSE event publishing and subscription
- Cache — domain-scoped get/set/del with TTL policies
- Cooldown — rate limiting for submissions and actions
- Scoreboard — contest ranking storage and retrieval

### @nojv/job-dispatch

Stable dispatch API wrapping Temporal client. Contains:

- `submitJudge()` — dispatch submission judge workflow
- `startContestLifecycle()` — dispatch contest lifecycle workflow
- `startAssessmentLifecycle()` — dispatch assessment lifecycle workflow
- `triggerPlagiarismCheck()` — dispatch MOSS plagiarism workflow
- `startRejudge()` — dispatch rejudge workflow

Domain and web layers never see Temporal internals (workflow IDs, task queues, gRPC).

### @nojv/storage

S3-compatible object storage via `@aws-sdk/client-s3`. Contains:

- Client factory — creates S3Client from environment variables
- Image operations — upload and delete problem images
- Path convention: `problems/{problemId}/images/{uuid}.{ext}`

Local dev uses MinIO (Docker). Production uses any S3-compatible service (GCS, R2, S3) — switch via env vars only.

### @nojv/temporal

Temporal workflow and activity definitions. Used only by `apps/worker`.

- Workflows: submission judge, rejudge, contest lifecycle, assessment lifecycle, plagiarism
- Activities call `@nojv/domain` data functions for business logic
- Activities call `@nojv/redis` for event publishing
- Activities never dispatch workflows (no accidental recursion)

See [Temporal Workflows](docs/TEMPORAL.md).

### @nojv/domain

Single source of all business logic. Organized by domain:

- Each domain has `queries.ts` (read) and `commands.ts` (write)
- All functions return DTO types defined in `@nojv/core`
- Two function categories:
  - **Orchestration functions** — called by web, may dispatch workflows via job-dispatch
  - **Data functions** — called by temporal activities, pure DB + event operations

## Related Docs

- [Product Sense](docs/PRODUCT_SENSE.md)
- [Frontend Surface](docs/FRONTEND.md)
- [Temporal Workflows](docs/TEMPORAL.md)
- [Judge Pipeline](docs/JUDGE_PIPELINE.md)
- [Database Schema](docs/DATABASE.md)
- [Redis Architecture](docs/REDIS.md)
- [Security Requirements](docs/SECURITY.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
