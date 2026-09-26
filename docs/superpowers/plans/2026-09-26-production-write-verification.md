# Production write verification plans

**Status:** Draft. The owner confirms each part **before** execution. Nothing here has run. · **Date:** 2026-09-26 · **Closes (when executed):** Quality Ledger "Production evidence" items for OPS-06, OPS-11 and the sandbox quota recovery acceptance

Three production-writing tasks. Each part lists its preconditions, commands, the data it writes, success criteria, abort and rollback steps, cleanup, and the evidence to record. Parts are independent. Run (a) first, so that (b) and (c) happen with a verified backup in place.

## Conventions

```bash
ssh nn@ssh.nojv.tw
alias k='sudo -n k3s kubectl'
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml   # for sudo -E helm / flux
tctl() { k -n nojv-temporal exec -i "$(k -n nojv-temporal get pods --field-selector=status.phase=Running -o name | grep admintools | head -1)" -- temporal "$@"; }
psql_nojv() { k -n nojv exec -i nojv-pg-1 -c postgres -- psql -d nojv -v ON_ERROR_STOP=1 "$@"; }
```

- Namespaces: `nojv` (apps, CNPG, Redis, MinIO), `nojv-sandbox` (judge Jobs), `nojv-temporal`, `cnpg-system`.
- Credentials are typed on the host only (`read -rs`), never pasted into chat, the repo or PRs (OPS-05). Evidence files live outside the repository.
- Before every part: `/api/release` shows the expected version, `k -n nojv get helmrelease nojv` is `Ready=True`, and no Flux reconcile is pending.
- Common preconditions for every part, checked with the query below: no exam or contest is running or starts within the window plus 2 h, and the judge queue is idle.

```bash
psql_nojv -c "SELECT 'exam' k, id, \"startsAt\", \"endsAt\" FROM \"Exam\" WHERE \"endsAt\" > now() AND \"startsAt\" < now() + interval '4 hours'
              UNION ALL SELECT 'contest', id, \"startsAt\", \"endsAt\" FROM \"Contest\" WHERE \"endsAt\" > now() AND \"startsAt\" < now() + interval '4 hours';"
psql_nojv -c "SELECT state, count(*) FROM \"JudgeExecution\" WHERE state NOT IN ('completed','cancelled') GROUP BY 1;"
tctl task-queue describe -t judge
```

---

## (a) OPS-06: activate off-site backups and run a restore drill

Owner doc: [Backup & Restore](../../runbooks/backup-restore.md). Related: [CNPG plugin spec](../specs/2026-09-26-cnpg-barman-cloud-plugin.md). If the live operator is already ≥ 1.26, the owner may choose to activate directly on the plugin; the commands below assume the in-tree path that the chart renders today.

### Preconditions

1. Read-only inventory:
   ```bash
   k -n cnpg-system get deploy -o jsonpath='{range .items[*]}{.metadata.name}{" "}{..image}{"\n"}{end}'
   k -n nojv get cluster nojv-pg -o jsonpath='{.spec.backup}{"\n"}{.status.conditions}{"\n"}'
   k -n nojv get scheduledbackup,backup,cronjob
   k -n nojv get secret nojv-production-values -o jsonpath='{.data.values\.yaml}' | base64 -d > ~/prod-values.before.yaml   # names only, no credentials; mode 0600
   git -C <deploy checkout> show origin/deploy:infra/charts/nojv/values-single-machine.yaml | grep -A1 'migrator:'
   df -h /var/lib/rancher; k top node
   ```
