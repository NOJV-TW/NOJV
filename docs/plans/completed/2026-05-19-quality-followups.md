# Quality-Ledger Follow-ups Plan

> **For Claude:** Execute wave-by-wave. Verify (`typecheck` + `lint` + `test:unit`) per wave.

**Goal:** Close the actionable gaps left after the 2026-05-18 feature-completion
batch (PR #28) — stale spec-doc TODOs, one schema-promotion, missing tests, and
the four `QUALITY_SCORE.md` "Next Upgrade" infrastructure items.

**Branch:** `chore/quality-followups-2026-05-19`

## Context

`docs/plans/active/` is empty and PR #28 closed every D2–D7 spec gap, but the
spec docs' "Open Questions / TODO" sections were never updated and still list
shipped features. The remaining work is doc drift, polish, and infra.

## Scope decisions (locked 2026-05-19)

- **CI security scanning** — CodeQL (GitHub-native JS/TS SAST) + a `pnpm audit`
  dependency-CVE step. No new npm dependencies.
- **Coverage threshold** — ratchet-style: measure current unit coverage, set
  `vitest.config.ts` thresholds at/just below current numbers.
- **Schema docs** — a dependency-free `scripts/generate-schema-docs.mjs` that
  parses `prisma/schema/*.prisma`; no generator plugin.
- **SLO alerting** — alert-rule JSON in-repo + `provision.ts` upload. Contact
  points / notification policy stay a documented manual step (need live stack).
- Deliberate non-goals are **out of scope** (time_bonus UI, IP whitelist CSV
  import, password reset, mobile workspace, bulk ops) — these are product
  decisions, not gaps.

## Waves

### Wave 1 — promote `editorialSubmitSchema` to `@nojv/core`

- Create `packages/core/src/schemas/editorial.ts` — `editorialSubmitSchema` +
  `editorialUpdateSchema` (shared content/language bounds).
- Export from `packages/core/src/index.ts`.
- Update `api/problems/[id]/editorials/+server.ts` and
  `api/editorials/[id]/+server.ts` to import from `@nojv/core`.

### Wave 2 — spec drift cleanup + QUALITY_SCORE entry

- Remove shipped TODOs from `docs/specs/{assignments,exams,dashboard,editorials,proctoring}.md`.
- Keep still-valid open questions; convert `contests.md` + `copy-course.md`
  caveats into documented behavior notes in the spec body.
- Add a 2026-05-19 doc-drift entry to `docs/operations/QUALITY_SCORE.md`.

### Wave 3 — integration tests for release + report flows

- `releaseAllSessionsAsInstructor` (bulk exam-session release).
- Editorial moderation: `reportEditorial`, `listEditorialReports`,
  `resolveEditorialReport`.

### Wave 4 — SLO breach alerting rules (Grafana)

- `infra/grafana/alerts/*.json` for the 6 instrumented SLOs.
- Extend `infra/grafana/provision.ts` to upload alert rules; add a unit test.

### Wave 5 — CI security scanning

- `.github/workflows/codeql.yml` + a `pnpm audit` step.

### Wave 6 — coverage thresholds

- Measure, then add `coverage.thresholds` to `vitest.config.ts`.

### Wave 7 — auto-generated schema docs

- `scripts/generate-schema-docs.mjs` + `pnpm db:docs`; link from `DATABASE.md`.

## Verification

`pnpm -w typecheck` · `pnpm lint` · `pnpm test:unit` · `pnpm format:write`.
Integration needs a DB — run if reachable, else note as deferred.

## Status log

All seven waves landed on `chore/quality-followups-2026-05-19` on
2026-05-19.

- [x] Wave 1 — `editorialSubmitSchema` + `editorialUpdateSchema` promoted
      to `@nojv/core` (`packages/core/src/schemas/editorial.ts`); both
      editorial routes import from core.
- [x] Wave 2 — spec drift cleanup: stale TODOs removed from 5 specs,
      `dashboard.md` fully rewritten for the client-side local-day model,
      `contests.md` / `copy-course.md` caveats promoted to behavior
      notes, `QUALITY_SCORE.md` doc-drift entry added.
- [x] Wave 3 — integration tests: `releaseAllSessionsAsInstructor` (4
      cases in `exam-session.test.ts`) + editorial moderation (11 cases
      in new `tests/integration/domain/editorial-reports.test.ts`).
- [x] Wave 4 — 6 SLO alert rules (`infra/grafana/alerts/slo-alerts.json`) + `provision.ts` upload plumbing + 4 unit tests; observability
      runbook + `.env.example` updated.
- [x] Wave 5 — CI security scanning: `codeql.yml` (SAST) + a `pnpm audit`
      job in `ci.yml` (hardened to a blocking gate in Wave 9).
- [x] Wave 6 — v8 coverage thresholds in `vitest.config.ts`, scoped to
      `packages/{domain,core}/src` (measured floor: lines 50 / stmts 48
      / funcs 41 / branches 42).
- [x] Wave 7 — `scripts/generate-schema-docs.mjs` + `pnpm db:docs` emit
      `docs/architecture/DATABASE.generated.md` (36 models, 37 enums);
      linked from `DATABASE.md`, which also dropped the stale
      `UserDailyActivity` node.

### Waves 8–10 — follow-up extension (2026-05-19)

The three items first parked as follow-ups were completed in the same
batch on user request.

- [x] Wave 8 — D4/D6/D7 acceptance criteria written into `exams.md`,
      `assignments.md`, `editorials.md`. Surfaced + fixed a real D6 gap:
      `markAssignmentPublished` (Temporal auto-publish) never wrote an
      `AssessmentAuditLog` row — it now does, with `actorUserId: null`.
      `editorials.md` re-synced for D7 (report workflow moved out of
      "out of scope", rejudge-grandfather edge case, core-schema refs);
      assignments.md `*Assessment*`→`*Assignment*` mutation-name drift
      fixed.
- [x] Wave 9 — dependency advisory triage. 4 direct deps bumped
      (`@sveltejs/kit`, `marked`, OTel `sdk-node` + `auto-instrumentations` + `exporter-metrics-otlp-http`); 7 transitive advisories pinned via
      `pnpm.overrides`. `pnpm audit --audit-level high` now exits clean
      (was 26 high + 1 critical) → `ci.yml` audit job flipped to a hard
      gate (`continue-on-error` removed).
- [x] Wave 10 — Grafana contact point + notification policy provisioning
      (`provision.ts` + `GRAFANA_ALERT_EMAIL`, opt-in); runbook +
      `.env.example` updated.

Final verification (full batch): `pnpm -w typecheck` 10/10 ·
`pnpm lint` 8/8 · `pnpm format` clean · `pnpm test:unit` 81 files /
724 tests · `pnpm test:integration` 26 files / 339 tests.
