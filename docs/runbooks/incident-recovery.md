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
- Workers run in-cluster in the `nojv` namespace as chart Deployments (`nojv-worker` judge, `nojv-worker-platform`). `kubectl get pods -n nojv -l app.kubernetes.io/component=worker` shows `CrashLoopBackOff` / zero ready replicas.
- API endpoint contract: `POST /api/submissions` still returns 202 (record lands in DB) but `GET /api/submissions/[id]` never advances past `queued`.
- Worker `/healthz` endpoint returns non-2xx or times out.

### Immediate Mitigation

1. **Confirm worker is the culprit, not Temporal itself.** Check Temporal server pod / service — if Temporal is down, jump to its own recovery (it is PostgreSQL-backed, so restart typically suffices).
2. **Restart the worker deployment in-cluster:**
   - `kubectl rollout restart deploy/nojv-worker -n nojv` (judge), and `kubectl rollout restart deploy/nojv-worker-platform -n nojv` if the platform worker is also affected.
3. Temporal will auto-resume in-flight workflows as soon as a worker reconnects to the task queue — no data loss. Submissions queued during the outage pick up automatically.
4. If restart fails to stabilise (crashloop continues), scale to zero, inspect logs from the last exit, then scale back.

### Root-Cause Investigation

- Worker logs: look for OOM, unhandled exceptions in activities, failed connections to Redis / Postgres / Temporal.
- Temporal Web UI workflow history: the last successfully-executed activity tells you what the worker was doing when it died.
- Resource saturation: `kubectl top pods -n worker` for CPU/memory. Advanced-mode submissions with custom images can spike memory.
- GCS / object storage: sandbox may be attempting to fetch problem assets; check storage availability.
- Recent deploys: `git log apps/worker` — did a deploy just ship that introduced a bad activity?

### Prevention

- PodDisruptionBudget for worker — chart-rendered (`infra/charts/nojv/templates/worker-pdb.yaml`, guarded by `pdb.enabled`).
- GKE worker Deployment uses static replicas sized for peak submission rate (KEDA-based autoscaling removed in commit `c1ed096`; pending workflows queue in Temporal until capacity returns).
- OOM and CPU throttling alerts on the worker pool.
- Canary deploys for `apps/worker`; never promote to production without passing `pnpm ci:verify`.

---

## Scenario B: Redis unavailable

### Symptoms

- SSE clients receive keepalives but no real events (no verdict notifications, no lifecycle signals, no scoreboard-update nudges).
- The contest scoreboard page still loads — it is computed from Postgres, not Redis — but live updates stop, so it relies on its 30 s polling fallback.
- **Rate limiting is mixed-mode**: the general `api` tier uses its tested
  per-process memory limiter during an operational Redis outage, so ordinary
  reads can continue with a per-replica limit. The `write`, `form`, `auth`,
  sign-in, 2FA, step-up, and registry-token tiers fail closed with 503. A real
  limit exhaustion remains 429. Cooldown is unaffected because it uses
  PostgreSQL advisory locks, not Redis.
- The admin-dashboard read-through cache (`nojv:cache:admin-dashboard`) misses and recomputes from Postgres (fail-open).

### Detection

- `/api/readyz` and `/api/healthz` return 503; `/api/admin/healthz` identifies
  Redis as the failing dependency.
- Web app logs: spike of `Redis ECONNREFUSED`, `MOVED`, or `READONLY` errors.
- Sign-in, 2FA, form, and write routes return 503 while the limiter is
  unavailable; ordinary API reads use the per-process limiter. SSE-dependent
  pages show no live updates.
- Memorystore / Redis monitoring: connection count → 0 or memory at eviction threshold.

### Immediate Mitigation

1. **Check Memorystore / Redis instance state** (GCP console or equivalent). If it is failing over automatically, wait 30–60s for the standby to promote.
2. If the instance is stuck, restart / recreate it (managed Redis UI or `gcloud redis instances failover`).
3. **Flushing Redis is essentially harmless to data, even during a contest.** Leaderboards are computed from Postgres on read, submit cooldown uses Postgres advisory locks, and scoreboard freeze is gated by the `Contest.frozenBoard` / `Contest.frozenAt` columns (no Redis snapshot). The only loss is in-flight pub/sub nudges, which clients recover via the 30 s poll / SSE reconnect. The admin-dashboard cache refills lazily.
4. Platform stays **partially up** through the outage: submissions already in
   Temporal continue processing and session reads remain PostgreSQL-backed.
   Ordinary API reads use the per-process limiter, while writes, forms, new
   sign-ins, 2FA, step-up, and registry-token requests fail closed with 503
   until Redis returns. Users also lose real-time push.

### Root-Cause Investigation

- Memory pressure: Redis holds only rate-limiter keys (`rl:*`), the admin-dashboard cache, the 10 s `nojv:sb-throttle:*` keys, and transient pub/sub — there are no scoreboard sorted sets. A leak here usually means a new key pattern skipped its TTL. Check `INFO memory`.
- Recent changes to Redis key registry (`packages/redis/src/keys.ts`) — did a new key pattern skip TTL?
- Network policy / firewall: did a recent chart NetworkPolicy change (`infra/charts/nojv/templates/app-network-policy.yaml`) or Cloudflare/Ingress change block egress?
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

