# GKE

GKE-specific setup for the `nojv` chart with `values-gke.yaml`: node pools,
Cloud SQL Auth Proxy identity, and the Temporal prerequisite. The chart renders
every NOJV workload; the deploy itself is `infra/gcp/cloud-build/deploy.sh`
([GCP guide](../README.md)). Shared rules are in the
[Deployment Guide](../../../docs/operations/DEPLOYMENT.md).

## Key code

- `../scripts/create-node-pools.sh`: creates the three node pools
- `sandbox-node-system-config.yaml`: sandbox kubelet config (`podPidsLimit: 1024`)
- `temporal/`: Temporal Helm values and setup ([Temporal HA](temporal/HA-PRODUCTION.md))
- `infra/charts/nojv/values-gke.yaml`: overlay

## Node pools

Sandbox Pods must not share nodes with the orchestrator: a runaway submission
could starve the worker and stop judging.

| Pool                | Machine (default) | Taint                          | Label               | Size                  |
| ------------------- | ----------------- | ------------------------------ | ------------------- | --------------------- |
| `pool-worker`       | `e2-standard-2`   | none                           | `nojv-role=worker`  | 2 nodes, static       |
| `pool-sandbox`      | `e2-standard-4`   | `nojv-role=sandbox:NoSchedule` | `nojv-role=sandbox` | on-demand, fixed at 1 |
| `pool-sandbox-spot` | `e2-standard-4`   | `nojv-role=sandbox:NoSchedule` | `nojv-role=sandbox` | Spot, autoscale 0–4   |

Both sandbox pools use `cos_containerd`, GKE Sandbox (`--sandbox=type=gvisor`),
image streaming, and `sandbox-node-system-config.yaml`. Workers and the migrator
pin to `nojv-role=worker`; sandbox Pods select `nojv-role=sandbox` with a
matching toleration. Without the sandbox pools, sandbox Jobs stay `Pending` and
nothing in the Helm install fails, so create them first:

```bash
CLUSTER_NAME=... REGION=... [PROJECT_ID=...] infra/gcp/scripts/create-node-pools.sh
```

Overrides: `WORKER_MACHINE_TYPE`, `SANDBOX_MACHINE_TYPE`,
`SANDBOX_SPOT_MAX_NODES`. Re-running fails on pools that already exist.

The cluster needs NetworkPolicy enforcement (Dataplane V2 or
`--enable-network-policy`); the judge worker refuses to start without it.

## Cloud SQL Auth Proxy

With `postgres.mode=cloudsql` and `cloudsqlProxy.enabled=true`, web, both
workers, the migrator and the seed Job run
`gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.11.0` (digest-pinned) as a native
sidecar on `127.0.0.1:5432` with `--private-ip`. `DATABASE_URL` in the runtime
Secret targets loopback. The instance connection name is the chart value
`postgres.cloudsql.instanceConnectionName`, set by `deploy.sh`.

The proxy authenticates with Workload Identity Federation for GKE. Grant
`roles/cloudsql.client` directly to every Kubernetes service account that runs
the proxy: `nojv-worker-judge`, `nojv-worker-platform`, `nojv-web-maintenance`
(migrator; a hook resource recreated on every release, so a service-account
annotation would not persist) and `default` (web and seed). Principal grants
need no annotation and can be made before the first install:

```bash
PROJECT_NUMBER="$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')"
for ksa in nojv-worker-judge nojv-worker-platform nojv-web-maintenance default; do
  gcloud projects add-iam-policy-binding PROJECT_ID --role=roles/cloudsql.client \
    --member="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/PROJECT_ID.svc.id.goog/subject/ns/nojv/sa/${ksa}"
done
```

## Capacity

`values-gke.yaml`: web HPA 2–15; judge 2 replicas × concurrency 2; platform 1
replica; sandbox quota 10 pods / 10 CPU / 30Gi; PDBs and worker egress policy on.
One on-demand gVisor node is always available and the Spot pool adds up to four
more for burst work; when Spot capacity disappears, Temporal retries the
affected work. No dispatcher autoscaler is used (OPS-11). Sizing:
[Judge Queue](../../../docs/runbooks/judge-queue.md).

## First install

1. Create the node pools.
2. Install Temporal ([Temporal HA](temporal/HA-PRODUCTION.md)).
3. Create the runtime Secret from `infra/charts/nojv/secret.example.yaml`
   (Cloud SQL loopback `DATABASE_URL`, Memorystore `REDIS_URL`, GCS `S3_*`, auth,
   SMTP, registry and seed keys) and the TLS Secret for both hosts. After the
   chart creates `nojv-sandbox`, add the `nojv-registry-pull` Secret there
   (same shape as the [single-machine registry step](../../../docs/runbooks/k8s-single-machine.md#registry)).
4. Create the Cloud Armor policy
   ([Cloudflare + Cloud Armor Setup](../../../docs/operations/DEPLOYMENT.md#cloudflare--cloud-armor-setup)).
5. Grant the proxy's Cloud SQL access (above).
6. Run `infra/gcp/cloud-build/deploy.sh`.
7. Enable Cloud SQL backups (`infra/gcp/scripts/setup-backups.sh`).
