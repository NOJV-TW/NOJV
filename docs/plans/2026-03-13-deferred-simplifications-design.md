# Deferred Simplifications — Implementation Design

> Date: 2026-03-13
> Status: Approved

## Scope

All 9 items from the deferred simplifications audit (5 original + 4 newly discovered).

## Agent Groups

### Agent A: sandbox-runner judges

- **#2** Extract shared `runProcess()` utility from `standard.ts`, `checker.ts`, `interactive.ts`
- **#7** Consolidate `parseCheckerOutput` and `parseInteractorOutput` into shared `parseJudgeOutput`

Files: `apps/sandbox-runner/src/judges/`

### Agent B: worker executor

- **#1** Zod discriminated union for `EXECUTION_BACKEND` in `env.ts`, remove runtime checks from `executor-factory.ts`
- **#6** Fix bug: `docker-executor.ts:92` uses `checkerLanguage` instead of `interactorLanguage`
- **#8** Replace inline `languageExtensions` with import from `@nojv/sandbox`

Files: `apps/worker/src/env.ts`, `apps/worker/src/services/`

### Agent C: web auth/routing

- **#3** Move complete-profile guard from 2 locations into `hooks.server.ts`
- **#5** Parse `SessionUser` once in hooks, store in `event.locals.sessionUser`

Files: `apps/web/src/hooks.server.ts`, `apps/web/src/app.d.ts`, `apps/web/src/lib/server/auth.ts`, `apps/web/src/routes/`

### Agent D: web sourceCode lazy loading

- **#4** Remove `sourceCode` from `listProblemSubmissions` select, add `/api/submissions/[id]/source` endpoint, lazy-load in `Workspace.svelte`

Files: `apps/web/src/lib/server/submission/queries.ts`, `apps/web/src/routes/api/submissions/`, `apps/web/src/lib/components/problem/`

### Agent E: web course cleanup

- **#9** Inline `buildJoinCode`, `buildQrToken`, `defaultScoreboardMode` at call sites

Files: `apps/web/src/lib/server/course/mutations.ts`

## Execution Strategy

- Single branch: `refactor/deferred-simplifications`
- All 5 agents run in parallel (non-overlapping files)
- Review all changes after completion
