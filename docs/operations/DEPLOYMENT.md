# Deployment Guide

How NOJV is configured, released and operated in production. Both targets,
single-machine k3s and GKE, deploy the same Helm chart (`infra/charts/nojv`) with
a different values overlay (OPS-01). Docker Compose runs local backing services
only; see [Getting Started](../runbooks/getting-started.md).

## Key code

- `infra/charts/nojv/`: the chart; knob reference in its [README](../../infra/charts/nojv/README.md)
- `infra/charts/nojv/values-single-machine.yaml`, `values-gke.yaml`: target overlays
- `infra/flux/`: single-machine GitOps release ([Flux guide](../../infra/flux/README.md))
- `.github/workflows/build-images.yml`: `vX.Y.Z` tag to GHCR images and the `deploy` branch
- `infra/gcp/cloud-build/deploy.sh`: GKE build, provenance check and Helm deploy ([GCP guide](../../infra/gcp/README.md))
- `packages/db/prisma/scripts/deploy-release.sh`: migrator hook entrypoint
- `infra/charts/nojv/files/release-workloads.sh`: post-upgrade restore Job
- `apps/worker/src/env.ts`, `apps/web/src/lib/server/env.ts`, `packages/mailer/src/index.ts`: env schemas

## Targets

| Aspect        | Single-machine k3s                                            | GKE                                                                 |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Runbook       | [Single-Machine k3s](../runbooks/k8s-single-machine.md)       | [GKE notes](../../infra/gcp/gke/README.md)                          |
| Release path  | `vX.Y.Z` tag → GHCR → `deploy` branch → Flux (OPS-02, OPS-03) | `deploy.sh` → Cloud Build → Artifact Registry → `helm upgrade`      |
| Image tag     | `vX.Y.Z` plus four digests                                    | 40-character source SHA plus four digests                           |
| Postgres      | In-cluster CloudNativePG (`postgres.mode=cnpg`)               | Cloud SQL through the Auth Proxy sidecar (`postgres.mode=cloudsql`) |
| Redis / S3    | In-cluster Redis and MinIO                                    | Memorystore and GCS (required by `production-preflight.yaml`)       |
| Edge          | In-cluster `cloudflared` tunnel to the ClusterIP web Service  | GCE Ingress with Cloud Armor allowing only Cloudflare               |
| Temporal      | Official Temporal Helm chart, one pod per role                | Official Temporal Helm chart, HA values                             |
| Sandbox nodes | The single node, labelled `nojv-role=sandbox`, untainted      | Tainted gVisor pools `pool-sandbox` and `pool-sandbox-spot`         |

## Environment variables

The chart reads secrets only from an existing runtime Secret (default
`nojv-runtime-secrets`, keys in
[`secret.example.yaml`](../../infra/charts/nojv/secret.example.yaml)); it never
templates secret values. Any env var a deployed service reads must be wired
through the chart (OPS-12).

### Web

