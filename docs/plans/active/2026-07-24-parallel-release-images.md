# Parallel Release Images Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce merge-to-deploy latency by building the four production images concurrently without weakening release provenance or deploy gating.

**Architecture:** Keep one trusted `workflow_run` preflight that validates the successful `main` CI run. Fan out four independent image jobs that refresh same-SHA publication state before reusing the existing release build and promotion scripts, then let the deploy job consume all four immutable digests only after every image job succeeds.

**Tech Stack:** GitHub Actions, Bash, Vitest

---

### Task 1: Lock the parallel release contract

**Files:**

- Modify: `tests/unit/infra/release-gate.test.ts`

1. Add assertions for one preflight job, four independent image jobs, and a deploy job that needs every digest producer.
2. Run `pnpm exec vitest run --project unit tests/unit/infra/release-gate.test.ts` and confirm the current serial workflow fails the new contract.

### Task 2: Parallelize image publication

**Files:**

- Modify: `.github/workflows/build-images.yml`

1. Move trusted release validation into `prepare-release`.
2. Add independent `build-web`, `build-worker`, `build-migrator`, and `build-sandbox` jobs, each checking out the validated SHA, refreshing retry-safe publication state, and reusing the existing build, attestation, and promotion scripts.
3. Make `deploy-ref` require the preflight plus all four image jobs and consume their exact outputs.

### Task 3: Verify and publish

**Files:**

- Verify: `.github/workflows/build-images.yml`
- Verify: `tests/unit/infra/release-gate.test.ts`

1. Run the release-gate, supply-chain-policy, and environment parity unit tests.
2. Run formatting and the full repository CI verification.
3. Review the final diff, commit only the plan, workflow, and release-gate test, then push and open a draft PR.
