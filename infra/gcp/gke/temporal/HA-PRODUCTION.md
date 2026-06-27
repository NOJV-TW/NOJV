# Temporal: production HA options

## The problem this solves

The shipped GKE manifests run Temporal as a **single `temporalio/auto-setup` replica** backed by a
**single-pod in-cluster Postgres** StatefulSet (`temporal-server.yaml`, `postgres.yaml`). That is the
**dominant availability gap**: any node drain / GKE upgrade / zone loss stops _all_ judging, exam
auto-close, and contest lifecycle until the pod reschedules; PVC loss permanently destroys every
in-flight timer. The interim mitigations already shipped (PodDisruptionBudget, node pinning, daily
`pg_dump` to GCS — see `temporal.pdb.yaml`, `scripts/setup-backups.sh`) only narrow the window; they
do **not** remove the single point of failure.

**Does self-hosting solve it? Yes — but only if you stop running the bundled single-replica
`auto-setup` image and a single-pod database.** Temporal's frontend/history/matching/worker services
are stateless and scale horizontally; all durable state lives in the database. A real HA deployment =
those four services at `replicas ≥ 2` **plus a highly-available database**. The bundled `auto-setup`
image is explicitly a dev/single-node convenience and must not be run multi-replica.

The application code now supports TLS + API-key/mTLS auth (`packages/temporal/src/connection-config.ts`),
so **switching between any option below is a configuration change, not a code change.**

---

## Option A — Temporal Cloud (recommended for most academic deployments)

Fully-managed, multi-AZ, 99.9% SLA. Zero Temporal ops. You only run workers.

**Cost (2026):**

| Plan            | From                                            | Included                                                    | Notes                                                    |
| --------------- | ----------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Essentials      | **$100 / mo**                                   | 1M actions, 1 GB active / 40 GB retained storage, 99.9% SLA | fits a small–medium course/judge deployment              |
| Business        | **$500 / mo**                                   | 2.5M actions, 2.5 GB active / 100 GB retained storage       | busier / multi-org                                       |
| Actions overage | **$50 / 1M** (first 5M; volume discounts after) | —                                                           | $0.00005 / action; pay-as-you-go also on AWS Marketplace |

**Sizing NOJV:** an Action ≈ one workflow state transition (activity schedule/complete, signal, timer).
A submission judge ≈ 15–25 actions; the per-minute sweeper + 5-min reconciler add ~50k/mo. So
~10k submissions/mo ≈ <250k actions → comfortably inside **Essentials ($100/mo)**; ~50k submissions/mo
≈ ~1M actions → Essentials or Business. For a single school this is the cheapest _correct_ option once
you price in the ops cost of running HA Temporal yourself.

**Switch to it (config only):**

```bash
TEMPORAL_ADDRESS=<namespace>.<account>.tmprl.cloud:7233
TEMPORAL_NAMESPACE=<namespace>.<account>
TEMPORAL_API_KEY=<api-key>          # implies TLS; OR use mTLS:
# TEMPORAL_CLIENT_CERT_PATH=/etc/temporal/tls/client.pem
# TEMPORAL_CLIENT_KEY_PATH=/etc/temporal/tls/client.key
```

Then delete the in-cluster `temporal/` manifests from the kustomization. No code change.

---

## Option B — Self-host HA on GKE via the official Helm chart

Free software; you run it. Removes both SPOFs: 4 services at `replicas ≥ 2` + an **HA database**.
Use the official chart (`temporalio/helm-charts`) rather than hand-rolled manifests — getting ringpop
membership / schema setup right by hand is error-prone.

**Database — pick one (do NOT keep the single-pod StatefulSet):**

- **Managed Cloud SQL (recommended):** a regional (HA) Cloud SQL Postgres instance. Gets automated
  backups + PITR + failover for free, and removes the `pg_dump`-to-GCS stopgap. Add a `temporal`
  database to the existing Cloud SQL or provision a dedicated instance; connect via the cloudsql-proxy
  sidecar pattern already used by `worker.deployment.yaml`.
- **In-cluster HA:** the CloudNativePG operator (Postgres cluster with `instances: 3`, synchronous
  replication, scheduled backups to GCS).

**Deploy (sketch — validate against the chart version you pin):**

```bash
helm repo add temporal https://go.temporal.io/helm-charts
helm install temporal temporal/temporal \
  -n nojv-temporal --create-namespace \
  -f infra/gcp/gke/temporal/helm-values.ha.yaml
```

See `helm-values.ha.yaml` in this directory for a starting values file (external Postgres, replicas≥2,
Elasticsearch disabled, resources + node pinning). The workers then point at the chart's
`temporal-frontend` Service; enable TLS via the env vars above if you terminate TLS at the frontend.

> NOT cluster-validated in this repo. Treat the values file as a reviewed starting point and verify the
> cluster forms membership (`tctl cluster health`) before cutting production traffic over.

---

## Option C — Keep single-node + interim mitigations (dev / low-stakes only)

For local dev or a low-stakes deployment where a minutes-long judging pause on a node event is
acceptable, keep the current manifests with the shipped PDB + node pinning + daily `pg_dump` backup.
**Do not call this production-HA.** This is the current default and the SPOF is documented.

---

## Recommendation

- **Single school / limited ops time → Option A (Temporal Cloud Essentials, $100/mo).** Cheapest
  correct path; the connection support is already in the code.
- **Must self-host (cost at scale, data residency) → Option B** with Cloud SQL HA as the database.
- **Dev / pilot → Option C**, with eyes open about the SPOF.
