#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${SQL_INSTANCE:?SQL_INSTANCE is required}"
: "${REGION:?REGION is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"

# Workload-Identity GSA the in-cluster Temporal pg_dump CronJob authenticates as
# when writing to GCS. Reuses the worker GSA by default (it already has GKE
# Workload Identity wired in infra/gcp/gke/README.md). Must hold
# roles/storage.objectCreator on gs://${BACKUP_BUCKET}.
TEMPORAL_BACKUP_GSA="${TEMPORAL_BACKUP_GSA:-nojv-worker@${PROJECT_ID}.iam.gserviceaccount.com}"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "[1/4] Patching Cloud SQL instance ${SQL_INSTANCE} — automated backups + PITR"
gcloud sql instances patch "${SQL_INSTANCE}" \
  --backup-start-time=17:00 \
  --retained-backups-count=30 \
  --backup-location="${REGION}" \
  --enable-point-in-time-recovery \
  --retained-transaction-log-days=14

echo "[2/4] Ensuring GCS bucket gs://${BACKUP_BUCKET} exists with versioning"
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

echo "[3/4] Granting Cloud SQL service account write access to the bucket"
SQL_SA="$(gcloud sql instances describe "${SQL_INSTANCE}" \
  --format='value(serviceAccountEmailAddress)')"
gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET}" \
  --member="serviceAccount:${SQL_SA}" \
  --role=roles/storage.objectCreator >/dev/null

# The app database lives in Cloud SQL (covered by steps 1–3 above). The
# self-hosted Temporal control plane keeps its state in the in-cluster
# `temporal-postgres` StatefulSet, which Cloud SQL backups DO NOT cover. Until
# Temporal moves to a managed/HA Postgres (see docs/operations/RELIABILITY.md),
# back it up with a daily in-cluster `pg_dump` streamed to the same GCS bucket.
echo "[4/4] Installing daily Temporal pg_dump CronJob (namespace nojv-temporal)"
gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET}" \
  --member="serviceAccount:${TEMPORAL_BACKUP_GSA}" \
  --role=roles/storage.objectCreator >/dev/null

kubectl apply -f - <<YAML
apiVersion: v1
kind: ServiceAccount
metadata:
  name: temporal-backup
  namespace: nojv-temporal
  annotations:
    iam.gke.io/gcp-service-account: ${TEMPORAL_BACKUP_GSA}
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: temporal-postgres-backup
  namespace: nojv-temporal
spec:
  # 16:30 UTC daily — staggered before the Cloud SQL window (17:00 UTC).
  schedule: "30 16 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 1800
      template:
        spec:
          serviceAccountName: temporal-backup
          restartPolicy: Never
          nodeSelector:
            nojv-role: worker
          securityContext:
            runAsNonRoot: true
            runAsUser: 999
            runAsGroup: 999
            seccompProfile:
              type: RuntimeDefault
          containers:
            - name: dump
              image: google/cloud-sdk:slim
              securityContext:
                allowPrivilegeEscalation: false
                capabilities:
                  drop: ["ALL"]
              env:
                - name: BACKUP_BUCKET
                  value: ${BACKUP_BUCKET}
                - name: PGHOST
                  value: temporal-postgres.nojv-temporal.svc.cluster.local
                - name: PGUSER
                  valueFrom:
                    secretKeyRef:
                      name: temporal-postgres-secret
                      key: POSTGRES_USER
                - name: PGPASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: temporal-postgres-secret
                      key: POSTGRES_PASSWORD
              command:
                - bash
                - -euo
                - pipefail
                - -c
                - |
                  apt-get update -qq && apt-get install -y -qq postgresql-client >/dev/null
                  STAMP="\$(date -u +%Y/%m/%d/temporal-%H%M%S.sql.gz)"
                  pg_dump --dbname=temporal --format=plain --no-owner \
                    | gzip -9 \
                    | gcloud storage cp - "gs://\${BACKUP_BUCKET}/temporal/\${STAMP}"
                  echo "Uploaded gs://\${BACKUP_BUCKET}/temporal/\${STAMP}"
YAML

echo "Done. Verify with:"
echo "  gcloud sql backups list --instance=${SQL_INSTANCE} --limit=5"
echo "  gcloud storage buckets describe gs://${BACKUP_BUCKET}"
echo "  kubectl -n nojv-temporal create job --from=cronjob/temporal-postgres-backup temporal-backup-test"
echo "  gcloud storage ls gs://${BACKUP_BUCKET}/temporal/"
