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

| Variable          | Default    | Purpose                                                                                                                                                                                                                                                              |
| ----------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BODY_SIZE_LIMIT` | `67108864` | SvelteKit adapter-node POST body cap, in bytes. Baked into `web.Dockerfile` at 64 MiB so the 60 MB cap on bundle/workspace/checker/interactor upload routes is the effective ceiling. The adapter's built-in default is 512 KiB and would reject every asset upload. |

### OAuth (Optional)

| Variable               | Purpose                    |
| ---------------------- | -------------------------- |
| `GITHUB_CLIENT_ID`     | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app secret    |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID     |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

### Email

Optional to boot. `@nojv/mailer` stays a **no-op** until both `SMTP_HOST` and
`SMTP_USER` are set — email-sending flows (school-email verification,
passwordless/2FA enrollment, API-token step-up OTP, notifications) silently skip
delivery rather than throwing. Set these whenever those features are in use.
Consumed by both the web app and the platform worker.

| Variable       | Purpose                                                             |
| -------------- | ------------------------------------------------------------------- |
| `SMTP_HOST`    | SMTP host (empty → mailer no-op)                                    |
| `SMTP_PORT`    | SMTP port; `465` → implicit TLS, otherwise STARTTLS (default `465`) |
| `SMTP_USER`    | SMTP username (empty → mailer no-op)                                |
| `SMTP_PASS`    | SMTP password / provider app password (not the login password)      |
| `SMTP_FROM`    | Sender header; defaults to `NOJV <SMTP_USER>` when empty            |
| `APP_BASE_URL` | Base URL for email links (default `https://nojv.tw`)                |

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

