#!/usr/bin/env bash
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
