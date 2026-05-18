# Quality Score

Track documentation quality and implementation legibility as an honest ledger.

## Current Grades

| Area                       | Grade | Evidence                                                                                                                                                                                                                                                                         | Next Upgrade                                                            |
| -------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Knowledge-store navigation | B+    | CLAUDE.md maps all required docs with reading order.                                                                                                                                                                                                                             | Add runbook index and reference catalog.                                |
| Product specification      | A-    | PRODUCT_SENSE.md + per-feature acceptance specs under `docs/specs/` (assignments, exams, contests, copy-course, proctoring, plagiarism, editorials, dashboard).                                                                                                                  | Promote inline `editorialSubmitSchema` into `@nojv/core`.               |
| Architecture docs          | A     | Multi-tier diagram, dependency graph, package descriptions, runtime entries, and sequence diagrams for submission / exam / scoreboard.                                                                                                                                           | Add data-flow diagram for storage + image upload.                       |
| Frontend guidance          | B+    | Route map, API endpoints, component contracts, and runtime boundaries documented.                                                                                                                                                                                                | Add component-level accessibility evidence.                             |
| Design guidance            | B     | Design system tokens, fonts, and interaction patterns documented from shipped code.                                                                                                                                                                                              | Add visual reference snapshots.                                         |
| Reliability guidance       | A     | SLO table (8 targets), failure modes, operational invariants, health checks, and `docs/runbooks/incident-recovery.md` covering 4 outages. Live Grafana dashboards measure 6 of 8 SLOs (heartbeat miss, SSE stability, judge p95/p99, API p99, scoreboard p95, judge throughput). | Add alerting rules + page on SLO breach (currently visualization-only). |
| Security guidance          | B+    | Handling rules, sensitive data, and threat model cover all current attack surfaces.                                                                                                                                                                                              | Add automated security scanning to CI.                                  |
| Schema documentation       | B     | Domain model overview, enums, and relationships documented.                                                                                                                                                                                                                      | Generate schema docs automatically from Prisma schema.                  |
| Test coverage              | B-    | Vitest unit/integration and Playwright E2E configured (53 unit files / 482 tests + 22 integration files / 138 tests). No coverage threshold yet.                                                                                                                                 | Add coverage thresholds; expand route-level integration.                |

## Doc Drift Status

- 2026-05-18 feature-completion batch: synced docs with PR #27's shipped
  features — `PRODUCT_SENSE.md` gained Upsolve / Virtual Contests /
  Class Analytics under Shipped Scope; `FRONTEND.md` route map gained
  `/contests/[contestId]/{upsolve,virtual}` and
  `/courses/[courseId]/analytics`; the 2026-05-16 plan moved to
  `docs/plans/completed/`.

- 2026-05-06 Grafana observability wired: 5 dashboards live at https://takalawang.grafana.net covering judge latency, API latency, scoreboard updates, exam proctoring, and request-time breakdown. OTel SDK boots via top-of-file side-effect import in apps/web/src/hooks.server.ts and apps/worker/src/index.ts; metrics push to Grafana Cloud Hosted Prometheus via OTLP (region prod-ap-northeast-0, free tier). 6 manual SLO metrics instrumented: judge_latency_seconds (mode/verdict), api_request_duration_seconds (route/method/status_class), scoreboard_update_latency_seconds (mode), sse_connection_duration_seconds (close_reason), sse_connection_dropped_total, exam_heartbeat_miss_total (gap_bucket). Auto-instrumentation hooks pg/ioredis/undici/http; fs+dns disabled for noise control; traces disabled (metrics-only). Worker SIGTERM awaits shutdownOtel() to flush last interval. Provisioning via pnpm grafana:provision (overwrite:true, idempotent). Cardinality budget ≈ 4k series, well under 10k free-tier cap. RELIABILITY.md SLO table now links each row to its dashboard. New runbook docs/runbooks/observability-setup.md covers token rotation, adding metrics, dashboard updates. Verification: pnpm -w typecheck 17/17 green, pnpm exec vitest run tests/unit + provision tests all pass, 5 dashboards verified via API read-back.

