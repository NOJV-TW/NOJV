# Admin Mode and SE Recovery Implementation Plan

**Goal:** Remove release workflow annotations, prove regular-admin mode persists across navigation, and recover each failed judge generation once with admin-visible SE diagnostics.

**Architecture:** Keep the existing Redis-backed admin elevation and add only cross-page coverage. Reuse the submission sweeper, durable-work outbox, and rejudge workflow: startup marks abandoned pipelines as SE, then enqueues one deterministic recovery per submission judge generation. Store bounded SE diagnostics in the existing verdict summary for the admin submissions view.

### Task 1: Release workflow maintenance

- Upgrade `docker/login-action` to Node 24-based v4.
- Disable unused artifact storage-record creation while preserving OCI attestations.

### Task 2: Admin-mode regression proof

- Extend the regular-admin E2E flow across non-admin and admin pages.
- Verify UserMenu still exposes exit-admin-mode after navigation.
- Retain the existing super-admin-only role mutation gate.

### Task 3: SE classification and diagnostics

- Map sandbox pipeline failures to `system_error`.
- Persist bounded system-error reasons for completed, failed, and swept judge runs.
- Add SE filtering and diagnostic text to the admin submissions page.

### Task 4: Restart recovery

- Enumerate current SE submissions at platform-worker startup.
- Enqueue a deterministic system rejudge once per submission judge generation.
- Run the stale-submission sweep before recovery so abandoned pipelines participate.

### Task 5: Verification and delivery

- Run focused unit/integration/E2E tests, typecheck, lint, build, and repository CI checks.
- Commit, push, merge, then verify GitHub Actions/CD and production service health.
