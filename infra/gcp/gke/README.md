# GKE deployment notes for the Helm chart

GKE-specific guidance for deploying the `nojv` Helm chart (`infra/charts/nojv`,
values overlay `values-gke.yaml`). The chart renders every workload — these
notes cover only what is GKE-specific: node pools, the Cloud SQL Auth Proxy, the
Temporal prerequisite, and the apply flow.

## Topology

- GKE: `web` — in-cluster Deployment behind an Ingress that Cloudflare proxies to
- GKE: `worker` — Temporal task-queue consumers / judge orchestrators (judge + platform Deployments)
- GKE Jobs in `nojv-sandbox`: sandbox-runner pods created by the worker
- Cloud SQL (optional, `postgres.mode=cloudsql`) or in-cluster CloudNativePG: PostgreSQL
- Memorystore (optional, `redis.inCluster=false`) or in-cluster Redis

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

Create both pools with the committed bootstrap script (so this step is
reproducible and not a copy-pasted one-off):

```bash
CLUSTER_NAME=... REGION=... infra/gcp/scripts/create-node-pools.sh
```

It runs the two `gcloud container node-pools create` commands below (machine
types / sandbox max-nodes are overridable via env — see the script header):

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

All workloads are now rendered by the `nojv` chart at `infra/charts/nojv`; there
is no kustomize bundle. The chart templates cover what used to be hand-written
manifests here:

- worker Deployments split by `WORKER_MODE` → `templates/worker-judge.deployment.yaml` (`nojv-worker` judge) + `templates/worker-platform.deployment.yaml` (`nojv-worker-platform` platform)
- ServiceAccount + Role for creating sandbox Jobs → `templates/worker-rbac.yaml`
- PodDisruptionBudgets for both workers (guarded by `pdb.enabled`) → `templates/worker-pdb.yaml`
- namespaces (`nojv` + `nojv-sandbox`) → `templates/namespaces.yaml`
- sandbox deny-all NetworkPolicy + ResourceQuota + LimitRange → `templates/sandbox-policy.yaml`
- worker-egress allowlist NetworkPolicy (guarded by `networkPolicy.enabled`) → `templates/app-network-policy.yaml`

The files that remain in `infra/gcp/gke/` are documentation / value-file inputs,
not applied manifests. Runtime secrets use the chart's single canonical
[`secret.example.yaml`](../../charts/nojv/secret.example.yaml), so GKE cannot
drift onto a second key list.

- `temporal/helm-values.ha.yaml`: HA values file for the official Temporal chart
- `temporal/secret.example.yaml`: placeholder Temporal store-credentials secret
- `temporal/HA-PRODUCTION.md`: Temporal production HA options

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

Temporal is a one-time **prerequisite**, installed via the official Helm chart —
it is no longer vendored as manifests in this repo. The `nojv` chart's workers
target `temporal-frontend.nojv-temporal.svc.cluster.local:7233`
(`temporal.address` default).

For single-machine / low-stakes deploys, a single-replica Temporal
(`temporalio/auto-setup`) is acceptable. For production HA on GKE, install the
official chart with `temporal/helm-values.ha.yaml` (separate
frontend/history/matching at `replicas >= 2`, backed by an HA database):

```bash
helm repo add temporal https://go.temporal.io/helm-charts
helm install temporal temporal/temporal \
  -n nojv-temporal --create-namespace \
  -f infra/gcp/gke/temporal/helm-values.ha.yaml
```

See [`temporal/HA-PRODUCTION.md`](temporal/HA-PRODUCTION.md) for the full set of
options (Temporal Cloud vs self-hosted HA) and
[Reliability Invariants](../../../docs/operations/RELIABILITY.md).

## Autoscaling (three layers)

1. **web** — `HorizontalPodAutoscaler` on CPU (`web.hpa.enabled`, min 2 / max 15
   on GKE). Absorbs concurrent-user spikes such as an exam start. Needs
   metrics-server.
2. **judge execution** — the elastic layer for a submission burst. The worker
   launches one sandbox-runner Job per submission into `nojv-sandbox`; concurrency
   is capped by the `ResourceQuota` (`sandbox.resourceQuota.pods`) and the
   `pool-sandbox` cluster-autoscaler grows nodes `0 → SANDBOX_MAX_NODES` to run
   them. Raise both for exam scale (e.g. `SANDBOX_MAX_NODES=10` +
   `sandbox.resourceQuota.pods`).
3. **judge worker (dispatcher)** — fixed `replicas: 2` by default: orchestration
   is I/O-bound and two workers already saturate the 50-pod quota, and CPU-HPA is
   the wrong signal for an I/O-bound dispatcher. When you raise the sandbox quota
   far enough that dispatch lags, turn on the opt-in KEDA `ScaledObject`
   (`worker.judge.keda.enabled`, a Prometheus trigger on Temporal task-queue
   backlog / schedule-to-start latency; requires KEDA + Prometheus scraping
   Temporal).

## Apply Flow

> **Preflight (do not skip):** judging _silently_ fails to schedule without an
> autoscaling `nojv-role=sandbox` pool — sandbox Jobs sit `Pending` forever and
> nothing in the Helm install errors. Step 1 below is mandatory before the chart
> is installed.

1. Create the two node pools — run `infra/gcp/scripts/create-node-pools.sh`
   (`CLUSTER_NAME=... REGION=...`), or the equivalent `gcloud` commands under
   [Node Pool Layout](#node-pool-layout-required).
2. Install the **CloudNativePG operator** cluster-wide (when `postgres.mode=cnpg`,
   the GKE default) so the chart can render the Postgres `Cluster` / `ScheduledBackup`.
3. Install **Temporal** via the official Helm chart (see
   [Temporal Server](#temporal-server)).
4. Create a real `nojv-runtime-secrets` secret with the Cloud SQL database URL,
   Memorystore URL, and **object-storage credentials** (`S3_ENDPOINT` /
   `S3_ACCESS_KEY` / `S3_SECRET_KEY`) — the non-secret Cloud SQL instance
   connection name is a verified `deploy.sh` input rendered by Helm.
5. Run `infra/gcp/cloud-build/deploy.sh` with explicit project, cluster,
   location, deploy-principal, Cloud Build service-account, namespace, and
   release, edge, TLS, Cloud SQL, and Redis variables listed in
   `infra/gcp/README.md`. The script verifies the GKE endpoint and CA, live
   private service addresses, TLS Secret, and Cloud Armor rules in an isolated
   kubeconfig before mutation, resolves every pushed component digest, and
   passes all verified values to Helm.

This keeps the public control plane separate from the execution namespace while avoiding a long-lived sandbox service.
