#!/bin/sh
#
# Self-hosted PostgreSQL backup loop for the docker-compose deployment.
# Runs as the `postgres-backup` sidecar (postgres image, so pg_dump matches
# the server version). Dumps the database to a date-stamped gzip under
# /backups on a fixed interval and prunes dumps older than the retention
# window. /backups should be a bind mount onto durable / off-box storage so
# the copy survives loss of the postgres_data volume.
#
# Env (all have compose-provided defaults):
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE  standard libpq connection
#   BACKUP_INTERVAL_SECONDS                      seconds between dumps (86400)
#   BACKUP_RETENTION_DAYS                        delete dumps older than this (14)
#
# Run a one-off dump (no loop) by passing `once`:
#   docker compose --profile backup run --rm postgres-backup once

set -eu

BACKUP_DIR=/backups
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
DATABASE="${PGDATABASE:-nojv}"

mkdir -p "$BACKUP_DIR"

dump_once() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="${BACKUP_DIR}/${DATABASE}-${stamp}.sql.gz"
  tmp="${target}.partial"

  echo "[backup] dumping ${DATABASE} -> ${target}"
  if pg_dump --format=plain --no-owner --no-privileges "$DATABASE" | gzip -c > "$tmp"; then
    mv "$tmp" "$target"
    echo "[backup] wrote $(wc -c < "$target") bytes"
  else
    echo "[backup] pg_dump FAILED for ${DATABASE}" >&2
    rm -f "$tmp"
    return 1
  fi

  echo "[backup] pruning dumps older than ${RETENTION_DAYS} day(s)"
  find "$BACKUP_DIR" -maxdepth 1 -name "${DATABASE}-*.sql.gz" -type f \
    -mtime "+${RETENTION_DAYS}" -print -delete || true
}

if [ "${1:-}" = "once" ]; then
  dump_once
  exit 0
fi

echo "[backup] starting loop: every ${INTERVAL}s, retain ${RETENTION_DAYS}d, db=${DATABASE}"
while true; do
  dump_once || echo "[backup] continuing despite failure" >&2
  sleep "$INTERVAL"
done
