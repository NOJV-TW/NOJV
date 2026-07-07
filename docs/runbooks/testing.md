# Testing Strategy

How tests are organized in NOJV, where new tests belong, and how to run them.

## Three Layers

| Layer           | Scope                                                          | Real dependencies?                         | Location                         |
| --------------- | -------------------------------------------------------------- | ------------------------------------------ | -------------------------------- |
| **Unit**        | One pure function, one Zod schema, one small module            | No — mock or skip                          | `tests/unit/` (repo root)        |
| **Integration** | Cross-package paths, repository + DB, Redis, Temporal test env | Yes — uses real test DB / Redis / Temporal | `tests/integration/` (repo root) |
| **E2E**         | Full user journey through SvelteKit + worker + sandbox         | Yes — runs against a booted system         | `tests/e2e/` (Playwright)        |

## Decision Flow: Where Does My New Test Go?

```
Does the code under test live in exactly one package and have no I/O?
├── Yes → Unit test in tests/unit/
└── No
    ├── Crosses packages OR needs real DB/Redis/Temporal?
    │   └── Yes → tests/integration/
    └── Drives the UI through the browser?
        └── Yes → tests/e2e/
```

Rules of thumb:

- A repository function that hits Prisma → integration test (real DB).
- A domain function that does only math / parsing / Zod work → unit test in `tests/unit/`.
- A SvelteKit action or `+page.server.ts` loader → integration test (it touches the auth + DB stack).
- A new UI flow that the user sees → E2E.

## File Naming

- Always `.test.ts`. Never `.spec.ts` — the repo has zero `.spec.ts` files and we keep it that way.
- All tests live under the repo-root `tests/` tree: `tests/unit/`, `tests/integration/`, and `tests/e2e/`. The Vitest projects are wired to those exact globs in `vitest.config.ts`.

## Commands

```bash
pnpm test:unit          # Vitest unit tests across all packages and apps
pnpm test:integration   # Vitest integration tests (needs DB + Redis + Temporal up)
pnpm test:e2e           # Playwright E2E (local only; not part of CI)
pnpm ci:verify          # Fast local gate — no PG/Redis needed (see below for what it does NOT cover)
```

`ci:verify` runs the dependency-free subset only: `format` + the `lint:*` guards + `db:generate` + `turbo run build typecheck lint` + `typecheck:tests` + `test:unit`. It deliberately does **not** stand up Postgres or Redis, so it does **not** run: integration tests, the coverage gate (`pnpm test:coverage`), the migration schema-drift check (`prisma migrate diff --exit-code`), or `helm lint`. Those run only in CI (`.github/workflows/ci.yml`), which provisions PG + Redis first. A green `ci:verify` locally is necessary but not sufficient — CI is the source of truth.

Turbo task wiring lives in `turbo.json`. `test:unit` does not depend on `build` — unit tests should run fast and in isolation.

## Setup Prerequisites

- **Unit**: none. `pnpm install` is enough.
- **Integration**: a running PostgreSQL, Redis, and Temporal. Use `docker compose up` from the repo root.
- **E2E**: same as integration, plus the web dev server. Playwright config lives at `tests/e2e/playwright.config.ts`.

Global Vitest setup (test users, seeded DB state) is in `tests/setup/`.

## What NOT to Do

- Don't mock the database for integration tests. Use the real test DB. We've been burned before — see `MEMORY.md` history on mocked-migration drift.
- Don't co-locate tests next to the code in a package `__tests__/` folder. Every test lives under the repo-root `tests/` tree; the Vitest globs won't pick up anything outside it.
- Don't put DB/Redis/Temporal-dependent tests under `tests/unit/`. `test:unit` must stay fast — those belong in `tests/integration/`.

## Coverage Targets

We don't enforce a coverage percentage. The bar is: every domain mutation has a unit test for its pure logic, and every API/form action that touches DB has an integration test for the golden path plus the one most likely failure case.

## Related Docs

- [Reliability Invariants](../operations/RELIABILITY.md) — what must never break
- [Quality Ledger](../operations/QUALITY_SCORE.md) — known tech debt
- [Getting Started](getting-started.md) — first-time local dev setup
