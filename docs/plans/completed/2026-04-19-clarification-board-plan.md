# Clarification Board Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the public-but-anonymous clarification board described in `2026-04-19-clarification-board-design.md` — data model, domain module with anonymity projection, API routes, SSE channel, tab UI on contest/exam/assignment detail pages, and notification wiring back to feature #1.

**Architecture:** One `Clarification` row per question; asker identity is always stored but masked at the API projection layer for non-staff callers. Student posts publish instantly (`state: pending`); staff move the state machine to `answered | dismissed`. SSE uses a new `clarification:{contextType}:{contextId}` Redis channel.

**Tech Stack:** Prisma 7, `@nojv/domain`, `@nojv/redis` pub/sub, `@nojv/core` (SSE event type), SvelteKit 5 runes, Bits UI dialog, paraglide, Vitest.

**Reference design:** `docs/plans/active/2026-04-19-clarification-board-design.md`.

**Prerequisite:** Feature #1 notification plan is a soft dependency — this plan's final task emits a `clarification_answered` notification, which requires `notificationDomain.createNotification` to exist. If notification plan hasn't landed, either (a) land it first, or (b) stub the notification call behind a feature flag and backfill the dependency later.

**Conventions:** Same as notification and rejudge plans. Routes use cuid URLs (`[contestId]`, `[courseId]`, `[assessmentId]`, `[examId]`).

---

## Phase 1 — Schema + Domain + API

### Task 1: Add `Clarification` schema + enums

**Files:**

- Create: `packages/db/prisma/schema/clarification.prisma`
- Modify: `packages/db/prisma/schema/auth.prisma` (back-relations on `User`)
- Modify: `packages/db/prisma/schema/problem.prisma` (back-relation on `Problem`)

**Step 1: Write the schema**

```prisma
// packages/db/prisma/schema/clarification.prisma

enum ClarificationContextType { contest exam assignment }
enum ClarificationState { pending answered dismissed }

model Clarification {
  id               String                   @id @default(cuid())
  contextType      ClarificationContextType
  contextId        String
  problemId        String?
  askedByUserId    String
  questionText     String                   @db.Text
  answerText       String?                  @db.Text
  state            ClarificationState       @default(pending)
  answeredByUserId String?
  answeredAt       DateTime?
  createdAt        DateTime                 @default(now())
  updatedAt        DateTime                 @updatedAt

  askedBy    User     @relation("ClarificationAsker", fields: [askedByUserId], references: [id], onDelete: Cascade)
  answeredBy User?    @relation("ClarificationAnswerer", fields: [answeredByUserId], references: [id], onDelete: SetNull)
  problem    Problem? @relation(fields: [problemId], references: [id], onDelete: SetNull)

  @@index([contextType, contextId, createdAt(sort: Desc)])
  @@index([contextType, contextId, state])
  @@index([askedByUserId, createdAt(sort: Desc)])
}
```

Add the back-relations:

- `User`: `clarificationsAsked Clarification[] @relation("ClarificationAsker")` and `clarificationsAnswered Clarification[] @relation("ClarificationAnswerer")`
- `Problem`: `clarifications Clarification[]`

**Step 2: Generate + push**

`pnpm db:generate && pnpm db:push` — confirm with `psql $DATABASE_URL -c '\d "Clarification"'`.

**Step 3: Commit**

```bash
git add packages/db/prisma/schema/clarification.prisma packages/db/prisma/schema/auth.prisma packages/db/prisma/schema/problem.prisma
git commit -m "feat(db): Clarification model + state/context enums"
```

---

### Task 2: Migration

**Files:**

- Create: `packages/db/prisma/migrations/20260419140000_add_clarification/migration.sql`

