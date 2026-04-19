# Clarification Board — Public-But-Anonymous Q&A for Contests, Exams, Assignments

**Date:** 2026-04-19
**Scope:** New `Clarification` Prisma model, `@nojv/domain/clarification/*` module, 4 API routes, new tab on contest / exam / assignment detail + manage pages, SSE integration, one notification type tied to feature #1
**Status:** Design approved, awaiting implementation

## Background

Competitive judging has a time-honored primitive — clarifications — that NOJV doesn't have. During a live contest / exam / assignment, a participant sees an ambiguous problem statement or suspects a bad testcase and asks a question; staff answer it. Historically (ICPC), all Q&A is public so nobody gains a private informational edge. Today, participants in NOJV have no in-platform channel — they fall back to email, Slack, or raising a hand in person, which is inconsistent and leaks hints unequally.

## Product Goal

Every contest / exam / assignment gets a clarification board where participants can ask questions and staff can answer. Questions are visible to everyone the instant they are asked, preventing duplicates; staff can answer at their own pace. Asker identities are hidden from peers but visible to staff for accountability.

## Core Design Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Context scope | contest + exam + assignment | All three have a "staff vs participants" asymmetry worth supporting |
| Visibility | Public-but-anonymous to students; full identity to staff | Balance ICPC-style transparency with the psychological barrier to asking "dumb" questions |
| Who can ask | Students only (confirmed by `ContestParticipation` / `ExamParticipation` / `CourseMembership.role = student`) | Staff accounts ask nothing; prevents the "staff fakes a question to drop a hint" abuse pattern |
| Who can answer | Matches the submission-context permission matrix — organizer for contests, teacher/TA for exam/assignment, admin always | Consistent with rejudge / score override |
| Problem linkage | Optional (`problemId` nullable) | Flexibility for "general" vs. per-problem questions |
| Unanswered visibility | Published instantly on submit (with `state: pending`) | Lets students check before asking duplicates — the user's explicit rationale |
| Editability | Student questions are immutable; staff may edit their own answers; staff cannot edit student questions; staff may set `state: dismissed` for spam/irrelevant | Preserves the "post-on-submit" contract while giving staff a graceful way to handle noise |
| Canned answers | 4 built-in templates via paraglide i18n keys | Speed up the common "No comment" / "Read the problem" replies |
| Notifications | Active users get SSE push; asker gets a persistent notification when answered | Live awareness + offline catch-up for the asker only |

## Data Model

```prisma
model Clarification {
  id               String              @id @default(cuid())
  contextType      ClarificationContextType
  contextId        String              // contestId | examId | courseAssessmentId
  problemId        String?             // null = "general question about the context"
  askedByUserId    String              // always a real user id; masked at API boundary for non-staff
  questionText     String              @db.Text
  answerText       String?             @db.Text
  state            ClarificationState  @default(pending)
  answeredByUserId String?
  answeredAt       DateTime?
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt

  askedBy          User                @relation("ClarificationAsker", fields: [askedByUserId], references: [id], onDelete: Cascade)
  answeredBy       User?               @relation("ClarificationAnswerer", fields: [answeredByUserId], references: [id], onDelete: SetNull)
  problem          Problem?            @relation(fields: [problemId], references: [id], onDelete: SetNull)

  @@index([contextType, contextId, createdAt(sort: Desc)])
  @@index([contextType, contextId, state])
  @@index([askedByUserId, createdAt(sort: Desc)])
}

enum ClarificationContextType { contest exam assignment }
enum ClarificationState { pending answered dismissed }
```

No separate `answer` table — answers are inline columns on the same row. A row transitions `pending → answered` when staff fills `answerText + answeredByUserId + answeredAt`. `dismissed` is a staff-only state for spam/off-topic; the row remains visible in the list but visually de-emphasized.

**Length limits (Zod-validated):**

- `questionText`: 10–1000 chars
- `answerText`: 1–1000 chars

**Rate limits on ask:** 5 questions per 10 minutes per (user, context). Implemented via the existing `consumeFormRateLimit` helper with a context-scoped key.

## Anonymity at the API Boundary

The DB always stores `askedByUserId` as the real user. The API layer strips or keeps it based on the caller:

