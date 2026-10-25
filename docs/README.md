# NOJV documentation

Use this page to find the code, rule, and verification path for a change. The
root [AGENTS.md](../AGENTS.md) is the short repository entrypoint; it links the
current source of truth for each task.

## Find the right source

For why the system is shaped this way, and what must not be reversed by accident, use the [decision log](decisions/README.md).

| Task                                                 | Code entry                                                                                                                          | Read first                                                                                                                     | Verify with                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add or change an HTTP API                            | `apps/web/src/routes/api/**/+server.ts` → owning function in `packages/application/src/<domain>/`                                   | [Frontend](architecture/FRONTEND.md), [Security](operations/SECURITY.md), matching [feature spec](features/)                   | `pnpm --filter @nojv/web check`; `pnpm exec vitest run --project integration tests/integration/http/`; `pnpm test:e2e`                                               |
| Change exam permissions                              | `packages/application/src/exam/permissions.ts`; exam routes in `apps/web/src/routes/(app)/exams/`                                   | [Security](operations/SECURITY.md), [Threat Model](operations/THREAT_MODEL.md), [exam spec](features/exams.md)                 | `pnpm exec vitest run --project unit tests/unit/application/exam-permissions.test.ts`; `pnpm test:e2e`                                                               |
| Change judging or sandbox execution                  | `packages/application/src/submission/judge-context.ts`, `apps/worker/src/sandbox/`, `apps/sandbox-runner/src/`                      | [Judge Pipeline](architecture/JUDGE_PIPELINE.md), [Security](operations/SECURITY.md), [Reliability](operations/RELIABILITY.md) | `pnpm exec vitest run --project unit tests/unit/worker/`; `pnpm test:integration:sandbox`; `pnpm test:integration:k8s`                                               |
| Change the database schema or a query                | `packages/db/prisma/schema/`, `packages/db/src/repositories/`                                                                       | [Database Schema](architecture/DATABASE.md), matching [feature spec](features/)                                                | `pnpm db:validate`; `pnpm db:docs`; `pnpm exec vitest run --project integration tests/integration/db/`                                                               |
| Diagnose deployment or change Helm config            | `infra/charts/nojv/`, `infra/docker/`, `infra/gcp/`, `infra/flux/`                                                                  | [Deployment](operations/DEPLOYMENT.md), relevant [runbook](runbooks/README.md), [Reliability](operations/RELIABILITY.md)       | `pnpm lint:helm`; `pnpm exec vitest run --project unit tests/unit/infra/`                                                                                            |
| Change authentication or other permissions           | `apps/web/src/lib/auth.server.ts`, `packages/application/src/<domain>/`                                                             | [Security](operations/SECURITY.md), [Threat Model](operations/THREAT_MODEL.md), [login spec](features/login-security.md)       | `pnpm exec vitest run --project unit tests/unit/web/ tests/unit/application/`; `pnpm exec vitest run --project integration tests/integration/http/`; `pnpm test:e2e` |
| Change problem, course, contest, or submission rules | `packages/application/src/<domain>/`; problem `details/list/picker` and `mutations/`, submission `details/history/judge-context.ts` | [Product Sense](product/PRODUCT_SENSE.md), matching [feature spec](features/), [Architecture](architecture/ARCHITECTURE.md)    | `pnpm exec vitest run --project unit tests/unit/application/`; `pnpm exec vitest run --project integration tests/integration/application/`                           |
| Change Redis keys, events, or workflow dispatch      | `packages/redis/src/`, `packages/temporal/src/`, owning application domain                                                          | [Redis](architecture/REDIS.md), [Architecture](architecture/ARCHITECTURE.md), [Reliability](operations/RELIABILITY.md)         | `pnpm exec vitest run --project unit tests/unit/`; `pnpm test:integration:temporal`                                                                                  |
| Set up local development or run a suite              | `docker-compose.yml`, `tests/setup/`, `package.json`                                                                                | [Getting Started](runbooks/getting-started.md), [Testing Strategy](runbooks/testing.md)                                        | `pnpm test:unit`; `pnpm test:component`; `pnpm test:integration`; `pnpm test:e2e`                                                                                    |

## Documentation ownership

