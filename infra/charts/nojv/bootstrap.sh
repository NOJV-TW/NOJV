#!/usr/bin/env bash
# One-command bootstrap for the NOJV stack: prerequisites + umbrella chart.
#
#   bootstrap.sh <single-machine|gke> [--observability]
#
# Idempotent (helm upgrade --install / server-side apply). Installs:
#   1. CloudNativePG operator (cluster-wide; the chart only renders the Cluster CR)
#   2. Temporal Server via the official chart (matching HA / single-node values)
#   3. (optional, --observability) kube-prometheus-stack for Prometheus + Grafana
#   4. the NOJV umbrella chart (values-<overlay>.yaml)
#
# PREREQUISITE: the runtime secret `nojv-runtime-secrets` must already exist in
# the app namespace (the chart never templates secret values). Create it first:
#   kubectl create namespace nojv
#   kubectl -n nojv apply -f secret.local.yaml   # your filled-in copy
set -euo pipefail

OVERLAY="${1:-}"
WITH_OBSERVABILITY=false
for arg in "${@:2}"; do
  case "$arg" in
    --observability) WITH_OBSERVABILITY=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

case "$OVERLAY" in
  single-machine) TEMPORAL_VALUES="infra/gcp/gke/temporal/helm-values.single-machine.yaml" ;;
  gke)            TEMPORAL_VALUES="infra/gcp/gke/temporal/helm-values.ha.yaml" ;;
  *) echo "Usage: bootstrap.sh <single-machine|gke> [--observability]" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CHART_DIR="$SCRIPT_DIR"
NS="nojv"
TEMPORAL_NS="nojv-temporal"
ARTIFACT_DIR="$(mktemp -d)"
trap 'rm -rf -- "$ARTIFACT_DIR"' EXIT
CNPG_MANIFEST="$ARTIFACT_DIR/cnpg-1.30.0.yaml"
TEMPORAL_CHART="$ARTIFACT_DIR/temporal-1.6.0.tgz"
PROMETHEUS_CHART="$ARTIFACT_DIR/kube-prometheus-stack-87.15.2.tgz"

cd "$REPO_ROOT"

echo "==> [1/4] CloudNativePG operator (server-side apply, idempotent)"
curl --fail --location --proto '=https' --tlsv1.2 --output "$CNPG_MANIFEST" "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.30/releases/cnpg-1.30.0.yaml"
printf '%s  %s\n' "f8bede43fe4ee0d478c2355b204a36876b2ae4faac60f2a9452280b293da3b88" "$CNPG_MANIFEST" | sha256sum --check -
CNPG_IMAGE="ghcr.io/cloudnative-pg/cloudnative-pg:1.30.0"
CNPG_PINNED_IMAGE="ghcr.io/cloudnative-pg/cloudnative-pg:1.30.0@sha256:a2701eb97cdd2a34b1fdb2cb51987f544b706e40bec72ae7146cd8580efefebb"
CNPG_IMAGE_LINES="$(awk -v image="$CNPG_IMAGE" 'index($0, image) { count++ } END { print count + 0 }' "$CNPG_MANIFEST")"
if [ "$CNPG_IMAGE_LINES" -ne 2 ]; then
  echo "Expected exactly two CNPG operator image references, found $CNPG_IMAGE_LINES" >&2
  exit 1
fi
sed "s|$CNPG_IMAGE|$CNPG_PINNED_IMAGE|g" "$CNPG_MANIFEST" >"$CNPG_MANIFEST.pinned"
mv "$CNPG_MANIFEST.pinned" "$CNPG_MANIFEST"
kubectl apply --server-side -f "$CNPG_MANIFEST"
kubectl -n cnpg-system rollout status deploy/cnpg-controller-manager --timeout=180s

echo "==> [2/4] Temporal Server (official chart, $OVERLAY values)"
curl --fail --location --proto '=https' --tlsv1.2 --output "$TEMPORAL_CHART" "https://github.com/temporalio/helm-charts/releases/download/temporal-1.6.0/temporal-1.6.0.tgz"
printf '%s  %s\n' "4ea557365bca72e635ae82fc4a93d586df238946e5d5a19eb32a8a24748449f9" "$TEMPORAL_CHART" | sha256sum --check -
helm upgrade --install temporal "$TEMPORAL_CHART" \
  -n "$TEMPORAL_NS" --create-namespace \
  -f "$TEMPORAL_VALUES"

if [ "$WITH_OBSERVABILITY" = true ]; then
  echo "==> [3/4] kube-prometheus-stack (Prometheus + Grafana)"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$PROMETHEUS_CHART" "https://github.com/prometheus-community/helm-charts/releases/download/kube-prometheus-stack-87.15.2/kube-prometheus-stack-87.15.2.tgz"
  printf '%s  %s\n' "96dda4438dab44b3697cb4637ffe5ab9d860ffd12f87dfee23a285d9f15ae7dc" "$PROMETHEUS_CHART" | sha256sum --check -
  helm upgrade --install kube-prometheus-stack "$PROMETHEUS_CHART" \
    -n monitoring --create-namespace
else
  echo "==> [3/4] observability stack skipped (pass --observability to install kube-prometheus-stack)"
fi

echo "==> [4/4] NOJV umbrella chart (values-$OVERLAY.yaml)"
echo "    (requires the nojv-runtime-secrets Secret in namespace $NS)"
helm upgrade --install nojv "$CHART_DIR" \
  -n "$NS" --create-namespace \
  -f "$CHART_DIR/values-$OVERLAY.yaml"

echo "==> Done. Verify: kubectl -n $NS get pods && kubectl -n $TEMPORAL_NS get pods"
