# GCP Deployment Notes

## Current Production Shape

- Cloud Run: `web`
- Cloud Run Job: `migrator`
- GKE: `worker`
- GKE Jobs: per-submission sandbox runner pods created by the worker
- Cloud SQL: PostgreSQL
- Memorystore: Redis
- Artifact Registry: image storage
- Secret Manager: `DATABASE_URL`, `REDIS_URL`

## Images

`infra/gcp/cloudbuild.yaml` builds and pushes four images:

- `web`
- `worker`
- `sandbox` from `infra/docker/sandbox-runner.Dockerfile`
- `migrator`

The `sandbox` image is not a long-running service. It is the image the Kubernetes worker launches for each isolated judge job.

## Files

- `cloudbuild.yaml`: builds and pushes runtime images
- `web.cloudrun.yaml`: reference manifest for the web control plane
- `migrator.job.yaml`: reference Cloud Run Job for Prisma migrations
- `deploy.sh`: builds images, deploys `web`, runs `migrator`, and prints the image refs used by GKE
- `gke/`: worker deployment and autoscaling manifests

The sandbox namespace guardrails now live under `infra/k8s/sandbox/`.

## Required Environment Variables For `deploy.sh`

- `PROJECT_ID`
- `DATABASE_URL`
- `REDIS_URL`
- `REGION` optional, default `asia-east1`
- `REPOSITORY` optional, default `nojv`
- `SERVICE_PREFIX` optional, default `nojv`
- `IMAGE_TAG` optional, derived from git state when omitted

## Deployment Flow

1. Install and authenticate `gcloud`.
2. Export the required environment variables.
3. Run `bash infra/gcp/deploy.sh`.
4. The script:
   - enables required GCP APIs
   - ensures the Artifact Registry repository exists
   - creates or updates the required secrets
   - submits Cloud Build with an explicit image tag
   - runs the `migrator` Cloud Run Job
   - deploys `web`
   - prints the `worker` and `sandbox` image references for GKE rollout

## GKE Worker Rollout

1. Patch the image names or tags in `infra/gcp/gke/worker.deployment.yaml`.
2. Apply the worker manifests:
   `kubectl apply -k infra/gcp/gke`
3. Apply the sandbox namespace resources:
   `kubectl apply -f infra/k8s/sandbox`

The worker uses `EXECUTION_BACKEND=kubernetes` and launches one sandbox-runner Job per submission into the `nojv-sandbox` namespace.
