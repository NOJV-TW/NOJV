# GKE Scale-Out Notes

Use this topology when queue depth or sustained execution load outgrows the Cloud Run baseline.

## Recommended Split

- Cloud Run: `web`
- Cloud Run: `workspace`
- GKE: `worker`
- GKE: `sandbox`
- Cloud SQL: PostgreSQL
- Memorystore: Redis

## Why This Exists

Cloud Run works as a compact baseline, but BullMQ workers scale best when they are long-lived and not request-driven. The manifests in this folder move the hot path to GKE:

- `worker` scales on BullMQ wait-list depth through KEDA
- `sandbox` stays internal to the cluster and scales on CPU
- `sandbox` ingress is restricted to `worker` pods through NetworkPolicy

## Files

- `kustomization.yaml`: bundle entrypoint
- `runtime-secrets.example.yaml`: placeholder runtime secret manifest
- `worker.deployment.yaml`: BullMQ worker deployment with `/healthz` and `/readyz`
- `worker.scaledobject.yaml`: KEDA autoscaling rules for the three queue wait lists
- `sandbox.deployment.yaml`: remote execution deployment
- `sandbox.service.yaml`: internal ClusterIP endpoint for worker-to-sandbox calls
- `sandbox.hpa.yaml`: CPU-based autoscaling policy
- `sandbox.networkpolicy.yaml`: ingress restriction to worker pods only

## Apply Flow

1. Install KEDA in the cluster.
2. Replace `PROJECT_ID` and image tags in the manifests or patch them through Kustomize overlays.
3. Create a real `nojv-runtime-secrets` secret with Cloud SQL and Memorystore connection strings.
4. Apply `kubectl apply -k infra/gcp/gke`.

This folder is the scale-out path, not the default local-development target.
