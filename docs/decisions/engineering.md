# Engineering practice decisions

Durable decisions for code layering, test strategy, documentation and review practice. Read the relevant entries before planning a change here; a change that contradicts an entry must say so and update or replace the entry in the same PR. Current mechanics live in [Testing Strategy](../runbooks/testing.md).

### ENG-01 Living docs have one purpose each and describe only shipped behavior

**Decided:** 2026-04 · **Source:** [2026-04-07-documentation-restructure](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-07-documentation-restructure.md)

Each doc owns one topic and other docs link to it instead of repeating it; docs describe what has shipped, in English. `AGENTS.md` is the navigational entrypoint; `SECURITY.md` holds handling rules and `THREAT_MODEL.md` the attack-surface analysis. Auth had been described three times and some docs described aspirations.

- Rejected: a second agent entrypoint file alongside `AGENTS.md` (duplicates navigation).
- Rule: update the owning living doc in the same change as the behavior.
- Rule: do not duplicate content across docs; link instead.
- Code: `AGENTS.md`, `docs/README.md`, `tests/unit/docs/doc-links.test.ts`

### ENG-02 Strict top-down layers with business logic in `@nojv/application`, enforced by lint

**Decided:** 2026-04 · **Source:** [2026-04-02-microservice-architecture-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-microservice-architecture-redesign.md), [2026-04-02-architecture-implementation-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-architecture-implementation-plan.md), [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md), [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md), [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md), [2026-09-24-codebase-clarity](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-24-codebase-clarity.md)

SvelteKit is the BFF: load functions, actions and Temporal activities call `@nojv/application`, which calls `@nojv/db` repositories (see DAT-01 in data.md); there is no separate API server. Client-safe shared types, schemas and constants live in `@nojv/core`, and `@nojv/temporal` sits behind the orchestration port (see DAT-14 in data.md). ESLint forbids value imports that would break this: web goes through `@nojv/application`, Svelte components may only `import type` from it, `packages/db` must not import application, mailer, temporal, redis or storage, and `@nojv/application` must not import Temporal or `@sveltejs/kit`. Web's named exceptions are `@nojv/db` only in `auth.server.ts` (better-auth Prisma adapter); `@nojv/redis` in `auth.server.ts`, the rate limiter, the SSE hub and the SSE stream routes; `@nojv/temporal` only in `domain-orchestration.ts`; `@nojv/storage` only under `src/lib/server/storage/`. Business logic lives in one place, leaving room for a REST API, sandbox rewrite or domain split later; the layering is right-sized and enforced, so it is not rewritten.

- Rejected: a separate API server now (deferred); copying domain code into the client to dodge the import guard; microservices, CQRS/event sourcing, hexagonal architecture everywhere, merging the worker into web, dropping repositories for raw Prisma; removing the Prisma namespace export from `@nojv/db` (the better-auth adapter needs it).
- Rule: anything taking `RequestEvent` or calling `redirect()` stays in web; extract logic into domain functions with plain parameters.
- Rule: a page load that composes several application reads calls one page view query in the owning domain (`get<Page>PageView`, e.g. `examDomain.getExamPageView`); the load keeps only auth, redirects/`error()`, superforms and web-only serialization.
- Rule: no upward imports and no workspace cycles; `@nojv/core` has no workspace dependency and core → db → application direction is enforced per package. The dependency table in ARCHITECTURE.md and the ESLint configs are the source of truth; do not weaken the guard.
- Rule: add a new exception only by name for a specific file or package pattern in the ESLint config, with the reason in its message; never disable the whole rule.
- Rule: every workspace package has a `lint` script.
- Code: `apps/web/eslint.config.mjs`, `packages/db/eslint.config.mjs`, `packages/application/eslint.config.mjs`, `packages/application/src`, `packages/core/src`

### ENG-03 Config and registration surfaces get executable fitness tests

**Decided:** 2026-06 · **Source:** [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md), [2026-06-11-post-audit-next-phase](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-post-audit-next-phase.md)