```ts
function projectClarificationForViewer(clar, viewer) {
  const canSeeAuthor = viewer.isAdmin || viewer.canAnswerInContext(clar.contextType, clar.contextId);
  return {
    ...clar,
    askedBy: canSeeAuthor ? clar.askedBy : null,        // null → frontend renders "anonymous"
    askedByUserId: canSeeAuthor ? clar.askedByUserId : null
  };
}
```

The student frontend never receives the asker id. Staff UI renders the author as a link to the profile.

The asker themselves, when viewing the public board, also sees their own question as "anonymous" — this is important: if the UI showed "you asked this" only on your own questions, students could watch each other's screens and de-anonymize. Private knowledge that a row is yours lives only in your own "My Questions" count on the bell or a `mine = true` flag sent only to you (opt-in).

## Permissions (shared with rejudge / score override)

- **Ask**: caller must be a student-role participant in the target context. Staff accounts get 403 on ask endpoints.
- **Answer / dismiss**: caller must satisfy `canAnswerInContext(contextType, contextId)`:
  - `contest` → contest organizer or admin
  - `exam` → course teacher/TA for that course, or admin
  - `assignment` → course teacher/TA for that course, or admin
- **List**: any authenticated user with "view access" to the context — student participants, staff, admin. The `askedBy` field is masked per the anonymity rule.

Helpers live in `packages/domain/src/clarification/authz.ts` alongside existing authz patterns.

## API Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/clarifications?contextType=&contextId=` | List all clarifications for a context, with anonymity masking. Optional `?since=<createdAt>` for SSE backfill. |
| POST | `/api/clarifications` | Ask a new question. Body: `{ contextType, contextId, problemId?, questionText }`. Rate-limited. |
| PATCH | `/api/clarifications/[id]` | Staff: answer or edit answer or dismiss. Body: one of `{ answerText, state: "answered" }`, `{ state: "dismissed" }`. |
| POST | `/api/clarifications/[id]/canned` | Staff convenience: apply a canned reply. Body: `{ templateKey: "noComment" \| "readProblem" \| "yes" \| "no" }`. Internally sets `answerText = m.clarification_template_<key>()` in the default locale and flips state to `answered`. |

All routes: `requireAuth` + `consumeFormRateLimit` + permission checks via shared helpers. `PATCH` emits an audit-style log line via the existing logger (not a dedicated audit table — the `answeredBy` + `updatedAt` columns plus log retention cover the accountability need for this feature).

## Frontend

### Tabs

A new "Clarifications" tab appears on:

- `/(app)/contests/[slug]` detail
- `/(app)/courses/[slug]/exams/[examId]` detail
- `/(app)/courses/[slug]/assignments/[assessmentSlug]` detail

Students see a feed of `pending | answered | dismissed` rows with anonymous asker; staff (by virtue of the permission gate) see authors inline.

### Components

```
apps/web/src/lib/components/clarification/
  ClarificationTab.svelte         # container: SSE subscription, list, ask form, empty state
  ClarificationList.svelte        # renders rows with filter (all | pending | answered | mine)
  ClarificationItem.svelte        # question + answer card; state badge; linkify problem
  ClarificationAskForm.svelte     # student-only form with problem picker, textarea, char counter
  ClarificationStaffPanel.svelte  # staff-only: answer textarea + canned reply buttons + dismiss
```

### SSE integration

New channel `clarification:{contextType}:{contextId}`. On publish (new question / updated answer / dismiss), `@nojv/redis` publishes the full projected row (staff-side projection — the SSE bridge re-masks per-subscriber). The existing `/api/events/stream/+server.ts` adds a subscription to this channel when the current route is a clarification-hosting page.

Client store `clarifications.svelte.ts`:

- On mount: `GET /api/clarifications?contextType=&contextId=`
- On SSE: merge by id (upsert)
- Unread counter: client-local "rows appeared after last tab-visit" — no server-side read state, since there's no per-user read log on this feature by design (keep the scope small)

### Canned templates (i18n keys)

```
clarification_template_noComment         # "No comment."
clarification_template_readProblem       # "Please re-read the problem statement."
clarification_template_yes               # "Yes."
clarification_template_no                # "No."

clarification_tab_title
clarification_askBtn
clarification_ask_questionLabel
clarification_ask_problemLabel
clarification_ask_problemGeneral         # "General (not about a specific problem)"
clarification_state_pending
clarification_state_answered
clarification_state_dismissed
clarification_answer_anonymous           # "Anonymous"
clarification_answer_empty
clarification_answer_placeholder
clarification_answer_submitBtn
clarification_answer_dismissBtn
```