- `architecture/` explains current module boundaries and data flow.
- `product/` describes shipped product behavior.
- `features/` defines feature acceptance behavior.
- `operations/` records security, reliability, deployment, and current quality evidence and open follow-ups.
- `runbooks/` gives procedures; its [index](runbooks/README.md) links related references.
- `decisions/` records durable decisions by area: what was decided, why, what was rejected, and the rules to respect. Read it before planning.
- `superpowers/` holds in-flight Superpowers specs and plans only; they are deleted when the work ships (see [AGENTS.md](../AGENTS.md#planning-and-decisions)).
- `architecture/DATABASE.generated.md` is generated from Prisma; edit the schema/source and regenerate it with `pnpm db:docs`.

Update the authoritative living document in the same change as a behavior or
boundary change. Use brief linked summaries on other pages; keep the complete contract in its
owning document. Living docs describe the present; rationale and rejected alternatives
belong in the decision log.

## Authoring standards

These standards apply to repository Markdown, including app/package READMEs and
agent guides. Write new and substantially revised guidance in English, following
ENG-01. Preserve exact identifiers and UI strings where needed.

### Purpose and source of truth

Start with the reader's task and the document's scope. Extend the closest owning
document before creating another one. Each document has one primary purpose;
choose useful sections instead of filling a fixed template or targeting a line count.

Keep each complete rule, contract, version table or procedure in one authoritative
location. Short summaries may repeat the essential point when they help navigation
or safe execution, but must link to that source. Do not maintain independent copies.

Verify current behavior against source and tests. Living docs describe what is
implemented; history and rejected alternatives belong in decisions. Proposed work
belongs in in-flight specs/plans, not in current-behavior descriptions.

### Requirements by document type

| Type          | Must answer                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------- |
| Agent guide   | What must an agent read, which local working rules apply, and how is the change verified?    |
| Module README | What does the module own, where are its public entries, and how is it developed?             |
| Architecture  | What are the boundaries, contracts, data flow and failure behavior?                          |
| Runbook       | What are the prerequisites, steps, expected results and failure/recovery actions?            |
| Feature spec  | Which actor, under which conditions, observes which result? Use Given/When/Then.             |
| Reference     | What are the exact fields, values, defaults, constraints and source definitions?             |
| Decision      | What was chosen, why, which alternatives were rejected, and what source supports the choice? |

A runbook may link to an architecture explanation; it should not reproduce that
explanation. Keep navigation-only content in entrypoints and indexes. A small
addition normally belongs in an existing section rather than a new standalone page.

### Writing and Markdown

- Use simple, direct sentences and consistent technical names. Expand unfamiliar
  abbreviations on first use; avoid marketing claims and vague assurances.
- Use one descriptive H1 and a logical heading hierarchy. Prefer sentence case
  for new headings; preserve exact API and product names.
- Use numbered lists for ordered actions, bullets for parallel items and tables
  for comparisons. Do not add summary sections that repeat the page.
- Use descriptive link labels and relative links for repository targets. Check
  heading anchors when renaming sections and update incoming links when moving files.
- Give fenced examples a language. Specify the working directory, required services
  and placeholders for commands. Explain expected results where they determine the
  next action, and identify destructive effects before the command.
- Keep examples free of real credentials. Do not claim an example was tested unless
  it was executed in the stated environment; distinguish local checks from deployed results.
- Prefer Markdown over custom HTML. Use Prettier for formatting. Include a diagram
  only when it clarifies relationships and verify that it renders.

### Maintenance and verification

The change author updates affected documentation together with the implementation.
Do not add routine last-reviewed timestamps as a substitute for verifying content.
Generated files name their source and regeneration command; edit the source and
regenerate rather than patching the output.

Use `pnpm exec vitest run --project unit tests/unit/docs/` for relative file links
and decision-index consistency, and `pnpm lint:doc-drift` for registered stale
references and pinned toolchain values. Agent guides under apps, packages, tests,
infra, docs, scripts, tooling and .github are discovered by both checks. Generated
and dependency directories are excluded.

These guards do not verify prose accuracy, external URLs or heading anchors.
Review changed anchors and source claims directly. Format changed Markdown with
Prettier; test runnable examples with their documented prerequisites when practical,
and report any unverified steps.
