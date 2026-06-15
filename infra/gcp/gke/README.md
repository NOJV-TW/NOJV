# GKE Worker Notes

Use this topology when submissions should execute through Kubernetes-native sandbox jobs.

## Recommended Split

- Cloud Run: `web`
- GKE: `worker` (Temporal task-queue consumer / judge orchestrator)
- GKE Jobs in `nojv-sandbox`: sandbox-runner pods created by the worker
- Cloud SQL: PostgreSQL
- Memorystore: Redis

## Why This Exists

The worker is responsible for orchestration only: it polls the Temporal task
queue, and for each submission it creates a ConfigMap plus a one-shot Job in
the `nojv-sandbox` namespace, then reads the runner logs back to compute the
verdict. The Job model means every submission runs in a fresh Pod that dies
when finished — no long-lived sandbox service, no shared state between
submissions.

## Node Pool Layout (required)

The worker and sandbox pods MUST run on different node pools:

| Pool           | Taints                         | Labels              | Scaling          |
| -------------- | ------------------------------ | ------------------- | ---------------- |
| `pool-worker`  | none                           | `nojv-role=worker`  | static 2–3 nodes |
| `pool-sandbox` | `nojv-role=sandbox:NoSchedule` | `nojv-role=sandbox` | autoscale 0 → N  |

The worker Deployment pins itself via `nodeSelector: nojv-role=worker`. Sandbox
Pods are created with `nodeSelector: nojv-role=sandbox` and a matching
`toleration`, so only sandbox pods can land on the sandbox pool. Without this
split, a fork-bomb-style submission could starve the orchestrator and stop
processing queue — which would then look like "the site is down".

Create the pools with gcloud (replace `CLUSTER_NAME` and `REGION`):

```bash
gcloud container node-pools create pool-worker \
  --cluster=CLUSTER_NAME --region=REGION \
  --num-nodes=2 --machine-type=e2-standard-2 \
  --node-labels=nojv-role=worker

gcloud container node-pools create pool-sandbox \
  --cluster=CLUSTER_NAME --region=REGION \
  --num-nodes=0 --enable-autoscaling --min-nodes=0 --max-nodes=5 \
  --machine-type=e2-standard-4 \
  --node-labels=nojv-role=sandbox \
  --node-taints=nojv-role=sandbox:NoSchedule
```

## Files

- `kustomization.yaml`: worker bundle entrypoint
- `namespace.yaml`: declares `nojv`, `nojv-sandbox`, `nojv-temporal`
- `network-policy.yaml`: sandbox-deny-egress + worker egress allowlist
- `runtime-secrets.example.yaml`: placeholder runtime secret manifest
- `worker-rbac.yaml`: ServiceAccount + Role for creating sandbox Jobs
- `worker.deployment.yaml`: Temporal worker deployment + Cloud SQL Auth Proxy sidecar
- `worker.pdb.yaml`: PodDisruptionBudget — keep ≥1 alive during voluntary disruptions
- `temporal/`: self-hosted Temporal Server + dedicated Postgres + Web UI

Sandbox per-pod resource limits (ResourceQuota, LimitRange) live under
`infra/k8s/sandbox/` and are applied as a **separate second step** (see the
Apply Flow below). `kubectl apply -k infra/gcp/gke` brings up the namespace,
NetworkPolicy, worker RBAC/deployment/PDB, and Temporal — but **not** the
sandbox ResourceQuota/LimitRange; those need `kubectl apply -f infra/k8s/sandbox`.

## Cloud SQL Auth Proxy

The worker pod runs the official Cloud SQL Auth Proxy as a sidecar (image
`gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.11.0`). The proxy listens on
`127.0.0.1:5432`, so `DATABASE_URL` always targets loopback; the proxy
authenticates to Cloud SQL via Workload Identity.

One-time wiring (replace `PROJECT_ID` / `CLUSTER` / `REGION`):

```bash
# Create a GSA with Cloud SQL client role
gcloud iam service-accounts create nojv-worker \
  --display-name="NOJV worker service account"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:nojv-worker@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# Bind the KSA (nojv/nojv-worker) to that GSA via Workload Identity
gcloud iam service-accounts add-iam-policy-binding \
  nojv-worker@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:PROJECT_ID.svc.id.goog[nojv/nojv-worker]"

kubectl annotate serviceaccount nojv-worker \
  --namespace nojv \
  iam.gke.io/gcp-service-account=nojv-worker@PROJECT_ID.iam.gserviceaccount.com
```

After that, the secret `nojv-runtime-secrets` only needs the connection
name (`PROJECT_ID:REGION:INSTANCE`), not the GSA key.

## Temporal Server

`temporal/` deploys a single-pod Temporal Server using the official
`temporalio/auto-setup:1.22` image. On first boot the image runs the
schema migrations against the bundled Postgres (`temporal-postgres`
StatefulSet, 10Gi PVC). Frontend gRPC is exposed at
`temporal-frontend.nojv-temporal.svc.cluster.local:7233`; the worker
deployment already points at that.

For HA, switch to the `temporalio/temporal` helm chart and a managed
Postgres — auto-setup is fine for educational / single-region deploys
but lacks rolling-upgrade orchestration.

## Why No Autoscaler on the Worker

Earlier versions used KEDA with BullMQ list-length triggers. BullMQ has been
replaced by Temporal, so those triggers were scaling on dead Redis keys and
never fired — the removal is a no-op in effect but cleans up stale config.

Orchestrator work is I/O bound and very cheap: two workers can drive the
full sandbox ResourceQuota (50 pods / 25 CPU) with room to spare. Bring
autoscaling back only when a real metric (Temporal task queue backlog or
activity schedule-to-start latency, exposed via Prometheus) shows the worker
layer itself is a bottleneck.

## Apply Flow

1. Create the two node pools (see above).
2. Replace `PROJECT_ID` and image tags in `worker.deployment.yaml`.
3. Create a real `nojv-runtime-secrets` secret with the Cloud SQL / Memorystore connection strings **and the object-storage credentials** (`S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY`) — the worker reads submission sources and writes verdict blobs through `@nojv/storage`, so judging fails without them.
4. Apply the worker manifests:
   `kubectl apply -k infra/gcp/gke`
5. Apply the sandbox namespace manifests:
   `kubectl apply -f infra/k8s/sandbox`

This keeps the public control plane separate from the execution namespace while avoiding a long-lived sandbox service.
