# Backup & Restore

Procedures to enable, verify and restore backups of every durable layer, for
data-loss incidents and restore drills. Availability incidents go to
[Incident Recovery](incident-recovery.md); what each store holds is in
[Reliability: source of truth](../operations/RELIABILITY.md#source-of-truth).

## Key code

- `infra/charts/nojv/templates/postgres-cnpg.yaml` (CNPG `Cluster`, `ScheduledBackup`, metrics Service)
- `infra/charts/nojv/templates/minio-backup.cronjob.yaml` (rclone mirror), `infra/charts/nojv/templates/minio.yaml`, `infra/charts/nojv/templates/objstore.yaml`
- `infra/charts/nojv/values-single-machine.yaml` (production backup values), `infra/charts/nojv/values-gke.yaml`
- `infra/gcp/scripts/setup-backups.sh`, `infra/gcp/scripts/export-postgres-to-gcs.sh` (GKE Cloud SQL)
- `infra/gcp/gke/temporal/helm-values.single-machine.yaml` (Temporal databases on the CNPG cluster)
- `packages/storage/src/keys.ts` (object key layout)

## Rules

- Restore to a new target, validate, then cut over. Keep the original for at least 7 days for forensics and rollback.
- Restore object storage together with PostgreSQL, to a point at or after the database restore target. Objects ahead of the database are harmless orphans; a database row whose object is missing breaks judging and rejudging of that submission (OPS-06).
- A backup counts as enabled only after a restore drill succeeded (OPS-06).
- Never `helm uninstall` or enable Flux prune without confirming volumes are `Retain` and backed up (OPS-07).

## What to back up

| Layer                        | Holds                                                                                                                                                  | Production backup                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| PostgreSQL (CNPG `nojv-pg`)  | All app data; on single-machine also Temporal's `temporal` and `temporal_visibility` databases                                                         | barman-cloud base backups + WAL archiving to off-host S3/R2 (PITR)           |
| Object storage (MinIO / GCS) | Only copy of `submissions/<id>/source-generations/`, judge snapshots and stage results, verdict detail, testcases, workspace files, validators, images | Single-machine: `rclone copy` CronJob to off-host R2. GKE: bucket versioning |
| PostgreSQL (GKE Cloud SQL)   | All app data                                                                                                                                           | Automated backups (30 days) + PITR (14 days) + daily export to GCS           |
| Redis                        | Derived state only (DAT-10)                                                                                                                            | None needed                                                                  |
| `nojv-runtime-secrets`       | `BETTER_AUTH_SECRET` (also encrypts exam credentials), DB/S3/SMTP credentials                                                                          | Keep an off-host copy; not covered by any automated backup                   |

## Single-machine: PostgreSQL (CNPG)

### Enable CNPG backups

`values-single-machine.yaml` sets `postgres.cnpg.backup.enabled: true` and the chart refuses to render until the destination is concrete (`s3://` path, HTTPS endpoint, valid Secret name).

1. Create the credentials Secret:

   ```bash
   kubectl -n nojv create secret generic nojv-pg-barman \
     --from-literal=ACCESS_KEY_ID=<access-key> \
     --from-literal=ACCESS_SECRET_KEY=<secret-key>
   ```

2. Supply the values through the cluster-owned production values:

   ```yaml
   postgres:
     cnpg:
       backup:
         destinationPath: s3://nojv-db-backups/nojv-pg
         endpointURL: https://<account>.r2.cloudflarestorage.com
         s3CredentialsSecret: nojv-pg-barman
         retentionPolicy: "30d" # default
         schedule: "0 0 3 * * *" # default, daily 03:00 UTC
   ```

3. Release, then verify:

   ```bash
   kubectl cnpg status nojv-pg -n nojv   # continuous archiving OK, last backup time
   kubectl cnpg backup nojv-pg -n nojv   # on-demand base backup
   kubectl get backups -n nojv           # phase completed
   ```

`nojv-pg-backup-stale` fires when the last base backup is older than 26h.

### Restore CNPG (PITR into a new Cluster)

1. Choose the target: a timestamp just before the bad write, or no target for the latest archived WAL.
2. Apply a recovery `Cluster` reading the same object store:

   ```yaml
   apiVersion: postgresql.cnpg.io/v1
   kind: Cluster
   metadata:
     name: nojv-pg-restore
     namespace: nojv
   spec:
     instances: 1
     bootstrap:
       recovery:
         source: nojv-pg-barman
         recoveryTarget:
           targetTime: "<RFC3339 timestamp>"
     externalClusters:
       - name: nojv-pg-barman
         barmanObjectStore:
           destinationPath: s3://nojv-db-backups/nojv-pg
           endpointURL: https://<account>.r2.cloudflarestorage.com
           s3Credentials:
             accessKeyId:
               name: nojv-pg-barman
               key: ACCESS_KEY_ID
             secretAccessKey:
               name: nojv-pg-barman
               key: ACCESS_SECRET_KEY
   ```

   ```bash
   kubectl apply -f nojv-pg-restore.yaml
   kubectl cnpg status nojv-pg-restore -n nojv
   ```

3. Validate through `nojv-pg-restore-rw`: `SELECT count(*)` on `User`, `Problem`, `Submission`, `Participation`, `JudgeExecution`, and confirm the row that triggered the restore is present (or absent, for a rewind past a bad delete).
4. Restore object storage to the same or a later point ([Restore object storage](#restore-object-storage)).
5. Cut over: set `DATABASE_URL` in `nojv-runtime-secrets` to `nojv-pg-restore-rw.nojv.svc.cluster.local`, then:

   ```bash
   kubectl -n nojv rollout restart deploy/nojv-web deploy/nojv-worker deploy/nojv-worker-platform
   ```

6. Temporal's databases were restored to the same instant. Re-point Temporal's persistence `connectAddr` (default and visibility stores) to `nojv-pg-restore-rw` with a `helm upgrade` of the `temporal` release, or keep it on the original cluster if only app data was damaged.
7. Cover the new primary with backups (a `ScheduledBackup` for `nojv-pg-restore`, or promote it through the chart values).
8. Verify: sign-in, a submission reaches a verdict, `kubectl cnpg status` shows archiving. To roll back, point `DATABASE_URL` back to `nojv-pg-rw` and restart.

## Single-machine: object storage

The `storage.active` store (`nojv-minio` in production; `nojv-objstore`, the Versity gateway, after the cut-over) holds `nojv` and `nojv-registry`. Versity keeps content types and checksums in `user.*` xattrs, so a file-level copy of its PVC must preserve xattrs (`rsync -X`); the S3 mirror below is unaffected.

### Enable the off-host mirror

`values-single-machine.yaml` enables the `nojv-minio-backup` CronJob and fails to render without a destination. It runs `rclone copy --metadata` (never `sync`, so deletions are kept in the mirror; default schedule `0 4 * * *`) from the `storage.active` store for `nojv` and `nojv-registry`, into `<destinationBucket>/nojv/` and `<destinationBucket>/nojv-registry/`. The target is Cloudflare R2's free tier (10 GB-month; both buckets together are about 2 GB).

1. In the Cloudflare dashboard, enable R2 for the account, create a bucket (for example `nojv-object-mirror`, location automatic), and create an R2 API token with **Object Read & Write** scoped to that bucket. Note the access key ID, the secret access key and the S3 endpoint `https://<account-id>.r2.cloudflarestorage.com`. The job never creates the bucket, so the bucket-scoped token is enough.
2. Create the Secret (may reuse the `nojv-pg-barman` credentials for the same account):

   ```bash
   kubectl -n nojv create secret generic nojv-minio-mirror \
     --from-literal=ACCESS_KEY_ID=<access-key> \
     --from-literal=ACCESS_SECRET_KEY=<secret-key>
   ```

3. In the private `nojv-production-values` Secret set `storage.minio.backup.enabled: true`, `destinationEndpoint` (HTTPS), `destinationBucket` and `credentialsSecret`; `destinationRegion: auto` and `destinationProvider: Cloudflare` are the defaults. Release.
4. Verify the first run:

   ```bash
   kubectl -n nojv get cronjob nojv-minio-backup
   kubectl -n nojv create job --from=cronjob/nojv-minio-backup nojv-minio-backup-manual
   kubectl -n nojv logs job/nojv-minio-backup-manual
   ```

   Then compare sizes from any machine with rclone and the same credentials: `rclone size r2:<mirror-bucket>/nojv` against `rclone size <store>:nojv` through a port-forward to the store's Service.

### Restore object storage

1. Bring up a clean store: the `storage.active` Deployment on a new or emptied PVC. For Versity the bucket hook recreates `nojv` and `nojv-registry` on the next release; otherwise `rclone mkdir` them.
2. Port-forward the store (`kubectl -n nojv port-forward svc/<store> 9000:9000`) and copy back from the off-host copy:

   ```bash
   export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
     RCLONE_CONFIG_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
     RCLONE_CONFIG_R2_ACCESS_KEY_ID=<key> RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=<secret>
   export RCLONE_CONFIG_DST_TYPE=s3 RCLONE_CONFIG_DST_PROVIDER=Other \
     RCLONE_CONFIG_DST_ENDPOINT=http://127.0.0.1:9000 \
     RCLONE_CONFIG_DST_ACCESS_KEY_ID=<s3-access-key> RCLONE_CONFIG_DST_SECRET_ACCESS_KEY=<s3-secret-key>
   rclone copy --metadata r2:<mirror-bucket>/nojv dst:nojv
   rclone copy --metadata r2:<mirror-bucket>/nojv-registry dst:nojv-registry
   rclone check r2:<mirror-bucket>/nojv dst:nojv
   ```

3. Validate that recent `submissions/<id>/source-generations/` manifests resolve, that one affected submission rejudges to a real verdict, and that a teacher image still pulls from the registry.

## GKE: Cloud SQL

### Enable Cloud SQL backups

Run once per environment (idempotent): automated backups at 17:00 UTC with 30 retained, PITR with 14 days of logs, and a versioned GCS bucket (noncurrent versions deleted after 30 days, live objects after 90).

```bash
PROJECT_ID=<project> SQL_INSTANCE=<instance> REGION=<region> BACKUP_BUCKET=<bucket> \
  infra/gcp/scripts/setup-backups.sh
```

Schedule `infra/gcp/scripts/export-postgres-to-gcs.sh` daily (Cloud Scheduler) for cold exports to `gs://<bucket>/daily/YYYY/MM/DD/`.

Verify:

```bash
gcloud sql backups list --instance=<instance> --limit=5
gcloud sql instances describe <instance> \
  --format='value(settings.backupConfiguration.pointInTimeRecoveryEnabled)'
```

### Restore Cloud SQL

1. Clone to a new instance:

   ```bash
   gcloud sql instances clone <instance> <instance>-restore --point-in-time='<RFC3339 timestamp>'
   # or from a snapshot:
   gcloud sql backups restore <BACKUP_ID> --restore-instance=<instance>-restore --backup-instance=<instance>
   ```

2. Validate with `gcloud sql connect <instance>-restore --user=postgres --database=nojv` using the same checks as the CNPG restore.
3. Set `postgres.cloudsql.instanceConnectionName` to the clone (`DATABASE_URL` stays on the proxy at `127.0.0.1:5432`), release, and restart web and both workers.
4. Re-run `setup-backups.sh` against the new instance; clones start without backup configuration.
5. Keep the original instance for at least 7 days.

## GKE: object storage

Enable versioning with a noncurrent-version lifecycle rule on the application bucket:

```bash
gcloud storage buckets update gs://<bucket> --versioning
gcloud storage buckets update gs://<bucket> --lifecycle-file=<rule deleting noncurrent versions after 30 days>
```

Restore an object by copying a noncurrent generation over the live key:

```bash
gcloud storage ls -a gs://<bucket>/<key>
gcloud storage cp 'gs://<bucket>/<key>#<generation>' gs://<bucket>/<key>
```

A dual-region or multi-region location must be chosen when the bucket is created; a single-region bucket cannot be converted in place.

## Redis

Nothing to restore. In-cluster Redis runs with AOF on a PVC; if it is lost, recreate it and restart web and workers. Caches refill, rate-limit windows reset and users re-verify step-up.

## Local development (Docker Compose)

Compose volumes (`postgres_data`, `redis_data`, `minio_data`) hold development data only.

Dump:

```bash
docker compose exec -T postgres pg_dump -U postgres -Fc nojv > nojv-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Restore into a parallel database, then swap names:

1. Stop `pnpm dev`.
2. Restore:

   ```bash
   docker compose exec -T postgres createdb -U postgres nojv_restore
   docker compose exec -T postgres pg_restore -U postgres -d nojv_restore --no-owner --exit-on-error < nojv-<timestamp>.dump
   ```

3. Swap:

   ```bash
   docker compose exec -T postgres psql -U postgres -c "ALTER DATABASE nojv RENAME TO nojv_broken;"
   docker compose exec -T postgres psql -U postgres -c "ALTER DATABASE nojv_restore RENAME TO nojv;"
   ```

4. Start `pnpm dev`. Reverse the renames to roll back.

### Custom-format archives from before `20260907000002_storage_pointer_map_restore`

Those archives keep an unqualified `storage_pointer_valid` call and can fail during `COPY "Testcase"`. On the isolated restore target:

1. `pg_restore --section=pre-data --exit-on-error …`
2. `ALTER FUNCTION public.storage_pointer_map_valid(jsonb) SET search_path = public;`
3. `pg_restore --section=data --exit-on-error …`, then `--section=post-data`.
4. `ALTER FUNCTION public.storage_pointer_map_valid(jsonb) RESET search_path;`
5. Apply the forward migrations before starting any application writer.

## Restore drill

Run at least quarterly in a low-traffic window, and before relying on a newly configured destination:

1. PITR the CNPG cluster (or clone Cloud SQL) to one hour ago in a new Cluster/instance; validate counts against production minus the last hour; delete it.
2. Copy the off-host object mirror into a scratch bucket and read back a recent submission manifest.
3. On GKE, restore one noncurrent object generation.

Record the outcome in the incident log. A failed drill is a P1.
