# NOJV Codebase Clarity and Simplification

**Status:** In progress  
**Base:** `fb9f34e5d4a56c927d04f4a4d0b7327e7a238ca0` (`origin/main`, 2026-09-24)  
**Worktree:** `.worktrees/codebase-clarity` on `codex/codebase-clarity`

## Goal

Make the responsibility and entry point of every maintained repository area clear to a contributor or agent, simplify internal code while preserving behavior, and keep live documentation aligned with the code and its verification evidence.

## Constraints and decisions

- Preserve existing product behavior, production data, security boundaries, and recovery contracts. Do not add a migration or change a public API unless review proves an existing contract is part of the specific defect being fixed.
- Keep the `apps/` and `packages/` layers. Organize code inside those boundaries by domain and runtime responsibility.
- Keep all completed plans, active plans, their original reasons, and `docs/superpowers/plans/` intact. Correct status and links; never infer completion from age.
- Prefer existing libraries and generated references. Add no dependency for organization, navigation, or dead-code checks.
- Work in reviewable phase commits on this branch and finish with one PR. Do not deploy or merge.

## Repository inventory and review disposition

At the base revision, `git ls-files` reports 2,119 tracked paths in 462 directories. The inventory is organized by owned subsystem and directory responsibility rather than a duplicated per-file manifest. Each move or deletion gets a repository-wide consumer search; generated references are traced to their generator, and historical plans retain their original content.

| Area                                                                | Current owner and entry points                                                                              | Required disposition                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                                                          | SvelteKit routes; `src/lib/server`; `src/lib/components`; `README.md`                                       | Preserve route/runtime boundaries; align feature components and server modules to domains; verify every moved import and route contract.                                                              |
| `apps/worker`                                                       | Temporal bootstrap, `activities/`, `workflows/`, and `services/`; `README.md`                               | Preserve Temporal and activity contracts; group sandbox code by Docker, Kubernetes, and shared execution; split oversized cohesive responsibilities only where the resulting interfaces stay smaller. |
| `apps/sandbox-runner`                                               | `src/index.ts`, compiler, `src/judges/`, native `nojv-exec`; `README.md`                                    | Preserve the stdin/stdout contract and container isolation; fix README paths against the current code.                                                                                                |
| `packages/application`                                              | Domain modules and `shared/`; package README                                                                | Preserve domain API and permission/transaction rules; simplify submission and problem modules by responsibility.                                                                                      |
| `packages/db`                                                       | Prisma schema/migrations, repositories, seeds and operations; package README                                | Preserve applied migration history and persisted data; split only distinct repository responsibilities; `storage` is used by seed/ops, not `src/`.                                                    |
| `packages/core`                                                     | Shared schemas, contracts, enums and pure helpers; package README                                           | Keep dependency-free domain contracts; remove only verified duplicate or unconsumed exports.                                                                                                          |
| `packages/temporal`, `redis`, `storage`, `mailer`, `sandbox-docker` | Cross-cutting runtime adapters and package entry points                                                     | Preserve runtime isolation and durable workflow/storage contracts; update actual dependency graph from manifests and imports.                                                                         |
| `tooling`, root configs and `scripts`                               | Shared build/lint/test configs and repository maintenance                                                   | Prefer one source of truth; remove obsolete exemptions and duplicated lists only after proving replacements cover all existing files.                                                                 |
| `tests`                                                             | Root-level unit, component, integration, fixtures, setup and Playwright suites                              | Classify each test by real boundary and domain; move the 33 component-configured tests out of `tests/unit`; keep destructive DB guards and real sandbox coverage.                                     |
| `infra`                                                             | Helm chart, Docker, GCP, Flux, Grafana, local Kubernetes                                                    | Preserve the single Helm deploy path and environment boundaries; verify file consumers, rendered charts and operational procedures.                                                                   |
| `docs`                                                              | Architecture, operations, product, runbooks, specs, plans, examples, generated schema and Superpowers plans | Keep one current owner per rule; keep generated files tied to source; preserve complete history and state clearly which sources are current.                                                          |

### Directory ownership at the baseline revision

Counts are tracked files under each path at the base SHA, not file totals to preserve after moves. Each child folder inherits the owning row unless it has a more specific entry. Small leaf folders stay documented by their parent README to avoid boilerplate.

