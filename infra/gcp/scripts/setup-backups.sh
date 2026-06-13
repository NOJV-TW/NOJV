#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${SQL_INSTANCE:?SQL_INSTANCE is required}"
: "${REGION:?REGION is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "[1/3] Patching Cloud SQL instance ${SQL_INSTANCE} — automated backups + PITR"
gcloud sql instances patch "${SQL_INSTANCE}" \
  --backup-start-time=17:00 \
  --retained-backups-count=30 \
  --backup-location="${REGION}" \
  --enable-point-in-time-recovery \
  --retained-transaction-log-days=14

echo "[2/3] Ensuring GCS bucket gs://${BACKUP_BUCKET} exists with versioning"
if ! gcloud storage buckets describe "gs://${BACKUP_BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BACKUP_BUCKET}" \
    --location="${REGION}" \
    --default-storage-class=nearline \
    --uniform-bucket-level-access
fi

gcloud storage buckets update "gs://${BACKUP_BUCKET}" --versioning

TMP_LIFECYCLE="$(mktemp)"
trap 'rm -f "$TMP_LIFECYCLE"' EXIT
cat > "$TMP_LIFECYCLE" <<'JSON'
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": { "isLive": false, "daysSinceNoncurrentTime": 30 }
      },
      {
        "action": { "type": "Delete" },
        "condition": { "isLive": true, "age": 90 }
      }
    ]
  }
}
JSON
gcloud storage buckets update "gs://${BACKUP_BUCKET}" \
  --lifecycle-file="$TMP_LIFECYCLE"

echo "[3/3] Granting Cloud SQL service account write access to the bucket"
SQL_SA="$(gcloud sql instances describe "${SQL_INSTANCE}" \
  --format='value(serviceAccountEmailAddress)')"
gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET}" \
  --member="serviceAccount:${SQL_SA}" \
  --role=roles/storage.objectCreator >/dev/null

echo "Done. Verify with:"
echo "  gcloud sql backups list --instance=${SQL_INSTANCE} --limit=5"
echo "  gcloud storage buckets describe gs://${BACKUP_BUCKET}"