| Variable                               | Required / Default                   | Purpose                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXECUTION_BACKEND`                    | **required** (`docker`/`kubernetes`) | Sandbox executor backend                                                                                                                                                          |
| `SANDBOX_IMAGE`                        | **required**                         | Sandbox container image                                                                                                                                                           |
| `PORT`                                 | **required**                         | Worker health server port (`/healthz`, `/readyz`)                                                                                                                                 |
| `WORKER_CONCURRENCY`                   | **required**                         | Activity concurrency per task queue                                                                                                                                               |
| `WORKER_MODE`                          | `all`                                | Task queues: `all`, `judge`, `platform`                                                                                                                                           |
| `SUBMISSION_PENDING_TIMEOUT_MINUTES`   | `10` (range 10–1440)                 | Platform sweeper cutoff: pending/running submissions older than this are terminated and marked `system_error`. Read directly from env; only the `platform` worker runs the sweep. |
| `SANDBOX_CPU_LIMIT`                    | **required** (Docker backend)        | CPU limit per sandbox                                                                                                                                                             |
| `SANDBOX_MEMORY_MB`                    | **required** (Docker backend)        | Memory limit per sandbox (MB)                                                                                                                                                     |
| `SANDBOX_PIDS_LIMIT`                   | **required** (Docker backend)        | PID limit per sandbox                                                                                                                                                             |
| `K8S_NAMESPACE`                        | **required** (Kubernetes backend)    | Namespace for sandbox pods                                                                                                                                                        |
| `K8S_CPU_REQUEST`                      | **required** (Kubernetes backend)    | Sandbox pod CPU request                                                                                                                                                           |
| `K8S_CPU_LIMIT`                        | **required** (Kubernetes backend)    | Sandbox pod CPU limit                                                                                                                                                             |
| `K8S_MEMORY_REQUEST`                   | **required** (Kubernetes backend)    | Sandbox pod memory request                                                                                                                                                        |
| `K8S_MEMORY_LIMIT`                     | **required** (Kubernetes backend)    | Sandbox pod memory limit                                                                                                                                                          |
| `NOJV_ALLOW_UNENFORCED_NETWORK_POLICY` | `false` (Kubernetes backend)         | Dev opt-out for the startup NetworkPolicy-enforcement self-check. Truthy → warn and proceed on a non-enforcing CNI (OrbStack/local k3s). **Never set in production.**             |

> The `SANDBOX_*` resource limits are read only by the Docker backend; the
> `K8S_*` limits only by the Kubernetes backend. The schema enforces this split,
> so each backend requires exactly the keys it actually uses.

> Advanced-mode (`special_env`) judging runs on **both** backends:
> **registry-source** run/grade images execute as K8s Jobs (incl. the `none` /
> `allowlist` / `service` network modes — see [Judge Pipeline](../architecture/JUDGE_PIPELINE.md#advanced-mode-pipeline)
> and `tests/integration/k8s/judge-k8s.test.ts`). Only **tarball-source**
> advanced requires the Docker backend, because the cluster cannot `docker load`
> a TA-supplied tarball (`K8sExecutor.executeAdvanced` returns a System Error for
> tarball-source run/grade — push the image to a registry the cluster can pull
> instead). When `EXECUTION_BACKEND=kubernetes`, also set the same value on the
> **web** service (`EXECUTION_BACKEND` is part of the web env schema, default
> `docker`) so it hides tarball-source advanced-problem creation/conversion. The
> chart sets it to `kubernetes` on both web and the workers (`web.executionBackend`).

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

| Variable             | Purpose                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `K8S_NAMESPACE`      | Kubernetes namespace for sandbox jobs                                                                                                                                                                                      |
| `K8S_CPU_REQUEST`    | CPU request per sandbox pod                                                                                                                                                                                                |
| `K8S_CPU_LIMIT`      | CPU limit per sandbox pod                                                                                                                                                                                                  |
| `K8S_MEMORY_REQUEST` | Memory request per sandbox pod                                                                                                                                                                                             |
| `K8S_MEMORY_LIMIT`   | Memory limit per sandbox pod                                                                                                                                                                                               |
| `EGRESS_PROXY_IMAGE` | Egress-proxy image for advanced-mode `allowlist`/`service` network modes. Built by `cloudbuild.yaml` as `<repo>/egress-proxy:<tag>`. **Required for the Kubernetes backend** (worker throws in allowlist mode without it). |

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
per-submission Pod autoscaling without GKE — follow the
[Single-Machine k3s Runbook](../runbooks/k8s-single-machine.md). It installs k3s
with a NetworkPolicy-enforcing CNI (Calico, **required** — k3s's default flannel
does not enforce policy and the worker fails closed without it), then installs
the **same Helm chart** (`infra/charts/nojv`) used for GKE with the
single-machine values overlay, and covers all three autoscaling layers
(per-submission judge Pods, worker replicas, node join). It is the entry point
on the spectrum **single-node k3s → multi-node k3s → GKE** ([GKE Rollout](#gke-rollout)).

**CD pipeline (`.github/workflows/deploy.yml`).** On merge to `main`, after CI
passes, a GitHub-hosted job builds and pushes the runtime images to GHCR
(`ghcr.io/nojv-tw/nojv-{web,worker,sandbox,egress-proxy,migrator}:<sha>`), then
the self-hosted runner on the k3s box runs `helm upgrade` — k3s pulls the images
from GHCR (no local `docker build`/`ctr import`). One-time: set those five GHCR
packages to **Public** so k3s can pull without an imagePullSecret.

### Single-machine capacity ceiling (static — autoscaling is wired but inert)

The single-machine deployment is **fully static**. The autoscaling layers that
the [GKE picture](#scaling-strategy) below relies on are configured in the chart
but **do not take effect on one box** — do not size a rollout as if bursts will
be absorbed automatically:

| Tier     | Single-machine (`values-single-machine.yaml`) | Autoscaling on one box                                                               |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| web      | 1 replica (`web.hpa.enabled: false`)          | HPA is off in the overlay — no scale-out on request load.                            |
| judge    | 1 worker, `WORKER_CONCURRENCY=4`              | KEDA `ScaledObject` is opt-in and its shipped query is a placeholder — inert.        |
| platform | 1 worker                                      | Static.                                                                              |
| sandbox  | quota `4` CPU / `10` pods, one node           | No cluster-autoscaler exists (no nodes to add), so the node-scaling layer is absent. |

**Real concurrent-submission ceiling.** On the Kubernetes backend a submission's
judge Job currently requests CPU **per testcase container**, so an N-testcase
problem asks for roughly `N × K8S_CPU_REQUEST` against the `4`-CPU sandbox quota.
Today that means only a couple of small problems judge concurrently, and a
problem above ~8 testcases cannot be admitted at all (this is the P0-3 defect —
see the [remediation plan](../plans/active/2026-07-07-system-health-check-remediation.md)).
**After the P0-3 fix** decouples pod request from testcase count, the ceiling
becomes `sandbox.resourceQuota.requestsCpu ÷ per-pod request` concurrent
submissions — classroom scale, not exam-hall scale. Size `sandbox.resourceQuota.*`
to your class, and treat a burst as **queue-and-drain** (submissions back up in
the Temporal judge queue and clear as capacity frees), not as autoscale. To go
beyond one box, add nodes (multi-node k3s) or move to GKE, where the HPA/KEDA/
cluster-autoscaler layers below actually engage.

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

| Component | Where it runs                                        | Scaling                                               |
| --------- | ---------------------------------------------------- | ----------------------------------------------------- |
| web       | Chart Deployment (+ HPA on GKE)                      | HPA min 2 / max 15 (`web.hpa.*`)                      |
| worker    | Chart Deployments (judge + platform)                 | Static replicas + opt-in KEDA (`worker.judge.keda.*`) |
| migrator  | Chart pre-install/pre-upgrade Helm hook              | One-shot per release                                  |
| seed      | Chart post-install Helm hook (opt-in `seed.enabled`) | One-shot per release                                  |
| sandbox   | K8s Jobs (`nojv-sandbox`)                            | Per-submission, quota + node cluster-autoscaler       |
| postgres  | In-cluster CloudNativePG _or_ Cloud SQL              | Vertical (manual) / CNPG instances                    |
| redis     | In-cluster _or_ Memorystore                          | Vertical (manual)                                     |
| temporal  | Official Temporal Helm chart (prereq)                | Per HA-PRODUCTION.md                                  |
| images    | Artifact Registry                                    | —                                                     |
| secrets   | Chart runtime secret / Secret Manager                | —                                                     |

> **Autoscaling layers.** A submission burst is absorbed by the **sandbox**
> layer — one K8s Job per submission, capped by `sandbox.resourceQuota.pods`,
> with the `pool-sandbox` cluster-autoscaler growing nodes `0 → SANDBOX_MAX_NODES`
> to run them (raise both for exam scale). Concurrent-user spikes (exam start)
> are absorbed by the **web** HPA. The **judge worker** dispatcher stays at two
> static replicas because orchestration is I/O-bound and two workers already
> saturate the quota — CPU-HPA is the wrong signal. When the quota is raised far
> enough that dispatch lags, enable the opt-in KEDA `ScaledObject`
> (`worker.judge.keda.enabled`) — a Prometheus trigger on Temporal task-queue
> backlog / schedule-to-start latency (requires KEDA + Prometheus scraping
> Temporal).

## Helm Deployment

NOJV deploys to single-machine k8s and GKE through the **same** umbrella chart
at `infra/charts/nojv` — only the values overlay differs. The chart renders web,
the two Temporal workers, worker RBAC + PDBs, the namespaces, the sandbox
namespace policy (deny-all NetworkPolicy + ResourceQuota + LimitRange), the
worker-egress NetworkPolicy, the migrator Helm hook, and (optionally) in-cluster
Postgres (CloudNativePG), Redis, and MinIO. The full knob reference is in
[`infra/charts/nojv/README.md`](../../infra/charts/nojv/README.md).

```bash
# Single-machine (k3s / kind, one node) — see the k3s runbook for the CNI setup
helm upgrade --install nojv infra/charts/nojv \
  -f infra/charts/nojv/values-single-machine.yaml -n nojv --create-namespace

