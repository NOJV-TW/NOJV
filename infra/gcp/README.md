# GCP Deployment Notes

## Current Production Shape

- **Cloudflare** in front of everything — DNS, TLS, WAF, DDoS, CDN. Sets `CF-Connecting-IP` which the app reads for proctoring.
- GKE: `web` — an in-cluster Deployment (the `nojv` Helm chart) fronted by an Ingress that Cloudflare proxies to. The web tier runs in-cluster, not serverless.
- GKE: `worker` — the two Temporal workers (judge + platform), in-cluster Deployments rendered by the chart.
- GKE Jobs: per-submission sandbox runner pods created by the worker
- Migrator: the chart's pre-install/pre-upgrade Helm-hook Job (runs Prisma migrations on each release).
- Postgres: in-cluster CloudNativePG `Cluster` (chart default), or managed **Cloud SQL** as an optional alternative.
- Redis: in-cluster (chart default), or managed **Memorystore** as an optional alternative.
- Artifact Registry: image storage
- Secret Manager / runtime secret: `DATABASE_URL`, `REDIS_URL`, `S3_*`, auth/OAuth, required SMTP credentials, and `APP_BASE_URL`
- **Cloud Armor security policy** attached to the GCLB/Ingress backend — source IP allowlist restricted to Cloudflare's official CIDR ranges

> Provisioning + verification steps for the Cloudflare / Ingress / Cloud Armor trust boundary live in [`docs/operations/DEPLOYMENT.md` — Cloudflare + Cloud Armor Setup](../../docs/operations/DEPLOYMENT.md#cloudflare--cloud-armor-setup). The rationale (why no XFF fallback) is in [`docs/operations/SECURITY.md` — Client IP Trust Model](../../docs/operations/SECURITY.md#client-ip-trust-model-cloudflare-only).

## Images

`infra/gcp/cloud-build/cloudbuild.yaml` builds and pushes four images:

- `web`
- `worker`
- `sandbox` from `infra/docker/sandbox-runner.Dockerfile`
- `migrator`

The `sandbox` image is not a long-running service. It is the image the Kubernetes worker launches for each isolated judge job.

## Layout

- `cloud-build/`: Cloud Build orchestration
  - `cloudbuild.yaml`: builds and pushes runtime images
  - `deploy.sh`: builds and pushes the images, then prints the image refs the Helm release pins
- `gke/`: GKE-specific deployment notes for the `nojv` Helm chart (node pools, Cloud SQL proxy, Temporal prerequisite)
- `scripts/`: Cloud SQL backup / GCS export helpers (`setup-backups.sh`, `export-postgres-to-gcs.sh`)

The web Deployment, worker Deployments, migrator hook, namespaces, and sandbox
namespace guardrails are all rendered by the `nojv` Helm chart at
`infra/charts/nojv` (sandbox policy is chart template `templates/sandbox-policy.yaml`).

## Required Environment Variables For `deploy.sh`

- `PROJECT_ID`
- `DATABASE_URL`
- `REDIS_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `S3_REGION`
- `REGION` optional, default `asia-east1`
- `REPOSITORY` optional, default `nojv`
- `SERVICE_PREFIX` optional, default `nojv`
- `IMAGE_TAG` optional, derived from git state when omitted

## Deployment Flow

1. Install and authenticate `gcloud`.
2. Export the required environment variables.
3. Run `bash infra/gcp/cloud-build/deploy.sh`.
4. The script:
   - enables required GCP APIs
   - ensures the Artifact Registry repository exists
   - creates or updates the required secrets
   - submits Cloud Build with an explicit image tag
   - prints the image references for the Helm release to pin
5. Deploy (or upgrade) the stack via Helm, pinning the tag the script printed:
   ```bash
   helm upgrade --install nojv infra/charts/nojv \
     -f infra/charts/nojv/values-gke.yaml \
     -n nojv --create-namespace \
     --set image.tag=<TAG-from-deploy.sh>
   ```
   The migrator runs automatically as the chart's pre-install/pre-upgrade Helm
   hook; `web` is deployed by the chart as an in-cluster Deployment.

## GKE Rollout

Two one-time prerequisites before the first install:

- **CloudNativePG operator** (when `postgres.mode=cnpg`) — install cluster-wide so the chart can render the Postgres `Cluster` / `ScheduledBackup`.
- **Temporal Server** — installed once via the official Helm chart (see [`gke/temporal/HA-PRODUCTION.md`](gke/temporal/HA-PRODUCTION.md)); the chart's workers target `temporal-frontend.nojv-temporal.svc.cluster.local:7233`.

Then deploy with Helm, pinning the tag `deploy.sh` printed:

```bash
helm upgrade --install nojv infra/charts/nojv \
  -f infra/charts/nojv/values-gke.yaml \
  -n nojv --create-namespace \
  --set image.tag=<TAG>
```

The chart renders web, both worker Deployments, the sandbox namespace + policy,
and the migrator hook. The worker uses `EXECUTION_BACKEND=kubernetes` and
launches one sandbox-runner Job per submission into the `nojv-sandbox` namespace.

The canonical full procedure (node pools, secrets, Cloud SQL wiring) lives in
[`docs/operations/DEPLOYMENT.md`](../../docs/operations/DEPLOYMENT.md) and
[`infra/charts/nojv/README.md`](../charts/nojv/README.md); GKE-specific notes are
in [`gke/README.md`](gke/README.md).
