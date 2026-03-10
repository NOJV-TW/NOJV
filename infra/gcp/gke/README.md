# GKE Worker Notes

Use this topology when submissions should execute through Kubernetes-native sandbox jobs.

## Recommended Split

- Cloud Run: `web`
- GKE: `worker`
- GKE Jobs in `nojv-sandbox`: sandbox-runner pods created by the worker
- Cloud SQL: PostgreSQL
- Memorystore: Redis

## Why This Exists

The worker is now responsible for orchestration only. In Kubernetes mode it creates a ConfigMap plus a one-shot Job per submission, then reads the runner logs back into the platform.

## Files

- `kustomization.yaml`: worker bundle entrypoint
- `runtime-secrets.example.yaml`: placeholder runtime secret manifest
- `worker.deployment.yaml`: BullMQ worker deployment
- `worker.scaledobject.yaml`: KEDA scaling rules for active queues

Sandbox namespace isolation resources live under `infra/k8s/sandbox/`.

## Apply Flow

1. Install KEDA in the cluster.
2. Replace `PROJECT_ID` and image tags in `worker.deployment.yaml`.
3. Create a real `nojv-runtime-secrets` secret with Cloud SQL and Memorystore connection strings.
4. Apply the worker manifests:
   `kubectl apply -k infra/gcp/gke`
5. Apply the sandbox namespace manifests:
   `kubectl apply -f infra/k8s/sandbox`

This keeps the public control plane separate from the execution namespace while avoiding a long-lived sandbox service.
