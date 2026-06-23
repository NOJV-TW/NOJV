#!/usr/bin/env bash

set -euo pipefail

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

require_env() {
  local var_name="$1"
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required environment variable: $var_name" >&2
    exit 1
  fi
}

resolve_image_tag() {
  if [[ -n "${IMAGE_TAG:-}" ]]; then
    printf '%s\n' "$IMAGE_TAG"
    return
  fi

  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local short_sha=""
    local dirty_suffix=""

    short_sha="$(git rev-parse --short=12 HEAD 2>/dev/null || true)"
    if [[ -n "$short_sha" ]]; then
      if [[ -n "$(git status --short --untracked-files=normal 2>/dev/null)" ]]; then
        dirty_suffix="-dirty-$(date -u +%Y%m%d%H%M%S)"
      fi

      printf '%s%s\n' "$short_sha" "$dirty_suffix"
      return
    fi
  fi

  date -u +%Y%m%d%H%M%S
}

upsert_secret() {
  local name="$1"
  local value="$2"
  local tmp_file

  tmp_file="$(mktemp)"
  printf '%s' "$value" >"$tmp_file"

  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    gcloud secrets versions add "$name" --data-file="$tmp_file" >/dev/null
  else
    gcloud secrets create "$name" \
      --replication-policy=automatic \
      --data-file="$tmp_file" >/dev/null
  fi

  rm -f "$tmp_file"
}

require_command gcloud

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo "No active gcloud account. Run 'gcloud auth login' first." >&2
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-asia-east1}"
REPOSITORY="${REPOSITORY:-nojv}"
SERVICE_PREFIX="${SERVICE_PREFIX:-nojv}"
IMAGE_TAG="$(resolve_image_tag)"

require_env PROJECT_ID
require_env DATABASE_URL
require_env REDIS_URL
require_env BETTER_AUTH_SECRET
require_env BETTER_AUTH_URL
require_env S3_ENDPOINT
require_env S3_ACCESS_KEY
require_env S3_SECRET_KEY
require_env S3_BUCKET
require_env S3_REGION
require_env EDGE_TRUST_SECRET
require_env API_TOKEN_PEPPER

gcloud config set project "$PROJECT_ID" >/dev/null

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com

if ! gcloud artifacts repositories describe "$REPOSITORY" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --location "$REGION" \
    --repository-format docker
fi

upsert_secret nojv-database-url "$DATABASE_URL"
upsert_secret nojv-redis-url "$REDIS_URL"
upsert_secret nojv-auth-secret "$BETTER_AUTH_SECRET"
upsert_secret nojv-auth-url "$BETTER_AUTH_URL"
upsert_secret nojv-s3-endpoint "$S3_ENDPOINT"
upsert_secret nojv-s3-access-key "$S3_ACCESS_KEY"
upsert_secret nojv-s3-secret-key "$S3_SECRET_KEY"
upsert_secret nojv-s3-bucket "$S3_BUCKET"
upsert_secret nojv-s3-region "$S3_REGION"
upsert_secret nojv-edge-trust-secret "$EDGE_TRUST_SECRET"
upsert_secret nojv-api-token-pepper "$API_TOKEN_PEPPER"

WEB_SECRETS="DATABASE_URL=nojv-database-url:latest"
WEB_SECRETS+=",REDIS_URL=nojv-redis-url:latest"
WEB_SECRETS+=",BETTER_AUTH_SECRET=nojv-auth-secret:latest"
WEB_SECRETS+=",BETTER_AUTH_URL=nojv-auth-url:latest"
WEB_SECRETS+=",S3_ENDPOINT=nojv-s3-endpoint:latest"
WEB_SECRETS+=",S3_ACCESS_KEY=nojv-s3-access-key:latest"
WEB_SECRETS+=",S3_SECRET_KEY=nojv-s3-secret-key:latest"
WEB_SECRETS+=",S3_BUCKET=nojv-s3-bucket:latest"
WEB_SECRETS+=",S3_REGION=nojv-s3-region:latest"
WEB_SECRETS+=",EDGE_TRUST_SECRET=nojv-edge-trust-secret:latest"
WEB_SECRETS+=",API_TOKEN_PEPPER=nojv-api-token-pepper:latest"

