# NOJV Helm chart

The single deploy path for NOJV (OPS-01): web, the judge and platform Temporal
workers, sandbox namespace policy, release hooks, and optional in-cluster
Postgres (CloudNativePG), Redis, MinIO, Versity S3 Gateway, registry, cloudflared
and metrics stack.
Requires Kubernetes 1.30+. Prerequisites, release flow, migrations and env vars
are in the [Deployment Guide](../../../docs/operations/DEPLOYMENT.md).

## Values files

| File                         | Use                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `values.yaml`                | Shared defaults                                                                                                            |
| `values-single-machine.yaml` | k3s: GHCR images, CNPG with backups, in-cluster Redis/MinIO plus idle Versity, registry, cloudflared, metrics, web HPA 1–3 |
| `values-gke.yaml`            | GKE: Cloud SQL proxy, Memorystore, GCS, GCE Ingress, PDBs, worker egress policy, web HPA 2–15                              |
| `secret.example.yaml`        | Runtime Secret keys (documentation only; the chart never templates secret values)                                          |

## Render

```bash
helm template nojv infra/charts/nojv \
  -f infra/charts/nojv/values-single-machine.yaml \
  -f tests/fixtures/helm/immutable-image-digests.yaml \
  -f tests/fixtures/helm/production-external-backups.yaml
pnpm lint:helm   # lint plus GKE and single-machine renders
```

Non-local renders fail without `release.sourceSha`, an immutable `image.tag` and
all four `image.digests.*`. Digests come only from the registry that holds the
tag: Buildx metadata in `build-images.yml`, or Artifact Registry in
`deploy.sh`. Never copy a digest from another tag or architecture.

## Templates

| Template                                                                           | Renders                                                                                                                                      |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `namespaces.yaml`                                                                  | `nojv`, and `nojv-sandbox` with `restricted` Pod Security                                                                                    |
| `web.deployment.yaml`, `web.service.yaml`, `web.hpa.yaml`, `web.ingress.yaml`      | Web; Ingress adds GCE `BackendConfig` (Cloud Armor) and `FrontendConfig` (HTTPS redirect)                                                    |
| `worker-judge.deployment.yaml`                                                     | `nojv-worker` (`WORKER_MODE=judge`, `strategy: Recreate`); rendered first, full env block in the order `env-manifest-parity` checks          |
| `worker-platform.deployment.yaml`                                                  | `nojv-worker-platform` (`WORKER_MODE=platform`, mailer)                                                                                      |
| `worker-rbac.yaml`                                                                 | Separate judge and platform service accounts with least-privilege Roles                                                                      |
| `pdb.yaml`                                                                         | Web, judge and platform PDBs (`pdb.enabled`)                                                                                                 |
| `app-network-policy.yaml`                                                          | `worker-egress` and `platform-smtp-egress` (`networkPolicy.enabled`)                                                                         |
| `sandbox-policy.yaml`                                                              | `deny-all-sandbox`, ResourceQuota (kept on uninstall), LimitRange                                                                            |
| `postgres-cnpg.yaml`                                                               | CNPG `Cluster` (kept) and `ScheduledBackup` (`postgres.mode=cnpg`)                                                                           |
| `redis.yaml`, `minio.yaml`, `minio-storageclass.yaml`, `minio-backup.cronjob.yaml` | In-cluster Redis; MinIO with a kept `Retain` StorageClass and PVC; rclone off-host mirror CronJob of the `storage.active` store              |
| `objstore.yaml`                                                                    | Versity S3 Gateway with its own kept `Retain` StorageClass and PVC, ClusterIP Service and rclone bucket hook (`storage.objectStore.enabled`) |
| `registry.yaml`                                                                    | `registry:2` plus MinIO bucket-init hook (`registry.enabled`)                                                                                |
| `cloudflared.deployment.yaml`                                                      | Edge tunnel (`edge.cloudflared.enabled`)                                                                                                     |
| `otel-collector.yaml`, `prometheus.yaml`, `node-exporter.yaml`, `grafana.yaml`     | In-cluster metrics stack                                                                                                                     |
| `schema-fence.yaml`                                                                | Schema contract `ValidatingAdmissionPolicy` (hook -40)                                                                                       |
| `release-prepull.job.yaml`, `sandbox-prepull.job.yaml`                             | Pre-install/upgrade image pulls (hook -10)                                                                                                   |
| `web-maintenance.deployment.yaml`                                                  | Maintenance page (pre-upgrade hook -7, release window only)                                                                                  |
| `migrator.job.yaml`                                                                | Migrator (pre-install/upgrade hook -5)                                                                                                       |
| `web-maintenance.yaml`                                                             | Maintenance RBAC and the post-upgrade/post-rollback restore Job (hook 10)                                                                    |
| `seed.job.yaml`                                                                    | Production seed (post-install hook, `seed.enabled`)                                                                                          |
| `production-preflight.yaml`                                                        | Render-time checks for `postgres.mode=cloudsql`                                                                                              |
| `files/release-workloads.sh`, `files/in-cluster-kubeconfig.sh`                     | Scripts embedded in the hook Jobs                                                                                                            |
| `files/grafana-dashboards/`                                                        | Copy of `infra/grafana/dashboards/` (Helm can read only inside the chart; keep in sync)                                                      |