```sql
CREATE TYPE "ClarificationContextType" AS ENUM ('contest', 'exam', 'assignment');
CREATE TYPE "ClarificationState" AS ENUM ('pending', 'answered', 'dismissed');

CREATE TABLE "Clarification" (
  "id"               TEXT PRIMARY KEY,
  "contextType"      "ClarificationContextType" NOT NULL,
  "contextId"        TEXT NOT NULL,
  "problemId"        TEXT,
  "askedByUserId"    TEXT NOT NULL,
  "questionText"     TEXT NOT NULL,
  "answerText"       TEXT,
  "state"            "ClarificationState" NOT NULL DEFAULT 'pending',
  "answeredByUserId" TEXT,
  "answeredAt"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Clarification_askedByUserId_fkey"
    FOREIGN KEY ("askedByUserId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "Clarification_answeredByUserId_fkey"
    FOREIGN KEY ("answeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "Clarification_problemId_fkey"
    FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL
);

CREATE INDEX "Clarification_contextType_contextId_createdAt_idx"
  ON "Clarification" ("contextType", "contextId", "createdAt" DESC);

CREATE INDEX "Clarification_contextType_contextId_state_idx"
  ON "Clarification" ("contextType", "contextId", "state");

CREATE INDEX "Clarification_askedByUserId_createdAt_idx"
  ON "Clarification" ("askedByUserId", "createdAt" DESC);
```

Commit `feat(db): clarification migration`.

---

### Task 3: Repository

**Files:**

- Create: `packages/db/src/repositories/clarification.ts`
- Modify: `packages/db/src/repositories/index.ts`

Minimum surface:

```ts
export const clarificationRepo = {
  listForContext(contextType, contextId, since?: Date) {
    /* orderBy createdAt asc, filter >since if provided */
  },
  findById(id) {
    /* include askedBy + answeredBy + problem */
  },
  create(data) {
    /* plain create */
  },
  updateAnswer(id, { answerText, answeredByUserId, state }) {
    /* partial update */
  },
  updateState(id, state) {
    /* only state, e.g. dismiss */
  },
  countInWindow(userId, contextType, contextId, windowStart) {
    /* for rate limiter */
  },
};
```

Commit `feat(db): clarification repository`.

---

### Task 4: SSE event constant + channel helper

**Files:**

- Modify: `packages/core/src/index.ts` — add:

```ts
export const SSE_CLARIFICATION = "clarification";

export interface ClarificationSSEEvent {
  type: typeof SSE_CLARIFICATION;
  action: "created" | "updated" | "dismissed";
  payload: {
    id: string;
    contextType: "contest" | "exam" | "assignment";
    contextId: string;
    problemId: string | null;
    questionText: string;
    answerText: string | null;
    state: "pending" | "answered" | "dismissed";
    askedByUserId: string | null; // set for staff, null for students
    askedBy: { id: string; username: string; name: string } | null;
    answeredByUserId: string | null;
    answeredAt: string | null;
    createdAt: string;
  };
}
```

- Modify: `packages/redis/src/keys.ts` — add:

```ts
clarificationChannel: (contextType: string, contextId: string) =>
  `clarification:${contextType}:${contextId}`,
```

Commit `feat(core): clarification SSE event + channel`.

---

### Task 5: Domain authz helpers

**Files:**

- Create: `packages/domain/src/clarification/authz.ts`
- Test: `tests/unit/domain/clarification-authz.test.ts`

Three functions + tests:

```ts
// Can the actor ask a clarification in this context?
export async function canAskClarification(actor, contextType, contextId): Promise<boolean> {
  // admin is NOT allowed to ask (admin posts would violate the "only students ask" rule).
  if (actor.platformRole === "admin") return false;
  switch (contextType) {
    case "contest":
      return hasContestParticipation(actor.userId, contextId);
    case "exam":
      return hasExamParticipation(actor.userId, contextId);
    case "assignment":
      return isActiveStudentInAssessment(actor.userId, contextId);
  }
}

// Can the actor answer/dismiss?
export async function canAnswerInContext(actor, contextType, contextId): Promise<boolean> {
  if (actor.platformRole === "admin") return true;
  switch (contextType) {
    case "contest":
      return isContestOrganizer(actor.userId, contextId);
    case "exam":
      return isCourseTeacherOrTaForExam(actor.userId, contextId);
    case "assignment":
      return isCourseTeacherOrTaForAssessment(actor.userId, contextId);
  }
}

// Can the actor see a read response with unmasked author?
export const canSeeAuthor = canAnswerInContext; // admins + staff of that context
```

