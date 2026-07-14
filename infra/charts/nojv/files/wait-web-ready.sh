#!/bin/sh
set -eu

: "${NAMESPACE:?NAMESPACE is required}"
: "${WEB_DEPLOYMENT:?WEB_DEPLOYMENT is required}"
: "${READY_REPLICAS:?READY_REPLICAS is required}"
: "${READY_TIMEOUT_SECONDS:=300}"
: "${POLL_INTERVAL_SECONDS:=2}"

is_uint() {
  case "$1" in
    ""|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

deadline=$(( $(date +%s) + READY_TIMEOUT_SECONDS ))
while true; do
  snapshot="$(
    kubectl --namespace "$NAMESPACE" get deployment "$WEB_DEPLOYMENT" \
      -o 'jsonpath={.status.observedGeneration} {.metadata.generation} {.status.updatedReplicas} {.status.availableReplicas}'
  )"
  observed=0
  generation=0
  updated=0
  available=0
  read -r observed generation updated available <<EOF
$snapshot
EOF
  observed="${observed:-0}"
  generation="${generation:-0}"
  updated="${updated:-0}"
  available="${available:-0}"
  if is_uint "$observed" && is_uint "$generation" && is_uint "$updated" && \
    is_uint "$available" && [ "$observed" -eq "$generation" ] && \
    [ "$updated" -ge "$READY_REPLICAS" ] && [ "$available" -ge "$READY_REPLICAS" ]; then
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "Timed out waiting for new $WEB_DEPLOYMENT generation: $snapshot" >&2
    exit 1
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done
