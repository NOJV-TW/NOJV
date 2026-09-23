# Server-side code drafts

**Goal:** keep a student's unsubmitted editor code on the server so it survives a change of machine and is never left readable on a shared lab computer.

**Trigger:** on 2026-09-21 a Quiz 01 student ended the exam with zero submissions. Her code, if any, existed only in plain text in a lab PC's `localStorage`, keyed without a user id, so the next student at that PC would also have been shown it.

**Dependencies:** [Exams](../../specs/exams.md), [Threat Model](../../operations/THREAT_MODEL.md), [Database](../../architecture/DATABASE.md), [Redis](../../architecture/REDIS.md).

## Decisions (confirmed with the product owner on 2026-09-23)

- The server holds the draft of record. The browser keeps only edits not yet acknowledged by the server, sealed with a per-user AES-GCM key (landed in the same PR), and deletes them once the server acknowledges the same content.
- One row per `(userId, contextKey, problemId, language)`; `contextKey` is `practice`, `assignment:<assessmentId>`, `exam:<examId>`, `contest:<contestId>` or `virtual:<participationId>`. Contexts never share drafts, so an exam never starts from homework or practice code.
- Only the owner can read or write a draft. Staff have no view of unsubmitted drafts. Drafts are not encrypted at rest on the server; access control is the boundary, the same as for submitted source.
- Exam drafts can only be written while the student has an active session for that exam, the exam is published and not ended, and the problem belongs to the exam. This prevents preparing exam drafts in advance. While an exam session is active, the student can read and write only that exam's drafts.
- Drafts use their own rate limiter rather than the shared write limiter, so autosave never consumes the submission budget. The client saves at most once every few seconds per problem and language, and flushes with `keepalive` when the page is hidden.

## Work and verification

1. Schema, migration and repository for `CodeDraft`; regenerate `DATABASE.generated.md` and update the model index.
2. Application functions with the context authorization above; integration tests for each context, exam confinement, the ended-exam and pre-start rejections, and owner-only reads.
3. `GET`/`PUT /api/drafts` with body limits and a dedicated limiter; list the `GET` route as exam-scoped in the confinement allowlist test.
4. Client sync: hydrate prefers an unacknowledged local edit, otherwise the server draft; throttle and keepalive flush; clear the local copy after acknowledgement. Unit tests for the sync queue, plus the workspace e2e across a reload.
5. Specs, threat model and this plan updated; ship together with the end-exam wording change in PR #522.

## Risks

- Last write wins when the same draft is edited on two devices at once.
- Rows accumulate without a retention policy; add one if the table grows materially.

## Results

- `CodeDraft` table (migration `20260923230000_code_draft`), `codeDraftDomain.listCodeDrafts` / `saveCodeDraft`, and `GET`/`PUT /api/drafts` on a dedicated `rl:draft` limiter (60 per minute per user).
- Client sync in `apps/web/src/lib/services/draft-sync.ts`: every 5 s per language, `keepalive` flush on hide, retry on 5xx/429, drop on other rejections, and no pushes when the initial load failed so another device's draft is never overwritten by starter code.
- Verified locally: unit and component suites, integration tests for the context rules (run in CI), and Playwright for single-file and multi-file workspaces: the draft reaches the server, no plain text stays in `localStorage`, and a reload with `localStorage` cleared restores it from the server.
