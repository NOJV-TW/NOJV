# Status Version Notification Implementation Plan

**Status:** Completed.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move production release notifications from the NOJV release workflow into the existing `NOJV-TW/status` scheduled Worker, which will notify Discord only after a stable public version and health check.

**Architecture:** The status Worker polls `https://nojv.tw/api/release`, `/api/livez`, and `/api/readyz` on its existing schedule. It stores the last observed healthy release and the last notified release in its existing D1-backed Durable Object state, requiring two consecutive healthy observations before sending one webhook notification. The first healthy release establishes a silent baseline so deploying the tracker does not announce an already-running version. The NOJV release workflow ends after publishing the verified deploy branch revision; the status Worker solely owns public deployment verification and Discord delivery.

**Tech Stack:** Cloudflare Workers, Durable Objects, D1-backed UptimeFlare state, TypeScript, GitHub Actions, Discord webhook.

---

### Task 1: Add version tracker tests and pure helpers

**Files:**

- Modify: `NOJV-TW/status/worker/src/util.ts`
- Create: `NOJV-TW/status/worker/src/version.ts`
- Create: `NOJV-TW/status/worker/src/version.test.ts`

**Steps:**

1. Define a small release identity type and pure helpers for parsing the public release response, comparing `version + sourceSha`, and formatting a Discord release message.
2. Add tests for valid response parsing, malformed response rejection, same-release deduplication, and different source SHA detection.
3. Run the status Worker typecheck/test command available in the repo and keep the helpers dependency-free.

### Task 2: Integrate polling and D1-backed notification state

**Files:**

- Modify: `NOJV-TW/status/worker/src/index.ts`
- Modify: `NOJV-TW/status/worker/src/store.ts`
- Modify: `NOJV-TW/status/worker/src/util.ts`
- Modify: `NOJV-TW/status/uptime.config.ts`

**Steps:**

1. Add one configured NOJV release tracker using the existing Worker schedule and webhook configuration.
2. Require `/api/release`, `/api/livez`, and `/api/readyz` to succeed before counting an observation as healthy.
3. Persist the last healthy release and consecutive observation count in the existing Durable Object state; establish the first healthy release silently, then notify only when a later release is healthy twice and differs from the last notified release.
4. Keep notification failures visible in Worker logs and do not advance the notified state when Discord rejects the webhook.
5. Add the release URL and notification behavior to the status README without documenting secrets.

### Task 3: Remove duplicate Discord delivery from NOJV

**Files:**

- Modify: `.github/workflows/build-images.yml`
- Modify: `docs/operations/DEPLOYMENT.md`

**Steps:**

1. Remove the duplicate production health gate from the release workflow; Flux/Kubernetes own rollout and the status Worker owns public verification.
2. Remove the `DISCORD_RELEASE_WEBHOOK_URL` validation and direct Discord notification step.
3. Document that `NOJV-TW/status` is the sole release notification owner and that the existing status bot webhook secret is used.
4. Run workflow YAML/script validation and the relevant repository checks.

### Task 4: Review and integration handoff

**Steps:**

1. Review both worktree diffs for secret leakage, duplicate notifications, and state-transition errors.
2. Run focused tests and builds in both repositories; record pre-existing NOJV environment failures separately.
3. Commit each repository independently and open PRs for status and NOJV.