- 2026-04-30 functional-gaps sweep: 5 parallel agent worktrees merged into main, plus inline doc updates.
  - Phase 0: PRODUCT_SENSE auth section locked to third-party only; password reset + bulk operations explicitly dropped from backlog. Mobile workspace policy added to non-goals.
  - Phase 1: page-layout sweep tail — `<PageHeader>` swept across `/contests`, `/dashboard`, `/admin/**`, `/courses/[id]/{assignments,exams}/new`; `/contests/[contestId]` now uses `<PageHero variant="workspace">`. 6 new paraglide eyebrow keys.
  - Phase 2: editorial CRUD — `updateEditorial` / `softDeleteEditorial` domain helpers, `PATCH/DELETE /api/editorials/[id]`, paginated list page, edit page; nullable `Editorial.deletedAt` (migration `20260430000000_editorial_soft_delete`); 15 new unit tests.
  - Phase 3: mobile workspace blocker — `<MobileWorkspaceBlocker>` component on the four workspace surfaces (problems / contests / exams / assignments); responsive sweep across list pages and `ExamTopStrip`. Pure CSS `hidden md:block` — no UA sniffing, no server-side guard change.
  - Phase 4: plagiarism diff + flagging — `PlagiarismPairFlag` model (migration `20260430000000_add_plagiarism_pair_flag`); `flagPair` / `unflagPair` / `listFlagsForContext` domain; `POST /api/plagiarism-flags` + `DELETE /api/plagiarism-flags/[id]`; side-by-side Monaco diff route at `/(app)/assignments/[assessmentId]/plagiarism/pairs/[pairId]`; list-page filter toggle; 17 new unit tests.
  - Phase 5: dashboard widgets — `getStreakDays` + `getSuggestedProblems` domain helpers; `StreakCard` / `WeeklyTrendCard` / `SuggestedProblemsCard` components wired into the existing dashboard loader; 11 new unit tests.
  - Verification: `pnpm -w typecheck` 17/17, `pnpm turbo run lint` 18/18, `pnpm -w format` clean, `pnpm -w test:unit` 590/590 (was 547 before this sweep — 43 new tests).
  - Spec sync: `docs/specs/editorials.md` + `docs/specs/plagiarism.md` updated; `docs/plans/active/2026-04-30-page-layout-system.md` moved to `completed/`.

- 2026-04-29 production-readiness pass: 4 parallel agent worktrees merged into main covering security, reliability, tests, deployment.
  - Security: rate-limiter `fail-closed` in production (`apps/web/src/lib/server/shared/rate-limiter.ts`); `/api/**` mutations require `X-Requested-With: fetch` (CSRF), 13 client call sites updated; new `RateLimiterFailClosedError`.
  - Observability: per-request `requestId` (inbound `X-Request-Id` reused if safe, else `crypto.randomUUID()`) on `event.locals` + response header; `getLogger(context, event)` pino child; `/api/healthz` now probes Temporal (2 s timeout, informational); GCP Cloud Logging-compatible JSON output in production for `apps/web` + `apps/worker` loggers (severity, message, timestamp, base: null).
  - Reliability: `ContestParticipation.version` optimistic lock + `updateWithVersion` repo method + retry-up-to-3 in `updateContestScores`; new migration `20260429000000_add_contest_participation_version`.
  - Tests: 47 new tests — `build-subtask-results`, `judge-context`, `submission-mutations-boundaries` (unit) + `submission-judge-flow` (integration); 1 race-condition unit test for the optimistic lock.
  - Deployment: `worker.deployment.yaml` now sets `runAsNonRoot/runAsUser=1001/readOnlyRootFilesystem/drop ALL caps/seccompProfile=RuntimeDefault` + 64Mi tmp emptyDir; `docs/DEPLOYMENT.md` rewrites the KEDA-era scaling story to static replicas + PDB; new `docs/runbooks/backup-restore.md` linked from `CLAUDE.md` + incident-recovery; same-day cleanup of stale KEDA references in `docs/THREAT_MODEL.md:193` + `docs/RELIABILITY.md:69`.
  - Verification: `pnpm -w typecheck` 17/17, `pnpm lint` 18/18, `pnpm test:unit` 547/547, prettier clean.