# GKE (HA on a Dataplane-V2 cluster)
helm upgrade --install nojv infra/charts/nojv \
  -f infra/charts/nojv/values-gke.yaml -n nojv --create-namespace
```

### Prerequisites (one-time, not installed by the chart)

1. **Runtime secret** — an existing `Secret` (default `nojv-runtime-secrets`) in
   the app namespace holding `DATABASE_URL`, `REDIS_URL`, the `S3_*` keys, the
   web auth secrets (`BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`),
   OAuth, optional Grafana OTLP keys, and — when `seed.enabled` — the
   `SEED_ADMIN_USERNAME`/`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` the seed hook
   provisions the super admin from (password ≥ 12 chars, single-use). Copy and
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
(`web`, `worker`, `sandbox`, `migrator`, `egress-proxy`) to Artifact Registry
and prints the canonical image refs. It no longer deploys anything — the chart
does that.

```bash
export PROJECT_ID=...
# Optional email (school verification / 2FA / OTP) and OAuth go in the runtime secret, not here.
bash infra/gcp/cloud-build/deploy.sh
```

The image tag defaults to the short git SHA (with a `-dirty-<timestamp>` suffix
when the worktree is dirty) — override with `IMAGE_TAG=...` for release tags.
Pass the printed tag to the chart via `--set image.tag=<tag>` (or pin it in your
values overlay). To run only the build step manually:

```bash
gcloud builds submit --config infra/gcp/cloud-build/cloudbuild.yaml \
  --substitutions _REGION=asia-east1,_REPOSITORY=nojv,_IMAGE_TAG=release-20260312
