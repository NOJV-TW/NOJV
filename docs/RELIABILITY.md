# Reliability Invariants

## Service Expectations

| Property              | Guarantee                                                                    |
| --------------------- | ---------------------------------------------------------------------------- |
| **Durability**        | PostgreSQL is the source of truth. Redis and Temporal are derived/ephemeral. |
| **Idempotency**       | Temporal activities are designed for at-least-once execution with retry.     |
| **Inspectability**    | Temporal UI provides workflow history, pending activities, and query state.  |
| **Graceful shutdown** | Worker handles SIGINT/SIGTERM, drains in-flight activities before exit.      |

## Source of Truth

PostgreSQL is the single durable store. All other systems derive from it:

- **Redis**: Cache-aside with TTL. Scoreboard sorted sets rebuilt from DB on cache miss.
- **Temporal**: Workflow state is durable within Temporal, but final verdicts are persisted to PostgreSQL.
- **SSE events**: Ephemeral notifications. Clients reconnect and read latest state from DB/Temporal.

If Redis is lost, the system continues with degraded performance (no cache, no real-time events). Scoreboards can be rebuilt from `ContestParticipation` records.

## Critical Failure Modes

### PostgreSQL Unavailable

**Impact**: Total service outage. No reads, writes, or auth.
**Mitigation**: Cloud SQL HA (automatic failover). Connection pooling via Prisma.
**Recovery**: Wait for automatic failover or manual promotion.

### Redis Unavailable

**Impact**: Degraded — no real-time events, no cache, no scoreboards, no cooldown enforcement.
**Mitigation**: Memorystore HA (automatic failover).
**Recovery**: Automatic failover. Scoreboards rebuild on first write. Cache refills on read.
**Note**: Submissions still process (Temporal handles orchestration). SSE clients reconnect.

### Temporal Unavailable

**Impact**: No new workflows start. In-flight workflows pause.
**Mitigation**: Temporal auto-setup with PostgreSQL backend provides persistence.
**Recovery**: Temporal resumes all paused workflows when it comes back. No data loss.
**Note**: Submissions already in DB with `queued` status will be picked up when Temporal recovers.

### Worker Unavailable

**Impact**: No submission judging, no lifecycle transitions.
**Mitigation**: Temporal retries activities when workers reconnect. KEDA auto-scales in production.
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

### Contest Lifecycle

1. `contestLifecycleWorkflow` manages the full contest timeline with durable timers.
2. Admin override signals (early end, extend) are processed atomically within the workflow.
3. Scoreboard freeze creates a Redis snapshot (`RENAME`). The live key continues updating.
4. Final scores are always computed from PostgreSQL, not Redis.

### Assessment Lifecycle

1. `assessmentLifecycleWorkflow` manages open → due → close transitions.
2. Deadline notifications are best-effort (SSE via Redis pub/sub).
3. Submission acceptance is gated by `closesAt` timestamp, checked server-side.

### Plagiarism Detection

1. `PlagiarismReport` record created in DB before Temporal workflow starts.
2. Report ID passed to workflow to avoid duplicate record creation.
3. MOSS submission is not idempotent — retries may create duplicate MOSS runs.
4. Results stored in `PlagiarismReport.results` JSON column.

## Validation Requirements

- All user input validated with Zod schemas before processing
- Prisma parameterized queries for all database access
- Temporal activity inputs are typed but not re-validated (trusted internal boundary)
- Seed data validated before insertion (`pnpm db:seed:validate`)

## Health Checks

| Service    | Endpoint           | Method                             |
| ---------- | ------------------ | ---------------------------------- |
| Web        | `/api/healthz`     | HTTP GET → `{ ok: true }`          |
| Worker     | `/healthz`         | HTTP GET → `{ status: "ok" }`      |
| PostgreSQL | Docker healthcheck | `pg_isready -U postgres`           |
| Redis      | Docker healthcheck | `redis-cli ping`                   |
| Temporal   | Docker healthcheck | `temporal operator cluster health` |

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Temporal Workflows](TEMPORAL.md)
- [Security Requirements](SECURITY.md)
- [Deployment Guide](DEPLOYMENT.md)
