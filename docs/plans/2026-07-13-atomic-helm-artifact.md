# Atomic Helm Artifact Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure every Flux rollout applies the chart templates and pinned runtime image tag from one HelmChart artifact.

**Architecture:** Keep the production image tag in `values-single-machine.yaml`, which source-controller already merges into the revision-pinned HelmChart artifact. Stop mutating inline HelmRelease values so Kustomize and HelmChart reconciliation cannot independently trigger incompatible upgrades. Retain every published deploy commit under a content-addressed git tag for deterministic emergency rollback.

**Tech Stack:** GitHub Actions, Flux Helm Controller, Helm, Vitest

---

### Task 1: Guard the atomic release contract

**Files:**

- Modify: `tests/unit/infra/env-manifest-parity.test.ts`

1. Add one assertion that the HelmRelease has no inline image tag, uses revision reconciliation with production values last, tracks the deploy branch, and the deploy workflow safely updates and stages that values file.
2. Run `pnpm exec vitest run tests/unit/infra/env-manifest-parity.test.ts` and confirm the assertion fails against the current split configuration.

### Task 2: Move the deploy tag into the chart artifact

**Files:**

- Modify: `infra/flux/helmrelease.yaml`
- Modify: `.github/workflows/build-images.yml`

1. Remove `spec.values.image.tag` from the HelmRelease.
2. Update the workflow to rewrite exactly one top-level `image.tag`, stage `infra/charts/nojv/values-single-machine.yaml`, and retain the deploy commit under `nojv-deploy-<image-tag>`.
3. Re-run the focused Vitest file and confirm it passes.

### Task 3: Document the invariant and verify rendering

**Files:**

- Modify: `infra/flux/README.md`
- Modify: `infra/flux/git-repository.yaml`

1. Document that chart templates and image tag are packaged from the same deploy revision.
2. Run Helm lint/template, Prettier, the focused unit test, and `git diff --check`.
3. Commit the minimal verified diff without pushing it.