```

### GKE Rollout

1. Build + push images (above); note the printed image tag.
2. Create the runtime secret (prerequisite 1) and ensure the CloudNativePG
   operator + Temporal Server prerequisites are installed (2 and 3).
3. Install the chart:

   ```bash
   helm upgrade --install nojv infra/charts/nojv \
     -f infra/charts/nojv/values-gke.yaml \
     --set image.tag=<tag-from-deploy.sh> \
     -n nojv --create-namespace
   ```

   This renders the namespaces (`nojv`, `nojv-sandbox`), the two worker
   Deployments split by `WORKER_MODE` (`nojv-worker` judge / `nojv-worker-platform`
   platform) with worker RBAC + PDBs, web (Deployment + Service + optional
   Ingress), the worker-egress NetworkPolicy (`networkPolicy.enabled`), the
   sandbox namespace policy (deny-all NetworkPolicy + ResourceQuota + LimitRange),
   and the migrator as a pre-install/pre-upgrade Helm hook that runs Prisma
   migrations before the new Pods roll out. On GKE with `postgres.mode=cloudsql`,
   each worker Pod runs the Cloud SQL Auth Proxy sidecar
   (`cloudsqlProxy.enabled=true`) — see
   [`infra/gcp/gke/README.md`](../../infra/gcp/gke/README.md).

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
--disable-network-policy` and install Calico or Cilium.

   The worker now **fails closed**: at startup, when `EXECUTION_BACKEND=kubernetes`,
   it empirically probes a deny-all-covered Pod for outbound reachability and
   **refuses to start the judge worker** if enforcement is absent (see
   `apps/worker/src/services/k8s-netpol-probe.ts`). To override this gate in a
   non-enforcing dev cluster (e.g. OrbStack / local k3s), set
   `NOJV_ALLOW_UNENFORCED_NETWORK_POLICY=1` on the worker — it then logs a loud
   warning and proceeds. **Never set this in production.**

   You can also verify enforcement manually (the automated self-check does the
   same check at startup). Launch a throwaway pod carrying the sandbox's
   `app=nojv-sandbox` label so the `sandbox-deny-egress` policy applies, and
   confirm it cannot reach the internet:

   ```bash
   kubectl run egress-check -n nojv-sandbox --rm -i --restart=Never \
     --image=curlimages/curl --labels=app=nojv-sandbox \
     --overrides='{"spec":{"tolerations":[{"key":"nojv-role","value":"sandbox","effect":"NoSchedule"}],"nodeSelector":{"nojv-role":"sandbox"}}}' \
     --command -- curl -sS --max-time 5 https://cloudflare.com
   ```

   **Expected:** the `curl` times out and the pod exits non-zero — egress is
   blocked. If it returns a response, NetworkPolicy enforcement is OFF: **halt
   the rollout** and enable Dataplane V2 on the cluster before judging any
   submissions, otherwise sandboxed code can exfiltrate over the network. The
   same isolation is asserted in CI by `tests/integration/k8s/judge-k8s.test.ts`
   and `tests/unit/infra/network-policy-parity.test.ts`, but those run against
   dev infra — the startup self-check and this step confirm the live cluster's
   CNI honors it.

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

   # Attach to the GCLB backend service fronting the web Ingress
   gcloud compute backend-services update nojv-web-backend \
     --security-policy=cf-only-policy \
     --global
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

