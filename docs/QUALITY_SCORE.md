# Quality Score

Track documentation quality and implementation legibility as an honest ledger.

## Current Grades

| Area                       | Grade | Evidence                                                                                                  | Next Upgrade                                              |
| -------------------------- | ----- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Knowledge-store navigation | B+    | CLAUDE.md maps all required docs with reading order.                                                      | Add runbook index and reference catalog.                  |
| Product specification      | B     | Core goals, roles, and shipped features documented in PRODUCT_SENSE.md.                                   | Add per-feature acceptance specs.                         |
| Architecture docs          | A-    | Multi-tier diagram, dependency graph, package descriptions, and runtime entries all match implementation. | Add sequence diagrams for key flows.                      |
| Frontend guidance          | B+    | Route map, API endpoints, component contracts, and runtime boundaries documented.                         | Add component-level accessibility evidence.               |
| Design guidance            | B     | Design system tokens, fonts, and interaction patterns documented from shipped code.                       | Add visual reference snapshots.                           |
| Reliability guidance       | B+    | Failure modes, operational invariants, and health checks documented.                                      | Define measurable SLOs and add recovery drill procedures. |
| Security guidance          | B+    | Handling rules, sensitive data, and threat model cover all current attack surfaces.                       | Add automated security scanning to CI.                    |
| Schema documentation       | B     | Domain model overview, enums, and relationships documented.                                               | Generate schema docs automatically from Prisma schema.    |
| Test coverage              | C+    | Vitest unit/integration and Playwright E2E configured but coverage gaps exist.                            | Add coverage thresholds and missing integration tests.    |

## Doc Drift Status

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