Tests cover the matrix. Helpers like `hasContestParticipation` likely exist already — grep and reuse.

Commit `feat(domain): clarification authz helpers`.

---

### Task 6: Domain module — mutations + projection + anonymity

**Files:**

- Create: `packages/domain/src/clarification/index.ts`
- Modify: `packages/domain/src/index.ts` (barrel)
- Test: `tests/unit/domain/clarification.test.ts`

**Step 1: Write failing tests** covering:

- `ask` writes row with state `pending`; rejects when caller is not a participant
- `answer` transitions `pending → answered`, sets answeredBy and answeredAt
- `dismiss` transitions `pending → dismissed`; `answered → dismissed` rejected
- `listForViewer` masks `askedBy` + `askedByUserId` for non-staff viewers
- `listForViewer` returns full identity for staff viewers
- `answer` after an already-answered row edits the answer but does not create a new row (is idempotent at the state-machine level — second answer call is treated as "edit")

**Step 2: Implement**

```ts
export async function ask(actor, input: { contextType; contextId; problemId?; questionText }) {
  if (!(await canAskClarification(actor, input.contextType, input.contextId))) {
    throw new ForbiddenError("Only participants may ask clarifications.");
  }
  // contextual time-window check: POST time must be within the context's active window
  await assertContextActiveForAsk(input.contextType, input.contextId);

  // Rate limit: 5 per 10 minutes per (user, context)
  const windowStart = new Date(Date.now() - 10 * 60 * 1000);
  const recent = await clarificationRepo.countInWindow(
    actor.userId,
    input.contextType,
    input.contextId,
    windowStart,
  );
  if (recent >= 5) throw new ConflictError("Too many questions in the last 10 minutes.");

  const row = await clarificationRepo.create({
    contextType: input.contextType,
    contextId: input.contextId,
    problemId: input.problemId ?? null,
    askedByUserId: actor.userId,
    questionText: input.questionText,
  });
  await publishClarificationEvent("created", row);
  return row;
}

export async function answer(actor, id, { answerText }) {
  const row = await clarificationRepo.findById(id);
  if (!row) throw new NotFoundError();
  if (!(await canAnswerInContext(actor, row.contextType, row.contextId)))
    throw new ForbiddenError();
  if (row.state === "dismissed")
    throw new ConflictError("Dismissed clarifications cannot be answered.");

  const updated = await clarificationRepo.updateAnswer(id, {
    answerText,
    answeredByUserId: actor.userId,
    state: "answered",
    answeredAt: row.state === "pending" ? new Date() : row.answeredAt, // preserve first-answered time on edit
  });
  await publishClarificationEvent("updated", updated);
  // Fan out notification only on pending → answered transition
  if (row.state === "pending") {
    await notificationDomain.createNotification({
      userId: row.askedByUserId,
      type: "clarification_answered",
      params: {
        contextType: row.contextType,
        contextId: row.contextId,
        clarificationId: row.id,
        questionPreview: row.questionText.slice(0, 80),
      },
      linkUrl: buildClarificationLink(row.contextType, row.contextId, row.id),
    });
  }
  return updated;
}

export async function dismiss(actor, id) {
  const row = await clarificationRepo.findById(id);
  if (!row) throw new NotFoundError();
  if (!(await canAnswerInContext(actor, row.contextType, row.contextId)))
    throw new ForbiddenError();
  if (row.state === "answered")
    throw new ConflictError("Answered clarifications cannot be dismissed.");
  const updated = await clarificationRepo.updateState(id, "dismissed");
  await publishClarificationEvent("dismissed", updated);
  return updated;
}

export async function listForViewer(viewer, contextType, contextId, since?: Date) {
  const rows = await clarificationRepo.listForContext(contextType, contextId, since);
  const staff = await canSeeAuthor(viewer, contextType, contextId);
  return rows.map((r) => projectRow(r, staff));
}

function projectRow(row, canSeeAuthor: boolean) {
  return {
    ...row,
    askedByUserId: canSeeAuthor ? row.askedByUserId : null,
    askedBy: canSeeAuthor ? row.askedBy : null,
  };
}

function buildClarificationLink(contextType, contextId, id): string {
  switch (contextType) {
    case "contest":
      return `/contests/${contextId}#clarification-${id}`;
    case "exam":
      return `/exams/${contextId}#clarification-${id}`;
    case "assignment":
      return `/assignments/${contextId}#clarification-${id}`;
  }
}
```

Publish helper:

```ts
async function publishClarificationEvent(action, row) {
  try {
    // We publish the staff projection; the SSE bridge re-masks per subscriber.
    await getRedis().publish(
      keys.clarificationChannel(row.contextType, row.contextId),
      JSON.stringify({ type: SSE_CLARIFICATION, action, payload: projectRow(row, true) }),
    );
  } catch {
    /* best-effort */
  }
}
```

**Canned replies:** the route (`POST /canned`) calls `answer` with `answerText` filled from the paraglide message at the default locale (server-side). Logic lives on the server-route side, not domain.

**Step 3: Commit**

```bash
git commit -m "feat(domain): clarification module with anonymity projection"
```

---

### Task 7: API routes

**Files:**

- Create: `apps/web/src/routes/api/clarifications/+server.ts` (GET, POST)
- Create: `apps/web/src/routes/api/clarifications/[id]/+server.ts` (PATCH)
- Create: `apps/web/src/routes/api/clarifications/[id]/canned/+server.ts` (POST)

**Notes:**

- GET accepts `contextType`, `contextId`, optional `since`. Returns the viewer-projected list.
- POST body: `{ contextType, contextId, problemId?, questionText }` (Zod: questionText 10–1000).
- PATCH accepts one of:
  - `{ answerText: string }` (1–1000) — calls `answer`
  - `{ state: "dismissed" }` — calls `dismiss`
  - `{ state: "answered", answerText: string }` — equivalent to the first
- `/canned` body: `{ templateKey: "noComment" | "readProblem" | "yes" | "no" }`; server resolves the text via paraglide at the default locale and forwards to `answer`.

Rate limiting: `consumeFormRateLimit` is additional defense on top of the domain's 5-per-10min rule, using separate bucket `clarify-ask:${actor.userId}`.

The SSE bridge in `/api/events/stream/+server.ts` needs to know which clarification channels to subscribe to. Simplest approach: the client sends the context via a query param (e.g. `?sub=clarification:contest:abc,...`) and the server validates the subscription request (user must be a participant OR have view access). Implementation: accept `?clarificationSub=<contextType>:<contextId>` and resolve in the bridge.

Commit `feat(web): clarification API routes + SSE subscription`.

---

## Phase 2 — Frontend

### Task 8: Store

**Files:**

- Create: `apps/web/src/lib/stores/clarifications.svelte.ts`

```ts
export type ClarificationItem = {
  id: string;
  contextType: string;
  contextId: string;
  problemId: string | null;
  questionText: string;
  answerText: string | null;
  state: "pending" | "answered" | "dismissed";
  askedBy: { id: string; username: string; name: string } | null;
  answeredAt: string | null;
  createdAt: string;
};