append_optional_secret() {
  local env_var="$1"
  local secret_name="$2"
  if [[ -n "${!env_var:-}" ]]; then
    upsert_secret "$secret_name" "${!env_var}"
    WEB_SECRETS+=",${env_var}=${secret_name}:latest"
  fi
}

append_optional_secret GITHUB_CLIENT_ID nojv-github-client-id
append_optional_secret GITHUB_CLIENT_SECRET nojv-github-client-secret
append_optional_secret GOOGLE_CLIENT_ID nojv-google-client-id
append_optional_secret GOOGLE_CLIENT_SECRET nojv-google-client-secret
append_optional_secret RESEND_API_KEY nojv-resend-api-key
append_optional_secret EMAIL_FROM_DOMAIN nojv-email-from-domain

gcloud builds submit \
  --config infra/gcp/cloud-build/cloudbuild.yaml \
  --substitutions "_REGION=${REGION},_REPOSITORY=${REPOSITORY},_IMAGE_TAG=${IMAGE_TAG}"

IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"

NET_FLAGS=()
[[ -n "${CLOUD_SQL_INSTANCE:-}" ]] && NET_FLAGS+=(--set-cloudsql-instances "$CLOUD_SQL_INSTANCE")
if [[ -n "${VPC_CONNECTOR:-}" ]]; then
  NET_FLAGS+=(--vpc-connector "$VPC_CONNECTOR" --vpc-egress "${VPC_EGRESS:-private-ranges-only}")
fi
if [[ ${#NET_FLAGS[@]} -eq 0 ]]; then
  echo "WARNING: neither CLOUD_SQL_INSTANCE nor VPC_CONNECTOR is set — Cloud Run" >&2
  echo "         cannot reach private Cloud SQL / Memorystore. See DEPLOYMENT.md." >&2
fi

gcloud run jobs deploy "${SERVICE_PREFIX}-migrator" \
  --image "${IMAGE_BASE}/migrator:${IMAGE_TAG}" \
  --region "$REGION" \
  --max-retries 1 \
  --set-secrets "DATABASE_URL=nojv-database-url:latest" \
  ${NET_FLAGS[@]+"${NET_FLAGS[@]}"}

gcloud run jobs execute "${SERVICE_PREFIX}-migrator" --region "$REGION" --wait

gcloud run deploy "${SERVICE_PREFIX}-web" \
  --allow-unauthenticated \
  --image "${IMAGE_BASE}/web:${IMAGE_TAG}" \
  --port 3000 \
  --region "$REGION" \
  --ingress internal-and-cloud-load-balancing \
  --set-secrets "$WEB_SECRETS" \
  ${NET_FLAGS[@]+"${NET_FLAGS[@]}"}

WEB_URL="$(gcloud run services describe "${SERVICE_PREFIX}-web" --region "$REGION" --format='value(status.url)')"

echo "Verifying deployment health..."
RETRIES=5
for i in $(seq 1 $RETRIES); do
  HTTP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$WEB_URL" || true)"
  if [[ "$HTTP_STATUS" =~ ^(200|301|302)$ ]]; then
    echo "Health check passed (HTTP $HTTP_STATUS)"
    break
  fi
  if [[ "$i" -eq "$RETRIES" ]]; then
    echo "WARNING: Health check failed after $RETRIES attempts (last HTTP $HTTP_STATUS)" >&2
    echo "The service may still be starting up. Check Cloud Run logs." >&2
  fi
  sleep 5
done

echo "Deployment completed:"
echo "  image tag: ${IMAGE_TAG}"
echo "  web: $(gcloud run services describe "${SERVICE_PREFIX}-web" --region "$REGION" --format='value(status.url)')"
echo "  worker image: ${IMAGE_BASE}/worker:${IMAGE_TAG}"
echo "  sandbox image: ${IMAGE_BASE}/sandbox:${IMAGE_TAG}"
echo "  next step: apply infra/gcp/gke plus infra/k8s/sandbox manifests to run the worker on GKE"
