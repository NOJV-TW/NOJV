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

require_command gcloud
require_command curl
require_command docker
require_command helm
require_command git
require_command kubectl
require_command node
require_command slsa-verifier
require_command tar

# A Git replacement object can make a trusted commit ID archive an unrelated
# tree. Disable replacement objects for every provenance check and export.
export GIT_NO_REPLACE_OBJECTS=1

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-}"
REPOSITORY="${REPOSITORY:-}"
RELEASE_NAME="${RELEASE_NAME:-}"
RELEASE_SHA="${RELEASE_SHA:-}"
RELEASE_REMOTE="${RELEASE_REMOTE:-}"
RELEASE_REF="${RELEASE_REF:-}"
CLUSTER_NAME="${CLUSTER_NAME:-}"
CLUSTER_LOCATION="${CLUSTER_LOCATION:-}"
DEPLOY_PRINCIPAL="${DEPLOY_PRINCIPAL:-}"
CLOUD_BUILD_SERVICE_ACCOUNT="${CLOUD_BUILD_SERVICE_ACCOUNT:-}"
K8S_NAMESPACE="${K8S_NAMESPACE:-}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
REGISTRY_HOST="${REGISTRY_HOST:-}"
TLS_SECRET_NAME="${TLS_SECRET_NAME:-}"
EDGE_SECURITY_POLICY="${EDGE_SECURITY_POLICY:-}"
CLOUDSQL_INSTANCE_CONNECTION_NAME="${CLOUDSQL_INSTANCE_CONNECTION_NAME:-}"
REDIS_INSTANCE="${REDIS_INSTANCE:-}"

require_env PROJECT_ID
require_env REGION
require_env REPOSITORY
require_env RELEASE_NAME
require_env RELEASE_SHA
require_env RELEASE_REMOTE
require_env RELEASE_REF
require_env CLUSTER_NAME
require_env CLUSTER_LOCATION
require_env DEPLOY_PRINCIPAL
require_env CLOUD_BUILD_SERVICE_ACCOUNT
require_env K8S_NAMESPACE
require_env PUBLIC_HOST
require_env REGISTRY_HOST
require_env TLS_SECRET_NAME
require_env EDGE_SECURITY_POLICY
require_env CLOUDSQL_INSTANCE_CONNECTION_NAME
require_env REDIS_INSTANCE

