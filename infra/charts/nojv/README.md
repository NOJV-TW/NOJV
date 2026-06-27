# NOJV Helm chart

One umbrella chart for the whole NOJV stack — web, Temporal workers (judge +
platform), sandbox namespace policy, the migrator hook, and optional in-cluster
Redis / MinIO / PostgreSQL (CloudNativePG). One chart, per-environment values.

Targets:

- **single-machine** — k3s / kind / OrbStack on one node (`values-single-machine.yaml`)
- **GKE** — HA on a Dataplane-V2 cluster (`values-gke.yaml`)

## Prerequisites (NOT installed by this chart)

These are documented dependencies, deliberately **not** vendored (no network at
package time):

1. **Runtime secret** — an existing `Secret` (default name `nojv-runtime-secrets`)
   in the app namespace holding `DATABASE_URL`, `REDIS_URL`, `S3_*`, the web
   auth secrets, OAuth, and optional Grafana OTLP keys. See
   [`secret.example.yaml`](./secret.example.yaml). The chart never templates
   secret values.
2. **CloudNativePG operator** (only when `postgres.mode=cnpg`) — install
   cluster-wide; this chart only renders the `Cluster` / `ScheduledBackup` CRs.
3. **Temporal Server** — reachable at `temporal.address`
   (default `temporal-frontend.nojv-temporal.svc.cluster.local:7233`).

## Install

```bash
# 1. Create the runtime secret (fill in your copy first; never commit it):
cp infra/charts/nojv/secret.example.yaml secret.local.yaml
kubectl create namespace nojv
kubectl -n nojv apply -f secret.local.yaml

# 2a. Single-machine:
helm upgrade --install nojv infra/charts/nojv \
  -f infra/charts/nojv/values-single-machine.yaml

# 2b. GKE:
helm upgrade --install nojv infra/charts/nojv \
  -f infra/charts/nojv/values-gke.yaml
```

## Render (no cluster needed)

```bash
helm template nojv infra/charts/nojv -f infra/charts/nojv/values-single-machine.yaml
helm template nojv infra/charts/nojv -f infra/charts/nojv/values-gke.yaml
```

## File tree

```
infra/charts/nojv/
├── Chart.yaml
├── values.yaml                  # shared defaults
├── values-single-machine.yaml   # k3s/kind overlay
├── values-gke.yaml              # GKE HA overlay
├── secret.example.yaml          # runtime secret keys (documentation only)
├── README.md
├── .helmignore
└── templates/
    ├── _helpers.tpl
    ├── NOTES.txt
    ├── namespaces.yaml              # nojv + nojv-sandbox
    ├── web.deployment.yaml          # ported from web.cloudrun.yaml
    ├── web.service.yaml             # ClusterIP
    ├── web.hpa.yaml                 # guarded by web.hpa.enabled
    ├── web.ingress.yaml             # guarded by web.ingress.enabled (Cloudflare origin)
    ├── worker-judge.deployment.yaml     # WORKER_MODE=judge (rendered FIRST)
    ├── worker-platform.deployment.yaml  # WORKER_MODE=platform
    ├── worker-rbac.yaml             # SA + Role + RoleBinding (manage Jobs in sandbox ns)
    ├── worker-pdb.yaml              # guarded by pdb.enabled
    ├── app-network-policy.yaml      # worker-egress (guarded by networkPolicy.enabled)
    ├── sandbox-policy.yaml          # deny-all NetworkPolicy + ResourceQuota + LimitRange
    ├── postgres-cnpg.yaml           # CNPG Cluster + ScheduledBackup (mode==cnpg)
    ├── redis.yaml                   # in-cluster Redis (redis.inCluster)
    ├── minio.yaml                   # in-cluster MinIO (storage.inCluster)
    └── migrator.job.yaml            # pre-install/pre-upgrade Helm hook
```

## Values knobs

