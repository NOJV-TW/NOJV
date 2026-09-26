# Quality Ledger

Current verification evidence and open follow-ups. It is a snapshot, not a substitute for running the checks again. Code merged to `main` does not prove production deployment or live behavior.

## Verified baseline

Checked on 2026-09-25 at `b651c52` with Node `24.19.0` and pnpm `11.13.1`: `pnpm ci:verify` passed formatting, repository guards, build, typecheck, lint, test typecheck, 384 unit test files (3,585 tests, including the Helm-rendering infra tests with Helm 3.18 on `PATH`) and 43 component test files (106 tests, five consecutive clean runs). `pnpm lint:helm` passed for the GKE and single-machine overlays.

Checked on 2026-09-26 on the local `k3d-nojv-judge` cluster (default runtime, not gVisor) with a sandbox image built from the PR #529 branch: `REQUIRE_K8S=1 pnpm test:integration:k8s` passed 15 of 15, including durable-judge recovery after real ResourceQuota pressure.

Production, read-only, on 2026-09-26 after v1.3.18 (`ce86cb8`) went live:

- DAT-19: `temporal workflow list` shows exactly one running execution each for `durable-work-processor` (`durableWorkProcessorWorkflow`) and `lifecycle-timer-reconciler` (`lifecycleReconcilerProcessorWorkflow`); the cron parents recur each run, `durableWorkWorkflow` children complete, and no other durable-work or lifecycle reconciler execution is running.
- OPS-08: the web Service is ClusterIP and no Service, Ingress, hostPort or hostNetwork pod exposes the web origin; the host listens only on SSH, the k3s API/kubelet, Calico Typha and netdata; `proxy.py` is gone, and the only host `cloudflared` is the `nojv-ssh` tunnel (`ssh.nojv.tw` → `localhost:22`, everything else 404).

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

- Activate off-site backups in production: Postgres barman archive and MinIO mirror to an external S3/R2 bucket, then run a restore drill. The single-machine overlay refuses to render until real destinations are supplied. See OPS-06 and [Backup & Restore](../runbooks/backup-restore.md). Steps await owner confirmation in the [production write verification plan](../superpowers/plans/2026-09-26-production-write-verification.md).
- Alerting has no data path (checked 2026-09-26): the alert rules, including node-filesystem and Postgres, are provisioned only to the Grafana Cloud stack, but the apps export OTLP to the in-cluster collector and the in-cluster Prometheus has no `remoteWrite`, so Grafana Cloud receives no metrics; the stack itself was paused (HTTP 503 "Loading"). The in-cluster Prometheus does scrape `node_filesystem_*` and `cnpg-postgres` (up), but the in-cluster Grafana has no alert rules. Set `observability.prometheus.remoteWrite` to the Grafana Cloud endpoint or provision the rules into the in-cluster Grafana with a contact point. `cnpg_collector_last_available_backup_timestamp` is 0: production has never completed a base backup (see the off-site backup item).
- The live `nojv-grafana` Service is a NodePort (30517) reachable from the LAN (`192.168.99.3`), although the chart renders ClusterIP without a `type`, so the manual change survives upgrades; netdata also listens on `0.0.0.0:19999`. Neither is a web-origin path (OPS-08 holds), but Grafana (login) and netdata (no auth by default) are LAN-reachable surfaces to close or document.
- Measure judge latency and capacity on the deployed profiles: GKE judge concurrency against the sandbox quota ceiling, and memory safety of the single-machine quota (16 pods / 6 CPU / 16Gi). See OPS-11 and [Judge Queue](../runbooks/judge-queue.md). Steps await owner confirmation in the [production write verification plan](../superpowers/plans/2026-09-26-production-write-verification.md).
- Run the sandbox quota recovery acceptance in production: automatic recovery after capacity loss or worker restart, then 15 minutes of observation. Steps await owner confirmation in the [production write verification plan](../superpowers/plans/2026-09-26-production-write-verification.md).

### High availability

- Temporal on the single-machine target runs one pod per role on the single CNPG instance, so node or database loss pauses workflows. The GKE values (`infra/gcp/gke/temporal/helm-values.ha.yaml`) run two pods per role with a PDB but are not cluster-validated, and they are HA only on a regional Cloud SQL instance, which the repository neither provisions nor checks ([Temporal HA](../../infra/gcp/gke/temporal/HA-PRODUCTION.md)). Options: [Temporal HA spec](../superpowers/specs/2026-09-26-temporal-ha-options.md).
- CNPG backups (`postgres-cnpg.yaml`) and the [Backup & Restore](../runbooks/backup-restore.md) recovery cluster use the in-tree `barmanObjectStore`, which CNPG has deprecated in favor of the Barman Cloud plugin; migrating needs the plugin installed next to the operator and an `ObjectStore` resource. The live operator is 1.29.1 (EOL 2026-09-29). Migration design: [Barman Cloud plugin spec](../superpowers/specs/2026-09-26-cnpg-barman-cloud-plugin.md).

### Code and product

- Several page loads orchestrate many application calls themselves (`routes/(app)/exams/[examId]/+page.server.ts` and the contest, assignment, admin-users and problem-edit pages); move them into application view-model queries (ENG-02).
- Browser Test (WASM-OJ) deferred scope: official Submit from the browser, checker/interactive/Advanced problems, and limit calibration stay server-only until decided otherwise (JDG-15).
- The full Playwright suite has no recent recorded run; the E2E bootstrap needs explicit approval to reset the marked local test database.

## Evidence rules

- Record date, source revision, exact command, scope, and result for checks that support a current quality claim.
- Keep local, CI, production, and live-behavior evidence distinct.
- Treat configured CI jobs as policy, not proof that the latest revision passed. Read the run for the revision being reviewed.
- Report integration, browser, container, cluster, and production checks only when they actually ran against an isolated target.