if [[ ! "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "PROJECT_ID is not a valid Google Cloud project ID: $PROJECT_ID" >&2
  exit 1
fi
if [[ ! "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo "RELEASE_SHA must be a lowercase 40-character commit SHA." >&2
  exit 1
fi
if [[ "$RELEASE_REMOTE" != "origin" ]]; then
  echo "RELEASE_REMOTE must be the canonical origin remote." >&2
  exit 1
fi
if [[ "$RELEASE_REF" != refs/heads/* ]] || ! git check-ref-format "$RELEASE_REF"; then
  echo "RELEASE_REF must be an explicit fully qualified branch ref." >&2
  exit 1
fi
if [[ ! "$CLOUD_BUILD_SERVICE_ACCOUNT" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$ ]]; then
  echo "CLOUD_BUILD_SERVICE_ACCOUNT must be a full service-account email." >&2
  exit 1
fi
for concrete_value in \
  "$PROJECT_ID" \
  "$REGION" \
  "$PUBLIC_HOST" \
  "$REGISTRY_HOST" \
  "$CLOUDSQL_INSTANCE_CONNECTION_NAME"; do
  if [[ "$concrete_value" =~ PROJECT_ID|REGION|INSTANCE|example\.com ]]; then
    echo "GKE deploy input contains an unresolved placeholder: $concrete_value" >&2
    exit 1
  fi
done

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
REMOTE_URL="$(git remote get-url "$RELEASE_REMOTE")"
case "$REMOTE_URL" in
  https://github.com/NOJV-TW/NOJV | https://github.com/NOJV-TW/NOJV.git | \
    git@github.com:NOJV-TW/NOJV.git | ssh://git@github.com/NOJV-TW/NOJV.git) ;;
  *)
    echo "origin must point to the canonical NOJV-TW/NOJV repository; received ${REMOTE_URL:-none}." >&2
    exit 1
    ;;
esac
if [[ -n "$(git for-each-ref --format='%(refname)' refs/replace)" ]]; then
  echo "Git replacement refs are forbidden for release builds." >&2
  exit 1
fi
HEAD_SHA="$(git rev-parse --verify 'HEAD^{commit}')"
if [[ "$HEAD_SHA" != "$RELEASE_SHA" ]]; then
  echo "RELEASE_SHA ${RELEASE_SHA} does not match HEAD ${HEAD_SHA:-none}." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "The working tree must be clean, including untracked files, before deployment." >&2
  exit 1
fi
REMOTE_RELEASE="$(git ls-remote --exit-code "$REMOTE_URL" "$RELEASE_REF")"
IFS=$'\t' read -r REMOTE_SHA REMOTE_REF EXTRA <<< "$REMOTE_RELEASE"
if [[ "$REMOTE_RELEASE" == *$'\n'* ]] ||
  [[ "$REMOTE_REF" != "$RELEASE_REF" ]] ||
  [[ "$REMOTE_SHA" != "$RELEASE_SHA" ]] ||
  [[ -n "$EXTRA" ]]; then
  echo "Remote ref ${RELEASE_REMOTE}:${RELEASE_REF} does not resolve exactly to RELEASE_SHA ${RELEASE_SHA}." >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
SOURCE_DIR="${TEMP_DIR}/source"
KUBECONFIG_DIR="${TEMP_DIR}/kubeconfig"
export DOCKER_CONFIG="${TEMP_DIR}/docker"
mkdir -p "$SOURCE_DIR" "$KUBECONFIG_DIR" "$DOCKER_CONFIG"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT
git archive --format=tar "$RELEASE_SHA" | tar -xf - -C "$SOURCE_DIR"
IMAGE_TAG="$RELEASE_SHA"

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
if [[ "$ACTIVE_ACCOUNT" != "$DEPLOY_PRINCIPAL" ]]; then
  echo "Expected active gcloud account $DEPLOY_PRINCIPAL; received ${ACTIVE_ACCOUNT:-none}." >&2
  exit 1
fi

ACTUAL_PROJECT_ID="$(
  gcloud projects describe "$PROJECT_ID" \
    --project "$PROJECT_ID" \
    --format='value(projectId)'
)"
if [[ "$ACTUAL_PROJECT_ID" != "$PROJECT_ID" ]]; then
  echo "Google Cloud project identity mismatch: expected $PROJECT_ID; received ${ACTUAL_PROJECT_ID:-none}." >&2
  exit 1
fi

ACTUAL_BUILD_SERVICE_ACCOUNT="$(
  gcloud iam service-accounts describe "$CLOUD_BUILD_SERVICE_ACCOUNT" \
    --project "$PROJECT_ID" \
    --format='value(email)'
)"
if [[ "$ACTUAL_BUILD_SERVICE_ACCOUNT" != "$CLOUD_BUILD_SERVICE_ACCOUNT" ]]; then
  echo "Cloud Build service account mismatch: expected $CLOUD_BUILD_SERVICE_ACCOUNT; received ${ACTUAL_BUILD_SERVICE_ACCOUNT:-none}." >&2
  exit 1
fi

CLUSTER_IDENTITY="$(
  gcloud container clusters describe "$CLUSTER_NAME" \
    --project "$PROJECT_ID" \
    --location "$CLUSTER_LOCATION" \
    --format='value(name,location,endpoint,masterAuth.clusterCaCertificate,privateClusterConfig.masterIpv4CidrBlock)'
)"
IFS=$'\t' read -r ACTUAL_CLUSTER_NAME ACTUAL_CLUSTER_LOCATION CLUSTER_ENDPOINT CLUSTER_CA CLUSTER_MASTER_CIDR EXTRA <<< "$CLUSTER_IDENTITY"
if [[ "$ACTUAL_CLUSTER_NAME" != "$CLUSTER_NAME" ]] ||
  [[ "$ACTUAL_CLUSTER_LOCATION" != "$CLUSTER_LOCATION" ]] ||
  [[ -z "$CLUSTER_ENDPOINT" ]] ||
  [[ -z "$CLUSTER_CA" ]] ||
  [[ -z "$CLUSTER_MASTER_CIDR" ]] ||
  [[ -n "$EXTRA" ]]; then
  echo "GKE cluster identity mismatch: expected ${CLUSTER_NAME}@${CLUSTER_LOCATION}; received ${ACTUAL_CLUSTER_NAME:-none}@${ACTUAL_CLUSTER_LOCATION:-none}." >&2
  exit 1
fi

export KUBECONFIG="${KUBECONFIG_DIR}/config"

gcloud container clusters get-credentials "$CLUSTER_NAME" \
  --project "$PROJECT_ID" \
  --location "$CLUSTER_LOCATION"

KUBE_CONTEXT="$(kubectl config current-context)"
if [[ -z "$KUBE_CONTEXT" ]]; then
  echo "The isolated kubeconfig has no current context." >&2
  exit 1
fi
KUBE_CLUSTER_IDENTITY="$(
  kubectl config view --raw --minify \
    -o 'jsonpath={.clusters[0].cluster.server}{"|"}{.clusters[0].cluster.certificate-authority-data}'
)"
IFS='|' read -r KUBE_SERVER KUBE_CA <<< "$KUBE_CLUSTER_IDENTITY"
if [[ "$KUBE_SERVER" != "https://${CLUSTER_ENDPOINT}" ]] || [[ "$KUBE_CA" != "$CLUSTER_CA" ]]; then
  echo "Kubernetes context does not match the verified GKE endpoint and CA." >&2
  exit 1
fi

KUBERNETES_SERVICE_IP="$(
  kubectl get service kubernetes --namespace default -o 'jsonpath={.spec.clusterIP}'
)"

TLS_SECRET_IDENTITY="$(
  kubectl --namespace "$K8S_NAMESPACE" get secret "$TLS_SECRET_NAME" \
    -o 'jsonpath={.type}{"|"}{.data.tls\.crt}{"|"}{.data.tls\.key}'
)"
IFS='|' read -r TLS_SECRET_TYPE TLS_CERT TLS_KEY TLS_EXTRA <<< "$TLS_SECRET_IDENTITY"
if [[ "$TLS_SECRET_TYPE" != "kubernetes.io/tls" ]] ||
  [[ -z "$TLS_CERT" ]] ||
  [[ -z "$TLS_KEY" ]] ||
  [[ -n "$TLS_EXTRA" ]]; then
  echo "TLS Secret ${K8S_NAMESPACE}/${TLS_SECRET_NAME} must be type kubernetes.io/tls with tls.crt and tls.key." >&2
  exit 1
fi

CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE_CONNECTION_NAME##*:}"
CLOUDSQL_IDENTITY="$(
  gcloud sql instances describe "$CLOUDSQL_INSTANCE" \
    --project "$PROJECT_ID" \
    --format='value(connectionName,ipAddresses.filter(type:PRIVATE).ipAddress)'
)"
IFS=$'\t' read -r ACTUAL_CLOUDSQL_CONNECTION_NAME ACTUAL_CLOUDSQL_IP CLOUDSQL_EXTRA <<< "$CLOUDSQL_IDENTITY"
if [[ -n "$CLOUDSQL_EXTRA" ]]; then
  echo "Cloud SQL lookup returned an ambiguous identity." >&2
  exit 1
fi

ACTUAL_REDIS_IP="$(
  gcloud redis instances describe "$REDIS_INSTANCE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(host)'
)"

EDGE_SECURITY_POLICY_RULES_JSON="$(
  gcloud compute security-policies rules list \
    --security-policy "$EDGE_SECURITY_POLICY" \
    --project "$PROJECT_ID" \
    --format=json
)"

VERIFIED_NETWORK_JSON="$(
  PROJECT_ID="$PROJECT_ID" \
  REGION="$REGION" \
  PUBLIC_HOST="$PUBLIC_HOST" \
  REGISTRY_HOST="$REGISTRY_HOST" \
  TLS_SECRET_NAME="$TLS_SECRET_NAME" \
  EDGE_SECURITY_POLICY="$EDGE_SECURITY_POLICY" \
  CLOUDSQL_INSTANCE_CONNECTION_NAME="$CLOUDSQL_INSTANCE_CONNECTION_NAME" \
  ACTUAL_CLOUDSQL_CONNECTION_NAME="$ACTUAL_CLOUDSQL_CONNECTION_NAME" \
  ACTUAL_CLOUDSQL_IP="$ACTUAL_CLOUDSQL_IP" \
  ACTUAL_REDIS_IP="$ACTUAL_REDIS_IP" \
  CLUSTER_MASTER_CIDR="$CLUSTER_MASTER_CIDR" \
  KUBERNETES_SERVICE_IP="$KUBERNETES_SERVICE_IP" \
  EDGE_SECURITY_POLICY_RULES_JSON="$EDGE_SECURITY_POLICY_RULES_JSON" \
  CLOUDFLARE_CIDRS_FILE="$REPO_ROOT/infra/gcp/cloudflare-origin-cidrs.txt" \
    node "$REPO_ROOT/scripts/validate-gke-deploy-config.mjs"
)"
VERIFIED_NETWORK_TSV="$(
  node -e '
    const value = JSON.parse(process.argv[1]);
    process.stdout.write([
      value.redisCidr,
      value.cloudsqlCidr,
      JSON.stringify(value.googleApisCidrs),
      JSON.stringify(value.apiServerCidrs),
    ].join("\t"));
  ' "$VERIFIED_NETWORK_JSON"
)"
IFS=$'\t' read -r REDIS_CIDR CLOUDSQL_CIDR GOOGLE_APIS_CIDRS_JSON API_SERVER_CIDRS_JSON NETWORK_EXTRA <<< "$VERIFIED_NETWORK_TSV"
if [[ -n "$NETWORK_EXTRA" ]]; then
  echo "Verified network configuration returned unexpected fields." >&2
  exit 1
fi

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  containeranalysis.googleapis.com \
  container.googleapis.com \
  --project "$PROJECT_ID"

verify_repository_config() {
  local config format immutable_tags extra
  config="$(
    gcloud artifacts repositories describe "$REPOSITORY" \
      --project "$PROJECT_ID" \
      --location "$REGION" \
      --format='value(format,dockerConfig.immutableTags)'
  )"
  IFS=$'\t' read -r format immutable_tags extra <<< "$config"
  if [[ "$format" != "DOCKER" ]] || [[ "$immutable_tags" != "True" ]] || [[ -n "$extra" ]]; then
    echo "Artifact Registry repository ${REPOSITORY} must be a Docker repository with immutable tags; received format=${format:-none}, immutableTags=${immutable_tags:-none}." >&2
    exit 1
  fi
}

REPOSITORY_MATCHES="$(
  gcloud artifacts repositories list \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --filter="name=${REPOSITORY}" \
    --format='value(name)'
)"
if [[ -n "$REPOSITORY_MATCHES" ]]; then
  if [[ "$REPOSITORY_MATCHES" == *$'\n'* ]] ||
    [[ "${REPOSITORY_MATCHES##*/}" != "$REPOSITORY" ]]; then
    echo "Artifact Registry repository lookup was not exact for ${REPOSITORY}: ${REPOSITORY_MATCHES}" >&2
    exit 1
  fi
  verify_repository_config
else
  gcloud artifacts repositories create "$REPOSITORY" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --repository-format docker \
    --immutable-tags
  verify_repository_config
fi

IMAGE_REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
gcloud auth print-access-token --account "$DEPLOY_PRINCIPAL" |
  docker login --username oauth2accesstoken --password-stdin "https://${REGION}-docker.pkg.dev"

validate_component_image() {
  local component="$1"
  local dockerfile="$2"
  local ref="${IMAGE_REGISTRY}/${component}"
  local inspect
  local digest
  local provenance
  local provenance_file
  local verified_provenance_file
  docker pull "${ref}:${IMAGE_TAG}" >/dev/null
  inspect="$(docker image inspect "${ref}:${IMAGE_TAG}")"
  digest="$(IMAGE_INSPECT_JSON="$inspect" \
    IMAGE_REF="$ref" \
    RELEASE_SHA="$RELEASE_SHA" \
    node "$REPO_ROOT/scripts/validate-release-run.mjs" published-image)"
  provenance="$(gcloud artifacts docker images describe "${ref}@${digest}" \
    --project "$PROJECT_ID" \
    --show-provenance \
    --format=json)"
  provenance_file="${TEMP_DIR}/${component}-provenance.json"
  verified_provenance_file="${TEMP_DIR}/${component}-verified-provenance.json"
  printf '%s\n' "$provenance" > "$provenance_file"
  slsa-verifier verify-image "${ref}@${digest}" \
    --provenance-path "$provenance_file" \
    --builder-id=https://cloudbuild.googleapis.com/GoogleHostedWorker \
    --source-uri=github.com/NOJV-TW/NOJV \
    --print-provenance > "$verified_provenance_file"
  CLOUD_BUILD_PROVENANCE_JSON="$(<"$verified_provenance_file")" \
    IMAGE_COMPONENT="$component" \
    IMAGE_DIGEST="$digest" \
    IMAGE_REF="$ref" \
    IMAGE_DOCKERFILE="$dockerfile" \
    REGION="$REGION" \
    REPOSITORY="$REPOSITORY" \
    RELEASE_SHA="$RELEASE_SHA" \
    SOURCE_URI="git+https://github.com/NOJV-TW/NOJV.git" \
    node "$REPO_ROOT/scripts/validate-release-run.mjs" cloud-build-provenance
}

WEB_DIGEST=""
WORKER_DIGEST=""
SANDBOX_DIGEST=""
MIGRATOR_DIGEST=""
MISSING_COMPONENT_SPECS=""
for component_spec in \
  "web:infra/docker/web.Dockerfile" \
  "worker:infra/docker/worker.Dockerfile" \
  "sandbox:infra/docker/sandbox-runner.Dockerfile" \
  "migrator:infra/docker/migrator.Dockerfile"; do
  component="${component_spec%%:*}"
  dockerfile="${component_spec#*:}"
  existing_tag="$(
    gcloud artifacts docker tags list "${IMAGE_REGISTRY}/${component}" \
      --project "$PROJECT_ID" \
      --filter="tag=${IMAGE_TAG}" \
      --format='value(tag)'
  )"
  if [[ -n "$existing_tag" ]]; then
    if [[ "$existing_tag" == *$'\n'* ]]; then
      echo "Artifact Registry returned multiple immutable tag matches for ${component}:${IMAGE_TAG}." >&2
      exit 1
    fi
    digest="$(validate_component_image "$component" "$dockerfile")"
  else
    MISSING_COMPONENT_SPECS="${MISSING_COMPONENT_SPECS}${component_spec}"$'\n'
    continue
  fi
  case "$component" in
    web) WEB_DIGEST="$digest" ;;
    worker) WORKER_DIGEST="$digest" ;;
    sandbox) SANDBOX_DIGEST="$digest" ;;
    migrator) MIGRATOR_DIGEST="$digest" ;;
  esac
