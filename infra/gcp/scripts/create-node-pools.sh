#!/usr/bin/env bash
set -euo pipefail

# Creates the two node pools the GKE worker topology depends on:
#   pool-worker   — untainted, labelled nojv-role=worker, static. Runs the
#                   Temporal worker(s) + self-hosted Temporal control plane.
#   pool-sandbox  — tainted nojv-role=sandbox:NoSchedule, labelled
#                   nojv-role=sandbox, autoscaling 0 → N. Runs only sandbox Jobs.
#
# WHY THIS IS A SCRIPT (and not just docs): without an autoscaling
# `nojv-role=sandbox` pool, every sandbox Job stays Pending forever and judging
# *silently* fails to schedule — the manifests apply cleanly and nothing errors.
# Run this BEFORE `kubectl apply -k infra/gcp/gke`. Idempotent-ish: re-running
# errors on an already-existing pool, which is safe to ignore.
#
# See infra/gcp/gke/README.md for the topology rationale.

: "${CLUSTER_NAME:?CLUSTER_NAME is required}"
: "${REGION:?REGION is required}"
PROJECT_ID="${PROJECT_ID:-}"
WORKER_MACHINE_TYPE="${WORKER_MACHINE_TYPE:-e2-standard-2}"
SANDBOX_MACHINE_TYPE="${SANDBOX_MACHINE_TYPE:-e2-standard-4}"
SANDBOX_MAX_NODES="${SANDBOX_MAX_NODES:-5}"

PROJECT_FLAG=()
[ -n "$PROJECT_ID" ] && PROJECT_FLAG=(--project "$PROJECT_ID")

echo "[1/2] Creating pool-worker (static, untainted, nojv-role=worker)"
gcloud container node-pools create pool-worker \
  "${PROJECT_FLAG[@]}" \
  --cluster="${CLUSTER_NAME}" --region="${REGION}" \
  --num-nodes=2 --machine-type="${WORKER_MACHINE_TYPE}" \
  --node-labels=nojv-role=worker

echo "[2/2] Creating pool-sandbox (autoscale 0→${SANDBOX_MAX_NODES}, tainted nojv-role=sandbox)"
gcloud container node-pools create pool-sandbox \
  "${PROJECT_FLAG[@]}" \
  --cluster="${CLUSTER_NAME}" --region="${REGION}" \
  --num-nodes=0 --enable-autoscaling --min-nodes=0 --max-nodes="${SANDBOX_MAX_NODES}" \
  --machine-type="${SANDBOX_MACHINE_TYPE}" \
  --node-labels=nojv-role=sandbox \
  --node-taints=nojv-role=sandbox:NoSchedule

echo "Done. Verify with:"
echo "  gcloud container node-pools list --cluster=${CLUSTER_NAME} --region=${REGION}"
