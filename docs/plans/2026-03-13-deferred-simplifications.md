# Deferred Simplifications

Identified during the 2026-03-13 full codebase simplify review.

**Status: All items resolved** (branch `refactor/deferred-simplifications`)

## 1. K8s env: Zod discriminated union — DONE

Used `z.discriminatedUnion("EXECUTION_BACKEND", [...])`. K8s fields required when `kubernetes`, optional when `docker`. Removed 5 runtime checks from `executor-factory.ts`.

## 2. Judge process spawning deduplication — DONE

Extracted `runProcess()` into `apps/sandbox-runner/src/judges/run-process.ts`. Used by `standard.ts` and `checker.ts`. `interactive.ts` unchanged (bidirectional piping is a different pattern).

## 3. Handle-completion guard deduplication — DONE

Moved to `hooks.server.ts` with exemptions for `/api/`, `/complete-profile`, `/signin`, `/signup`, `/admin-signin`, `/verify-school`.

## 4. Submission `sourceCode` lazy loading — DONE

Removed `sourceCode` from list query. Added `/api/submissions/[submissionId]/source` endpoint. Workspace fetches on demand with per-entry loading state.

## 5. `parseSessionUser` redundant calls — DONE

Parsed once in `hooks.server.ts`, stored in `event.locals.sessionUser`. Extended `App.Locals` type. `getActorContext` reads from locals.

## 6. Interactor language bug — DONE (discovered during review)

Fixed `docker-executor.ts` and `k8s-executor.ts`: `checkerLanguage` → `interactorLanguage` for interactor scripts. Added `interactorLanguage` to `SandboxRequest.judgeConfig`.

## 7. Judge output parser consolidation — DONE (discovered during review)

Unified `parseCheckerOutput` and `parseInteractorOutput` into shared `parseJudgeOutput` in `run-process.ts`.

## 8. Language extension deduplication — DONE (discovered during review)

Replaced inline `languageExtensions` in `docker-executor.ts` with import from `@nojv/sandbox`.

## 9. Course mutation wrapper inlining — DONE (discovered during review)

Inlined `buildJoinCode`, `buildQrToken`, `defaultScoreboardMode` at their single call sites.