done

while IFS= read -r component_spec; do
  [[ -n "$component_spec" ]] || continue
  component="${component_spec%%:*}"
  dockerfile="${component_spec#*:}"
  gcloud builds submit "https://github.com/NOJV-TW/NOJV.git" \
    --project "$PROJECT_ID" \
    --git-source-revision "$RELEASE_SHA" \
    --config "$SOURCE_DIR/infra/gcp/cloud-build/cloudbuild.yaml" \
    --service-account "projects/${PROJECT_ID}/serviceAccounts/${CLOUD_BUILD_SERVICE_ACCOUNT}" \
    --substitutions "_REGION=${REGION},_REPOSITORY=${REPOSITORY},_SOURCE_SHA=${RELEASE_SHA},_SERVICE_ACCOUNT=${CLOUD_BUILD_SERVICE_ACCOUNT},_COMPONENT=${component},_DOCKERFILE=${dockerfile}"
  digest="$(validate_component_image "$component" "$dockerfile")"
  case "$component" in
    web) WEB_DIGEST="$digest" ;;
    worker) WORKER_DIGEST="$digest" ;;
    sandbox) SANDBOX_DIGEST="$digest" ;;
    migrator) MIGRATOR_DIGEST="$digest" ;;
  esac
done <<< "$MISSING_COMPONENT_SPECS"

