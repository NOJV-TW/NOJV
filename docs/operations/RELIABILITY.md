# Reliability Invariants

What must stay true when parts of NOJV fail: SLOs, the durable source of truth,
per-dependency failure behavior, operational invariants, and health checks.
Procedures live in the runbooks: [Incident Recovery](../runbooks/incident-recovery.md),
[Backup & Restore](../runbooks/backup-restore.md), [Observability Setup](../runbooks/observability-setup.md),
[Judge Queue](../runbooks/judge-queue.md).

## Key code

- `apps/web/src/routes/api/{livez,readyz,release}/+server.ts`, `apps/web/src/routes/api/admin/healthz/+server.ts`, `apps/web/src/lib/server/health-probes.ts`
- `apps/worker/src/health-server.ts`, `apps/worker/src/server-lifecycle.ts`, `apps/worker/src/worker-app.ts`
- `apps/web/src/lib/server/otel.ts`, `apps/worker/src/otel.ts`, `apps/web/src/lib/server/metrics.ts`, `apps/worker/src/judge-recovery-metrics.ts`
- `packages/application/src/submission/judge-recovery.ts`, `packages/temporal/src/dispatch.ts`, `packages/temporal/src/lifecycle-reconciliation.ts`
- `infra/grafana/alerts/slo-alerts.json`, `infra/grafana/dashboards/`

## Service level objectives

SLOs are end-to-end, user-visible metrics, so a regression in any tier shows in
the same table. Targets are deliberately lenient alerting thresholds, not
functional caps. Dashboards are at <https://takalawang.grafana.net>; metric
sources, dashboards and provisioning are in [Observability Setup](../runbooks/observability-setup.md).

