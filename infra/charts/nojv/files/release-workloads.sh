#!/bin/sh
set -eu

: "${NAMESPACE:?NAMESPACE is required}"
: "${WEB_DEPLOYMENT:?WEB_DEPLOYMENT is required}"
: "${WEB_READY_REPLICAS:?WEB_READY_REPLICAS is required}"
: "${JUDGE_DEPLOYMENT:?JUDGE_DEPLOYMENT is required}"
: "${JUDGE_READY_REPLICAS:?JUDGE_READY_REPLICAS is required}"
: "${PLATFORM_DEPLOYMENT:?PLATFORM_DEPLOYMENT is required}"
: "${PLATFORM_READY_REPLICAS:?PLATFORM_READY_REPLICAS is required}"
: "${WEB_POD_SELECTOR:?WEB_POD_SELECTOR is required}"
: "${JUDGE_POD_SELECTOR:?JUDGE_POD_SELECTOR is required}"
: "${PLATFORM_POD_SELECTOR:?PLATFORM_POD_SELECTOR is required}"
: "${WEB_HPA_ENABLED:=false}"
: "${JUDGE_KEDA_ENABLED:=false}"
: "${READY_TIMEOUT_SECONDS:=300}"
: "${POLL_INTERVAL_SECONDS:=2}"
: "${KUBECTL_REQUEST_TIMEOUT_SECONDS:=5}"

kubectl_ns() {
  kubectl --request-timeout="${KUBECTL_REQUEST_TIMEOUT_SECONDS}s" \
    --namespace "$NAMESPACE" "$@"
}

released=false

drained() {
  deployment="$1"
  selector="$2"
  snapshot="$(kubectl_ns get deployment "$deployment" \
    -o 'jsonpath={.spec.replicas} {.status.replicas}')" || return 1
  pods="$(kubectl_ns get pods --selector "$selector" --output name)" || return 1
  { [ "$snapshot" = "0 " ] || [ "$snapshot" = "0 0" ]; } && [ -z "$pods" ]
}

enter_maintenance() {
  echo "Post-contract release failed; returning every workload to maintenance." >&2
  maintenance_failed=false
  if [ "$WEB_HPA_ENABLED" = true ]; then
    kubectl_ns patch horizontalpodautoscaler "$WEB_HPA" --type merge \
      -p "{\"spec\":{\"scaleTargetRef\":{\"name\":\"$WEB_DEPLOYMENT-maintenance\"}}}" || \
      maintenance_failed=true
  fi
  if [ "$JUDGE_KEDA_ENABLED" = true ]; then
    kubectl_ns annotate scaledobject "$JUDGE_KEDA_SCALED_OBJECT" \
      autoscaling.keda.sh/paused-replicas=0 --overwrite || maintenance_failed=true
  fi
  kubectl_ns scale deployment "$WEB_DEPLOYMENT" "$JUDGE_DEPLOYMENT" "$PLATFORM_DEPLOYMENT" \
    --replicas=0 || maintenance_failed=true

  maintenance_deadline=$(( $(date +%s) + READY_TIMEOUT_SECONDS ))
  while ! drained "$WEB_DEPLOYMENT" "$WEB_POD_SELECTOR" || \
        ! drained "$JUDGE_DEPLOYMENT" "$JUDGE_POD_SELECTOR" || \
        ! drained "$PLATFORM_DEPLOYMENT" "$PLATFORM_POD_SELECTOR"; do
    if [ "$(date +%s)" -ge "$maintenance_deadline" ]; then
      echo "CRITICAL: timed out returning workloads to maintenance" >&2
      maintenance_failed=true
      break
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
  [ "$maintenance_failed" = false ]
}

cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$released" = false ]; then
    enter_maintenance || echo "CRITICAL: could not prove maintenance state" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$WEB_HPA_ENABLED" = true ]; then
  : "${WEB_HPA:?WEB_HPA is required when WEB_HPA_ENABLED=true}"
  kubectl_ns patch horizontalpodautoscaler "$WEB_HPA" --type merge \
    -p "{\"spec\":{\"scaleTargetRef\":{\"name\":\"$WEB_DEPLOYMENT\"}}}"
fi
if [ "$JUDGE_KEDA_ENABLED" = true ]; then
  : "${JUDGE_KEDA_SCALED_OBJECT:?JUDGE_KEDA_SCALED_OBJECT is required when JUDGE_KEDA_ENABLED=true}"
  kubectl_ns annotate scaledobject "$JUDGE_KEDA_SCALED_OBJECT" \
    autoscaling.keda.sh/paused-replicas- --overwrite
fi

deployment_ready() {
  deployment="$1"
  desired="$2"
  snapshot="$(kubectl_ns get deployment "$deployment" \
    -o 'jsonpath={.status.observedGeneration} {.metadata.generation} {.status.updatedReplicas} {.status.availableReplicas}')"
  read -r observed generation updated available <<EOF
$snapshot
EOF
  observed="${observed:-0}"
  generation="${generation:-0}"
  updated="${updated:-0}"
  available="${available:-0}"
  case "$observed:$generation:$updated:$available" in *[!0-9:]*) return 1 ;; esac
  [ "$observed" -eq "$generation" ] && \
    [ "$updated" -ge "$desired" ] && \
    [ "$available" -ge "$desired" ]
}

deadline=$(( $(date +%s) + READY_TIMEOUT_SECONDS ))
while ! deployment_ready "$WEB_DEPLOYMENT" "$WEB_READY_REPLICAS" || \
      ! deployment_ready "$JUDGE_DEPLOYMENT" "$JUDGE_READY_REPLICAS" || \
      ! deployment_ready "$PLATFORM_DEPLOYMENT" "$PLATFORM_READY_REPLICAS"; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "Timed out waiting for the new web and worker deployments" >&2
    exit 1
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done

if [ "$WEB_HPA_ENABLED" = true ]; then
  [ "$(kubectl_ns get horizontalpodautoscaler "$WEB_HPA" \
    -o 'jsonpath={.spec.scaleTargetRef.name}')" = "$WEB_DEPLOYMENT" ]
fi
if [ "$JUDGE_KEDA_ENABLED" = true ]; then
  [ -z "$(kubectl_ns get scaledobject "$JUDGE_KEDA_SCALED_OBJECT" \
    -o 'jsonpath={.metadata.annotations.autoscaling\.keda\.sh/paused-replicas}')" ]
fi

released=true
