# Temporal: production HA options

## The problem this solves

A **single `temporalio/auto-setup` replica** backed by a **single-pod Postgres** is the historical
availability gap: any node drain / GKE upgrade / zone loss stops _all_ judging, exam auto-close, and
contest lifecycle until the pod reschedules; PVC loss permanently destroys every in-flight timer. The
old interim mitigations (a single-replica StatefulSet plus PodDisruptionBudget, node pinning, and a
daily `pg_dump` to GCS) only narrowed the window and have since been retired — Temporal is no longer
vendored as manifests in this repo.

Self-hosting via the official chart now works on **both targets** (Option B): `helm-values.ha.yaml`
(replicas ≥ 2 per role, external HA Postgres) and `helm-values.single-machine.yaml` (1 pod per role,
in-cluster CNPG). The single-machine file still splits each role into its own pod — but with one pod per
role it is **not** node-failure HA. Production removes the SPOF with **Temporal Cloud (Option A)** or the
**HA self-host file (Option B)** backed by a highly-available database.

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

Then don't install the in-cluster Temporal chart; point the workers' `TEMPORAL_ADDRESS` at Temporal
Cloud (set `temporal.address` in the `nojv` chart values). No code change.

---

## Option B — Self-host via the official Helm chart (BOTH targets)

Free software; you run it. Use the official chart (`temporalio/helm-charts`, pinned to `temporal/temporal`
**1.4.x**) rather than hand-rolled manifests — getting ringpop membership / schema setup right by hand is
error-prone. Each server role (frontend / history / matching / worker) is its **own Deployment** = separate
pods. Two values files in this directory cover both targets:

| File                              | `server.replicaCount` | Backing store                           | Node-failure HA?                       |
| --------------------------------- | --------------------- | --------------------------------------- | -------------------------------------- |
| `helm-values.ha.yaml`             | `2` per role          | external HA Postgres (Cloud SQL / CNPG) | **Yes** (needs ≥2 nodes)               |
| `helm-values.single-machine.yaml` | `1` per role          | in-cluster CNPG `nojv-pg-rw`            | **No** — separate pods, but 1 pod/role |

**Single-node = separate pods, NOT node-failure HA.** The single-machine file still splits every role into
its own Deployment (so you can scale a role independently and roll it without the others), but with one pod
per role a node drain/loss pauses that role until the pod reschedules. Real node-failure HA needs
`helm-values.ha.yaml` (replicas ≥ 2) **and ≥ 2 nodes**.

**Database — pick one (do NOT keep a single-pod Postgres for HA):**

- **Managed Cloud SQL (HA file, recommended for prod):** a regional (HA) Cloud SQL Postgres instance.
  Automated backups + PITR + failover for free. Provision `temporal` + `temporal_visibility` databases and
  connect via the cloudsql-proxy sidecar (`connectAddr: cloudsql-proxy...:5432` in the values) — the same
  pattern the `nojv` chart's worker Deployments use via `cloudsqlProxy.enabled`.
- **In-cluster CNPG (single-machine file):** the same CloudNativePG instance the `nojv` chart provisions
  (`<release>-pg-rw`, default `nojv-pg-rw`). For HA, raise `postgres.cnpg.instances` to 3 (synchronous
  replication + scheduled backups).

**One-time DB bootstrap** (both files set `createDatabase: false` — the chart's schema job runs as the
`temporal` role, which is not a Postgres superuser, so create the databases/role first):

```sql
CREATE ROLE temporal WITH LOGIN PASSWORD '...';
CREATE DATABASE temporal OWNER temporal;
CREATE DATABASE temporal_visibility OWNER temporal;
```

Store that password in a Secret named `temporal-postgres-secret` (key `password`) — both values files
reference it via `existingSecret`. The chart's admintools schema job then runs `manageSchema: true`
against both databases.

**Deploy (either target):**

```bash
helm repo add temporal https://go.temporal.io/helm-charts
# HA (GKE, external Postgres):
helm install temporal temporal/temporal \
  -n nojv-temporal --create-namespace \
  -f infra/gcp/gke/temporal/helm-values.ha.yaml
# Single-node (separate pods, in-cluster CNPG):
helm install temporal temporal/temporal \
  -n nojv-temporal --create-namespace \
  -f infra/gcp/gke/temporal/helm-values.single-machine.yaml
```

Both files disable the Temporal Web UI (`web.enabled: false`) and use SQL visibility (no Elasticsearch).
The `nojv` workers point at the chart's `temporal-frontend` Service; enable TLS via the env vars above if
you terminate TLS at the frontend.

> NOT cluster-validated in this repo (renders are verified with `helm template`). Treat the values files as
> reviewed starting points and verify the cluster forms membership (`tctl cluster health`) before cutting
> production traffic over.

---

## Option C — Single-replica auto-setup (dev only)

For local dev where a minutes-long judging pause on a node event is acceptable, the chart's default
single-replica `auto-setup` path also works. **Do not call this production-HA.** Prefer
`helm-values.single-machine.yaml` (Option B) even for a single node — it gives you the separate-pods split
and SQL persistence with one pod per role.

---

## Recommendation

- **Single school / limited ops time → Option A (Temporal Cloud Essentials, $100/mo).** Cheapest
  correct path; the connection support is already in the code.
- **Must self-host (cost at scale, data residency) → Option B `helm-values.ha.yaml`** with Cloud SQL HA
  (or CNPG `instances: 3`) as the database, on ≥ 2 nodes.
- **Single-node self-host (pilot / on-prem one box) → Option B `helm-values.single-machine.yaml`** —
  separate pods per role, in-cluster CNPG, eyes open that one pod per role is not node-failure HA.