- `/api/readyz` and `/api/healthz` return 503; `/api/admin/healthz` identifies
  PostgreSQL as the failing dependency.
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
- GKE: `kubectl get pods -n nojv-sandbox` shows `Pending`, `OOMKilled`, or `ContainerCreating` stuck for > 30s.
- Docker daemon logs (local / single-VM deploys): spawn errors, overlayfs mount failures.
- `kubectl describe resourcequota -n nojv-sandbox` near or at limit.

### Immediate Mitigation

1. **Check sandbox namespace quota first** — `kubectl describe resourcequota -n nojv-sandbox`. If pods are stuck at the quota ceiling from orphaned old pods, delete completed / failed pods: `kubectl delete pod -n nojv-sandbox --field-selector=status.phase=Failed`.
2. **If the node pool is out of resources**, drain and replace the affected nodes, or scale the node pool up. Sandbox is pinned to a stable node pool (commit `c1ed096`) — verify that pool has capacity.
3. **If the sandbox image fails to pull**, check the image registry and the `imagePullSecrets` on the sandbox namespace. Verify the last `pnpm sandbox:build` + push succeeded.
4. **If the daemon itself is unhealthy** (local Docker or the containerd on a node), restart the daemon / cordon and replace the node.
5. After mitigation, verify with a single manual submission to a known-good problem before declaring green.

### Root-Cause Investigation

- Node resource pressure: `kubectl top nodes`, check for memory / CPU / ephemeral-storage saturation.
- Recent sandbox image push: did a new base image introduce a seccomp incompatibility? Run the sandbox image smoke test.
- Kubernetes network policy: changes to the chart's sandbox policy (`infra/charts/nojv/templates/sandbox-policy.yaml`)? A new policy may have blocked required egress.
- LimitRange / ResourceQuota: commit `486f608` added process count cap + LimitRange — verify limits match actual workload.
- Advanced-mode custom images: a poisoned image uploaded by a problem author can stall the entire pool if resource limits are misconfigured. Check the problem most recently updated with a custom image.

### Prevention

- LimitRange and ResourceQuota on the sandbox namespace (already in place).
- PDB and dedicated node pool for sandbox (pinned per commit `c1ed096`).
- Sandbox image smoke test on every build (runs `hello world` in each supported language).
- Alerting on sandbox namespace quota utilisation and `SE` verdict rate.
- Review advanced-mode image uploads for obvious abuse patterns before enabling on public problems.

---

## Scenario E: node disk pressure / CNPG unavailable (single-machine)

Codifies the 2026-07-04 incident: the single-machine runner's disk filled with accumulated container images, containerd went into disk pressure, the CloudNativePG operator and Postgres pod were evicted, the migrator Helm hook failed, and deploys silently stalled on the old version.

### Symptoms

- Deploys "succeed" from the runner's view but production stays on the **old version** — a shipped fix (e.g. an SSE repair) never actually goes live.
- The migrator Helm hook Job fails with `BackoffLimitExceeded`; the release upgrade hangs or rolls back.
- `helm` / `kubectl` operations against the DB error with `no endpoints available for cnpg-webhook-service` — the decisive clue that the CNPG operator itself is down (disk full), not just a bad migration.

### Detection

- `df -h` on the node shows the root / containerd partition at or near 100 %.
- `kubectl describe node` shows a `DiskPressure` condition / taint; pods show `Evicted`.
- `kubectl get pods -n nojv` shows `nojv-pg-1` (and the CNPG operator pod) `Evicted`, `Pending`, or not `Ready`.
- Deploy workflow logs show the migrator hook Job hitting `BackoffLimitExceeded`.

### Immediate Mitigation

1. **Confirm disk is the root cause:** `df -h` on the node. Disk pressure cascades into every other symptom here.
2. **Reclaim space:** `crictl rmi --prune` to drop unused container images (in the incident, two passes took usage from ~73 % → ~31 %). Also clear stale logs if needed.
3. **Bring CNPG back:** `kubectl rollout restart` the CloudNativePG operator deployment, then restart the Postgres cluster pod. Wait until `nojv-pg` is healthy (`kubectl get cluster -n nojv`, PG pod `Ready`, webhook endpoints present).
4. **If the release is wedged**, first inspect the target revision with
   `helm get manifest nojv --revision <revision> -n nojv`. Roll back only when
   all three app Deployments carry
   `nojv.tw/schema-contract: versioned-storage-v1`; then run
   `helm rollback nojv <revision> -n nojv --wait --timeout 125m`. A
   pre-contract image is incompatible with the forward-only storage schema and
   the admission fence will deny it.
5. If no contract-compatible revision exists, keep workloads in maintenance
   and ship a forward fix after the DB and operator recover. Never delete or
   bypass the schema fence to revive an older image.
6. **Re-run the deploy** workflow once the DB and migrator hook are healthy; verify production is actually on the new version.

### Root-Cause Investigation

- Image accumulation: every deploy left additional image tags on the node until the disk filled. PR #193 now prunes images down to the current + rollback tags on each deploy — verify that pruning ran.
- Check for other disk hogs: oversized logs, orphaned emptyDir / PVC data, leftover build artifacts.

### Prevention

- Per-deploy image pruning (PR #193) — keep only current + rollback tags.
- Disk-usage alert on the runner / node well below the eviction threshold.
- Monitor the `DiskPressure` node condition and CNPG instance health (see `nojv-pg-not-ready` in [Reliability Invariants](../operations/RELIABILITY.md)).

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
