#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RELEASE_OPERATION:?RELEASE_OPERATION is required}"

package_root="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$package_root"
PATH="$PATH:$package_root/node_modules/.bin"
export PATH

if [ "$RELEASE_OPERATION" = install ]; then
  exec prisma migrate deploy
fi
[ "$RELEASE_OPERATION" = upgrade ] || {
  echo "RELEASE_OPERATION must be install or upgrade" >&2
  exit 1
}

: "${NAMESPACE:?NAMESPACE is required}"
: "${WEB_DEPLOYMENT:?WEB_DEPLOYMENT is required}"
: "${WEB_POD_SELECTOR:?WEB_POD_SELECTOR is required}"
: "${JUDGE_DEPLOYMENT:?JUDGE_DEPLOYMENT is required}"
: "${JUDGE_POD_SELECTOR:?JUDGE_POD_SELECTOR is required}"
: "${PLATFORM_DEPLOYMENT:?PLATFORM_DEPLOYMENT is required}"
: "${PLATFORM_POD_SELECTOR:?PLATFORM_POD_SELECTOR is required}"
: "${WEB_HPA_ENABLED:=false}"
: "${JUDGE_KEDA_ENABLED:=false}"
: "${DRAIN_TIMEOUT_SECONDS:=300}"
: "${RESTORE_TIMEOUT_SECONDS:=300}"
: "${POLL_INTERVAL_SECONDS:=2}"
: "${STATUS_TIMEOUT_SECONDS:=10}"
: "${KUBECTL_REQUEST_TIMEOUT_SECONDS:=5}"

for timeout_value in \
  "$DRAIN_TIMEOUT_SECONDS" \
  "$RESTORE_TIMEOUT_SECONDS" \
  "$POLL_INTERVAL_SECONDS" \
  "$STATUS_TIMEOUT_SECONDS" \
  "$KUBECTL_REQUEST_TIMEOUT_SECONDS"; do
  case "$timeout_value" in
    ''|*[!0-9]*) echo "Release timeouts must be unsigned integers" >&2; exit 1 ;;
  esac
done
if [ "$DRAIN_TIMEOUT_SECONDS" -eq 0 ] || \
   [ "$RESTORE_TIMEOUT_SECONDS" -eq 0 ] || \
   [ "$STATUS_TIMEOUT_SECONDS" -eq 0 ] || \
   [ "$KUBECTL_REQUEST_TIMEOUT_SECONDS" -eq 0 ]; then
  echo "Drain, restore, and request timeouts must be greater than zero" >&2
  exit 1
fi

state_dir="$(mktemp -d "${TMPDIR:-/tmp}/nojv-release-cutover.XXXXXX")"
maintenance_started=false
restore_safe=true
child_pid=""
contract_migration=20260716000012_versioned_blob_pointers_contract

kubectl_ns() {
  kubectl --request-timeout="${KUBECTL_REQUEST_TIMEOUT_SECONDS}s" \
    --namespace "$NAMESPACE" "$@"
}

run_guarded() {
  setsid "$@" &
  child_pid=$!
  if wait "$child_pid"; then
    result=0
  else
    result=$?
  fi
  child_pid=""
  return "$result"
}

snapshot_replicas() {
  name="$1"
  value="$(kubectl_ns get deployment "$name" -o 'jsonpath={.spec.replicas}')"
  case "$value" in
    ''|*[!0-9]*) echo "Deployment $name has an invalid replica count: $value" >&2; exit 1 ;;
  esac
  printf '%s' "$value" > "$state_dir/$name.replicas"
}

