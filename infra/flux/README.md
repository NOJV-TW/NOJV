# Flux GitOps for NOJV

Pull-based deployment for the single-node production cluster. Flux runs **in**
the cluster, watches this git repo + GHCR, and reconciles the existing
`infra/charts/nojv` Helm chart. This removes the self-hosted GitHub Actions
runner from the production attack surface (see
`docs/plans/active/2026-07-08-flux-gitops-cutover.md`).

## How releases work (`vX.Y.Z` → `deploy` branch)

The org has **deploy keys disabled** and **main is branch-protected** (PR +
approval), so neither a cluster-side Flux `ImageUpdateAutomation` nor a bot can
push image bumps to main. Instead the version tag is published by CI to a
dedicated **`deploy` branch** that Flux tracks — no cluster git-write, no
change to main's protection:

```
push vX.Y.Z tag for a main commit whose Verify Repository check passed
  → build-images.yml (GitHub-hosted): build + push vX.Y.Z images to GHCR,
    then `git checkout -B deploy`, write the source commit, version tag, and all four Buildx
    manifest digests into
    infra/charts/nojv/values-single-machine.yaml, and force-push the deploy
    branch (GITHUB_TOKEN, contents: write — allowed on the unprotected branch)
  → GitRepository/nojv tracks `deploy`
  → source-controller packages the chart templates + production values from
    that one revision → HelmRelease performs one upgrade → pods roll. Hands-off.
```

`deploy` is always the tagged main commit plus its `vX.Y.Z` image tag and
registry-verified digests in the packaged chart values
(force-reset each build), so chart/config and image changes cannot reconcile as
separate Helm upgrades. The HelmRelease itself has no inline image override.
Each successful publish also retains the exact deploy commit as
`nojv-deploy-<image-tag>` so a known release remains recoverable after the
branch moves.
Pushing to `main` runs CI but does not publish images. Release with:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The release fails before package writes unless the tag is stable SemVer, points
to a commit contained in `main`, and that commit has a successful
`Verify Repository` check. Pushing to `deploy` does not re-trigger CI or the
release workflow.

## Live state (2026-07-08)

- ✅ Flux v2.9.1 installed; `GitRepository` + `HelmRelease` manage the release
  from the `deploy` branch (adopted the existing release, verified healthy).
- ✅ Image build is GitHub-hosted (`build-images.yml`); self-hosted `deploy.yml`
  deleted; runner deregistered. CI holds **no cluster credentials**.

The storage schema is forward-only. An emergency app rollback is allowed only
to a retained release whose web, judge, and platform Deployment templates all
carry `nojv.tw/schema-contract: versioned-storage-v1`. A pre-contract release
is rejected by the admission fence and cannot be made safe by retrying it.
Inspect the candidate and move `deploy` with an exact lease so the chart and
images change atomically:

```bash
git fetch origin 'refs/tags/nojv-deploy-*:refs/tags/nojv-deploy-*'
candidate=nojv-deploy-<image-tag>
git grep -F 'nojv.tw/schema-contract: versioned-storage-v1' "$candidate" -- \
  infra/charts/nojv/templates/web.deployment.yaml \
  infra/charts/nojv/templates/worker-judge.deployment.yaml \
  infra/charts/nojv/templates/worker-platform.deployment.yaml
git show "$candidate":infra/charts/nojv/values-single-machine.yaml | head
current_deploy_tip="$(git ls-remote origin refs/heads/deploy | cut -f1)"
git push "--force-with-lease=refs/heads/deploy:${current_deploy_tip}" origin \
  "refs/tags/$candidate":refs/heads/deploy
```

The grep must return exactly those three templates; also verify the selected
release contains the intended tag and four digests. If the candidate lacks the
active contract, keep workloads in maintenance and ship a forward fix from
current `main`. A later version tag intentionally advances `deploy` again.

## Files

| File                  | Purpose                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `git-repository.yaml` | `GitRepository` tracking `deploy` + root `Kustomization` that applies this directory                   |
| `helmrelease.yaml`    | Stable `HelmRelease` wrapping `infra/charts/nojv`; chart values carry the automation-managed image tag |

## One-time cutover (run from the prod box, in a maintenance window)

The box already holds cluster-admin locally, so bootstrap is a local action —
**never** from CI.

```bash
# 1. Install Flux (checks the cluster first)
flux check --pre
flux install

# 2. Apply the source; Flux then reconciles the rest of this directory.
cat >production-values.yaml <<'EOF'
postgres:
  cnpg:
    backup:
      destinationPath: s3://REAL_POSTGRES_BACKUP_BUCKET/nojv-pg
      endpointURL: https://REAL_S3_ENDPOINT
      s3CredentialsSecret: REAL_POSTGRES_BACKUP_SECRET
storage:
  minio:
    backup:
      destinationEndpoint: https://REAL_S3_ENDPOINT
      destinationBucket: REAL_SUBMISSION_BACKUP_BUCKET
      credentialsSecret: REAL_MINIO_BACKUP_SECRET
EOF
kubectl -n nojv create secret generic nojv-production-values \
  --from-file=values.yaml=production-values.yaml
rm production-values.yaml
kubectl apply -f infra/flux/git-repository.yaml

# 3. Verify before handing the release over.
flux get sources git
flux get helmreleases -A
flux diff kustomization nojv --path infra/flux    # dry-run, no drift expected
```

`nojv-production-values` is mandatory (`optional: false`) and cluster-owned; it
is deliberately excluded from Git. Replace every `REAL_*` value with an
existing off-host destination or Secret before the first reconcile. The
HelmRelease remains failed closed if this Secret is absent or incomplete.

**Release ownership handoff:** the live release is named `nojv`. `helmrelease.yaml`
uses the same `releaseName: nojv` so Flux's helm-controller adopts it. Pin
`release.sourceSha`, its `vX.Y.Z` `image.tag`, and every `image.digests.*` value in `values-single-machine.yaml` to
the **currently deployed** immutable references
before the first reconcile so nothing rolls unexpectedly. **Preserve all PVCs
— the CNPG Postgres data and MinIO buckets live on them.** If a clean reinstall
is ever needed, `helm uninstall` must keep PVCs.

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
