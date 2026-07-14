# Reliability Invariants

## Service Level Objectives

Live SLO dashboards are at <https://takalawang.grafana.net> (see [Observability Setup Runbook](../runbooks/observability-setup.md) for access). Each row's Notes column links to the relevant dashboard.

Every SLO is stated as an end-to-end user-visible metric (not a component internal), so a regression in any tier (app / Temporal / sandbox / DB) shows up in the same table.

> The targets below are **provisional, conservative heuristics** — they alert
> (they don't cap functionality), and they are deliberately lenient so they
> only fire on genuine regressions. Validate and tighten them against measured
> p95/p99 distributions once the platform carries sustained production traffic.

| SLO                                                         | Target      | Window              | Notes                                                                                                                                                                             |
| ----------------------------------------------------------- | ----------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Judge latency (simple problem, ≤ 20 testcases)              | p95 < 15s   | Rolling 7 days      | Measured from `submission.createdAt` to verdict visible via API / SSE. Dashboard: [NOJV — Judge Latency](https://takalawang.grafana.net/d/nojv-judge-latency)                     |
| Judge latency (complex problem, > 20 testcases or advanced) | p95 < 60s   | Rolling 7 days      | Advanced-mode (custom docker image) may need higher ceiling per problem. Dashboard: [NOJV — Judge Latency](https://takalawang.grafana.net/d/nojv-judge-latency) (`mode=advanced`) |
| API latency (all `/api/*` GET)                              | p99 < 500ms | Rolling 1 day       | Excludes `/api/*/stream` (SSE). Dashboard: [NOJV — API Latency](https://takalawang.grafana.net/d/nojv-api-latency)                                                                |
| SSE connection stability                                    | 99.5%       | Rolling 1 day       | Share of established connections not dropped by server-side faults. Dashboard: [NOJV — Exam Proctoring](https://takalawang.grafana.net/d/nojv-exam-proctoring) (SSE panels)       |
| Platform availability                                       | 99.5%       | Monthly             | Down = web OR worker OR sandbox tier fully unavailable. Composed from request-rate + 5xx panels on [NOJV — API Latency](https://takalawang.grafana.net/d/nojv-api-latency)        |
| Scoreboard update latency                                   | p95 < 3s    | Contest in progress | From final AC verdict commit to updated entry returned by `getScoreboard`. Dashboard: [NOJV — Scoreboard Update](https://takalawang.grafana.net/d/nojv-scoreboard)                |
| Temporal workflow success rate (non-user errors)            | 99.9%       | Rolling 7 days      | Excludes app-level `ValidationError` / expected user-facing failures. Throughput panel on [NOJV — Judge Latency](https://takalawang.grafana.net/d/nojv-judge-latency)             |

**Handling SLO violations:**

- **Minor** (< 10% of samples in the window exceed target): fire an alert, append to the incident log, triage in the next on-call sync. No immediate user-facing action.
- **Major** (> 50% of samples exceed target, or any availability SLO burned below target for the window): treat as an active incident — follow [Incident Recovery Runbook](../runbooks/incident-recovery.md) and prioritise mitigation over root-cause hunting.

### Telemetry pipeline

`apps/web` and `apps/worker` boot an OpenTelemetry SDK on startup via top-of-file side-effect imports (`apps/web/src/lib/server/otel.ts`, `apps/worker/src/otel.ts`). Each process pushes histogram + counter metrics to Grafana Cloud Hosted Prometheus over OTLP HTTP (region `prod-ap-northeast-0`, free tier). Auto-instrumentation hooks `http`, `pg`, `ioredis`, and `undici`; `fs` and `dns` are disabled to keep noise down. Trace export is intentionally off (`spanProcessors: []`) — metrics-only is the design today; logs continue to flow through GCP Cloud Logging on a separate path.

Five manual SLO metrics are emitted from app code: `judge_latency_seconds`, `api_request_duration_seconds`, `scoreboard_update_latency_seconds`, `sse_connection_duration_seconds`, `sse_connection_dropped_total`. Web probes use a separate `health_probe_duration_seconds` histogram with only fixed `probe` (`live`, `ready`, `health`) and `result` (`success`, `failure`) labels; probe traffic is deliberately excluded from `api_request_duration_seconds` so it cannot distort API latency or error-rate SLOs. Worker SIGTERM awaits `shutdownOtel()` so the last 30 s metric interval is flushed before exit; the web tier relies on adapter-node lifecycle and may lose 0–30 s on shutdown (accepted). Token rotation, dashboard updates, and the exact PromQL behind each panel are documented in [Observability Setup Runbook](../runbooks/observability-setup.md).

### Infrastructure health (node / disk / DB)

App SLO metrics don't cover the host. To close the detection gap behind the 2026-07-04 disk-full incident (node disk filled → containerd wedged → CNPG evicted → deploy stuck), the chart ships a `node_exporter` DaemonSet gated by `observability.prometheus.nodeExporter.enabled` (ON in `values-single-machine.yaml`); the in-cluster Prometheus scrapes it via a static `node-exporter` job. Three infra alert rules live in `infra/grafana/alerts/slo-alerts.json`:

- **`nojv-node-disk-usage`** (critical) — fires at >80% filesystem usage. Active as soon as node-exporter metrics reach the alert datasource.
- **`nojv-pg-not-ready`** (critical) — fires when a CloudNativePG instance fails scrape. **Dormant until a CNPG metrics target (`job=cnpg-postgres`) is scraped** — CNPG exposes per-instance metrics on `:9187`; wire them via a `PodMonitor` (kube-prometheus) or a `kubernetes_sd` scrape into whichever Prometheus the Grafana alert datasource reads. Until then the rule sits in `NoData`/OK (harmless).
- **`nojv-pg-backup-stale`** (warning) — fires when the last CNPG base backup is >26 h old. The production single-machine overlay enables CNPG backup and fails closed until its off-host destination is supplied, so this alert must have data after the first successful backup.

Note the two Prometheus paths: app metrics flow to **Grafana Cloud** (OTLP), while the in-cluster Prometheus is a local TSDB feeding the in-cluster Grafana. `node_filesystem_*` lands in the local Prometheus; make the alert datasource read the Prometheus that actually holds the series (or `remote_write` the in-cluster Prometheus to Grafana Cloud).

The same alert catalog includes **`nojv-notification-email-dead`** (critical), sourced from the app-side `durable_work_outcomes_total` metric. It fires when an at-least-once SMTP delivery exhausts its database-owned retries. A deterministic `Message-ID` helps downstream systems recognize a retry, but SMTP provides no atomic handoff with PostgreSQL: a worker crash after SMTP acceptance and before durable completion can send the same message again.

## Service Expectations

| Property               | Guarantee                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Durability**         | PostgreSQL is the source of truth (app data **and** Temporal workflow state, in the same in-cluster cluster). Redis is derived/ephemeral. The production single-machine overlay enables CNPG base backups + WAL archiving and the MinIO mirror, then deliberately refuses to render until concrete off-host S3/R2 destinations and existing credential Secrets are supplied through the cluster-owned `nojv-production-values` Secret. Verify a completed base backup, current WAL archiving, a successful MinIO mirror job, and the recovery drill before launch. Also keep an off-host copy of `nojv-runtime-secrets` (`BETTER_AUTH_SECRET` etc.). On GKE the managed Cloud SQL alternative is configured by `infra/gcp/scripts/setup-backups.sh` (automated daily backups, 30-day retention, in-region) + PITR (14-day WAL), with daily cold exports to a versioned GCS bucket via `infra/gcp/scripts/export-postgres-to-gcs.sh`. See [Backup & Restore Runbook](../runbooks/backup-restore.md). |
| **Delivery semantics** | Temporal activities and database-owned durable work execute at least once. Notification email resolves the current account, verified address, notification existence, and effective preference immediately before SMTP. SMTP delivery remains explicitly **at least once**: a crash after SMTP acceptance but before PostgreSQL completion can duplicate a message. The stable `Message-ID` is a downstream deduplication hint, not an exactly-once guarantee.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Inspectability**     | Temporal UI provides workflow history, pending activities, and query state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Graceful shutdown**  | Worker handles SIGINT/SIGTERM and stops polling for new tasks. In-flight judge activities are **not** fully drained: the worker `shutdownGraceTime` is 30 s while a single judge can run up to ~10 min, so any judge still executing at SIGTERM is cancelled and re-dispatched by Temporal on the next available worker (at-least-once retry makes this safe). Raising `shutdownGraceTime` toward the max judge wall-time would let more in-flight judges finish instead of retrying.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Source of Truth

PostgreSQL is the single durable store. All other systems derive from it:

- **Redis**: pub/sub for SSE events (including 10 s-throttled scoreboard-update nudges); rate limiting. Leaderboards are computed from Postgres on read, not stored in Redis. No general domain cache layer (the only `nojv:cache:*` key is the admin dashboard snapshot).
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
**Note**: If Temporal is unavailable while the web layer dispatches a new submission, the already-created row is marked `system_error` before the API rethrows. Submissions whose workflows had already started resume when Temporal recovers.

> **SPOF caveat (current self-hosted topology).** The in-cluster Temporal control plane runs as a **single** `temporalio/auto-setup` replica backed by a **single-pod** `temporal-postgres` StatefulSet — there is no HA failover. Interim guards are in place: a PodDisruptionBudget (`minAvailable: 1`) on both pods and a `nodeSelector: nojv-role=worker` pin (so a sandbox-pool scale-down can't evict them), plus a daily `pg_dump` of the Temporal DB to GCS (installed by `infra/gcp/scripts/setup-backups.sh`). These limit voluntary disruption and data loss but do not provide live failover — a node failure still pauses all workflows until the pod reschedules.
>
> **Production hardening:** the durable fix is either Temporal Cloud (managed, 99.9% SLA, from ~$100/mo — switching is config-only since the client now supports TLS + API-key/mTLS auth via `TEMPORAL_API_KEY` / `TEMPORAL_CLIENT_CERT_PATH`) or self-host HA via the official `temporalio/temporal` Helm chart (frontend/history/matching at `replicas >= 2`) backed by an HA Cloud SQL Postgres instance. Options, cost comparison, and a starting Helm values file are in [Temporal HA Production](../../infra/gcp/gke/temporal/HA-PRODUCTION.md). The interim guards above are a stopgap for single-region educational deploys.

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
2. Temporal workflow ID is deterministic and unique per submission: `judge-{submissionId}`. A re-dispatch of the same submission collides on the workflow ID and is rejected by Temporal (`WorkflowExecutionAlreadyStarted`), so a submission is never judged twice concurrently. (Note: if the web process crashes after creating the row but before dispatch, the row stays `queued` until the stale-submission sweeper recovers it — up to the pending-timeout window.)
3. `completeSubmission` activity writes the final verdict to DB. This is the commit point.
4. User stats and contest scores are updated after the verdict is committed.
5. SSE notification is best-effort — the client falls back to polling Temporal/DB.
6. A singleton cron workflow (`submissionSweeperWorkflow`, every minute) runs `sweepStaleSubmissions`: any submission stuck in `pending_upload`/`queued`/`compiling`/`running` past the configurable pending timeout (default 30 min, set at `/admin/rejudges`) is terminated and marked `system_error`. The workflow is terminated **before** the status flip when a workflow may exist, so a still-alive workflow cannot overwrite the verdict afterward. Because all `system_error` verdicts are not counted against the daily attempt limit, a swept submission effectively returns the student's attempt.

### Contest Lifecycle

1. `contestLifecycleWorkflow` manages the full contest timeline with durable timers.
2. Early-end / reschedule is applied by re-dispatching the lifecycle workflow with `workflowIdConflictPolicy: TERMINATE_EXISTING` (not via a signal), so the new schedule supersedes the old one.
3. Scoreboard freeze is a read-time filter gated by the `Contest.frozenBoard` / `Contest.frozenAt` columns: while frozen, `buildScoreboard` ignores submissions newer than `frozenAt`, so the public board holds at the freeze point while staff can still see the live ranking. No Redis snapshot is involved.
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
| Web        | `/api/livez`         | Startup/liveness probe. Dependency-free HTTP GET → `{ alive: true }`; never waits on PostgreSQL, Redis, Temporal, auth, or session state.         |
| Web        | `/api/readyz`        | Readiness probe. `{ ready: boolean }`; concurrently probes only PostgreSQL + Redis with bounded timeouts. Results are cached 5 s.                 |
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
