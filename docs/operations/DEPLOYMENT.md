# Deployment Guide

NOJV deploys to **both** single-machine Kubernetes (k3s / kind on one node) and
**GKE** through the **same Helm umbrella chart** at `infra/charts/nojv`. Docker
Compose is **local development only** — it is not a deployment method. The deploy
procedure (chart install + prerequisites) is in
[Helm Deployment](#helm-deployment) below.

## Local Development (Docker Compose)

> Docker Compose runs the backing services as containers so you can run the app
> from source with `pnpm dev`. It is **not** a production or deployment path —
> see [Helm Deployment](#helm-deployment) for that.

### Services

| Service     | Image                        | Port       | Purpose                      |
| ----------- | ---------------------------- | ---------- | ---------------------------- |
| postgres    | postgres:18-alpine           | 5432       | Database (app + Temporal)    |
| redis       | redis:8-alpine               | 6379       | Cache, pub/sub, scoreboard   |
| minio       | minio/minio                  | 9000, 9001 | S3-compatible object storage |
| temporal    | temporalio/auto-setup:1.29.1 | 7233       | Workflow engine              |
| temporal-ui | temporalio/ui:2.38.2         | 8080       | Workflow monitoring          |

Compose ships **only** these backing services — the app (web/worker) runs from
source via `pnpm dev`, and the sandbox image is built with `pnpm sandbox:build`.
Deployable images are built and shipped by the Helm chart path (see
[Helm Deployment](#helm-deployment)).

### Quick Start

```bash
# Start the local backing services, then run the app from source
docker compose up -d
pnpm dev
```

### Temporal Auto-Setup

The `temporalio/auto-setup` image automatically:

- Creates the Temporal database schema in PostgreSQL
- Configures the `default` namespace
- Starts the Temporal server

It shares the same PostgreSQL instance as the application (separate schema).

## Environment Variables

### Required

| Variable             | Default                                              | Purpose                                       |
| -------------------- | ---------------------------------------------------- | --------------------------------------------- |
| `DATABASE_URL`       | `postgresql://postgres:postgres@localhost:5432/nojv` | PostgreSQL connection                         |
| `REDIS_URL`          | `redis://localhost:6379`                             | Redis connection                              |
| `BETTER_AUTH_SECRET` | —                                                    | Session encryption key (change in production) |
| `BETTER_AUTH_URL`    | `http://localhost:5173`                              | Frontend URL for OAuth redirects              |

### Web

| Variable                            | Default                                                                                                 | Purpose                                                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BODY_SIZE_LIMIT`                   | `67108864`                                                                                              | SvelteKit adapter-node POST body cap, in bytes. Baked into `web.Dockerfile` at 64 MiB so the 60 MB cap on bundle/workspace/checker/interactor upload routes is the effective ceiling. The adapter's built-in default is 512 KiB and would reject every asset upload. |
| `ADVANCED_IMAGE_ALLOWED_REGISTRIES` | `ghcr.io,docker.io,quay.io,registry.gitlab.com,gcr.io,public.ecr.aws,mcr.microsoft.com,registry.k8s.io` | Comma-separated registry hosts accepted for teacher-supplied special_env image refs (default trusts the major public registries). Refs must be digest-pinned; validated at the input layer only (chart value `web.advancedImageAllowedRegistries`).                  |

### OAuth (Optional)

| Variable               | Purpose                    |
| ---------------------- | -------------------------- |
| `GITHUB_CLIENT_ID`     | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app secret    |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID     |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

### Email

`MAILER_MODE` has no default. Production web and platform workers must use
`smtp`; they validate the complete configuration before serving work. The Helm
chart sets `MAILER_MODE=smtp`, takes `SMTP_PORT` from `mailer.smtpPort`, and
requires the remaining values from the runtime Secret. Judge-only workers do
not receive or validate mailer configuration.

| Variable       | Production requirement                                                  |
| -------------- | ----------------------------------------------------------------------- |
| `MAILER_MODE`  | `smtp`                                                                  |
| `SMTP_HOST`    | Non-empty SMTP host                                                     |
| `SMTP_PORT`    | Integer port; `465` uses implicit TLS, every other port forces STARTTLS |
| `SMTP_USER`    | Non-empty SMTP username                                                 |
| `SMTP_PASS`    | SMTP app password / credential, never a mailbox login password          |
| `SMTP_FROM`    | Explicit sender header                                                  |
| `APP_BASE_URL` | Absolute HTTPS base URL for email links                                 |

Local development and tests may explicitly use `MAILER_MODE=sink`. Sink mode
returns `suppressed`, emits a content-free structured event, and rejects every
`SMTP_*` variable (including empty values). SMTP errors never fall back to sink.

### Temporal

| Variable             | Default          | Purpose                 |
| -------------------- | ---------------- | ----------------------- |
| `TEMPORAL_ADDRESS`   | `localhost:7233` | Temporal Server address |
| `TEMPORAL_NAMESPACE` | `default`        | Temporal namespace      |

### Worker

`parseWorkerEnv` validates these at boot and throws on any missing **required**
key — there are no implicit defaults for the required ones below, so the
deployment manifest must set every one. `tests/unit/infra/env-manifest-parity.test.ts`
is a fitness test that fails CI if the GKE manifest omits a required worker env.

| Variable                             | Required / Default                   | Purpose                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXECUTION_BACKEND`                  | **required** (`docker`/`kubernetes`) | Sandbox executor backend                                                                                                                                                          |
| `SANDBOX_IMAGE`                      | **required**                         | Sandbox container image                                                                                                                                                           |
| `PORT`                               | **required**                         | Worker health server port (`/healthz`, `/readyz`)                                                                                                                                 |
| `WORKER_CONCURRENCY`                 | **required**                         | Activity concurrency per task queue                                                                                                                                               |
| `WORKER_MODE`                        | `all`                                | Task queues: `all`, `judge`, `platform`                                                                                                                                           |
| `SUBMISSION_PENDING_TIMEOUT_MINUTES` | `10` (range 10–1440)                 | Platform sweeper cutoff: pending/running submissions older than this are terminated and marked `system_error`. Read directly from env; only the `platform` worker runs the sweep. |
| `SANDBOX_CPU_LIMIT`                  | **required** (Docker backend)        | CPU limit per sandbox                                                                                                                                                             |
| `SANDBOX_MEMORY_MB`                  | **required** (Docker backend)        | Memory limit per sandbox (MB)                                                                                                                                                     |
| `SANDBOX_PIDS_LIMIT`                 | **required** (Docker backend)        | PID limit per sandbox                                                                                                                                                             |
| `K8S_NAMESPACE`                      | **required** (Kubernetes backend)    | Namespace for sandbox pods                                                                                                                                                        |
| `K8S_CPU_REQUEST`                    | **required** (Kubernetes backend)    | Sandbox pod CPU request                                                                                                                                                           |
| `K8S_CASE_CPU_REQUEST`               | **required** (Kubernetes backend)    | CPU request for each testcase container                                                                                                                                           |
| `K8S_CPU_LIMIT`                      | **required** (Kubernetes backend)    | Sandbox pod CPU limit                                                                                                                                                             |
| `K8S_MEMORY_REQUEST`                 | **required** (Kubernetes backend)    | Sandbox pod memory request                                                                                                                                                        |
| `K8S_MEMORY_LIMIT`                   | **required** (Kubernetes backend)    | Sandbox pod memory limit                                                                                                                                                          |
| `K8S_MAX_PARALLEL_CASES`             | **required** (Kubernetes backend)    | Maximum testcase containers per sandbox Job wave (1–20)                                                                                                                           |
| `K8S_RUNTIME_CLASS_NAME`             | **required** (Kubernetes backend)    | RuntimeClass required for every sandbox Pod; production is `gvisor`                                                                                                               |

> The `SANDBOX_*` resource limits are read only by the Docker backend; the
> `K8S_*` limits only by the Kubernetes backend. The schema enforces this split,
> so each backend requires exactly the keys it actually uses.

> Advanced-mode (`special_env`) judging runs on **both** backends: run/grade
> images execute as K8s Jobs (including the `none` / `service` network
> modes — see [Judge Pipeline](../architecture/JUDGE_PIPELINE.md#advanced-mode-pipeline)
> and `tests/integration/k8s/judge-k8s.test.ts`). Registry image refs are the
> only advanced authoring path: teachers download the starter templates from the
> problem editor, build the run/grade/service images themselves, push to an
> allowlisted registry, and paste digest-pinned refs back into the editor (gated
> per-user by `User.canCreateAdvancedProblems`).

> **Self-hosted registry** (`registry.enabled`, on by default in the
> single-machine overlay): a CNCF distribution `registry:2` Deployment stores
> blobs in the in-cluster MinIO (bucket `nojv-registry`, auto-created by a Helm
> hook) or any S3 endpoint (`registry.s3.regionendpoint` — GKE points it at
> GCS). Auth is Docker token auth: the web app's `/api/registry/token` endpoint
> validates platform-issued credentials (generated per-author from the problem
> editor) and signs scoped JWTs — every human credential, including an admin's,
> pushes only to its own `t/<username>/…` namespace; judge
> pods pull everything via the `worker.sandbox.imagePullSecret` dockerconfigjson
> Secret in the sandbox namespace, `demo/…` is anonymous-pull. Setup steps
> (signing pair, service accounts, tunnel hostname) are in the
> [single-machine runbook](../runbooks/k8s-single-machine.md#5-prerequisites-the-chart-does-not-install).

### Object Storage (S3-Compatible)

| Variable        | Default                 | Purpose                                                               |
| --------------- | ----------------------- | --------------------------------------------------------------------- |
| `S3_ENDPOINT`   | `http://localhost:9000` | S3 API endpoint (MinIO local)                                         |
| `S3_ACCESS_KEY` | `minioadmin`            | S3 access key (MinIO root user)                                       |
| `S3_SECRET_KEY` | `minioadmin`            | S3 secret key (MinIO root password)                                   |
| `S3_BUCKET`     | `nojv`                  | Bucket name                                                           |
| `S3_PUBLIC_URL` | —                       | Reserved; not currently consumed by the storage client. Safe to omit. |
| `S3_REGION`     | `auto`                  | S3 region (`auto` works for GCS/R2)                                   |

Local dev uses MinIO. Production can use GCS (S3-compatible mode), Cloudflare R2, or AWS S3 — change env vars only.

> **No TLS to backends from the app.** `REDIS_URL` accepts only `redis://`
> (`packages/redis`) and the Temporal client connects without TLS
> (`packages/temporal`). Run Redis/Memorystore and Temporal on a private network
> the app reaches over a trusted link (VPC), not over the public internet.

### Kubernetes (Production Only)

| Variable                 | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `K8S_NAMESPACE`          | Kubernetes namespace for sandbox jobs                  |
| `K8S_CPU_REQUEST`        | CPU request per sandbox pod                            |
| `K8S_CASE_CPU_REQUEST`   | CPU request per testcase container                     |
| `K8S_CPU_LIMIT`          | CPU limit per sandbox pod                              |
| `K8S_MEMORY_REQUEST`     | Memory request per sandbox pod                         |
| `K8S_MEMORY_LIMIT`       | Memory limit per sandbox pod                           |
| `K8S_MAX_PARALLEL_CASES` | Maximum testcase containers per Job wave               |
| `K8S_RUNTIME_CLASS_NAME` | Required sandbox RuntimeClass (`gvisor` in production) |

## Observability

Metrics flow Node app → OpenTelemetry SDK → OTLP HTTP → Grafana Cloud Hosted Prometheus (region `prod-ap-northeast-0`, free tier). Dashboards at <https://takalawang.grafana.net>.

### Required env vars (production)

Inject via the chart's runtime secret (or GCP Secret Manager → External Secrets):

| Var                                      | Description                                                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`            | Base URL; apps append `/v1/metrics`. e.g. `https://otlp-gateway-prod-ap-northeast-0.grafana.net/otlp` or in-cluster collector `http://<release>-otel-collector.<ns>.svc:4318` |
| `OTEL_EXPORTER_OTLP_HEADERS`             | Optional comma-separated `key=value` headers. Grafana Cloud: `Authorization=Basic <base64(instanceId:token)>`. Omit for an unauthenticated in-cluster collector.              |
| `OTEL_SERVICE_NAME_WEB` (web only)       | Default `nojv-web`                                                                                                                                                            |
| `OTEL_SERVICE_NAME_WORKER` (worker only) | Default `nojv-worker`                                                                                                                                                         |

If `OTEL_EXPORTER_OTLP_ENDPOINT` is unset/empty, the SDK no-ops. CI and tests run without these.

### First-time stack setup

See [Observability Setup Runbook](../runbooks/observability-setup.md).

### Dashboard updates

`pnpm grafana:provision` (idempotent, `overwrite:true`) reads dashboard JSONs from `infra/grafana/dashboards/` and uploads via the Grafana API. Requires `GRAFANA_STACK_URL` + `GRAFANA_SA_TOKEN` (Admin role) in env.

### Worker shutdown hook

`apps/worker/src/index.ts` `gracefulShutdown` awaits `shutdownOtel()` after `app.shutdown()` so the last 30s metric interval is flushed before `process.exit(0)`. Web relies on adapter-node lifecycle and may lose 0–30s on shutdown (accepted trade-off).

### Temporal Workflow Versioning (REQUIRED before editing any workflow)

Temporal replays a running workflow's full event history against the **current** workflow code on every worker poll. Long-lived workflows in this repo — `contestLifecycleWorkflow` (runs an entire contest), `examAutoCloseWorkflow` (spans a whole exam), the `submissionSweeperWorkflow` cron — can be mid-flight when a new worker version deploys. Any change to a workflow's command sequence (new/removed/reordered activity, signal, timer, or `condition`) makes replay of an in-flight execution diverge → non-determinism error → the workflow gets stuck or fails.

Rules when changing code under `apps/worker/src/workflows/`:

1. Guard every behavioral change with `patched(patchId)` / `deprecatePatch(patchId)` (TypeScript SDK) so old histories replay the old path and new executions take the new one. Never silently reorder or add activity calls.
2. Pure refactors that do not change the command sequence (renaming locals, extracting non-activity helpers) are safe without a patch.
3. Short-lived workflows (`submissionJudgeWorkflow`, `rejudgeWorkflow`, `plagiarismCheckWorkflow`) usually drain within minutes; for those, draining in-flight executions before rollout is an acceptable alternative to patching — confirm none are running (`temporal workflow list`) before deploying a breaking change.
4. Workflow / query / signal **names** are a separate cross-package contract — see the registration fitness test under `tests/unit/worker/`.

There is intentionally **no** `patched()` usage in the tree today because no workflow has yet needed a backward-incompatible change; the first such change must introduce it.

## Single-Machine k3s (Kubernetes backend on one box)

To run the Kubernetes sandbox backend on a **single machine** — getting
quota-bounded per-submission sandbox Jobs without GKE — follow the
[Single-Machine k3s Runbook](../runbooks/k8s-single-machine.md). It installs k3s
with a NetworkPolicy-enforcing CNI (Calico, **required** — k3s's default flannel
does not enforce policy and the worker fails closed without it), then installs
the **same Helm chart** (`infra/charts/nojv`) used for GKE with the
single-machine values overlay, and covers bounded web autoscaling plus
per-submission sandbox capacity. It is the entry point
on the spectrum **single-node k3s → multi-node k3s → GKE** ([GKE Rollout](#gke-rollout)).

**CD pipeline (`.github/workflows/build-images.yml`).** Merging to `main` runs
CI only. Pushing a stable `vX.Y.Z` tag for a main commit whose
`Verify Repository` check passed builds and pushes the four runtime images to
GHCR under that version. The workflow writes the source SHA, version tag, and
four verified digests to the `deploy` branch; Flux reconciles that branch and
k3s pulls the digest-pinned images from GHCR. One-time: set those four GHCR
packages to **Public** so k3s can pull without an imagePullSecret.

The release workflow finishes after publishing the verified `deploy` branch
revision; Flux reconciliation and Kubernetes readiness own the rollout. The separate
[`NOJV-TW/status`](https://github.com/NOJV-TW/status) Worker verifies
`/api/release`, `/api/livez`, and `/api/readyz` on its minute schedule and owns
release notifications through the existing status Discord webhook. This keeps
public verification outside GitHub-hosted runner network policy and avoids a
second, conflicting source of deployment health.

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

### Single-machine capacity ceiling (bounded autoscaling)

The single-machine deployment has web HPA but no node autoscaler. Sandbox
capacity is deliberately bounded by quota, so bursts queue safely instead of
overcommitting the host:

| Tier     | Single-machine (`values-single-machine.yaml`) | Autoscaling on one box                                             |
| -------- | --------------------------------------------- | ------------------------------------------------------------------ |
| web      | 1 replica, HPA min 1 / max 3                  | CPU target 70%; scales only within the single node.                |
| judge    | 1 worker, `WORKER_CONCURRENCY=4`              | Fixed; two sandbox Jobs already consume the configured host quota. |
| platform | 1 worker                                      | Fixed.                                                             |
| sandbox  | quota `4` CPU / `12Gi` / `4` pods             | No node autoscaler; excess Jobs stay Pending until capacity frees. |

**Real concurrent-submission ceiling.** On the Kubernetes backend a submission's
judge Job batches up to 20 testcase containers and requests roughly `2` CPU /
`5Gi` for a full wave. The single-machine quota therefore admits at most two
20-case submissions concurrently; other workflows remain durable and wait for
capacity. This is classroom capacity, not exam-hall capacity. Increase the
quota only with measured host headroom, or move to GKE for bounded node scale-out.

## GCP Production Architecture

```
    Internet
       │
       ▼
  ┌─────────────┐
  │ Cloudflare  │  ← DNS + TLS + CDN + WAF + DDoS + sets CF-Connecting-IP
  └──────┬──────┘
         │ (only path allowed to origin)
         ▼
  ┌──────────────────┐
  │  GKE Ingress/LB  │  ← origin restricted to Cloudflare (Cloud Armor allowlist)
  └──────┬───────────┘
         │
         ▼
  ┌──────────────────────── GKE cluster (Helm chart: infra/charts/nojv) ────────────────────────┐
  │   web (Deployment + Service)        worker-judge / worker-platform (Deployments)             │
  │              │                                   │                                           │
  │              ├───► Postgres: in-cluster CloudNativePG  *or*  managed Cloud SQL                │
  │              ├───► Redis: in-cluster  *or*  managed Memorystore                               │
  │              ├───► S3: in-cluster MinIO  *or*  GCS / R2                                        │
  │              └───► Temporal Server (prerequisite, official Helm chart, ns nojv-temporal)      │
  │                                                  │                                           │
  │                                       worker ───► K8s Jobs (sandbox, ns nojv-sandbox)         │
  └────────────────────────────────────────────────────────────────────────────────────────────┘
```

Both web and the workers run **inside the cluster** as chart Deployments — there
is no serverless tier. Web is fronted by Cloudflare at the edge and the GKE
Ingress/LB origin is restricted to Cloudflare's CIDR ranges (see
[Cloudflare + Cloud Armor Setup](#cloudflare--cloud-armor-setup)).

### Service Mapping

| Component | Where it runs                                        | Scaling                                         |
| --------- | ---------------------------------------------------- | ----------------------------------------------- |
| web       | Chart Deployment (+ HPA on GKE)                      | HPA min 2 / max 15 (`web.hpa.*`)                |
| worker    | Chart Deployments (judge + platform)                 | Static replicas sized to sandbox capacity       |
| migrator  | Chart pre-install/pre-upgrade Helm hook              | One-shot per release                            |
| seed      | Chart post-install Helm hook (opt-in `seed.enabled`) | One-shot per release                            |
| sandbox   | K8s Jobs (`nojv-sandbox`)                            | Per-submission, quota + node cluster-autoscaler |
| postgres  | In-cluster CloudNativePG _or_ Cloud SQL              | Vertical (manual) / CNPG instances              |
| redis     | In-cluster _or_ Memorystore                          | Vertical (manual)                               |
| temporal  | Official Temporal Helm chart (prereq)                | Per HA-PRODUCTION.md                            |
| images    | Artifact Registry                                    | —                                               |
| secrets   | Chart runtime secret / Secret Manager                | —                                               |

> **Autoscaling layers.** Concurrent-user spikes are absorbed by the **web** HPA.
> Submission bursts are absorbed by sandbox Jobs, capped by the ResourceQuota;
> on GKE, one on-demand gVisor node is always present and a gVisor Spot pool
> scales from 0 to 4 nodes. The judge worker remains fixed because it dispatches
> I/O-bound work and additional replicas do not create sandbox capacity.

## Helm Deployment

NOJV deploys to single-machine k8s and GKE through the **same** umbrella chart
at `infra/charts/nojv` — only the values overlay differs. The chart renders web,
the two Temporal workers, worker RBAC + PDBs, the namespaces, the sandbox
namespace policy (deny-all NetworkPolicy + ResourceQuota + LimitRange), the
worker-egress NetworkPolicy, the migrator Helm hook, and (optionally) in-cluster
Postgres (CloudNativePG), Redis, and MinIO. The full knob reference is in
[`infra/charts/nojv/README.md`](../../infra/charts/nojv/README.md).

The single-machine Flux release pipeline and the GKE deploy script both supply
the image tag plus a registry-verified digest for each of web, worker, sandbox,
and migrator. A direct Helm install must supply the same four
`image.digests.*` values; tag-only renders fail closed.

### Prerequisites (one-time, not installed by the chart)

1. **Runtime secret** — an existing `Secret` (default `nojv-runtime-secrets`) in
   the app namespace holding `DATABASE_URL`, `REDIS_URL`, the `S3_*` keys, the
   web auth secrets (`BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`), required SMTP
   credentials plus `APP_BASE_URL`, OAuth, optional Grafana OTLP keys, and — when `seed.enabled` — the
   `SEED_ADMIN_USERNAME`/`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` the seed hook
   provisions the super admin from (password ≥ 12 chars, single-use), plus
   digest-pinned `SEED_ADVANCED_RUN_IMAGE`/`SEED_ADVANCED_GRADE_IMAGE` demo
   refs. Copy and
   fill
   [`infra/charts/nojv/secret.example.yaml`](../../infra/charts/nojv/secret.example.yaml);
   the chart never templates secret values.
2. **CloudNativePG operator** (when `postgres.mode=cnpg`) — `kubectl apply` the
   operator cluster-wide; the chart only renders the CNPG `Cluster` +
   `ScheduledBackup` CRs. See [Backup & Restore](../runbooks/backup-restore.md)
   for the CNPG backup/restore story.
3. **Temporal Server** — installed via the official `temporalio/temporal` Helm
   chart, reachable at `temporal.address`
   (default `temporal-frontend.nojv-temporal.svc.cluster.local:7233`):

   ```bash
   helm repo add temporal https://go.temporal.io/helm-charts
   # HA (GKE): replicas ≥ 2 + an HA database — see HA-PRODUCTION.md
   helm install temporal temporal/temporal -n nojv-temporal --create-namespace \
     -f infra/gcp/gke/temporal/helm-values.ha.yaml
   # Single-machine: a single-replica install is acceptable.
   ```

   Temporal options + cost are in
   [`infra/gcp/gke/temporal/HA-PRODUCTION.md`](../../infra/gcp/gke/temporal/HA-PRODUCTION.md).

### Building images (Cloud Build)

`infra/gcp/cloud-build/deploy.sh` builds and pushes the container images
(`web`, `worker`, `sandbox`, `migrator`) to Artifact Registry, reads each pushed
tag's digest back from the registry, and deploys the resulting immutable refs
through Helm.

```bash
export PROJECT_ID=...
export REGION=asia-east1
export REPOSITORY=nojv
export RELEASE_NAME=nojv
export RELEASE_SHA="$(git rev-parse HEAD)"
export RELEASE_REMOTE=origin
export RELEASE_REF=refs/heads/main
export CLUSTER_NAME=nojv-prod
export CLUSTER_LOCATION=asia-east1
export DEPLOY_PRINCIPAL=deployer@example.com
export CLOUD_BUILD_SERVICE_ACCOUNT=cloud-build@PROJECT_ID.iam.gserviceaccount.com
export K8S_NAMESPACE=nojv
export PUBLIC_HOST=nojv.tw
export REGISTRY_HOST=registry.nojv.tw
export TLS_SECRET_NAME=nojv-origin-tls
export EDGE_SECURITY_POLICY=nojv-cloudflare-only
export CLOUDSQL_INSTANCE_CONNECTION_NAME=PROJECT_ID:asia-east1:nojv-db
export REDIS_INSTANCE=nojv-redis
bash infra/gcp/cloud-build/deploy.sh
```

The script has no ambient project, cluster, principal, kube-context, source-ref,
or release-identity fallback. Before any cloud mutation it requires a clean
working tree and proves `RELEASE_SHA = HEAD = RELEASE_REMOTE:RELEASE_REF`. It
then makes Cloud Build fetch that exact SHA from the canonical GitHub repository;
the signed provenance must bind that Git source and commit. The local archive is
used only for the matching Helm release, never as an unverified build source. The
commit SHA is both the readable image tag and OCI/Helm provenance metadata; the
registry digest makes the deployed image immutable. Direct manual Cloud Build
submission is intentionally unsupported because it bypasses these source checks.
`RELEASE_REMOTE` must be the configured `origin` for the canonical
`NOJV-TW/NOJV` repository, and Git replacement objects are rejected. Before
building, the script also proves that Cloud SQL and Memorystore resolve to
private addresses, derives the exact NetworkPolicy CIDRs from live resources,
verifies the TLS Secret, and requires Cloud Armor to allow exactly
`infra/gcp/cloudflare-origin-cidrs.txt` with an enforced default deny.

### GKE Rollout

1. Build, resolve, and deploy images with the script above.
2. Create the runtime secret (prerequisite 1) and ensure the CloudNativePG
   operator + Temporal Server prerequisites are installed (2 and 3).
3. Verify the Helm release installed by the script. It renders the namespaces
   (`nojv`, `nojv-sandbox`), the two worker
   Deployments split by `WORKER_MODE` (`nojv-worker` judge / `nojv-worker-platform`
   platform) with separate service accounts and least-privilege RBAC + PDBs, web (Deployment + Service + optional
   Ingress), the worker-egress NetworkPolicy (`networkPolicy.enabled`), the
   sandbox namespace policy (`restricted` Pod Security admission + deny-all NetworkPolicy + ResourceQuota + LimitRange),
   and the migrator as a pre-install/pre-upgrade Helm hook that runs Prisma
   migrations before the new Pods roll out. On GKE with `postgres.mode=cloudsql`,
   each worker Pod runs the Cloud SQL Auth Proxy sidecar
   (`cloudsqlProxy.enabled=true`) — see
   [`infra/gcp/gke/README.md`](../../infra/gcp/gke/README.md).

   `sandbox.networkPolicy.enabled` and the top-level `networkPolicy.enabled`
   protect different boundaries. The former denies sandbox ingress/egress;
   the latter restricts worker egress to Temporal, Redis, storage APIs, and
   the Kubernetes API needed to create Jobs. Neither is a production override
   for the other, and the worker allowlist does not reopen arbitrary Internet
   access.

4. **A NetworkPolicy-enforcing CNI is a HARD security requirement on the
   Kubernetes backend.** On the Kubernetes backend, ALL sandbox egress isolation
   (the `deny-all-sandbox` policy plus the per-submission egress policies) is
   inert unless the cluster CNI actually enforces NetworkPolicy — a non-enforcing
   CNI (k3s default flannel, kindnet) silently ignores it and every sandbox Pod
   can reach the internet, letting students get outside help. You **must** run a
   NetworkPolicy-enforcing CNI: **GKE Dataplane V2** (or a Standard cluster with
   `--enable-network-policy`), or **Calico/Cilium**. **GKE Autopilot has
   Dataplane V2 always-on**, which is the simplest way to guarantee enforcement.
   For k3s, start the server with `--flannel-backend=none
--disable-network-policy --kubelet-arg=pod-max-pids=256` and install Calico or
   Cilium. The kubelet flag bounds processes per Pod cgroup; a sandbox-side
   `ulimit -u` is invalid here because it is shared by host UID across Pods.

   The worker now **fails closed**: at startup, when `EXECUTION_BACKEND=kubernetes`,
   it runs a positive/negative internal egress probe and **refuses to start the
   judge worker** unless the CNI enforces NetworkPolicy (see
   `apps/worker/src/services/k8s-netpol-probe.ts`). The probe reaches an
   explicitly allowed target and must fail to reach a target without an egress
   allow rule, so an external firewall cannot produce a false positive. There
   is no bypass: a Kubernetes judge worker requires an enforcing CNI. Use the
   Docker backend for local development when no enforcing CNI is available.

   The temporary probe Pods and policies are deleted after the check. The same
   isolation is asserted in CI by `tests/integration/k8s/judge-k8s.test.ts` and
   `tests/unit/infra/network-policy-parity.test.ts`, but those run against dev
   infra — the startup self-check confirms the live cluster's CNI honors it.

Pre-requisites: two GKE node pools `pool-worker` (untainted) and
`pool-sandbox` (tainted `nojv-role=sandbox:NoSchedule`). The worker pins to
the worker pool via `nodeSelector: nojv-role=worker`; sandbox Jobs are
created with a matching toleration so a runaway submission can never starve
the orchestrator. Full `gcloud container node-pools create` recipes live in
[`infra/gcp/gke/README.md`](../../infra/gcp/gke/README.md).

### Dockerfiles

| Dockerfile                               | Purpose                    |
| ---------------------------------------- | -------------------------- |
| `infra/docker/web.Dockerfile`            | SvelteKit production build |
| `infra/docker/worker.Dockerfile`         | Temporal worker            |
| `infra/docker/sandbox-runner.Dockerfile` | Sandbox execution runtime  |
| `infra/docker/migrator.Dockerfile`       | Database migration runner  |

#### Standard judge toolchain

`packages/core/src/judge-environment.json` is the source of truth for the
standard judge image, runner commands, and public `/environment` page. The
sandbox Dockerfile installs these exact revisions and fails its build when the
pinned base image no longer matches the recorded Alpine or Node.js version.

| Component    | Pinned version                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base OS      | `Alpine Linux 3.24.1`                                                                                                                                                                               |
| Node runtime | `Node.js 24.18.0`                                                                                                                                                                                   |
| APK packages | `bash=5.3.9-r1`, `build-base=0.5-r4`, `cargo=1.96.1-r0`, `g++=15.2.0-r5`, `gcc=15.2.0-r5`, `go=1.26.3-r0`, `openjdk21-jdk=21.0.12_p8-r0`, `python3=3.14.7-r0`, `rust=1.96.1-r0`, `socat=1.8.1.3-r0` |

To upgrade the toolchain, update the base image digest and
`judge-environment.json`, refresh this table in the same change, then run
`pnpm lint:doc-drift` and `pnpm sandbox:build`. The documentation gate requires
the pinned-version table and manifest to contain the exact same platform,
runtime, and APK pin set.

### Cloudflare + Cloud Armor Setup

Production depends on Cloudflare being the **only** ingress path so `getClientIp(event)` can trust `CF-Connecting-IP`. See [SECURITY.md — Client IP Trust Model](SECURITY.md#client-ip-trust-model-cloudflare-only) for the rationale.

**One-time setup:**

1. **Cloudflare DNS** — set `nojv.example.com` as a proxied (orange-cloud) A/AAAA record pointing at the web origin's public address (the GKE Ingress / external LB IP fronting the `nojv-web` Service). CF terminates TLS at the edge and sets `CF-Connecting-IP` on every inbound request.

2. **Restrict the origin to Cloudflare** — the web origin (GKE Ingress / LB) must reject any request that did not arrive through Cloudflare, so the default origin address is not directly reachable. On a GKE Ingress fronted by a GCLB, attach a Cloud Armor edge policy (step 3) to the backend service. Without a GCLB, restrict the origin at the load balancer / firewall to Cloudflare's CIDR ranges instead.

   After this is in place, hitting the origin IP directly (bypassing Cloudflare) must return 403. All valid traffic must come through Cloudflare.

3. **Cloud Armor edge policy** — allowlist Cloudflare's official CIDR ranges. Source lists live at <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6>; they change rarely but watch for updates.

   ```bash
   # Create the policy
   gcloud compute security-policies create cf-only-policy \
     --description="Allow only Cloudflare edge IPs"

   # Default deny for anything not matched below
   gcloud compute security-policies rules update 2147483647 \
     --security-policy=cf-only-policy \
     --action=deny-403

   # Allow Cloudflare IPv4 ranges (paste the full list as a comma-separated string)
   gcloud compute security-policies rules create 1000 \
     --security-policy=cf-only-policy \
     --src-ip-ranges="173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,..." \
     --action=allow

   # Same for IPv6 at a separate priority
   gcloud compute security-policies rules create 1100 \
     --security-policy=cf-only-policy \
     --src-ip-ranges="2400:cb00::/32,2606:4700::/32,..." \
     --action=allow

   # deploy.sh verifies this policy and the chart's BackendConfig attaches it.
   ```

4. **Verify the trust boundary holds:**

   ```bash
   # (a) Direct to the web origin (GKE Ingress / LB IP) with a non-CF client IP — should 403 (Cloud Armor / firewall)
   curl -I "https://<origin-ip>"

   # (b) Through Cloudflare — should 200
   curl -I "https://nojv.example.com"

   # (c) Through Cloudflare but sending a spoofed CF-Connecting-IP — CF rewrites it, app sees real client
   curl -I -H "CF-Connecting-IP: 1.2.3.4" "https://nojv.example.com"
   ```

   If (a) returns 200 the trust model is broken — stop and fix before relying on IP-based proctoring.

**Ongoing maintenance:** Cloudflare's CIDR list updates occasionally. Update
`infra/gcp/cloudflare-origin-cidrs.txt` from the two official endpoints and the
Cloud Armor allow rules in the same reviewed change. `deploy.sh` refuses to
continue while they differ.

## Microservice Deployment

The worker supports three deployment modes via `WORKER_MODE`. The chart
(`infra/charts/nojv/templates/worker-judge.deployment.yaml` +
`worker-platform.deployment.yaml`) ships the split as two separate Deployments
off the same image — `nojv-worker` (`WORKER_MODE=judge`) and
`nojv-worker-platform` (`WORKER_MODE=platform`) — each with its own
PodDisruptionBudget (`pdb.enabled`), so the judge and platform task queues scale
and fail independently. Replica counts come from `worker.judge.replicas` /
`worker.platform.replicas`. `WORKER_MODE=all` is the default for local dev
(`pnpm dev`), where a single process runs both task queues.

### Mode: all (Development)

Single process runs both task queues. Suitable for local development and small deployments.

```yaml
environment:
  WORKER_MODE: all
```

### Mode: judge (Sandbox Workers)

Only runs judge-queue activities (sandbox execution). Scale based on submission volume.

```yaml
environment:
  WORKER_MODE: judge
  EXECUTION_BACKEND: kubernetes
```

Requires access to Docker daemon or Kubernetes API for sandbox execution.

### Mode: platform (Lifecycle Workers)

Only runs platform-queue activities (contest/assessment lifecycle, plagiarism, notifications). Lightweight — no sandbox access needed.

```yaml
environment:
  WORKER_MODE: platform
```

### Scaling Strategy

```
Submission load ──► Capped by nojv-sandbox ResourceQuota (10 pods, 10 CPU on GKE).
                    Two static workers × concurrency 5 can dispatch every
                    sandbox slot; throughput is gated by the sandbox quota
                    and autoscaling node pools, not by worker fan-out.
Contest count   ──► Platform workers handle lifecycle (low overhead).
                    Typically 1-2 platform workers suffice.
```

To raise the sandbox throughput ceiling, bump `sandbox.resourceQuota.*` in your
values overlay (then `helm upgrade`) and the GKE Spot pool total max, not the
worker replica count. Keep the on-demand pool total max at 1 to preserve the
cost ceiling.

> The GKE overlay has quota `10` pods / `10` CPU, two judge workers at
> concurrency `5`, one on-demand gVisor node, and up to four gVisor Spot nodes.
> The single-machine
> overlay has one judge worker, quota `4` pods / `4` CPU / `12Gi`, and no node
> autoscaler; see [Single-machine capacity ceiling](#single-machine-capacity-ceiling-bounded-autoscaling).

## Database Migrations

```bash
# Development: push schema directly
pnpm db:push

# Production: create and apply migrations
pnpm db:migrate

# Validate schema
pnpm db:validate
```

In production, migrations run as the chart's **pre-install/pre-upgrade Helm
hook** (`infra/charts/nojv/templates/migrator.job.yaml`). Installs apply the full
history. Upgrades stage expand migrations first; for the versioned-storage
contract the hook then disables the web HPA target, drains web plus both Temporal
workers, performs and verifies the S3 backfill, runs a database preflight, and
only then exposes the atomic contract migration. A failure before backfill
restores the prior workloads. Once backfill begins, any failure stays in
maintenance because restoring legacy writers could invalidate the immutable
pointers. The chart keeps all three new Deployments in maintenance through
Helm's apply/wait phase; the post-upgrade hook explicitly starts and verifies
the new workloads before restoring the web HPA target.

## Backup Automation

**Default (in-cluster Postgres):** the chart provisions Postgres as a
CloudNativePG `Cluster` and renders a `ScheduledBackup` (barman-cloud backup to
object storage + continuous WAL archiving for PITR) when
`postgres.cnpg.backup.enabled=true`. This is the production backup posture for
both single-machine and GKE-with-CNPG.

**Managed Cloud SQL alternative (GKE only):** two scripts under
`infra/gcp/scripts/` cover the Cloud SQL path:

| Script                      | Purpose                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup-backups.sh`          | One-shot, idempotent. Enables Cloud SQL automated daily backups (30-day retention, in-region) + PITR (14-day WAL) and creates a versioned GCS bucket for cold exports. Run once per environment after provisioning the instance. |
| `export-postgres-to-gcs.sh` | Daily cold export via `gcloud sql export`. Designed to be triggered by Cloud Scheduler.                                                                                                                                          |

See [Backup & Restore Runbook](../runbooks/backup-restore.md) for the CNPG
restore drill, the Cloud SQL PITR procedure, and the local-dev dump path.

## CI Pipeline

Workflow: `.github/workflows/ci.yml`

```bash
pnpm ci:verify
```

Steps (from `package.json`):

1. `pnpm format` — Prettier formatting check
2. `pnpm lint:application-queries` — Guards that no `prisma.*` call leaks outside `packages/db` / `packages/application`
3. `pnpm db:generate` — Regenerate Prisma client
4. `turbo run build typecheck lint` — Build, typecheck, and lint all packages
5. `pnpm test:unit` — Run Vitest unit tests (separate step, not inside the turbo run)

Additional checks (in `.github/workflows/ci.yml`):

- `pnpm --filter @nojv/storage build` — build the storage package so the seed validator can import it
- `pnpm db:seed:validate` — dry-run validation of problem seed definitions
- `pnpm test:integration` — Vitest integration tests
- `security-audit` job: `pnpm audit --audit-level high` — hard gate, any high/critical advisory fails the build

CodeQL SAST runs in a separate workflow (`.github/workflows/codeql.yml`).

## Deploying a New Release

A release is one image tag promoted through the chart. The flow is the same for
single-machine and GKE — only the values overlay differs:

1. Build + push images for the target commit and note the tag
   ([Building images](#building-images-cloud-build)).
2. Apply it through the release workflow, which carries the tag and all four
   registry-verified digests as one atomic chart revision.

   The migrator Helm hook runs Prisma migrations to completion **before** the
   new `web`/`worker` Pods roll out, so the database is migrated first and the
   rollout is gated on it.

3. Verify: `kubectl rollout status deploy/nojv-web -n nojv` and
   `deploy/nojv-worker -n nojv`, then check web `/api/livez` and `/api/readyz`,
   check worker `/readyz`, and monitor logs for at least 15 minutes.

Secrets are **not** templated by the chart — rotate them in the runtime secret
out-of-band and restart the affected Deployment to pick them up.

## Rollback Procedure (Helm)

Database migrations are forward-only. The chart installs a persistent admission
fence before migration; it rejects any web or worker Deployment whose pod
template does not declare the current `versioned-storage-v1` schema contract.
This intentionally blocks rollback to a pre-contract image even though Helm
still lists that revision. The migrator does not run during `helm rollback`.

1. Inspect the target revision's rendered web and worker pod-template labels.
2. If it lacks `nojv.tw/schema-contract: versioned-storage-v1`, do not delete or
   bypass the fence. Build and deploy a forward fix from a compatible revision.
3. For a revision carrying the same contract, run
   `helm rollback nojv <revision> -n nojv --wait --timeout 125m`.
4. Confirm all three app Deployments are healthy, validate key flows, and monitor
   logs for at least 15 minutes.

If database recovery is required, restore a verified backup into an isolated
environment, validate a compatible forward release there, and promote that
release. Do not apply ad-hoc down migrations to production.

### Pre-Rollback Checklist

1. Confirm issue is deployment-related, not upstream infrastructure instability
2. Check web and worker health endpoints
3. Check Temporal workflows for stuck executions
4. Verify the target web and worker manifests carry the active schema contract
5. After rollback, monitor logs, queue drain behavior, and health checks

## Related Docs

- [Architecture Overview](../architecture/ARCHITECTURE.md)
- [Getting Started Runbook](../runbooks/getting-started.md)
