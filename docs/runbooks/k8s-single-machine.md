# Single-Machine k3s Deployment + Autoscaling

Run the **whole** NOJV judge on **one box** using the Kubernetes sandbox
backend (`EXECUTION_BACKEND=kubernetes`) on [k3s](https://k3s.io). You get
per-submission Pod autoscaling (judge Pods spin up on load and scale to zero
when idle) now, and a clean upgrade path to multi-node later — without GKE.

This deploys the **same Helm chart** (`infra/charts/nojv`) used for GKE, with the
single-machine values overlay (`infra/charts/nojv/values-single-machine.yaml`);
the only deltas are the CNI, the node labels, how images get into the cluster,
and a single-node Temporal (the chart brings up in-cluster Postgres/Redis/MinIO).

For the managed-cloud (GKE) path instead, see
[Deployment Guide → GKE Worker Rollout](../operations/DEPLOYMENT.md#gke-worker-rollout).
The spectrum is: **single-node k3s** (this runbook) → **multi-node k3s**
(`k3s agent` join, [§9](#9-scaling-from-one-node-to-many)) → **GKE** (elastic
node pools).

## ⚠️ Hard security requirement: a NetworkPolicy-enforcing CNI

> **k3s's default flannel CNI does NOT enforce NetworkPolicy.** On the
> Kubernetes backend, ALL sandbox egress isolation — the `deny-all-sandbox`
> policy and the per-submission egress policies — is **inert** unless the CNI
> actually enforces NetworkPolicy. On a non-enforcing CNI every sandbox Pod can
> reach the internet, letting students fetch outside help.

The worker now **fails closed**: at startup, when
`EXECUTION_BACKEND=kubernetes`, it launches a deny-all-covered probe Pod and
**refuses to start the judge worker** if that Pod can reach the internet
(`apps/worker/src/services/k8s-netpol-probe.ts`, wired in
`apps/worker/src/worker-app.ts`). So if you skip the CNI step below, the worker
will not judge — by design.

The fix (detailed in [§1](#1-install-k3s-without-flannel--install-calico)):
install k3s with `--flannel-backend=none --disable-network-policy`, then
install **Calico** (or Cilium) which does enforce NetworkPolicy.

## Prerequisites

- One Linux host (Ubuntu 22.04+ / Debian 12 assumed below) with root.
- Sizing — judge concurrency is bounded by the sandbox ResourceQuota
  ([§3](#3-sandbox-namespace--guardrails) / [§8](#8-autoscaling)). A practical
  floor is **4 vCPU / 8 GiB**; **8 vCPU / 16 GiB** runs a real class comfortably.
- `docker` on the host **only** to `docker save` images into k3s
  ([§4](#4-load-images-into-k3s-containerd-not-docker)). k3s itself runs on
  containerd, not Docker.

Throughout, run `kubectl` either via the bundled `k3s kubectl ...` or by
exporting the k3s kubeconfig once:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

## 1. Install k3s without flannel + install Calico

Install the k3s **server** (control plane + node) with flannel and the built-in
non-enforcing network-policy controller **both disabled**, so Calico owns the
dataplane:

```bash
curl -sfL https://get.k3s.io | sh -s - server \
  --flannel-backend=none \
  --disable-network-policy \
  --disable=traefik \
  --write-kubeconfig-mode=644

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

`--disable=traefik` drops the bundled ingress (NOJV's web app is reached
directly / behind your own reverse proxy; not needed for judging). Nodes stay
`NotReady` until a CNI is installed — that is expected at this point.

Install **Calico** (the operator + default `Installation`):

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
```

`10.42.0.0/16` is k3s's default cluster CIDR — keep it unless you changed
`--cluster-cidr`. Wait for Calico and the node to go Ready:

```bash
kubectl wait --for=condition=Ready node --all --timeout=180s
kubectl get tigerastatus   # all should report AVAILABLE=True
```

> **Cilium alternative.** Instead of Calico, install Cilium with the same k3s
> flags: `cilium install --version 1.16.3` (after installing the `cilium` CLI).
> Cilium also enforces NetworkPolicy. Pick one; do not install both.

### Verify enforcement (the same check the worker runs at startup)

The deny-all policy and the `nojv-sandbox` namespace are rendered by the chart
(`infra/charts/nojv/templates/sandbox-policy.yaml` + `templates/namespaces.yaml`),
so run this check **after** [§6](#6-install-the-chart) installs the chart. Launch
a throwaway Pod carrying the sandbox's `nojv.egress`-absent shape so the
`deny-all-sandbox` policy applies, and confirm it **cannot** reach the internet:

```bash
kubectl run egress-check -n nojv-sandbox --rm -i --restart=Never \
  --image=curlimages/curl --labels=app=nojv-sandbox \
  --overrides='{"spec":{"tolerations":[{"key":"nojv-role","operator":"Equal","value":"sandbox","effect":"NoSchedule"}],"nodeSelector":{"nojv-role":"sandbox"}}}' \
  --command -- curl -sS --max-time 5 https://1.1.1.1
```

**Expected:** the `curl` times out and the Pod exits non-zero — egress is
blocked. If it returns a response, NetworkPolicy enforcement is OFF: **stop**
and fix the CNI before judging anything. (The deny-all `podSelector` matches
every sandbox Pod **except** those labelled `nojv.egress=<value>`, which are the
advanced run/grade Pods governed by their own per-submission policy — see
`infra/charts/nojv/templates/sandbox-policy.yaml`.)

The worker's startup self-check performs exactly this probe automatically, so
even if you skip the manual check, a non-enforcing cluster cannot judge.

## 2. Node setup

Label the single node so it matches the sandbox `nodeSelector`
(`{ "nojv-role": "sandbox" }`) that `k8s-advanced.ts` / the netpol probe set:

```bash
NODE=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
kubectl label node "$NODE" nojv-role=sandbox --overwrite
```

The worker Deployments carry the `nojv-role: worker` Pod label
(`infra/charts/nojv/templates/worker-judge.deployment.yaml` /
`worker-platform.deployment.yaml`); on GKE they are also pinned to a worker node
pool via `worker.judge.nodeSelector` / `worker.platform.nodeSelector`. On a
**single** node that node must satisfy both the worker and sandbox roles, so also
add the worker label:

```bash
kubectl label node "$NODE" nojv-role=worker --overwrite
```

**Taints are optional on single-node** and intentionally skipped here. On GKE
the sandbox pool is tainted `nojv-role=sandbox:NoSchedule` so a runaway
submission can't starve the orchestrator — but on one box there is nowhere else
for the worker to run, so tainting would only block it. Sandbox Pods already
carry the matching toleration (`k8s-advanced.ts` `SANDBOX_TOLERATIONS`), so they
schedule fine whether or not the taint exists. Re-introduce the taint only once
you join a dedicated sandbox node ([§9](#9-scaling-from-one-node-to-many)).

### Kubelet image GC

Teacher-provided special_env images accumulate on the node and the kubelet
defaults (GC only above 85% disk) never fire on a box that runs well below
that. Install the drop-in from `infra/k3s/kubelet.conf.d/90-image-gc.conf`
(k3s ≥ v1.29 merges `/var/lib/rancher/k3s/agent/etc/kubelet.conf.d/*.conf`
over its generated defaults):

```bash
sudo cp infra/k3s/kubelet.conf.d/90-image-gc.conf \
  /var/lib/rancher/k3s/agent/etc/kubelet.conf.d/90-image-gc.conf
sudo systemctl restart k3s
```

This sets `imageGCHighThresholdPercent: 75` / `imageGCLowThresholdPercent: 65`
and `imageMaximumGCAge: 168h`, so images unused for a week are pruned even
without disk pressure. Restarting k3s bounces the control plane briefly;
running Pods keep running. Verify with
`sudo k3s kubectl get --raw "/api/v1/nodes/$(hostname)/proxy/configz" | jq .kubeletconfig.imageMaximumGCAge`.

## 3. Sandbox namespace + guardrails

You do **not** apply these by hand — the chart renders them. The
`helm upgrade --install` in [§6](#6-install-the-chart) creates the sandbox
namespace, the deny-all NetworkPolicy, the LimitRange, and the ResourceQuota from
`infra/charts/nojv/templates/sandbox-policy.yaml` +
`templates/namespaces.yaml`:

- **`namespaces.yaml`** — `nojv` (app) + `nojv-sandbox`.
- **`deny-all-sandbox` NetworkPolicy** — no ingress, no egress, no DNS for every
  sandbox Pod without an `nojv.egress` label (gated by
  `sandbox.networkPolicy.enabled`, on by default).
- **LimitRange** — default/`max`/`min` CPU & memory per sandbox container
  (default `1` CPU / `512Mi`, max `2` CPU / `1Gi`), tunable via
  `sandbox.limitRange.*`.
- **ResourceQuota** — the single-machine overlay sets `pods: 10`,
  `requests.cpu: 4`, `requests.memory: 4Gi` (the shared default is 50 / 25 /
  12Gi). **This is the concurrency ceiling**: the worker can never have more
  sandbox Pods running than the quota allows; excess Jobs queue as `Pending`
  until earlier ones finish. Tune it for the box via `sandbox.resourceQuota.*`
  in your values overlay — [§8](#sizing-the-resourcequota-to-the-box).

## 4. Load images into k3s (containerd, not Docker)

k3s uses **containerd**, so a `docker build` on the host is invisible to it.
Build, then import via `k3s ctr images import` from a `docker save` tarball.

**Tag to match the chart's composed image ref.** The single-machine overlay sets
`image.registry: ""`, `image.repositoryPrefix: nojv`, `image.tag: latest` with
per-component repos `web` / `worker` / `sandbox` / `egress-proxy` / `migrator`
(`image.repositories.*`), so the chart references the bare names
`nojv/web:latest`, `nojv/worker:latest`, `nojv/sandbox:latest`,
`nojv/egress-proxy:latest`, and `nojv/migrator:latest`. Build with exactly those
tags:

```bash
# Sandbox runtime (SANDBOX_IMAGE)
docker build -t nojv/sandbox:latest -f infra/docker/sandbox-runner.Dockerfile .
# Egress proxy (EGRESS_PROXY_IMAGE — used by advanced allowlist/service modes)
docker build -t nojv/egress-proxy:latest -f infra/docker/egress-proxy/Dockerfile infra/docker/egress-proxy
# Worker, web, and migrator app images
docker build -t nojv/worker:latest   -f infra/docker/worker.Dockerfile .
docker build -t nojv/web:latest      -f infra/docker/web.Dockerfile .
docker build -t nojv/migrator:latest -f infra/docker/migrator.Dockerfile .
```

Import each into k3s's containerd:

```bash
for img in nojv/sandbox:latest nojv/egress-proxy:latest nojv/worker:latest nojv/web:latest nojv/migrator:latest; do
  docker save "$img" | sudo k3s ctr images import -
done
sudo k3s ctr images ls | grep nojv   # confirm all five are present
```

On **kind**, load the same tags with `kind load docker-image nojv/web:latest …`
instead of `ctr import`. The chart sets each Pod's `imagePullPolicy`, so the
kubelet uses the imported image rather than trying to pull these
not-in-a-registry tags.

> **Alternative — a tiny in-cluster registry.** If you'd rather push than
> `ctr import`, run one: `docker run -d -p 5000:5000 --name registry registry:2`,
> tag images `localhost:5000/nojv-*`, `docker push`, and reference them by that
> ref (add `localhost:5000` to k3s's `/etc/rancher/k3s/registries.yaml`
> `mirrors` so it pulls insecurely). This also matters for **advanced
> (`special_env`) problems**: advanced run/grade images are registry-only —
> point them at a registry the cluster can pull (a local one is fine).

## 5. Prerequisites the chart does not install

The chart brings up the **app** Postgres (CloudNativePG), Redis, and MinIO
itself — all enabled by default in the single-machine overlay (`postgres.mode:
cnpg`, `redis.inCluster: true`, `storage.inCluster: true`). Two dependencies are
deliberately **not** vendored and must exist before you `helm install`:

**a. The CloudNativePG operator** (one-time, cluster-wide). The chart renders a
CNPG `Cluster` CR for the app Postgres but does not ship the operator or its
CRDs, so install it first:

```bash
kubectl apply --server-side -f \
  https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.24/releases/cnpg-1.24.0.yaml
kubectl -n cnpg-system rollout status deploy/cnpg-controller-manager
```

**b. Temporal Server**, installed via the **official Temporal Helm chart**. For
a single box a **single-replica** Temporal is fine — use the official chart with
`replicaCount 1` (or the all-in-one `temporalio/auto-setup` image), in namespace
`nojv-temporal`, reachable at
`temporal-frontend.nojv-temporal.svc.cluster.local:7233` (the chart's
`temporal.address` default):

```bash
helm repo add temporal https://go.temporal.io/helm-charts
kubectl create namespace nojv-temporal
helm upgrade --install temporal temporal/temporal -n nojv-temporal \
  --set server.replicaCount=1
```

For an HA Temporal (production multi-node), see
[`infra/gcp/gke/temporal/HA-PRODUCTION.md`](../../infra/gcp/gke/temporal/HA-PRODUCTION.md).

> **App Postgres is not in a sandbox namespace** — the CNPG `Cluster` lives in
> `nojv`, so the `deny-all-sandbox` policy does not touch it; the worker reaches
> it over normal cluster networking.

**Backups.** The single-machine overlay leaves CNPG backups off
(`postgres.cnpg.backup.enabled: false`). Before going live, enable the CNPG
`ScheduledBackup` (`postgres.cnpg.backup.enabled=true` plus a barman-cloud
destination) — see the
[Backup & Restore Runbook](backup-restore.md) for the destination/credential
setup and restore drills.

The **migrator** runs automatically as a pre-install/pre-upgrade Helm hook
(`infra/charts/nojv/templates/migrator.job.yaml`), so there is no manual
migration step — the schema is current before web/workers roll.

**c. Registry secrets + pull secret** (only when `registry.enabled`, the
single-machine default). The self-hosted registry (special_env judge images)
needs three keys in the runtime secret and one dockerconfigjson Secret in the
sandbox namespace:

```bash
# Token-auth signing pair (web signs, registry verifies):
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -days 3650 -keyout token.key -out token.crt -subj "/CN=nojv-registry-token"
# → runtime secret keys REGISTRY_TOKEN_PRIVATE_KEY (token.key),
#   REGISTRY_TOKEN_CERT (token.crt), plus a random REGISTRY_HTTP_SECRET.

# Judge pull account (password → hash in runtime secret, plaintext → pull secret):
node -e 'const c=require("crypto");const s=c.randomBytes(24).toString("base64url");console.log("password:",s,"\nhash:",c.createHash("sha256").update(s).digest("base64url"))'
# → runtime secret key REGISTRY_PULL_PASSWORD_HASH (the hash), and:
kubectl -n nojv-sandbox create secret docker-registry nojv-registry-pull \
  --docker-server=registry.nojv.tw --docker-username=judge-pull \
  --docker-password=<the password>
# Demo push account (`ci-push`, scoped to demo/**): same recipe →
# REGISTRY_CI_PASSWORD_HASH. Used by an operator running `pnpm demo-advanced:push`
# after `docker login registry.nojv.tw -u ci-push` — the seed's special_env demo
# problem references these images, so publish them before (re)running a seed
# that includes it. Not wired into CI: demo problems are optional seed content,
# and Cloudflare's bot protection blocks GitHub-hosted runners anyway.
```

Expose the registry publicly by adding a `registry.nojv.tw` hostname to the
Cloudflare tunnel (Zero Trust dashboard → the existing tunnel → Public
Hostnames → service `http://nojv-registry.nojv.svc.cluster.local:5000`).
Teachers `docker login registry.nojv.tw` with credentials issued from the
problem editor; judge pods pull via the `nojv-registry-pull` secret. Note the
Cloudflare free tier caps a single request body at 100 MB — image layers larger
than that fail to push (split layers).

## 6. Install the chart

Create the runtime secret, then install the chart with the single-machine
overlay.

The chart never templates secret values: it reads `DATABASE_URL`, `REDIS_URL`,
`S3_*`, and the web auth/OAuth keys from an existing `Secret` (default name
`nojv-runtime-secrets`, set by `secrets.runtimeSecretName`). Copy
[`infra/charts/nojv/secret.example.yaml`](../../infra/charts/nojv/secret.example.yaml),
fill it in, and apply it into the `nojv` namespace (the chart creates that
namespace, so create it here first for the secret):

```bash
cp infra/charts/nojv/secret.example.yaml secret.local.yaml   # fill in; never commit
kubectl create namespace nojv
kubectl -n nojv apply -f secret.local.yaml
```

With `postgres.mode: cnpg` the operator generates a `nojv-pg-app` Secret holding
the owner password; point `DATABASE_URL` in your secret at the CNPG `-rw`
service: `postgresql://nojv:<pw>@nojv-pg-rw.nojv.svc.cluster.local:5432/nojv`.
The in-cluster Redis/MinIO service hosts (`nojv-redis` / `nojv-minio`) are
likewise the defaults in `secret.example.yaml`.

Then install:

```bash
helm upgrade --install nojv infra/charts/nojv \
  -f infra/charts/nojv/values-single-machine.yaml \
  -n nojv --create-namespace
```

This renders everything from [§3](#3-sandbox-namespace--guardrails) (sandbox
namespace + guardrails), the worker RBAC (SA + Role to manage Jobs in
`nojv-sandbox`), the judge worker (`worker.judge.replicas: 1`) and platform
worker (`worker.platform.replicas: 1`), the web Deployment + Service, and the
in-cluster Postgres/Redis/MinIO. The migrator hook ([§5](#5-prerequisites-the-chart-does-not-install))
runs first.

The chart sets **all** required worker env: the Kubernetes variant of
`parseWorkerEnv` (`apps/worker/src/env.ts`) mandates `K8S_NAMESPACE`, the four
`K8S_*` sandbox-Pod limits, and `EGRESS_PROXY_IMAGE`, all wired from
`worker.sandbox.{cpuRequest,cpuLimit,memoryRequest,memoryLimit}` and the image
values. You don't hand-set any of it.

> **Do NOT set `NOJV_ALLOW_UNENFORCED_NETWORK_POLICY`.** It is the dev-only
> opt-out for the startup CNI self-check. On this deployment Calico enforces
> NetworkPolicy, so the check passes on its own. Setting it would let the worker
> judge on a non-enforcing cluster — never do that outside a throwaway dev box.

The single-machine overlay disables the web Ingress (`web.ingress.enabled:
false`), so reach web through its `Service` (`nojv-web` in the `nojv` namespace)
— `kubectl port-forward svc/nojv-web` or a NodePort, behind your own reverse
proxy if exposing it.

Watch the worker come up and confirm the CNI self-check passed:

```bash
kubectl rollout status deploy/nojv-worker -n nojv
kubectl logs -n nojv deploy/nojv-worker | grep -i "NetworkPolicy"
# Expect: "NetworkPolicy enforcement verified — sandbox egress is isolated"
```

If instead you see `CRITICAL: refusing to start K8s judge worker`, the CNI is
not enforcing — go back to [§1](#1-install-k3s-without-flannel--install-calico).

Now run the [§1 egress verification](#verify-enforcement-the-same-check-the-worker-runs-at-startup),
which needs the chart-created `nojv-sandbox` namespace + deny-all policy.

## 7. Smoke check

1. **Submit one problem** through web (a simple standard A+B problem is enough).
2. **Watch a judge Job appear and finish** in the sandbox namespace:

   ```bash
   kubectl get jobs,pods -n nojv-sandbox -w
   ```

   You should see a `judge-<submissionId>-...` Job go `Running → Completed` and
   its Pod disappear shortly after (`ttlSecondsAfterFinished`). The verdict shows
   up on the submission page.

3. **Re-confirm egress is blocked** (the same probe as
   [§1](#verify-enforcement-the-same-check-the-worker-runs-at-startup)) — it must
   still time out.

If Jobs sit `Pending`, check the ResourceQuota (`kubectl describe quota -n
nojv-sandbox`) and that the node has the `nojv-role=sandbox` label.

## 8. Autoscaling

Three independent layers scale separately. Tune them in this order.

### Layer 1 — Judge work (inherent, no config)

Judging is **per-submission Kubernetes Jobs/Pods**. The worker creates one Job
per submission (`k8s-advanced.ts`, `k8s-executor.ts`); each runs in a fresh Pod
that **dies when finished** (`restartPolicy: Never`, `ttlSecondsAfterFinished`).
So the judge layer **scales up with load and scales to zero when idle
automatically** — there is nothing to configure and no idle cost.

Concurrency is bounded by two things:

- the **`nojv-sandbox` ResourceQuota** (`pods` / `requests.cpu` /
  `requests.memory`) — the hard ceiling; excess Jobs queue `Pending`;
- the **node's** real CPU/memory — Pods only run if the node can fit their
  requests.

#### Sizing the ResourceQuota to the box

Each sandbox Pod requests `worker.sandbox.cpuRequest` /
`worker.sandbox.memoryRequest` (defaults `500m` / `256Mi`). Reserve ~1–2 vCPU
and ~2 GiB for the OS + k3s + worker + in-cluster deps, then divide the rest. On
an **8 vCPU / 16 GiB** box, set these in your values overlay:

```yaml
# values overlay — single-node ResourceQuota tuning
sandbox:
  resourceQuota:
    pods: "12" # ≈ (16Gi − ~3Gi headroom) / 256Mi, capped by CPU below
    requestsCpu: "6" # 8 − ~2 for system/worker/deps
    requestsMemory: "8Gi"
```

Pick the **smaller** of the CPU-bound and memory-bound limits as `pods`. Raise
`worker.judge.concurrency` (max 64) to at least the Pod ceiling so the
orchestrator can actually dispatch that many in parallel — but the quota, not
the worker, is the real cap. Apply changes by editing the overlay and re-running
`helm upgrade --install nojv infra/charts/nojv -f infra/charts/nojv/values-single-machine.yaml -n nojv`.

### Layer 2 — Worker replicas

The chart runs two worker Deployments — judge (`worker.judge.replicas`) and
platform (`worker.platform.replicas`) — and Temporal distributes activity tasks
across however many workers poll the queue. Orchestration work is I/O-bound and
cheap, so **1–2 judge replicas saturate a single box's sandbox quota** — that's
why the GKE overlay runs a static count and there is no KEDA autoscaler (see
[Deployment Guide](../operations/DEPLOYMENT.md#service-mapping) and
`infra/gcp/gke/README.md` → "Why No Autoscaler on the Worker"). On one node the
single-machine overlay starts both at `1`; bump `worker.judge.replicas` to `2`
and `helm upgrade` only if `kubectl top pod` shows the judge worker CPU-bound
while sandbox Pods sit `Pending` for non-quota reasons.

- **CPU-based (simple):** an HPA on worker CPU is the no-extra-dependency option:

  ```yaml
  apiVersion: autoscaling/v2
  kind: HorizontalPodAutoscaler
  metadata:
    name: nojv-worker
    namespace: nojv
  spec:
    scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: nojv-worker }
    minReplicas: 1
    maxReplicas: 3
    metrics:
      - type: Resource
        resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
  ```

  (Requires the metrics-server; k3s bundles it.) Worker CPU rarely climbs,
  so this seldom fires — it's a safety valve, not the primary lever.

- **Queue-depth-based (advanced):** to scale on the _real_ signal — Temporal
  task-queue backlog / schedule-to-start latency — you need **KEDA** with its
  Temporal scaler. Mention/adopt this only once a metric proves the worker layer
  (not the sandbox quota) is the bottleneck; on a single box it almost never is.

### Layer 3 — Node / capacity scaling

A single node is hard-capped at its own CPU/RAM — once the ResourceQuota is
maxed for the box, the only way to judge _more in parallel_ is **more nodes**.
See [§9](#9-scaling-from-one-node-to-many). True **elastic node autoscaling**
(add/remove machines automatically under load) requires a cloud provider — GKE
node pools or a GCE MIG with the cluster-autoscaler. For that, take the
[GKE path in the Deployment Guide](../operations/DEPLOYMENT.md#gke-worker-rollout)
instead; k3s gives you manual horizontal scaling, not cloud elasticity.

## 9. Scaling from one node to many

To add capacity, join more machines as k3s **agents** and let the scheduler
spread sandbox Pods across them.

On the server, get the node token:

```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

On each new machine:

```bash
curl -sfL https://get.k3s.io | K3S_URL=https://<server-ip>:6443 \
  K3S_TOKEN=<node-token> sh -
```

Then, from the server, label the new node so sandbox Pods can land on it, and
**now** add the sandbox taint (so a runaway submission can't starve the
orchestrator that runs on the server node):

```bash
kubectl label node <new-node> nojv-role=sandbox --overwrite
kubectl taint node <new-node> nojv-role=sandbox:NoSchedule --overwrite
```

Sandbox Pods already carry the matching `nojv-role=sandbox` toleration
(`k8s-advanced.ts`), so they schedule onto the new node; the worker stays on the
`nojv-role=worker` server node. Raise the `nojv-sandbox` ResourceQuota to match
the new aggregate capacity ([§8](#sizing-the-resourcequota-to-the-box)).

> **Calico runs cluster-wide**, so NetworkPolicy enforcement (and thus sandbox
> egress isolation) extends to the new nodes automatically — the worker's
> startup probe still passes. Verify once with the
> [egress check](#verify-enforcement-the-same-check-the-worker-runs-at-startup)
> after the first join.

This is the smooth middle of the spectrum: **single-node k3s → multi-node k3s →
[GKE](../operations/DEPLOYMENT.md#gke-worker-rollout)** for full cloud
elasticity.

## Related docs

- [Deployment Guide](../operations/DEPLOYMENT.md) — GKE path, env-var reference,
  Cloudflare/Cloud Armor trust model
- [Judge Pipeline](../architecture/JUDGE_PIPELINE.md) — sandbox backends,
  advanced-mode image refs
- [Security Requirements](../operations/SECURITY.md) — sandbox isolation guarantees
- [Backup & Restore](backup-restore.md) — restore drills for the self-hosted deps
- [Getting Started](getting-started.md) — local (Docker-backend) dev stack