# The chart reads every runtime credential from the nojv-runtime-secrets Secret
# and provisions the migrator Job + web/worker Deployments in-cluster. Create the
# Secret from the chart's canonical example BEFORE the first deploy:
#   cp infra/charts/nojv/secret.example.yaml secret.local.yaml
#   kubectl -n nojv apply -f secret.local.yaml  # after filling every required value
helm upgrade --install "$RELEASE_NAME" "$SOURCE_DIR/infra/charts/nojv" \
  -f "$SOURCE_DIR/infra/charts/nojv/values-gke.yaml" \
  --kube-context "$KUBE_CONTEXT" \
  --namespace "$K8S_NAMESPACE" \
  --set image.registry="${REGION}-docker.pkg.dev" \
  --set image.repositoryPrefix="${PROJECT_ID}/${REPOSITORY}" \
  --set image.tag="${IMAGE_TAG}" \
  --set-string postgres.cloudsql.instanceConnectionName="${CLOUDSQL_INSTANCE_CONNECTION_NAME}" \
  --set-string registry.host="${REGISTRY_HOST}" \
  --set-string registry.token.realm="https://${PUBLIC_HOST}/api/registry/token" \
  --set-json web.advancedImageAllowedRegistries="\"${REGISTRY_HOST},ghcr.io,docker.io,quay.io,registry.gitlab.com,gcr.io,public.ecr.aws,mcr.microsoft.com,registry.k8s.io\"" \
  --set-string web.ingress.host="${PUBLIC_HOST}" \
  --set-string 'web.ingress.tls[0].hosts[0]'="${PUBLIC_HOST}" \
  --set-string 'web.ingress.tls[0].hosts[1]'="${REGISTRY_HOST}" \
  --set-string 'web.ingress.tls[0].secretName'="${TLS_SECRET_NAME}" \
  --set-string web.ingress.gce.securityPolicy="${EDGE_SECURITY_POLICY}" \
  --set-string networkPolicy.egress.redisCidr="${REDIS_CIDR}" \
  --set-string networkPolicy.egress.cloudsqlCidr="${CLOUDSQL_CIDR}" \
  --set-json networkPolicy.egress.googleApisCidrs="${GOOGLE_APIS_CIDRS_JSON}" \
  --set-json networkPolicy.egress.apiServerCidrs="${API_SERVER_CIDRS_JSON}" \
  --set-string release.sourceSha="${RELEASE_SHA}" \
  --set-string image.digests.web="${WEB_DIGEST}" \
  --set-string image.digests.worker="${WORKER_DIGEST}" \
  --set-string image.digests.sandbox="${SANDBOX_DIGEST}" \
  --set-string image.digests.migrator="${MIGRATOR_DIGEST}" \
  --wait --timeout 125m

