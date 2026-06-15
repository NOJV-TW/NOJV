# Microservice Architecture Redesign

> Date: 2026-04-02
> Status: Approved

## Goals

- Multi-tier architecture (UI → Presentation → Service → Persistence → Data)
- Cross-cutting Infrastructure layer
- Business logic 集中在 Service layer (`@nojv/application`)
- Repository pattern 隔離 ORM 細節
- 為未來前後端分離、sandbox 語言替換、domain 拆分預留升級路徑

## Architecture Tiers

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1st Tier                                                            │
│                                                                     │
│  User Interface    Svelte components (browser rendering)            │
│                                                                     │
│  Presentation      SvelteKit server load / form actions (BFF)       │
│                    Temporal activities (worker-side controllers)     │
├─────────────────────────────────────────────────────────────────────┤
│ 2nd Tier                                                            │
│                                                                     │
│  Service           @nojv/application                                     │
│                    contest/ course/ problem/ submission/ user/       │
│                    editorial/ plagiarism/ announcement/              │
├─────────────────────────────────────────────────────────────────────┤
│ 3rd Tier                                                            │
│                                                                     │
│  Persistence       @nojv/db (Prisma repositories, not raw client)   │
│                                                                     │
│  Data              PostgreSQL 17, Redis 8                           │
├─────────────────────────────────────────────────────────────────────┤
│ Infrastructure (cross-cutting)                                      │
│                                                                     │
│  @nojv/core          Zod schemas, DTO types, enums, contracts       │
│  @nojv/redis         Pub/sub, cache, key registry, TTL policies     │
│  @nojv/job-dispatch  Temporal client wrapper, stable dispatch API   │
│  tooling/            ESLint, Prettier, TypeScript configs            │
└─────────────────────────────────────────────────────────────────────┘
```

## Dependency Flow

```
UI → Presentation → Service → Persistence → Data
          ↕              ↕           ↕
              Infrastructure (any layer may use)
```

Strict top-down. No layer may import from a layer above it.

## Package Structure

```
packages/
  core/             Zod schemas, DTO types, enums, contracts (zero deps)
  db/               Prisma schema, migrations, repositories (depends: core)
  redis/            Connection, key registry, pub/sub, cache (depends: core)
  job-dispatch/     Temporal client wrapper, dispatch API (depends: core)
  temporal/         Workflows + activities (depends: core, domain, redis)
  domain/           Business logic (depends: core, db, redis, job-dispatch)

apps/
  web/              SvelteKit BFF (depends: core, domain)
  worker/           Temporal worker boot (depends: core, temporal, db, redis)
  sandbox-runner/   Isolated sandbox (depends: core only)

tooling/            ESLint, Prettier, TypeScript (unchanged)
infra/              Docker, GCP, K8s (unchanged)
```

### Dependency Graph (no cycles)

```
                    core (zero dependencies)
                   ↗  ↑  ↖
                 db  redis  job-dispatch
                  ↖   ↑   ↗
                   domain
                  ↗       ↖
           temporal        web
              ↑
           worker
```

- `domain` → `job-dispatch`: dispatch workflows
- `temporal` → `domain`: activities call domain data functions
- `domain` does NOT import `temporal`
- `job-dispatch` does NOT import `temporal` (uses `@temporalio/client` SDK only)

### Dependency Rules

| Package          | May import                            | Must NOT import                   |
| ---------------- | ------------------------------------- | --------------------------------- |
| `core`           | (nothing)                             | everything                        |
| `db`             | `core`                                | domain, redis, job-dispatch       |
| `redis`          | `core`                                | domain, db, job-dispatch          |
| `job-dispatch`   | `core`                                | domain, db, redis, temporal       |
| `domain`         | `core`, `db`, `redis`, `job-dispatch` | temporal, web, worker             |
| `temporal`       | `core`, `domain`, `redis`             | db, job-dispatch, web             |
| `web`            | `core`, `domain`                      | db, redis, job-dispatch, temporal |
| `worker`         | `core`, `temporal`, `db`, `redis`     | domain, job-dispatch, web         |
| `sandbox-runner` | `core`                                | everything else                   |

## Key Design Decisions

### 1. SvelteKit as BFF (not separate API server)

SvelteKit server load functions and form actions act as the Presentation layer.
They validate sessions, call `@nojv/application` functions, and return DTOs to components.
No business logic in the web layer.

**Future upgrade path**: Add `apps/api` (Hono/Fastify) that wraps the same domain
functions in REST/gRPC endpoints. Domain code changes: zero.

### 2. Repository Pattern in @nojv/db

Prisma client is **internal** to `@nojv/db`. Only repository objects are exported.
Domain layer cannot bypass repositories to access raw Prisma.

```typescript
// packages/db/src/repositories/submission.ts
import { prisma } from "../client";

