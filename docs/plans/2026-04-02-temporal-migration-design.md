# Temporal Migration Design

> Date: 2026-04-02
> Status: Draft

## Overview

Full migration from BullMQ to Temporal for workflow orchestration, plus new workflows and Redis feature expansion.

## Architecture

### Before

```
Web (SvelteKit) → BullMQ/Redis → Worker → Sandbox
                                  ↓
                            Redis pub/sub → SSE
```

### After

```
Web (SvelteKit) → Temporal Client → Temporal Server → Worker (Temporal Worker)
                        ↓                                      ↓
                  Query workflow state                    Sandbox Executor
                  (replaces DB polling)                        ↓
                                                     Redis pub/sub → SSE
```

### Component Changes

| Component | Before | After |
|-----------|--------|-------|
| `apps/worker` | BullMQ Worker + prom-client | Temporal Worker (Workflows + Activities) |
| `apps/web` queue.ts | BullMQ `dispatchSubmissionJob()` | Temporal Client `startWorkflow()` |
| `apps/web` submission polling | DB polling every 1s | `workflow.query()` on Temporal workflow |
| `packages/core` queue.ts | BullMQ queue names, job schema | SSE event constants only (workflow types move to `packages/temporal`) |
| Docker Compose | PostgreSQL + Redis | PostgreSQL + Redis + Temporal Server + Temporal UI |
| Monitoring | Custom prom-client | Temporal Server built-in metrics + Temporal UI |
| Admin system page | BullMQ queue management UI | Removed (use Temporal UI directly) |

### Dependencies

| | Removed | Added |
|--|---------|-------|
| `apps/web` | `bullmq` | `@temporalio/client` |
| `apps/worker` | `bullmq`, `prom-client` | `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity` |
| New package | — | `packages/temporal` with `@temporalio/common` |

### Infrastructure

Redis remains for: pub/sub, rate limiting, scoreboard sorted sets, submit cooldown, hot data cache.

Temporal Server shares existing PostgreSQL (separate databases: `temporal`, `temporal_visibility`).

## Temporal SDK

TypeScript SDK — consistent with existing codebase, shared Zod schemas and Prisma client.

## Task Queues

| Task Queue | Purpose | Worker Requirements |
|------------|---------|---------------------|
| `judge` | Submission judging, rejudge | Docker/K8s access for sandbox |
| `platform` | Contest/assessment lifecycle, plagiarism | DB + network only |

## Workflow Definitions

### 1. SubmissionJudgeWorkflow

```
Input: submissionId + SubmissionDraft
Query: getStatus() → queued | compiling | running | completed | failed

Activities:
  1. fetchJudgeContext()        // DB: problem config, test cases
  2. executeSandbox()           // Docker/K8s sandbox execution
  3. completeSubmission()       // DB: write verdict, score, runtime
  4. updateContestScores()      // DB + Redis Sorted Set (if applicable)
  5. updateUserStats()          // DB: user statistics
  6. publishVerdict()           // Redis pub/sub → SSE notification
```

### 2. RejudgeWorkflow

```
Input: problemId + optional filter (contestId/assessmentId)
Query: getProgress() → completed / total

Activities:
  1. fetchSubmissionIds()       // DB: query submissions to rejudge

Child Workflows:
  2. Start SubmissionJudgeWorkflow per submissionId (parallel, controlled concurrency)
```

### 3. ContestLifecycleWorkflow

```
Input: contestId
Signal: adminOverride (early end, extend time)

Steps:
  1. Timer → wait until startsAt
  2. Activity: activateContest() + publishEvent(SSE_CONTEST_STARTING)
  3. Timer → wait until freezeTime (if set)
  4. Activity: freezeScoreboard()
  5. Timer → wait until endsAt
  6. Activity: finalizeContest() + publishEvent(SSE_CONTEST_ENDING)
```

### 4. AssessmentLifecycleWorkflow

```
Input: assessmentId

Steps:
  1. Timer → wait until opensAt
  2. Activity: activateAssessment()
  3. Timer → wait until dueAt - N hours
  4. Activity: publishEvent(SSE_ASSIGNMENT_DEADLINE)
  5. Timer → wait until closesAt
  6. Activity: closeAssessment()
```

### 5. PlagiarismCheckWorkflow

```
Input: assessmentId or contestId
Query: getProgress() → pending | running | completed

Activities:
  1. fetchSubmissions()           // DB: all accepted submissions
  2. groupByProblemAndLang()      // Group for MOSS
  3. submitToMoss()               // MOSS API (retryable)
  4. generateSimilarityReport()   // Pairwise comparison
  5. saveReport()                 // DB: write report
```

## Redis Design

### Key Naming Convention

`nojv:{domain}:{identifier}`

### 1. Pub/Sub (existing, unchanged)

```
Channel: user:{userId}
Events: submission:verdict, contest:starting, contest:ending, assignment:deadline
```

### 2. Rate Limiting

```
Key: nojv:rl:{endpoint}:{userId}
Backend: RateLimiterRedis (rate-limiter-flexible)
Purpose: API rate limiting shared across web instances
```

