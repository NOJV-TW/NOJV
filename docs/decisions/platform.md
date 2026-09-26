# Platform and operations decisions

Durable decisions for deployment, release, backups, edge, cluster capacity, CI gates and observability. Read the relevant entries before planning a change here; a change that contradicts an entry must say so and update or replace the entry in the same PR. Current mechanics live in [Deployment Guide](../operations/DEPLOYMENT.md) and [Reliability Invariants](../operations/RELIABILITY.md).

### OPS-01 The Helm chart is the only deploy path

**Decided:** 2026-06 · **Source:** [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md), [2026-04-13-testcase-blob-storage-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-13-testcase-blob-storage-design.md)

Production, single-machine k3s and GKE all deploy through `infra/charts/nojv`. `docker-compose.yml` runs only local backing services (Postgres, Redis, MinIO, Temporal) bound to `127.0.0.1`.

- Rejected: hardening a production docker-compose stack (2026-06 audit fixes, obsolete once Helm became the path); Garage in place of MinIO for local S3 (2026-04, reverted — compose runs a digest-pinned MinIO); a Terraform layer.
- Rule: do not add production or app services to docker-compose.
- Code: `infra/charts/nojv/`, `docker-compose.yml`

### OPS-02 Production deploys by in-cluster pull (Flux)

**Decided:** 2026-07 · **Source:** [2026-07-08-flux-gitops-cutover](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-08-flux-gitops-cutover.md)

An in-cluster Flux controller reconciles the `nojv` HelmRelease from git and the image registry; CI holds no cluster credentials. A self-hosted runner with cluster-admin on a public repo let any fork PR run code on the production box.

- Rejected: hardening the self-hosted runner in place; Argo CD (heavier, dashboard and multi-cluster not needed — revisit only if a dashboard becomes a requirement).
- Rule: never reintroduce self-hosted runners or cluster credentials into GitHub Actions.
- Rule: everything Flux needs is outbound; nothing pushes into the cluster. If Flux is down the cluster keeps its last-applied state.
- Rule: `nojv-runtime-secrets` stays out-of-band; if secrets ever go into git, use SOPS or Sealed Secrets.
- Code: `infra/flux/`

### OPS-03 Flux tracks a CI-written `deploy` branch as one atomic artifact

**Decided:** 2026-07 · **Source:** [2026-07-08-flux-gitops-cutover](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-08-flux-gitops-cutover.md), [2026-07-13-atomic-helm-artifact](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-13-atomic-helm-artifact.md)

CI force-updates an unprotected `deploy` branch that Flux's GitRepository tracks; image tag and digests live in `values-single-machine.yaml` on that branch, and the HelmChart uses `reconcileStrategy: Revision` so templates and image ship together. Main requires PR approval and the org disables deploy keys, so nothing can push tag bumps to main.

- Rejected: ImageUpdateAutomation committing to main (blocked by protection, re-triggers CI); an inline `spec.values.image.tag` in the HelmRelease (Kustomize and HelmChart reconciles raced into non-atomic rollouts).
- Rule: the HelmRelease carries no inline image tag, and production values come last in `valuesFiles`.
- Rule: rollback means moving `deploy` to an exact prior deploy commit, lease-protected.
- Code: `infra/flux/git-repository.yaml`, `infra/flux/helmrelease.yaml`, `tests/unit/infra/env-manifest-parity.test.ts`

### OPS-04 Releases come only from `vX.Y.Z` tags on verified main commits

**Decided:** 2026-07 · **Source:** [2026-07-24-v-tag-releases](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-24-v-tag-releases.md), [2026-08-08-simplify-release-deploy-tags](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-08-08-simplify-release-deploy-tags.md), [2026-07-24-parallel-release-images](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-24-parallel-release-images.md)

Production images build only on a strict SemVer tag whose commit is an ancestor of main and passed `Verify Repository`. One trusted preflight job feeds four parallel image jobs (web, worker, migrator, sandbox); `deploy-ref` waits for all four and writes source SHA, version and all registry-returned digests to `deploy` in one commit.