| Path and tracked files                                                                 | Responsibility and allowed dependency direction                                                                                    | Evidence and treatment                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/` — 9                                                                         | Workflow policy and reusable action setup; CI invokes repository scripts and package commands.                                     | Workflow tests live under `tests/unit/infra`; review every path/config rename against workflows.                                                                                                                                                       |
| `apps/web/` — 609                                                                      | SvelteKit presentation/BFF; routes validate input and auth, then call application; server adapters own infrastructure integration. | `apps/web/README.md`, [Frontend](../../architecture/FRONTEND.md), `tests/unit/web`, `tests/component/web`, `tests/integration/web`, API/E2E suites. Preserve route and server-only boundaries.                                                         |
| `apps/worker/` — 82                                                                    | Temporal bootstrap, registered workflows, activities and sandbox execution adapters.                                               | `apps/worker/README.md`, [Architecture](../../architecture/ARCHITECTURE.md), [Judge Pipeline](../../architecture/JUDGE_PIPELINE.md), worker/judge/Temporal integration suites. Reorganize only sandbox services; preserve workflow names and payloads. |
| `apps/sandbox-runner/` — 20                                                            | Isolated native execution process and language judge adapters.                                                                     | `apps/sandbox-runner/README.md`, sandbox-runner unit/integration tests and Docker build. Keep the stdin/stdout contract and isolation.                                                                                                                 |
| `packages/application/` — 167                                                          | User-facing business rules grouped by product domain; imports core contracts, repositories and narrow infrastructure ports.        | `packages/application/README.md`, architecture and feature specs; 120 unit and 22 integration files were under legacy `domain/` at the base revision; those directories have since been renamed to `application/`.                                     |
| `packages/db/` — 138                                                                   | Prisma schema, immutable migrations, repositories, seeds and operational scripts. `src/` imports core; seed/ops also use storage.  | `packages/db/README.md`, [Database](../../architecture/DATABASE.md), DB unit/integration and migration guards. Keep applied migrations and storage/data recovery contracts.                                                                            |
| `packages/core/` — 44                                                                  | Shared Zod schemas, enums, DTOs and pure judge/domain contracts; no workspace-package dependency.                                  | `packages/core/README.md`, core unit tests, generated schema and API contract checks. Remove exports only after exhaustive consumer search.                                                                                                            |
| `packages/temporal/`, `redis/`, `storage/`, `mailer/`, `sandbox-docker/` — 46 combined | Narrow infrastructure packages with manifest and lint-enforced import boundaries.                                                  | Per-package READMEs, [Architecture](../../architecture/ARCHITECTURE.md), corresponding package unit tests. Keep browser/server and durable-work boundaries explicit.                                                                                   |
| `tooling/` and root configuration — 6 tooling files plus root manifests/config         | Shared lint, formatting, TS, workspace and test/build configuration.                                                               | `tooling/README.md`, root package scripts and config tests. Consolidate duplicate lists only when one maintained rule covers the same file set.                                                                                                        |
| `scripts/` — 23                                                                        | Repository checks, generated schema docs and maintenance/operations entry points.                                                  | `docs/README.md`, relevant operations docs and unit guard tests. Each generated artifact must name its source and command.                                                                                                                             |
| `infra/` — 93                                                                          | Helm single deploy path, Docker build inputs, Flux, GCP, Grafana and single-machine Kubernetes settings.                           | `infra/README.md`, deployment/runbooks, `tests/unit/infra`, Helm fixtures and `pnpm lint:helm`. Preserve environment separation and recovery flows.                                                                                                    |
| `tests/` — 658                                                                         | Unit, component, integration, Temporal/sandbox/Kubernetes and browser acceptance by behavior and boundary.                         | `tests/README.md`, [Testing](../../runbooks/testing.md), `vitest.config.ts`, Playwright config. Move component tests by directory and keep test databases isolated/marked.                                                                             |
| `docs/` — 198                                                                          | Current product, architecture, operations, runbooks, feature contracts, historical plans and examples.                             | `docs/README.md` and the new plan index. `DATABASE.generated.md` is generated by `scripts/generate-schema-docs.mjs`; original plans are preserved.                                                                                                     |
| `assets/`, `patches/`, root dotfiles/manifests                                         | Brand assets, locked upstream patches, and repository-wide developer policy/configuration.                                         | Root `AGENTS.md`, `README.md`, dependency policy and workflows. Retain upstream patches until the pinned consumer is removed; verify any generated asset source before moving.                                                                         |

The tracked baseline directory totals are reproducible with `git ls-files`; 2,119 tracked files occupy 462 directories. Counts above intentionally overlap parent directories. The final review records changed paths and ownership at the new revision, while consumers are checked with repository-wide searches before each move or deletion.

## Work phases

### 1. Baseline and navigation

- [x] Pull `main` fast-forward to `fb9f34e5` without changing the existing feature checkout.
- [x] Create the isolated worktree and install the frozen lockfile using Node `24.19.0`.
- [x] Record a clean `pnpm ci:verify` baseline: 384 unit files (3,555 passed, 2 skipped), 43 component files (105 passed), successful build/typecheck/lint/doc-drift/migration checks.
- [x] Trace tracked paths to their owning subsystem and leaf directory; record generated-source ownership, stale references, duplicate configuration, and deliberately historical material.
- [x] Add a concise docs landing page and reduce root `AGENTS.md` to durable global rules plus task-to-entrypoint navigation.
- [x] Add or correct only the top-level app, package, test, tooling, and infra guides needed to explain actual boundaries; do not create leaf-folder boilerplate.

### 2. Living documentation and plan status

- [ ] Verify each architecture, product, feature, security, reliability, deployment, testing and onboarding statement against current code, schema, configuration, and CI.
- [x] Correct version and workflow drift, including `.nvmrc`/Node, package-manager version, the real CI E2E smoke, current package dependencies and generated schema ownership.
- [x] Review each active plan against the current tree, Git history and any cited merge/release evidence. Mark unresolved claims for manual verification instead of guessing.
- [x] Add one plan index that explains active versus historical status, preserves all plan bodies, and relates overlapping or same-name plans without overwriting either.
- [x] Link current architecture choices to the plan or code evidence that explains them; make the feature authoring rule require doc updates in the same change.

### 3. Test taxonomy and source-tree organization

- [x] Move the 33 component-configured tests into the component tree, fix fixtures/imports, and select them by directory; retain genuinely non-rendering component-adjacent tests in unit only when classification supports it.
- [x] Align the old `tests/unit/domain/` naming with `packages/application`; update Vitest, coverage, aliases, documentation, scripts, and references as one change.
- [ ] Move worker sandbox files into clear backend/shared folders and drop backend prefixes that become redundant; update imports, docs and Docker bundle behavior.
- [ ] Split other oversized files only where each resulting module has one clear responsibility and a smaller interface. Start with submission queries/repositories and problem mutations, then review other files from the inventory.

### 4. Simplification and drift prevention

- [ ] Audit each package and app for dead code, duplicate contracts, no-value forwarding layers, redundant exports, repeated configuration and unclear ownership; substantiate deletion with tracked import/caller searches.
- [ ] Keep auth/authorization, database transactions, immutable storage ownership, workflow IDs/payloads, retries, cancellation, idempotency and sandbox controls explicit.
- [ ] Extend existing guards and link checks to validate the new live-doc index, source-tree guides and architectural dependency boundaries; allow historical content to retain historically accurate links and behavior descriptions.
- [ ] Avoid introducing a second schema manifest or an auto-generated prose hierarchy. Reuse Prisma docs generation, OpenAPI contract tests, workspace metadata and existing lint/test globs where they provide the evidence.

### 5. Verification, review and PR

- [ ] Re-run `pnpm ci:verify`, `pnpm lint:helm`, Helm GKE/single-machine rendering and `pnpm db:seed:validate`.
- [ ] Run full unit/component/integration and Playwright suites using only safety-marked local test databases/services. Re-run affected Docker/Kubernetes contracts using an isolated local target when available; do not repoint or modify a shared/production cluster.
- [ ] Walk the five navigation journeys: add an API, change exam permissions, change judge behavior, change schema, and diagnose deployment. From root entry, reach source, owning rule, tests and decision evidence in at most two documentation hops.
- [ ] Review every diff for behavior changes, history loss, unreferenced compatibility shims, generated artifacts, dangling references and evidence that overstates verification.
- [ ] Update this plan with exact final inventory, phase commits and verification output. Create one review PR from `codex/codebase-clarity`; do not merge or deploy.

## Evidence log

| Revision                                   | Check                                              | Result                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `fb9f34e5d4a56c927d04f4a4d0b7327e7a238ca0` | `pnpm install --frozen-lockfile` on Node `24.19.0` | Passed; 15 workspace projects, frozen lockfile.                                                                                            |
| `fb9f34e5d4a56c927d04f4a4d0b7327e7a238ca0` | `pnpm ci:verify`                                   | Passed; format, repository guards, build, typecheck, lint, 384 unit files / 3,555 passed / 2 skipped, and 43 component files / 105 passed. |
| `codex/codebase-clarity` after test moves  | `pnpm test:component`                              | Passed; directory glob selected 43 component files / 105 tests.                                                                            |
| `codex/codebase-clarity` after test moves  | `pnpm test:unit` and `pnpm typecheck:tests`        | Passed; 384 unit files / 3,570 passed / 2 skipped; both test TypeScript projects passed.                                                   |

## Related current guidance

- [Agent entrypoint](../../../AGENTS.md)
- [Architecture overview](../../architecture/ARCHITECTURE.md)
- [Testing strategy](../../runbooks/testing.md)
- [Plan lifecycle](../../product/PLANS.md)
