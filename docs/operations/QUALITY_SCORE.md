# Quality Ledger

Current verification evidence and open follow-ups. It is a snapshot, not a substitute for running the checks again. Code merged to `main` does not prove production deployment or live behavior.

## Verified baseline

Checked on 2026-09-25 at `b651c52` with Node `24.19.0` and pnpm `11.13.1`: `pnpm ci:verify` passed formatting, repository guards, build, typecheck, lint, test typecheck, 384 unit test files (3,585 tests, including the Helm-rendering infra tests with Helm 3.18 on `PATH`) and 43 component test files (106 tests, five consecutive clean runs). `pnpm lint:helm` passed for the GKE and single-machine overlays.

Checked on 2026-09-26 on the local `k3d-nojv-judge` cluster (default runtime, not gVisor) with a sandbox image built from the PR #529 branch: `REQUIRE_K8S=1 pnpm test:integration:k8s` passed 15 of 15, including durable-judge recovery after real ResourceQuota pressure.

Production, read-only, on 2026-09-26 after v1.3.18 (`ce86cb8`) went live:

- DAT-19: `temporal workflow list` shows exactly one running execution each for `durable-work-processor` (`durableWorkProcessorWorkflow`) and `lifecycle-timer-reconciler` (`lifecycleReconcilerProcessorWorkflow`); the cron parents recur each run, `durableWorkWorkflow` children complete, and no other durable-work or lifecycle reconciler execution is running.
- OPS-08: the web Service is ClusterIP and no Service, Ingress, hostPort or hostNetwork pod exposes the web origin; the host listens only on SSH, the k3s API/kubelet, Calico Typha and netdata; `proxy.py` is gone, and the only host `cloudflared` is the `nojv-ssh` tunnel (`ssh.nojv.tw` → `localhost:22`, everything else 404).

Owner-authorized production changes on 2026-09-26: netdata's web listener was bound to `127.0.0.1:19999` (`[web] bind to = localhost`; Netdata Cloud stays connected) and the drifted `nojv-grafana` NodePort (30517) was patched back to ClusterIP; both were unreachable from `192.168.99.3` afterwards. The chart now pins the Grafana Service type. The CNPG operator was upgraded from 1.29.1 to 1.30.1 with `ENABLE_INSTANCE_MANAGER_INPLACE_UPDATES=true`: the `nojv-pg-1` pod UID, restart count and postmaster start time were unchanged, the cluster stayed healthy and the new primary `Lease` is held by `nojv-pg-1`; `pg_dump -Fc` copies of `nojv`, `temporal` and `temporal_visibility` taken beforehand are in `/var/backups/nojv-pre-cnpg-1.30-20260926` on the host.

Production stress test on 2026-09-26, owner-approved, v1.3.18 single-machine profile: C++ submissions from the admin account, each execution dispatched directly with priority 3 so the per-student gate did not serialise them. Light phase: 100 submissions (50 sieve, 50 flood-fill, 14 cases each) all AC in 243 s, p50 125 s, p95 222 s. Heavy phase: 40 submissions spinning 0.6 s CPU per case all AC in 212 s, p50 116 s, p95 205 s. At most 5 sandbox pods ran at once; node peaks were 81% CPU, load 9.4 and 7.0 GiB used memory. All 140 executions completed on attempt 0 with no reason code, and web, worker, platform and Postgres did not restart. `temporal-history` was OOMKilled once (1Gi limit) at 08:50:31Z, as the 100 light workflows started, and recovered without losing work. The 140 submissions were then deleted with their executions and stages, and 560 storage pointers were queued for cleanup. `temporal-history` then moved to 1Gi request / 2Gi limit (Helm revision 8 of `temporal`, now also in `helm-values.single-machine.yaml`). During both phases `judge_wall_clock_timeouts_total` never incremented: no TLE was decided by the wall budget rather than CPU time.

