# Notification Center — Persistent "Review-Later" Events

**Date:** 2026-04-19
**Scope:** New `Notification` Prisma model, `@nojv/application/notification/*` module, 4 new API routes under `/api/notifications/*`, bell dropdown UI in navbar, SSE integration, Temporal lifecycle workflow hooks for scheduled reminders
**Status:** Design approved, awaiting implementation

## Background

The platform has real-time SSE for submission verdicts and scoreboard ticks, plus a `toast` store for immediate in-session feedback (form saves, copy success, verdicts). **There is no persistent notification store.** When a student is offline and the teacher adds them to a course, or an assignment is 24 hours from due, or an announcement is published, the student has no way to see the event when they next log in.

## Product Goal

Give every user a persistent log of **"review-later" events** that are relevant to them but not urgent enough to interrupt their current work. Accessed via a bell icon in the navbar, never via a toast, never via email (this iteration).

## Toast vs Notification — Hard Boundary

|               | Toast                                                     | Notification                                                       |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Purpose       | "You are using the site right now and this just happened" | "Something relevant to you happened; you may want to look later"   |
| Examples      | Submission verdict, form save success, copy success       | Assignment due in 24h, added to course, announcement, role changed |
| Persistence   | Ephemeral, auto-dismiss                                   | Stored in DB, user-controlled dismissal                            |
| UI entry      | Bottom-right popover                                      | Navbar bell + dropdown                                             |
| Existing code | `$lib/stores/toast.ts` (unchanged)                        | New                                                                |

Verdict and form-success events stay in toast; they MUST NOT be duplicated into the Notification table.

## Scope

### In scope

- `Notification` model + migration with capped retention (50 per user).
- `@nojv/application/notification/*`: `createNotification`, `createNotificationBatch`, `markAsRead`, `markAllAsRead`, `listRecent`, `countUnread`.
- 4 API routes under `/api/notifications/*`.
- Navbar `NotificationBell` + `NotificationDropdown` + `NotificationItem` components.
- Svelte 5 rune store `notifications.svelte.ts` with SSE integration and bell-shake animation trigger.
- 7 event types wired to their producers (3 immediate, 3 scheduled via Temporal, 1 reserved for the Clarification feature landing later).
- Paraglide i18n keys for every user-facing string.

### Out of scope (explicit non-goals for this iteration)

- Email delivery (quota-constrained; revisit later).
- Per-type preference settings.
- A dedicated `/notifications` full page — bell dropdown is the only UI entry.
- Push notifications (service workers).
- Grouping / digest (e.g. "3 new announcements" collapse).

## Data Model

```prisma
model Notification {
  id        String           @id @default(cuid())
  userId    String
  type      NotificationType
  params    Json
  linkUrl   String?
  readAt    DateTime?
  createdAt DateTime         @default(now())

  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])
  @@index([userId, readAt, createdAt(sort: Desc)])
}

enum NotificationType {
  assignment_due_soon
  exam_starting_soon
  contest_starting_soon
  course_enrolled
  announcement_published
  role_changed
  clarification_answered
}
```

**Params shape by type:**

| Type                     | params                                         |
| ------------------------ | ---------------------------------------------- |
| `assignment_due_soon`    | `{ courseSlug, assessmentSlug, title, dueAt }` |
| `exam_starting_soon`     | `{ courseSlug, examId, title, startsAt }`      |
| `contest_starting_soon`  | `{ contestSlug, title, startsAt }`             |
| `course_enrolled`        | `{ courseSlug, courseName }`                   |
| `announcement_published` | `{ announcementId, titleEn, titleZhTw }`       |
| `role_changed`           | `{ newRole, oldRole }`                         |
| `clarification_answered` | reserved; shape decided when feature #3 lands  |

**Retention:** capped at 50 per user. `createNotification` triggers a cleanup that deletes any row beyond the 50th row (ordered by `createdAt DESC`) for that user. Implemented as a subquery inside the same transaction so a single insert never stays over quota.

**i18n:** notification text is **not** stored pre-rendered. The frontend receives `{ type, params }` and calls the matching `m.notification_<type>(params)` paraglide message, so switching locale refreshes old notifications automatically.

## Event Producers

### Immediate events (written inline from domain layer)

| Event                    | Trigger                                    | Producer                                                                           |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `course_enrolled`        | Teacher/TA adds a student to a course      | `manuallyEnrollCourseMember` in `packages/application/src/course/mutations.ts`     |
| `announcement_published` | Announcement transitions draft → published | `packages/application/src/announcement/mutations.ts` (fan-out to all active users) |
| `role_changed`           | Admin changes a user's platform role       | `packages/application/src/admin/mutations.ts`                                      |

### Scheduled events (Temporal workflow sleep-then-fan-out)

| Event                   | Workflow              | Sleep              |
| ----------------------- | --------------------- | ------------------ |
| `assignment_due_soon`   | `assessmentLifecycle` | `dueAt - 24h`      |
| `exam_starting_soon`    | `examLifecycle`       | `startsAt - 15min` |
| `contest_starting_soon` | `contestLifecycle`    | `startsAt - 15min` |

On wake:

- `assignment_due_soon`: query `CourseMembership` (role = student, status = active) for that course AND exclude students who already reached the max score on every attached problem. Remaining students get the notification.
- `exam_starting_soon`: fan-out to users with `ExamParticipation`.
- `contest_starting_soon`: fan-out to users with `ContestParticipation`.

### Fan-out strategy

