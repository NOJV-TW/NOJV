# Backup & Restore Runbook

## Overview

This runbook covers the backup posture for every persistence layer in NOJV
production on GCP, plus the restore procedures we execute when those backups
are needed. Use it as the source of truth when:

- enabling backups on a freshly provisioned environment,
- recovering from data loss (corruption, accidental delete, ransomware),
- planning a disaster-recovery exercise.

For everything **other than data loss** (worker outage, Redis failover, DB
HA failover, sandbox runtime down) jump to
[`incident-recovery.md`](./incident-recovery.md) — that runbook handles
availability incidents; this one handles durability incidents.

**Rule of restore: always restore to a new instance, validate, then cut
traffic.** Restoring in place over a corrupt primary loses the only forensic
copy of the corrupt data and risks compounding the problem. Every procedure
below produces a parallel target first.

> **Two deployment shapes.** The shipped CD path (README → "CD To Remote
> Server") is a **self-hosted Docker Compose** rollout on a single Linux
> host — covered in the next section. The GCP sections below
> (Cloud SQL / Memorystore / GCS) document the managed-cloud posture for
> environments deployed that way. Use the section matching how the target
> environment actually runs.

---

## Self-hosted Docker Compose — primary user data

This is the posture for the default self-hosted rollout, where PostgreSQL,
Redis, and MinIO run as Compose services with named Docker volumes
(`postgres_data`, `redis_data`, `minio_data`) on one host.

### Backup posture

- **PostgreSQL** (`postgres` service, database `nojv`, volume
  `postgres_data`) holds every durable record and is the only layer that
  _must_ be backed up. Take a logical dump on a cron schedule (e.g. hourly
  or daily depending on RPO) with `pg_dump`, and copy the dumps off-host
  (another machine, an object store, or cloud bucket) — a backup that lives
  only on the same disk as the data does not survive disk loss.
- **Redis** (`redis_data`) and **MinIO** (`minio_data`) follow the same
  rebuild / re-upload stories as the Memorystore and GCS sections below:
  Redis is derived/ephemeral (rebuilds from Postgres), MinIO holds
  author-provided assets (re-uploadable). Snapshotting their volumes is
  optional; the Postgres dump is the load-bearing backup.

### Taking a dump

A `pg_dump` against the running container is enough; run it from the host
(generic — adjust the service/db/user names if your `.env` overrides
`POSTGRES_USER` / `POSTGRES_DB`). The repo ships a helper script under
`infra/` for this; the manual equivalent is:

```bash
# Compressed custom-format dump (best for selective restore)
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-postgres}" -Fc nojv \
  > "nojv-$(date -u +%Y%m%dT%H%M%SZ).dump"

# then copy the dump off-host (scp / rclone / aws s3 cp ...)
```

Keep a rolling window (e.g. 30 daily dumps) and delete older ones. Verify
a dump is non-empty and restorable, not just that the file exists.

### Restore procedure

Restore into a **fresh** database, validate, then cut over — never restore
in place over a live primary.

1. Stop the app tiers so nothing writes mid-restore:

   ```bash
   docker compose stop web worker
   ```

2. Create a parallel database and restore into it (keeps the original for
   forensics):

   ```bash
   docker compose exec -T postgres \
     createdb -U "${POSTGRES_USER:-postgres}" nojv_restore

   docker compose exec -T postgres \
     pg_restore -U "${POSTGRES_USER:-postgres}" -d nojv_restore --no-owner \
     < nojv-<timestamp>.dump
   ```

3. Validate: connect to `nojv_restore`, spot-check high-volume tables
   (`User`, `Problem`, `Submission`, `ContestParticipation`,
   `ExamParticipation`) and confirm the row that triggered the restore is
   present.

4. Cut over by renaming (the original stays as `nojv_broken_<date>` for
   forensics):

   ```bash
   docker compose exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -c \
     "ALTER DATABASE nojv RENAME TO nojv_broken_$(date -u +%Y%m%d);"
   docker compose exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -c \
     "ALTER DATABASE nojv_restore RENAME TO nojv;"
   ```

5. Restart the app tiers — they reconnect with the unchanged
   `DATABASE_URL` (it points at the `nojv` database name):

   ```bash
   docker compose start web worker
   ```

6. Keep `nojv_broken_<date>` for at least 7 days before dropping it.

If validation fails after cutover, reverse the rename in step 4 and
restart the app tiers.

---

## Cloud SQL (PostgreSQL) — primary user data

### Backup posture

NOJV's PostgreSQL instance holds every durable record: users, problems,
submissions, contest/exam state, plagiarism reports, audit log. Cloud SQL
provides two complementary mechanisms:

- **Automated daily backups** — full snapshots, retained on-disk for 7 days
  by default (we use 30 to cover late-noticed corruption).
- **Point-in-time recovery (PITR)** — write-ahead-log archiving, lets us
  rewind to any second within the retention window.

Both are required. Daily snapshots without PITR means the recovery point
objective is up to 24h of lost writes; PITR without snapshots means restoring
involves replaying weeks of WAL.

### Enabling automated backups

Console path: **SQL → \<instance\> → Edit → Backups**. Tick
"Automate backups", set start window to a low-traffic hour (UTC 17:00 = local
01:00), and set retention to **30 days**.

CLI equivalent:

```bash
gcloud sql instances patch nojv-postgres \
  --backup-start-time=17:00 \
  --retained-backups-count=30 \
  --backup-location=asia-east1
```

`--backup-location` should be a different region from the instance only if
you accept the cross-region cost; same-region backups are sufficient for the
common "delete-by-mistake" failure mode.

### Enabling PITR

Console path: **SQL → \<instance\> → Edit → Backups → Enable point-in-time
recovery**. Retention defaults to 7 days; bump to 14 to give us margin for
weekend incidents.

CLI:

```bash
gcloud sql instances patch nojv-postgres \
  --enable-point-in-time-recovery \
  --retained-transaction-log-days=14
```

This requires the instance to be Enterprise edition (or Enterprise Plus) and
costs extra storage for WAL retention; the marginal cost is far below the
cost of an unrecoverable production database.

### Verifying backups exist

```bash
# List recent automated backups
gcloud sql backups list --instance=nojv-postgres --limit=5

# Confirm PITR is on
gcloud sql instances describe nojv-postgres \
  --format='value(settings.backupConfiguration.pointInTimeRecoveryEnabled)'
```

A monthly calendar reminder to run these two commands is cheap insurance
against config drift.

### Restore procedure

The procedure assumes data corruption or accidental delete in the live
primary, and that you have already paged the on-call channel.

1. **Identify the recovery target time.** A specific timestamp (PITR) for
   user-facing corruption ("a teacher deleted a course at 14:23 UTC"); the
   nearest automated snapshot for catastrophic loss.

2. **Clone to a new instance — never restore in place.**

   ```bash
   # PITR clone (timestamp must be within the retention window)
   gcloud sql instances clone nojv-postgres nojv-postgres-restore \
     --point-in-time='2026-04-29T14:20:00.000Z'

   # Snapshot-based clone (use the BACKUP_ID from `gcloud sql backups list`)
   gcloud sql backups restore <BACKUP_ID> \
     --restore-instance=nojv-postgres-restore \
     --backup-instance=nojv-postgres
   ```

   Provisioning takes 5–20 minutes depending on dataset size.

3. **Validate the clone before cutover.** Connect with the same
   `DATABASE_URL` shape as production but pointed at the clone:

   ```bash
   gcloud sql connect nojv-postgres-restore --user=postgres --database=nojv
   ```

   Spot-check the affected tables (`Course`, `Submission`,
   `ContestParticipation`, `ExamParticipation`, etc.). Run `SELECT count(*)` against each
   high-volume table and compare against expectations. Verify the row that
   triggered the restore is present.

4. **Cut traffic over.** Two options, in order of preference:
   - **Promote the clone**: update Secret Manager `nojv-database-url` to the
     clone's connection string, then restart `web` (Cloud Run revision bump)
     and `worker` (`kubectl rollout restart deploy/nojv-worker`). Apps pick
     up the new secret on the next pod start. Estimated downtime: 30–60s.

   - **Rename**: stop traffic to `web` and `worker`, rename `nojv-postgres`
     → `nojv-postgres-broken-<date>`, rename `nojv-postgres-restore` →
     `nojv-postgres`. No secret update required, but the rename window is a
     hard outage. Use only if you cannot update secrets quickly.

5. **Re-enable backups + PITR on the new primary.** Cloned instances start
   without backup configuration — re-run the gcloud patch commands from the
   "Enabling automated backups" + "Enabling PITR" sections above.

6. **Preserve the broken instance** for at least 7 days for forensics
   before deleting. Tag it with the incident ID.

### Rollback if the restore is wrong

If post-cutover validation fails, repeat step 4 in reverse: update the
secret back to the original instance (or rename back) and restart apps.
This is why we did not delete the original in step 6.

---

## Memorystore (Redis) — caches, scoreboards, pub/sub

### Backup posture

Redis is **not** the durable store for any feature — every Redis key is
either:

- a derived projection (`nojv:scoreboard:*`) that rebuilds from
  `ContestParticipation` / `Submission` rows in Postgres on the next write,
- a transient rate-limit counter,
- a one-off cache snapshot (e.g. `nojv:cache:admin-dashboard`) that
  rebuilds on miss,
- a pub/sub channel (no persistence by design).

(Submission cooldown is enforced with PostgreSQL advisory locks, not Redis,
so it is unaffected by Redis loss.)

For the strict definition of "if Redis vanishes, can the platform continue
operating?", the answer is yes. Submissions still process, auth still works,
verdicts still reach users (via direct response, not SSE) — only real-time
features and rate limits degrade.

That said, **freeze snapshots** (`packages/redis/src/scoreboard.ts`
`freezeScoreboard`) are the one Redis-only data point: during a frozen
contest window, the public-facing snapshot is held in a separate frozen
key and cannot be reconstructed if Redis is wiped mid-contest.

### Enabling persistence

Memorystore for Redis offers **RDB snapshots** (forkless, periodic). Enable
on the Standard tier (Basic tier does not support persistence):

Console path: **Memorystore → Redis → \<instance\> → Edit → Persistence**.
Set "Persistence mode" to **RDB** with a snapshot frequency of **6 hours**
(default; smaller windows do not buy us much given the rebuild story above).

CLI equivalent:

```bash
gcloud redis instances update nojv-redis \
  --region=asia-east1 \
  --persistence-config-mode=RDB \
  --persistence-config-rdb-snapshot-period=6h
```

Memorystore stores RDB snapshots in a Google-managed bucket; we do not get
a download link, but they are used automatically on instance recreate.

### Restore procedure

For most failures, we do **not** restore Redis — we let it rebuild:

1. If the live instance is corrupt or compromised, recreate it (gcloud
   `redis instances create` or console). The new instance starts from the
   last RDB snapshot.

2. Update Secret Manager `nojv-redis-url` if the endpoint changed.

3. Restart `web` + `worker` so they reconnect.

4. Scoreboards rebuild on the next submission verdict per contest. Caches
   refill lazily. Cooldown counters reset (acceptable — affected users get
   one extra free submission window).

The exception is **mid-contest freeze loss**: if the frozen scoreboard
snapshot is gone and the contest is still in its frozen window, manually
re-freeze from the live key by calling `freezeScoreboard` for the contest
ID via a one-shot script. Coordinate with the contest admin first — the
visible state will jump.

---

## GCS object storage — problem images & testcases

### Backup posture

Problem images and (for advanced-mode problems) testcase blobs live in a
GCS bucket fronted by `@nojv/storage`. These are **author-provided assets**;
losing them means problem pages render broken images and TAs need to
re-upload, but no submission data is at risk.

### Enabling cross-region replication

GCS offers **dual-region** and **multi-region** bucket types — pick the
class at bucket-creation time. Single-region buckets cannot be migrated
in place; you must create a new bucket and copy.

For NOJV the recommendation is **dual-region within Asia** (e.g.
`asia-east1` + `asia-northeast1`):

```bash
gcloud storage buckets create gs://nojv-problem-assets \
  --location=asia \
  --default-storage-class=standard \
  --uniform-bucket-level-access
```

Cost roughly doubles per GB stored, but read latency stays low for the
primary user base and the bucket survives a single-region outage.

### Object versioning + lifecycle

Independent of replication, **enable object versioning** so a
"delete-by-mistake" recovers via metadata only:

```bash
gcloud storage buckets update gs://nojv-problem-assets \
  --versioning
```

Pair with a lifecycle rule that deletes non-current versions after 30
days, so versioning does not balloon costs:

```bash
cat > /tmp/lifecycle.json <<EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": { "isLive": false, "daysSinceNoncurrentTime": 30 }
      }
    ]
  }
}
EOF

gcloud storage buckets update gs://nojv-problem-assets \
  --lifecycle-file=/tmp/lifecycle.json
```

### Restore procedure

For an accidental object delete (the common case):

```bash
# List non-current versions
gcloud storage ls -a gs://nojv-problem-assets/problems/<id>/

# Restore a specific generation by copying it back over the live key
gcloud storage cp gs://nojv-problem-assets/problems/<id>/banner.png#1714400000000000 \
  gs://nojv-problem-assets/problems/<id>/banner.png
```

For a region-level outage on a dual-region bucket: nothing to do — reads
automatically serve from the surviving region. For a single-region bucket
that lost its only copy, the data is gone; ask problem authors to
re-upload.

---

## Object storage for sandbox runner artefacts

The sandbox runner writes its outputs to stdout and they are streamed back
through Temporal activity results — there is no persistent storage layer
for runner output. Nothing to back up.

---

## Disaster-recovery exercise cadence

A backup is hypothetical until proven. Run the following at least once per
quarter, ideally during a low-traffic window:

1. Clone Cloud SQL via PITR to a one-hour-old timestamp; spot-check that
   the data matches the live primary minus the last hour. Delete the clone.
2. Recreate Memorystore from RDB snapshot in a staging project; verify it
   boots and accepts connections. Tear down.
3. Pick a random object, soft-delete it via console, recover via
   `gcloud storage cp <object>#<generation>`.

Log the exercise outcome in the engineering journal. If any step fails,
treat as a P1 — the time to discover a broken backup procedure is during
a drill, not during a real incident.

---

## Related Docs

- [Incident Recovery](./incident-recovery.md) — availability incidents (worker, Redis, DB HA failover, sandbox)
- [Reliability Invariants](../operations/RELIABILITY.md) — RPO/RTO targets feeding the retention values above
- [Deployment Guide](../operations/DEPLOYMENT.md) — secret rotation + Cloud Run / GKE deploy procedures
- [Database Schema](../architecture/DATABASE.md) — what each Postgres table holds and which restores affect which features
