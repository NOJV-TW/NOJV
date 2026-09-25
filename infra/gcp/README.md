# GCP

GKE deployment of the `nojv` chart with `values-gke.yaml`: Cloud Build images,
Cloud SQL, Memorystore, GCS, and a Cloud Armor-restricted Ingress behind
Cloudflare. Chart behavior, env vars and the edge setup are in the
[Deployment Guide](../../docs/operations/DEPLOYMENT.md); node pools, Cloud SQL
wiring and Temporal are in [GKE notes](gke/README.md).

## Key code

- `cloud-build/deploy.sh`: verified build, provenance check, Helm deploy, edge probes
- `cloud-build/cloudbuild.yaml`: builds one component per Cloud Build with VERIFIED provenance
- `cloudflare-origin-cidrs.txt`: the exact Cloudflare ranges Cloud Armor must allow
- `gke/`: node pool system config, Temporal values
- `scripts/create-node-pools.sh`: worker and gVisor sandbox pools
- `scripts/setup-backups.sh`, `scripts/export-postgres-to-gcs.sh`: Cloud SQL backups and daily export

## Topology

| Component       | Runs as                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| web             | Chart Deployment behind a GCE Ingress; Cloudflare proxies to it                |
| judge, platform | Chart Deployments on `pool-worker`                                             |
| sandbox         | Per-stage Jobs in `nojv-sandbox` on the gVisor sandbox pools                   |
| migrator, seed  | Chart Helm hooks                                                               |
| Postgres        | Cloud SQL (private IP) through the Auth Proxy sidecar                          |
| Redis           | Memorystore (private IP)                                                       |
| Object storage  | GCS (S3-compatible)                                                            |
| Registry        | In-cluster `registry:2` with GCS blobs, on its own Cloudflare-proxied hostname |
| Temporal        | Official Temporal Helm chart in `nojv-temporal`                                |
| Images          | Artifact Registry                                                              |

`production-preflight.yaml` makes the chart refuse a `cloudsql` render without
this shape.

## Required environment variables for `deploy.sh`

| Variable                            | Value                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `PROJECT_ID`                        | GCP project                                                                         |
| `REGION`                            | Artifact Registry region                                                            |
| `REPOSITORY`                        | Artifact Registry repository                                                        |
| `RELEASE_NAME`                      | Helm release                                                                        |
| `RELEASE_SHA`                       | Lowercase 40-character SHA at `HEAD`                                                |
| `RELEASE_REMOTE`                    | Authoritative remote (the `origin` for `NOJV-TW/NOJV`)                              |
| `RELEASE_REF`                       | Fully qualified branch ref, e.g. `refs/heads/main`                                  |
| `CLUSTER_NAME`, `CLUSTER_LOCATION`  | GKE cluster                                                                         |
| `DEPLOY_PRINCIPAL`                  | Must equal the active `gcloud` account                                              |
| `CLOUD_BUILD_SERVICE_ACCOUNT`       | Full service-account email                                                          |
| `K8S_NAMESPACE`                     | App namespace                                                                       |
| `PUBLIC_HOST`                       | Cloudflare-proxied site hostname                                                    |
| `REGISTRY_HOST`                     | Distinct Cloudflare-proxied registry hostname                                       |
| `TLS_SECRET_NAME`                   | Existing `kubernetes.io/tls` Secret in `K8S_NAMESPACE` covering both hosts          |
| `EDGE_SECURITY_POLICY`              | Cloud Armor policy allowing exactly `cloudflare-origin-cidrs.txt` with default deny |
| `CLOUDSQL_INSTANCE_CONNECTION_NAME` | `PROJECT_ID:REGION:INSTANCE`                                                        |
| `REDIS_INSTANCE`                    | Memorystore instance in `REGION`                                                    |

Required commands: `gcloud`, `curl`, `docker`, `helm`, `git`, `kubectl`, `node`,
`tar`, and `slsa-verifier` v2.7.1 or newer from the official
`slsa-framework/slsa-verifier` release. The script takes no runtime credentials;
create the runtime Secret from `infra/charts/nojv/secret.example.yaml` first.

## What `deploy.sh` does

1. Requires a clean tree and `RELEASE_SHA = HEAD = RELEASE_REMOTE:RELEASE_REF`;
   disables Git replacement objects.
2. Verifies the principal, project, Cloud Build identity, cluster endpoint and CA,
   private Cloud SQL and Memorystore addresses, Kubernetes API destinations, TLS
   Secret and Cloud Armor rules; derives the worker egress CIDRs from live
   resources. Uses an isolated temporary kubeconfig.
3. Enables required APIs and ensures the Artifact Registry repository exists.
4. For each of `web`, `worker`, `sandbox`, `migrator`, reuses an existing image or
   submits one Cloud Build that fetches the exact SHA from GitHub; every digest
   must pass SLSA verification (Google-hosted builder, canonical source and
   commit, exact component and Dockerfile).
5. Runs `helm upgrade --install` with the source SHA as `image.tag`, the four
   digests, Cloud SQL name, registry host and token realm, Ingress host, TLS,
   Cloud Armor policy and egress CIDRs, `--wait --timeout 125m`.
6. Requires two healthy Ingress backends, HTTP 200 for the site and a registry
   auth challenge through Cloudflare, and rejection of direct-origin requests to
   both hosts.

## Cloud SQL backups

`setup-backups.sh` (`PROJECT_ID`, `SQL_INSTANCE`, `REGION`, `BACKUP_BUCKET`) is
idempotent: daily automated backups (30 retained, in-region), PITR with 14 days
of logs, and a versioned nearline GCS bucket. `export-postgres-to-gcs.sh` is the
daily `gcloud sql export` for Cloud Scheduler. Restore steps:
[Backup & Restore](../../docs/runbooks/backup-restore.md).
