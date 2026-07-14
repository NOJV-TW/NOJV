#!/bin/sh
set -eu

: "${NAMESPACE:?NAMESPACE is required}"
: "${WEB_DEPLOYMENT:?WEB_DEPLOYMENT is required}"
: "${WEB_HPA:?WEB_HPA is required}"
: "${WEB_POD_SELECTOR:?WEB_POD_SELECTOR is required}"
: "${DRAIN_TIMEOUT_SECONDS:=180}"
: "${POLL_INTERVAL_SECONDS:=2}"

kubectl --namespace "$NAMESPACE" delete horizontalpodautoscaler "$WEB_HPA" \
  --ignore-not-found=true --wait=true
kubectl --namespace "$NAMESPACE" scale deployment "$WEB_DEPLOYMENT" --replicas=0

deadline=$(( $(date +%s) + DRAIN_TIMEOUT_SECONDS ))
while true; do
  replicas="$(
    kubectl --namespace "$NAMESPACE" get deployment "$WEB_DEPLOYMENT" \
      -o 'jsonpath={.status.replicas}'
  )"
  pods="$(
    kubectl --namespace "$NAMESPACE" get pods --selector "$WEB_POD_SELECTOR" --output name
  )"
  if { [ -z "$replicas" ] || [ "$replicas" = 0 ]; } && [ -z "$pods" ]; then
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "Timed out draining $WEB_DEPLOYMENT (replicas=$replicas pods=$pods)" >&2
    exit 1
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done
