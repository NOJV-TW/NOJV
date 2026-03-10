# Dead Path Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove high-confidence dead files, configuration, and code paths left behind by the app restructure while keeping the current integrated web submission flow and sandbox runner working.

**Architecture:** Treat the 2026-03-10 app restructure and cloud-native sandbox design as the source of truth. Keep the web app as the user-facing workspace surface and keep the worker executing submissions through Docker/Kubernetes sandbox executors. Remove only paths that still target deleted `apps/workspace` or `apps/sandbox` packages, and update docs/config so the repository describes the current topology instead of the retired one.

**Tech Stack:** Next.js 16, Vitest, BullMQ, Prisma, Docker, GCP deployment assets

---

### Task 1: Remove the retired external workspace app launch path

**Files:**
- Delete: `apps/web/src/lib/workspace-launch.ts`
- Delete: `apps/web/tests/workspace-launch.test.ts`
- Modify: `apps/web/src/components/problem-editor.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`

**Step 1: Write the failing test**

Add a UI test expectation that the problem editor no longer renders the external workspace CTA and still renders the submission action.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test -- problem-editor.test.tsx`
Expected: FAIL because the CTA still exists.

**Step 3: Write minimal implementation**

Remove the workspace launch helper import and URL construction from `problem-editor.tsx`, delete the CTA button, and trim i18n copy that only described the retired separate workspace app.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test -- problem-editor.test.tsx`
Expected: PASS

**Step 5: Remove dead helper and its unit tests**

Delete `apps/web/src/lib/workspace-launch.ts` and `apps/web/tests/workspace-launch.test.ts` once no imports remain.

### Task 2: Remove obsolete deployment artifacts for deleted apps

**Files:**
- Delete: `infra/docker/workspace.Dockerfile`
- Delete: `infra/docker/sandbox-service.Dockerfile`
- Delete: `infra/gcp/workspace.cloudrun.yaml`
- Delete: `infra/gcp/sandbox.cloudrun.yaml`
- Modify: `infra/gcp/cloudbuild.yaml`
- Modify: `infra/gcp/deploy.sh`
- Modify: `infra/gcp/README.md`
- Modify: `infra/gcp/gke/README.md`
- Modify: `infra/gcp/gke/worker.deployment.yaml`
- Modify: `infra/gcp/gke/sandbox.deployment.yaml`
- Modify: `infra/gcp/web.cloudrun.yaml`

**Step 1: Write the failing validation**

Search for references to `apps/workspace`, `apps/sandbox`, `remote_http`, `SANDBOX_BASE_URL`, `workspace.cloudrun.yaml`, and `sandbox.cloudrun.yaml`.

**Step 2: Run validation to verify references still exist**

Run: `rg -n "apps/workspace|apps/sandbox\\b|remote_http|SANDBOX_BASE_URL|workspace\\.cloudrun\\.yaml|sandbox\\.cloudrun\\.yaml" infra README.md .env.example`
Expected: matches present.

**Step 3: Write minimal implementation**

Delete Dockerfiles/manifests that build deleted packages. Update GCP docs and manifests to reflect the current executor model (`docker` or `kubernetes`) and the sandbox-runner image, not the retired remote sandbox service.

**Step 4: Run validation to verify cleanup**

Run: `rg -n "apps/workspace|apps/sandbox\\b|remote_http|SANDBOX_BASE_URL|workspace\\.cloudrun\\.yaml|sandbox\\.cloudrun\\.yaml" infra README.md .env.example`
Expected: only intentional historical references remain outside active runtime assets.

### Task 3: Update runtime documentation and environment samples

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

**Step 1: Write the failing validation**

Search for `NEXT_PUBLIC_WORKSPACE_URL`, separate workspace app setup, and remote sandbox service wording in active docs.

**Step 2: Run validation to verify it fails**

Run: `rg -n "NEXT_PUBLIC_WORKSPACE_URL|workspace:|apps/workspace|remote sandbox|sandbox service" README.md .env.example`
Expected: matches present.

**Step 3: Write minimal implementation**

Rewrite the active setup/docs to describe the integrated web editor plus worker sandbox-runner flow. Remove env vars that no longer affect runtime behavior.

**Step 4: Run validation to verify it passes**

Run: `rg -n "NEXT_PUBLIC_WORKSPACE_URL|apps/workspace|apps/sandbox\\b|remote sandbox|sandbox service" README.md .env.example`
Expected: no matches in active docs except where explicitly preserved as historical context.

### Task 4: Verify cleanup

**Files:**
- Modify as needed based on test results

**Step 1: Run targeted tests**

Run:
```bash
pnpm --filter @nojv/web test -- workspace-launch.test.ts problem-editor.test.tsx
pnpm --filter @nojv/worker test
pnpm --filter @nojv/web test
```

Adjust the exact web test target if the repository uses a different problem editor spec file.

**Step 2: Run repo-level validation relevant to touched surfaces**

Run:
```bash
pnpm --filter @nojv/web lint
pnpm --filter @nojv/worker lint
pnpm --filter @nojv/web typecheck
pnpm --filter @nojv/worker typecheck
docker compose config
```

**Step 3: Commit**

```bash
git add README.md .env.example apps/web infra/gcp infra/docker docs/plans/2026-03-10-dead-path-cleanup-plan.md
git commit -m "refactor: remove retired workspace and sandbox paths"
```
