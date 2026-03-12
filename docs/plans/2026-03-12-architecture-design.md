# NOJV Architecture Design

> Date: 2026-03-12
> Status: Approved

## Tech Stack

| Layer                 | Technology                       | Note                                 |
| --------------------- | -------------------------------- | ------------------------------------ |
| Runtime               | Node.js 24+                      | Existing                             |
| Package Manager       | pnpm 10                          | Existing                             |
| Monorepo              | Turborepo                        | Existing                             |
| Frontend              | SvelteKit 2 + Svelte 5           | Existing                             |
| UI Components         | shadcn-svelte (Bits UI)          | New, keep current styling            |
| Styling               | Tailwind CSS 4                   | Existing                             |
| i18n                  | Paraglide.js (inlang)            | Replace svelte-i18n                  |
| Auth                  | BetterAuth                       | Existing, clean up NextAuth remnants |
| Database              | PostgreSQL 17 + Prisma 7         | Existing                             |
| Queue                 | BullMQ + Redis 8                 | Existing                             |
| Code Editor           | Monaco Editor                    | Existing                             |
| Markdown              | marked + svelte-markdown + KaTeX | Existing                             |
| Charts                | ECharts                          | Existing                             |
| Unit/Integration Test | Vitest                           | Existing                             |
| E2E Test              | Playwright                       | Existing                             |
| CI                    | GitHub Actions                   | Existing                             |
| Deploy                | GCP (Cloud Run + GKE)            | Existing                             |

### New Dependencies

- `bits-ui` + `tailwind-variants` — shadcn-svelte base
- `@inlang/paraglide-sveltekit` — compile-time i18n

### Removed

- `svelte-i18n` — replaced by Paraglide
- All integrity/anti-cheat modules (CheatingCase, CheatingSignal, TelemetryProbe, evaluateIntegritySignals)
- All workspace session/run modules

## Key Design Decisions

1. **SvelteKit native first** — use `+page.server.ts` load / form actions; only use `+server.ts` API routes for polling
2. **Domain-scoped within SvelteKit conventions** — `lib/components/{domain}/` + `lib/server/{domain}/` (Approach A)
3. **Svelte 5 runes** — `$state`, `$derived`, `$effect` + context API for state management
4. **Moderate package splitting** — extract `@nojv/sandbox` and `@nojv/queue` from `@nojv/core`
5. **Layered testing** — E2E (Playwright) + Integration (Vitest) + Unit (Vitest)
6. **Paraglide.js i18n** — compile-time, type-safe, tree-shakable translations

## Packages

```
packages/
├── db/              # Prisma schema, client, migrations, seed
├── core/            # Shared domain Zod schemas + TypeScript types
├── sandbox/         # Sandbox contracts (worker ↔ sandbox-runner)
└── queue/           # Queue job definitions (web ↔ worker)
```

### Dependency Graph

```
web ──→ db, core, queue
worker ──→ db, core, queue, sandbox
sandbox-runner ──→ core, sandbox
```

### Package Details

| Package         | Responsibility                                                                | Dependents                  |
| --------------- | ----------------------------------------------------------------------------- | --------------------------- |
| `@nojv/db`      | Prisma schema, client singleton, env parsing, seed                            | web, worker                 |
| `@nojv/core`    | Domain Zod schemas (problem, course, contest, submission), shared types       | web, worker, sandbox-runner |
| `@nojv/sandbox` | SandboxRequest / SandboxResult types, language config, judge type definitions | worker, sandbox-runner      |
| `@nojv/queue`   | Queue names, SubmissionJudgeJob schema                                        | web, worker                 |

## File Tree

