# Release Deploy Notification Implementation Plan

> Superseded: public production verification and release notification are now
> owned by `NOJV-TW/status`; the GitHub release workflow ends after publishing
> the immutable deploy ref.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Notify Discord only after the public production web service serves the released version and passes liveness and readiness checks.

**Architecture:** The Helm chart injects the release tag and source SHA into the web Deployment. A public, exact-path release identity endpoint exposes those two non-secret values. The existing tag workflow waits for Flux's asynchronous web rollout by polling that endpoint plus the existing health endpoints, then sends a Discord webhook from GitHub Actions. Worker pod readiness remains an in-cluster operational check because GitHub Actions has no cluster credentials.

**Tech Stack:** SvelteKit, Helm, GitHub Actions, shell `curl`/`jq`, Vitest.

---

### Task 1: Expose the deployed release identity

**Files:**

- Create: `apps/web/src/routes/api/release/+server.ts`
- Modify: `apps/web/src/lib/server/health-probes.ts`
- Modify: `apps/web/src/hooks.server.ts`
- Modify: `infra/charts/nojv/templates/web.deployment.yaml`
- Test: `tests/unit/web/health-probes.test.ts`

1. Add a GET route returning `{ version, sourceSha }` from runtime environment variables with development-safe defaults.
2. Add the exact route to the public system-path bypass without counting it as a health metric.
3. Inject `NOJV_RELEASE_VERSION` from `image.tag` and `NOJV_RELEASE_SOURCE_SHA` from `release.sourceSha` into the web Deployment.
4. Test the response and verify the route bypasses auth while preserving the existing health metric behavior.

### Task 2: Document the public release contract

**Files:**

- Modify: `apps/web/src/lib/server/openapi/public-document.ts`
- Modify: `apps/web/src/lib/server/openapi/token-document.ts`
- Modify: `docs/architecture/FRONTEND.md`
- Modify: `docs/operations/RELIABILITY.md`
- Modify: `docs/operations/THREAT_MODEL.md`
- Test: `tests/unit/openapi-contract.test.ts`
- Test: `tests/unit/security/exam-confinement-api-allowlist.test.ts`

1. Document the endpoint and its two string fields in the public OpenAPI contract.
2. Include it in the anonymous system-path document.
3. Classify it as exam-safe and document that it exposes only release identity, not runtime or user data.

### Task 3: Verify production before notifying Discord

**Files:**

- Modify: `.github/workflows/build-images.yml`
- Test: `tests/unit/infra/release-gate.test.ts`

1. Add a job depending on `deploy-ref` that polls the public release identity, liveness, and readiness endpoints until all match the tag's source SHA for three consecutive samples or the timeout expires.
2. Add a first-step secret validation and a final webhook step using a new `DISCORD_RELEASE_WEBHOOK_URL` repository secret.
3. Keep the job read-only against production; it must not receive cluster credentials.
4. Make the workflow test assert dependency ordering, expected identity checks, timeout, and secret usage.

### Task 4: Verify the change

1. Run the focused web, OpenAPI, security, and release-gate tests.
2. Run formatting and type checks for the changed files.
3. Render the production Helm chart with representative release values and confirm the two environment variables are present.
4. Review the diff and report the remaining GitHub secret and production URL configuration required for activation.
