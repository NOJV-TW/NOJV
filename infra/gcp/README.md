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
- `REGION` (Artifact Registry region)
- `REPOSITORY`
- `RELEASE_NAME`
- `RELEASE_SHA` (the lowercase 40-character commit SHA at `HEAD`)
- `RELEASE_REMOTE` (the Git remote whose release ref is authoritative, usually `origin`)
- `RELEASE_REF` (a fully qualified remote branch ref, for example `refs/heads/main`)
- `CLUSTER_NAME`
- `CLUSTER_LOCATION`
- `DEPLOY_PRINCIPAL` (must exactly match the active `gcloud` account)
- `CLOUD_BUILD_SERVICE_ACCOUNT` (full service-account email)
- `K8S_NAMESPACE`

Runtime credentials are not accepted by this script. Create the chart's runtime
Secret separately from `infra/charts/nojv/secret.example.yaml` before deploy.

## Deployment Flow

1. Install and authenticate `gcloud`.
2. Export the required environment variables.
3. Run `bash infra/gcp/cloud-build/deploy.sh`.
4. The script:
   - requires a clean source tree and proves `RELEASE_SHA = HEAD = RELEASE_REMOTE:RELEASE_REF`
   - archives that verified commit so Cloud Build never uploads mutable working-tree content
   - verifies the active principal, project, Cloud Build identity, GKE resource,
     endpoint, and CA before any cloud or cluster mutation
   - obtains credentials into a temporary isolated kubeconfig and passes its
     verified context explicitly to Helm
   - enables required GCP APIs
   - ensures the Artifact Registry repository exists
   - submits Cloud Build under the required service account with the commit SHA as the image tag and OCI source revision
   - reads each pushed tag's digest back from Artifact Registry
   - deploys the four immutable `tag@sha256` references through Helm with the source SHA in object metadata
5. Verify the Helm release and rollout reported by the script.
   The migrator runs automatically as the chart's pre-install/pre-upgrade Helm
   hook; `web` is deployed by the chart as an in-cluster Deployment.

## GKE Rollout

Two one-time prerequisites before the first install:

- **CloudNativePG operator** (when `postgres.mode=cnpg`) — install cluster-wide so the chart can render the Postgres `Cluster` / `ScheduledBackup`.
- **Temporal Server** — installed once via the official Helm chart (see [`gke/temporal/HA-PRODUCTION.md`](gke/temporal/HA-PRODUCTION.md)); the chart's workers target `temporal-frontend.nojv-temporal.svc.cluster.local:7233`.

Then run `infra/gcp/cloud-build/deploy.sh`; it refuses to deploy until Artifact
Registry returns a valid sha256 digest for every application image.

The chart renders web, both worker Deployments, the sandbox namespace + policy,
and the migrator hook. The worker uses `EXECUTION_BACKEND=kubernetes` and
launches one sandbox-runner Job per submission into the `nojv-sandbox` namespace.

The canonical full procedure (node pools, secrets, Cloud SQL wiring) lives in
[`docs/operations/DEPLOYMENT.md`](../../docs/operations/DEPLOYMENT.md) and
[`infra/charts/nojv/README.md`](../charts/nojv/README.md); GKE-specific notes are
in [`gke/README.md`](gke/README.md).
