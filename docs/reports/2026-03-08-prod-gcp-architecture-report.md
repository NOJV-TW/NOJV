# 2026-03-08 Prod And GCP Architecture Report

## Summary

NOJV now has a production-shaped delivery path instead of only a local POC shape.

The important change is not only more code. It is the runtime split:

- `web` and `workspace` stay on the HTTP control plane
- `worker` is now asynchronous and probeable
- `sandbox` is a dedicated remote execution boundary
- Prisma migrations are part of the deployment path through a `migrator` job
- a GKE scale-out topology exists for the queue and execution plane

## Verified Runtime Path

The following path has been exercised locally against isolated infrastructure:

`web -> Redis -> worker -> remote sandbox -> Postgres`

Verified behaviors:

- submission dispatch returns `202` plus a poll URL
- submission polling reaches a persisted accepted verdict
- workspace dispatch returns `202` plus a poll URL
- remote sandbox execution runs `make run` and returns stdout
- exam-mode shell policy blocks disallowed commands before execution

## Baseline GCP Topology

The default production target is:

- Cloud Run service: `web`
- Cloud Run service: `workspace`
- Cloud Run service: `worker`
- Cloud Run service: `sandbox`
- Cloud Run Job: `migrator`
- Cloud SQL: PostgreSQL
- Memorystore: Redis
- Artifact Registry: container images
- Secret Manager: runtime secrets

This is the smallest topology that still preserves the core safety boundary: untrusted command execution does not happen inside the public control plane.

## Why The Worker Changed

The earlier worker process was not deployable on Cloud Run because it had no HTTP endpoint. That is now corrected through:

- `PORT` support
- `/healthz`
- `/readyz`
- Cloud Run deployment flags for `min-instances=1`
- CPU kept allocated on the worker service

This makes the baseline worker a valid long-lived service instead of only a local process.

## Why The Migrator Exists

Without a schema deployment step, first rollout would fail as soon as `web` or `worker` touched Prisma tables. The deploy path now builds and runs a separate `migrator` image that executes `prisma migrate deploy` before the serving services are rolled out.

That removes the previous manual bootstrap dependency on `db push`.

## Scale-Out Path

Cloud Run is still a good fit for `web` and `workspace`, but it is not the best long-term home for a hot BullMQ execution plane. For sustained traffic, the repo now contains a GKE path:

- `worker` on GKE with KEDA on BullMQ Redis wait lists
- `sandbox` on GKE with HPA on CPU
- `sandbox` exposed only by an internal ClusterIP service
- `sandbox` ingress restricted to `worker` pods through NetworkPolicy

This keeps public HTTP traffic on Cloud Run while moving queue and execution scaling to Kubernetes.

## Current Deployment Blocker

The repository is now deployment-ready at the asset level, but this workstation still cannot perform a real rollout because:

- `gcloud` is not installed
- there is no active authenticated GCP account in this shell
- no project-specific runtime values are exported yet

So the remaining blocker is credentials and operator context, not missing repo code.