| Knob                                                            | Default                                                            | Purpose                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `image.registry` / `image.repositoryPrefix` / `image.tag`       | `asia-east1-docker.pkg.dev` / `PROJECT_ID/nojv` / chart appVersion | image ref composition                                                 |
| `image.repositories.*`                                          | web/worker/sandbox/egress-proxy/migrator                           | per-component repo suffix                                             |
| `postgres.mode`                                                 | `cnpg`                                                             | `cnpg` \| `cloudsql` \| `external` — drives `DATABASE_URL` derivation |
| `postgres.cnpg.instances` / `storageSize`                       | `1` / `10Gi`                                                       | CNPG Cluster size                                                     |
| `postgres.cnpg.backup.*`                                        | disabled                                                           | barman-cloud `ScheduledBackup`                                        |
| `postgres.cloudsql.instanceConnectionName`                      | placeholder                                                        | Cloud SQL proxy target                                                |
| `cloudsqlProxy.enabled`                                         | `false`                                                            | adds the cloud-sql-proxy sidecar (use with `mode=cloudsql`)           |
| `redis.inCluster`                                               | `true`                                                             | deploy in-cluster Redis, else `REDIS_URL` from secret                 |
| `storage.inCluster`                                             | `true`                                                             | deploy in-cluster MinIO, else `S3_*` from secret                      |
| `storage.bucket` / `storage.region`                             | `nojv` / `auto`                                                    | S3 bucket/region                                                      |
| `temporal.address` / `temporal.namespace`                       | in-cluster Temporal frontend / `default`                           | Temporal client target                                                |
| `secrets.runtimeSecretName`                                     | `nojv-runtime-secrets`                                             | existing secret to reference                                          |
| `web.replicas` / `web.resources` / `web.nodeSelector`           | `1` / 256Mi-512Mi                                                  | web sizing                                                            |
| `web.hpa.{enabled,min,max,targetCPU}`                           | `false` / 2 / 15 / 70                                              | web autoscaling                                                       |
| `web.ingress.{enabled,className,host,tls}`                      | `false`                                                            | Ingress for Cloudflare origin                                         |
| `worker.judge.{replicas,concurrency,resources,nodeSelector}`    | `2` / `4`                                                          | judge workers                                                         |
| `worker.platform.{replicas,concurrency,resources,nodeSelector}` | `1` / `4`                                                          | platform workers                                                      |
| `worker.sandbox.{cpu,memory}{Request,Limit}`                    | 500m/1 · 256Mi/512Mi                                               | per-sandbox Job hints (K8S\_\* env)                                   |
| `pdb.enabled` / `pdb.minAvailable`                              | `false` / `1`                                                      | worker PodDisruptionBudgets                                           |
| `sandbox.networkPolicy.enabled`                                 | `true`                                                             | sandbox deny-all NetworkPolicy                                        |
| `sandbox.resourceQuota.*`                                       | pods 50, cpu 25, mem 12Gi                                          | sandbox ResourceQuota                                                 |
| `sandbox.limitRange.*`                                          | per-container defaults/max/min                                     | sandbox LimitRange                                                    |
| `networkPolicy.enabled`                                         | `false`                                                            | worker-egress NetworkPolicy (set CIDRs first)                         |
| `networkPolicy.egress.*`                                        | cluster-specific CIDRs                                             | Redis/CloudSQL/GoogleAPIs/API-server egress                           |
| `migrator.enabled`                                              | `true`                                                             | run the migration Job as a Helm hook                                  |

## How `DATABASE_URL` is derived

The literal connection string always lives in the **runtime secret** (never
templated into manifests). `postgres.mode` only drives the surrounding wiring:

- **`cnpg`** — in-cluster CloudNativePG `Cluster`. Set `DATABASE_URL` to the
  operator's `-rw` service:
  `postgresql://nojv:<pw>@<release>-pg-rw.<ns>.svc.cluster.local:5432/nojv`
  (password from the operator-managed `<cluster>-app` secret).
- **`cloudsql`** — set `cloudsqlProxy.enabled=true`. A `cloud-sql-proxy` sidecar
  listens on `127.0.0.1:5432`; `DATABASE_URL` points at `127.0.0.1:5432`, and
  `CLOUDSQL_INSTANCE_CONNECTION_NAME` comes from the runtime secret.
- **`external`** — `DATABASE_URL` is whatever you put in the secret (managed
  Postgres, RDS, etc.).

## Notes

- The judge Deployment is rendered **first** and keeps the full worker env block
  in the exact key order required by the `env-manifest-parity` guard.
- NetworkPolicy is inert unless the cluster CNI enforces it (GKE Dataplane V2).
  The `worker-egress` CIDRs are placeholders — replace them for your cluster.
- The migrator runs as a `pre-install,pre-upgrade` hook with
  `before-hook-creation` delete policy so each release re-runs migrations.
