# Quality Score

Track documentation quality and implementation legibility as an honest
ledger. **Not a changelog** — for batch-by-batch detail see git log and
`docs/plans/completed/`.

## Current Grades

| Area                       | Grade | Evidence                                                                                                                                                                                                       | Next Upgrade                                                                                                                 |
| -------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Knowledge-store navigation | A-    | CLAUDE.md maps all required docs with reading order; runbook index + reference catalog (`docs/runbooks/README.md`); a doc-link gate fails CI on dangling index links.                                          | Keep the task-driven doc index in step with new surfaces.                                                                    |
| Product specification      | A-    | PRODUCT_SENSE.md + per-feature acceptance specs under `docs/specs/`.                                                                                                                                           | Request schemas centralized in `@nojv/core` (`editorialReportSchema` promoted). Keep new endpoints importing shared schemas. |
| Architecture docs          | A     | Multi-tier diagram, dependency graph, package descriptions, sequence diagrams for submission / exam / scoreboard, storage data-flow diagram.                                                                   | Keep the diagrams in step with package boundary changes.                                                                     |
| Frontend guidance          | A-    | Route map, API endpoints, component contracts, runtime boundaries, component-level accessibility evidence (ARIA patterns + Bits UI primitives).                                                                | Add visual reference snapshots (needs a Playwright baseline run).                                                            |
| Design guidance            | B     | Design system tokens, fonts, interaction patterns documented from shipped code.                                                                                                                                | Add visual reference snapshots.                                                                                              |
| Reliability guidance       | A     | SLO table (8 targets), failure modes, invariants, health checks, incident-recovery runbook. Grafana dashboards + 6 alert rules live.                                                                           | Tune SLO alert thresholds against real production traffic.                                                                   |
| Security guidance          | B+    | Handling rules, sensitive data, threat model cover all surfaces. CI runs CodeQL SAST + blocking `pnpm audit` gate (0 high/critical). Moderate/low transitives triaged with a documented cadence (SECURITY.md). | Re-clear the moderate transitives when monaco-editor / kit / prisma take a major bump.                                       |
| Schema documentation       | B+    | Domain model overview, enums, relationships, ERD (`DATABASE.md`); `pnpm db:docs` emits exhaustive field-level reference (`DATABASE.generated.md`), CI-gated for drift.                                         | Cross-link the generated field reference from the feature specs that consume it.                                             |
| Test coverage              | B     | Vitest unit + integration + Playwright E2E (157 unit files / ~1289 tests + integration suite, incl. in-process HTTP route harness). v8 coverage thresholds ratchet domain + core.                              | Expand route-level integration coverage on the new HTTP harness.                                                             |

## Outstanding Drift

Add an entry here when code lands without its documentation, or vice
versa. Clear the entry once the gap closes.

_None outstanding._ (The `verify-school` GET-token consumption was fixed by
moving the token consume to a form POST; see git history.)

## Recent Milestones

One line each — full detail in `docs/plans/completed/` and git log.

- **2026-06-10** — Audit-remediation batch (in progress on
  `fix/audit-remediation-2026-06-10`): `CourseAssessment` → `Assessment`
  global rename (model / enum / `assessmentId` column + RENAME
  migration); auth hardening (public sign-up disabled, prod admin
  credentials out of source, first-login forced password change, TOTP
  2FA); judge correctness (sandbox `SE` → `system_error` non-counting
  verdict, large-output truncation before `submissionResultSchema`).
  Wave 8 living-doc drift sweep landed this entry.
- **2026-06-09** — Stale-submission reaper (PR #106): per-minute cron
  sweeper terminates submissions stuck past the configurable pending
  timeout and refunds the daily attempt (all `system_error` non-counting).
- **2026-06-08** — Security/correctness audit batch (PR #105): exam
  judging activity-bundle registration fix, `attemptResetMinuteOfDay`
  migration, freeze-bypass scoreboard chart, rate-limiter key isolation.
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
