# Announcement Notification Links Implementation Plan

> **For Codex:** Implement each checkpoint in order and keep the change limited to the existing notification and announcement surfaces.

**Goal:** Make announcement notifications navigate to their source, including notifications created before links were stored.

**Architecture:** Store the source URL when a new announcement notification is created. At the application boundary, derive the same URL for legacy `announcement_published` rows whose `linkUrl` is null, so both list and SSE delivery share one rule. On the public home page, an `announcement` query parameter opens the matching announcement dialog.

**Tech stack:** TypeScript, Svelte 5, Prisma JSON values, Vitest integration tests.

## Constraints

- Follow [Architecture Overview](../../architecture/ARCHITECTURE.md) and [Frontend Surface](../../architecture/FRONTEND.md).
- No schema change, migration, compatibility layer, dependency, or new route.
- URL-encode every identifier placed in a URL.
- Preserve null links for unrelated or malformed legacy notifications.

## Checkpoints

1. Run the existing announcement notification integration test on current `main` as the clean baseline.
2. Add expectations for system, course, and legacy announcement notification links; run the focused test and confirm the new expectations fail.
3. Implement the shared link resolver, use it for list and SSE output, and store links during announcement fan-out.
4. Open a matching public announcement from the home-page query parameter.
5. Run the focused integration test, unit/component suites, typechecks, lint, formatting, build, and a browser smoke test.
6. Self-review the diff, move this plan to `docs/plans/completed/`, commit, open a PR, wait for required checks, and merge.
7. After `Verify Repository` succeeds on merged `main`, create the next patch tag and verify the release workflow, deploy revision, Flux/Helm state, workload rollouts, release endpoint, live/readiness endpoints, and sandbox NetworkPolicy log.

## Risks

- A legacy notification may contain malformed params; keep its link null instead of guessing.
- A deleted, expired, or no-longer-visible announcement cannot open a dialog; navigation still lands on the owning page.
- Deployment evidence must join the exact merge SHA through CI, tag, deploy revision, and `/api/release`.