restore_workloads() {
  echo "Pre-contract failure: restoring workloads and autoscalers." >&2
  restore_failed=false
  kubectl_ns scale deployment "$WEB_DEPLOYMENT" \
    --replicas="$(cat "$state_dir/$WEB_DEPLOYMENT.replicas")" || restore_failed=true
  kubectl_ns scale deployment "$JUDGE_DEPLOYMENT" \
    --replicas="$(cat "$state_dir/$JUDGE_DEPLOYMENT.replicas")" || restore_failed=true
  kubectl_ns scale deployment "$PLATFORM_DEPLOYMENT" \
    --replicas="$(cat "$state_dir/$PLATFORM_DEPLOYMENT.replicas")" || restore_failed=true

  if [ "$WEB_HPA_ENABLED" = true ]; then
    kubectl_ns patch horizontalpodautoscaler "$WEB_HPA" --type merge \
      -p "{\"spec\":{\"scaleTargetRef\":{\"name\":\"$(cat "$state_dir/web-hpa-target")\"}}}" || \
      restore_failed=true
  fi
  if [ "$JUDGE_KEDA_ENABLED" = true ]; then
    if [ -s "$state_dir/judge-keda-paused" ]; then
      kubectl_ns annotate scaledobject "$JUDGE_KEDA_SCALED_OBJECT" \
        "autoscaling.keda.sh/paused-replicas=$(cat "$state_dir/judge-keda-paused")" \
        --overwrite || restore_failed=true
    else
      kubectl_ns annotate scaledobject "$JUDGE_KEDA_SCALED_OBJECT" \
        autoscaling.keda.sh/paused-replicas- --overwrite || restore_failed=true
    fi
  fi

  deployment_ready() {
    deployment="$1"
    desired="$(cat "$state_dir/$deployment.replicas")"
    snapshot="$(kubectl_ns get deployment "$deployment" \
      -o 'jsonpath={.status.observedGeneration} {.metadata.generation} {.status.availableReplicas}')" || \
      return 1
    read -r observed generation available <<EOF
$snapshot
EOF
    observed="${observed:-0}"
    generation="${generation:-0}"
    available="${available:-0}"
    case "$observed:$generation:$available" in *[!0-9:]*) return 1 ;; esac
    [ "$observed" -eq "$generation" ] && [ "$available" -ge "$desired" ]
  }

  restore_deadline=$(( $(date +%s) + RESTORE_TIMEOUT_SECONDS ))
  while ! deployment_ready "$WEB_DEPLOYMENT" || \
        ! deployment_ready "$JUDGE_DEPLOYMENT" || \
        ! deployment_ready "$PLATFORM_DEPLOYMENT"; do
    if [ "$(date +%s)" -ge "$restore_deadline" ]; then
      echo "Timed out verifying restored web and worker deployments" >&2
      restore_failed=true
      break
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
  [ "$restore_failed" = false ]
}

cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$maintenance_started" = true ]; then
    if [ "$restore_safe" = true ]; then
      restore_workloads || echo "CRITICAL: workload restoration failed" >&2
    else
      echo "Storage compatibility may have changed; keeping workloads in maintenance." >&2
    fi
  fi
  rm -rf "$state_dir"
  exit "$status"
}
trap cleanup EXIT
terminate() {
  signal_status="$1"
  if [ -n "$child_pid" ]; then
    kill -TERM "-$child_pid" 2>/dev/null || kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
    child_pid=""
  fi
  exit "$signal_status"
}
trap 'terminate 130' INT
trap 'terminate 143' TERM

read_contract_status() {
  timeout "${STATUS_TIMEOUT_SECONDS}s" node --import tsx \
    prisma/scripts/storage-pointer-cutover.ts status
}

contract_status="$(read_contract_status)"
case "$contract_status" in
  applied) ;;
  pending) run_guarded sh prisma/scripts/deploy-expand.sh ;;
  recoverable)
    run_guarded prisma migrate resolve --rolled-back "$contract_migration"
    contract_status="$(read_contract_status)"
    [ "$contract_status" = pending ] || {
      echo "Storage contract history recovery did not restore a pending state" >&2
      exit 1
    }
    run_guarded sh prisma/scripts/deploy-expand.sh
    ;;
  unsafe) ;;
  *) echo "Unexpected storage contract status: $contract_status" >&2; exit 1 ;;
esac

snapshot_replicas "$WEB_DEPLOYMENT"
snapshot_replicas "$JUDGE_DEPLOYMENT"
snapshot_replicas "$PLATFORM_DEPLOYMENT"

if [ "$WEB_HPA_ENABLED" = true ]; then
  : "${WEB_HPA:?WEB_HPA is required when WEB_HPA_ENABLED=true}"
  hpa_target="$(kubectl_ns get horizontalpodautoscaler "$WEB_HPA" \
    -o 'jsonpath={.spec.scaleTargetRef.name}')"
  case "$hpa_target" in
    "$WEB_DEPLOYMENT"|"$WEB_DEPLOYMENT-maintenance") ;;
    *)
      echo "HPA $WEB_HPA targets unexpected deployment $hpa_target" >&2
      exit 1
      ;;
  esac
  printf '%s' "$hpa_target" > "$state_dir/web-hpa-target"