## Values

Defaults are from `values.yaml`; overlays override as noted in the Deployment
Guide.

| Knob                                                                                                 | Default                                                                      | Purpose                                                                                |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `release.sourceSha`                                                                                  | empty                                                                        | Verified 40-character source commit                                                    |
| `image.registry` / `repositoryPrefix` / `tag`                                                        | `asia-east1-docker.pkg.dev` / `PROJECT_ID/nojv` / appVersion                 | Image name; tag rendered as `app.kubernetes.io/version`                                |
| `image.repositories.*`                                                                               | `web`, `worker`, `sandbox`, `migrator`                                       | Per-component repository (single-machine: `nojv-*`)                                    |
| `image.digests.{web,worker,sandbox,migrator}`                                                        | required                                                                     | Registry-verified manifest digests                                                     |
| `image.allowUnpinnedLocalBuilds`                                                                     | `false`                                                                      | Local-only: empty registry and prefix, tag `local`                                     |
| `postgres.mode`                                                                                      | `cnpg`                                                                       | `cnpg`, `cloudsql` or `external`                                                       |
| `postgres.cnpg.{instances,storageSize,storageClass,imageName}`                                       | `1` / `10Gi` / default / pinned PG 18                                        | CNPG Cluster                                                                           |
| `postgres.cnpg.backup.*`                                                                             | disabled                                                                     | barman-cloud backups and WAL to `s3://`; required fields validated when enabled        |
| `postgres.cloudsql.{instanceConnectionName,proxyImage}`                                              | empty / pinned proxy 2.11.0                                                  | Cloud SQL proxy target                                                                 |
| `cloudsqlProxy.enabled`                                                                              | `false`                                                                      | Native proxy sidecar in web, workers, migrator, seed                                   |
| `redis.inCluster`                                                                                    | `true`                                                                       | In-cluster Redis, else `REDIS_URL` from the Secret                                     |
| `storage.inCluster` / `bucket` / `region`                                                            | `true` / `nojv` / `auto`                                                     | In-cluster MinIO, else `S3_*` from the Secret                                          |
| `storage.minio.existingClaim`                                                                        | empty                                                                        | Use an existing PVC; skips the chart PVC and StorageClass                              |
| `storage.minio.storageClass.*`                                                                       | create `nojv-minio-retain`, `rancher.io/local-path`                          | Dedicated `Retain` class; with `create=false`, supply a class that already retains     |
| `storage.active`                                                                                     | `minio`                                                                      | Store (`minio` or `objstore`) for the registry, its hook and the mirror                |
| `storage.objectStore.{enabled,image,storageSize,resources}`                                          | `false` (single-machine `true`) / pinned Versity v1.8.0 / `10Gi` / 128–256Mi | Versity S3 Gateway (posix) beside MinIO                                                |
| `storage.objectStore.storageClass.*`                                                                 | create `nojv-objstore-retain`, `rancher.io/local-path`                       | Dedicated `Retain` class; with `create=false`, supply a class that already retains     |
| `storage.rclone.image`                                                                               | pinned rclone 1.75.1                                                         | Objstore bucket hook and off-host mirror                                               |
| `storage.minio.backup.*`                                                                             | disabled, 04:00 UTC, provider `Cloudflare`                                   | `rclone copy --metadata` CronJob of both buckets to an HTTPS off-host bucket           |
| `registry.enabled`                                                                                   | `false`                                                                      | In-cluster registry for special_env images                                             |
| `registry.{host,bucket,internalUrl}`                                                                 | `""` / `nojv-registry` / Service DNS                                         | Public push host, bucket on the active store, in-cluster URL                           |
| `registry.token.{realm,issuer}`                                                                      | `""` / `nojv`                                                                | Token endpoint URL (`https://<host>/api/registry/token`) and JWT issuer                |
| `registry.s3.regionendpoint`                                                                         | `""`                                                                         | Blob endpoint when `storage.inCluster=false`                                           |
| `temporal.address` / `namespace`                                                                     | `temporal-frontend.nojv-temporal.svc.cluster.local:7233` / `default`         | Temporal target                                                                        |
| `secrets.runtimeSecretName`                                                                          | `nojv-runtime-secrets`                                                       | Existing runtime Secret                                                                |
| `mailer.smtpPort`                                                                                    | `465`                                                                        | SMTP port for web and platform, and the SMTP egress rule                               |
| `web.{replicas,resources,nodeSelector,dbPoolMax}`                                                    | `1` / 250m–1 CPU, 256–512Mi / none / `10`                                    | Web sizing                                                                             |
| `web.service.{type,port,nodePort}`                                                                   | `ClusterIP` / `80` / empty                                                   | Web Service                                                                            |
| `web.hpa.{enabled,min,max,targetCPU}`                                                                | `false` / 2 / 15 / 70                                                        | Web autoscaling                                                                        |
| `web.advancedImageAllowedRegistries`                                                                 | `""` (app default list)                                                      | `ADVANCED_IMAGE_ALLOWED_REGISTRIES`                                                    |
| `web.ingress.{enabled,className,host,tls}`                                                           | `false`                                                                      | Ingress                                                                                |
| `web.ingress.gce.{securityPolicy,httpsRedirect}`                                                     | `""` / `false`                                                               | Cloud Armor policy and redirect on GCE                                                 |
| `edge.cloudflared.{enabled,replicas,tokenSecret}`                                                    | `false` / 2 / `nojv-cloudflared-token`                                       | Tunnel; the Secret holds key `token`                                                   |
| `worker.judge.{replicas,concurrency,minConcurrency,resources,nodeSelector}`                          | `2` / `4` / unset                                                            | Judge worker; `minConcurrency` enables the resource-based slot tuner                   |
| `worker.platform.{replicas,concurrency,submissionPendingTimeoutMinutes,resources,nodeSelector}`      | `1` / `4` / `10`                                                             | Platform worker                                                                        |
| `worker.sandbox.{cpuRequest,cpuLimit,memoryRequest,memoryLimit}`                                     | 500m / 1 / 64Mi / 512Mi                                                      | Sandbox container resources (`K8S_*`)                                                  |
| `worker.sandbox.{runParallelism,runtimeClassName,imagePullSecret}`                                   | 1 / `gvisor` (required) / `""`                                               | Cases per stage Pod, RuntimeClass, special_env pull Secret                             |
| `pdb.enabled` / `maxUnavailable`                                                                     | `false` / `1`                                                                | PodDisruptionBudgets                                                                   |
| `sandbox.prepull.{enabled,backoffLimit}`                                                             | `true` / `1`                                                                 | Sandbox image pre-pull hook                                                            |
| `sandbox.networkPolicy.enabled`                                                                      | `true`                                                                       | `deny-all-sandbox`                                                                     |
| `sandbox.resourceQuota.{pods,requestsCpu,requestsMemory}`                                            | 50 / 25 / 12Gi                                                               | Judge capacity ceiling                                                                 |
| `sandbox.limitRange.*`                                                                               | default 1 CPU / 512Mi, request 500m / 256Mi, max 2 / 1536Mi, min 100m / 64Mi | Per-container sandbox bounds                                                           |
| `networkPolicy.enabled` / `temporalNamespace` / `egress.*`                                           | `false` / `nojv-temporal` / placeholder CIDRs                                | Worker egress allowlist; `deploy.sh` sets real CIDRs                                   |
| `observability.collector.{enabled,remoteWriteUrl}`                                                   | `false` / `""`                                                               | OTLP collector; exposes `:8889/metrics` without remote write                           |
| `observability.prometheus.{enabled,retention,storageSize}`                                           | `false` / `15d` / `10Gi`                                                     | Prometheus scraping the collector                                                      |
| `observability.prometheus.remoteWrite.{url,username}`                                                | `""`                                                                         | Grafana Cloud remote write; password from `GRAFANA_CLOUD_PROM_PASSWORD`                |
| `observability.prometheus.nodeExporter.enabled`                                                      | `false`                                                                      | Node and disk metrics (single node)                                                    |
| `observability.grafana.{enabled,adminUser,adminPassword}`                                            | `false` / `admin` / `""`                                                     | Grafana; empty password reads `GRAFANA_ADMIN_PASSWORD` from the Secret                 |
| `observability.grafana.ingress.*`, `service.port`                                                    | disabled / `3000`                                                            | Grafana access                                                                         |
| `migrator.enabled`                                                                                   | `true`                                                                       | Migrator hook, schema fence, maintenance flow; required when `web.nodeEnv=production`  |
| `migrator.releaseWindow`                                                                             | `true`                                                                       | Render workloads drained on upgrade; set by the release workflow, never pinned by hand |
| `migrator.{activeDeadlineSeconds,statusTimeoutSeconds,backoffLimit}`                                 | 6600 / 10 / 0                                                                | Migrator Job limits                                                                    |
| `maintenance.pageReadyTimeoutSeconds`                                                                | 120                                                                          | Wait for the maintenance page before draining                                          |
| `maintenance.{drainTimeoutSeconds,restoreTimeoutSeconds,readyTimeoutSeconds,prepullDeadlineSeconds}` | 300 / 300 / 300 / 900                                                        | Drain, restore and pre-pull limits                                                     |
| `seed.enabled`                                                                                       | `false`                                                                      | Post-install seed from `SEED_*` Secret keys                                            |

## `DATABASE_URL` by mode

The URL always comes from the runtime Secret.

- `cnpg`: `postgresql://nojv:<pw>@<release>-pg-rw.<ns>.svc.cluster.local:5432/nojv`;
  the password is in the operator's `<cluster>-app` Secret.
- `cloudsql`: `127.0.0.1:5432` through the proxy sidecar; the instance name is the
  chart value `postgres.cloudsql.instanceConnectionName`.
- `external`: any reachable Postgres.

## In-cluster metrics

The single-machine overlay enables the collector, Prometheus, node-exporter and
Grafana; the GKE overlay leaves them off. Wiring and dashboards:
[Observability Setup](../../../docs/runbooks/observability-setup.md).