export const submissionRepo = {
  create(data: CreateSubmissionData) {
    return prisma.submission.create({ data });
  },
  findById(id: string) {
    return prisma.submission.findUnique({ where: { id } });
  },
  updateVerdict(id: string, data: UpdateVerdictData) {
    return prisma.submission.update({ where: { id }, data });
  },
};

// packages/db/src/index.ts — public API
export { submissionRepo } from "./repositories/submission";
export { contestRepo } from "./repositories/contest";
// prisma client is NOT exported
```

Repositories per domain:

- `submissionRepo`
- `contestRepo`
- `problemRepo`
- `courseRepo`
- `assessmentRepo`
- `userRepo`
- `editorialRepo`
- `plagiarismRepo`
- `announcementRepo`

### 3. Domain Functions: Two Categories

```typescript
// @nojv/application/src/submission/

// Orchestration — called by web (Presentation layer)
// May dispatch workflows via job-dispatch
export async function submit(draft: SubmissionDraft): Promise<SubmissionDTO> {
  const submission = await submissionRepo.create(draft);
  await jobDispatch.submitJudge({ submissionId: submission.id, draft });
  return toDTO(submission);
}

// Data — called by temporal activities (Presentation layer, worker-side)
// Pure DB operations + event publishing, never dispatches workflows
export async function complete(id: string, verdict: Verdict, score: number) {
  await submissionRepo.updateVerdict(id, { verdict, score });
  await redis.pubsub.publishVerdict(userId, { submissionId: id, verdict, score });
}

export async function getJudgeContext(submissionId: string): Promise<JudgeContext> {
  return problemRepo.findWithTestcases(submissionId);
}
```

Activities only call data functions. No accidental workflow dispatch.

### 4. @nojv/job-dispatch — Stable Dispatch API

Wraps Temporal client. Web and domain layer never see Temporal internals.

```typescript
// packages/job-dispatch/src/index.ts
import { Client } from '@temporalio/client'

export async function submitJudge(input: SubmissionJudgeInput): Promise<void> {
  const client = await getClient()
  await client.workflow.start('submissionJudgeWorkflow', {
    taskQueue: 'judge',
    workflowId: `judge-${input.submissionId}`,
    args: [input],
  })
}

export async function startContestLifecycle(input: ContestLifecycleInput): Promise<void> { ... }
export async function triggerPlagiarismCheck(input: PlagiarismInput): Promise<void> { ... }
export async function startRejudge(input: RejudgeInput): Promise<void> { ... }
```

### 5. @nojv/redis — Centralized Key Registry

All Redis key patterns, TTL policies, and operations in one place.

```typescript
// packages/redis/src/keys.ts
export const keys = {
  userChannel: (userId: string) => `user:${userId}`,
  scoreboard: (contestId: string) => `scoreboard:${contestId}`,
  cooldown: (userId: string, action: string) => `cooldown:${userId}:${action}`,
  cache: (domain: string, id: string) => `cache:${domain}:${id}`,
} as const

// packages/redis/src/pubsub.ts
export const pubsub = {
  publishVerdict(userId: string, event: VerdictEvent) { ... },
  publishContestEvent(event: ContestEvent) { ... },
  subscribe(channel: string, handler: Handler) { ... },
}

// packages/redis/src/cache.ts
export const cache = {
  get<T>(domain: string, id: string): Promise<T | null> { ... },
  set<T>(domain: string, id: string, value: T, ttl?: number) { ... },
  del(domain: string, id: string) { ... },
}

// packages/redis/src/cooldown.ts
export const cooldown = {
  check(userId: string, action: string): Promise<boolean> { ... },
  set(userId: string, action: string, seconds: number) { ... },
}
```

### 6. Domain Module Structure

```
packages/application/
  src/
    contest/
      queries.ts         # getContest, getScoreboard, listContests
      commands.ts         # createContest, updateContest, startLifecycle
      scoring.ts          # ICPC/IOI score calculation
      types.ts            # ContestDTO, internal types
    course/
      queries.ts          # getCourse, listMembers
      commands.ts         # createCourse, joinCourse, manageMembership
      types.ts
    problem/
      queries.ts          # getProblem, getJudgeContext
      commands.ts         # createProblem, updateTestcases
      types.ts
    submission/
      queries.ts          # getSubmission, listUserSubmissions
      commands.ts         # submit, complete, rejudge
      types.ts
    user/
      queries.ts          # getUser, getUserStats
      commands.ts         # updateStats, updateProfile
      types.ts
    assessment/
      queries.ts
      commands.ts
      types.ts
    editorial/
      queries.ts
      commands.ts
      types.ts
    plagiarism/
      queries.ts
      commands.ts
      types.ts
    shared/
      ip-validation.ts    # shared IP lock enforcement logic
      event-config.ts     # shared event config validation
    index.ts              # public API: export * as contestDomain from './contest'