### 3. Scoreboard (Sorted Set)

```
Key: nojv:scoreboard:{contestId}

ICPC: score = solvedCount * 1e9 - penaltySeconds
IOI:  score = totalPoints

Write: ZADD on updateContestScores Activity
Read:  ZREVRANGE for scoreboard API
Freeze: RENAME to nojv:scoreboard:{contestId}:frozen
```

### 4. Submit Cooldown

```
Key: nojv:cooldown:{userId}:{problemId}
TTL: cooldown seconds

Logic: SET ... EX {seconds} NX
  Success → allow submit
  Failure → reject (cooling down)
```

### 5. Hot Data Cache

```
Keys:
  nojv:cache:problems:list          TTL 5 min
  nojv:cache:problem:{slug}         TTL 5 min
  nojv:cache:contest:{slug}         TTL 1 min
  nojv:cache:course:{slug}          TTL 5 min

Strategy: Cache-aside
  Read:  Redis → miss → DB → write Redis
  Write: Update DB → delete Redis key
```

## Project Structure

### New Package: `packages/temporal`

```
packages/temporal/
├── src/
│   ├── workflows/
│   │   ├── submission-judge.ts
│   │   ├── rejudge.ts
│   │   ├── contest-lifecycle.ts
│   │   ├── assessment-lifecycle.ts
│   │   └── plagiarism-check.ts
│   ├── activities/
│   │   ├── judge.ts               # fetchJudgeContext, executeSandbox, completeSubmission
│   │   ├── contest.ts             # activateContest, freezeScoreboard, finalizeContest, updateScores
│   │   ├── assessment.ts          # activateAssessment, closeAssessment
│   │   ├── stats.ts               # updateUserStats
│   │   ├── plagiarism.ts          # fetchSubmissions, submitToMoss, generateReport
│   │   ├── notification.ts        # publishVerdict, publishEvent (Redis pub/sub)
│   │   └── redis.ts               # scoreboard sorted set, cache invalidation
│   ├── task-queues.ts             # Task queue name constants
│   ├── types.ts                   # Workflow input/output types, Query/Signal definitions
│   └── client.ts                  # Temporal Client factory helper
├── package.json
└── tsconfig.json
```

### `apps/worker` Changes

```
Modified:
  worker-app.ts       → Temporal Worker init (register workflows + activities, listen on both task queues)
  health-server.ts    → Check Temporal Worker connection status
  services/redis.ts   → Expand: pub/sub + sorted set + cache + cooldown

Deleted:
  processors/submission.ts   → replaced by temporal activities
  metrics.ts                 → replaced by Temporal built-in metrics

Unchanged:
  services/executor-factory.ts
  services/docker-executor.ts
  services/k8s-executor.ts
```

### `apps/web` Changes

```
Modified:
  src/lib/server/queue.ts                                → startSubmissionJudgeWorkflow() via Temporal Client
  src/lib/server/redis.ts                                → Add scoreboard, cache, cooldown operations
  src/routes/api/submissions/[submissionId]/stream/      → Temporal workflow.query(getStatus)
  src/routes/api/plagiarism/[assessmentId]/              → startPlagiarismCheckWorkflow(), query progress
  
Deleted:
  src/routes/(app)/admin/system/                         → Use Temporal UI instead
```

## Docker Compose

```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports: ["5432:5432"]

  redis:
    image: redis:8-alpine
    ports: ["6379:6379"]

  temporal:
    image: temporalio/auto-setup:latest
    ports: ["7233:7233"]
    depends_on: [postgres]
    # Uses same PostgreSQL with separate databases

  temporal-ui:
    image: temporalio/ui:latest
    ports: ["8080:8080"]
    depends_on: [temporal]
    environment:
      TEMPORAL_ADDRESS: temporal:7233
```

## Environment Variables

```
Added:
  TEMPORAL_ADDRESS=temporal:7233
  TEMPORAL_NAMESPACE=default
  WORKER_MODE=all  → "all" | "judge" | "platform" (microservice deployment)

Kept:
  DATABASE_URL, REDIS_URL, EXECUTION_BACKEND, SANDBOX_IMAGE, SANDBOX_*
  WORKER_CONCURRENCY  → repurposed for Temporal maxConcurrentActivityTaskExecutions
```

## Migration Phases

### Phase 1: Infrastructure
- Docker Compose: add Temporal Server + Temporal UI
- Create `packages/temporal` package
- Temporal Client helper

### Phase 2: Submission Judge Migration
- SubmissionJudgeWorkflow + Activities
- Web: dispatchJob → startWorkflow
- Submission polling → workflow query
- Remove BullMQ dependency

### Phase 3: Redis Features
- Rate limiting Redis backend
- Scoreboard Sorted Set
- Submit cooldown (cross-instance)
- Hot data cache (cache-aside)

### Phase 4: New Workflows
- ContestLifecycleWorkflow
- AssessmentLifecycleWorkflow
- PlagiarismCheckWorkflow
- RejudgeWorkflow

### Phase 5: Cleanup
- Remove admin system monitoring page
- Remove prom-client
- Remove all BullMQ residual code