```
NOJV/
├── apps/
│   ├── web/                                    # SvelteKit app
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── +layout.svelte
│   │   │   │   │   ├── signin/+page.svelte
│   │   │   │   │   ├── signup/+page.svelte
│   │   │   │   │   └── complete-profile/+page.svelte
│   │   │   │   ├── (app)/
│   │   │   │   │   ├── +layout.server.ts       # auth guard
│   │   │   │   │   ├── +layout.svelte
│   │   │   │   │   ├── +page.svelte            # dashboard
│   │   │   │   │   ├── problems/
│   │   │   │   │   │   ├── +page.server.ts
│   │   │   │   │   │   ├── +page.svelte
│   │   │   │   │   │   ├── create/+page.server.ts
│   │   │   │   │   │   └── [slug]/
│   │   │   │   │   │       ├── +page.server.ts
│   │   │   │   │   │       ├── +page.svelte
│   │   │   │   │   │       └── edit/+page.server.ts
│   │   │   │   │   ├── courses/
│   │   │   │   │   │   ├── +page.server.ts
│   │   │   │   │   │   └── [slug]/
│   │   │   │   │   │       ├── +page.server.ts
│   │   │   │   │   │       ├── +page.svelte
│   │   │   │   │   │       ├── join/[token]/+page.server.ts
│   │   │   │   │   │       ├── assignments/[assessmentSlug]/+page.server.ts
│   │   │   │   │   │       ├── exams/[assessmentSlug]/+page.server.ts
│   │   │   │   │   │       └── manage/
│   │   │   │   │   │           ├── +layout.server.ts
│   │   │   │   │   │           ├── assessments/+page.server.ts
│   │   │   │   │   │           ├── members/+page.server.ts
│   │   │   │   │   │           └── problems/+page.server.ts
│   │   │   │   │   ├── contests/
│   │   │   │   │   │   ├── +page.server.ts
│   │   │   │   │   │   └── [slug]/+page.server.ts
│   │   │   │   │   ├── submissions/+page.server.ts
│   │   │   │   │   ├── assignments/+page.server.ts
│   │   │   │   │   ├── exams/+page.server.ts
│   │   │   │   │   ├── account/+page.server.ts
│   │   │   │   │   └── admin/
│   │   │   │   │       └── +layout.server.ts
│   │   │   │   ├── api/
│   │   │   │   │   └── submissions/[id]/+server.ts
│   │   │   │   ├── +layout.server.ts           # locale detection
│   │   │   │   ├── +layout.svelte              # Paraglide provider
│   │   │   │   └── +error.svelte
│   │   │   │
│   │   │   ├── lib/
│   │   │   │   ├── components/
│   │   │   │   │   ├── ui/                     # shadcn-svelte
│   │   │   │   │   ├── problem/
│   │   │   │   │   │   ├── editor.svelte
│   │   │   │   │   │   ├── workspace.svelte
│   │   │   │   │   │   ├── description.svelte
│   │   │   │   │   │   ├── testcase-panel.svelte
│   │   │   │   │   │   ├── creation-panel.svelte
│   │   │   │   │   │   └── submission-list.svelte
│   │   │   │   │   ├── course/
│   │   │   │   │   │   ├── assessment-board.svelte
│   │   │   │   │   │   ├── join-panel.svelte
│   │   │   │   │   │   ├── problem-shelf.svelte
│   │   │   │   │   │   └── member-table.svelte
│   │   │   │   │   ├── contest/
│   │   │   │   │   │   └── scoreboard.svelte
│   │   │   │   │   └── layout/
│   │   │   │   │       ├── header.svelte
│   │   │   │   │       ├── user-menu.svelte
│   │   │   │   │       └── locale-switcher.svelte
│   │   │   │   │
│   │   │   │   ├── server/
│   │   │   │   │   ├── auth.ts
│   │   │   │   │   ├── db.ts
│   │   │   │   │   ├── queue.ts
│   │   │   │   │   ├── problem/
│   │   │   │   │   │   ├── queries.ts
│   │   │   │   │   │   └── mutations.ts
│   │   │   │   │   ├── course/
│   │   │   │   │   │   ├── queries.ts
│   │   │   │   │   │   └── mutations.ts
│   │   │   │   │   ├── contest/
│   │   │   │   │   │   ├── queries.ts
│   │   │   │   │   │   └── mutations.ts
│   │   │   │   │   └── submission/
│   │   │   │   │       ├── queries.ts
│   │   │   │   │       └── mutations.ts
│   │   │   │   │
│   │   │   │   ├── paraglide/                  # auto-generated (gitignore)
│   │   │   │   ├── auth-client.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── utils.ts
│   │   │   │
│   │   │   ├── hooks.server.ts
│   │   │   ├── app.html
│   │   │   └── app.css
│   │   │
│   │   ├── project.inlang/
│   │   │   └── settings.json
│   │   ├── messages/
│   │   │   ├── en.json
│   │   │   └── zh-TW.json
│   │   ├── tests/
│   │   │   ├── e2e/
│   │   │   │   ├── auth.test.ts
│   │   │   │   ├── problem.test.ts
│   │   │   │   ├── course.test.ts
│   │   │   │   └── fixtures/
│   │   │   ├── integration/
│   │   │   │   ├── problem/
│   │   │   │   │   ├── queries.test.ts
│   │   │   │   │   └── mutations.test.ts
│   │   │   │   ├── course/
│   │   │   │   │   ├── queries.test.ts
│   │   │   │   │   └── mutations.test.ts
│   │   │   │   └── submission/
│   │   │   │       └── mutations.test.ts
│   │   │   └── unit/
│   │   │       ├── types.test.ts
│   │   │       └── utils.test.ts
│   │   ├── static/
│   │   ├── svelte.config.js
│   │   ├── vite.config.ts
│   │   ├── playwright.config.ts
│   │   ├── vitest.config.ts
│   │   └── package.json
│   │
│   ├── worker/                                 # BullMQ worker
│   │   ├── src/
│   │   │   ├── processors/
│   │   │   │   └── submission.ts
│   │   │   ├── services/
│   │   │   │   ├── judge-db.ts
│   │   │   │   ├── submission-runner.ts
│   │   │   │   ├── executor-factory.ts
│   │   │   │   ├── docker-executor.ts
│   │   │   │   └── k8s-executor.ts
│   │   │   ├── health-server.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   ├── submission-runner.test.ts
│   │   │   └── judge-db.test.ts
│   │   └── package.json
│   │
│   └── sandbox-runner/                         # Isolated judge runtime
│       ├── src/
│       │   ├── judges/
│       │   │   ├── standard.ts
│       │   │   ├── checker.ts
│       │   │   └── interactive.ts
│       │   ├── compiler.ts
│       │   └── index.ts
│       ├── tests/
│       │   ├── standard.test.ts
│       │   ├── checker.test.ts
│       │   └── compiler.test.ts
│       └── package.json
│
├── packages/
│   ├── db/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   └── env.ts
│   │   └── package.json
│   │
│   ├── core/
│   │   ├── src/
│   │   │   ├── schemas/
│   │   │   │   ├── problem.ts
│   │   │   │   ├── course.ts
│   │   │   │   ├── contest.ts
│   │   │   │   └── submission.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── schemas.test.ts
│   │   └── package.json
│   │
│   ├── sandbox/
│   │   ├── src/
│   │   │   ├── request.ts
│   │   │   ├── result.ts
│   │   │   ├── languages.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── queue/
│       ├── src/
│       │   ├── names.ts
│       │   ├── jobs.ts
│       │   └── index.ts
│       └── package.json
│
├── infra/
│   ├── docker/
│   │   ├── web.Dockerfile
│   │   ├── worker.Dockerfile
│   │   ├── sandbox-runner.Dockerfile
│   │   └── migrator.Dockerfile
│   ├── gcp/
│   │   ├── cloudbuild.yaml
│   │   ├── web.cloudrun.yaml
│   │   ├── gke/
│   │   └── deploy.sh
│   └── k8s/
│       └── sandbox/
│           ├── namespace.yaml
│           ├── network-policy.yaml
│           └── resource-quota.yaml
│
├── tooling/
│   ├── eslint/
│   │   └── base.mjs
│   ├── typescript/
│   │   └── base.json
│   └── prettier/
│       └── base.mjs
│
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── eslint.config.mjs
├── tsconfig.json
├── .github/
│   └── workflows/
│       └── ci.yml
└── CLAUDE.md
```