```

### 7. Database Schema Changes

#### No EventConfig table — shared Zod schema instead

Contest and CourseAssessment keep their config fields inline.
Duplication is at the column level only. Logic is unified via:

```typescript
// @nojv/core — single schema definition
export const eventConfigSchema = z.object({
  ipWhitelistEnabled: z.boolean(),
  ipBindingEnabled: z.boolean(),
  ipViolationMode: ipViolationModeEnum,
  ipWhitelist: z.array(z.string()),
  maxAttempts: z.number().int().positive().optional(),
  allowedLanguages: z.array(languageEnum),
  scoreboardMode: scoreboardModeEnum,
  pageLockEnabled: z.boolean(),
})

// @nojv/application/shared/event-config.ts — single logic
export function enforceEventConfig(config: EventConfig, ...) { ... }
```

#### Submission CHECK constraint — keep flat table

```sql
ALTER TABLE "Submission" ADD CONSTRAINT submission_context_check CHECK (
  CASE mode
    WHEN 'PRACTICE'   THEN contest_id IS NULL AND course_assessment_id IS NULL
    WHEN 'CONTEST'    THEN contest_id IS NOT NULL AND course_assessment_id IS NULL
    WHEN 'ASSESSMENT' THEN course_assessment_id IS NOT NULL AND contest_id IS NULL
  END
);
```

DB enforces context mutual exclusivity. No extension tables needed.

### 8. Sandbox Isolation (unchanged)

Sandbox-runner remains fully isolated:

- Only depends on `@nojv/core` (sandbox contract)
- Communicates via Docker/K8s stdio (JSON in/out)
- Can be rewritten in any language (Rust, Go) without affecting other packages
- Security: cap-drop ALL, no-new-privileges, read-only rootfs, network none

## Runtime Flow: Submission Judge

```
Browser
  │ POST /submit
  ▼
SvelteKit form action (Presentation)
  │ validate session + input
  ▼
domain.submission.submit(draft) (Service)
  ├── submissionRepo.create(data) (Persistence → Data)
  └── jobDispatch.submitJudge({ submissionId, draft }) (Infrastructure)
        │
        ▼ gRPC
  Temporal Server
        │
        ▼
  submissionJudgeWorkflow (temporal package)
    │
    ├── activity: fetchJudgeContext
    │     └── domain.problem.getJudgeContext(id) → problemRepo (Service → Persistence)
    │
    ├── activity: executeSandbox
    │     └── executor.run(sandboxRequest) → Docker/K8s → sandbox-runner
    │
    ├── activity: completeSubmission
    │     └── domain.submission.complete(id, verdict) → submissionRepo + redis.pubsub
    │
    └── activity: updateUserStats
          └── domain.user.updateStats(userId) → userRepo
                │
                ▼
  Redis pub/sub → SSE → Browser (real-time verdict)
```

## Migration Strategy

Incremental migration, one package at a time. Each step is independently deployable.

### Phase 1: Infrastructure packages

1. Create `packages/redis` — extract Redis logic from web + temporal
2. Create `packages/job-dispatch` — extract Temporal client from web

### Phase 2: Persistence layer

3. Add repositories to `packages/db` — wrap Prisma in repo functions
4. Stop exporting Prisma client from `@nojv/db`

### Phase 3: Service layer

5. Create `packages/application` — migrate business logic from `apps/web/src/lib/server/`
6. Update `apps/web` to call domain functions only

### Phase 4: Worker refactor

7. Update `packages/temporal` activities to call domain data functions
8. Remove direct DB access from temporal activities

### Phase 5: Schema hardening

9. Add Submission CHECK constraint migration
10. Cleanup: remove dead code, verify dependency rules

Each phase can be merged independently. No big-bang migration.

## Future Upgrade Paths

| When                               | Action                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Need REST API for mobile/3rd party | Add `apps/api` wrapping domain functions                                                         |
| Sandbox needs Rust/Go rewrite      | Replace `apps/sandbox-runner`, contract in `@nojv/core` unchanged                                |
| Contest domain grows too large     | Extract `packages/application/contest` → `packages/application-contest` → `apps/contest-service` |
| Need separate DB per domain        | Add DB connection per repository, domain code unchanged                                          |
| Different team owns judge          | `apps/worker` + `packages/temporal` already deployable independently                             |
