# CNPG backups on the Barman Cloud plugin

**Status:** Proposed, awaiting owner review · **Date:** 2026-09-26 · **Touches:** OPS-06, OPS-07, OPS-01, DAT-13 (Temporal state lives in the same cluster)

## Problem

`infra/charts/nojv/templates/postgres-cnpg.yaml` configures backups through the in-tree `spec.backup.barmanObjectStore` and a `ScheduledBackup` with the default method. The [Backup & Restore](../../runbooks/backup-restore.md) recovery Cluster uses `externalClusters[].barmanObjectStore`. CloudNativePG deprecated in-tree Barman Cloud support in 1.26. Its removal was planned for 1.30.0 and is now scheduled for 1.31.0 ([1.30 release notes](https://cloudnative-pg.io/docs/1.30/release_notes/v1.30/)). The replacement is the Barman Cloud CNPG-I plugin ([migration guide](https://cloudnative-pg.io/plugin-barman-cloud/docs/migration/)).

This is the Quality Ledger item under "High availability". It is linked to the open OPS-06 item: off-site backups are not yet activated or restore-drilled in production.

## Versions

| Component           | Repo reference                                                                                                 | Upstream status (checked 2026-09-26)                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CNPG operator       | `cnpg-1.24.0.yaml` in [k8s-single-machine.md §4](../../runbooks/k8s-single-machine.md#4-cluster-prerequisites) | 1.24 is EOL (2025-05-23). Supported: 1.29 (EOL 2026-09-29) and 1.30 (current, 1.30.1) ([supported releases](https://cloudnative-pg.io/docs/devel/supported_releases))                                  |
| Barman Cloud plugin | none                                                                                                           | v0.15.0 (2026-09-03). Requires CNPG ≥ 1.26 and cert-manager, and installs into the operator namespace `cnpg-system` ([installation](https://cloudnative-pg.io/plugin-barman-cloud/docs/installation/)) |
| cert-manager        | none                                                                                                           | Plugin prerequisite for operator↔plugin mTLS                                                                                                                                                           |
| PostgreSQL image    | `ghcr.io/cloudnative-pg/postgresql:18@sha256:…` (`values.yaml`)                                                | PG 18 is supported by CNPG 1.29 and 1.30                                                                                                                                                               |

The runbook's operator version (1.24.0) predates PostgreSQL 18, which production runs, so the live operator version is probably different from the documented one. **Step 0 of any execution is to read the live version.** The plan does not rely on the runbook.

Live state, read-only on 2026-09-26: the operator image was `ghcr.io/cloudnative-pg/cloudnative-pg:1.29.1` (EOL 2026-09-29) and was upgraded in place to 1.30.1 the same day, cert-manager is not installed (no namespace or CRDs), no `ObjectStore` CRD exists, and `Cluster/nojv-pg` has no `spec.backup` (`cnpg_collector_last_available_backup_timestamp` is 0). Production has never taken a base backup.

## Decision summary

1. **Install the plugin and cert-manager as one-time cluster prerequisites, not in the chart.** This matches how the CNPG operator is handled today: it is a documented prerequisite whose CRDs are not vendored, as described in [Deployment Guide](../../operations/DEPLOYMENT.md). It also keeps OPS-01 intact, because the chart still renders only NOJV's namespaced resources. The install is documented in `k8s-single-machine.md` §4 with pinned versions.
2. **The chart renders the `ObjectStore` and points the Cluster at it.** It keeps today's fail-closed validation (`s3://` path, HTTPS endpoint, valid Secret name).
3. **Cut over in a single atomic Cluster change that keeps the same `destinationPath` and `serverName` (`nojv-pg`).** Base backups and WAL taken in-tree stay in the same Barman catalog, so they remain usable for recovery.
4. **Keep a one-release rollback switch.** The switch is removed once the post-cut-over restore drill passes.
5. **The change applies only to single-machine.** GKE uses Cloud SQL (`postgres.mode=cloudsql`), and the CNPG template does not render there.

## Design

### Cluster prerequisites (one-time, operator-owned)

In order, on the production host, each with a pinned version recorded in the runbook:

1. Upgrade the CNPG operator to a supported minor. Use 1.30.x (latest patch) so the version is not EOL within days. First read the release notes for every minor between the live version and 1.30, and diff the manifests. On a single-instance Cluster, an operator upgrade restarts the instance and interrupts every service that depends on Postgres, Temporal included. Run it in a maintenance window.
2. Install cert-manager at a pinned release, then run `cmctl check api` or wait for its three Deployments.
3. Install the plugin: `kubectl apply -f https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/v0.15.0/manifest.yaml`, then `kubectl -n cnpg-system rollout status deploy/barman-cloud`. Upstream also offers a Helm chart (`cnpg/plugin-barman-cloud`). Use the manifest to match how the operator is installed today.

Do not upgrade the operator to 1.31 until the plugin cut-over is accepted, because 1.31 removes the rollback path.

### Chart changes (`postgres-cnpg.yaml`, `values.yaml`)

- A new `ObjectStore` (`barmancloud.cnpg.io/v1`), named `<cluster>-backup`, in the release namespace, with `helm.sh/resource-policy: keep` (OPS-07 spirit). Its fields:
  - `spec.configuration`: `destinationPath`, `endpointURL` and `s3Credentials` (the same Secret keys `ACCESS_KEY_ID` / `ACCESS_SECRET_KEY`), moved from `barmanObjectStore`.
  - `spec.retentionPolicy`: moved from `spec.backup.retentionPolicy`.
  - `spec.instanceSidecarConfiguration.resources`: explicit requests and limits. The plugin runs as a sidecar in the Postgres Pod, and single-machine node budgeting assumes that Postgres request equals limit ([Deployment: capacity](../../operations/DEPLOYMENT.md#capacity)).
- Cluster: drop `spec.backup` and add:
  ```yaml
  plugins:
    - name: barman-cloud.cloudnative-pg.io
      isWALArchiver: true
      parameters:
        barmanObjectName: <cluster>-backup
        serverName: <cluster>
  ```
  Set `serverName` explicitly so a later rename or a restore cluster cannot silently fork the catalog.
- ScheduledBackup: add `method: plugin` and `pluginConfiguration.name: barman-cloud.cloudnative-pg.io`. The schedule (`0 0 3 * * *`) and `backupOwnerReference: self` are unchanged.
- Temporary value `postgres.cnpg.backup.method: plugin | barmanObjectStore` (default `plugin`). It renders either the old block or the new resources and is removed in the follow-up PR after the drill.
- `values-gke.yaml` keeps its dormant `postgres.cnpg.backup` block. It is not rendered with `mode: cloudsql` and is out of scope.

### Mapping

| Today (in-tree)                                  | Plugin                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec.backup.barmanObjectStore.destinationPath`  | `ObjectStore.spec.configuration.destinationPath` (same value)                                                                                         |
| `…endpointURL`, `…s3Credentials`                 | `ObjectStore.spec.configuration.*` (same values)                                                                                                      |
| `spec.backup.retentionPolicy: 30d`               | `ObjectStore.spec.retentionPolicy: 30d`                                                                                                               |
| WAL archiving (implicit when the store is set)   | `Cluster.spec.plugins[].isWALArchiver: true`                                                                                                          |
| `ScheduledBackup` (default method)               | `method: plugin` + `pluginConfiguration`                                                                                                              |
| `kubectl cnpg backup nojv-pg`                    | `kubectl cnpg backup nojv-pg --method plugin --plugin-name barman-cloud.cloudnative-pg.io`, or a `Backup` CR with the same fields                     |
| `cnpg_collector_last_available_backup_timestamp` | `barman_cloud_cloudnative_pg_io_last_available_backup_timestamp` ([observability](https://cloudnative-pg.io/plugin-barman-cloud/docs/observability/)) |

`infra/grafana/alerts/slo-alerts.json` (`nojv-pg-backup-stale`) must switch to the new metric in the same PR. Otherwise the alert goes silent, which reads as healthy.

### Recovery procedure (`backup-restore.md`)

The recovery Cluster changes to:

```yaml
spec:
  bootstrap:
    recovery:
      source: nojv-pg-origin
      recoveryTarget:
        targetTime: "<RFC3339>"
  externalClusters:
    - name: nojv-pg-origin
      plugin:
        name: barman-cloud.cloudnative-pg.io
        parameters:
          barmanObjectName: nojv-pg-backup
          serverName: nojv-pg
```

If the restored Cluster enables its own archiving, it must use a different `serverName` (for example `nojv-pg-restore`). Otherwise it would write into the origin's WAL timeline, and CNPG's empty-archive check would refuse it. The runbook step "cover the new primary with backups" becomes "add a `plugins` entry with `serverName: <new cluster>`".

### GKE vs single-machine

|                   | Single-machine                                         | GKE                                                                                  |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Postgres          | CNPG `nojv-pg`, one instance, app + Temporal databases | Cloud SQL (`postgres.mode=cloudsql`); CNPG template not rendered                     |
| This spec applies | Yes                                                    | No. Backups are Cloud SQL automated backups + PITR + GCS export (`setup-backups.sh`) |
| Plugin install    | Required (with cert-manager, operator ≥ 1.26)          | Only if GKE ever switches to `mode: cnpg`; the same prerequisites then apply         |

## Cut-over sequence (no WAL gap)

Preconditions: operator ≥ 1.26, cert-manager and plugin Ready, backups already active in-tree and restore-drilled once (OPS-06 plan (a)). If production has **no** active archive yet, skip steps 1–2 and 6's continuity check: activate directly on the plugin and run the OPS-06 drill on it.

1. Record the in-tree state: `kubectl cnpg status nojv-pg -n nojv` (continuous archiving OK, last archived WAL, first recoverability point) and take an on-demand in-tree backup. Note its completion time as `T0`.
2. Write a marker row outside application tables, in a scratch table in a scratch schema that is dropped after the drill. Note its time as `T1`.
3. Release the chart change (Flux) in a low-traffic window. The Cluster update removes `spec.backup` and adds `spec.plugins` in one object change. The ScheduledBackup and ObjectStore are applied in the same release. CNPG restarts the single instance to inject the sidecar.
4. Force a segment switch: `SELECT pg_switch_wal();` as superuser in `nojv-pg-1`.
5. Confirm that the Cluster condition `ContinuousArchiving=True` and that the switched segment appears under `<destinationPath>/nojv-pg/wals/`. Confirm that `barman_cloud_cloudnative_pg_io_*` metrics are scraped.
6. Take an on-demand plugin backup, and wait for `Backup` phase `completed` with `method: plugin`.
7. Drill: restore into `nojv-pg-restore` with `targetTime` just after `T1`. This replays from the in-tree base backup `T0` through WAL archived by both implementations. Confirm the marker row, then run the [validation queries](../../runbooks/backup-restore.md#restore-cnpg-pitr-into-a-new-cluster). Delete the restore Cluster and the marker schema.
8. Update `backup-restore.md`, `k8s-single-machine.md` §4, `DEPLOYMENT.md` prerequisites, `infra/charts/nojv/README.md` and OPS-06 (the plugin is the mechanism; `Rejected:` in-tree `barmanObjectStore`, deprecated upstream). Remove the rollback switch in a follow-up PR.

## Rollback

- **Before step 3:** uninstalling the plugin and cert-manager is safe, because nothing references them.
- **After step 3:** set `postgres.cnpg.backup.method: barmanObjectStore` and release. This is another single atomic Cluster change and another instance restart. Both implementations write the same Barman layout to the same path and `serverName`, so the catalog stays continuous. Verify with `pg_switch_wal()` and `ContinuousArchiving=True`.
- **Operator upgrade failure:** CNPG operator downgrades are not supported. Mitigation: take a fresh verified backup before the upgrade and restore to a new Cluster (OPS-05: restore forward, never roll back in place).

## Verification and tests

- `tests/unit/infra/backup-fail-closed.test.ts`: the production overlay renders `kind: ObjectStore` with the fixture path, the Cluster has `isWALArchiver: true` and no `barmanObjectStore`, and the ScheduledBackup has `method: plugin`. Missing inputs still fail rendering. The `barmanObjectStore` switch renders the old shape.
- `pnpm lint:helm` for both overlays. The rendered `ObjectStore` validates against the plugin CRD (kubeconform with the v0.15.0 CRD schema).
- Production evidence goes to the Quality Ledger: operator, plugin and cert-manager versions; the step 5 WAL segment name; the step 6 backup name; and the step 7 drill result with the marker check.

## Open questions for the owner

1. Answered 2026-09-26: 1.29.1, no cert-manager (see Current state). The operator is already ≥ 1.26, so question 3's recommendation is to activate directly on the plugin.
2. Which operator target: 1.30.x now (recommended), or 1.29.x, which reaches EOL on 2026-09-29?
3. Ordering against OPS-06: activate in-tree first and migrate later (fastest path to a drilled backup), or activate directly on the plugin after the operator upgrade (a single migration, but backups wait for the upgrade window)? Recommendation: if the live operator is already ≥ 1.26, activate on the plugin directly. Otherwise activate in-tree now.
4. Can the operator upgrade (a Postgres restart, about 1–3 minutes of full downtime on one instance) and the cut-over (a second restart) share one maintenance window, or do they need separate windows?
5. Should cert-manager be installed with the upstream static manifest or with Helm? Should its version live in the runbook only, or also in a repo-pinned file checked by a test?
6. What sidecar resource budget should the plugin get? It counts against the 8 vCPU / 16 GiB node alongside the sandbox quota.