**Ongoing maintenance:** Cloudflare's CIDR list updates occasionally. A stale Cloud Armor rule either locks out real users (range added) or widens the allowlist to stale IPs (range removed). Either script the refresh via Terraform + the Cloudflare API, or put a calendar reminder to check the published lists quarterly.

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
Submission load ──► Capped by nojv-sandbox ResourceQuota (50 pods, 25 CPU).
                    Worker count is static (2 replicas) — orchestrator work
                    is I/O bound and cheap; throughput is gated by the
                    sandbox quota, not by worker fan-out.
Contest count   ──► Platform workers handle lifecycle (low overhead).
                    Typically 1-2 platform workers suffice.
```

To raise the sandbox throughput ceiling, bump `sandbox.resourceQuota.*` in your
values overlay (then `helm upgrade`) and the `pool-sandbox` autoscaler
max-nodes, not the worker replica count.

> The numbers above (quota `50` pods / `25` CPU, judge `2` replicas, a
> node-autoscaled sandbox pool) are the **GKE** overlay. The **single-machine**
> overlay is static and smaller — 1 judge worker, quota `10` pods / `4` CPU, one
> node, no cluster-autoscaler — with a correspondingly lower ceiling; see
> [Single-machine capacity ceiling](#single-machine-capacity-ceiling-static--autoscaling-is-wired-but-inert).

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
hook** (`infra/charts/nojv/templates/migrator.job.yaml`) — every `helm upgrade`
runs the migrator Job to completion before the new `web`/`worker` Pods roll out.

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
2. Apply it with `helm upgrade`:

   ```bash
   helm upgrade --install nojv infra/charts/nojv \
     -f infra/charts/nojv/values-gke.yaml \
     --set image.tag=<tag> -n nojv
   ```

   The migrator Helm hook runs Prisma migrations to completion **before** the
   new `web`/`worker` Pods roll out, so the database is migrated first and the
   rollout is gated on it.

3. Verify: `kubectl rollout status deploy/nojv-web -n nojv` and
   `deploy/nojv-worker -n nojv`, then check the web `/healthz` and worker
   `/readyz` endpoints and monitor logs for at least 15 minutes.

Secrets are **not** templated by the chart — rotate them in the runtime secret
out-of-band and restart the affected Deployment to pick them up.

## Rollback Procedure (Helm)

Rollback is release-based. Helm tracks every applied revision:

1. `helm history nojv -n nojv` — find the last known-good revision.
2. `helm rollback nojv <revision> -n nojv` — re-applies that revision's
   manifests + image tag. (The migrator hook re-runs; Prisma migrations are
   forward-only, so a rollback to a schema-incompatible image needs the
   Database Rollback steps below first.)
3. Confirm `kubectl get pods -n nojv` shows healthy `nojv-web` /
   `nojv-worker` / `nojv-worker-platform`.
4. Validate key flows and monitor logs for at least 15 minutes.

### Database Rollback

Prisma does not auto-generate down migrations. If a migration causes issues:

1. Identify the breaking migration in `packages/db/prisma/migrations/`
2. Write manual rollback SQL and apply it on the production database
3. Mark migration state correctly in `_prisma_migrations` when needed
4. Deploy the previous application commit compatible with the restored schema

### Pre-Rollback Checklist

1. Confirm issue is deployment-related, not upstream infrastructure instability
2. Check web and worker health endpoints
3. Check Temporal workflows for stuck executions
4. Verify web and worker versions are schema-compatible before rollback
5. After rollback, monitor logs, queue drain behavior, and health checks

## Related Docs

- [Architecture Overview](../architecture/ARCHITECTURE.md)
- [Getting Started Runbook](../runbooks/getting-started.md)