- Rejected: deploying every main push (the Flux cutover's original model); serial image builds; separate `nojv-deploy-*` tags (redundant with the exact deploy commit).
- Rule: OCI revision is the source SHA, OCI version/image tag is `vX.Y.Z`; images are digest-pinned in deploy values.
- Rule: tag only a verified post-merge main commit; merging does not authorize a tag or deploy.
- Code: `.github/workflows/build-images.yml`, `tests/unit/infra/release-gate.test.ts`

### OPS-05 Incompatible schema cutovers stop writers and forward-fix

**Decided:** 2026-09 · **Source:** [2026-09-07-course-roster](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-07-course-roster.md), [2026-09-08-prod-roster-release](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-08-prod-roster-release.md), [2026-09-08-problem-permissions](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-08-problem-permissions.md)

Incompatible migrations run through the Helm migrator maintenance flow: web, both workers and their autoscalers held at zero, a fresh stopped-write backup taken and restore-verified, then an explicit transaction that fails closed on unexpected data. After the schema commits, recovery is a forward fix or restore to a new database, never a Helm rollback alone.

- Rejected: parallel deploy paths; reusing an older backup as the rollback point; overwriting post-release data from old backups; standalone live deletes.
- Rule: applied migrations are immutable; fixes are new forward migrations.
- Rule: snapshot counts are rehearsal inputs, never constants; re-inventory right before cutover.
- Rule: never run tests against production; keep production snapshots and credentials out of the repo and PRs.
- Code: `packages/db/prisma/scripts/deploy-release.sh`

### OPS-06 Production requires verified off-host backups

**Decided:** 2026-07 · **Source:** [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md), [2026-07-13-release-preflight](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-13-release-preflight.md)

CNPG barman backup and the MinIO off-host mirror are enabled in production values, and the chart refuses to render without a real `s3://` destination and credentials Secret. Postgres (including Temporal state) and MinIO (the only copy of student source) previously had no backups at all.

- Rejected: a fabricated or unverified fallback destination.
- Rule: a backup is not "enabled" until a restore drill has run.
- Rule: MinIO submission sources are restored together with Postgres.
- Code: `infra/charts/nojv/templates/postgres-cnpg.yaml`, `infra/charts/nojv/values-single-machine.yaml`, `tests/unit/infra/backup-fail-closed.test.ts`

### OPS-07 GitOps must never be able to delete stateful data

**Decided:** 2026-07 · **Source:** [2026-07-08-flux-gitops-cutover](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-08-flux-gitops-cutover.md), [2026-07-13-release-preflight](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-13-release-preflight.md)

The Flux Kustomization keeps `prune: false`; the CNPG Cluster CR and MinIO resources carry `helm.sh/resource-policy: keep`; Postgres and MinIO volumes use reclaim `Retain`. A prune-capable controller owning the Helm-managed database CR could cascade-delete student data.

- Rule: do not enable prune while the database is in the pruned set.
- Rule: never `helm uninstall` without confirming volumes are `Retain` and backed up.
- Code: `infra/flux/git-repository.yaml`, `infra/charts/nojv/templates/postgres-cnpg.yaml`, `infra/charts/nojv/templates/minio.yaml`

### OPS-08 The origin is reachable only through Cloudflare

**Decided:** 2026-07 · **Source:** [2026-07-07-cloudflare-native-edge](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-cloudflare-native-edge.md)

In-cluster `cloudflared` points at a ClusterIP web Service (no NodePort), and `cf-connecting-ip` is trusted after `isIP` validation. A LAN-reachable NodePort let attackers forge the header and bypass the exam IP gate; the `x-nojv-edge-secret` layer and host `proxy.py` existed only to patch that and were deleted.

- Rejected: carrying over blanket `Cache-Control: no-transform` (a zstd-only Cloudflare rule is the fallback if JS corruption returns); a Terraform edge layer.
- Rule: no non-Cloudflare path to the web origin may exist while `cf-connecting-ip` is trusted.
- Rule: when changing edge trust, lock the origin first and remove the old trust mechanism last, never in the same deploy.
- Code: `infra/charts/nojv/templates/cloudflared.deployment.yaml`, `apps/web/src/lib/server/shared/client-ip.ts`

### OPS-09 Temporal stays self-hosted

**Decided:** 2026-06 · **Source:** [2026-06-11-post-audit-next-phase](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-post-audit-next-phase.md), [2026-09-24-codebase-clarity](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-24-codebase-clarity.md)

Temporal runs self-hosted in the cluster; this is closed unless operational burden or cost changes. Local compose pins `temporalio/auto-setup:1.29.1` by digest with the same dynamic config as production.

- Rejected: Temporal Cloud; downgrading to pg-boss; compose Temporal 1.31.1 (tag absent from the official registry, isolated test stacks could not start).
- Rule: local compose enables task-queue fairness to match production.
- Code: `infra/gcp/gke/temporal/`, `docker-compose.yml`, `infra/docker/temporal-dynamic-config.yaml`

### OPS-10 Teacher judge images use a self-hosted, namespace-scoped registry

**Decided:** 2026-07 · **Source:** [2026-07-12-self-hosted-registry](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-12-self-hosted-registry.md), [2026-07-20-security-hardening](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-20-security-hardening.md)

An in-cluster `registry:2` (MinIO-backed) serves special-environment images; web `/api/registry/token` issues Docker tokens against hashed platform-issued `RegistryCredential`s. Teachers get `t/<username>/**`, the judge pull account pulls all, anonymous pulls `demo/**`; judge pods pull via chart-managed imagePullSecrets. Images can contain answers, and GHCR free private storage is too small.

- Rejected: Harbor (over-engineered for a small trusted authoring population; upgrade path stays open); k3s `registries.yaml` for pulls; automatic image deletion (deletion is explicit; GC is a manual Job).
- Rule: credential-authenticated principals, admins included, have no global catalog or cross-namespace access; catalog and deletion use server-internal short-lived tokens.
- Rule: demo Advanced Mode images are an optional extra published by hand (`pnpm demo-advanced:push`, digests into the runtime Secret for the production seed), never by CI; no principal can push to `demo/**` ([#265](https://github.com/NOJV-TW/NOJV/pull/265)).
- Rule: accepted limits are a 100 MB per-layer push cap through the tunnel and per-teacher (not per-course) isolation.
- Code: `apps/web/src/routes/api/registry/token/`, `packages/db/prisma/schema/auth.prisma`, `apps/worker/src/activities/registry.ts`

### OPS-11 Sandbox ResourceQuota is the judge capacity ceiling

**Decided:** 2026-08 · **Source:** [2026-08-06-secure-low-latency-judge-autoscaling](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-06-secure-low-latency-judge-autoscaling.md), [2026-08-11-gke-judge-capacity-alignment](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-11-gke-judge-capacity-alignment.md), [2026-08-11-single-machine-throughput-tuning](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-11-single-machine-throughput-tuning.md)

The sandbox namespace ResourceQuota is the hard resource ceiling for judging; judge worker slots × `K8S_RUN_PARALLELISM` set how many cases run at once (see JDG-12 and JDG-13 in judge.md), and the chart refuses values whose CPU exceeds the quota. On GKE, node-pool autoscaling (one on-demand gVisor node plus a Spot pool from 0) already follows sandbox Jobs. Numbers live in the values files and change with tuning.

- Rejected: KEDA or any second autoscaler for the dispatcher (placeholder removed); lowering memory limits, gVisor, NetworkPolicy, PID limits or deadlines to gain throughput; persisting a single-machine profile without memory-saturation proof.
- Rule: never trade isolation for throughput.
- Rule: tune one reversible resource relationship at a time; benchmarks use isolated temporary identities and clean up.
- Code: `infra/charts/nojv/values-single-machine.yaml`, `infra/charts/nojv/values-gke.yaml`, `infra/gcp/scripts/create-node-pools.sh`

### OPS-12 Operational tunables are env vars wired through Helm

**Decided:** 2026-07 · **Source:** [2026-07-07-admin-account-ux-overhaul](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-admin-account-ux-overhaul.md)

The submission pending timeout is `SUBMISSION_PENDING_TIMEOUT_MINUTES` (default 10) read by the sweep worker, not a DB row edited in the admin UI.

- Rule: any env var read by a deployed service must be wired into the Helm chart; if it enters an env schema, give it a `.default()` so a missing value cannot crashloop the service.
- Code: `packages/application/src/submission/sweep.ts`, `infra/charts/nojv/templates/worker-platform.deployment.yaml`

### OPS-13 CI enforces security scans, a coverage ratchet and schema-doc drift

**Decided:** 2026-05 · **Source:** [2026-05-19-quality-followups](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-19-quality-followups.md), [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md), [2026-06-04-rejudge-ops-attempt-limit](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-04-rejudge-ops-attempt-limit.md)

CI runs CodeQL and a blocking `pnpm audit --audit-level high`; coverage thresholds for `packages/{application,core}/src` are ratcheted from measured values and enforced; `DATABASE.generated.md` comes from a dependency-free generator with a no-diff check. A threshold CI never runs is worse than none.

- Rejected: a Prisma generator plugin for docs; gating on moderate advisories (transitive noise would block CI).
- Rule: do not lower coverage thresholds.
- Rule: run `pnpm db:docs` whenever the schema changes.
- Code: `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `vitest.config.ts`

### OPS-14 Metrics stay in-cluster with bounded cardinality, and the in-cluster Grafana alerts

**Decided:** 2026-05 · **Source:** [2026-05-06-grafana-observability](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-06-grafana-observability.md)

Web and worker each start their own OTel NodeSDK and push metrics over OTLP HTTP to the in-cluster collector, which Prometheus scrapes together with node-exporter and CNPG; dashboards and SLO alert rules are JSON in `infra/grafana`, and the chart copies them so the in-cluster Grafana evaluates the rules and emails the mailer mailbox. Grafana Cloud receives the same series by Prometheus `remote_write` and holds dashboards only. Revised 2026-09-26 ([#532](https://github.com/NOJV-TW/NOJV/pull/532)): nothing had reached Grafana Cloud, whose rules therefore never had data, and an idle free stack hibernates.

- Rejected: Grafana Cloud as the alerting home (no data path without `remote_write`, and a hibernating free stack stops evaluating).
- Rejected: a shared OTel package (circular dependencies, per-app instrumentation choice); self-hosted Alloy; Loki, Tempo and GCP Managed Prometheus until a need appears.
- Rule: metric labels never include `userId`, `submissionId` or raw paths; use route templates to stay within the active-series budget.
- Rule: the SDK starts before any instrumented module is imported.
- Rule: web instruments are created on first use, never at module load: the metrics API has no proxy provider, and the bundled server evaluates `metrics.ts` before `hooks.server.ts` starts the SDK, which left every custom web metric a no-op until 2026-09-26.
- Rule: alert rules change in `infra/grafana/alerts/slo-alerts.json` and its chart copy together.
- Code: `apps/web/src/lib/server/otel.ts`, `apps/worker/src/otel.ts`, `infra/grafana/`, `infra/charts/nojv/templates/grafana.yaml`

### OPS-15 Web readiness depends only on Postgres and Redis

**Decided:** 2026-06 · **Source:** [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md)

Web `/api/readyz` returns 200/503 from Postgres and Redis only (`/api/livez` is separate), so a flapping Temporal does not pull web out of rotation; worker readiness actively pings Temporal.

- Rejected: gating web readiness on Temporal.
- Code: `apps/web/src/routes/api/readyz/+server.ts`, `apps/worker/src/health-server.ts`

### OPS-16 Release notification belongs to the external status Worker

**Decided:** 2026-08 · **Source:** [2026-08-07-release-deploy-notification](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-08-07-release-deploy-notification.md), [2026-08-07-status-version-notification](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-08-07-status-version-notification.md)

Web exposes a public exact-path `/api/release` returning only `{ version, sourceSha }`. The `NOJV-TW/status` Cloudflare Worker polls it with `livez`/`readyz` and notifies Discord once after two consecutive healthy observations of a new release. The release workflow ends after publishing `deploy`, since Actions has no cluster credentials and Flux rollout is asynchronous.

- Rejected: a GitHub Actions job polling production and posting to Discord (superseded the same day; its webhook secret was removed).
- Rule: `/api/release` exposes release identity only; it is exam-safe and excluded from health metrics.
- Rule: the release workflow gets no cluster credentials and runs no production health gate.
- Code: `apps/web/src/routes/api/release/+server.ts`

### OPS-17 Email is durable work over a generic SMTP mailer

**Decided:** 2026-07 · **Source:** [2026-07-10-email-notifications-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-email-notifications-design.md), [2026-07-10-email-notifications-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-email-notifications-plan.md)

`@nojv/mailer`, shared by web and worker, uses an env-configured SMTP transport so switching provider is config-only. Notification email is enqueued as database-owned durable work (`notification.email`) with retries and a dead-letter alert; `MAILER_MODE` must be explicitly `smtp`, or `sink` in dev/test.

- Rejected: a hard-wired Gmail transport in web; the original fire-and-forget "log once, never retry" delivery with silent no-op on missing config.
- Rule: delivery is at-least-once; a stable Message-ID is only a dedup hint.
- Rule: resolve account, verified address and preference immediately before sending.
- Code: `packages/mailer/src/index.ts`, `packages/application/src/notification/index.ts`

### OPS-18 Renovate is the only dependency update bot

**Decided:** 2026-09 · **Source:** PR_LINK

Renovate (`.github/renovate.json`) updates npm packages and pnpm catalog/overrides, GitHub Actions, Dockerfile and Compose images, the digest-pinned images in the chart values, the CloudNativePG operator manifest and the Temporal Helm chart pinned in the runbooks. Dependabot covered only the first four, so the CNPG operator reached its end of support unnoticed.

- Rejected: running Dependabot and Renovate side by side (two bots opening overlapping PRs); a custom version-watch workflow.
- Rule: every version installed outside `package.json` or a Dockerfile is written where a Renovate custom manager reads it (`--version` on Helm installs, a versioned manifest URL, `image: repo:tag@sha256:…` in values); a unit test fails when a manager stops matching.
- Rule: majors, and CNPG or Temporal minors, open only after approval on the dependency dashboard.
- Code: `.github/renovate.json`, `tests/unit/infra/renovate-coverage.test.ts`
