# GCP Deployment Notes

## Baseline Production Split

- Cloud Run: `web`
- Cloud Run: `workspace`
- Cloud Run: `worker` with `min-instances=1` and HTTP health probes
- Cloud Run: `sandbox`
- Cloud Run Job: `migrator`
- Cloud SQL: PostgreSQL
- Memorystore: Redis
- Artifact Registry: image storage
- Secret Manager: `DATABASE_URL`, `REDIS_URL`, `SANDBOX_SHARED_TOKEN`

## Why There Is A Separate Sandbox Service

The local worker uses Docker-backed sandbox execution. That path is appropriate for local development, but not for Cloud Run because Cloud Run does not provide Docker-in-Docker semantics for the application container. The production target therefore uses:

- `worker` for queue orchestration and persistence
- `sandbox` for actual command execution inside a dedicated Cloud Run service

The worker switches to this path with:

- `EXECUTION_BACKEND=remote_http`
- `SANDBOX_BASE_URL=https://...`
- `SANDBOX_SHARED_TOKEN=<secret>`

## Files

- `cloudbuild.yaml`: builds and pushes `web`, `workspace`, `worker`, `sandbox`, and `migrator`
- `web.cloudrun.yaml`: reference manifest for the web control plane
- `workspace.cloudrun.yaml`: reference manifest for the workspace client surface
- `worker.cloudrun.yaml`: reference manifest for the async queue worker
- `sandbox.cloudrun.yaml`: reference manifest for the execution service
- `migrator.job.yaml`: reference Cloud Run Job for Prisma migrations
- `deploy.sh`: end-to-end deployment script using `gcloud`
- `gke/`: GKE scale-out manifests for worker and sandbox

## Required Environment Variables For `deploy.sh`

- `PROJECT_ID`
- `REGION` optional, default `asia-east1`
- `REPOSITORY` optional, default `nojv`
- `SERVICE_PREFIX` optional, default `nojv`
- `DATABASE_URL`
- `REDIS_URL`
- `SANDBOX_SHARED_TOKEN`
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
   - deploys `sandbox`, `workspace`, `web`, and `worker`

## GKE Scale-Out Path

When Cloud Run is no longer sufficient for the queue and execution plane, use the manifests under `infra/gcp/gke`:

- `worker.deployment.yaml`: long-lived BullMQ worker pods
- `worker.scaledobject.yaml`: KEDA scaling on BullMQ Redis wait lists
- `sandbox.deployment.yaml`: internal execution pods
- `sandbox.hpa.yaml`: CPU-based autoscaling for sandbox pods
- `sandbox.networkpolicy.yaml`: limits sandbox ingress to worker pods

This keeps the public control plane on Cloud Run while moving the hot path to GKE.

## Current Blocker On This Workstation

This repo now contains deployable GCP assets, but this workstation still needs a working `gcloud` installation and project authentication. The deployment script exits early until that is fixed.
