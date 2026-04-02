# Temporal Workflows

All background job processing uses Temporal for durable workflow orchestration. The `@nojv/temporal` package defines workflows and activities; the `apps/worker` service executes them.

## Task Queues

| Queue      | Purpose                                         | Worker Mode         |
| ---------- | ----------------------------------------------- | ------------------- |
| `judge`    | Submission judging, sandbox execution           | `judge` or `all`    |
| `platform` | Contest/assessment lifecycle, plagiarism, stats | `platform` or `all` |

In development, `WORKER_MODE=all` runs both queues in a single process. In production, separate workers can scale independently.

## Workflows

### submissionJudgeWorkflow

**Queue**: `judge`
**Input**: `{ submissionId, draft: { mode, problemSlug, language, sourceCode } }`
**Query**: `getStatus()` → `queued | compiling | running | completed | failed`
**Workflow ID**: `judge-{submissionId}`

```
queued → compiling → running → completed
           │            │          │
  fetchJudgeContext  executeSandbox  ├── completeSubmission
                                    ├── updateContestScores (if contest)
                                    ├── updateUserStats
                                    └── publishVerdict
```

Status transitions:

1. **queued → compiling**: Fetch problem, testcases, and judge configuration from DB
2. **compiling → running**: Execute code in sandbox container (Docker/K8s)
3. **running → completed**: Write verdict to DB, update contest scores if applicable, update user stats, publish SSE event

The web app polls status via `workflow.query("getStatus")` on the `/api/submissions/[id]/stream` endpoint, with DB fallback if the workflow has already completed.

### rejudgeWorkflow

**Queue**: `judge`
**Input**: `{ problemId, contestId?, assessmentId? }`
**Query**: `getProgress()` → `{ completed, total }`
**Workflow ID**: `rejudge-{problemId}-{timestamp}`

Fan-out pattern: fetches all matching submission IDs, then spawns child `submissionJudgeWorkflow` instances in batches of 10 using `executeChild`.

### contestLifecycleWorkflow

**Queue**: `platform`
**Input**: `{ contestId }`
**Signal**: `adminOverride` → `{ action: "earlyEnd" } | { action: "extend", newEndsAt: string }`
**Workflow ID**: `contest-lifecycle-{contestId}`

```
start → sleep(startsAt) → activateContest
                                │
                    sleep(frozenAt) → freezeScoreboard
                                │
                    sleep(endsAt) → finalizeContest
```

- Uses `condition()` to listen for admin override signals during sleep
- `earlyEnd` signal skips remaining timers and immediately finalizes
- `extend` signal updates the end time and resets the timer
- Publishes SSE events: `SSE_CONTEST_STARTING`, `SSE_CONTEST_ENDING`

### assessmentLifecycleWorkflow

**Queue**: `platform`
**Input**: `{ assessmentId }`
**Workflow ID**: `assessment-lifecycle-{assessmentId}`

```
start → sleep(opensAt) → activateAssessment
                              │
                  sleep(dueAt - N) → publishAssessmentDeadline
                              │
                  sleep(closesAt) → closeAssessment
```

### plagiarismCheckWorkflow

**Queue**: `platform`
**Input**: `{ reportId, targetId, targetType, triggeredById }`
**Query**: `getProgress()` → `pending | running | completed | failed`
**Workflow ID**: `plagiarism-{reportId}`

The web endpoint creates the `PlagiarismReport` DB record first and passes the `reportId` to avoid duplicate creation.

## Activities

### Judge Activities (judge queue)

| Activity                       | Purpose                                                          |
| ------------------------------ | ---------------------------------------------------------------- |
| `fetchJudgeContext`            | Load problem, testcases, templates, pipeline config from DB      |
| `executeSandbox`               | Run code in Docker/K8s sandbox, return verdict                   |
| `completeSubmission`           | Write verdict, score, runtime, memory to DB                      |
| `fetchSubmissionIdsForRejudge` | Query submission IDs for rejudge filtering                       |
| `updateUserStats`              | Update UserStats table (AC count, language dist, daily activity) |

### Platform Activities (platform queue)

**Contest**:
| Activity | Purpose |
|----------|---------|
| `getContestInfo` | Load contest start/end/freeze times |
| `activateContest` | Set contest to active state |
| `freezeScoreboard` | Redis RENAME scoreboard key + update DB |
| `finalizeContest` | Mark contest as completed |
| `updateContestScores` | Calculate score, ZADD to Redis sorted set |

**Assessment**:
| Activity | Purpose |
|----------|---------|
| `getAssessmentInfo` | Load assessment open/due/close times |
| `activateAssessment` | Set assessment to active state |
| `closeAssessment` | Mark assessment as closed |

**Plagiarism**:
| Activity | Purpose |
|----------|---------|
| `runPlagiarismCheck` | Fetch submissions, group by problem/language, submit to MOSS, save report |

**Notification**:
| Activity | Purpose |
|----------|---------|
| `publishVerdict` | Publish submission verdict via Redis pub/sub |
| `publishContestEvent` | Publish contest starting/ending events |
| `publishAssessmentDeadline` | Publish assessment deadline warning |

**Redis**:
| Activity | Purpose |
|----------|---------|
| `updateScoreboard` | ZADD to Redis sorted set |
| `getScoreboard` | ZREVRANGE from Redis sorted set |
| `setCooldown` / `checkCooldown` | Submit rate limiting via SET NX EX |
| `cacheGet` / `cacheSet` / `cacheDel` | Cache-aside pattern |

## Executor Injection

The sandbox executor (Docker or Kubernetes) is injected into judge activities at worker startup via a module-level `setExecutor()` / `getExecutor()` pattern. This keeps activities testable and the executor choice configurable.

```typescript
// In worker-app.ts startup
import { setExecutor } from "@nojv/temporal/activities/judge";
setExecutor(executorFactory(env.EXECUTION_BACKEND));
```

## Client Usage (Web App)

The web app dispatches workflows using `getTemporalClient()`:

```typescript
import { getTemporalClient, JUDGE_TASK_QUEUE } from "@nojv/temporal";

const client = await getTemporalClient();
await client.workflow.start("submissionJudgeWorkflow", {
  taskQueue: JUDGE_TASK_QUEUE,
  workflowId: `judge-${submissionId}`,
  args: [{ submissionId, draft }]
});
```

## Environment Variables

| Variable             | Default          | Purpose                                               |
| -------------------- | ---------------- | ----------------------------------------------------- |
| `TEMPORAL_ADDRESS`   | `localhost:7233` | Temporal Server address                               |
| `TEMPORAL_NAMESPACE` | `default`        | Temporal namespace                                    |
| `WORKER_MODE`        | `all`            | Which task queues to run (`all`, `judge`, `platform`) |
| `WORKER_CONCURRENCY` | `4`              | Activity concurrency per queue                        |

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Judge Pipeline](JUDGE_PIPELINE.md)
- [Redis Architecture](REDIS.md)
- [Deployment Guide](DEPLOYMENT.md)