## Paraglide.js i18n

### Migration from svelte-i18n

|               | svelte-i18n (current)             | Paraglide.js (new)                    |
| ------------- | --------------------------------- | ------------------------------------- |
| Mechanism     | Runtime lookup                    | Compile-time generated functions      |
| Type safety   | None                              | Full (`m.key()` with autocomplete)    |
| Bundle size   | Entire runtime + all translations | Only used translations, tree-shakable |
| Usage         | `$t('key')`                       | `m.key()`                             |
| Interpolation | `$t('greeting', { name })`        | `m.greeting({ name })`                |

### File Structure

```
apps/web/
├── project.inlang/settings.json    # inlang project config
├── messages/
│   ├── en.json                     # English
│   └── zh-TW.json                  # Traditional Chinese
└── src/lib/paraglide/              # auto-generated (gitignore)
```

### Migration Steps

1. Install `@inlang/paraglide-sveltekit`
2. Move svelte-i18n JSON translations to `messages/`
3. Replace all `$t(` with `m.` calls
4. Remove svelte-i18n dependency

## Testing Strategy

| Layer       | Tool       | What to test                                                         | Volume                        |
| ----------- | ---------- | -------------------------------------------------------------------- | ----------------------------- |
| Unit        | Vitest     | Pure functions, schema validation, state derivation                  | High, fast                    |
| Integration | Vitest     | Server queries/mutations against DB                                  | Medium, per-domain core paths |
| E2E         | Playwright | User critical flows (signin → create problem → submit → view result) | Low, happy paths only         |

## Removed Modules

The following are removed from this architecture and can be re-added later with a proper design:

- **Anti-cheat / Integrity**: CheatingCase, CheatingSignal, TelemetryProbe, evaluateIntegritySignals, cheating-signal worker processor, integrity dashboard
- **Workspace sessions/runs**: WorkspaceSession, WorkspaceRun, workspace API routes
