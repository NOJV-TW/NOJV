# CI And Docs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a repository-wide GitHub Actions verification workflow, publish a concrete development roadmap, and upgrade the README into an onboarding and delivery document.

**Architecture:** Keep CI simple and deterministic: one root verification script, one GitHub Actions workflow, and one documentation set that points contributors to the same commands and roadmap. Avoid deployment automation in this phase; CI is a quality gate only.

**Tech Stack:** GitHub Actions, pnpm, Turbo, Prisma, Docker Compose, Markdown

---

### Task 1: Normalize repository hygiene for CI

**Files:**

- Modify: `.gitignore`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`

**Step 1: Verify red**

Run: `test -f .github/workflows/ci.yml`
Expected: FAIL because the workflow does not exist yet.

**Step 2: Write minimal implementation**

- Add a root `ci:verify` script that runs format, lint, test, build, Prisma validation, and Docker Compose validation.
- Ignore generated build artifacts from nested app directories so local builds do not pollute git status.
- Add a GitHub Actions workflow for `push` to `main` and all pull requests.

**Step 3: Verify green**

Run: `pnpm ci:verify`
Expected: all verification commands complete successfully.

### Task 2: Publish the platform development roadmap

**Files:**

- Create: `docs/plans/2026-03-08-platform-development-roadmap.md`

**Step 1: Write the development plan**

- Define staged milestones for:
  - judge execution
  - auth and authoring
  - contest engine
  - anti-cheat evidence system
  - GCP delivery

**Step 2: Verify clarity**

Run: `sed -n '1,260p' docs/plans/2026-03-08-platform-development-roadmap.md`
Expected: roadmap is concrete, phased, and actionable.

### Task 3: Upgrade README into a contributor-facing guide

**Files:**

- Modify: `README.md`

**Step 1: Write minimal implementation**

- Add project status and architecture overview.
- Add local setup, service responsibilities, and verification flow.
- Add CI description and roadmap links.
- Document the expected developer workflow from clone to validation.

**Step 2: Verify green**

Run: `pnpm format`
Expected: README and plan documents match repository formatting rules.

### Task 4: Final verification

**Files:**

- No new files.

**Step 1: Run the full suite**

Run:

```bash
pnpm format
pnpm lint
pnpm test
pnpm build
pnpm db:validate
docker compose config
```

Expected: all commands exit successfully.

**Step 2: Manual checklist**

- CI workflow is present and references the root verification script.
- README explains how to work on the repo without guessing.
- Development roadmap exists and covers the next major delivery phases.