| Variable                                                                           | Default                                              | Notes                                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                     | `postgresql://postgres:postgres@localhost:5432/nojv` | Required in production                                                                                  |
| `REDIS_URL`                                                                        | `redis://localhost:6379`                             | Required in production; `redis://` only (no TLS), DB 0 only                                             |
| `BETTER_AUTH_SECRET`                                                               | random in dev                                        | Required in production, at least 32 characters; also given to platform workers for exam credential mail |
| `BETTER_AUTH_URL`                                                                  | `http://localhost:5173`                              | Public origin; the chart also sets `ORIGIN` from it for the adapter-node CSRF check                     |
| `GITHUB_CLIENT_*`, `GOOGLE_CLIENT_*`                                               | unset                                                | OAuth apps (`_ID`, `_SECRET`)                                                                           |
| `BODY_SIZE_LIMIT`                                                                  | `67108864` (set in `web.Dockerfile`)                 | adapter-node body cap; 64 MiB so the 60 MB asset upload routes are the effective ceiling                |
| `ADVANCED_IMAGE_ALLOWED_REGISTRIES`                                                | major public registries                              | Registry hosts accepted for digest-pinned special_env image refs (`web.advancedImageAllowedRegistries`) |
| `DB_POOL_MAX`                                                                      | `10` (`web.dbPoolMax`)                               | Prisma pool size per web pod                                                                            |
| `REGISTRY_PUBLIC_HOST`, `REGISTRY_INTERNAL_URL`, `REGISTRY_TOKEN_ISSUER`           | chart-derived when `registry.enabled`                | Self-hosted registry token service                                                                      |
| `REGISTRY_TOKEN_PRIVATE_KEY`, `REGISTRY_TOKEN_CERT`, `REGISTRY_PULL_PASSWORD_HASH` | empty                                                | Runtime Secret; see [Self-hosted registry](#self-hosted-registry)                                       |

### Email

`MAILER_MODE` has no default (OPS-17). Web and platform workers use `smtp` in
production and validate the full configuration at startup; judge workers get no
mailer configuration. `MAILER_MODE=sink` (dev and tests) suppresses delivery and
rejects every `SMTP_*` variable, including empty ones. SMTP errors never fall
back to sink.

| Variable       | Production requirement                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| `MAILER_MODE`  | `smtp` (set by the chart)                                                      |
| `SMTP_HOST`    | Non-empty                                                                      |
| `SMTP_PORT`    | From `mailer.smtpPort` (default `465`); `465` is implicit TLS, others STARTTLS |
| `SMTP_USER`    | Non-empty                                                                      |
| `SMTP_PASS`    | App password or credential, never a mailbox login password                     |
| `SMTP_FROM`    | Explicit sender header                                                         |
| `APP_BASE_URL` | Absolute HTTPS URL for email links                                             |

### Temporal

| Variable                                                                        | Default          | Notes                            |
| ------------------------------------------------------------------------------- | ---------------- | -------------------------------- |
| `TEMPORAL_ADDRESS`                                                              | `localhost:7233` | Chart: `temporal.address`        |
| `TEMPORAL_NAMESPACE`                                                            | `default`        | Chart: `temporal.namespace`      |
| `TEMPORAL_TLS`, `TEMPORAL_API_KEY`                                              | unset            | `true` or an API key enables TLS |
| `TEMPORAL_CLIENT_CERT_PATH`, `TEMPORAL_CLIENT_KEY_PATH`, `TEMPORAL_SERVER_NAME` | unset            | mTLS                             |

The chart does not wire the TLS variables; in-cluster Temporal is plaintext on
the cluster network. Redis has no TLS option, so Redis and Temporal must be
reached over a private network.

### Worker

`parseWorkerEnv` validates at boot and throws on a missing required key. The
schema is a union on `EXECUTION_BACKEND`, so each backend requires only the keys
it uses. `tests/unit/infra/env-manifest-parity.test.ts` checks the rendered
chart against it.

| Variable                                                                                              | Required / default               | Purpose                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `EXECUTION_BACKEND`                                                                                   | required: `docker`, `kubernetes` | Sandbox backend                                                                                                           |
| `PORT`                                                                                                | required                         | Health server (`/healthz`, `/readyz`)                                                                                     |
| `REDIS_URL`                                                                                           | required                         | Redis connection                                                                                                          |
| `SANDBOX_IMAGE`                                                                                       | required                         | Standard sandbox image                                                                                                    |
| `WORKER_CONCURRENCY`                                                                                  | required, 1–64                   | Activity slots per task queue                                                                                             |
| `WORKER_MIN_CONCURRENCY`                                                                              | unset                            | Judge only: slots float between this and `WORKER_CONCURRENCY` by node CPU (see [Judge Queue](../runbooks/judge-queue.md)) |
| `WORKER_MODE`                                                                                         | `all`                            | `all`, `judge` (queues `judge` + `judge-state`), `platform` (queue `platform`)                                            |
| `SANDBOX_MEMORY_HEADROOM_MB`, `SANDBOX_MAX_MEMORY_MB`                                                 | `64`, `1536`                     | Sandbox memory ceiling above the problem limit                                                                            |
| `SANDBOX_CPU_LIMIT`, `SANDBOX_MEMORY_MB`, `SANDBOX_PIDS_LIMIT`                                        | required (Docker)                | Per-sandbox limits                                                                                                        |
| `K8S_NAMESPACE`, `K8S_CPU_REQUEST`, `K8S_CPU_LIMIT`, `K8S_MEMORY_REQUEST`, `K8S_MEMORY_LIMIT`         | required (Kubernetes)            | Sandbox namespace and container resources (`worker.sandbox.*`)                                                            |
| `K8S_RUN_PARALLELISM`                                                                                 | `1`, range 1–8                   | Testcases one stage Pod runs at once; its run container requests and is limited to this many CPUs                         |
| `K8S_RUNTIME_CLASS_NAME`                                                                              | required, must be `gvisor`       | RuntimeClass for every sandbox Pod                                                                                        |
| `K8S_IMAGE_PULL_SECRET`                                                                               | unset                            | dockerconfigjson Secret in the sandbox namespace (`worker.sandbox.imagePullSecret`)                                       |
| `REGISTRY_GC_IMAGE`, `REGISTRY_GC_NAMESPACE`, `REGISTRY_GC_CONFIG_CONFIGMAP`, `REGISTRY_GC_S3_SECRET` | defaults match the chart         | Registry garbage-collection Job                                                                                           |
| `SUBMISSION_PENDING_TIMEOUT_MINUTES`                                                                  | `10`, range 10–1440              | Platform worker: stale-submission cutoff; a running judge workflow is exempt                                              |

### Object storage

| Variable        | Default                 | Notes                                      |
| --------------- | ----------------------- | ------------------------------------------ |
| `S3_ENDPOINT`   | `http://localhost:9000` | MinIO locally; GCS, R2 or S3 in production |
| `S3_ACCESS_KEY` | `minioadmin`            |                                            |
| `S3_SECRET_KEY` | `minioadmin`            |                                            |
| `S3_BUCKET`     | `nojv`                  | Chart: `storage.bucket`                    |
| `S3_REGION`     | `auto`                  | `auto` works for GCS and R2                |

### Observability

The chart passes `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`
to web and workers from optional runtime Secret keys; unset disables export
(OPS-14). Meaning, endpoints and stack setup:
[Observability Setup](../runbooks/observability-setup.md).

## Helm chart

### Prerequisites

Not installed by the chart:

1. **Runtime Secret** in the app namespace: database, Redis, `S3_*`, auth, OAuth,
   SMTP plus `APP_BASE_URL`, optional OTLP keys, registry keys when
   `registry.enabled`, and when `seed.enabled` the
   `SEED_ADMIN_USERNAME`/`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (password at
   least 12 characters) and digest-pinned `SEED_ADVANCED_RUN_IMAGE` /
   `SEED_ADVANCED_GRADE_IMAGE` used by the post-install seed hook.
2. **CloudNativePG operator** when `postgres.mode=cnpg`; the chart renders only
   the `Cluster` and `ScheduledBackup` CRs.
3. **Temporal Server** from the official `temporalio/temporal` chart, reachable at
   `temporal.address` (default
   `temporal-frontend.nojv-temporal.svc.cluster.local:7233`), with the
   task-queue dynamic config. See
   [Temporal HA](../../infra/gcp/gke/temporal/HA-PRODUCTION.md).
4. **A NetworkPolicy-enforcing CNI and the `gvisor` RuntimeClass**; see
   [Kubernetes sandbox requirements](#kubernetes-sandbox-requirements).
5. Single-machine only: the `nojv-cloudflared-token` Secret (key `token`) and the
   `nojv-registry-pull` Secret in the sandbox namespace.

### Image pinning

Every non-local render requires `release.sourceSha` (40 lowercase hex), an
immutable `image.tag` (`vX.Y.Z`, or a source SHA; GHCR requires `vX.Y.Z`) and
`image.digests.{web,worker,sandbox,migrator}` as `sha256:<64 hex>`. Tag-only
renders fail. `image.allowUnpinnedLocalBuilds=true` is the only exception: it
requires an empty registry and prefix and the tag `local`.

### Render-time guards

| Guard                                                                                                                                                                                                                                                        | Template                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `worker.sandbox.runtimeClassName` must be `gvisor`                                                                                                                                                                                                           | `worker-judge.deployment.yaml`                    |
| judge `replicas × concurrency × worker.sandbox.runParallelism` ≤ quota `requestsCpu`                                                                                                                                                                         | `worker-judge.deployment.yaml`                    |
| `postgres.cnpg.backup.*` and `storage.minio.backup.*` complete, HTTPS, valid names when enabled                                                                                                                                                              | `postgres-cnpg.yaml`, `minio-backup.cronjob.yaml` |
| `cloudsql` mode: concrete Cloud SQL name, proxy on, external Redis and storage, registry host and HTTPS token realm, GCE Ingress with host, one TLS entry covering all hosts, Cloud Armor policy, HTTPS redirect, `networkPolicy.enabled` with private CIDRs | `production-preflight.yaml`                       |
| `web.nodeEnv=production` requires `migrator.enabled`                                                                                                                                                                                                         | `web-maintenance.yaml`                            |

### Kubernetes sandbox requirements

- **NetworkPolicy enforcement is mandatory.** Sandbox egress isolation (the
  `deny-all-sandbox` policy plus per-submission egress policies) is inert on a
  non-enforcing CNI such as k3s flannel or kindnet. Use GKE Dataplane V2 (or
  `--enable-network-policy`) or Calico/Cilium. At startup the Kubernetes judge
  worker runs a positive/negative probe (`apps/worker/src/sandbox/kubernetes/netpol-probe.ts`):
  it must reach an explicitly allowed internal target and must not reach one
  without an egress allow. It refuses to start otherwise; there is no bypass.
- **gVisor.** Every sandbox Pod uses `runtimeClassName: gvisor`; there is no
  `runc` fallback. A runtime probe also runs at startup.
- **Per-Pod PID limit.** k3s: `--kubelet-arg=pod-max-pids=256`; GKE sandbox pools:
  `podPidsLimit: 1024` (`infra/gcp/gke/sandbox-node-system-config.yaml`). Never
  use `ulimit -u`, which is shared by host UID across Pods.
- **Node roles.** Sandbox Pods select `nojv-role=sandbox` and tolerate the
  `nojv-role=sandbox:NoSchedule` taint (`apps/worker/src/sandbox/kubernetes/pod-spec.ts`).
  On GKE, workers and the migrator pin to `nojv-role=worker`.
- **Sandbox namespace** (`templates/namespaces.yaml`, `sandbox-policy.yaml`):
  `restricted` Pod Security admission, `deny-all-sandbox` NetworkPolicy
  (`podSelector: {}`, no ingress or egress), ResourceQuota and LimitRange.
- **Worker egress** (`networkPolicy.enabled`, GKE only): pods labelled
  `nojv-role: worker` may reach DNS, Temporal, Redis, Cloud SQL, Google APIs and
  the Kubernetes API; `platform-smtp-egress` adds the SMTP port for pods labelled
  `nojv-mailer: enabled`. This is independent of the sandbox policy.

## Releasing

### Single-machine (Flux)

Merging to `main` runs CI only. A release is a stable tag on a `main` commit
whose `Verify Repository` check passed (OPS-04):

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

`build-images.yml` builds and attests the four images on GHCR, then writes the
source SHA, tag, four digests and `migrator.releaseWindow` into
`values-single-machine.yaml` in one commit on `deploy` (lease-protected, and
refused if it would move `deploy` backwards). Flux reconciles that revision as
one Helm upgrade. The four GHCR packages must be public so k3s pulls without a
pull secret. The workflow ends after publishing `deploy`; the external
`NOJV-TW/status` Worker verifies `/api/release`, `/api/livez` and `/api/readyz`
and sends the release notification (OPS-16). Flux details are in the
[Flux guide](../../infra/flux/README.md).

Before tagging, confirm the cluster-owned values do not pin
`migrator.releaseWindow` (a user-supplied value overrides the computed one):

```bash
sudo helm get values nojv -n nojv
```

It must exit 0 and its `USER-SUPPLIED VALUES:` must not mention
`releaseWindow`. A `Kubernetes cluster unreachable` error means nothing was
read; check the exit status and never pipe the output through a `grep` whose
miss counts as a pass. Two warnings about a group/world-readable kubeconfig are
expected on k3s. `sudo helm` needs the kubeconfig link from the
[single-machine runbook](../runbooks/k8s-single-machine.md#prerequisites).

### GKE (`deploy.sh`)

`bash infra/gcp/cloud-build/deploy.sh` with the variables listed in the
[GCP guide](../../infra/gcp/README.md#required-environment-variables-for-deploysh).
Before any mutation it requires a clean tree and
`RELEASE_SHA = HEAD = RELEASE_REMOTE:RELEASE_REF` on the canonical
`NOJV-TW/NOJV` origin, rejects Git replacement objects, verifies the GCP
identities, private Cloud SQL and Memorystore addresses, TLS Secret and the
Cloud Armor policy. Cloud Build fetches the exact SHA from GitHub; every digest
must pass `slsa-verifier`. It then runs `helm upgrade --install --wait --timeout 125m`
and probes the public and direct-origin paths. Direct Cloud Build submission is
unsupported.

### Verify

1. `kubectl rollout status deploy/nojv-web deploy/nojv-worker deploy/nojv-worker-platform -n nojv`
2. Web `/api/livez` and `/api/readyz`; worker `/readyz`.
3. Watch logs for at least 15 minutes.

Secrets are rotated out-of-band in the runtime Secret, then the affected
Deployments are restarted.

## Database migrations

| Command            | Runs                    | Use                        |
| ------------------ | ----------------------- | -------------------------- |
| `pnpm db:push`     | `prisma db push`        | Local schema sync          |
| `pnpm db:migrate`  | `prisma migrate dev`    | Create a migration locally |
| `pnpm db:deploy`   | `prisma migrate deploy` | Apply pending migrations   |
| `pnpm db:validate` | `prisma validate`       | Schema check               |

Production never runs these by hand. The migrator Job
(`templates/migrator.job.yaml`, pre-install/pre-upgrade hook, weight -5) runs
`deploy-release.sh`:

- **Install:** `prisma migrate deploy`.
- **Upgrade, nothing pending:** when `prisma migrate status` reports no pending
  migrations, the hook exits and the release
  rolls through the web Deployment's `maxUnavailable: 0` / `maxSurge: 1`
  strategy. A status probe that cannot be read counts as pending.
- **Upgrade with migrations:** the hook waits for the maintenance page, points
  the web HPA at the maintenance target, scales web, judge and platform to zero,
  waits until no pods remain, then runs `prisma migrate deploy`. A failure after
  migration starts keeps writers at zero for a forward fix (OPS-05). A database
  older than `20260716000012_versioned_blob_pointers_contract` must first
  upgrade through a release that still ships the storage backfill.

### Release window

`migrator.releaseWindow` (default `true`) is a render-time flag because Helm
cannot see what the hook will find. When true on an upgrade, web, judge and
platform render with `replicas: 0`, the HPA targets the maintenance Deployment,
and the post-upgrade Job (`templates/web-maintenance.yaml`, also post-rollback)
starts and verifies the new workloads, then restores the HPA. The release
workflow sets it to `false` only when `packages/db/prisma/migrations` is
unchanged between the deployed `release.sourceSha` and the release commit;
an unknown deployed commit yields `true`. Both mismatches are safe: `false`
with pending migrations still drains inside the hook, and the post-upgrade Job
detects a drain at runtime and restores workloads; `true` with nothing to
migrate only costs a short drained window.

Hook order on upgrade:

| Weight | Hook                                                   | Purpose                                                                                     |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| -40    | `schema-fence.yaml`                                    | Admission fence (below)                                                                     |
| -10    | `release-prepull.job.yaml`, `sandbox-prepull.job.yaml` | Pull web/worker (`imagePullPolicy: Always`) and sandbox images while the old release serves |
| -7     | `web-maintenance.deployment.yaml`                      | Maintenance page (release window only)                                                      |
| -5     | `migrator.job.yaml`                                    | Migrate as above                                                                            |
| 10     | `web-maintenance.yaml` Job                             | Start new workloads, scale the page to zero, restore the HPA                                |

The maintenance page runs the release's web image with a command override and
carries the `app.kubernetes.io/name: nojv-web` label, so the web Service reaches
it; it answers every path with HTTP 503, `Retry-After` and a bilingual page. Its
`nojv.tw/role: maintenance` label is excluded from the drain selector. If it is
not available within `maintenance.pageReadyTimeoutSeconds` (120 s), the migrator
exits before draining and the previous release keeps serving.

Flux does not roll back a failed upgrade (`remediateLastFailure: false`); a
failed post-upgrade hook leaves workloads in maintenance for an operator. See
[Incident Recovery](../runbooks/incident-recovery.md).

### Schema contract fence

A persistent `ValidatingAdmissionPolicy` (`templates/schema-fence.yaml`) rejects
any create or update of `nojv-web`, `nojv-worker` or `nojv-worker-platform` whose
pod template lacks all three labels:

- `nojv.tw/schema-contract: versioned-storage-v1`
- `nojv.tw/course-roster-contract: membership-v1`
- `nojv.tw/problem-library-contract: problem-library-v1`

This blocks rollback to a pre-contract release even though Helm still lists it.
Never delete or bypass the fence.

## Rollback

Migrations are forward-only and the migrator does not run on `helm rollback`.

1. Inspect the target revision's web, judge and platform pod-template labels.
2. If any of the three contract labels is missing, build and deploy a forward fix.
3. Otherwise roll back: single-machine moves `deploy` to an exact prior deploy
   commit ([Flux guide](../../infra/flux/README.md#emergency-rollback)); GKE runs
   `helm rollback nojv <revision> -n nojv --wait --timeout 125m`.
4. Confirm the three Deployments are healthy and watch logs for 15 minutes.

If data must be recovered, restore a verified backup into an isolated
environment, validate a compatible forward release there and promote it. Never
apply ad-hoc down migrations.

## Capacity

| Tier     | Single-machine                                     | GKE                                                                    |
| -------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| web      | HPA 1–3, CPU 70%                                   | HPA 2–15, CPU 70%                                                      |
| judge    | 1 replica, slots 2–5 by node CPU                   | 2 replicas × 2 slots                                                   |
| platform | 1 replica                                          | 1 replica                                                              |
| sandbox  | quota 16 pods / 6 CPU / 16Gi; judge container 300m | quota 10 pods / 10 CPU / 30Gi; one on-demand gVisor node plus Spot 0–4 |
| postgres | CNPG, 500m CPU, 2Gi memory request = limit         | Cloud SQL, outside the chart                                           |

The sandbox ResourceQuota is the judge capacity ceiling (OPS-11); a Job the
quota rejects waits as `waiting_capacity`. Sizing, priority and the slot tuner
are in [Judge Queue](../runbooks/judge-queue.md). The judge Deployment uses
`strategy: Recreate`. Extra judge replicas add dispatch slots, not sandbox
capacity.

Single-machine Postgres has a memory limit equal to its request and no CPU
limit, so its usage never exceeds its request and kubelet node-pressure
eviction takes every pod above its request first. Its requests count against
the 8 vCPU / 16 GiB node with the other platform pods; sandbox Jobs schedule
into what remains.

### Disruption and Shutdown

| Setting                  | Web                                    | Judge / platform worker                       |
| ------------------------ | -------------------------------------- | --------------------------------------------- |
| PodDisruptionBudget      | `maxUnavailable: 1` when `pdb.enabled` | `maxUnavailable: 1` when `pdb.enabled`        |
| Spread                   | zone + node, `ScheduleAnyway`          | judge: zone + node, `ScheduleAnyway`          |
| `terminationGracePeriod` | 60 s                                   | 120 s                                         |
| Shutdown after SIGTERM   | 10 s `preStop`, then adapter-node 30 s | Temporal `shutdownGraceTime` 30 s, 40 s total |
| Probe timeout            | readiness 3 s, liveness 5 s            | 5 s (above the 3 s in-process check budget)   |

`maxUnavailable` rather than `minAvailable` keeps a single-replica platform
worker drainable: a `minAvailable: 1` budget on one replica blocks every node
drain and GKE upgrade until the drain timeout. GKE enables the budgets;
the single-machine overlay leaves them off because a one-node drain evicts
everything anyway. Spread constraints never block scheduling, so they are a
no-op on one node. cloudflared also spreads across nodes and gets a 45-second
grace period so its 30-second connection drain finishes before SIGKILL.

The Cloud SQL Auth Proxy runs as a native sidecar (an init container with
`restartPolicy: Always`) in web, worker, migrator and seed pods. Kubernetes
starts it before the app container and stops it only after the app container
exits, so a draining process keeps its database path and a hook Job completes
when its main container does.

## Edge

The origin must be reachable only through Cloudflare, because the app trusts
`CF-Connecting-IP` (OPS-08, [Client IP trust](SECURITY.md#client-ip-trust-model-cloudflare-only)).

- **Single-machine:** `edge.cloudflared.enabled` runs a tunnel (2 replicas) to the
  ClusterIP web Service; there is no Ingress or NodePort. Tunnel public
  hostnames: the site to `http://nojv-web.nojv.svc.cluster.local:80`, and
  `registry.nojv.tw` to `http://nojv-registry.nojv.svc.cluster.local:5000`.
- **GKE:** see below.

### Cloudflare + Cloud Armor Setup

1. **DNS:** a proxied (orange-cloud) record for the public host and the registry
   host pointing at the GKE Ingress IP.
2. **Cloud Armor policy** (`EDGE_SECURITY_POLICY`): default rule `deny-403`, allow
   rules for exactly the ranges in `infra/gcp/cloudflare-origin-cidrs.txt`
   (from <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6>).

   ```bash
   gcloud compute security-policies create cf-only-policy \
     --description="Allow only Cloudflare edge IPs"
   gcloud compute security-policies rules update 2147483647 \
     --security-policy=cf-only-policy --action=deny-403
   gcloud compute security-policies rules create 1000 \
     --security-policy=cf-only-policy --action=allow \
     --src-ip-ranges="<IPv4 ranges from cloudflare-origin-cidrs.txt>"
   gcloud compute security-policies rules create 1100 \
     --security-policy=cf-only-policy --action=allow \
     --src-ip-ranges="<IPv6 ranges from cloudflare-origin-cidrs.txt>"
   ```

3. The chart's `BackendConfig` attaches the policy and a `FrontendConfig`
   enforces the HTTPS redirect. `deploy.sh` refuses to deploy unless the policy
   matches the CIDR file with default deny, and afterwards requires direct-origin
   requests for both hosts to be rejected and Cloudflare requests to succeed.
4. **Maintenance:** when Cloudflare's ranges change, update
   `cloudflare-origin-cidrs.txt` and the Cloud Armor rules in the same change.

If a direct-origin request ever succeeds, the trust model is broken; stop before
relying on IP-based proctoring.

## Images

### Dockerfiles

| Dockerfile                                | Image                          |
| ----------------------------------------- | ------------------------------ |
| `infra/docker/web.Dockerfile`             | SvelteKit production server    |
| `infra/docker/worker.Dockerfile`          | Temporal worker                |
| `infra/docker/sandbox-runner.Dockerfile`  | Standard sandbox runtime       |
| `infra/docker/migrator.Dockerfile`        | Migrator and seed hooks        |
| `infra/docker/demo-advanced-{run,grade}/` | Seeded special_env demo images |

#### Standard judge toolchain

`packages/core/src/judge-environment.json` is the source of truth for the
standard judge image, runner commands and the public `/environment` page
(JDG-14). The sandbox Dockerfile installs these exact revisions and fails its
build when the pinned base image no longer matches the recorded Alpine or
Node.js version.

| Component    | Pinned version                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base OS      | `Alpine Linux 3.24.1`                                                                                                                                                                               |
| Node runtime | `Node.js 24.18.0`                                                                                                                                                                                   |
| APK packages | `bash=5.3.9-r1`, `build-base=0.5-r4`, `cargo=1.96.1-r0`, `g++=15.2.0-r5`, `gcc=15.2.0-r5`, `go=1.26.8-r0`, `openjdk21-jdk=21.0.12_p8-r0`, `python3=3.14.7-r1`, `rust=1.96.1-r0`, `socat=1.8.1.3-r0` |
| npm packages | `@types/node@24.13.3`, `typescript@6.0.3`                                                                                                                                                           |

To upgrade: update the base image digest and `judge-environment.json`, refresh
this table in the same change, run `pnpm lint:doc-drift` (the table must match
the manifest exactly) and `pnpm sandbox:build`, and validate representative
Docker and Kubernetes judge suites before promoting the new digest. Upgrade the
full pin set only for a security fix, compatibility need or planned review,
never from scheduled CI.

### Self-hosted registry

`registry.enabled` (on in both overlays) runs a `registry:2` Deployment for
teacher-built special_env images (OPS-10). Blobs go to in-cluster MinIO (bucket
`nojv-registry`, created by a hook) or `registry.s3.regionendpoint`. The web
endpoint `/api/registry/token` signs scoped tokens:

| Principal                      | Access                                          |
| ------------------------------ | ----------------------------------------------- |
| Platform credential (any role) | push and pull `t/<username>/**`; pull `demo/**` |
| `judge-pull` service account   | pull everything                                 |
| Anonymous                      | pull `demo/**`                                  |

Credentials are issued from the problem editor to admins and users with
`canCreateAdvancedProblems`. Judge Pods pull through the
`worker.sandbox.imagePullSecret` Secret (`nojv-registry-pull`). Setup steps are
in the [single-machine runbook](../runbooks/k8s-single-machine.md#registry).
Garbage collection is manual from `/admin/registry`; run it when nobody is
pushing, because mark-and-sweep can remove a blob whose manifest is not yet
pushed.

## Workflow versioning

Temporal replays in-flight histories against new worker code, and
`contestLifecycleWorkflow`, `examAutoCloseWorkflow` and the sweeper cron are
long-lived. Guard every command-sequence change under `apps/worker/src/workflows/`
with `patched()` / `deprecatePatch()`, or deploy only after the affected
short-lived workflows have drained (DAT-15). Pure refactors that keep the command
sequence need no patch.

## Backups

- **Single-machine:** CNPG `ScheduledBackup` with WAL archiving and the MinIO
  off-host mirror CronJob are enabled, and the chart refuses to render without
  their destinations and credential Secrets (OPS-06).
- **GKE:** `infra/gcp/scripts/setup-backups.sh` enables Cloud SQL daily backups
  (30 retained, in-region) and PITR (14 days of logs) and creates a versioned
  GCS bucket; `export-postgres-to-gcs.sh` is the daily cold export for Cloud
  Scheduler.

Procedures and restore drills: [Backup & Restore](../runbooks/backup-restore.md).

## CI and release gates

`Verify Repository` (`.github/workflows/ci.yml`) aggregates repository checks,
coverage and Temporal integration and gates every release tag. CodeQL and the
`pnpm audit --audit-level high` job also run (OPS-13). What each job covers is in
[Testing Strategy](../runbooks/testing.md).
