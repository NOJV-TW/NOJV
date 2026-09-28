#!/usr/bin/env bash
# nojv-reboot-recover: after a host reboot, force fresh app pods so that pods
# which survived the reboot with stale Calico/CNI networking are replaced.
# Fixes the recurring post-reboot 502 (web/worker can't reach redis/pg ClusterIPs).
set -uo pipefail
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
KUBECTL="/usr/local/bin/k3s kubectl"
log() { echo "[nojv-recover] $(date -Is) $*"; }

log "waiting for k3s API server to be ready"
for _ in $(seq 1 60); do
  $KUBECTL get --raw='/readyz' >/dev/null 2>&1 && break
  sleep 5
done

log "waiting for node Ready"
$KUBECTL wait --for=condition=Ready node --all --timeout=300s || log "WARN node not Ready, continuing"

log "waiting for Calico CNI (calico-node) Ready"
$KUBECTL wait --for=condition=Ready pod -l k8s-app=calico-node -n calico-system --timeout=300s || log "WARN calico-node not Ready, continuing"

# Let kube-proxy iptables / Calico datapath settle before recreating pods.
sleep 20

for ns in nojv nojv-temporal; do
  log "rollout restart deployments in namespace $ns"
  $KUBECTL rollout restart deploy -n "$ns" || log "WARN rollout restart failed in $ns"
done

log "waiting for nojv-web to become available"
$KUBECTL rollout status deploy/nojv-web -n nojv --timeout=300s || log "WARN nojv-web rollout did not complete"

log "recovery complete"
