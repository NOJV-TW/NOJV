# Reliability Invariants

## Service Level Objectives

Live SLO dashboards are at <https://takalawang.grafana.net> (see [Observability Setup Runbook](runbooks/observability-setup.md) for access). Each row's Notes column links to the relevant dashboard.

Every SLO is stated as an end-to-end user-visible metric (not a component internal), so a regression in any tier (app / Temporal / sandbox / DB) shows up in the same table.

> The targets below are **provisional, conservative heuristics** — they alert
> (they don't cap functionality), and they are deliberately lenient so they
> only fire on genuine regressions. Validate and tighten them against measured
> p95/p99 distributions once the platform carries sustained production traffic.

| SLO                                                         | Target      | Window              | Notes                                                                                                                                                                             |
| ----------------------------------------------------------- | ----------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Judge latency (simple problem, ≤ 20 testcases)              | p95 < 15s   | Rolling 7 days      | Measured from `submission.createdAt` to verdict visible via API / SSE. Dashboard: [NOJV — Judge Latency](https://takalawang.grafana.net/d/nojv-judge-latency)                     |
| Judge latency (complex problem, > 20 testcases or advanced) | p95 < 60s   | Rolling 7 days      | Advanced-mode (custom docker image) may need higher ceiling per problem. Dashboard: [NOJV — Judge Latency](https://takalawang.grafana.net/d/nojv-judge-latency) (`mode=advanced`) |
| API latency (all `/api/*` GET)                              | p99 < 500ms | Rolling 1 day       | Excludes `/api/*/stream` (SSE) and `/api/exam-sessions/[examId]/heartbeat`. Dashboard: [NOJV — API Latency](https://takalawang.grafana.net/d/nojv-api-latency)                    |
| SSE connection stability                                    | 99.5%       | Rolling 1 day       | Share of established connections not dropped by server-side faults. Dashboard: [NOJV — Exam Proctoring](https://takalawang.grafana.net/d/nojv-exam-proctoring) (SSE panels)       |
| Platform availability                                       | 99.5%       | Monthly             | Down = web OR worker OR sandbox tier fully unavailable. Composed from request-rate + 5xx panels on [NOJV — API Latency](https://takalawang.grafana.net/d/nojv-api-latency)        |
| Scoreboard update latency                                   | p95 < 3s    | Contest in progress | From final AC verdict commit to updated entry returned by `getScoreboard`. Dashboard: [NOJV — Scoreboard Update](https://takalawang.grafana.net/d/nojv-scoreboard)                |
| Temporal workflow success rate (non-user errors)            | 99.9%       | Rolling 7 days      | Excludes app-level `ValidationError` / expected user-facing failures. Throughput panel on [NOJV — Judge Latency](https://takalawang.grafana.net/d/nojv-judge-latency)             |
| Exam session heartbeat miss rate                            | < 1%        | Exam in progress    | A miss = > 30s gap without a heartbeat from an active session. Dashboard: [NOJV — Exam Proctoring](https://takalawang.grafana.net/d/nojv-exam-proctoring) (heartbeat panel)       |

**Handling SLO violations:**

- **Minor** (< 10% of samples in the window exceed target): fire an alert, append to the incident log, triage in the next on-call sync. No immediate user-facing action.
- **Major** (> 50% of samples exceed target, or any availability SLO burned below target for the window): treat as an active incident — follow [Incident Recovery Runbook](runbooks/incident-recovery.md) and prioritise mitigation over root-cause hunting.

### Telemetry pipeline

`apps/web` and `apps/worker` boot an OpenTelemetry SDK on startup via top-of-file side-effect imports (`apps/web/src/lib/server/otel.ts`, `apps/worker/src/otel.ts`). Each process pushes histogram + counter metrics to Grafana Cloud Hosted Prometheus over OTLP HTTP (region `prod-ap-northeast-0`, free tier). Auto-instrumentation hooks `http`, `pg`, `ioredis`, and `undici`; `fs` and `dns` are disabled to keep noise down. Trace export is intentionally off (`spanProcessors: []`) — metrics-only is the design today; logs continue to flow through GCP Cloud Logging on a separate path.

Six manual SLO metrics are emitted from app code: `judge_latency_seconds`, `api_request_duration_seconds`, `scoreboard_update_latency_seconds`, `sse_connection_duration_seconds`, `sse_connection_dropped_total`, `exam_heartbeat_miss_total`. Worker SIGTERM awaits `shutdownOtel()` so the last 30 s metric interval is flushed before exit; the web tier relies on adapter-node lifecycle and may lose 0–30 s on shutdown (accepted). Token rotation, dashboard updates, and the exact PromQL behind each panel are documented in [Observability Setup Runbook](runbooks/observability-setup.md).

## Service Expectations

| Property              | Guarantee                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Durability**        | PostgreSQL is the source of truth. Redis and Temporal are derived/ephemeral. Production Cloud SQL is configured by `infra/gcp/scripts/setup-backups.sh` (automated daily backups, 30-day retention, in-region) + PITR (14-day WAL). Daily cold exports to a versioned GCS bucket run via `infra/gcp/scripts/export-postgres-to-gcs.sh` (Cloud Scheduler → Cloud Run Job). See [Backup & Restore Runbook](runbooks/backup-restore.md). |
| **Idempotency**       | Temporal activities are designed for at-least-once execution with retry.                                                                                                                                                                                                                                                                                                                                                              |
| **Inspectability**    | Temporal UI provides workflow history, pending activities, and query state.                                                                                                                                                                                                                                                                                                                                                           |
| **Graceful shutdown** | Worker handles SIGINT/SIGTERM, drains in-flight activities before exit.                                                                                                                                                                                                                                                                                                                                                               |

## Source of Truth

PostgreSQL is the single durable store. All other systems derive from it:

- **Redis**: Scoreboard sorted sets rebuilt from DB on miss; pub/sub for SSE events. No general domain cache layer (the only `nojv:cache:*` key is the admin dashboard snapshot).
- **Temporal**: Workflow state is durable within Temporal, but final verdicts are persisted to PostgreSQL.
- **SSE events**: Ephemeral notifications. Clients reconnect and read latest state from DB/Temporal.

If Redis is lost, the system continues with degraded performance (no cache, no real-time events). Scoreboards can be rebuilt from `ContestParticipation` records.

## Critical Failure Modes

### PostgreSQL Unavailable

**Impact**: Total service outage. No reads, writes, or auth.
**Mitigation**: Cloud SQL HA (automatic failover). Connection pooling via Prisma.
**Recovery**: Wait for automatic failover or manual promotion.

### Redis Unavailable

**Impact**: Degraded — no real-time SSE events and no live scoreboard ZSET; the scoreboard read path falls back to rebuilding from PostgreSQL. Submission cooldown enforcement is unaffected (it uses PostgreSQL advisory locks, not Redis).
**Mitigation**: Memorystore HA (automatic failover).
**Recovery**: Automatic failover. Scoreboard ZSETs rebuild on first write.
**Note**: Submissions still process (Temporal handles orchestration). SSE clients reconnect.

### Temporal Unavailable

**Impact**: No new workflows start. In-flight workflows pause.
**Mitigation**: Temporal auto-setup with PostgreSQL backend provides persistence.
**Recovery**: Temporal resumes all paused workflows when it comes back. No data loss.
**Note**: Submissions already in DB with `queued` status will be picked up when Temporal recovers.

### Worker Unavailable

**Impact**: No submission judging, no lifecycle transitions.
**Mitigation**: Temporal retries activities when workers reconnect. Workers run as a static GKE Deployment with a PodDisruptionBudget (KEDA-based autoscaling removed in commit `c1ed096`); pending workflows queue in Temporal until capacity returns.
**Recovery**: Start new worker. Temporal automatically dispatches pending activities.

### Sandbox Failure

**Impact**: Individual submission fails with System Error (SE).
**Mitigation**: Temporal retries (3 attempts for judge activities). Container recreation on failure.
**Recovery**: Automatic retry. If persistent, check Docker daemon or K8s node health.

## Operational Invariants

### Submission Processing

1. Every submission gets a `Submission` record in PostgreSQL before Temporal dispatch.
2. Temporal workflow ID is deterministic: `judge-{submissionId}`. Duplicate dispatches are idempotent.
3. `completeSubmission` activity writes the final verdict to DB. This is the commit point.
4. User stats and contest scores are updated after the verdict is committed.
5. SSE notification is best-effort — the client falls back to polling Temporal/DB.
6. A singleton cron workflow (`submissionSweeperWorkflow`, every minute) runs `sweepStaleSubmissions`: any submission stuck in `queued`/`compiling`/`running` past the configurable pending timeout (default 30 min, set at `/admin/rejudges`) is terminated and marked `system_error`. The workflow is terminated **before** the status flip so a still-alive workflow cannot overwrite the verdict afterward. Because all `system_error` verdicts are not counted against the daily attempt limit, a swept submission effectively returns the student's attempt.

### Contest Lifecycle

1. `contestLifecycleWorkflow` manages the full contest timeline with durable timers.
2. Admin override signals (early end, extend) are processed atomically within the workflow.
3. Scoreboard freeze creates a Redis snapshot in a separate frozen key (copy via `ZRANGE`+`ZADD`). The live key keeps updating so admins see real-time scores; `getScoreboard` prefers the frozen key when it exists, so public viewers see the snapshot until `unfreezeScoreboard` deletes it.
4. Final scores are always computed from PostgreSQL, not Redis.

### Assessment Lifecycle

1. Assessments have no dedicated lifecycle workflow. Open → due → close is purely time-driven: submission acceptance is gated by the `closesAt` timestamp, checked server-side in the domain layer on every submit.
2. Deadline notifications are best-effort (SSE via Redis pub/sub).
3. Exam timing is the exception — exams use `examAutoCloseWorkflow` (a durable Temporal timer keyed on `examId`) to force-close active sessions at `endsAt`.

### Plagiarism Detection

1. `plagiarismCheckWorkflow` takes `(targetType, targetId)` directly; the workflow is keyed `plagiarism-{targetType}-{targetId}` with `TERMINATE_EXISTING` id-reuse, so a re-trigger replaces any in-flight run rather than duplicating it. There is no separate report record created up front.
2. Dolos runs entirely in-process; retries are idempotent and produce the same pair set on the same input.
3. The Dolos report itself is inlined on the `Exam` / `Assessment` row as `plagiarism*` columns and is wiped on each re-trigger.
4. Pair-level staff review state (false-positive marking) survives re-runs in the `PlagiarismPairFlag` table, keyed `(contextType, contextId, pairKey)`. Each run is recorded in `PlagiarismTriggerLog`.

## Validation Requirements

- All user input validated with Zod schemas before processing
- Prisma parameterized queries for all database access
- Temporal activity inputs are typed but not re-validated (trusted internal boundary)
- Seed data validated before insertion (`pnpm db:seed:validate`)

## Health Checks

| Service    | Endpoint             | Method                                                                                                                                            |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web        | `/api/healthz`       | Public LB probe. HTTP GET → `{ ok: boolean }` with 200 healthy / 503 not. Body is intentionally minimal; topology is not leaked.                  |
| Web        | `/api/admin/healthz` | Admin-only mirror. `requireApiAuth` + `platformRole === "admin"`. Returns `{ status, checks: { postgres, redis, temporal } }` for ops dashboards. |
| Worker     | `/healthz`           | Liveness. Returns `{ status, checks: { postgres, redis, temporal } }` with 200/503. Internal — exposed only inside the cluster.                   |
| Worker     | `/readyz`            | Readiness. Returns `{ ready: boolean }` keyed on the live Temporal connection. 503 when disconnected so K8s pulls the pod out of the ready pool.  |
| PostgreSQL | Docker healthcheck   | `pg_isready -U postgres`                                                                                                                          |
| Redis      | Docker healthcheck   | `redis-cli ping`                                                                                                                                  |
| Temporal   | Docker healthcheck   | `temporal`/`tctl` health against localhost, service DNS, and container IP                                                                         |

## Related Docs

- [Architecture Overview](../architecture/ARCHITECTURE.md)
- [Security Requirements](./SECURITY.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Incident Recovery Runbook](../runbooks/incident-recovery.md)
