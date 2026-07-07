# Flux GitOps for NOJV

Pull-based deployment for the single-node production cluster. Flux runs **in**
the cluster, watches this git repo + GHCR, and reconciles the existing
`infra/charts/nojv` Helm chart. This removes the self-hosted GitHub Actions
runner from the production attack surface (see
`docs/plans/active/2026-07-08-flux-gitops-cutover.md`).

## How auto-pull works (CI-driven via the `deploy` branch)

The org has **deploy keys disabled** and **main is branch-protected** (PR +
approval), so neither a cluster-side Flux `ImageUpdateAutomation` nor a bot can
push image bumps to main. Instead the image tag is published by CI to a
dedicated **`deploy` branch** that Flux tracks — no cluster git-write, no
change to main's protection:

```
push to main
  → build-images.yml (GitHub-hosted): build + push images to GHCR,
    then `git checkout -B deploy`, write the new main-<run_number> tag into
    infra/flux/helmrelease.yaml, and force-push the deploy branch (GITHUB_TOKEN,
    contents: write — allowed on the unprotected deploy branch)
  → GitRepository/nojv tracks `deploy`
  → Kustomization/nojv applies helmrelease.yaml → HelmRelease upgrades to the
    new tag → pods roll. Hands-off.
```

`deploy` is always `main` + the built tag (force-reset each build), so chart /
config changes and image changes both flow through automatically. Pushing to
`deploy` does not re-trigger CI (build-images and ci only trigger on main).

## Live state (2026-07-08)

- ✅ Flux v2.9.1 installed; `GitRepository` + `HelmRelease` manage the release
  from the `deploy` branch (adopted the existing release, verified healthy).
- ✅ Image build is GitHub-hosted (`build-images.yml`); self-hosted `deploy.yml`
  deleted; runner deregistered. CI holds **no cluster credentials**.

Manual deploy override (e.g. a rollback):
`kubectl -n nojv patch helmrelease nojv --type merge -p '{"spec":{"values":{"image":{"tag":"main-<N>"}}}}'`

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
