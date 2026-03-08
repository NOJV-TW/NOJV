# 2026-03-08 Prod Topology Design

## Goal

Turn the current NOJV POC into a production-shaped deployment that can:

- serve the public control plane on GCP
- keep queue workers alive outside the request path
- execute untrusted workspace commands in an isolated service boundary
- scale the queue and execution plane independently when traffic spikes

## Chosen Topology

### Baseline GCP path

- Cloud Run: `web`
- Cloud Run: `workspace`
- Cloud Run: `worker`
- Cloud Run: `sandbox`
- Cloud Run Job: `migrator`
- Cloud SQL: PostgreSQL
- Memorystore: Redis
- Secret Manager: runtime secrets
- Artifact Registry: container images

This path is the smallest operational footprint that still keeps the sandbox separated from the control plane.

### High-traffic path

- keep `web` and `workspace` on Cloud Run
- move `worker` to GKE
- move `sandbox` to GKE
- use KEDA to scale `worker` on BullMQ wait-list depth
- use HPA to scale `sandbox` on CPU

This split keeps the public HTTP surfaces elastic while moving the long-lived and bursty execution plane to Kubernetes.

## Why `worker` Needed A Health Server

The earlier worker process only opened BullMQ connections. That works locally, but it is not a valid Cloud Run workload because the container does not expose an HTTP endpoint for liveness and readiness. The corrected baseline adds:

- `PORT` support in worker env
- `/healthz`
- `/readyz`
- `min-instances=1`
- CPU always allocated on Cloud Run

That makes the worker deployable on Cloud Run for the baseline case.

## Why There Is A Separate `migrator`

Deploying `web` and `worker` before the database schema exists is a guaranteed cold-start failure. The deployment flow therefore runs a dedicated `migrator` job first:

1. build a `migrator` image
2. inject `DATABASE_URL`
3. run `prisma migrate deploy`
4. deploy the serving workloads

This makes first deployment and repeat deployment deterministic.

## Scale-Out Principles

- `web` and `workspace` are HTTP-heavy and fit Cloud Run autoscaling well.
- `worker` is queue-heavy and should not depend on request-driven lifecycles at scale.
- `sandbox` should stay isolated from public ingress and only accept calls from the worker plane.
- Redis queue depth is the right first autoscaling signal for BullMQ workers.
- CPU is the right first autoscaling signal for the execution service.

## Deliverables In Repo

- Cloud Run baseline deploy script and manifests under `infra/gcp/`
- GKE scale-out manifests under `infra/gcp/gke/`
- Prisma migration path through `packages/db/prisma/migrations/`
