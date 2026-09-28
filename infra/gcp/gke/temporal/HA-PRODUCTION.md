# Temporal Server

Temporal is self-hosted with the official `temporal/temporal` Helm chart (v1.4.x)
in namespace `nojv-temporal` (OPS-09). The `nojv` chart's clients target
`temporal-frontend.nojv-temporal.svc.cluster.local:7233` (`temporal.address`).
All durable Temporal state is in Postgres; the server roles are stateless.

## Key code

| File                                        | Target                                                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `helm-values.ha.yaml`                       | GKE reference, unvalidated: `replicaCount: 2` per role, PDB `minAvailable: 1`, Cloud SQL via `cloudsql-proxy.nojv-temporal.svc.cluster.local:5432` |
| `infra/flux/temporal-values.yaml`           | Production single node, applied by Flux: `replicaCount: 1` per role on `nojv-role: sandbox`, CNPG `nojv-pg-rw.nojv.svc.cluster.local:5432`         |
| `secret.example.yaml`                       | Placeholder store-credentials Secret                                                                                                               |
| `infra/docker/temporal-dynamic-config.yaml` | Local compose dynamic config; both values files carry the same `server.dynamicConfig`                                                              |

Both values files use the `postgres12` SQL plugin for the `temporal` and
`temporal_visibility` databases (SQL visibility, no Elasticsearch), set
`createDatabase: false` and `manageSchema: true`, and disable the Temporal Web
UI. Each role (frontend, history, matching, worker) is its own Deployment. One
pod per role is not node-failure HA; HA needs `helm-values.ha.yaml`, at least two
nodes and an HA database (regional Cloud SQL, or CNPG with
`postgres.cnpg.instances: 3`).

## Database bootstrap

The schema job runs as the non-superuser `temporal` role, so create the role and
databases first:

```sql
CREATE ROLE temporal WITH LOGIN PASSWORD '...';
CREATE DATABASE temporal OWNER temporal;
CREATE DATABASE temporal_visibility OWNER temporal;
```

Store the password in Secret `temporal-postgres-secret` in `nojv-temporal`
under key `password` (both values files read `existingSecret` /
`secretKey: password`).

## Dynamic config

Both values files set `server.dynamicConfig` to match
`infra/docker/temporal-dynamic-config.yaml`: `matching.enableFairness`,
`matching.useNewMatcher` (priority matching), and one read and one write
partition for `judge`, `judge-state` and `platform`. Change all three files
together. Why: [Judge Queue](../../../../docs/runbooks/judge-queue.md).

## Install

```bash
helm repo add temporal https://go.temporal.io/helm-charts
# GKE (reference only; the single node is Flux-managed, see the single-machine runbook)
helm upgrade --install temporal temporal/temporal --version 1.7.0 -n nojv-temporal --create-namespace \
  -f infra/gcp/gke/temporal/helm-values.ha.yaml
```

The single-machine release is reconciled by Flux from `infra/flux/temporal.yaml`
and `infra/flux/temporal-values.yaml`; changes go through those files, never
`helm upgrade`, `--set` or `--reuse-values`. The GKE file is an
unvalidated reference: it has never run on a cluster, and it is HA only with a
regional Cloud SQL instance and a Cloud SQL Auth Proxy Deployment and Service in
`nojv-temporal`, neither of which the repository provisions. Check membership
with `temporal operator cluster health` before sending traffic to it.

## Client TLS

The in-cluster frontend is plaintext. Clients support TLS through
`TEMPORAL_TLS`, `TEMPORAL_API_KEY`, and mTLS through
`TEMPORAL_CLIENT_CERT_PATH` / `TEMPORAL_CLIENT_KEY_PATH` /
`TEMPORAL_SERVER_NAME` (`packages/temporal/src/connection-config.ts`); the
`nojv` chart does not wire them.

`temporalio/auto-setup` (local compose) is for development only; never run it
multi-replica or in production.
