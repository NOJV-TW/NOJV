# Flux GitOps Cutover — Remove the Self-Hosted Runner From Production

Status: **Planned** (not yet executed). This document is the design; the
cutover itself runs from the production box in a maintenance window and is
tracked here until it lands, then moves to `completed/`.

## Why

The pre-launch audit found a P0: the production single-node k3s box runs a
**repo-level self-hosted GitHub Actions runner on a PUBLIC repository**, with
`KUBECONFIG=/etc/rancher/k3s/k3s.yaml` (cluster-admin) and passwordless sudo.
Any fork pull request can define its own workflow with
`runs-on: [self-hosted, linux]` and have attacker-controlled code execute on
the box — reading the kubeconfig and dumping `nojv-runtime-secrets`. GitHub's
own guidance is: never use self-hosted runners with public repositories.

Hardening the runner in place (org runner group, require-approval-for-all,
protected environment) is mitigation. This plan **removes the runner from the
attack surface entirely** by switching deployment from **push** (a runner runs
`helm upgrade`) to **pull** (an in-cluster Flux controller reconciles the same
Helm chart from git + GHCR). After cutover there is no self-hosted runner to
abuse, and CI holds zero cluster credentials.

## Why Flux (not Argo CD)

Single-node, lean-ops, open-source, wants image-tag automation:

- Native `HelmRelease` — reuses `infra/charts/nojv` as-is (real Helm releases).
- Native image-update automation (image-reflector + image-automation) that
  writes the new GHCR tag **back into git** — auditable, fits an open repo.
- Lighter footprint than Argo's central control plane; no UI needed.

Argo CD's advantage is its dashboard and multi-cluster management, neither of
which this deployment needs. Revisit if a dashboard becomes a requirement.

## Current State

```
ci.yml (ubuntu-latest)  ── build/test ──► (on push to main) triggers
deploy.yml
  build-push (ubuntu-latest)  ── docker buildx --push ──► GHCR (ghcr.io/nojv-tw/*)
  deploy      (SELF-HOSTED, cluster-admin)  ── helm upgrade --install nojv
                infra/charts/nojv -f values-single-machine.yaml
                --set image.tag=$SHA
```

The self-hosted `deploy` job is the P0.

## Target State

```
ci.yml (ubuntu-latest)   ── lint/test/build + docker buildx --push ──► GHCR
                            (NO cluster credentials, NO self-hosted runner)

in-cluster Flux (pull):
  GitRepository(repo, branch main, path infra/flux)
  HelmRelease(chart: infra/charts/nojv, values: values-single-machine.yaml,
              image tag from a git-tracked file)
  ImageRepository(GHCR) → ImagePolicy(newest sha) → ImageUpdateAutomation
      (commits the new tag back to git → reconcile applies it)
```

Deployment becomes: git is the source of truth, the cluster pulls. Everything
Flux needs is **outbound** (github.com + ghcr.io), which the NAT/Cloudflare-
Tunnel topology already allows. Nothing pushes in.

## Files

**Added in this PR** (`infra/flux/`, ready to apply — not yet applied):

- `infra/flux/git-repository.yaml` — `GitRepository` (NOJV-TW/NOJV, `main`) +
  root `Kustomization` pointing at `infra/flux`.
- `infra/flux/kustomization.yaml` — lists the HelmRelease + image automation.
- `infra/flux/helmrelease.yaml` — `HelmRelease` wrapping `infra/charts/nojv`
  with `valuesFiles: [values-single-machine.yaml]`; `image.tag` carries the
  `{"$imagepolicy": "flux-system:nojv:tag"}` setter marker.
- `infra/flux/image-automation.yaml` — `ImageRepository` (GHCR nojv-web),
  `ImagePolicy` (numerical on the `main-<build>` tag), `ImageUpdateAutomation`.
- `infra/flux/README.md` — bootstrap + cutover + decommission runbook.

**Also done in this PR (forward-compatible, no effect on the current pipeline):**

- `.github/workflows/deploy.yml` build-push also tags images `main-<run_number>`
  — the monotonic tag the `ImagePolicy` sorts on.
- `.github/workflows/ci.yml` push trigger gains `paths-ignore: [infra/flux/**]`
  so the fluxbot tag-bump commit does not re-trigger a CI/build loop.

**Deferred to the cutover (from the box, in a maintenance window):**

- Install Flux + apply the source (phases 2–5 below).
- Delete the self-hosted `deploy` job from `deploy.yml`, keeping only
  build-push to GHCR (the HEAD-freshness guard + prune stay on the build side).
- Deregister the self-hosted runner + revoke its token (closes the P0).

## ⛔ Hard prerequisite — DB durability (do NOT cut over until ALL true)

A 2026-07-08 prod inspection found the student database **one accident away from
total, irreversible loss**, which a `prune`-capable GitOps controller would make
far more likely. Handing Flux the `nojv` release before these hold is negligent:

