# Quality Score

Track documentation quality and implementation legibility as an honest ledger.

## Current Grades

| Area                       | Grade | Evidence                                                                                                                                                        | Next Upgrade                                              |
| -------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Knowledge-store navigation | B+    | CLAUDE.md maps all required docs with reading order.                                                                                                            | Add runbook index and reference catalog.                  |
| Product specification      | A-    | PRODUCT_SENSE.md + per-feature acceptance specs under `docs/specs/` (assignments, exams, contests, copy-course, proctoring, plagiarism, editorials, dashboard). | Promote inline `editorialSubmitSchema` into `@nojv/core`. |
| Architecture docs          | A     | Multi-tier diagram, dependency graph, package descriptions, runtime entries, and sequence diagrams for submission / exam / scoreboard.                          | Add data-flow diagram for storage + image upload.         |
| Frontend guidance          | B+    | Route map, API endpoints, component contracts, and runtime boundaries documented.                                                                               | Add component-level accessibility evidence.               |
| Design guidance            | B     | Design system tokens, fonts, and interaction patterns documented from shipped code.                                                                             | Add visual reference snapshots.                           |
| Reliability guidance       | A-    | SLO table (8 targets), failure modes, operational invariants, health checks, and `docs/runbooks/incident-recovery.md` covering 4 outages.                       | Wire Grafana dashboards to replace `[monitoring TBD]`.    |
| Security guidance          | B+    | Handling rules, sensitive data, and threat model cover all current attack surfaces.                                                                             | Add automated security scanning to CI.                    |
| Schema documentation       | B     | Domain model overview, enums, and relationships documented.                                                                                                     | Generate schema docs automatically from Prisma schema.    |
| Test coverage              | C+    | Vitest unit/integration and Playwright E2E configured (52 unit files / 473 tests) but no coverage threshold and integration gaps remain.                        | Add coverage thresholds and missing integration tests.    |

## Doc Drift Status

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

- [Planning System](PLANS.md)
- [Architecture Overview](../ARCHITECTURE.md)