### Student self-identification

Per the anonymity rule, even the asker does not see their own question flagged visually — but the bell notification they receive when their question is answered includes the question preview + a deep link with an anchor (`#clarification-<id>`), which is the explicit way students recover their own threads.

## Notification Integration

Ties into feature #1. The `clarification_answered` type is already reserved there; this feature fills in the params:

```ts
params: {
  contextType: "contest" | "exam" | "assignment",
  contextId: string,
  clarificationId: string,
  questionPreview: string  // first 80 chars of questionText
}
linkUrl: `/contests/[slug]#clarification-<id>` | etc.
```

Triggered when `PATCH /api/clarifications/[id]` transitions `pending → answered` (not on further answer edits). Not triggered for `dismissed` — that's an indirect answer (staff declined); notifying the asker about a dismissal is passive-aggressive. Students see the dismissed state if they check the board, which is sufficient.

Active SSE subscribers also receive the update, but the notification is the offline-safe persistence layer — a student who was on a different tab still finds it on the bell when they return.

## Rollout Order (3 commits)

1. **Schema + domain + API**: `Clarification` model + migration, `@nojv/domain/clarification/*` with authz helpers, 4 API routes with anonymity projection and permission gates, unit + integration tests. No UI yet.
2. **Frontend tab + SSE**: components, store, SSE bridge, paraglide keys. Lands on all three detail pages in one commit since they share the component.
3. **Notification wiring**: `clarification_answered` producer call in `PATCH /api/clarifications/[id]` → `createNotification`; small test ensuring only the state-transition case fires, not subsequent edits.

Split allows reviewers to reason about anonymity/permissions independently of UI.

## Testing

- **Unit** (`tests/unit/domain/clarification.test.ts`):
  - Student can ask in contexts where they participate; non-participant gets 403.
  - Staff of the correct course/contest can answer; others get 403.
  - Author masking: non-staff projection returns `askedBy = null`; staff projection returns the full user.
  - State transitions: `pending → answered` OK; `pending → dismissed` OK; `answered → answered` (edit) OK; `dismissed → answered` rejected (once dismissed, stay dismissed, staff must create-new if they change their mind).
  - `questionText` length bounds enforced.
- **Integration** (`tests/integration/clarification/sse.test.ts`):
  - Ask from one session → second SSE subscriber receives the event within 1 s with masked author.
  - Staff answer → notification row appears for the original asker.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Spam: one student posts 50 duplicates fast | Rate limit (5 / 10 min / context); staff can `dismiss` en masse |
| De-anonymization via timestamps + participation count | Mitigated but not eliminated — in a 2-person exam, even anonymous posts de-anonymize by elimination. Acceptable: documented behavior, staff can inform students that anonymity is best-effort in small rooms |
| Asker sees they're the author in their own session (from browser state or response payload) | API response never contains `askedByUserId` for non-staff, including for the asker themselves. Asker identifies their own threads via the bell notification, not via the public list |
| Leaked hints: staff accidentally drop info in an answer | Out of scope — this is staff process, not a platform guarantee. Canned templates reduce accidental verbosity |
| Clarification board abused to leak messages to peers | Staff see author identity and can `dismiss` + report. Rate limit prevents flooding |
| `Problem` deleted while clarifications reference it | `onDelete: SetNull` on `problemId` — clarification survives as a "general" question, text body retains whatever context the asker wrote |
| Contest ends, clarification board still accepting questions | Server-side check: `POST /api/clarifications` rejects if current time is outside the context's active window. Read endpoints remain open for historical review |
| SSE disconnect during live contest → missed question | Client store's `since` query on reconnect replays anything newer than the latest id held locally |

## Related Docs

- [Product Sense](../../PRODUCT_SENSE.md)
- [Frontend Surface](../../FRONTEND.md)
- [Redis Architecture](../../REDIS.md)
- Memory: clarification visibility / anonymity pattern
- Memory: submission operation permission rule
- Companion plan: 2026-04-19-notification-center-design.md (provides `clarification_answered` type)
