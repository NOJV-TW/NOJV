# Production Readiness TODO

Architecture analysis conducted on 2026-04-03. Items ordered by priority.

## P0 — Production Blockers

- [x] **Observability**: Replaced console-based logger with Pino in both web and worker (`apps/*/logger.ts`)
- [x] **Health checks**: Added DB/Redis/Temporal connectivity checks to `/api/healthz` and worker `/healthz` (returns 503 on failure)
- [x] **Web env validation**: Added Zod schema startup validation in `apps/web/src/lib/server/env.ts`, fails fast via `hooks.server.ts`

## P1 — Product Maturity

- [x] **Test coverage**: Enabled vitest coverage tracking (`@vitest/coverage-v8`, `pnpm test:coverage`)
- [x] **E2E in CI**: Added Playwright E2E job to `.github/workflows/ci.yml` (separate job, uploads report on failure)
- [x] **Docker security**: Added non-root `appuser` (UID 1001) to web and worker Dockerfiles
- [x] **Architecture migration**: Sealed `prisma` client export, moved school-verification to domain, deduplicated `ensureUser()`

## P2 — Polish

- [x] **Rate limiting**: Extended to all write endpoints — 4 API POST routes + 11 form action files via `consumeFormRateLimit()`
- [x] **Process error handlers**: Added `unhandledRejection` (warn) and `uncaughtException` (exit 1) handlers to web and worker
- [x] **Deployment strategy**: Added rollback procedure to `docs/DEPLOYMENT.md` (Cloud Run, GKE, database)
- [ ] **API documentation**: Add OpenAPI/Swagger spec for API endpoints
