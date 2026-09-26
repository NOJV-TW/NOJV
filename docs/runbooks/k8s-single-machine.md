# Single-Machine k3s

Procedure for running all of NOJV on one host with the Kubernetes sandbox
backend on k3s: Calico for NetworkPolicy, gVisor for sandbox Pods, the
`nojv` chart with `values-single-machine.yaml`, and Flux for releases.
Configuration reference, release mechanics and capacity numbers live in the
[Deployment Guide](../operations/DEPLOYMENT.md).

## Key code

- `infra/charts/nojv/values-single-machine.yaml`: overlay (in-cluster Postgres, Redis, MinIO, registry, cloudflared, metrics stack)
- `infra/k3s/`: containerd v3 template for `runsc`, `gvisor` RuntimeClass, kubelet drop-ins
- `infra/flux/`: GitOps release ([Flux guide](../../infra/flux/README.md))
- `apps/worker/src/sandbox/kubernetes/netpol-probe.ts`, `runtime-probe.ts`: startup fail-closed checks
- `infra/gcp/gke/temporal/helm-values.single-machine.yaml`: Temporal values

## Prerequisites

- One Linux host (Ubuntu 22.04+ or Debian 12) with root. The production overlay
  is sized for 8 vCPU / 16 GiB; 4 vCPU / 8 GiB is the practical floor with a
  smaller quota.
- `docker` on the host only if you build images locally.
- Off-host S3/R2 destinations and credentials for Postgres and MinIO backups
  (the chart will not render without them).

`sudo` drops `KUBECONFIG`, and Helm does not know the k3s kubeconfig path. After
installing k3s, link it for root so `sudo helm` works:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
sudo install -d -m 0700 /root/.kube
sudo ln -sfn /etc/rancher/k3s/k3s.yaml /root/.kube/config
```

## 1. Install k3s and Calico

k3s's default flannel does not enforce NetworkPolicy, and the judge worker
refuses to start without enforcement. Disable flannel and the built-in policy
controller:

```bash
curl -sfL https://get.k3s.io | sh -s - server \
  --flannel-backend=none \
  --disable-network-policy \
  --disable=traefik \
  --kubelet-arg=pod-max-pids=256 \
  --write-kubeconfig-mode=644
```

- `--disable=traefik`: the site is reached through the cloudflared tunnel.
- `pod-max-pids=256`: per-Pod PID limit. Never replace it with `ulimit -u`, which
  is shared by every container with the same host UID.
- Nodes stay `NotReady` until the CNI is installed.

Install Calico through the operator. The pool must equal k3s's cluster CIDR
(default `10.42.0.0/16`):

```bash
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.28.2/manifests/tigera-operator.yaml
kubectl create -f - <<'EOF'
apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  calicoNetwork:
    ipPools:
      - cidr: 10.42.0.0/16
        encapsulation: VXLANCrossSubnet
        natOutgoing: Enabled
EOF
kubectl wait --for=condition=Ready node --all --timeout=180s
kubectl get tigerastatus   # all AVAILABLE=True
```

Cilium (`cilium install --version 1.16.3`) also works; install only one.

## 2. Install gVisor

The chart requires `runtimeClassName: gvisor`; there is no `runc` fallback.

```bash
GVISOR_RELEASE=20260727
GVISOR_SHA512=94a7280655629330f02ff06fbec0493b7f2f4041dd145576daeff2340577cde0fb45fe28e5f1d209f7d7c08f70b9c3e333aa1073063b1d132742120763eaf0ad
ARCH=x86_64
REPO_ROOT="$(git rev-parse --show-toplevel)"
mkdir -p /tmp/gvisor-${GVISOR_RELEASE}
cd /tmp/gvisor-${GVISOR_RELEASE}
curl -fsSLO "https://storage.googleapis.com/gvisor/releases/release/${GVISOR_RELEASE}/${ARCH}/gvisor.tar.bz2"
printf '%s  gvisor.tar.bz2\n' "$GVISOR_SHA512" | sha512sum -c -
sudo tar -xjf gvisor.tar.bz2 -C /usr/local/bin
sudo install -m 0644 "$REPO_ROOT/infra/k3s/containerd/config-v3.toml.tmpl" \
  /var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.tmpl