| SLO                                                         | Target      | Window              | Measurement                                                                                                                                              |
| ----------------------------------------------------------- | ----------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Judge latency (simple problem, ≤ 20 testcases)              | p95 < 15s   | Rolling 7 days      | `judge_latency_seconds{mode="standard"}`, `submission.createdAt` to verdict commit. [Judge Latency](https://takalawang.grafana.net/d/nojv-judge-latency) |
| Judge latency (complex problem, > 20 testcases or advanced) | p95 < 60s   | Rolling 7 days      | `judge_latency_seconds{mode="advanced"}`; an Advanced image may need a higher per-problem ceiling                                                        |
| API latency (all `/api/*` GET)                              | p99 < 500ms | Rolling 1 day       | `api_request_duration_seconds`; excludes SSE streams and health probes. [API Latency](https://takalawang.grafana.net/d/nojv-api-latency)                 |
| SSE connection stability                                    | 99.5%       | Rolling 1 day       | `sse_connection_dropped_total` / closed connections. [Exam Proctoring](https://takalawang.grafana.net/d/nojv-exam-proctoring)                            |
| Platform availability                                       | 99.5%       | Monthly             | Down = web, worker or sandbox tier fully unavailable; request-rate and 5xx panels on API Latency                                                         |
| Temporal workflow success rate (non-user errors)            | 99.9%       | Rolling 7 days      | Excludes `ValidationError` and expected user-facing failures; throughput panel on Judge Latency                                                          |

Scoreboard freshness has no SLO: scoreboards are computed from PostgreSQL at read time behind a 10s cache, and the SSE nudge is throttled to one per 10s per contest (DAT-11), so staleness is bounded by design rather than measured. Verdict-to-persisted-score time is inside judge latency.

Violation handling:

- **Minor** (< 10% of window samples over target): alert, log, triage at the next on-call sync.
- **Major** (> 50% over target, or an availability SLO below target for the window): active incident; follow [Incident Recovery](../runbooks/incident-recovery.md), mitigation before root cause.

### Alert catalog

All rules live in `infra/grafana/alerts/slo-alerts.json` (labels `severity`, `team=nojv`). Rules default to NoData = OK; the judge recovery rules treat missing data as a fault.

| Rule                                          | Severity | Fires when                                                                              |
| --------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `nojv-slo-judge-latency-simple` / `-advanced` | warning  | Judge p95 over 15s / 60s for 10m                                                        |
| `nojv-slo-api-latency`                        | warning  | API p99 over 500ms for 10m                                                              |
| `nojv-slo-sse-stability`                      | warning  | Server-fault SSE drop rate over 0.5% for 15m                                            |
| `nojv-slo-http-error-rate-critical`           | critical | 5xx share over 1% for 5m                                                                |
| `nojv-submissions-stuck`                      | critical | Any stuck execution ([definition](#judge-recovery-monitoring))                          |
| `nojv-judge-queue-age`                        | warning  | Oldest queued/waiting/recovering execution over 10 minutes                              |
| `nojv-judge-recovery-blocked`                 | critical | Any execution in `blocked`                                                              |
| `nojv-judge-legacy-system-errors`             | warning  | Any SE submission without an execution journal                                          |
| `nojv-judge-recovery-observer-stale`          | critical | Last successful recovery snapshot older than 3 minutes, or absent                       |
| `nojv-judge-cleanup-pending`                  | critical | Any `judge_cleanup_pending_total` increase                                              |
| `nojv-judge-wall-clock-timeouts`              | warning  | More than two wall-clock TLEs with CPU under the limit in 10m                           |
| `nojv-notification-email-dead`                | critical | An at-least-once notification email exhausted its database-owned retries                |
| `nojv-node-disk-usage`                        | critical | Node filesystem over 80% for 10m; needs `observability.prometheus.nodeExporter.enabled` |
| `nojv-pg-not-ready`                           | critical | A `job="cnpg-postgres"` target fails scrape for 2m                                      |
| `nojv-pg-backup-stale`                        | warning  | Last CNPG base backup older than 26h                                                    |

App metrics go to Grafana Cloud over OTLP; `node_*` and `cnpg_*` series are
scraped by the in-cluster Prometheus (`node-exporter` and `cnpg-postgres` jobs).
Infra alerts fire only if the alert datasource reads the Prometheus that holds
those series (or the in-cluster Prometheus `remote_write`s to Grafana Cloud).

## Source of truth

PostgreSQL is the only durable store for application data. Everything else is derived or recoverable from it:

| Store          | Role                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL     | App data; on single-machine also Temporal persistence (`temporal`, `temporal_visibility` databases in the same CNPG cluster)                          |
| Object storage | Irreplaceable file bodies: submission sources, judge snapshots and stage results, testcases, workspace files, validators, images (see DAT-06, PRB-04) |
| Temporal       | Durable workflow state; final verdicts and effects are persisted to PostgreSQL                                                                        |
| Redis          | Pub/sub, rate limits, short-lived security proofs and read-through caches only (DAT-10, DAT-11); see [Redis](../architecture/REDIS.md)                |
| SSE events     | Ephemeral nudges; clients reconnect and read current state                                                                                            |

Backups, retention and restore order are in [Backup & Restore](../runbooks/backup-restore.md); production refuses to render without off-host destinations (OPS-06).

## Service expectations

- **Delivery**: Temporal activities and database-owned durable work run at least once. Notification email re-resolves account, verified address, notification and preference right before SMTP. A crash after SMTP acceptance and before completion can duplicate a message; the stable `Message-ID` is a deduplication hint only.
- **Inspectability**: Temporal UI shows workflow history, pending activities and queries.
- **Graceful shutdown**: workers stop polling on SIGINT/SIGTERM with `shutdownGraceTime` 30s. A judge stage can run up to 70 minutes, so a stage still running at SIGTERM is cancelled and recovered on another worker after cleanup and ownership checks. The worker flushes OTel before exit; web may lose the last 0–30s of metrics.

## Critical failure modes

### PostgreSQL unavailable

- **Impact**: total outage; no reads, writes or auth. On single-machine, Temporal also stops.
- **Topology**: single-machine runs one CNPG instance (no failover); GKE uses Cloud SQL through the proxy sidecar.
- **Recovery**: restore the instance (see [Incident Recovery](../runbooks/incident-recovery.md#postgresql-unavailable-or-slow)); Prisma reconnects without an app restart unless the pool is wedged. Data loss goes through [Backup & Restore](../runbooks/backup-restore.md).

### Redis unavailable

- **Impact**: no SSE events. `apiRateLimiter` falls back to a per-process memory limiter; every other limiter (write, draft, form, auth, sign-in, exam sign-in, registry token) fails closed with 503 (DAT-12). Redis-held security proofs (step-up, admin MFA/mode, 2FA setup) are unavailable, so privileged actions require fresh verification. Caches fall through to PostgreSQL. Submission cooldown uses PostgreSQL. Dispatched judging continues.
- **Recovery**: restore connectivity; clients reconnect and read current state. Nothing needs rebuilding.

### Temporal unavailable

- **Impact**: no new workflows; in-flight workflows pause.
- **Invariant**: acceptance commits source, immutable snapshot and dispatch intent before returning. Temporal start is a best-effort wakeup; failure leaves the outbox pending for the minute durable-work processor and never produces SE.
- **Topology**: self-hosted (OPS-09). Single-machine runs the official chart with one pod per role on the CNPG database, so node loss pauses workflows until pods reschedule. HA options: `infra/gcp/gke/temporal/HA-PRODUCTION.md`.
- **Recovery**: workflows resume from history; no data loss.

### Worker unavailable

- **Impact**: no judging or lifecycle transitions; accepted work stays durable in PostgreSQL and Temporal.
- **Topology**: GKE runs two platform workers. Their startup work is safe to run concurrently: `ensure*` starts singletons by fixed workflow ID and keeps a running one, the stale-submission sweep kills only through a conditional status update, and execution recovery enqueues dispatch with `skipDuplicates` and bumps the recovery epoch under row locks after re-checking the owner. The SQL-backed gauges are reported by each replica and alerts read them with `max()`. Single-machine runs one of each worker.
- **Recovery**: Deployments restart failed processes; accepted workflows resume and the outbox dispatches after Temporal is reachable. Node and container-runtime recovery is an operator action. With `pdb.enabled` (GKE), one voluntary eviction at a time.

### Sandbox failure

- Program failures keep their normal verdict. Capacity waits (including quota rejections, even when the message says `forbidden`) stay `waiting_capacity` and retry every 30s without consuming the failure budget.
- Infrastructure failures retry with bounded attempts and workflow timers on the original snapshot; repeated, configuration or cleanup failures become `blocked` with a next retry time. Failed attempts never select new problem content (JDG-09, JDG-11).
- Reading a required payload or result log either succeeds or reports the original I/O failure (retryable); a successfully read but malformed result is an explicit system error. Validator diagnostics stay in staff feedback.
- Contract: [Judge Pipeline](../architecture/JUDGE_PIPELINE.md#durable-execution-and-recovery).

### Sandbox cleanup pending

- Kubernetes cleanup uses foreground deletion with UID preconditions and ownership checks, and waits for owned Pods to disappear within a 30s budget. Timeout, API failure or changed ownership raises `cleanup_pending` (`judge_cleanup_pending_total`).
- Cleanup runs in a non-cancellable scope with persistent retries; the execution lease stays held until cleanup succeeds. Cancellation, heartbeat expiry and worker restarts never prove resources are free (JDG-22).
- API object disappearance is not proof of runtime termination. Directed host cleanup requires matching run ID, Job owner UID, Pod UID, CRI sandbox/container IDs, shim/runsc processes and cgroup; recovery requires those processes and cgroups to be gone. No automatic k3s, containerd or runsc restart. Procedure: [Judge Queue](../runbooks/judge-queue.md#stuck-leases-and-cleanup).

### Ambiguous activity timeouts

- A stage activity heartbeats its database lease every 15s. An expired lease is reconciled by `reconcileJudgeStage` or `judgeCleanupWorkflow`, which confirm executor cleanup before retry.
- A stage attempt that times out without ever heartbeating never ran (Temporal can lose a task dispatched to a shutting-down worker); the workflow requeues it without recording `recovering` or SE. A claimed lease left behind is reconciled on the next iteration.

## Operational invariants

### Submission processing

1. Source, immutable snapshot, execution ownership and dispatch intent commit before the submission ID is returned (PRB-15, JDG-10).
2. Workflow IDs are `judge-execution-{executionId}-{recoveryEpoch}`; duplicate dispatch is idempotent. Automatic recovery changes only the epoch; an explicit teacher rejudge creates a new generation on the latest version.
3. Every stage write and verdict commit is fenced by the current owner. A checkpoint clears the lease only after executor cleanup succeeded.
4. The verdict commits before score and notification effects; the execution stays `finalizing` until they succeed. Cancellation and another rejudge cannot discard a committed result's finalization.
5. The minute sweeper reconciles actual workflow ownership, redispatches missing work and recovers closed workflows without changing snapshots. It terminates, by actual owner ID, a workflow whose failing workflow task has been pending over 10 minutes or whose activity has no progress beyond the 70-minute budget; healthy waits are preserved.
6. Submission reads expose queue/recovery reason, original problem generation, last progress and next retry. Tracking continues through recoverable SE; browser tracking timeouts never cancel accepted work.
7. SE submissions without an immutable snapshot are blocked as `original_version_unavailable`; automatic recovery never substitutes the current version.
8. Priority, per-student fairness and capacity follow [Judge Pipeline](../architecture/JUDGE_PIPELINE.md#queue-priority-and-capacity) (JDG-12, JDG-13). Capacity changes are `WORKER_CONCURRENCY` and the sandbox quota, never a scheduler change (OPS-11).
9. Attempt resources and temporary result objects are owned by run ID with Kubernetes UID checks; cleanup of an old attempt never removes a newer attempt's resources or result.

### Lifecycle workflows

1. Contest lifecycle, exam auto-close and assignment start/due-soon workflows (`contest-lifecycle-{id}`, `exam-auto-close-{id}`, `assignment-due-soon-{id}`) are reconciled by schedule revision and timer fingerprint stored in the workflow memo: a stale revision never replaces a newer one, and a changed schedule terminates the observed run and starts a new one.
2. The 5-minute `lifecycleReconcilerProcessorWorkflow` re-ensures contest, exam and assignment lifecycle workflows from PostgreSQL in pages of 20. Judge redispatch belongs to the minute submission sweeper, not this reconciler.
3. Assessment open/close is time-gated server-side on every submit (`closesAt`); only reminders and exam auto-close use timers.
4. Scoreboard freeze is a read-time filter on `Contest.frozenBoard`/`frozenAt`; final scores are always computed from PostgreSQL.

### Cron processors

Singletons: `submission-pending-sweeper` (minute, `submissionSweeperWorkflow`),
`durable-work-processor` (minute, `durableWorkProcessorWorkflow`) and
`lifecycle-timer-reconciler` (5 minutes, `lifecycleReconcilerProcessorWorkflow`).
The latter two are cron parents that await a child; only the child continues as new, so a child
failure never removes the cron schedule (DAT-19). `ensure*` calls keep an
already-running singleton; workers never replace it on startup. To change a
singleton's workflow type, wait for its current run to be terminal (or reach a
boundary with no pending activity or mutation) before starting the replacement,
then verify the new parent's type, schedule, child completion and next run.
Cancelling a cron run does not stop the series.

### Plagiarism detection

1. `plagiarismCheckWorkflow` is keyed `plagiarism-{targetType}-{targetId}` with `TERMINATE_EXISTING`; a re-trigger replaces an in-flight run.
2. Dolos runs in-process in the worker; retries yield the same pairs for the same input (ASM-23).
3. The report is stored in `plagiarism*` columns on the `Exam`/`Assessment` row and replaced on each run; `PlagiarismPairFlag` review state survives re-runs; each run is logged in `PlagiarismTriggerLog` (ASM-24).

## Validation requirements

- All user input is validated with Zod before processing.
- All database access uses Prisma parameterized queries.
- Temporal activity inputs are typed but not re-validated (trusted internal boundary).
- Seed data is validated before insertion (`pnpm db:seed:validate`).

## Health checks

| Service    | Endpoint             | Contract                                                                                                                                |
| ---------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Web        | `/api/livez`         | Startup/liveness. `{ alive: true }`; no dependency checks.                                                                              |
| Web        | `/api/readyz`        | Readiness. `{ ready }`, 503 when not ready; probes only PostgreSQL and Redis, result cached 5s (OPS-15).                                |
| Web        | `/api/release`       | `{ version, sourceSha }` for release identification.                                                                                    |
| Web        | `/api/admin/healthz` | Admin only. `{ status, checks: { postgres, redis, temporal } }`; 503 when PostgreSQL or Redis fails (Temporal is reported, not gating). |
| Worker     | `/livez`             | 503 only when a worker run loop stopped unexpectedly; never probes dependencies; stays live during graceful drain.                      |
| Worker     | `/healthz`           | Diagnostic `{ status, checks: { postgres, redis, temporal } }`, 200/503; not a restart signal.                                          |
| Worker     | `/readyz`            | `{ ready }`, 503 when the run loop stopped or Temporal is disconnected.                                                                 |
| PostgreSQL | Compose healthcheck  | `pg_isready -U postgres`                                                                                                                |
| Redis      | Compose healthcheck  | `redis-cli ping`                                                                                                                        |
| Temporal   | Compose healthcheck  | `temporal`/`tctl` health against localhost, service DNS and container IP                                                                |

Web probe paths record `health_probe_duration_seconds`, never `api_request_duration_seconds`.

### Judge recovery monitoring

The platform worker publishes SQL-backed gauges (queue depth and oldest wait,
blocked, stuck, legacy SE, last-success timestamp) every 30s, independent of
judge activities. Running stages holding a current lease are excluded from the
stuck count. `nojv_judge_recovery_last_success_timestamp_seconds` advances only
after a validated snapshot; query errors publish neither heartbeats nor false
zeros. Metric definitions and release verification:
[Observability Setup](../runbooks/observability-setup.md#judge-recovery-monitoring).

## Related docs

- [Architecture Overview](../architecture/ARCHITECTURE.md)
- [Judge Pipeline](../architecture/JUDGE_PIPELINE.md)
- [Security Requirements](./SECURITY.md)
- [Deployment Guide](./DEPLOYMENT.md)