export function createClarificationsStore(contextType: string, contextId: string) {
  const items = $state<ClarificationItem[]>([]);
  let lastSeen = $state<string | null>(null); // localStorage-backed "last tab visit"

  async function init() {
    const r = await fetch(
      `/api/clarifications?contextType=${contextType}&contextId=${contextId}`,
    );
    if (r.ok) items.splice(0, items.length, ...(await r.json()).items);
  }

  function handleSse(event: { action: string; payload: ClarificationItem }) {
    const idx = items.findIndex((i) => i.id === event.payload.id);
    if (idx >= 0) items[idx] = event.payload;
    else items.unshift(event.payload);
  }

  async function ask(questionText: string, problemId: string | null) {
    const r = await fetch("/api/clarifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contextType, contextId, problemId, questionText }),
    });
    if (!r.ok) throw new Error("Ask failed");
    // SSE will deliver the row; UI doesn't need to optimistically insert.
  }

  async function answer(id: string, answerText: string) {
    /* PATCH */
  }
  async function dismiss(id: string) {
    /* PATCH */
  }
  async function canned(id: string, templateKey: string) {
    /* POST /canned */
  }

  const unreadCount = $derived(
    lastSeen ? items.filter((i) => i.createdAt > lastSeen).length : 0,
  );

  function markTabVisited() {
    lastSeen = new Date().toISOString();
    // persist to localStorage keyed by context
  }

  return { items, unreadCount, init, handleSse, ask, answer, dismiss, canned, markTabVisited };
}
```

Commit `feat(web): clarification store`.

---

### Task 9: Components

**Files:**

- Create: `apps/web/src/lib/components/clarification/ClarificationTab.svelte`
- Create: `apps/web/src/lib/components/clarification/ClarificationList.svelte`
- Create: `apps/web/src/lib/components/clarification/ClarificationItem.svelte`
- Create: `apps/web/src/lib/components/clarification/ClarificationAskForm.svelte`
- Create: `apps/web/src/lib/components/clarification/ClarificationStaffPanel.svelte`

`ClarificationTab.svelte` props: `{ contextType, contextId, canAsk, canAnswer, problems: { id, title }[] }`. Initializes the store, subscribes to SSE, renders ask-form (if `canAsk`), list, and inlines the staff panel (if `canAnswer`) for each pending row.

`ClarificationItem.svelte` renders:

- Anonymous "Anonymous" (or staff-visible `askedBy.username`) + relative time
- Optional problem link via `problemId`
- Question body
- Answer body (if present) with state badge
- State badge: `pending` / `answered` / `dismissed` (dismissed rows styled at `opacity-50`)
- If staff and row is `pending`: expanded `ClarificationStaffPanel`

`ClarificationStaffPanel.svelte` holds the answer textarea, canned-reply buttons (4 quick buttons using `/canned`), dismiss button, submit button.

`ClarificationAskForm.svelte` holds optional problem picker (first item "General (not about a specific problem)"), textarea (10–1000 char counter), submit.

Commit `feat(web): clarification components`.

---

### Task 10: Mount tabs on detail pages

**Files:**

- Modify: `apps/web/src/routes/(app)/contests/[contestId]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/exams/[examId]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/assignments/[assessmentId]/+page.svelte`
- Modify: matching `+page.server.ts` load functions to pass `canAsk`, `canAnswer`, and the attached problems list to the tab

Add a new "Clarifications" tab using whatever tab primitive already lives on each page (likely Bits UI `Tabs`). Pass:

- `contextType="contest" | "exam" | "assignment"`
- `contextId={params.contestId | examId | assessmentId}`
- `canAsk`, `canAnswer` booleans resolved server-side
- `problems` from the existing load data

Commit `feat(web): clarification tab on contest/exam/assignment detail`.

---

### Task 11: SSE client integration

**Files:**

- Modify: the existing SSE client code (search for `EventSource` / `events/stream` usage in the existing Layout or `useSseEvents` helper)

When `ClarificationTab` mounts, call the existing `subscribeToClarifications(contextType, contextId)` helper (create if needed) that:

1. Appends `?clarificationSub=<contextType>:<contextId>` to the stream URL (requires reconnecting the `EventSource`).
2. On `event: clarification` SSE message, calls `store.handleSse(parsedData)`.

Commit `feat(web): clarification SSE client bridge`.

---

## Phase 3 — Final polish

### Task 12: i18n keys

**Files:**

- Modify: `apps/web/messages/en.json`, `zh-TW.json`

Keys from the design doc. Remember the canned-reply templates — these are used server-side (POST /canned) AND client-side (as button labels). Ensure both contexts access the same paraglide message.

Compile and commit.

---

### Task 13: Integration test — SSE round trip + notification wiring

**Files:**

- Create: `tests/integration/clarification/sse-and-notify.test.ts`

```ts
it("ask publishes SSE event; answer publishes event + notification", async () => {
  const organizer = await createTestUser({ role: "teacher" });
  const contestant = await createTestUser({ role: "student" });
  const contest = await createTestContest({ organizerId: organizer.id });
  await createTestContestParticipation(contestant.id, contest.id);

  const sub = createSubscriber(process.env.REDIS_URL!);
  const events: any[] = [];
  sub.on("message", (_chan, msg) => events.push(JSON.parse(msg)));
  await sub.subscribe(keys.clarificationChannel("contest", contest.id));

  const asked = await clarificationDomain.ask(actorFor(contestant), {
    contextType: "contest",
    contextId: contest.id,
    questionText: "Is this modular arithmetic?",
  });

  // Expect a "created" SSE event
  await waitFor(() => events.find((e) => e.action === "created"));
  expect(events[0].payload.askedByUserId).toBe(contestant.id);

  await clarificationDomain.answer(actorFor(organizer), asked.id, {
    answerText: "Yes, mod 1e9+7.",
  });

  // Expect "updated" SSE event + a clarification_answered notification for the asker
  await waitFor(() => events.find((e) => e.action === "updated"));
  const notes = await notificationRepo.listRecent(contestant.id, 10);
  expect(notes[0]!.type).toBe("clarification_answered");

  await sub.quit();
});
```

Commit `test: clarification SSE + notification integration`.

---

### Task 14: `clarification_answered` notification i18n

**Files:**

- Modify: `apps/web/messages/en.json`, `zh-TW.json`

Fill in `notification_clarification_answered` — uses `params.questionPreview` and `params.contextType`. e.g.:

- en: `"Your question has been answered: \"{questionPreview}...\""`
- zh-TW: `"你的提問已被回覆：「{questionPreview}...」"`

Compile paraglide and commit.

---

## Final Verification

```bash
pnpm -w typecheck          # green
pnpm lint                  # green
pnpm -w format             # clean
pnpm test:unit             # new authz + domain tests green
pnpm test:integration      # publish + notify integration green
```

Manual smoke:

1. Log in as student A (contestant) and teacher B (organizer) of a live contest in two browsers.
2. A opens the Clarifications tab, submits "Is Problem A modular?". B's SSE receives a `pending` row with A's identity visible.
3. Other students opening the tab see the same row with `Anonymous`.
4. B answers via the staff panel. A's bell gets a `clarification_answered` notification. The row updates live on all tabs.
5. B opens a new student-like participant C; C sees the answered Q with anonymous author.
6. B tries to answer an already-dismissed row — gets an error.
7. Try asking 6 times in 10 minutes — 6th request is rate-limited with 409.

---

## Notes for the Implementer

- Do NOT allow admins to ask. `canAskClarification` explicitly returns `false` for admin — preserves the "staff cannot drop hints via questions" invariant.
- Do NOT expose the asker's identity in any client-side JSON when the caller is a non-staff viewer, including when the caller is the asker themselves. The asker recovers their own threads via the bell notification.
- Server-side staff projection goes to the Redis channel (Task 6 `publishClarificationEvent`); the SSE endpoint at `/api/events/stream/+server.ts` must re-project per subscriber, since one connection serves one user. A simple approach: on subscribe, resolve whether this user is staff for that context once, cache the boolean, and mask on each message.
- Student state transition rules:
  - `pending → answered` ✅ (via `answer`)
  - `pending → dismissed` ✅ (via `dismiss`)
  - `answered → answered` ✅ (answer edit — but does NOT re-fire notification)
  - `answered → dismissed` ❌ (once answered, cannot dismiss)
  - `dismissed → *` ❌
- Time-window check (`assertContextActiveForAsk`): reject `POST` outside the context's active window. Reads remain unrestricted so historical review works after the context ends.

---

## Related

- Design: `docs/plans/active/2026-04-19-clarification-board-design.md`
- Companion: feature #1 notification plan provides `createNotification` + the `clarification_answered` NotificationType enum value
- Memory: clarification visibility / anonymity pattern
- Memory: submission operation permission rule (same context → staff mapping reused here)