Production sandbox quota recovery acceptance on 2026-09-27, owner-approved, v1.3.27 (`d726c966`), no real traffic in the window. C1 capacity loss: a second ResourceQuota `acceptance-hold` (`requests.cpu=1`) filled by a gVisor holder Pod; 10 light C++ submissions dispatched at 15:34:23Z produced 175 `FailedCreate` events (`exceeded quota: acceptance-hold`), 5 executions moved to `waiting_capacity` (`SandboxBackpressureError`) and 5 kept their created Jobs retrying, none became `blocked` or SE. The quota and holder were deleted at 15:37:59Z and all 10 were AC by 15:38:55Z. C2 worker restart: 10 submissions spinning 0.6 s CPU per case; `rollout restart deploy/nojv-worker` at 15:43:10Z with 5 sandbox Pods in flight, the new worker was Ready at 15:43:57Z, all 10 were AC by 15:45:53Z with `recoveryEpoch` 0 and no sandbox Pods left. A 15-minute observation afterwards showed the recovery snapshot fresh (under 60 s), `nojv_judge_queue_oldest_seconds` 0, no stuck or `blocked` executions, no `judge_cleanup_pending_total` or wall-clock TLE increase, no new SE, and sandbox quota usage back to 0. The 30 test submissions were deleted with their executions and stages, and 120 storage pointers were queued for cleanup.