INGRESS_STATE=""
for _ in $(seq 1 30); do
  INGRESS_JSON="$(
    kubectl --namespace "$K8S_NAMESPACE" get ingress \
      --selector "app.kubernetes.io/instance=${RELEASE_NAME},app.kubernetes.io/component=web" \
      --output json
  )"
  if INGRESS_STATE="$(
    INGRESS_JSON="$INGRESS_JSON" EXPECTED_BACKENDS=2 node -e '
      const { isIP } = require("node:net");
      const payload = JSON.parse(process.env.INGRESS_JSON);
      if (!Array.isArray(payload.items) || payload.items.length !== 1) process.exit(1);
      const ingress = payload.items[0];
      const address = ingress?.status?.loadBalancer?.ingress;
      const annotation = ingress?.metadata?.annotations?.["ingress.kubernetes.io/backends"];
      if (!Array.isArray(address) || address.length !== 1 || isIP(address[0]?.ip) !== 4) {
        process.exit(1);
      }
      let backends;
      try { backends = JSON.parse(annotation); } catch { process.exit(1); }
      const entries = Object.entries(backends ?? {});
      if (
        entries.length !== Number(process.env.EXPECTED_BACKENDS) ||
        entries.some(([, health]) => health !== "HEALTHY")
      ) process.exit(1);
      process.stdout.write([
        ingress.metadata.name,
        address[0].ip,
        JSON.stringify(entries.map(([name]) => name).sort()),
      ].join("\t"));
    '
  )"; then
    break
  fi
  sleep 10
