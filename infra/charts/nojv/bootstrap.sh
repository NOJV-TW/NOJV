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
CNPG_MANIFEST="https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.24/releases/cnpg-1.24.0.yaml"

cd "$REPO_ROOT"

echo "==> [1/4] CloudNativePG operator (server-side apply, idempotent)"
kubectl apply --server-side -f "$CNPG_MANIFEST"
kubectl -n cnpg-system rollout status deploy/cnpg-controller-manager --timeout=180s

echo "==> [2/4] Temporal Server (official chart, $OVERLAY values)"
helm repo add temporal https://go.temporal.io/helm-charts >/dev/null 2>&1 || true
helm repo update temporal >/dev/null
helm upgrade --install temporal temporal/temporal \
  -n "$TEMPORAL_NS" --create-namespace \
  -f "$TEMPORAL_VALUES"

if [ "$WITH_OBSERVABILITY" = true ]; then
  echo "==> [3/4] kube-prometheus-stack (Prometheus + Grafana)"
  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
  helm repo update prometheus-community >/dev/null
  helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
    -n monitoring --create-namespace
else
  echo "==> [3/4] observability stack skipped (pass --observability to install kube-prometheus-stack)"
fi

echo "==> [4/4] NOJV umbrella chart (values-$OVERLAY.yaml)"
echo "    (requires the nojv-runtime-secrets Secret in namespace $NS)"
helm upgrade --install nojv "$CHART_DIR" \
  -f "$CHART_DIR/values-$OVERLAY.yaml"

echo "==> Done. Verify: kubectl -n $NS get pods && kubectl -n $TEMPORAL_NS get pods"