Every surface that can silently drift is checked by a test derived from its single source of truth: workflow and activity-bundle registration, env↔Helm manifest parity, NetworkPolicy selectors↔pod labels, the worker→runner sandbox config contract, seed tables↔schema models, the route map↔`FRONTEND.md`, and a `prisma migrate diff` zero-drift gate in CI. Three "all green but broken" incidents came from registration and config gaps.

- Rule: a new config or registration surface needs a fitness test in the same change.
- Rule: repository top-level methods and `withTx` methods are intentionally different sets; do not dedupe them into one template.
- Code: `tests/unit/worker/workflow-registration.test.ts`, `tests/unit/infra/env-manifest-parity.test.ts`, `tests/unit/db/seed-tables-complete.test.ts`

### ENG-04 HTTP routes are tested through an in-process SvelteKit harness

**Decided:** 2026-06 · **Source:** [2026-06-11-post-audit-next-phase](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-post-audit-next-phase.md)

Route tests import the real `hooks.server.handle` and route handlers, drive them with a hand-built `RequestEvent`, and stub only `$env/*`, `$app/environment` and the auth-session seam. The nightly sandbox-isolation workflow runs separately and does not block PRs.

- Rejected: `new Server(manifest)` (no stable public export, breaks on patch releases); a built node adapter on an ephemeral port (heavy, conflicts with the test DB model, duplicates Playwright); avoiding `@temporalio/testing` (reversed — it now backs `tests/integration/temporal/`).
- Code: `tests/integration/http/_harness.ts`, `.github/workflows/nightly-sandbox.yml`

### ENG-05 The HTTP API is documented, not duplicated

**Decided:** 2026-06 · **Source:** [2026-06-03-public-internal-api-docs](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-03-public-internal-api-docs.md)

OpenAPI 3.1 documents render with Scalar (public at `/docs`, internal at `/docs/internal`, specs at `/api/openapi.{public,internal}.json`). The public spec is conservative; the internal one is a curated reference with no compatibility promise. Existing `@nojv/core` Zod schemas are reused where they match, never forced onto an endpoint. An earlier unused `/api/v1` skeleton did not reflect real behavior.

- Rejected: a duplicate `/api/v1/**` endpoint set.
- Rule: CI fails when a route is undocumented without an allowlist entry, or a documented path has no handler.
- Rule: a request body validated by a route lives in `@nojv/core`; the route parses it and the OpenAPI component derives from it with `zodToOpenApiSchema(schema, "input")` instead of a hand-written copy.
- Code: `apps/web/src/routes/docs/`, `apps/web/src/lib/server/openapi/`, `tests/unit/openapi-contract.test.ts`

### ENG-06 Audit findings are re-verified against code before acting

**Decided:** 2026-06 · **Source:** [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md)

About half of historical audit findings were false positives, so each finding is re-verified against current code first. Declined findings not to reopen: per-judge scoreboard amplification (throttled, see DAT-11 in data.md); removing the Prisma namespace export; streaming `listProblemSubmissions` (negligible gain, risky); reading cgroup `memory.peak` inside a shared container (overreports runner memory).

- Rule: re-read the code before fixing a finding; do not trust code comments' safety arguments.

### ENG-07 Cleanups keep the app/package layers and behavior

**Decided:** 2026-09 · **Source:** [2026-09-24-codebase-clarity](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-24-codebase-clarity.md), [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md)

Organization work stays within the `apps/` and `packages/` layers, grouping by domain or runtime responsibility, and preserves behavior, public APIs and migrations. `hooks.server.ts` stays one ordered request lifecycle, and cohesive modules are not split for line count.

- Rejected: splitting modules only to reduce line count; compatibility re-exports or shims after a move; new dependencies for organization or dead-code checks.
- Rule: component tests live under `tests/component/` and are selected by directory; application unit tests live in `tests/unit/application/`.
- Rule: generated artifacts (`DATABASE.generated.md`, paraglide runtime) name their source and regeneration command.
- Rule: zero-comment rule, enforced by `pnpm lint:comments`.
- Code: `apps/web/src/hooks.server.ts`, `tests/component/`, `tests/unit/application/`, `scripts/check-comments.mjs`
