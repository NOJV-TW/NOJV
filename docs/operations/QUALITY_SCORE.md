# Quality Ledger

Current verification evidence and open follow-ups. It is a snapshot, not a substitute for running the checks again. Code merged to `main` does not prove production deployment or live behavior.

## Verified baseline

Checked on 2026-09-25 at `b651c52` with Node `24.19.0` and pnpm `11.13.1`: `pnpm ci:verify` passed formatting, repository guards, build, typecheck, lint, test typecheck, 384 unit test files (3,585 tests, including the Helm-rendering infra tests with Helm 3.18 on `PATH`) and 43 component test files (106 tests, five consecutive clean runs). `pnpm lint:helm` passed for the GKE and single-machine overlays.

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

- Activate off-site backups in production: Postgres barman archive and MinIO mirror to an external S3/R2 bucket, then run a restore drill. The single-machine overlay refuses to render until real destinations are supplied. See OPS-06 and [Backup & Restore](../runbooks/backup-restore.md).
- Wire the node-filesystem and Postgres alert rules to a Grafana datasource that actually receives in-cluster metrics (in-cluster Prometheus or `remote_write`); the rules and node-exporter exist, the datasource cannot be verified from the repository.
- Confirm the edge cutover: the origin NodePort is unreachable from the LAN and the old host proxy and tunnel are decommissioned (OPS-08).
- Measure judge latency and capacity on the deployed profiles: GKE judge concurrency against the sandbox quota ceiling, and memory safety of the single-machine quota (16 pods / 6 CPU / 16Gi). See OPS-11 and [Judge Queue](../runbooks/judge-queue.md).
- Confirm after the next release that the former durable-work singleton workflow is terminal and only the cron parent runs (DAT-19).
- Run the sandbox quota recovery acceptance in production: automatic recovery after capacity loss or worker restart, then 15 minutes of observation.

### High availability

- Temporal runs one replica on a single-instance Postgres on the single-machine target; GKE should run the official chart with at least two replicas per service (`infra/gcp/gke/temporal/HA-PRODUCTION.md`).
- `worker-platform` and the registry run one replica; on GKE run two after confirming the platform startup sweeps are safe to run concurrently.
- Web behind the GKE ingress has a 10 s preStop and no load-balancer connection-draining setting; rollouts can drop requests still routed to terminating pods.
- CNPG backups use the in-tree `barmanObjectStore`, which CNPG is deprecating in favor of the barman-cloud plugin.

### Code and product

- Push the demo Advanced Mode images to the self-hosted registry from CI and repoint the seeds, which still use `nojv-demo-advanced-*:local` in `packages/db/prisma/seeds/problems.ts` (OPS-10).
- No code emits `scoreboard_update_latency_seconds`, so the scoreboard SLO, its dashboard panel and alert have no data. Emit it from the scoreboard rebuild path or drop the SLO.
- Legacy OAuth access/refresh tokens written before `account.encryptOAuthTokens` was enabled remain plaintext; NOJV never reads them, so clearing them is safe but needs owner approval as a production data change. See the [Threat Model](THREAT_MODEL.md) open gaps.
- The legacy `submissionJudgeWorkflow` path is still dispatched (`packages/temporal/src/dispatch.ts`, and as a child of `rejudgeWorkflow`) alongside `durableJudgeWorkflow`. Retiring it (workflow, `activities/judge.ts` legacy half) needs a rollout plan so in-flight histories drain first.
- Course management authority is inconsistent: the plagiarism pair page and course announcement actions treat `course.ownerId` as a manager, while the course/assignment/exam layouts and `getCoursePermissionRole` do not; course creation is checked only in `routes/(app)/courses/new`, not in `createCourseRecord`. Consolidate into one application-level check.
- Several page loads orchestrate many application calls themselves (`routes/(app)/exams/[examId]/+page.server.ts` and the contest, assignment, admin-users and problem-edit pages); move them into application view-model queries (ENG-02).
- Route-local Zod schemas (clarifications, rejudge batch, plagiarism flags, notifications, admin mode) are re-described by hand in `apps/web/src/lib/server/openapi/internal/schemas.ts`; move them to `@nojv/core` so OpenAPI derives them (ENG-05).
- Exam access leads: the first IP binding is a read-then-write without compare-and-set, exam entry creates the session before applying the gate, a reset without an active session writes no session audit row, and a violation recorded inside a rejected submission transaction rolls back.
- Browser Test (WASM-OJ) deferred scope: official Submit from the browser, checker/interactive/Advanced problems, and limit calibration stay server-only until decided otherwise (JDG-15).
- The full Playwright suite and the Kubernetes integration suite have no recent recorded run; the E2E bootstrap needs explicit approval to reset the marked local test database.

## Evidence rules

- Record date, source revision, exact command, scope, and result for checks that support a current quality claim.
- Keep local, CI, production, and live-behavior evidence distinct.
- Treat configured CI jobs as policy, not proof that the latest revision passed. Read the run for the revision being reviewed.
- Report integration, browser, container, cluster, and production checks only when they actually ran against an isolated target.
