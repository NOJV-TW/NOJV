# V-Tag Releases Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build, publish, and deploy production images only after pushing a stable `vX.Y.Z` tag whose commit has passed main CI.

**Architecture:** The release workflow listens to tag pushes, validates the tag, main ancestry, and the successful `Verify Repository` check, then builds four images under the version tag. The deploy branch records the source commit, version tag, and registry-returned digests atomically for Flux.

**Tech Stack:** GitHub Actions, Node.js, Bash, Helm, Vitest, Flux.

---

### Task 1: Lock the release contract in tests

**Files:**

- Modify: `tests/unit/infra/release-gate.test.ts`
- Modify: `tests/unit/infra/deploy-image-values.test.ts`
- Modify: `tests/unit/infra/image-immutability.test.ts`
- Modify: `tests/fixtures/helm/immutable-image-digests.yaml`

1. Assert that only stable `vX.Y.Z` tag pushes can enter the release workflow.
2. Assert that the tag commit is on main and has a successful GitHub Actions `Verify Repository` check.
3. Assert that deploy values retain the commit SHA while setting `image.tag` to the version.
4. Run the targeted tests and confirm they fail against the old main-push workflow.

### Task 2: Implement the minimum release changes

**Files:**

- Modify: `.github/workflows/build-images.yml`
- Modify: `scripts/validate-release-run.mjs`
- Modify: `scripts/build-release-image.sh`
- Modify: `scripts/promote-release-image.sh`
- Modify: `scripts/update-deploy-image-values.mjs`
- Modify: `infra/charts/nojv/templates/_helpers.tpl`
- Modify: `infra/charts/nojv/values-single-machine.yaml`

1. Change the workflow trigger from successful main CI runs to `v*` tag pushes.
2. Validate strict stable SemVer, exact checkout, main ancestry, and the successful required check before package writes.
3. Keep OCI revision as the source SHA and OCI version/image tag as `vX.Y.Z`.
4. Write source SHA, version tag, and all four digests to the deploy branch in one commit.
5. Run the targeted tests and `actionlint`.

### Task 3: Align operations documentation

**Files:**

- Modify: `infra/flux/README.md`
- Modify: `docs/operations/DEPLOYMENT.md`
- Modify: `infra/charts/nojv/README.md`

1. Document `git tag vX.Y.Z && git push origin vX.Y.Z` as the release action.
2. State that main pushes run CI only and Flux deploys only version-tagged images.
3. Run formatting and documentation drift checks.

### Task 4: Verify and publish

1. Run the release, Helm, and policy tests.
2. Run `pnpm ci:verify`.
3. Review the final diff for fail-closed behavior.
4. Commit, push, open a PR, and merge only after all required checks pass.