done
if [[ -z "$INGRESS_STATE" ]]; then
  echo "GKE Ingress did not expose exactly two healthy web and registry backends within 5 minutes." >&2
  exit 1
fi
IFS=$'\t' read -r INGRESS_NAME ORIGIN_IP BACKEND_SERVICES_JSON INGRESS_EXTRA <<< "$INGRESS_STATE"
if [[ -n "$INGRESS_EXTRA" ]]; then
  echo "Verified GKE Ingress state returned unexpected fields." >&2
  exit 1
fi

BACKEND_SERVICES="$(
  # The JavaScript template literal is intentionally protected from Bash.
  # shellcheck disable=SC2016
  node -e '
    const values = JSON.parse(process.argv[1]);
    if (!Array.isArray(values) || values.length !== 2) process.exit(1);
    for (const value of values) {
      if (typeof value !== "string" || value.length === 0 || value.includes("\n")) process.exit(1);
      process.stdout.write(`${value}\n`);
    }
  ' "$BACKEND_SERVICES_JSON"
)"
while IFS= read -r backend_service; do
  ATTACHED_SECURITY_POLICY="$(
    gcloud compute backend-services describe "$backend_service" \
      --global \
      --project "$PROJECT_ID" \
      --format='value(securityPolicy)'
  )"
  if [[ "${ATTACHED_SECURITY_POLICY##*/}" != "$EDGE_SECURITY_POLICY" ]]; then
    echo "GKE backend ${backend_service} is not attached to verified Cloud Armor policy ${EDGE_SECURITY_POLICY}." >&2
    exit 1
  fi