- [x] **PV reclaim = Retain** on `nojv-pg-1` and `nojv-minio` (was `Delete` on
      `local-path` → PVC deletion = data gone). Patched live 2026-07-08; also
      set this on any re-provisioned volume.
- [x] **`helm.sh/resource-policy: keep`** on the CNPG `Cluster` CR (chart) so
      helm/helm-controller can never delete it.
- [x] **Flux `Kustomization` `prune: false`** (`infra/flux/git-repository.yaml`).
      Do not flip to `true` while the DB is in the pruned set.
- [ ] **CNPG backups enabled + a restore rehearsed** (Issue #209 — currently
      NO `ScheduledBackup`/`Backup` objects exist). This is the real launch
      blocker; needs the R2/S3 credentials secret. **Cutover is gated on this.**

## Migration Phases

Each phase is independently verifiable; do not proceed on a failed check.
Phase 0 is the prerequisite gate above — do not start phase 1 until backups
are enabled and a restore has been rehearsed.

1. **Prep credentials.** Create a git deploy key (write) for the image-
   automation commits and a GHCR read token for image scanning (images are
   public, so pulls need none; scanning may want a token for rate limits).
   → verify: `flux` CLI installed on the box; tokens stored as k8s secrets.
2. **Install Flux** on the k3s box from the box itself (it already holds
   cluster-admin locally — this is a one-time local action, NOT from CI):
   `flux bootstrap github ...` or `flux install` + apply sync manifests.
   → verify: `flux check` green; `flux get sources git` reconciled.
3. **Author the HelmRelease** wrapping the existing chart + values, image tag
   pinned to the **current** deployed sha in `image-tag.yaml`.
   → verify: `flux diff` / a dry-run shows no drift vs the live release.
4. **Ownership handoff** of the existing `nojv` Helm release to Flux's helm-
   controller (same release name/namespace). **Preserve all PVCs — the CNPG
   Postgres data and MinIO buckets live on them.** Do in a maintenance window;
   if a clean reinstall is needed, `helm uninstall` must keep PVCs.
   → verify: pods healthy, DB intact, site up, `flux get helmrelease` Ready.
5. **Wire image automation.** ImageRepository scans GHCR, ImagePolicy selects
   the newest sha, ImageUpdateAutomation commits the bump.
   → verify: push a no-op image tag; confirm Flux commits it and reconciles.
6. **Cutover CI.** Remove the self-hosted `deploy` job; CI now ends at
   build+push to GHCR.
   → verify: a merge to main builds+pushes, Flux picks up the new tag and
   deploys, with no runner involved.
7. **Decommission the runner.** Remove the repo's self-hosted runner
   registration, revoke its token, drop the `nn` passwordless sudo. **This is
   the step that closes the P0.**
   → verify: `gh api repos/NOJV-TW/NOJV/actions/runners` returns none; a fork
   PR can no longer target a self-hosted runner.

## Risks & Decisions

- **Image-automation commit re-triggers CI.** ImageUpdateAutomation commits to
  `main`, which `ci.yml` (`on: push`) would rebuild. Mitigate: give `ci.yml` a
  `paths-ignore: [infra/flux/image-tag.yaml]`, or have the automation commit
  with a bot identity CI skips. **Decide before step 5.**
- **Release ownership handoff (DATA-LOSS RISK).** Flux adopting the live `nojv`
  release runs helm against a release that contains the Helm-managed CNPG
  `Cluster` CR. A bad reconcile / prune could delete the Cluster → the operator
  drops the PVC. Mitigated by the prerequisite gate above (Retain PVs +
  resource-policy:keep + prune:false + backups). Rehearse with `flux diff`;
  never `helm uninstall` without confirming PVs are Retain and backed up.
- **Secrets in an open repo.** `nojv-runtime-secrets` stays created out-of-band
  (current posture). If we ever want secrets in git, adopt SOPS or Sealed
  Secrets — **follow-up, not required for cutover.**
- **Flux as a single-node add-on.** If Flux is down the cluster keeps serving
  its last-applied state; only deploys pause. Acceptable for one node.
- **Rollback got better.** A bad deploy is a `git revert` of the tag bump;
  Flux reconciles back. No more `helm rollback` from a runner.

## What This PR Does vs. What Needs a Human

This PR ships the Flux manifests (`infra/flux/`) and the two forward-compatible
CI changes, alongside the P1/P2/P3 remediation. It does **not** touch the live
cluster.

The cutover itself (Flux install, release ownership handoff, runner
decommission — phases 2–7) is a **maintenance-window action from the prod box**.
It is deliberately not automated: it mutates a production cluster holding the
CNPG Postgres database, so it needs a human present, PVCs verified, and a
rollback path ready.

The immediate P0 stopgap is independent and should be done today regardless:
GitHub → Settings → Actions → Fork pull request workflows → **Require approval
for all external contributors** (closes the returning-contributor auto-run
hole while this migration is planned/executed).