2. The owner has created two off-host destinations (R2 or S3): a Postgres path such as `s3://nojv-db-backups/nojv-pg` and a MinIO mirror bucket. Each has a token scoped to its own bucket. An off-host copy of `nojv-runtime-secrets` exists.
3. `migrator.releaseWindow` on the current `deploy` branch is known. If it is `true`, the values-only reconcile below runs the maintenance drain. Schedule it as a maintenance window, or wait for a release that sets it to `false`. Do not put `releaseWindow` in the values Secret ([Flux guide](../../../infra/flux/README.md#bootstrap)).
4. Node headroom for the drill Cluster: at least 5 GiB free on the local-path disk and 2 GiB of allocatable memory. Otherwise run the drill with smaller resources.

### Steps

1. Create the credential Secrets:
   ```bash
   read -rs AK; read -rs SK
   k -n nojv create secret generic nojv-pg-barman --from-literal=ACCESS_KEY_ID="$AK" --from-literal=ACCESS_SECRET_KEY="$SK"
   read -rs AK; read -rs SK
   k -n nojv create secret generic nojv-minio-mirror --from-literal=ACCESS_KEY_ID="$AK" --from-literal=ACCESS_SECRET_KEY="$SK"
   unset AK SK
   ```
2. Write `~/prod-values.after.yaml` (a copy of the before file with real `postgres.cnpg.backup.*` and `storage.minio.backup.*` values and `enabled: true`), render-check it, then replace the Secret:
   ```bash
   diff ~/prod-values.before.yaml ~/prod-values.after.yaml
   k -n nojv create secret generic nojv-production-values --from-file=values.yaml=$HOME/prod-values.after.yaml --dry-run=client -o yaml | k apply -f -
   k -n nojv annotate helmrelease nojv reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
   k -n nojv get helmrelease nojv -w
   ```
3. Verify WAL archiving:
   ```bash
   k -n nojv get cluster nojv-pg -o jsonpath='{.status.conditions[?(@.type=="ContinuousArchiving")]}{"\n"}'
   k -n nojv exec nojv-pg-1 -c postgres -- psql -Atc "SELECT pg_walfile_name(pg_switch_wal());"
   k -n nojv exec nojv-pg-1 -c postgres -- psql -Atc "SELECT archived_count, last_archived_wal, last_failed_wal, last_failed_time FROM pg_stat_archiver;"
   ```
   Within 2 minutes, the switched segment appears in `last_archived_wal` and in the bucket under `nojv-pg/wals/`.
4. Take an on-demand base backup:
   ```bash
   k -n nojv apply -f - <<'EOF'
   apiVersion: postgresql.cnpg.io/v1
   kind: Backup
   metadata: { name: nojv-pg-ops06-20260926, namespace: nojv }
   spec: { cluster: { name: nojv-pg } }
   EOF
   k -n nojv get backup nojv-pg-ops06-20260926 -w          # phase completed
   k -n nojv get cluster nojv-pg -o jsonpath='{.status.firstRecoverabilityPoint} {.status.lastSuccessfulBackup}{"\n"}'
   ```
5. Run the first MinIO mirror:
   ```bash
   k -n nojv create job --from=cronjob/nojv-minio-backup nojv-minio-backup-ops06
   k -n nojv wait --for=condition=complete job/nojv-minio-backup-ops06 --timeout=2h
   k -n nojv logs job/nojv-minio-backup-ops06 | tail -20
   ```
   Compare the object count and size of source and destination with `mc du`. Use the host through `k -n nojv port-forward svc/nojv-minio 9000` with `mc` pinned to the CronJob's image release, or the provider console for the destination.
6. Restore drill for Postgres (at least 1 h after step 4, so that PITR crosses archived WAL). Choose `TARGET` as an RFC3339 time about 10 minutes ago, then apply the recovery Cluster from the runbook with the name `nojv-pg-drill`, `instances: 1`, `storage.size` equal to production, and **no** `backup` section (the drill must not archive):
   ```bash
   k -n nojv apply -f nojv-pg-drill.yaml
   k -n nojv get cluster nojv-pg-drill -w                    # Cluster in healthy state
   for db in nojv-pg-1 nojv-pg-drill-1; do
     k -n nojv exec "$db" -c postgres -- psql -d nojv -Atc "SELECT
       (SELECT count(*) FROM \"User\"), (SELECT count(*) FROM \"Problem\"),
       (SELECT count(*) FROM \"Submission\" WHERE \"createdAt\" <= '$TARGET'),
       (SELECT count(*) FROM \"Participation\"), (SELECT count(*) FROM \"JudgeExecution\" WHERE \"createdAt\" <= '$TARGET');"
   done
   k -n nojv exec nojv-pg-drill-1 -c postgres -- psql -d temporal -Atc "SELECT count(*) FROM executions;"
   ```
   Record the time from `apply` to healthy as the measured Postgres RTO.
7. Restore drill for objects. From the drill database, pick the 5 most recent submissions before `TARGET`. Confirm that each one's `submissions/<id>/source-generations/` manifest exists in the **destination** bucket and that its size and ETag match the source. Read back one manifest in full.

### Data written

Off-host buckets receive base backups, continuous WAL and the MinIO mirror. In the cluster: two credential Secrets, an updated `nojv-production-values`, one `Backup` CR, one mirror Job, and a temporary `nojv-pg-drill` Cluster with its PVC. No application rows are written.

### Success criteria

`ContinuousArchiving=True`; `last_failed_wal` empty after activation; the base backup completes; `firstRecoverabilityPoint` is set; the mirror Job succeeds with a destination count ≥ source; drill counts equal production for rows created at or before `TARGET` (users and problems may be ≥, never <); Temporal's `executions` table is non-empty; all 5 manifests resolve.

### Abort and rollback

- If `ContinuousArchiving=False` or `last_failed_wal` stays non-empty for 10 minutes, WAL accumulates on the 5Gi volume. Watch it with `k -n nojv exec nojv-pg-1 -c postgres -- du -sh /var/lib/postgresql/data/pgdata/pg_wal`. Restore the previous values with `k -n nojv create secret generic nojv-production-values --from-file=values.yaml=$HOME/prod-values.before.yaml --dry-run=client -o yaml | k apply -f -`, reconcile, then fix the credentials or endpoint offline.
- If the drill Cluster fails to bootstrap, delete it (see cleanup). Production is untouched. The drill is a P1 finding ([Backup & Restore](../../runbooks/backup-restore.md#restore-drill)).

### Cleanup

```bash
k -n nojv delete cluster nojv-pg-drill          # type the name; never nojv-pg
k -n nojv get pvc | grep nojv-pg-drill           # must be empty
k -n nojv delete job nojv-minio-backup-ops06
shred -u ~/prod-values.before.yaml ~/prod-values.after.yaml   # after the owner has an off-host copy
```

Keep the `Backup` CR; retention prunes it.

### Evidence for the Quality Ledger

Date, operator version, destination names (no credentials), the switched WAL segment, the `Backup` name and completion time, `firstRecoverabilityPoint`, the mirror Job name with source and destination counts, the drill `TARGET`, the count comparison table, the manifest check, and the measured RTO. Then remove the OPS-06 activation item from "Production evidence" and update OPS-06 if the drill changed any rule.

---

## (b) OPS-11: judge latency and capacity on the deployed profiles

Owner docs: [Judge Queue](../../runbooks/judge-queue.md), [Testing: judge benchmark](../../runbooks/testing.md#judge-capacity-benchmark), [Deployment: capacity](../../operations/DEPLOYMENT.md#capacity).

### Single-machine: owner's stress test (100 light + 40 heavy C++)

The owner's planned prod stress test is the single-machine measurement: submissions dispatched as the admin account from inside the worker pod, with results cleaned up afterwards. It does not replace the `scripts/judge-benchmark.ts` release comparison, which needs 100 dedicated accounts and 108 trials. It answers the ledger question: is the 16 pods / 6 CPU / 16Gi quota memory-safe on the 16 GiB node, and what are the latency and drain time at that ceiling?

**Conflicts to acknowledge first:**

- OPS-05 says "never run tests against production", and OPS-11 says "benchmarks use isolated temporary identities and clean up". A single admin account is not an isolated temporary identity. The owner either approves a recorded exception or changes the plan to temporary accounts.
- The per-student dispatch gate (JDG-12) allows one dispatched non-terminal execution per student. With one account, 140 submissions judge **serially** unless the script starts workflows directly and bypasses the gate, as the 2026-09-22 test did. A bypass measures sandbox and Temporal capacity, not the gate or fairness path.

**Preconditions:**

- Part (a) is done, so a verified backup exists from before the test.
- Common preconditions pass, and the owner announces a window of about 2 h.
- Benchmark problems: unpublished, owned by admin, and used by nothing else, so that cleanup can scope by `problemId`:
  - `light`: A+B style, 20 cases.
  - `heavy`: about 600 ms CPU per case, 20 cases, 2 s limit.
  - Record their ids and testcase hashes.
- The dispatch script is not in the repo; the 2026-09-22 version lived in `/tmp` on the host. The owner reviews it and records its `sha256sum`. It writes created submission ids to `ids-<phase>.txt`. `/api/release`, the worker image digest, the quota and the node inventory (`k get node -o yaml`, `lscpu`, `free -m`) are saved as baseline.

**Steps:** each phase starts only after the previous one has drained and `k -n nojv-sandbox get pods` is empty.

| Phase | Load                                     | Purpose                                       |
| ----- | ---------------------------------------- | --------------------------------------------- |
| P0    | 1 light, then 1 heavy                    | Idle single-submission latency baseline       |
| P1    | 100 light, burst                         | Slot tuner ramp, queue drain, CPU ceiling     |
| P2    | 40 heavy, burst                          | Wall-clock contention, TLE guard, node memory |
| P3    | 100 light + 40 heavy together (optional) | Mixed ceiling, the owner's headline number    |

```bash
k -n nojv exec -i deploy/nojv-worker -- node --input-type=module - < dispatch.mjs > ids-P1.txt
```

While each phase runs, sample every 10 s into `sample-<phase>.log`:

```bash
while :; do date -u +%FT%TZ; k top node --no-headers; free -m | sed -n 2p
  k -n nojv-sandbox get resourcequota sandbox-quota -o jsonpath='{.status.used}{"\n"}'
  k -n nojv-sandbox get pods --no-headers | awk '{print $3}' | sort | uniq -c
  psql_nojv -Atc "SELECT j.state, count(*) FROM \"JudgeExecution\" j JOIN \"Submission\" s ON s.id=j.\"submissionId\" WHERE s.\"problemId\" IN ('<light>','<heavy>') GROUP BY 1"
  sleep 10; done
```

After the phase, collect:

- Per-submission latency: `Submission.createdAt` → `JudgeExecution` completion (`updatedAt` of the completed row), giving p50, p95 and max.
- Drain time: the first submission to the last verdict plus verified sandbox cleanup.
- Peak node memory and peak quota `used`.
- `judge_wall_clock_timeouts_total` and `judge_cleanup_pending_total` deltas from Grafana.
- `kubectl get events -n nojv-sandbox` for `FailedCreate` and `OOMKilled`.
- Verdict distribution. The expected result is all AC with 0 SE.

**Data written:** 142–282 `Submission` rows with their `JudgeExecution`, `JudgeStage` and object-storage payloads, Temporal histories (kept until namespace retention expires), and metrics.

**Success criteria:** all expected verdicts and 0 `system_error`; no `OOMKilled` or node `MemoryPressure`; peak node memory below 90%; `nojv-judge-wall-clock-timeouts` did not fire; sandbox Pods return to 0 within 2 minutes of the last verdict; web `/api/readyz` stays 200 throughout. If memory crosses 90%, the quota is not memory-safe. That result goes into the ledger and a follow-up to lower `requestsMemory` or `concurrency` under OPS-11. The profile is not changed during the test.

**Abort:**

- Triggers: node memory above 92%, `MemoryPressure`, Postgres or web readiness failing, or a real exam or contest submission appearing.
- Action: cancel the remaining benchmark workflows with `tctl workflow cancel` for each `judge-<submissionId>` in the ids file. Cancel, never terminate, so that cleanup runs ([Judge Queue](../../runbooks/judge-queue.md#stuck-leases-and-cleanup)). Then wait for sandbox cleanup.

**Cleanup:**

- Delete the benchmark submissions in one reviewed transaction scoped to the benchmark `problemId`s and the admin `userId`, as on 2026-09-22.
- Release their storage pointers through `commitStoragePointerSwap` (`packages/application/src/shared/storage-object-lifecycle.ts`) so objects go through the normal cleanup after the reader grace period, not a raw bucket delete.
- Use `db.$transaction(fn, { timeout })`, because the default 5 s is too short.
- Unpublished benchmark problems are kept for the next run, or deleted by the owner's choice.
- Verify: 0 rows for those problems, `storage.object.cleanup` work drains, and the next mirror run is unaffected.

### GKE: concurrency vs quota

`values-gke.yaml` sets 2 judge replicas × 2 slots against a quota of 10 pods / 10 CPU / 30Gi, with one on-demand gVisor node plus Spot 0–4. Run the same P0–P2 phases only if a GKE environment exists and the owner confirms it as a target. Also measure:

- Spot scale-up time (Pending → Running for the first sandbox Pod on a new node).
- Whether 4 slots ever saturate the quota. If not, the quota is not the ceiling, and the slot count is the value to tune.
- Behavior when a Spot node is preempted mid-stage (expected: `recovering`, then a verdict).

If no GKE environment exists, record "not measured, no environment" and split the ledger item.

### Evidence for the Quality Ledger

Date, release, worker and sandbox digests, profile values, script sha256, the phase table (count, p50/p95/max latency, drain time, peak CPU, peak node memory, peak quota used, verdicts, SE, wall-clock TLEs, cleanup time), the exception approval reference, and cleanup confirmation. Update the [Deployment capacity](../../operations/DEPLOYMENT.md#capacity) numbers only if the profile changes afterwards.

---

## (c) Sandbox quota recovery acceptance

Owner doc: [Incident Recovery: sandbox quota rejection](../../runbooks/incident-recovery.md#sandbox-quota-rejection-or-prolonged-capacity-wait), step 5. Local evidence already exists: `tests/integration/k8s/judge-k8s.test.ts` ("recovers the durable judge workflow after real quota pressure", on k3d without gVisor). This part proves the same behavior on the deployed revision.

### Preconditions

Common preconditions pass, part (a) is done, and a low-traffic window of about 45 minutes is announced. Real student submissions during the window will also wait. The same benchmark problems and cleanup approach as (b) are used.

### Scenario C1: capacity loss

Simulate capacity loss the same way as the k3d test: a **second**, non-Helm ResourceQuota plus a holder Pod that fills it. All quotas in a namespace are enforced, and Flux and Helm never touch these objects, so the Helm-managed `sandbox-quota` stays unchanged.

A quota whose hard limit is below a single Job's request (for example `pods=0`) must not be used. The worker's pre-check (`findSandboxQuotaViolation` in `apps/worker/src/sandbox/kubernetes/resource-capacity.ts`) classifies that as `SandboxInfeasibleError`, so executions go `blocked` for 15 minutes instead of `waiting_capacity`. The hard limit must fit one Job, and the holder's usage must be what rejects it.

```bash
k -n nojv-sandbox create quota acceptance-hold --hard=requests.cpu=1
# holder: restricted PodSecurity, runtimeClassName gvisor, the release's sandbox image by digest,
# command sleep, requests cpu 1 / memory 64Mi, limits cpu 1 / memory 128Mi (shape as in judge-k8s.test.ts)
k -n nojv-sandbox apply -f acceptance-holder.yaml
k -n nojv-sandbox get quota acceptance-hold -o jsonpath='{.status.used}{"\n"}'      # requests.cpu: 1
# dispatch 10 light submissions (same script, ids-C1.txt)
k -n nojv-sandbox get events --field-selector reason=FailedCreate | tail -5        # exceeded quota: acceptance-hold
psql_nojv -c "SELECT state, \"reasonCode\", count(*) FROM \"JudgeExecution\" WHERE \"submissionId\" = ANY('{<ids>}') GROUP BY 1,2;"   # waiting_capacity, never blocked
# hold for 3 minutes (≥ 6 retry cycles at 30 s), then restore capacity
k -n nojv-sandbox delete pod acceptance-holder
k -n nojv-sandbox delete quota acceptance-hold
```

Expected: all 10 move `waiting_capacity` → `running` → `completed` on their original snapshot, with no `system_error` and no `blocked`.

### Scenario C2: worker restart mid-judging

```bash
# dispatch 10 heavy submissions (ids-C2.txt); when ≥ 3 sandbox Pods are Running:
k -n nojv rollout restart deploy/nojv-worker
k -n nojv rollout status deploy/nojv-worker
```

The judge Deployment uses `Recreate`. Expected: in-flight stages are reconciled (lease expiry → `reconcileJudgeStage` / cleanup), the orphaned sandbox Pods are removed, and every submission reaches its expected verdict. Recovered attempts are allowed; a final `system_error` is not.

### Observation (15 minutes)

After C1 and C2 have drained, keep sampling as in (b) for 15 minutes under normal traffic. For a quiet window, the owner may add one light submission per minute.

- No new capacity-related SE.
- `nojv_judge_recovery_last_success_timestamp_seconds` stays fresh.
- `nojv_judge_queue_oldest_seconds` returns to baseline.
- Quota `used` returns to its pre-test value.
- `judge_cleanup_pending_total` shows no increase.
- No `blocked` executions.

### Data written

20 benchmark submissions and their executions, stages and objects, plus one temporary ResourceQuota and one holder Pod. Real submissions may be delayed by up to about 3 minutes during C1.

### Success criteria

All 20 submissions finish with their expected verdicts and 0 final SE, and the 15-minute observation shows every criterion above holding.

### Abort and rollback

- C1: `k -n nojv-sandbox delete pod acceptance-holder; k -n nojv-sandbox delete quota acceptance-hold` immediately restores capacity. Delete it at once if a real exam or contest submission arrives.
- C2: if the worker fails readiness after the restart, follow [Worker outage](../../runbooks/incident-recovery.md#worker-outage).
- Stuck leases or cleanup: follow [Judge Queue](../../runbooks/judge-queue.md#stuck-leases-and-cleanup). Never force-delete Pods as proof.

### Cleanup

Confirm `k -n nojv-sandbox get quota` shows only `sandbox-quota` and the holder Pod is gone, then delete the 20 submissions as in (b).

### Evidence for the Quality Ledger

Date, release and worker revision, the C1 timeline (quota created, first `FailedCreate`, quota deleted, last verdict), the C2 timeline (restart time, orphan Pods and when they were removed, last verdict), the verdict tables, the 15-minute observation metrics, and cleanup confirmation.

---

## Questions for the owner before execution

1. (a) Which buckets, endpoint and token scopes? Should the Postgres and MinIO tokens be separate (recommended)? Is object lock or versioning wanted on the destination?
2. (a) The MinIO mirror runs daily, while Postgres PITR is continuous. A PITR to a time after the last mirror can reference objects the mirror does not have yet. Is a 24 h object RPO acceptable, or should the mirror run hourly?
3. (a) Should activation be combined with the plugin migration (see spec open question 3)?
4. (b) Do you approve the OPS-05 and OPS-11 exception (admin account, production target), or should temporary accounts be used? Should the gate be bypassed (measures capacity) or not (measures the real path, serial for one account)?
5. (b) Will the dispatch and cleanup scripts be committed (for example under `scripts/ops/`) so they are reviewed and reusable, or stay off-repo with only a recorded sha256?
6. (b) Is GKE in scope, or should the ledger item be split into "single-machine measured" and "GKE not deployed"?
7. (c) Is delaying real submissions by about 3 minutes acceptable, or should C1 run only in a window with zero traffic?
8. (c) Should the holder manifest be committed next to the k3d test so production and CI use the same shape?