done <<< "$BACKEND_SERVICES"

PUBLIC_WEB_STATUS="$(
  curl --silent --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --connect-timeout 10 \
    --max-time 20 \
    "https://${PUBLIC_HOST}/health/live"
)"
if [[ "$PUBLIC_WEB_STATUS" != "200" ]]; then
  echo "Public Cloudflare web probe returned HTTP ${PUBLIC_WEB_STATUS}; expected 200 with valid public TLS." >&2
  exit 1
fi

PUBLIC_REGISTRY_STATUS="$(
  curl --silent --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --connect-timeout 10 \
    --max-time 20 \
    "https://${REGISTRY_HOST}/v2/"
)"
if [[ "$PUBLIC_REGISTRY_STATUS" != "401" ]]; then
  echo "Public Cloudflare registry probe returned HTTP ${PUBLIC_REGISTRY_STATUS}; expected the registry authentication challenge." >&2
  exit 1
fi

DIRECT_WEB_STATUS="$(
  curl --silent --show-error --insecure \
    --output /dev/null \
    --write-out '%{http_code}' \
    --connect-timeout 10 \
    --max-time 20 \
    --resolve "${PUBLIC_HOST}:443:${ORIGIN_IP}" \
    "https://${PUBLIC_HOST}/health/live"
)"
if [[ "$DIRECT_WEB_STATUS" != "403" ]] && [[ "$DIRECT_WEB_STATUS" != "404" ]]; then
  echo "Direct-origin web probe reached ${PUBLIC_HOST} at ${ORIGIN_IP} with HTTP ${DIRECT_WEB_STATUS}; expected Cloud Armor rejection." >&2
  exit 1
fi

DIRECT_REGISTRY_STATUS="$(
  curl --silent --show-error --insecure \
    --output /dev/null \
    --write-out '%{http_code}' \
    --connect-timeout 10 \
    --max-time 20 \
    --resolve "${REGISTRY_HOST}:443:${ORIGIN_IP}" \
    "https://${REGISTRY_HOST}/v2/"
)"
if [[ "$DIRECT_REGISTRY_STATUS" != "403" ]] && [[ "$DIRECT_REGISTRY_STATUS" != "404" ]]; then
  echo "Direct-origin registry probe reached ${REGISTRY_HOST} at ${ORIGIN_IP} with HTTP ${DIRECT_REGISTRY_STATUS}; expected Cloud Armor rejection." >&2
  exit 1
fi

echo "Deployment completed:"
echo "  release: ${RELEASE_NAME}"
echo "  cluster: ${CLUSTER_NAME}@${CLUSTER_LOCATION}"
echo "  principal: ${DEPLOY_PRINCIPAL}"
echo "  cloud build service account: ${CLOUD_BUILD_SERVICE_ACCOUNT}"
echo "  source: ${RELEASE_REMOTE}:${RELEASE_REF}@${RELEASE_SHA}"
echo "  image tag: ${IMAGE_TAG}"
echo "  registry: ${IMAGE_REGISTRY}"
echo "  web digest: ${WEB_DIGEST}"
echo "  worker digest: ${WORKER_DIGEST}"
echo "  sandbox digest: ${SANDBOX_DIGEST}"
echo "  migrator digest: ${MIGRATOR_DIGEST}"
echo "  ingress: ${INGRESS_NAME}@${ORIGIN_IP}"
echo "  backend policy: both ingress backends -> ${EDGE_SECURITY_POLICY}"
echo "  public probes: web HTTP ${PUBLIC_WEB_STATUS}, registry HTTP ${PUBLIC_REGISTRY_STATUS}"
echo "  direct-origin probes: web HTTP ${DIRECT_WEB_STATUS}, registry HTTP ${DIRECT_REGISTRY_STATUS} (rejected)"
echo "  rollout: helm status ${RELEASE_NAME} -n nojv"
