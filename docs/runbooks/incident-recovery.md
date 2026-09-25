# Incident Recovery

Procedures for availability incidents: the platform is wholly or partly down,
or an SLO is in the major tier ([SLOs](../operations/RELIABILITY.md#service-level-objectives)).
Data loss goes to [Backup & Restore](backup-restore.md); judge queue, capacity
and stuck-lease work goes to [Judge Queue](judge-queue.md). Expected failure
behavior per dependency is in [Reliability](../operations/RELIABILITY.md#critical-failure-modes).

Rules:

- Mitigate first, diagnose second. Capture logs, Events and metrics before restarting anything, but do not block recovery on them.
- Notify the on-call channel before destructive actions (deleting pods, restoring a database, cluster-level changes).
- Keep affected-submission inventories and raw incident evidence outside the repository.
- Health endpoints alone do not validate judging: always finish with a real submission.

Production single-machine commands run on the node as `sudo kubectl`; namespaces are `nojv` (apps, CNPG, Redis, MinIO), `nojv-sandbox` (judge Jobs) and `nojv-temporal`.

## Triage

1. Check `/api/readyz` (PostgreSQL + Redis) and, as an admin, `/api/admin/healthz` for which dependency fails.
2. `kubectl -n nojv get pods -o wide` and `kubectl -n nojv get helmrelease nojv` for crash loops, evictions and a stalled release.
3. `kubectl describe node` for `DiskPressure`/`MemoryPressure`; `df -h` on the node.
4. Pick the scenario below that matches the first failing dependency.

## Worker outage

Symptoms: submissions stay queued; scoreboards, contest/exam timers and plagiarism runs stop advancing; `POST /api/submissions` still returns 202.

1. Confirm Temporal itself is up: `kubectl -n nojv-temporal get pods`. If not, restart its pods (state is in PostgreSQL).
2. Inspect workers: `kubectl -n nojv get pods -l 'app.kubernetes.io/component in (worker-judge,worker-platform)'` and `kubectl -n nojv logs deploy/nojv-worker --previous`.
3. Restart: `kubectl -n nojv rollout restart deploy/nojv-worker deploy/nojv-worker-platform`.
4. If it keeps crash-looping, look for OOM, dependency connection errors or a failing activity in the Temporal UI history; check the most recent release.
5. Verify: worker `/readyz` is 200, `nojv_judge_queue_depth` drains, and a new submission reaches a verdict. Accepted work resumes automatically; the outbox redispatches anything that never started.

## Sandbox quota rejection or prolonged capacity wait

Symptoms: `waiting_capacity` executions, rising `nojv_judge_queue_oldest_seconds`, `forbidden: exceeded quota` on sandbox Jobs.

1. Capture worker logs, sandbox Job Events, live quota, Pod state and `/api/release`.
2. Compare `kubectl -n nojv-sandbox describe resourcequota` with actual Pods, including Terminating ones. Quota counts requests, not CPU usage; `exceeded quota` is not a permissions error.
3. Inspect `JudgeExecution.state`, `reasonCode` and `lastProgressAt` for waiting or recovering executions, and confirm `nojv_judge_recovery_last_success_timestamp_seconds` is fresh; stale monitoring does not prove queue health.
4. Restore missing node or runtime capacity, then fit concurrency and sandbox requests to the budget ([Judge Queue: capacity](judge-queue.md#capacity)). Force-deleting Pods or raising quota does not prove their processes stopped; follow [stuck leases and cleanup](judge-queue.md#stuck-leases-and-cleanup).
5. Verify on the deployed worker revision: waiting executions resume on their original snapshot, sandbox resources return to baseline, and 15 minutes of representative traffic produce no capacity SE. Check final verdicts and exam/contest score updates. SE submissions without an original snapshot stay blocked; only an explicit teacher rejudge uses the latest version.

## Sandbox runtime broken

Symptoms: executions `blocked` or recovering with infrastructure reasons, `ImagePullBackOff`, `ContainerCreating` stuck, spawn errors in worker logs, `nojv-judge-cleanup-pending` firing.

1. `kubectl -n nojv-sandbox get pods,jobs` and `kubectl -n nojv-sandbox get events --sort-by=.lastTimestamp`.
2. Image pull failures: check the registry, the sandbox `imagePullSecret` (`worker.sandbox.imagePullSecret`) and that the release's sandbox digest exists.
3. Node pressure: `kubectl top nodes`, `kubectl describe node`; free disk as in [node disk pressure](#node-disk-pressure-or-cnpg-unavailable).
4. Runtime (containerd/runsc) unhealthy: do not restart it blindly. Match run ID, Pod UID and CRI/cgroup identity first ([Judge Queue](judge-queue.md#stuck-leases-and-cleanup)), then repair the node.
5. Verify with one submission to a known-good problem, then confirm blocked executions resume.

## Redis unavailable

Symptoms: no live SSE updates (scoreboards fall back to their 30s poll); writes, forms, sign-in, 2FA, step-up and registry tokens return 503; ordinary API reads continue under a per-process limit.

1. Confirm: `/api/admin/healthz` reports Redis failing; web logs show `ECONNREFUSED`/`READONLY`.
2. Single-machine: `kubectl -n nojv rollout restart deploy/nojv-redis` and check its PVC. GKE: check the external Redis instance's failover state.
3. Flushing or replacing Redis loses no durable data (DAT-10): caches refill, rate-limit windows reset, and users re-verify step-up or admin MFA.
4. Investigate memory growth with `INFO memory` and key counts per prefix against `packages/redis/src/keys.ts`; a new key family without a TTL is the usual cause.
5. Verify `/api/readyz` is 200 and a verdict arrives over SSE.

## PostgreSQL unavailable or slow

Symptoms: most routes 500 (`P1001`, pool timeouts), sign-in fails, worker activities retry at commit.

1. Confirm: `/api/readyz` 503 and `/api/admin/healthz` reports PostgreSQL.
2. Single-machine: `kubectl cnpg status nojv-pg -n nojv`; check the `nojv-pg-1` pod and the CNPG operator (`kubectl -n cnpg-system get pods`). If evicted, see [node disk pressure](#node-disk-pressure-or-cnpg-unavailable). GKE: check the Cloud SQL instance and the `cloudsql-proxy` sidecar.
3. Prisma reconnects on the next request once PostgreSQL is back. If pools stay wedged: `kubectl -n nojv rollout restart deploy/nojv-web deploy/nojv-worker deploy/nojv-worker-platform`.
4. Slow rather than down: inspect `pg_stat_activity` for long queries and `idle in transaction` sessions holding locks; check the most recent migration.
5. Verify `/api/readyz`, sign-in and a submission. Failed activities retry on their own.

## Release hook left the workloads at zero replicas

Symptoms: site down right after a release; `kubectl -n nojv get helmrelease nojv` shows `post-upgrade hooks failed … Job/nojv/nojv-workloads-ready`, `Stalled=True`; `nojv-web`, `nojv-worker`, `nojv-worker-platform` have 0 desired replicas and the web HPA targets `nojv-web-maintenance`. The job log ends with `Timed out waiting for the new web and worker deployments` and possibly `CRITICAL: could not prove maintenance state`.

1. Restore service without reconciling Flux first (a retry drains the workloads again):

   ```bash
   sudo kubectl -n nojv scale deploy nojv-web nojv-worker nojv-worker-platform --replicas=1
   sudo kubectl -n nojv patch hpa nojv-web --type merge -p '{"spec":{"scaleTargetRef":{"name":"nojv-web"}}}'
   ```

2. The HelmRelease stays failed until the next release.
3. Root cause: compare `Pulling` and `Pulled` Event times for the new web pod:

   ```bash
   sudo kubectl -n nojv get events --field-selector involvedObject.name=<new-web-pod> \
     -o custom-columns=T:.lastTimestamp,R:.reason,MSG:.message
   ```

   A gap longer than `maintenance.readyTimeoutSeconds` (default 300) means the image pull, not the app, exhausted the window. The `release-prepull` pre-upgrade hook normally pulls web and worker images before the drain so a slow pull fails while the old release still serves.

Automatic Helm rollback stays off: after a one-way migration the previous revision may be unsafe (OPS-05).

## Node disk pressure or CNPG unavailable

Symptoms: releases stall on the old version; the migrator hook fails with `BackoffLimitExceeded`; `no endpoints available for cnpg-webhook-service`; pods `Evicted`; `nojv-node-disk-usage` or `nojv-pg-not-ready` firing.

1. Confirm disk: `df -h` on the node and `DiskPressure` in `kubectl describe node`.
2. Reclaim space: `sudo k3s crictl rmi --prune`, then oversized logs and orphaned volumes. Check the kubelet image GC drop-in is installed ([Single-Machine k3s](k8s-single-machine.md#kubelet-image-gc)).
3. Restart the CNPG operator (`kubectl -n cnpg-system rollout restart deploy/cnpg-controller-manager`), then the `nojv-pg` instance pod. Wait for `kubectl cnpg status nojv-pg -n nojv` healthy and webhook endpoints present.
4. If the release is wedged, inspect the target with `helm get manifest nojv --revision <revision> -n nojv`. Roll back only if all three app Deployments carry `nojv.tw/schema-contract: versioned-storage-v1` and `nojv.tw/course-roster-contract: membership-v1`, then `helm rollback nojv <revision> -n nojv --wait --timeout 125m`. The schema fence denies pre-contract images.
5. If no contract-compatible revision exists, keep workloads in maintenance and ship a forward fix once the database and operator recover. Never delete or bypass the schema fence.
6. Re-run the release and confirm `/api/release` reports the new version.

Full rollback rules: [Deployment Guide](../operations/DEPLOYMENT.md).

## Post-incident

1. Record start, detection, mitigation and resolution times and user impact in the incident log.
2. If an SLO was breached, note it against the [SLO table](../operations/RELIABILITY.md#service-level-objectives).
3. Add missing detection or prevention to the owning doc ([Reliability](../operations/RELIABILITY.md), [Deployment](../operations/DEPLOYMENT.md), [Security](../operations/SECURITY.md), this runbook) or the [Quality Ledger](../operations/QUALITY_SCORE.md).
4. For code defects, land a regression test ([Testing Strategy](testing.md)).