sudo kubectl apply -f "$REPO_ROOT/infra/k3s/runtimeclass-gvisor.yaml"
sudo systemctl restart k3s
kubectl wait --for=condition=Ready node --all --timeout=180s
sudo grep -A2 "runtimes.'runsc'" /var/lib/rancher/k3s/agent/etc/containerd/config.toml
```

The template extends k3s's generated containerd v3 config with the `runsc`
handler. If the handler or RuntimeClass is missing, stop and repair the node.

## 3. Node labels and kubelet config

Sandbox Pods select `nojv-role=sandbox` and tolerate the sandbox taint. The
overlay sets no worker `nodeSelector`, so the single node needs only the sandbox
label and no taint:

```bash
NODE=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
kubectl label node "$NODE" nojv-role=sandbox --overwrite
```

### Kubelet image GC

Install the kubelet drop-ins (k3s merges `kubelet.conf.d/*.conf`):

```bash
sudo mkdir -p /var/lib/rancher/k3s/agent/etc/kubelet.conf.d
sudo cp infra/k3s/kubelet.conf.d/*.conf /var/lib/rancher/k3s/agent/etc/kubelet.conf.d/
sudo systemctl restart k3s
sudo kubectl get --raw "/api/v1/nodes/$(hostname)/proxy/configz" \
  | jq '.kubeletconfig | {imageGCHighThresholdPercent, imageGCLowThresholdPercent, imageMaximumGCAge, containerLogMaxSize, containerLogMaxFiles}'
```

| File                    | Settings                                               | Why                                                                                                     |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `90-image-gc.conf`      | GC at 75% / 65%, `imageMaximumGCAge: 168h`             | Teacher images accumulate; unused images are pruned after a week without disk pressure                  |
| `91-container-log.conf` | `containerLogMaxSize: 64Mi`, `containerLogMaxFiles: 2` | A case result line can carry the 16 MiB output cap; the 10 MiB default truncates it into a system error |

Restarting k3s briefly restarts the control plane; running Pods keep running.

### Host listeners

Nothing but SSH and the k3s/CNI ports may listen on the LAN address (OPS-08). Host
agents bind to loopback; netdata, when installed, needs `bind to = localhost` in
the `[web]` section of `/etc/netdata/netdata.conf` (Netdata Cloud uses its outbound
connection). Check with `sudo ss -ltn | grep -v '127.0.0.1'`.

## 4. Cluster prerequisites

### CloudNativePG operator

```bash
kubectl -n cnpg-system create configmap cnpg-controller-manager-config \
  --from-literal=ENABLE_INSTANCE_MANAGER_INPLACE_UPDATES=true \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply --server-side --force-conflicts -f \
  https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.30/releases/cnpg-1.30.1.yaml
kubectl -n cnpg-system rollout status deploy/cnpg-controller-manager
```

Production runs 1.30.1. The same two commands upgrade the operator (the
ConfigMap must exist before the new operator starts). With in-place updates the
operator swaps the instance manager inside the running Postgres pod instead of
restarting it: confirm the pod UID, `restartCount` and `pg_postmaster_start_time()`
are unchanged and the operator log says `Instance manager has been upgraded`.
Move one minor version at a time, read the release notes first (1.31 removes
in-tree `barmanObjectStore`), and take a `pg_dump -Fc` of every database while
production has no base backups.

### Temporal

Temporal uses the app's CNPG cluster (`nojv-pg-rw`), so install it once the
chart's Postgres is ready; workers stay unready until Temporal answers. Create the `temporal` role and databases and the
`temporal-postgres-secret` Secret as in
[Temporal HA](../../infra/gcp/gke/temporal/HA-PRODUCTION.md#database-bootstrap),
then install with the task-queue dynamic config (priority matcher, fairness, one
partition per NOJV queue; see [Judge Queue](judge-queue.md)):

```bash
helm repo add temporal https://go.temporal.io/helm-charts
helm upgrade --install temporal temporal/temporal -n nojv-temporal --create-namespace \
  -f infra/gcp/gke/temporal/helm-values.single-machine.yaml \
  --set server.nodeSelector.nojv-role=sandbox \
  --set-json 'server.dynamicConfig={"matching.enableFairness":[{"value":true}],"matching.useNewMatcher":[{"value":true}],"matching.numTaskqueueWritePartitions":[{"value":1,"constraints":{"taskQueueName":"judge"}},{"value":1,"constraints":{"taskQueueName":"judge-state"}},{"value":1,"constraints":{"taskQueueName":"platform"}}],"matching.numTaskqueueReadPartitions":[{"value":1,"constraints":{"taskQueueName":"judge"}},{"value":1,"constraints":{"taskQueueName":"judge-state"}},{"value":1,"constraints":{"taskQueueName":"platform"}}]}'
```

The override replaces the file's `nojv-role: worker` selector, which the single
node cannot satisfy, with the node's own `nojv-role=sandbox` label, as on the
production release. To lower partitions on a running server, lower the write count first, wait for
`temporal task-queue describe` to show no backlog, then lower the read count.

### Runtime Secret

```bash
cp infra/charts/nojv/secret.example.yaml secret.local.yaml   # fill in; never commit
kubectl create namespace nojv
kubectl -n nojv apply -f secret.local.yaml
```

`DATABASE_URL` points at the CNPG `-rw` Service
(`postgresql://nojv:<pw>@nojv-pg-rw.nojv.svc.cluster.local:5432/nojv`, password
from the operator's `nojv-pg-app` Secret); the in-cluster Redis and MinIO hosts
are the defaults in `secret.example.yaml`.

### Backups and production values

The overlay enables the CNPG `ScheduledBackup` and the MinIO off-host mirror and
fails to render until their destinations and credential Secrets are set. Put the
`postgres.cnpg.backup.*` and `storage.minio.backup.*` values in a private
`production-values.yaml` (shape in the [Flux guide](../../infra/flux/README.md#bootstrap))
and complete a restore drill before going live
([Backup & Restore](backup-restore.md)). Flux reads the same values from the
`nojv-production-values` Secret.

MinIO data sits on the chart-created `nojv-minio-retain` StorageClass
(`reclaimPolicy: Retain`); the class and PVC carry Helm's `keep` policy. Verify:
`kubectl get storageclass nojv-minio-retain -o jsonpath='{.reclaimPolicy}'`
prints `Retain`. Retention is not a backup.

### Edge tunnel

Create the tunnel token Secret; the chart runs cloudflared against it:

```bash
kubectl -n nojv create secret generic nojv-cloudflared-token --from-literal=token=<tunnel-token>
```

In the Cloudflare Zero Trust dashboard, add public hostnames on that tunnel: the
site to `http://nojv-web.nojv.svc.cluster.local:80` and `registry.nojv.tw` to
`http://nojv-registry.nojv.svc.cluster.local:5000`. Do not expose web through a
NodePort or other non-Cloudflare path (OPS-08).

### Registry

Token access rules are in the
[Deployment Guide](../operations/DEPLOYMENT.md#self-hosted-registry). Generate
the signing pair and judge pull account:

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -days 3650 -keyout token.key -out token.crt -subj "/CN=nojv-registry-token"
# runtime Secret: REGISTRY_TOKEN_PRIVATE_KEY (token.key), REGISTRY_TOKEN_CERT (token.crt),
# and a random REGISTRY_HTTP_SECRET of at least 32 characters

node -e 'const c=require("crypto");const s=c.randomBytes(24).toString("base64url");console.log("password:",s,"\nhash:",c.createHash("sha256").update(s).digest("base64url"))'
# runtime Secret: REGISTRY_PULL_PASSWORD_HASH (the hash)
# after the chart has created the nojv-sandbox namespace:
kubectl -n nojv-sandbox create secret docker-registry nojv-registry-pull \
  --docker-server=registry.nojv.tw --docker-username=judge-pull \
  --docker-password=<the password>
```

Teachers `docker login registry.nojv.tw` with credentials issued from the
problem editor. Cloudflare's free tier caps a request body at 100 MB, so larger
layers fail to push.

The seed's special_env demo problem needs `SEED_ADVANCED_RUN_IMAGE` and
`SEED_ADVANCED_GRADE_IMAGE`. Publish them with `pnpm demo-advanced:push` (see
`infra/docker/demo-advanced-run/README.md`) to a namespace your credential can
push, before the first install. This is manual: Cloudflare bot protection blocks
GitHub-hosted runners.

## 5. Install the chart

Production installs through Flux: follow the
[Flux guide](../../infra/flux/README.md#bootstrap). The HelmRelease supplies the
digest-pinned images from the `deploy` branch.

A direct install must pass the same pinned values:

```bash
helm upgrade --install nojv infra/charts/nojv -n nojv \
  -f infra/charts/nojv/values-single-machine.yaml \
  -f production-values.yaml \
  --set image.tag=<vX.Y.Z> \
  --set-string release.sourceSha=<40-character-source-sha> \
  --set-string image.digests.web=<sha256:...> \
  --set-string image.digests.worker=<sha256:...> \
  --set-string image.digests.sandbox=<sha256:...> \
  --set-string image.digests.migrator=<sha256:...>
```

The migrator hook runs before workloads start; there is no manual migration
step. On first install the post-install seed hook creates the super admin from
`SEED_ADMIN_*`.

### Local-only images

For a throwaway cluster, build and import unpinned images. With this overlay the
chart expects the names `nojv-<component>:local`:

```bash
docker build -t nojv-sandbox:local  -f infra/docker/sandbox-runner.Dockerfile .
docker build -t nojv-worker:local   -f infra/docker/worker.Dockerfile .
docker build -t nojv-web:local      -f infra/docker/web.Dockerfile .
docker build -t nojv-migrator:local -f infra/docker/migrator.Dockerfile .
for img in nojv-sandbox nojv-worker nojv-web nojv-migrator; do
  docker save "$img:local" | sudo k3s ctr images import -
done
sudo k3s ctr images ls | grep ':local'

helm upgrade --install nojv infra/charts/nojv -n nojv \
  -f infra/charts/nojv/values-single-machine.yaml \
  -f production-values.yaml \
  --set image.allowUnpinnedLocalBuilds=true \
  --set-string image.registry= \
  --set-string image.repositoryPrefix= \
  --set-string image.tag=local
```

On kind use `kind load docker-image` instead of `ctr images import`. The
`release-prepull` hook pulls web and worker with `imagePullPolicy: Always`, so
it cannot use images that exist only in containerd.

## 6. Verify

```bash
kubectl rollout status deploy/nojv-worker -n nojv
kubectl logs -n nojv deploy/nojv-worker | grep -i "NetworkPolicy"
# Expect: NetworkPolicy enforcement verified — sandbox egress is isolated
```

`CRITICAL: refusing to start K8s judge worker` means NetworkPolicy or gVisor
verification failed; fix [§1](#1-install-k3s-and-calico) or
[§2](#2-install-gvisor) before judging. The probe creates two internal targets
and temporary allow/deny policies, needs no Internet route, and removes its
resources afterwards.

Smoke test:

1. Submit a simple standard problem through the site.
2. `kubectl get jobs,pods -n nojv-sandbox -w`: a `judge-<runId>` Job runs,
   completes and is removed after its TTL; the verdict appears on the submission.
3. If Jobs stay `Pending`, check `kubectl describe quota -n nojv-sandbox` and the
   node's `nojv-role=sandbox` label.

## 7. Capacity

Judging is one Pod per stage, bounded by the `nojv-sandbox` ResourceQuota and the
node's allocatable resources; a quota rejection waits as `waiting_capacity`.
The overlay values are in the
[Deployment Guide](../operations/DEPLOYMENT.md#capacity); slot and quota sizing
is in [Judge Queue](judge-queue.md). Change `worker.judge.concurrency` and
`sandbox.resourceQuota.*` together in the overlay and release; the chart refuses
slot counts whose CPU exceeds the quota. Keep one judge and one platform
replica: extra replicas add dispatch slots, not host capacity. One node cannot
autoscale; for more capacity add nodes (§8) or use GKE.

## 8. Adding nodes

```bash
sudo cat /var/lib/rancher/k3s/server/node-token             # on the server
curl -sfL https://get.k3s.io | K3S_URL=https://<server-ip>:6443 \
  K3S_TOKEN=<node-token> sh -s - --kubelet-arg=pod-max-pids=256   # on the new node
```

Then install gVisor on the new node (§2), and from the server dedicate it to
sandboxes:

```bash
kubectl label node <new-node> nojv-role=sandbox --overwrite
kubectl taint node <new-node> nojv-role=sandbox:NoSchedule --overwrite
```

The taint keeps web and workers off the new node. Calico covers new nodes
automatically; restart the judge worker once to re-run the probe. Raise the
quota to the new aggregate capacity.