fi

if [ "$JUDGE_KEDA_ENABLED" = true ]; then
  : "${JUDGE_KEDA_SCALED_OBJECT:?JUDGE_KEDA_SCALED_OBJECT is required when JUDGE_KEDA_ENABLED=true}"
  kubectl_ns get scaledobject "$JUDGE_KEDA_SCALED_OBJECT" >/dev/null
  kubectl_ns get scaledobject "$JUDGE_KEDA_SCALED_OBJECT" \
    -o 'jsonpath={.metadata.annotations.autoscaling\.keda\.sh/paused-replicas}' \
    > "$state_dir/judge-keda-paused"
fi

maintenance_started=true
if [ "$WEB_HPA_ENABLED" = true ]; then
  kubectl_ns patch horizontalpodautoscaler "$WEB_HPA" --type merge \
    -p "{\"spec\":{\"scaleTargetRef\":{\"name\":\"$WEB_DEPLOYMENT-maintenance\"}}}"
fi
if [ "$JUDGE_KEDA_ENABLED" = true ]; then
  kubectl_ns annotate scaledobject "$JUDGE_KEDA_SCALED_OBJECT" \
    autoscaling.keda.sh/paused-replicas=0 --overwrite
fi

kubectl_ns scale deployment "$WEB_DEPLOYMENT" "$JUDGE_DEPLOYMENT" "$PLATFORM_DEPLOYMENT" \
  --replicas=0

assert_drained() {
  deployment="$1"
  selector="$2"
  snapshot="$(kubectl_ns get deployment "$deployment" \
    -o 'jsonpath={.spec.replicas} {.status.replicas}')"
  pods="$(kubectl_ns get pods --selector "$selector" --output name)"
  [ "$snapshot" = "0 " ] || [ "$snapshot" = "0 0" ] || return 1
  [ -z "$pods" ]
}

deadline=$(( $(date +%s) + DRAIN_TIMEOUT_SECONDS ))
while ! assert_drained "$WEB_DEPLOYMENT" "$WEB_POD_SELECTOR" || \
      ! assert_drained "$JUDGE_DEPLOYMENT" "$JUDGE_POD_SELECTOR" || \
      ! assert_drained "$PLATFORM_DEPLOYMENT" "$PLATFORM_POD_SELECTOR"; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "Timed out waiting for web and Temporal workers to finish draining" >&2
    exit 1
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done

if [ "$contract_status" = unsafe ]; then
  restore_safe=false
  echo "Cannot prove the legacy storage schema is intact; keeping workloads in maintenance." >&2
  exit 1
fi

if [ "$contract_status" = pending ]; then
  # Backfill mutates database rows that old code can subsequently overwrite.
  # From this point onward, restoring the old workloads could silently lose
  # rollback-window writes when the immutable pointers are contracted later.
  restore_safe=false
  run_guarded node --import tsx prisma/scripts/storage-pointer-cutover.ts backfill
  run_guarded node --import tsx prisma/scripts/storage-pointer-cutover.ts verify
  run_guarded node --import tsx prisma/scripts/storage-pointer-cutover.ts preflight
fi

assert_drained "$WEB_DEPLOYMENT" "$WEB_POD_SELECTOR"
assert_drained "$JUDGE_DEPLOYMENT" "$JUDGE_POD_SELECTOR"
assert_drained "$PLATFORM_DEPLOYMENT" "$PLATFORM_POD_SELECTOR"
if [ "$WEB_HPA_ENABLED" = true ]; then
  [ "$(kubectl_ns get horizontalpodautoscaler "$WEB_HPA" \
    -o 'jsonpath={.spec.scaleTargetRef.name}')" = "$WEB_DEPLOYMENT-maintenance" ]
fi
if [ "$JUDGE_KEDA_ENABLED" = true ]; then
  [ "$(kubectl_ns get scaledobject "$JUDGE_KEDA_SCALED_OBJECT" \
    -o 'jsonpath={.metadata.annotations.autoscaling\.keda\.sh/paused-replicas}')" = 0 ]
fi

restore_safe=false
run_guarded prisma migrate deploy

echo "Release migrations completed with old workloads held at zero." >&2