- 2026-04-20 targeted bug + perf sweep: fixed six audit findings — (1)
  rejudge path now calls `adjustUserStatsForRejudge` so
  `UserDailyActivity.acCount` delta-adjusts on the submission's original
  day instead of double-counting on today; (2) clarification `ask()`
  now validates `problemId` belongs to the context via
  `{contest,exam,assessment}ProblemRepo.exists`; (3) `isIpInCidr` now
  supports native IPv6 via Node `net.BlockList` (added 6 regression
  tests); (4) `ExamTopStrip` + settings placeholder now display IPv6
  cleanly (v4-mapped strip + `break-all`); (5) `fanoutAssignmentDueSoon`
  uses new lightweight `listActiveStudentUserIds` instead of hydrating
  full user rows; (6) notification retention cap consolidated into
  single set-based DELETE with `ROW_NUMBER()` window — one query for N
  users instead of N OFFSET scans — and `markAllRead` now triggers the
  same cleanup. `docs/specs/dashboard.md` and `docs/specs/proctoring.md`
  updated the same day.
- 2026-04-20 Dolos migration (commit `49c9e6a`): plagiarism detection moved from MOSS (moss.stanford.edu TCP socket) to Dolos (`@dodona/dolos-lib`, self-hosted in-process AST matching). `SimilarityPair` shape swapped to `{ similarity, longest, overlap }`; `plagiarismMossReportUrl` renamed to `plagiarismReportUrl` on `CourseAssessment`, `Exam`, `Contest`. Docs swept the same day: `docs/specs/plagiarism.md` (rewritten), `docs/PRODUCT_SENSE.md`, `ARCHITECTURE.md`, `docs/TEMPORAL.md`, `docs/DATABASE.md`, `docs/RELIABILITY.md`, `docs/THREAT_MODEL.md`, `docs/runbooks/incident-recovery.md`, `docs/playbooks/exhibition-demo-playbook.md`, `docs/specs/assignments.md`, `README.md`. Dolos migration design + plan moved to `docs/plans/completed/`.
- 2026-04-20 spec backfill: added `docs/specs/plagiarism.md`, `docs/specs/editorials.md`, `docs/specs/dashboard.md`. The two drifts each flagged were fixed the same day — the phantom "problem-solving recommendations" bullet was struck from `PRODUCT_SENSE.md § User Dashboard`, and the editorial POST error string was updated to "Solve this problem first to post an editorial." via an optional override on the shared AC gate helper. Unit coverage for all three surfaces landed in `tests/unit/domain/{plagiarism-queries,editorial-queries,dashboard-view}.test.ts` (+ stable-sort assertion in `user-analytics-helpers.test.ts`); route and integration tests remain as follow-ups.
- 2026-04-18 doc quality uplift: ARCHITECTURE.md gained 3 mermaid sequence diagrams (submission / exam session / scoreboard); RELIABILITY.md gained an SLO table; new `docs/runbooks/incident-recovery.md` covers Temporal / Redis / Postgres / sandbox outages; new `docs/specs/` holds per-feature acceptance specs.
- 2026-04-19 drift cleanup: contest zod schema stripped of residual proctoring fields (`ipLockFields`, `pageLockEnabled`); `ActiveExamSession.ipPin` column and all write paths removed — `ExamParticipation.ipPin` is now the single IP-binding pin; specs updated to reflect the `finalizeContest` Temporal caller.
- Exam + Assignment Settings tabs, editable Problems tabs, and full lifecycle mutations (publish / archive / delete-draft) shipped 2026-04-18; Exam Submissions matrix, copy course, and classStats/myStatus aggregation landed in the same commit. FRONTEND.md and PRODUCT_SENSE.md brought back in sync.
- Documentation restructured 2026-04-07 to eliminate content overlap and add threat model, design, and product docs.
- `@nojv/storage` package and image upload feature added 2026-04-06.
- Architecture redesign (multi-tier, domain package) completed 2026-04-03.

## Notes

- Update this file after every major documentation change or implementation milestone.
- Record real gaps instead of inflating scores.

## Related Docs

- [Planning System](../product/PLANS.md)
- [Architecture Overview](../architecture/ARCHITECTURE.md)
