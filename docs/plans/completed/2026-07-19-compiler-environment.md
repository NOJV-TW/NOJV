# Compiler Environment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish NOJV's exact compiler/runtime environment from the footer and make toolchain upgrades update the public page automatically while CI rejects stale deployment documentation.

**Architecture:** Keep one structured environment manifest in `@nojv/core`. The sandbox Dockerfile installs the manifest's exact APK versions, the runner consumes its command templates, the public Svelte page renders the same data, and the existing documentation-drift lint requires the deployment guide to record every pinned version.

**Tech Stack:** JSON, Docker/Alpine APK, SvelteKit 5, Paraglide JS, Node.js lint scripts.

---

### Task 1: Canonical environment and pinned image

**Files:**

- Create: `packages/core/src/judge-environment.json`
- Create: `packages/core/src/judge-environment.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `infra/docker/sandbox-runner.Dockerfile`

1. Record Alpine, Node.js, exact APK package revisions, and each supported language's normalized compile/run command.
2. Export the manifest from `@nojv/core`.
3. Make the sandbox image install the exact package revisions from the manifest and fail the build if its Alpine or Node.js base differs.
4. Build `nojv-sandbox:local` and inspect every compiler/runtime version.

### Task 2: Public page and footer entry

**Files:**

- Create: `apps/web/src/routes/(public)/environment/+page.svelte`
- Modify: `apps/web/src/lib/components/primitives/layout/Footer.svelte`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`

1. Add localized page and footer labels.
2. Render the canonical environment as a responsive language/version/compile/run table.
3. Compile Paraglide messages, build/typecheck the web app, then verify `/environment` and the footer link in both themes.

### Task 3: Upgrade documentation gate

**Files:**

- Modify: `docs/operations/DEPLOYMENT.md`
- Modify: `scripts/check-doc-drift.mjs`

1. Document the pinned toolchain table and the required upgrade procedure.
2. Extend `lint:doc-drift` to read the canonical manifest and reject missing platform, runtime, or APK revision tokens.
3. Prove the gate passes in sync and fails against one deliberately changed temporary document.
4. Run `pnpm ci:verify` and move this plan to `docs/plans/completed/` after verification.

## Verification

- `pnpm ci:verify`: 303 unit files / 2593 tests and 5 component files / 6 tests passed.
- `pnpm sandbox:build`: exact pinned sandbox image built successfully.
- All eight supported languages compiled or ran successfully in the built image.
- `/environment` was checked in both locales, both themes, and a 390px viewport.
- The documentation gate was proven to reject both a missing current pin and a stale old pin.
