# Self-hosted container registry for special_env images

Status: PR-A implemented; PR-B/PR-C pending
Branch: `feat/self-hosted-registry`
Depends on: PR #257 (merged — image-ref authoring for special_env)

## Context

special_env problems reference teacher-built run/grade/service images. Images
holding answers or hidden test inputs must be private, but GHCR's free private
storage (~500 MB/org) cannot hold course images. Decision (owner-approved):
self-host the CNCF distribution registry in the existing cluster, storage
backend on the existing in-cluster MinIO, and issue platform-managed push
credentials to teachers. Harbor was evaluated and rejected as over-engineered
for a small trusted-staff authoring population; the upgrade path (blobs in S3)
stays open.

## Architecture

```
teacher docker push ──> registry.nojv.tw (Cloudflare tunnel)
                          └─ registry:2 Deployment (stateless, token auth)
                               ├─ token endpoint: apps/web /api/registry/token
                               │    (validates platform-issued creds from DB,
                               │     signs scoped JWTs; registry verifies via
                               │     a shared self-signed cert)
                               └─ blobs: existing MinIO, bucket `nojv-registry`
judge pods pull ──> imagePullSecrets (chart-managed pull account; portable
                    to GKE — no reliance on k3s registries.yaml)
```

Token scopes (issued by the token endpoint):

| principal                                             | access                                      |
| ----------------------------------------------------- | ------------------------------------------- |
| teacher (DB credential + `canCreateAdvancedProblems`) | push+pull `t/<username>/**`, pull `demo/**` |
| judge pull account (chart secret)                     | pull `**`                                   |
| CI push account (GH secret)                           | push+pull `demo/**`                         |
| anonymous                                             | pull `demo/**`                              |

## Scope

### PR-A — registry core

- Helm: `registry.enabled` flag → registry:2 Deployment + Service, token-auth
  config, MinIO S3 backend (`nojv-registry` bucket), pull Secret
  (dockerconfigjson) in the sandbox namespace; values for single-machine + GKE.
- Web: `/api/registry/token` endpoint (Docker registry token spec, Basic auth
  against DB credentials, JWT via jose with x5c); `RegistryCredential` DB model
  (userId, sha256 hash of the platform-issued random password, rotatedAt) + migration.
- Advanced edit page: "Registry account" card (visible only with
  `canCreateAdvancedProblems`; generate/rotate, plaintext shown once);
  requiredPaths editor (lost its only UI when the ZIP manifest died);
  guidance restructure — one clear workflow, details collapsed.
- Worker: optional `K8S_IMAGE_PULL_SECRET` env → `imagePullSecrets` on advanced
  run/grade/service pod manifests.
- Allowlist: prod values add `registry.nojv.tw`.
- Docs: DEPLOYMENT (single-machine + GKE), runbook (tunnel hostname, secret
  generation, optional k3s registries.yaml mirror), guide page, SECURITY.

### PR-B — demo images move off GHCR

- `build-images.yml` pushes `nojv-demo-advanced-{run,grade}` to
  `registry.nojv.tw/demo/...` (GH secret with the CI account); GHCR keeps only
  system images (web/worker/sandbox/egress-proxy/migrator).
- Seeds repoint the demo problem at the new refs; `demo/**` is anonymous-pull
  so dev machines and prod both work.
- Local dev keeps `pnpm demo-advanced:build` (`:local` tags) for offline work.

### PR-C — admin registry management

- Admin → Registry page: repository/tag catalog with sizes and last-push time
  (registry API via internal service URL), per-tag delete (manifest delete API,
  admin-audited), and a manual "reclaim space" trigger that runs
  `registry garbage-collect` as a k8s Job (dispatched via the platform Temporal
  queue). No automatic deletion anywhere.

## Known limits (accepted)

- Cloudflare free tier caps request bodies at 100 MB → a single layer over
  100 MB fails to push through the tunnel; guide advises splitting layers.
- MinIO remains the single in-cluster copy until off-box backup is enabled;
  switching the registry backend to R2 later is a config change + blob copy.
- Token-scope isolation is per-teacher namespace, not per-course.

## Verification

- Unit: token endpoint scope matrix, credential mutations, manifest
  imagePullSecrets, chart render (both overlays).
- Prod E2E after deploy: push with issued credential → configure problem with
  digest ref → accepted test run → publish; anonymous pull of a `t/...` repo
  must 401; judge pulls via the pull secret.
