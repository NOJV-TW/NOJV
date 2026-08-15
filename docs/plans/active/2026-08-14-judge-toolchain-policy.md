# Judge Toolchain Policy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the standard judge toolchain reproducible while reducing scheduled CI noise caused by Alpine package-index drift.

**Architecture:** The existing `judge-environment.json` remains the canonical manifest for the sandbox image, runner metadata, public environment page, and deployment documentation. The current Python APK pin is already refreshed on the base branch, while this change makes scheduled isolation validation weekly instead of daily and records the explicit, atomic toolchain upgrade policy.

**Tech Stack:** GitHub Actions, Docker/Alpine APK, JSON, Markdown, pnpm/Vitest.

---

### Task 1: Verify the canonical Python pin

**Files:**

- Inspect: `packages/core/src/judge-environment.json:15`

Alpine 3.24 currently exposes `python3=3.14.7-r1`; keep the exact pin synchronized with the verified package set whenever the repository rotates revisions.

### Task 2: Sync documentation and policy

**Files:**

- Modify: `docs/operations/DEPLOYMENT.md:506-523`

Document that judge versions are not rolling dependencies: upgrade only for security or compatibility reasons, update the full manifest/table together, and validate before publishing a new image.

### Task 3: Reduce scheduled isolation noise

**Files:**

- Modify: `.github/workflows/nightly-sandbox.yml:1-10`

Rename the workflow to reflect scheduled validation and change the cron from daily to weekly. Keep manual dispatch and all isolation tests unchanged.

### Task 4: Verify and commit

Run `pnpm lint:doc-drift`, `pnpm sandbox:build`, `pnpm test:unit`, and `pnpm format`. Commit only the workflow, deployment guide, and this plan.
