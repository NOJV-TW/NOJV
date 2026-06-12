# Incident Recovery Runbook

## Overview

Use this runbook when the platform is wholly or partially unavailable, or when [Reliability SLOs](../operations/RELIABILITY.md#service-level-objectives) are severely violated (major tier per that doc).

**Rule of calm: mitigate first, diagnose second.** Restoring service for users outranks finding the root cause. Every scenario below is ordered so the top steps are the fastest path to green; capture logs and metrics before restarting anything, but do not block recovery on a perfect post-mortem trail.

When in doubt, notify the on-call channel before taking destructive actions (clearing Redis during a contest, manual Cloud SQL failover, etc.).

Each scenario covers: **symptoms**, **detection**, **immediate mitigation**, **root-cause investigation**, **prevention**.

---

## Scenario A: Temporal worker outage

### Symptoms

- Submissions stay in `queued` forever — verdict never arrives via SSE or polling.
- Scoreboard stops updating despite new ACs.
- Contest / assessment lifecycle timers silently miss (no auto-close, no transitions from `open` → `due`).
- Plagiarism report requests never advance beyond `pending`.

### Detection

- Temporal Web UI shows a rising backlog of open workflows and no recent activity on task queues.
- `kubectl get pods -n worker` (GKE) or Cloud Run worker service shows `CrashLoopBackOff` / zero ready replicas.
- API endpoint contract: `POST /api/submissions` still returns 202 (record lands in DB) but `GET /api/submissions/[id]` never advances past `queued`.
- Worker `/healthz` endpoint returns non-2xx or times out.

### Immediate Mitigation

1. **Confirm worker is the culprit, not Temporal itself.** Check Temporal server pod / service — if Temporal is down, jump to its own recovery (it is PostgreSQL-backed, so restart typically suffices).
2. **Restart the worker deployment:**
   - GKE: `kubectl rollout restart deploy/worker -n <namespace>`
   - Cloud Run: re-deploy the current image or bump a no-op env var to trigger a new revision.
3. Temporal will auto-resume in-flight workflows as soon as a worker reconnects to the task queue — no data loss. Submissions queued during the outage pick up automatically.
4. If restart fails to stabilise (crashloop continues), scale to zero, inspect logs from the last exit, then scale back.

### Root-Cause Investigation

- Worker logs: look for OOM, unhandled exceptions in activities, failed connections to Redis / Postgres / Temporal.
- Temporal Web UI workflow history: the last successfully-executed activity tells you what the worker was doing when it died.
- Resource saturation: `kubectl top pods -n worker` for CPU/memory. Advanced-mode submissions with custom images can spike memory.
- GCS / object storage: sandbox may be attempting to fetch problem assets; check storage availability.
- Recent deploys: `git log apps/worker` — did a deploy just ship that introduced a bad activity?

### Prevention

- PodDisruptionBudget for worker (already in place — see `infra/gcp/gke/worker.pdb.yaml`).
- GKE worker Deployment uses static replicas sized for peak submission rate (KEDA-based autoscaling removed in commit `c1ed096`; pending workflows queue in Temporal until capacity returns).
- OOM and CPU throttling alerts on the worker pool.
- Canary deploys for `apps/worker`; never promote to production without passing `pnpm ci:verify`.

---

## Scenario B: Redis unavailable

### Symptoms

- SSE clients receive keepalives but no real events (no verdict notifications, no lifecycle signals, no scoreboard-update nudges).
- The contest scoreboard page still loads — it is computed from Postgres, not Redis — but live updates stop, so it relies on its 30 s polling fallback.
- **Rate limiting fails closed**: in production the limiters reject requests when Redis is unreachable, so writes / sign-ins start returning 429 (this is the main user-facing impact). Cooldown is unaffected — it uses Postgres advisory locks, not Redis.
- The admin-dashboard read-through cache (`nojv:cache:admin-dashboard`) misses and recomputes from Postgres (fail-open).

### Detection

- `/api/healthz` reports degraded (Redis probe failing).
- Web app logs: spike of `Redis ECONNREFUSED`, `MOVED`, or `READONLY` errors.
- Write / sign-in routes return 429 (rate limiter fail-closed); SSE-dependent pages show no live updates.
- Memorystore / Redis monitoring: connection count → 0 or memory at eviction threshold.

### Immediate Mitigation

1. **Check Memorystore / Redis instance state** (GCP console or equivalent). If it is failing over automatically, wait 30–60s for the standby to promote.
2. If the instance is stuck, restart / recreate it (managed Redis UI or `gcloud redis instances failover`).
3. **Flushing Redis is essentially harmless to data, even during a contest.** Leaderboards are computed from Postgres on read, submit cooldown uses Postgres advisory locks, and scoreboard freeze is gated by the `Contest.frozenBoard` / `Contest.frozenAt` columns (no Redis snapshot). The only loss is in-flight pub/sub nudges, which clients recover via the 30 s poll / SSE reconnect. The admin-dashboard cache refills lazily.
4. Platform stays **partially up** through the outage: submissions still process (Temporal is independent), auth still works (Postgres-backed). Users lose real-time push only, and writes/sign-ins are rate-limited closed until Redis returns.

### Root-Cause Investigation

- Memory pressure: Redis holds only rate-limiter keys (`rl:*`), the admin-dashboard cache, the 10 s `nojv:sb-throttle:*` keys, and transient pub/sub — there are no scoreboard sorted sets. A leak here usually means a new key pattern skipped its TTL. Check `INFO memory`.
- Recent changes to Redis key registry (`packages/redis/src/keys.ts`) — did a new key pattern skip TTL?
- Network policy / firewall: did a recent `infra/k8s/` or Cloud Run ingress change block egress?
- rate-limiter-flexible internal leak: unlikely (library manages TTLs) but verify key count against expectations.

### Prevention

- Explicit `maxmemory-policy allkeys-lru` on the Redis instance.
- Scoreboard TTL already in place (round 3 elegance pass).
- Monitoring alerts on Redis memory > 80% and connection errors > threshold.
- Periodic review of `packages/redis/src/keys.ts` to ensure every new key family has an explicit `EXPIRE`.

---

## Scenario C: PostgreSQL failover or high latency

### Symptoms

- Most routes return 500; Prisma throws `PrismaClientInitializationError` or `P1001` connection errors.
- Long transactions (e.g. `assertExamManagePermission`, join-token claim) time out.
- Auth endpoints fail; users get signed out on next request.
- Worker activities retry repeatedly at the DB commit step.

### Detection

- `/api/healthz` shows DB probe failing.
- Prisma logs: `connection pool timeout` or `Cannot connect to database`.
- Cloud SQL console: primary instance in `failover` state, or CPU / IOPS pegged.
- Request error rate across the board (not isolated to one feature) is the clearest signal.

### Immediate Mitigation

1. **Wait 60–120s.** Cloud SQL HA typically completes failover automatically; apps auto-reconnect once the endpoint resolves to the new primary.
2. If Cloud SQL is genuinely stuck, trigger a manual failover via GCP console.
3. Once the DB is healthy again, Prisma reconnects on the next request — **no app restart required in normal cases**. If the connection pool is wedged, restart web + worker deployments to force fresh pools.
4. Temporal activities that failed mid-flight retry automatically per the configured retry policy; no manual intervention for submissions in flight.

### Root-Cause Investigation

- Connection pool exhaustion: check Prisma metrics / logs for queued query counts. A single slow endpoint can starve the pool.
- Long-running queries: check `pg_stat_activity` for queries > 30s. Common culprits: plagiarism report aggregations, scoreboard rebuilds, `listSubmissions` without index hits.
- Lock contention: look for `idle in transaction` sessions — a hung web request holding a row lock can cascade.
- Recent migrations: did a migration add an index that caused a lock-heavy rewrite?
- IOPS ceiling: large contests generate bursts of `Submission` / `Participation` writes.

### Prevention

- Conservative Prisma connection pool limit (set per app tier, sized to Cloud SQL max_connections / replica count).
- Slow query logging enabled in production.
- Read replica for heavy analytics reads (plagiarism dashboards, user stats) — currently TBD, tracked in [Quality Ledger](../operations/QUALITY_SCORE.md).
- Cloud SQL alerts on CPU > 80%, connection count > 80%, IOPS saturation.

---

## Scenario D: Sandbox namespace / Docker runtime broken

### Symptoms

- Submissions transition to `running` but never produce a verdict — after the per-submission timeout, the workflow marks them `system_error`.
- Advanced-mode submissions fail at the "spawn container" step.
- Verdict distribution skews heavily toward `SE` (system error).

### Detection

- Worker logs: `Failed to create sandbox pod`, `ImagePullBackOff`, `containerd: Unknown runtime`, or `Error response from daemon`.
- GKE: `kubectl get pods -n sandbox` shows `Pending`, `OOMKilled`, or `ContainerCreating` stuck for > 30s.
- Docker daemon logs (local / single-VM deploys): spawn errors, overlayfs mount failures.
- `kubectl describe resourcequota -n sandbox` near or at limit.

### Immediate Mitigation

1. **Check sandbox namespace quota first** — `kubectl describe resourcequota -n sandbox`. If pods are stuck at the quota ceiling from orphaned old pods, delete completed / failed pods: `kubectl delete pod -n sandbox --field-selector=status.phase=Failed`.
2. **If the node pool is out of resources**, drain and replace the affected nodes, or scale the node pool up. Sandbox is pinned to a stable node pool (commit `c1ed096`) — verify that pool has capacity.
3. **If the sandbox image fails to pull**, check the image registry and the `imagePullSecrets` on the sandbox namespace. Verify the last `pnpm sandbox:build` + push succeeded.
4. **If the daemon itself is unhealthy** (local Docker or the containerd on a node), restart the daemon / cordon and replace the node.
5. After mitigation, verify with a single manual submission to a known-good problem before declaring green.

### Root-Cause Investigation

- Node resource pressure: `kubectl top nodes`, check for memory / CPU / ephemeral-storage saturation.
- Recent sandbox image push: did a new base image introduce a seccomp incompatibility? Run the sandbox image smoke test.
- Kubernetes network policy: `infra/k8s/sandbox/` changes? A new policy may have blocked required egress.
- LimitRange / ResourceQuota: commit `486f608` added process count cap + LimitRange — verify limits match actual workload.
- Advanced-mode custom images: a poisoned image uploaded by a problem author can stall the entire pool if resource limits are misconfigured. Check the problem most recently updated with a custom image.

### Prevention

- LimitRange and ResourceQuota on the sandbox namespace (already in place).
- PDB and dedicated node pool for sandbox (pinned per commit `c1ed096`).
- Sandbox image smoke test on every build (runs `hello world` in each supported language).
- Alerting on sandbox namespace quota utilisation and `SE` verdict rate.
- Review advanced-mode image uploads for obvious abuse patterns before enabling on public problems.

---

## Post-Incident

1. File an incident log entry with: start time, detection time, mitigation time, resolution time, user impact summary.
2. If an SLO was breached, cross-reference in [Reliability SLOs](../operations/RELIABILITY.md#service-level-objectives).
3. If a prevention item above was absent or insufficient, add / update it in the relevant doc (`operations/SECURITY.md`, `operations/DEPLOYMENT.md`, this runbook, or the [Quality Ledger](../operations/QUALITY_SCORE.md)).
4. If the bug was code, prefer a regression test over a one-off fix — see [Reliability Invariants](../operations/RELIABILITY.md) for validation requirements.

## Related Docs

- [Reliability Invariants](../operations/RELIABILITY.md)
- [Deployment Guide](../operations/DEPLOYMENT.md)
- [Backup & Restore](backup-restore.md) — durability incidents (PITR, snapshot recovery, accidental deletes)
- [Getting Started](getting-started.md)
