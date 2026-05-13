#!/usr/bin/env bash
#
# Cold backup: dump the production Cloud SQL database to a GCS bucket as a
# date-stamped SQL file. Designed to be invoked from Cloud Scheduler →
# Cloud Run Job (or any cron) on a daily cadence. Complements the in-place
# automated backups / PITR managed by `setup-backups.sh` — those rebuild a
# new Cloud SQL instance; the export here is a portable .sql.gz that
# survives even if the source instance is deleted.
#
# Cloud SQL's `export` is online (no instance lock) and atomic at the
# database level. The exported file lands in the bucket at the path
# `daily/YYYY/MM/DD/<db>-HHMMSS.sql.gz`.
#
# Required env:
#   PROJECT_ID         GCP project
#   SQL_INSTANCE       Cloud SQL instance name
#   DATABASE           Database name within the instance (default: nojv)
#   BACKUP_BUCKET      GCS bucket created by setup-backups.sh

set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${SQL_INSTANCE:?SQL_INSTANCE is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
DATABASE="${DATABASE:-nojv}"

gcloud config set project "$PROJECT_ID" >/dev/null

YEAR="$(date -u +%Y)"
MONTH="$(date -u +%m)"
DAY="$(date -u +%d)"
STAMP="$(date -u +%H%M%S)"
OBJECT="daily/${YEAR}/${MONTH}/${DAY}/${DATABASE}-${STAMP}.sql.gz"
GCS_URI="gs://${BACKUP_BUCKET}/${OBJECT}"

echo "Exporting ${SQL_INSTANCE}:${DATABASE} → ${GCS_URI}"

gcloud sql export sql "${SQL_INSTANCE}" "${GCS_URI}" \
  --database="${DATABASE}" \
  --offload

echo "Export complete. Object metadata:"
gcloud storage ls -L "${GCS_URI}"