`createNotificationBatch(inputs)` writes in batches of 500 using a single `INSERT ... SELECT` from the relevant user-source query, avoiding N+1. System-wide announcements could fan out to 10k+ users; class-scoped reminders usually stay ≤ 50.

## Transport & UI

### SSE channel

`apps/web/src/routes/api/events/stream/+server.ts` already subscribes to `user:{userId}`. Add a second subscription to `notification:{userId}` and emit:

```
event: notification
data: { id, type, params, linkUrl, createdAt }
```

`createNotification` publishes the same payload to `notification:{userId}` via the existing Redis pub/sub client in `@nojv/redis`.

### Frontend structure

```
apps/web/src/lib/
  components/notification/
    NotificationBell.svelte       # navbar right: unread count badge + dropdown toggle + shake animation
    NotificationDropdown.svelte   # panel: up to 20 recent + "Mark all read" button + empty state
    NotificationItem.svelte       # single row: type-switch renders m.notification_<type>(params)
  stores/
    notifications.svelte.ts       # Svelte 5 rune store
```

### Store behavior

- **On mount**: `GET /api/notifications/recent?limit=20` — seeds `items` and `unreadCount`.
- **On SSE event**: prepend to `items`, increment `unreadCount`, flip `isAnimating` for 450 ms to trigger bell shake.
- **On item click**: optimistic `markAsRead` + navigate to `linkUrl` (if present). On API error, roll back.
- **On "Mark all read"**: optimistic zero-out + `POST /api/notifications/read-all`. On error, re-fetch.
- **Cap**: when `items.length > 20`, drop the tail — the DB keeps up to 50 but the dropdown only shows 20.

### Bell shake

Plain CSS `@keyframes bell-shake` (rotate ±8deg three times, 450 ms total) + red-dot `@keyframes dot-pulse`. Triggered once per new event; the `$effect` resets the flag so consecutive arrivals each fire one shake.

### API routes

| Method | Path                                | Purpose                                                        |
| ------ | ----------------------------------- | -------------------------------------------------------------- |
| GET    | `/api/notifications/recent?limit=N` | Latest N notifications for the auth user (default 20, max 50). |
| GET    | `/api/notifications/unread-count`   | Unread count — fallback when SSE disconnects.                  |
| POST   | `/api/notifications/[id]/read`      | Mark one as read.                                              |
| POST   | `/api/notifications/read-all`       | Mark all unread as read.                                       |

All gated by `requireAuth` + existing `consumeFormRateLimit` pattern.

## i18n Keys

```
notification_bell_ariaLabel
notification_bell_unread_count            # plural-aware count label
notification_dropdown_title
notification_dropdown_empty
notification_dropdown_markAllRead

notification_assignment_due_soon          # "作業「{title}」將在 24 小時內到期"
notification_exam_starting_soon           # "考試「{title}」將於 15 分鐘後開始"
notification_contest_starting_soon        # "比賽「{title}」將於 15 分鐘後開始"
notification_course_enrolled              # "你被加入課程「{courseName}」"
notification_announcement_published       # "新公告：{title}"
notification_role_changed                 # "你的權限已變更為 {newRole}"
```

Announcement title is stored bilingually in `params.titleEn` / `params.titleZhTw`; the renderer picks the field matching the current locale.

## Testing

- **Unit** (`tests/unit/domain/notification.test.ts`): `createNotification` capped cleanup (inserting #51 deletes the oldest), `markAsRead` idempotence, `countUnread` correctness, batch insert writes the expected row count.
- **Integration** (`tests/integration/notification/sse-push.test.ts`): writing a notification publishes on Redis, and a test SSE subscriber sees the `notification` event within 1 s.
- **E2E**: deferred — integration + unit cover the meaningful surfaces. A dedicated Playwright run can come later if flakiness appears.

## Rollout Order (3 commits)

1. **Schema + domain + API**: `Notification` model, migration, `@nojv/application/notification/*`, 4 API routes, unit + integration tests. Mergeable without any UI changes.
2. **Immediate-event wiring**: `manuallyEnrollCourseMember`, announcement publish, role change — each calls `createNotification`.
3. **Scheduled events + UI**: lifecycle workflows gain sleep steps; `NotificationBell` + dropdown + store + SSE; paraglide keys; bell-shake animation.

Split allows reviewers to reason about data model, side effects, and UX as three independent commits.

## Risks & Mitigations

| Risk                                                    | Mitigation                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Announcement fan-out spike in prod (10k users × batch)  | Batch size 500; `INSERT ... SELECT` keeps it as O(1) round-trips per batch; scheduled off peak by existing announcement publish flow                                                                                                                |
| Workflow replay re-fires reminder                       | Workflow stores a boolean "sent" signal in its own state before calling the activity; activity itself is idempotent because `createNotification` is a plain insert (duplicates are acceptable by design — we don't dedupe across workflow restarts) |
| Redis pub fails silently → user misses real-time update | On reconnect, the SSE client refetches `unread-count`; new notifications are still in the DB and surface on next `/api/notifications/recent` call                                                                                                   |
| Capped cleanup deadlocks under write storm              | The subquery runs inside the same transaction as the insert, scoped to one `userId` — no cross-user lock; DB ordering is deterministic                                                                                                              |
| Stale translations when paraglide keys change           | Since text is rendered client-side from `{ type, params }`, updating a paraglide message updates every existing notification automatically; no migration required                                                                                   |

## Related Docs

- [Product Sense](../../PRODUCT_SENSE.md)
- [Temporal Workflows](../../TEMPORAL.md)
- [Redis Architecture](../../REDIS.md)
- [Frontend Surface](../../FRONTEND.md)
