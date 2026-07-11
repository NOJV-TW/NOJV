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
   auth secrets, OAuth, and optional `OTEL_EXPORTER_OTLP_*` keys. See
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
├── files/
│   └── grafana-dashboards/      # chart copy of infra/grafana/dashboards/*.json
└── templates/
    ├── _helpers.tpl
    ├── NOTES.txt
    ├── namespaces.yaml              # nojv + nojv-sandbox
    ├── web.deployment.yaml          # ported from web.cloudrun.yaml
    ├── web.service.yaml             # ClusterIP
    ├── web.hpa.yaml                 # guarded by web.hpa.enabled
    ├── web.ingress.yaml             # guarded by web.ingress.enabled (Cloudflare origin)
    ├── worker-judge.deployment.yaml     # WORKER_MODE=judge (rendered FIRST)
    ├── worker-judge.keda.yaml           # opt-in KEDA ScaledObject (worker.judge.keda.enabled)
    ├── worker-platform.deployment.yaml  # WORKER_MODE=platform
    ├── worker-rbac.yaml             # SA + Role + RoleBinding (manage Jobs in sandbox ns)
    ├── worker-pdb.yaml              # guarded by pdb.enabled
    ├── app-network-policy.yaml      # worker-egress (guarded by networkPolicy.enabled)
    ├── sandbox-policy.yaml          # deny-all NetworkPolicy + ResourceQuota + LimitRange
    ├── postgres-cnpg.yaml           # CNPG Cluster + ScheduledBackup (mode==cnpg)
    ├── redis.yaml                   # in-cluster Redis (redis.inCluster)
    ├── minio.yaml                   # in-cluster MinIO (storage.inCluster)
    ├── otel-collector.yaml          # OTLP collector (observability.collector.enabled)
    ├── prometheus.yaml              # in-cluster Prometheus (observability.prometheus.enabled)
    ├── grafana.yaml                 # in-cluster Grafana + dashboards (observability.grafana.enabled)
    └── migrator.job.yaml            # pre-install/pre-upgrade Helm hook
