# Quality Score

Track documentation quality and implementation legibility as an honest
ledger. **Not a changelog** — for batch-by-batch detail see git log and
`docs/plans/completed/`.

## Current Grades

| Area                       | Grade | Evidence                                                                                                                                                                                                                                                                                            | Next Upgrade                                                                                                                    |
| -------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Knowledge-store navigation | A-    | CLAUDE.md maps all required docs with reading order; runbook index + reference catalog (`docs/runbooks/README.md`); a doc-link gate fails CI on dangling index links.                                                                                                                               | Keep the task-driven doc index in step with new surfaces.                                                                       |
| Product specification      | A-    | PRODUCT_SENSE.md + per-feature acceptance specs under `docs/specs/`.                                                                                                                                                                                                                                | Request schemas centralized in `@nojv/core` (`editorialReportSchema` promoted). Keep new endpoints importing shared schemas.    |
| Architecture docs          | A     | Multi-tier diagram, dependency graph, package descriptions, sequence diagrams for submission / exam / scoreboard, storage data-flow diagram.                                                                                                                                                        | Keep the diagrams in step with package boundary changes.                                                                        |
| Frontend guidance          | A-    | Route map, API endpoints, component contracts, runtime boundaries, component-level accessibility evidence (ARIA patterns + Bits UI primitives).                                                                                                                                                     | Visual snapshots intentionally not pursued — Playwright E2E is local-only (not CI-gated), so unreviewed baselines add little.   |
| Design guidance            | B     | Design system tokens, fonts, interaction patterns documented from shipped code.                                                                                                                                                                                                                     | Visual snapshots intentionally not pursued (Playwright E2E is local-only, not CI-gated).                                        |
| Reliability guidance       | A     | SLO table (8 targets), failure modes, invariants, health checks, incident-recovery runbook. Grafana dashboards + 6 alert rules live.                                                                                                                                                                | Provisional conservative thresholds accepted as operating values; revisit only if sustained prod traffic shows mis-calibration. |
| Security guidance          | A-    | Handling rules, sensitive data, threat model cover all surfaces. CI runs CodeQL SAST + blocking `pnpm audit` gate (0 high/critical). DOMPurify / `@hono/node-server` / `cookie` / `joi` transitives all cleared via `pnpm.overrides`; `pnpm audit` reports zero known vulnerabilities (prod + dev). | Keep the override list pruned as upstreams fix their transitives natively.                                                      |
| Schema documentation       | B+    | Domain model overview, enums, relationships, ERD (`DATABASE.md`); `pnpm db:docs` emits exhaustive field-level reference (`DATABASE.generated.md`), CI-gated for drift.                                                                                                                              | Cross-link the generated field reference from the feature specs that consume it.                                                |
| Test coverage              | B     | Vitest unit + integration + Playwright E2E (157 unit files / ~1289 tests + integration suite, incl. in-process HTTP route harness). v8 coverage thresholds ratchet domain + core.                                                                                                                   | Expand route-level integration coverage on the new HTTP harness.                                                                |

## Outstanding Drift

Add an entry here when code lands without its documentation, or vice
versa. Clear the entry once the gap closes.

The 2026-06-12 full-codebase audit surfaced a documentation-drift cluster
(this ledger's own `_None outstanding._` was itself drift). Remediation is
tracked in `docs/plans/active/2026-06-12-full-audit-remediation.md`.

**Cleared (2026-06-12):**

- Scoreboard live-update mechanism — unified across ARCHITECTURE / REDIS /
  FRONTEND / RELIABILITY (SSE-nudge via `nojv:contest` + 10 s throttle, data
  computed from Postgres). Was contradictory and wrong in all four.
- THREAT_MODEL phantom models — removed `CourseJoinToken` /
  `PlagiarismReport` / course-join-token threat scenarios; `ExamParticipation`
  → `Participation`.
- SECURITY Dependency Advisory Posture — now reflects the `pnpm.overrides`
  that cleared the transitives (was "tracked but not gated"); advanced
  tarball "signed URL" corrected to in-process GetObject.

- `DATABASE.md` curated prose realigned to the Participation supertype
  (dropped triplet tables / `virtualContestId` / removed enums); Seed Data
  now links to Getting Started instead of duplicating counts.
- `incident-recovery.md` Scenario B rewritten to the current Redis posture
  (Postgres scoreboards, fail-closed rate limiter, PG cooldown, no
  `scoreboard.ts`).
- `JUDGE_PIPELINE.md` line-number refs replaced with stable symbolic refs;
  `gke/README.md` two-step apply clarified; `gcp/README.md` deploy.sh env
  list completed.

**Still outstanding (doc):** none — the audit doc-drift cluster is cleared.

Code-level audit findings (security, performance, dead contracts) are tracked
as phases in the remediation plan, not here.

## Recent Milestones

One line each — full detail in `docs/plans/completed/` and git log.

- **2026-06-12** — Full-codebase audit remediation (in progress on
  `fix/full-audit-remediation-2026-06-12`): closed P0 rejudge-cancel
  workflow-id confinement, P1 exam-confinement problem-membership check, P1
  problem-delete onDelete asymmetry, P1 docker `--memory-swap` (MLE
  correctness); judge-layer guardrails (isolation suite in nightly, docker-arg
  golden tests, CPU-time TLE, coverage on worker/sandbox-runner); living-doc
  honesty sweep (scoreboard / threat-model / security advisory).
- **2026-06-11** — Participation supertype Stage 5 (PR #128): the
  `ContestParticipation`/`ExamParticipation`/`VirtualContest` triplet
  dropped into a single `Participation` model. Audit-backlog closeout:
  GKE worker S3 storage env (prod judge crash fixed), full-text-search
  GIN index, `@hono/node-server` override (moderate advisory cleared).
  Confirmed already-resolved audit deferrals: 1.1 sign-up-disabled test,
  3.1 rejudge error isolation, 7.2 repository boundary.
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
