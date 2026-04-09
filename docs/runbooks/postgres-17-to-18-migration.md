# PostgreSQL 17 → 18 Migration (production host)

One-time procedure to upgrade the production `postgres` container from `postgres:17-alpine` to `postgres:18-alpine` without losing application or Temporal data.

## Why this runbook exists

Production runs `docker compose up -d` against a persistent `postgres_data` named volume. The pg 18 binary cannot read a data directory written by pg 17 — `docker compose up postgres` will fail its healthcheck and the deploy workflow will abort. A previous attempt (commit `94ced45`) was reverted in `7cb8455` for exactly this reason.

The migration must run **on the production host before the pg 18 container image is rolled out**. After this runbook completes successfully, the next deploy workflow run will pick up the pg 18 image cleanly.

The same `postgres` instance hosts both the application database (`nojv`) and Temporal's namespace databases. `pg_dumpall` captures both in one shot — do not use a per-database `pg_dump`.

## Pre-flight on the prod host

```bash
ssh deploy@prod-host
cd /path/to/NOJV    # repo checkout the deploy workflow uses

# 1. Confirm current image is still pg 17 and the stack is healthy
docker compose ps postgres
docker compose exec postgres psql -U postgres -c 'SELECT version();'

# 2. Confirm volume name (used in step 6 below)
docker volume ls | grep postgres_data

# 3. Make sure the deploy workflow is paused / nothing will redeploy mid-migration
#    (e.g. disable scheduled triggers, announce maintenance window)

# 4. Take a regular filesystem snapshot of the volume as a safety net,
#    if your host supports it (LVM / ZFS / cloud disk snapshot).
```

Estimate downtime: a few minutes for a small DB, longer if `nojv` has grown. Plan a maintenance window that covers dump + restore + smoke test.

## Migration procedure

```bash
# 0. Choose a backup directory on the host
BACKUP_DIR=/var/backups/nojv
mkdir -p "$BACKUP_DIR"

# 1. Stop application traffic — keep postgres running so we can dump it
docker compose --profile prod stop web worker

# 2. Dump the entire cluster (app DB + Temporal DBs + roles)
docker compose exec -T postgres \
  pg_dumpall -U postgres --clean --if-exists \
  > "$BACKUP_DIR/pg17-final-$(date +%Y%m%d-%H%M%S).sql"

# Sanity check the dump
DUMP_FILE=$(ls -t "$BACKUP_DIR"/pg17-final-*.sql | head -1)
ls -lh "$DUMP_FILE"
head -20 "$DUMP_FILE"
grep -c '^CREATE DATABASE' "$DUMP_FILE"   # expect at least 2: nojv and temporal

# 3. Stop all infra services that depend on postgres
docker compose stop temporal temporal-ui postgres

# 4. Pull the latest commit (the one that bumps to postgres:18-alpine)
git fetch origin
git checkout main
git pull --ff-only

# 5. Verify the image is now pinned to pg 18
grep 'postgres:' docker-compose.yml

# 6. Drop the pg 17 volume — irreversible without the dump file from step 2
docker volume rm $(docker volume ls -q | grep postgres_data)

# 7. Bring up empty pg 18
docker compose up -d --wait postgres

# 8. Restore from the dump
docker compose exec -T postgres psql -U postgres -d postgres < "$DUMP_FILE"

# 9. Spot check the data
docker compose exec postgres psql -U postgres -c '\l'
docker compose exec postgres psql -U postgres -d nojv -c 'SELECT count(*) FROM "User";'
docker compose exec postgres psql -U postgres -d temporal -c '\dt'

# 10. Bring up everything else (Temporal first so it can verify its schema)
docker compose up -d --wait temporal temporal-ui
docker compose logs --tail=100 temporal | grep -iE 'error|fatal' || true

# 11. Run any pending Prisma migrations against pg 18
docker compose --profile deploy run --rm migrator

# 12. Restart application
docker compose --profile prod up -d --wait --remove-orphans web worker
```

## Post-migration verification

```bash
# Application reachable
curl -sf http://localhost:3000 >/dev/null && echo "web: ok"

# DB version is 18
docker compose exec postgres psql -U postgres -c 'SELECT version();'

# Temporal cluster healthy and namespaces intact
docker compose exec temporal tctl --address temporal:7233 cluster health
docker compose exec temporal tctl --address temporal:7233 namespace list

# Worker connected
docker compose logs --tail=50 worker | grep -iE 'connected|ready'
```

Run a real submission end-to-end through the web UI to confirm the judge pipeline still flows: web → Temporal workflow → sandbox → DB write → web.

## Rollback

Rollback only works if step 6 (volume drop) has not yet been performed _or_ if you still have the dump file from step 2.

```bash
# Stop everything
docker compose --profile prod stop web worker
docker compose stop temporal temporal-ui postgres

# Drop the (now pg 18) volume
docker volume rm $(docker volume ls -q | grep postgres_data)

# Revert the repo to pg 17
git revert --no-edit <pg-18-bump-commit-sha>
# OR temporarily edit docker-compose.yml back to postgres:17-alpine

# Bring pg 17 back up
docker compose up -d --wait postgres

# Restore the same dump file (pg_dumpall output is portable across versions)
docker compose exec -T postgres psql -U postgres -d postgres < "$DUMP_FILE"

# Resume services
docker compose up -d --wait temporal temporal-ui
docker compose --profile prod up -d --wait web worker
```

Keep the dump file (`$DUMP_FILE`) until at least one full business day after a successful migration before deleting it.

## After the runbook completes

- Re-enable the deploy workflow / scheduled triggers.
- Merge the pg 18 PR — subsequent deploys will see the same image already running on the host and skip the failure path.
- Delete the dump file from the host once you are confident: `rm "$DUMP_FILE"`.
