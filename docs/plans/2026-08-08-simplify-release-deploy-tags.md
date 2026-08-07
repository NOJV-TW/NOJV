# Simplify Release Deploy Tags Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep version tags as the only release Git tags while retaining the digest-pinned `deploy` branch consumed by Flux.

**Architecture:** A pushed `vX.Y.Z` tag remains the release trigger and source identity. The workflow still builds and verifies all four runtime images, writes their digests plus the source SHA into `deploy`, and force-with-lease publishes only that branch. The optional `nojv-deploy-*` tag and its preflight uniqueness check are removed; rollback guidance uses an exact deploy commit instead.

**Tech Stack:** GitHub Actions, Git, Flux, Vitest, TypeScript/Node.js.

---

### Task 1: Remove deploy-tag publication and validation

**Files:**

- Modify: `.github/workflows/build-images.yml`
- Modify: `scripts/validate-release-run.mjs`
- Modify: `scripts/validate-release-run.d.mts`

1. Remove the `DEPLOY_TAG` existence check, local tag creation, and tag ref from the atomic push.
2. Remove remote deploy-tag lookup and the corresponding validator input/check.
3. Keep release-tag validation, package publication checks, digest verification, and deploy-branch monotonicity unchanged.

### Task 2: Update regression tests and operational documentation

**Files:**

- Modify: `tests/unit/infra/release-gate.test.ts`
- Modify: `tests/unit/infra/env-manifest-parity.test.ts`
- Modify: `tests/unit/infra/forward-only-recovery.test.ts`
- Modify: `infra/flux/README.md`
- Modify: `docs/plans/2026-07-13-atomic-helm-artifact.md`
- Modify: `docs/plans/2026-08-07-release-deploy-notification.md`

1. Remove tests that require deploy-tag uniqueness or publication.
2. Assert the workflow publishes only the deploy branch and does not create `nojv-deploy-*` tags.
3. Replace tag-based rollback instructions with exact deploy-commit inspection and lease-protected branch movement.
4. Update plan records so they no longer describe deploy tags as the retained artifact.

### Task 3: Verify the release contract

**Commands:**

```bash
pnpm exec vitest run tests/unit/infra/release-gate.test.ts tests/unit/infra/env-manifest-parity.test.ts tests/unit/infra/forward-only-recovery.test.ts
pnpm exec prettier --check .github/workflows/build-images.yml scripts/validate-release-run.mjs scripts/validate-release-run.d.mts infra/flux/README.md tests/unit/infra/release-gate.test.ts tests/unit/infra/env-manifest-parity.test.ts tests/unit/infra/forward-only-recovery.test.ts
git diff --check
```

Confirm the diff preserves `vX.Y.Z` tag-triggered builds, digest pinning, and Flux's `deploy` branch while removing every runtime reference to `nojv-deploy-*`.
