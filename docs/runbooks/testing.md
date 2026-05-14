# Testing Strategy

How tests are organized in NOJV, where new tests belong, and how to run them.

## Three Layers

| Layer           | Scope                                                          | Real dependencies?                         | Location                                                                     |
| --------------- | -------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| **Unit**        | One pure function, one Zod schema, one small module            | No — mock or skip                          | Co-located: `packages/{name}/src/__tests__/` or `apps/{name}/src/__tests__/` |
| **Integration** | Cross-package paths, repository + DB, Redis, Temporal test env | Yes — uses real test DB / Redis / Temporal | `tests/integration/` (repo root)                                             |
| **E2E**         | Full user journey through SvelteKit + worker + sandbox         | Yes — runs against a booted system         | `tests/e2e/` (Playwright)                                                    |

## Decision Flow: Where Does My New Test Go?

```
Does the code under test live in exactly one package and have no I/O?
├── Yes → Unit test, co-located in that package's __tests__
└── No
    ├── Crosses packages OR needs real DB/Redis/Temporal?
    │   └── Yes → tests/integration/
    └── Drives the UI through the browser?
        └── Yes → tests/e2e/
```

Rules of thumb:

- A repository function that hits Prisma → integration test (real DB).
- A domain function that does only math / parsing / Zod work → unit test next to the function.
- A SvelteKit action or `+page.server.ts` loader → integration test (it touches the auth + DB stack).
- A new UI flow that the user sees → E2E.

## File Naming

- Always `.test.ts`. Never `.spec.ts` — the repo has zero `.spec.ts` files and we keep it that way.
- Place unit tests in `__tests__/` adjacent to the code, not in a sibling `tests/` folder.
- Integration / E2E tests live only at `tests/integration/` and `tests/e2e/` at the repo root.

## Commands

```bash
pnpm test:unit          # Vitest unit tests across all packages and apps
pnpm test:integration   # Vitest integration tests (needs DB + Redis + Temporal up)
pnpm test:e2e           # Playwright E2E (local only; not part of CI)
pnpm ci:verify          # The full CI pipeline locally: format + db:generate + typecheck + lint + build + test
```

Turbo task wiring lives in `turbo.json`. `test:unit` does not depend on `build` — unit tests should run fast and in isolation.

## Setup Prerequisites

- **Unit**: none. `pnpm install` is enough.
- **Integration**: a running PostgreSQL, Redis, and Temporal. Use `docker compose up` from the repo root.
- **E2E**: same as integration, plus the web dev server. Playwright config lives at `apps/web/playwright.config.ts`.

Global Vitest setup (test users, seeded DB state) is in `tests/setup/`.

## What NOT to Do

- Don't mock the database for integration tests. Use the real test DB. We've been burned before — see `MEMORY.md` history on mocked-migration drift.
- Don't put integration tests inside a package's `__tests__/`. Co-located tests run as part of `test:unit` and must stay fast.
- Don't create a new top-level `tests/<feature>/` folder. Stick to `unit` (co-located), `integration`, and `e2e`.

## Coverage Targets

We don't enforce a coverage percentage. The bar is: every domain mutation has a unit test for its pure logic, and every API/form action that touches DB has an integration test for the golden path plus the one most likely failure case.

## Related Docs

- [Reliability Invariants](../operations/RELIABILITY.md) — what must never break
- [Quality Ledger](../operations/QUALITY_SCORE.md) — known tech debt
- [Getting Started](getting-started.md) — first-time local dev setup
