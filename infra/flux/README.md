# Flux GitOps

Flux runs in the single-machine cluster, tracks the CI-written `deploy` branch,
and reconciles the `nojv` chart from it as one Helm upgrade. CI holds no cluster
credentials (OPS-02, OPS-03, OPS-07 in
[platform decisions](../../docs/decisions/platform.md)). Release flow and
migration behavior are in the [Deployment Guide](../../docs/operations/DEPLOYMENT.md#releasing).

## Files

| File                  | Purpose                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git-repository.yaml` | `GitRepository` on branch `deploy` (1 min interval, 5 min timeout) and the `nojv` Kustomization (`prune: false`) that applies this directory                                                      |
| `kustomization.yaml`  | Lists `helmrelease.yaml`                                                                                                                                                                          |
| `helmrelease.yaml`    | `HelmRelease` `nojv`: chart `infra/charts/nojv` with `values.yaml` then `values-single-machine.yaml`, `reconcileStrategy: Revision`, values from Secret `nojv-production-values`, timeout 125 min |

HelmRelease behavior:

- No inline image values; the tag, `release.sourceSha`, four digests and
  `migrator.releaseWindow` come from `values-single-machine.yaml` on `deploy`.
- `nojv-production-values` (key `values.yaml`) is mandatory (`optional: false`)
  and cluster-owned; it is never committed.
- Install retries 3 times; upgrades are not remediated
  (`remediateLastFailure: false`), so a failed upgrade stays in maintenance for
  an operator.
- Kustomization `prune: false`: do not enable while the Helm-managed CNPG
  `Cluster` is in the pruned set.

## Release

```
git tag vX.Y.Z && git push origin vX.Y.Z
  → build-images.yml: checks the tag is stable SemVer on a main commit with a
    passing Verify Repository check; builds and pushes four GHCR images
  → one commit on `deploy` (tagged main commit + values), pushed with
    --force-with-lease, refused if it would move deploy backwards
  → GitRepository/nojv → HelmRelease upgrade
```

The `deploy` commit is the deployment record; there are no separate deploy
tags. Pushing to `deploy` does not trigger CI.

## Emergency rollback

Storage is forward-only. Roll back only to a deploy commit whose web, judge and
platform templates all carry `nojv.tw/schema-contract: versioned-storage-v1`,
`nojv.tw/course-roster-contract: membership-v1` and
`nojv.tw/problem-library-contract: problem-library-v1`; the admission fence
rejects anything else. Otherwise keep workloads in maintenance and ship a forward fix
from current `main`.

```bash
candidate=<exact-deploy-commit-sha>
git grep -E 'nojv.tw/(schema-contract: versioned-storage-v1|course-roster-contract: membership-v1|problem-library-contract: problem-library-v1)' "$candidate" -- \
  infra/charts/nojv/templates/web.deployment.yaml \
  infra/charts/nojv/templates/worker-judge.deployment.yaml \
  infra/charts/nojv/templates/worker-platform.deployment.yaml
git show "$candidate":infra/charts/nojv/values-single-machine.yaml | head
current_deploy_tip="$(git ls-remote origin refs/heads/deploy | cut -f1)"
git push "--force-with-lease=refs/heads/deploy:${current_deploy_tip}" origin \
  "$candidate":refs/heads/deploy
```

The grep must print all three labels for each template, and the values must
contain the intended tag and four digests. The next version tag advances
`deploy` again.

## Bootstrap

Run on the production host, which already holds cluster-admin; never from CI.

```bash
flux check --pre
flux install

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

flux get sources git
flux get helmreleases -A
flux diff kustomization nojv --path infra/flux
```

Replace every `REAL_*` value with an existing off-host destination or Secret.
Do not put `migrator.releaseWindow` in this Secret.

To adopt an existing Helm release, keep `releaseName: nojv` and make sure the
`deploy` values pin the currently running tag, source SHA and digests so the
first reconcile changes nothing. Preserve all PVCs (CNPG and MinIO data); a
reinstall must keep them.

## Validate

CI does not apply these manifests. Before applying:

```bash
flux check
kubeconform -strict infra/flux/*.yaml
```