```

## Values knobs

| Knob                                                                            | Default                                                            | Purpose                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `image.registry` / `image.repositoryPrefix` / `image.tag`                       | `asia-east1-docker.pkg.dev` / `PROJECT_ID/nojv` / chart appVersion | image ref composition                                                                                               |
| `image.repositories.*`                                                          | web/worker/sandbox/egress-proxy/migrator                           | per-component repo suffix                                                                                           |
| `postgres.mode`                                                                 | `cnpg`                                                             | `cnpg` \| `cloudsql` \| `external` — drives `DATABASE_URL` derivation                                               |
| `postgres.cnpg.instances` / `storageSize`                                       | `1` / `10Gi`                                                       | CNPG Cluster size                                                                                                   |
| `postgres.cnpg.backup.*`                                                        | disabled                                                           | barman-cloud `ScheduledBackup`                                                                                      |
| `postgres.cloudsql.instanceConnectionName`                                      | placeholder                                                        | Cloud SQL proxy target                                                                                              |
| `cloudsqlProxy.enabled`                                                         | `false`                                                            | adds the cloud-sql-proxy sidecar (use with `mode=cloudsql`)                                                         |
| `redis.inCluster`                                                               | `true`                                                             | deploy in-cluster Redis, else `REDIS_URL` from secret                                                               |
| `storage.inCluster`                                                             | `true`                                                             | deploy in-cluster MinIO, else `S3_*` from secret                                                                    |
| `storage.bucket` / `storage.region`                                             | `nojv` / `auto`                                                    | S3 bucket/region                                                                                                    |
| `temporal.address` / `temporal.namespace`                                       | in-cluster Temporal frontend / `default`                           | Temporal client target                                                                                              |
| `secrets.runtimeSecretName`                                                     | `nojv-runtime-secrets`                                             | existing secret to reference                                                                                        |
| `web.replicas` / `web.resources` / `web.nodeSelector`                           | `1` / 256Mi-512Mi                                                  | web sizing                                                                                                          |
| `web.hpa.{enabled,min,max,targetCPU}`                                           | `false` / 2 / 15 / 70                                              | web autoscaling                                                                                                     |
| `web.advancedImageAllowedRegistries`                                            | `""` (app default `ghcr.io,docker.io`)                             | Comma-separated registry hosts accepted for special_env image refs                                                  |
| `web.ingress.{enabled,className,host,tls}`                                      | `false`                                                            | Ingress for Cloudflare origin                                                                                       |
| `worker.judge.{replicas,concurrency,resources,nodeSelector}`                    | `2` / `4`                                                          | judge workers                                                                                                       |
| `worker.judge.keda.{enabled,min,max,prometheusAddress,query,threshold}`         | `false` / 2 / 10                                                   | opt-in dispatcher autoscaling on Temporal queue (KEDA prereq)                                                       |
| `worker.platform.{replicas,concurrency,resources,nodeSelector}`                 | `1` / `4`                                                          | platform workers                                                                                                    |
| `worker.sandbox.{cpu,memory}{Request,Limit}`                                    | 500m/1 · 256Mi/512Mi                                               | per-sandbox Job hints (K8S\_\* env)                                                                                 |
| `pdb.enabled` / `pdb.minAvailable`                                              | `false` / `1`                                                      | worker PodDisruptionBudgets                                                                                         |
| `sandbox.networkPolicy.enabled`                                                 | `true`                                                             | sandbox deny-all NetworkPolicy                                                                                      |
| `sandbox.resourceQuota.*`                                                       | pods 50, cpu 25, mem 12Gi                                          | sandbox ResourceQuota                                                                                               |
| `sandbox.limitRange.*`                                                          | per-container defaults/max/min                                     | sandbox LimitRange                                                                                                  |
| `networkPolicy.enabled`                                                         | `false`                                                            | worker-egress NetworkPolicy (set CIDRs first)                                                                       |
| `networkPolicy.egress.*`                                                        | cluster-specific CIDRs                                             | Redis/CloudSQL/GoogleAPIs/API-server egress                                                                         |
| `observability.collector.enabled`                                               | `false`                                                            | deploy the in-cluster OTLP collector                                                                                |
| `observability.collector.{image,remoteWriteUrl,resources}`                      | contrib image / `""`                                               | collector image; remote-write target (else expose :8889 /metrics)                                                   |
| `observability.prometheus.enabled`                                              | `false`                                                            | deploy in-cluster Prometheus scraping the collector `:8889`                                                         |
| `observability.prometheus.{image,retention,storageSize,storageClass,resources}` | `prom/prometheus` / `15d` / `10Gi`                                 | Prometheus image, TSDB retention, PVC sizing                                                                        |
| `observability.grafana.enabled`                                                 | `false`                                                            | deploy in-cluster Grafana with the chart dashboards auto-provisioned                                                |
| `observability.grafana.{image,adminUser,adminPassword,resources}`               | `grafana/grafana` / `admin` / `admin`                              | Grafana image + admin login (change `adminPassword`; empty = read `GRAFANA_ADMIN_PASSWORD` from the runtime secret) |
| `observability.grafana.service.port`                                            | `3000`                                                             | Grafana Service port                                                                                                |
| `observability.grafana.ingress.{enabled,className,host,tls}`                    | `false`                                                            | Ingress for Cloudflare-fronted Grafana access                                                                       |
| `migrator.enabled`                                                              | `true`                                                             | run the migration Job as a Helm hook                                                                                |

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

## Observability (in-cluster OTLP)

The web + worker apps push standard OTLP/HTTP metrics when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set in the runtime secret. The chart ships the
**full** in-cluster metrics stack — collector + Prometheus + Grafana — so a
self-hosted deployment needs no external cloud. All three are opt-in (off by
default in both overlays):

```bash
helm upgrade --install nojv infra/charts/nojv \
  -f infra/charts/nojv/values-single-machine.yaml \
  --set observability.collector.enabled=true \
  --set observability.prometheus.enabled=true \
  --set observability.grafana.enabled=true
```

- **Collector** — set `OTEL_EXPORTER_OTLP_ENDPOINT` in the runtime secret to its
  Service (`http://nojv-otel-collector.nojv.svc:4318`, no auth header needed). It
  exposes `:8889 /metrics`.
- **Prometheus** — scrapes the collector at `nojv-otel-collector.nojv.svc:8889`
  every 30s, persists to a PVC (`observability.prometheus.storageSize`,
  retention `observability.prometheus.retention`).
- **Grafana** — auto-provisions a `Prometheus` datasource
  (`http://nojv-prometheus.nojv.svc:9090`, default) and the chart-local
  dashboards. Reach it via its Service (`:3000`) or the optional
  `observability.grafana.ingress`. The admin password is
  `observability.grafana.adminPassword` (default `admin` — **change it**); set it
  empty to read `GRAFANA_ADMIN_PASSWORD` from the runtime secret instead.

The dashboards under `files/grafana-dashboards/` are the chart copy of
`infra/grafana/dashboards/` (the source of truth — Helm `.Files.Glob` can only
read inside the chart dir; keep the two in sync). Each references its datasource
via a `${DS_PROMETHEUS}` template variable, so it auto-resolves to the
provisioned Prometheus with no hardcoded UID.

On **GKE** the Google-managed path is preferred (Google Managed Service for
Prometheus / Cloud Monitoring), so the GKE overlay leaves all three off. See
[`docs/runbooks/observability-setup.md`](../../../docs/runbooks/observability-setup.md).

## Notes

- The judge Deployment is rendered **first** and keeps the full worker env block
  in the exact key order required by the `env-manifest-parity` guard.
- NetworkPolicy is inert unless the cluster CNI enforces it (GKE Dataplane V2).
  The `worker-egress` CIDRs are placeholders — replace them for your cluster.
- The migrator runs as a `pre-install,pre-upgrade` hook with
  `before-hook-creation` delete policy so each release re-runs migrations.
