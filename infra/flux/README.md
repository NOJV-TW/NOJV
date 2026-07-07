# Flux GitOps for NOJV

Pull-based deployment for the single-node production cluster. Flux runs **in**
the cluster, watches this git repo + GHCR, and reconciles the existing
`infra/charts/nojv` Helm chart. This removes the self-hosted GitHub Actions
runner from the production attack surface (see
`docs/plans/active/2026-07-08-flux-gitops-cutover.md`).

## Current state (2026-07-08) — LIVE, one credential step remaining

- ✅ Flux v2.9.1 installed (core + image-automation controllers), all healthy.
- ✅ `GitRepository/nojv` clones this repo; `HelmRelease/nojv` **manages the
  deployment** (adopted the release, rev 36, verified healthy on `main-722`).
- ✅ `ImageRepository`/`ImagePolicy` scan GHCR and resolve the newest `main-<N>`
  tag (read-only, credential-free).
- ✅ Image build moved to the GitHub-hosted `build-images.yml`; the self-hosted
  `deploy.yml` is deleted. CI holds **no** cluster credentials.
- ❌ **`ImageUpdateAutomation` (the git commit-back that closes auto-pull) is
  NOT active — it needs git write, and the org has deploy keys DISABLED.**
  Until a write credential exists, a new build is deployed by bumping the tag:
  `kubectl -n nojv patch helmrelease nojv --type merge -p '{"spec":{"values":{"image":{"tag":"main-<N>"}}}}'`
  (find `<N>` via `flux get image policy nojv`).

## To finish auto-pull (needs one credential — user action)

Deploy keys are disabled org-wide, so pick one:

- **Enable deploy keys** for NOJV-TW/NOJV (Org → Settings → repo policies),
  then `flux create secret git nojv-git --url=ssh://git@github.com/NOJV-TW/NOJV.git --private-key-file=<key>`,
  switch the `GitRepository` to that SSH URL + secret, and `kubectl apply`
  `image-automation.yaml`.
- **Or** create a fine-grained PAT / GitHub App with `contents:write` and use
  `flux create secret git` with the token; same wiring.

Once wired: a merge to main → `build-images.yml` pushes `main-<N+1>` → the
ImagePolicy picks it → ImageUpdateAutomation commits the bump to git → the
HelmRelease upgrades. Fully hands-off.

## What CI does now

`build-images.yml` (GitHub-hosted) builds and pushes images to GHCR on every
push to main. It holds **no** cluster credentials. Nothing pushes into the
cluster — Flux pulls.

## Files

| File                    | Purpose                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `git-repository.yaml`   | `GitRepository` (this repo, `main`) + root `Kustomization` that applies this directory                               |
| `helmrelease.yaml`      | `HelmRelease` wrapping `infra/charts/nojv` with `values-single-machine.yaml`; image tag is automation-managed        |
| `image-automation.yaml` | `ImageRepository` (scans GHCR) + `ImagePolicy` (newest build) + `ImageUpdateAutomation` (writes the tag back to git) |

## One-time cutover (run from the prod box, in a maintenance window)

The box already holds cluster-admin locally, so bootstrap is a local action —
**never** from CI.

```bash
# 1. Install Flux (checks the cluster first)
flux check --pre
flux install

# 2. Create the git write credential for image automation (deploy key with write)
#    and, if GHCR rate limits bite, a read token for image scanning.
flux create secret git nojv-git \
  --url=ssh://git@github.com/NOJV-TW/NOJV.git \
  --private-key-file=<path-to-deploy-key>

# 3. Apply the source; Flux then reconciles the rest of this directory.
kubectl apply -f infra/flux/git-repository.yaml

# 4. Verify before handing the release over.
flux get sources git
flux get helmreleases -A
flux diff kustomization nojv --path infra/flux    # dry-run, no drift expected
```

**Release ownership handoff:** the live release is named `nojv`. `helmrelease.yaml`
uses the same `releaseName: nojv` so Flux's helm-controller adopts it. Pin
`image.tag` in `helmrelease.yaml` to the **currently deployed** sha before the
first reconcile so nothing rolls unexpectedly. **Preserve all PVCs — the CNPG
Postgres data and MinIO buckets live on them.** If a clean reinstall is ever
needed, `helm uninstall` must keep PVCs.

## Decommission (closes the P0)

After Flux reconciles cleanly and an image bump round-trips through git:

1. Remove the self-hosted `deploy` job from `.github/workflows/deploy.yml`
   (leave only build-push to GHCR).
2. Deregister the repo's self-hosted runner and revoke its token.
3. Drop the `nn` passwordless sudo.

## Validate before applying

These manifests are not applied by CI. Validate them at apply time:

```bash
flux check
kubeconform -strict infra/flux/*.yaml   # or `flux diff` as above
```