Production Temporal restart drill on 2026-09-28, owner-approved, v1.3.30 (`ed141a4b`), following [Incident Recovery](../runbooks/incident-recovery.md#temporal-restart-drill): for each role, 8 submissions spinning 0.6 s CPU per case were in flight when its only pod was deleted. Seconds to the new pod Ready / to the next verdict / until the whole batch finished: frontend 12 / 12 / 38, history 3 / 5 / 32, matching 12 / 12 / 28, worker 2 / 3 / 29. `temporal operator cluster health` returned SERVING after each; all 32 submissions were AC with no `reasonCode` and `recoveryEpoch` 0, the `nojv` web and worker pods did not restart, and no sandbox Pods were left. The 32 submissions were deleted with their executions and stages, and 128 storage pointers were queued for cleanup.

Full local Playwright suite on 2026-09-28 against the marked `nojv_e2e_test` database (owner-approved reset), revision with PR #554: 227 passed, 0 failed, 7 skipped, 3 flaky (`submission-tracking.test.ts:25` for assignment and exam, `late-submission-policy.test.ts:10`). It needs `REDIS_URL=redis://127.0.0.1:6379`; `localhost` is rejected by the E2E guard.

Off-host object mirror on 2026-09-27 (owner-enabled R2 free tier; bucket `nojv-object-mirror`, account token scoped to it with Object Read & Write): `storage.minio.backup` is enabled in `nojv-production-values` with the credentials Secret `nojv-object-mirror-r2`, and the CronJob `nojv-minio-backup` runs daily at 04:00 UTC. The first run (a manual Job) copied `nojv` (13,651 objects, 1.767 GiB) and `nojv-registry` (36 objects, 42.2 MiB); object counts and sizes match MinIO exactly, and four sampled objects (a stage result, a testcase input and two submission sources) have identical MD5s on both sides.

Object store cut-over to Versity S3 Gateway on 2026-09-27, owner-approved: an in-cluster `rclone copy --metadata` pre-copied both buckets live (72 s), then the maintenance page went up at 05:22:56Z, web, both workers and the registry went to zero, a delta copy and `rclone check` (MD5 for `nojv`, full download for `nojv-registry`) passed for 13,675 objects / 1.895 GiB and 36 objects / 42.2 MiB, `S3_ENDPOINT` and `storage.active` were switched, and the release restored service at 05:27:34Z (about 4.5 minutes of downtime). Versity then rejected the app's default `S3_REGION=auto` with `AuthorizationHeaderMalformed`; `S3_REGION=us-east-1` was set on web and both workers within minutes, before any submission arrived (none were created and no storage error was logged), and the chart now renders it. A real judge run afterwards was accepted with its four objects written only to Versity, and the test submission was deleted.

Weekly Postgres dump and restore drills on 2026-09-27 (v1.3.24): `postgres.cnpg.dump` is enabled in `nojv-production-values` (R2 bucket `nojv-object-mirror`, prefix `postgres`); CNPG created the managed role `nojv_backup` (`pg_read_all_data`) online, with the postmaster start time unchanged. The first manual run took 14 s and uploaded `nojv` 4.6 MB, `temporal` 28.2 MB and `temporal_visibility` 1.2 MB, each checked with `pg_restore --list`. Postgres drill: a throwaway in-cluster PostgreSQL 18 (emptyDir) downloaded the newest dump from R2 and restored all three databases with `--exit-on-error`; all 55 `nojv` tables matched production row for row (34,704 rows), and `temporal.executions` had 14,945 rows against 14,943 live a few minutes later (workflows retired since the dump). Object drill: two submissions' source manifests and files downloaded from the R2 mirror matched the SHA-256 recorded in Postgres. The drill Jobs were deleted afterwards.

`pnpm ci:verify` does not run the integration suite, the full Playwright suite, real Docker/Kubernetes judge checks, `pnpm db:seed:validate`, Helm rendering, or production acceptance. See the [verification matrix](../runbooks/testing.md) for those commands.

## Authoritative guidance

| Topic                                                  | Source of truth                                                                                                         | Change it when                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Dependency layers and runtime entry points             | [Architecture](../architecture/ARCHITECTURE.md)                                                                         | A workspace dependency, runtime boundary, or cross-app flow changes.                     |
| Browser routes, components, and server-only boundaries | [Frontend](../architecture/FRONTEND.md)                                                                                 | A route, browser/server boundary, or shared UI ownership changes.                        |
| Judge and recovery contracts                           | [Judge pipeline](../architecture/JUDGE_PIPELINE.md) and [Reliability](RELIABILITY.md)                                   | A verdict, retry, cancellation, timeout, or recovery contract changes.                   |
| Database models and exact fields                       | [Database overview](../architecture/DATABASE.md); field reference is [generated](../architecture/DATABASE.generated.md) | Edit Prisma schema and regenerate with `pnpm db:docs`; never hand-edit generated output. |
| Security requirements and attacker model               | [Security](SECURITY.md) and [Threat model](THREAT_MODEL.md)                                                             | A trust boundary, sensitive data flow, or sandbox capability changes.                    |
| Deploy and operational procedures                      | [Deployment](DEPLOYMENT.md) and the [runbook index](../runbooks/README.md)                                              | A shipped deployment or recovery step changes.                                           |
| Feature acceptance                                     | [Feature specs](../features/)                                                                                           | User-visible behavior or API acceptance changes.                                         |
| Decisions, rationale, and rejected alternatives        | [Decision log](../decisions/README.md)                                                                                  | A durable decision is made, reversed, or refined.                                        |

## Open follow-ups

Work that is known, not done, and not covered by an in-flight plan. Remove an item in the PR that closes it.

### Production evidence

- Measure GKE judge concurrency against the sandbox quota ceiling (single-machine was measured on 2026-09-26; see the baseline). See OPS-11 and [Judge Queue](../runbooks/judge-queue.md).

### High availability

- The GKE Temporal values (`infra/gcp/gke/temporal/helm-values.ha.yaml`) are an unvalidated reference: never installed on a cluster, and HA only on a regional Cloud SQL instance behind a Cloud SQL proxy that the repository neither provisions nor checks ([Temporal HA](../../infra/gcp/gke/temporal/HA-PRODUCTION.md)). Single-machine Temporal runs one pod per role by decision (OPS-19); its restart drill is recorded in the baseline.

### Code and product

- Browser Test (WASM-OJ) deferred scope: official Submit from the browser, checker/interactive/Advanced problems, and limit calibration stay server-only until decided otherwise (JDG-15).

## Evidence rules

- Record date, source revision, exact command, scope, and result for checks that support a current quality claim.
- Keep local, CI, production, and live-behavior evidence distinct.
- Treat configured CI jobs as policy, not proof that the latest revision passed. Read the run for the revision being reviewed.
- Report integration, browser, container, cluster, and production checks only when they actually ran against an isolated target.
