# Quality Ledger

Current verification evidence and open follow-ups. It is a snapshot, not a substitute for running the checks again. Code merged to `main` does not prove production deployment or live behavior.

## Verified baseline

Checked on 2026-09-25 at `b651c52` with Node `24.19.0` and pnpm `11.13.1`: `pnpm ci:verify` passed formatting, repository guards, build, typecheck, lint, test typecheck, 384 unit test files (3,585 tests, including the Helm-rendering infra tests with Helm 3.18 on `PATH`) and 43 component test files (106 tests, five consecutive clean runs). `pnpm lint:helm` passed for the GKE and single-machine overlays.

Checked on 2026-09-26 on the local `k3d-nojv-judge` cluster (default runtime, not gVisor) with a sandbox image built from the PR #529 branch: `REQUIRE_K8S=1 pnpm test:integration:k8s` passed 15 of 15, including durable-judge recovery after real ResourceQuota pressure.

Production, read-only, on 2026-09-26 after v1.3.18 (`ce86cb8`) went live:

- DAT-19: `temporal workflow list` shows exactly one running execution each for `durable-work-processor` (`durableWorkProcessorWorkflow`) and `lifecycle-timer-reconciler` (`lifecycleReconcilerProcessorWorkflow`); the cron parents recur each run, `durableWorkWorkflow` children complete, and no other durable-work or lifecycle reconciler execution is running.
- OPS-08: the web Service is ClusterIP and no Service, Ingress, hostPort or hostNetwork pod exposes the web origin; the host listens only on SSH, the k3s API/kubelet, Calico Typha and netdata; `proxy.py` is gone, and the only host `cloudflared` is the `nojv-ssh` tunnel (`ssh.nojv.tw` → `localhost:22`, everything else 404).

Owner-authorized production changes on 2026-09-26: netdata's web listener was bound to `127.0.0.1:19999` (`[web] bind to = localhost`; Netdata Cloud stays connected) and the drifted `nojv-grafana` NodePort (30517) was patched back to ClusterIP; both were unreachable from `192.168.99.3` afterwards. The chart now pins the Grafana Service type. The CNPG operator was upgraded from 1.29.1 to 1.30.1 with `ENABLE_INSTANCE_MANAGER_INPLACE_UPDATES=true`: the `nojv-pg-1` pod UID, restart count and postmaster start time were unchanged, the cluster stayed healthy and the new primary `Lease` is held by `nojv-pg-1`; `pg_dump -Fc` copies of `nojv`, `temporal` and `temporal_visibility` taken beforehand are in `/var/backups/nojv-pre-cnpg-1.30-20260926` on the host.

Production stress test on 2026-09-26, owner-approved, v1.3.18 single-machine profile: C++ submissions from the admin account, each execution dispatched directly with priority 3 so the per-student gate did not serialise them. Light phase: 100 submissions (50 sieve, 50 flood-fill, 14 cases each) all AC in 243 s, p50 125 s, p95 222 s. Heavy phase: 40 submissions spinning 0.6 s CPU per case all AC in 212 s, p50 116 s, p95 205 s. At most 5 sandbox pods ran at once; node peaks were 81% CPU, load 9.4 and 7.0 GiB used memory. All 140 executions completed on attempt 0 with no reason code, and web, worker, platform and Postgres did not restart. `temporal-history` was OOMKilled once (1Gi limit) at 08:50:31Z, as the 100 light workflows started, and recovered without losing work. The 140 submissions were then deleted with their executions and stages, and 560 storage pointers were queued for cleanup.

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

- Activate off-site backups in production: Postgres barman archive and MinIO mirror to an external S3/R2 bucket, then run a restore drill. The single-machine overlay refuses to render until real destinations are supplied. See OPS-06 and [Backup & Restore](../runbooks/backup-restore.md). Steps await owner confirmation in the [production write verification plan](../superpowers/plans/2026-09-26-production-write-verification.md). Deferred by the owner on 2026-09-26 (no budget for off-site storage); production has never taken a base backup (`cnpg_collector_last_available_backup_timestamp` is 0).
- Measure GKE judge concurrency against the sandbox quota ceiling (single-machine was measured on 2026-09-26; see the baseline). See OPS-11 and [Judge Queue](../runbooks/judge-queue.md).
- `temporal-history` OOMKilled at its 1Gi limit when 100 judge workflows started together (2026-09-26 stress test). The limit is a live-only Helm override on the `temporal` release; raise it and move the history resources into `infra/gcp/gke/temporal/helm-values.single-machine.yaml` (see the [Temporal HA spec](../superpowers/specs/2026-09-26-temporal-ha-options.md)).
- Run the sandbox quota recovery acceptance in production: automatic recovery after capacity loss or worker restart, then 15 minutes of observation. Steps await owner confirmation in the [production write verification plan](../superpowers/plans/2026-09-26-production-write-verification.md).

### High availability

- Temporal on the single-machine target runs one pod per role on the single CNPG instance, so node or database loss pauses workflows. The GKE values (`infra/gcp/gke/temporal/helm-values.ha.yaml`) run two pods per role with a PDB but are not cluster-validated, and they are HA only on a regional Cloud SQL instance, which the repository neither provisions nor checks ([Temporal HA](../../infra/gcp/gke/temporal/HA-PRODUCTION.md)). Options: [Temporal HA spec](../superpowers/specs/2026-09-26-temporal-ha-options.md).
- CNPG backups (`postgres-cnpg.yaml`) and the [Backup & Restore](../runbooks/backup-restore.md) recovery cluster use the in-tree `barmanObjectStore`, which CNPG has deprecated in favor of the Barman Cloud plugin; migrating needs the plugin installed next to the operator and an `ObjectStore` resource. The operator was upgraded in place to 1.30.1 on 2026-09-26 without a Postgres restart. Migration design: [Barman Cloud plugin spec](../superpowers/specs/2026-09-26-cnpg-barman-cloud-plugin.md).

### Code and product

- Browser Test (WASM-OJ) deferred scope: official Submit from the browser, checker/interactive/Advanced problems, and limit calibration stay server-only until decided otherwise (JDG-15).
- The full Playwright suite has no recent recorded run; the E2E bootstrap needs explicit approval to reset the marked local test database.

## Evidence rules

- Record date, source revision, exact command, scope, and result for checks that support a current quality claim.
- Keep local, CI, production, and live-behavior evidence distinct.
- Treat configured CI jobs as policy, not proof that the latest revision passed. Read the run for the revision being reviewed.
- Report integration, browser, container, cluster, and production checks only when they actually ran against an isolated target.
