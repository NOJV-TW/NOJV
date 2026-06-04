# Quality Score

Track documentation quality and implementation legibility as an honest
ledger. **Not a changelog** — for batch-by-batch detail see git log and
`docs/plans/completed/`.

## Current Grades

| Area                       | Grade | Evidence                                                                                                                                                                                                       | Next Upgrade                                                                           |
| -------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Knowledge-store navigation | B+    | CLAUDE.md maps all required docs with reading order.                                                                                                                                                           | Add runbook index and reference catalog.                                               |
| Product specification      | A-    | PRODUCT_SENSE.md + per-feature acceptance specs under `docs/specs/`.                                                                                                                                           | Promote the inline `editorialReportSchema` route schema into `@nojv/core`.             |
| Architecture docs          | A     | Multi-tier diagram, dependency graph, package descriptions, sequence diagrams for submission / exam / scoreboard.                                                                                              | Add data-flow diagram for storage + image upload.                                      |
| Frontend guidance          | B+    | Route map, API endpoints, component contracts, runtime boundaries documented.                                                                                                                                  | Add component-level accessibility evidence.                                            |
| Design guidance            | B     | Design system tokens, fonts, interaction patterns documented from shipped code.                                                                                                                                | Add visual reference snapshots.                                                        |
| Reliability guidance       | A     | SLO table (8 targets), failure modes, invariants, health checks, incident-recovery runbook. Grafana dashboards + 6 alert rules live.                                                                           | Tune SLO alert thresholds against real production traffic.                             |
| Security guidance          | B+    | Handling rules, sensitive data, threat model cover all surfaces. CI runs CodeQL SAST + blocking `pnpm audit` gate (0 high/critical). Moderate/low transitives triaged with a documented cadence (SECURITY.md). | Re-clear the moderate transitives when monaco-editor / kit / prisma take a major bump. |
| Schema documentation       | B     | Domain model overview, enums, relationships documented; `pnpm db:docs` emits exhaustive field-level reference (`DATABASE.generated.md`).                                                                       | Add an entity-relationship diagram.                                                    |
| Test coverage              | B-    | Vitest unit + integration + Playwright E2E (87 unit files / 793 tests + integration suite). v8 coverage thresholds ratchet domain + core.                                                                      | Raise the coverage ratchet; expand route-level integration.                            |

## Outstanding Drift

_None known._ Add an entry here when code lands without its
documentation, or vice versa. Clear the entry once the gap closes.

## Recent Milestones

One line each — full detail in `docs/plans/completed/` and git log.

- **2026-05-28** — Storage unification + audit fixes (HIGH findings
  resolved): editorial API-layer bypass closed by server-side context
  resolution (commits `f1994619`, `fd2f7884`); multi-file MOSS
  tokenization fix — sources concatenated by sorted path with `// ===`
  boundary markers instead of JSON-stringified (commit `87ce1a30`).
  `Submission.sourceCode` + `verdictDetail` columns replaced with
  `sourceStoragePrefix` + `verdictSummary` + `verdictDetailStorageKey`;
  new `SubmissionStatus.system_error` surfaces storage-side failures.
- **2026-05-22** — Feedback edit history (`SubmissionFeedbackAuditLog`)
  - Plagiarism trigger log + route-level permission tests (22 cases).
    Closed the last two conditional-deferral entries from
    `plagiarism.md` / `assignments.md`.
- **2026-05-20** — Grading feedback + audit-viewer batch (PR #31):
  `SubmissionFeedback`, Audit Timeline tab on assignment / exam /
  contest, dashboard `WelcomeGuide`, datetime helpers, post-close
  write-gate split from view-gate.
- **2026-05-19** — Quality-ledger follow-ups (PR #30): spec drift
  cleanup across 5 specs, `editorialSubmitSchema` → `@nojv/core`,
  Grafana SLO alert rules + contact point + notification policy,
  CodeQL + blocking `pnpm audit` gate.
- **2026-05-18** — Feature-completion batch (PR #28): D2 retention,
  D3 dashboard local timezone, D4 bulk session release, D5
  copy-course validation, D6 assessment audit log, D7 editorial
  moderation. `UserDailyActivity` removed.
- **2026-05-16** — Class analytics + virtual contest + upsolve (PR #27).
- **2026-05-06** — Grafana observability wired (5 dashboards, 6 SLO
  metrics, OTel SDK in web + worker).

## Notes

- Update **Current Grades** when a column actually moves, not on every
  PR — this file is the destination for grade movement, not commit
  bookkeeping.
- Add to **Outstanding Drift** only for known doc-vs-code gaps, and
  clear the entry when the gap closes.
- Add to **Recent Milestones** as a one-line entry; if the line wants
  to grow into a paragraph, the detail belongs in the design doc under
  `docs/plans/completed/` instead.
- Prune **Recent Milestones** to roughly the last six entries — older
  context lives in git log + `docs/plans/completed/`.

## Related Docs

- [Planning System](../product/PLANS.md)
- [Architecture Overview](../architecture/ARCHITECTURE.md)
