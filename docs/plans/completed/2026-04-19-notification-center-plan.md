# Notification Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the persistent "review-later" notification system described in `2026-04-19-notification-center-design.md` — data model, domain module, APIs, SSE delivery, bell dropdown UI, and producers that write notifications from immediate events and scheduled Temporal workflows.

**Architecture:** One `Notification` row per event per user; text is rendered client-side from `(type, params)` via paraglide. SSE pushes land on the existing `/api/events/stream` endpoint via a new `notification:{userId}` Redis channel. Scheduled events piggyback on existing lifecycle Temporal workflows with a sleep-then-fan-out pattern.

**Tech Stack:** Prisma 7 (Postgres), `@nojv/domain` (business logic), `@nojv/redis` (pub/sub), `@nojv/core` (shared schemas + constants), `@nojv/temporal` (workflows), SvelteKit 5 runes (frontend), paraglide (i18n), Vitest (tests), existing `sveltekit-superforms` and `requireAuth` patterns.

**Reference design:** `docs/plans/active/2026-04-19-notification-center-design.md` — read first.

**Conventions to match:**

- Domain module lives at `packages/domain/src/notification/` with `index.ts` barrel export (mirror `packages/domain/src/announcement/`).
- Repository at `packages/db/src/repositories/notification.ts` (mirror `announcement.ts`).
- API routes are SvelteKit server routes at `apps/web/src/routes/api/notifications/...` using `apiHandler` + `requireAuth` + `consumeFormRateLimit`.
- Schema changes go in `packages/db/prisma/schema/*.prisma` (multi-file schema). Create a new `notification.prisma` file.
- Tests in `tests/unit/domain/` (unit) and `tests/integration/{db,redis,api}/` (integration).
- Paraglide messages in `apps/web/messages/en.json` and `zh-TW.json`; run `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide` (from inside `apps/web`) after editing.
- Components under `apps/web/src/lib/components/notification/`, stores under `apps/web/src/lib/stores/`.
- Every task ends with `git add <files> && git commit -m "<msg>"`. Commit messages use conventional-commit style matching existing history. No amends — append new commits.
- After each task, run the minimal verifier (`pnpm -w typecheck`, relevant `pnpm test:unit -- <file>`, `pnpm lint`) before moving on.

---

## Phase 1 — Schema + Domain + API (commit group "feat: notification data layer")

### Task 1: Add `Notification` model + `NotificationType` enum to Prisma schema

**Files:**

- Create: `packages/db/prisma/schema/notification.prisma`
- Modify: `packages/db/prisma/schema/auth.prisma` (add `notifications Notification[]` relation on `User`)

**Step 1: Create the new schema file**

```prisma
// packages/db/prisma/schema/notification.prisma

enum NotificationType {
  assignment_due_soon
  exam_starting_soon
  contest_starting_soon
  course_enrolled
  announcement_published
  role_changed
  clarification_answered
}

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
```

**Step 2: Add back-relation on `User`**

In `packages/db/prisma/schema/auth.prisma`, find the `model User` block and add one line to its relations section:

```prisma
  notifications Notification[]
```

**Step 3: Regenerate the client and push to dev DB**

Run: `pnpm db:generate && pnpm db:push`
Expected: no errors; `psql $DATABASE_URL -c '\d "Notification"'` shows the columns.

**Step 4: Commit**

```bash
git add packages/db/prisma/schema/notification.prisma packages/db/prisma/schema/auth.prisma
git commit -m "feat(db): add Notification model and NotificationType enum"
```

---

### Task 2: Generate production migration

**Files:**

- Create: `packages/db/prisma/migrations/<timestamp>_add_notification_table/migration.sql`

**Step 1: Write the migration by hand**

```sql
-- packages/db/prisma/migrations/20260419120000_add_notification_table/migration.sql

CREATE TYPE "NotificationType" AS ENUM (
  'assignment_due_soon',
  'exam_starting_soon',
  'contest_starting_soon',
  'course_enrolled',
  'announcement_published',
  'role_changed',
  'clarification_answered'
);

CREATE TABLE "Notification" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "type"      "NotificationType" NOT NULL,
  "params"    JSONB NOT NULL,
  "linkUrl"   TEXT,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "Notification_userId_createdAt_idx"
  ON "Notification" ("userId", "createdAt" DESC);

CREATE INDEX "Notification_userId_readAt_createdAt_idx"
  ON "Notification" ("userId", "readAt", "createdAt" DESC);
```

**Step 2: Verify migration shape against schema**

Run: `pnpm db:generate`
Expected: no drift.

**Step 3: Commit**

```bash
git add packages/db/prisma/migrations/20260419120000_add_notification_table/
git commit -m "feat(db): notification migration"
```

---

### Task 3: Add repository

**Files:**

- Create: `packages/db/src/repositories/notification.ts`
- Modify: `packages/db/src/repositories/index.ts`

**Step 1: Write `notification.ts`**

```ts
// packages/db/src/repositories/notification.ts
import { prisma } from "../client";
import type { Prisma, NotificationType } from "../../generated/prisma/client";

export const NOTIFICATION_RETENTION_PER_USER = 50;

export interface NotificationCreateInput {
  userId: string;
  type: NotificationType;
  params: Prisma.InputJsonValue;
  linkUrl?: string | null;
}

export const notificationRepo = {
  listRecent(userId: string, limit: number) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  countUnread(userId: string) {
    return prisma.notification.count({ where: { userId, readAt: null } });
  },

  // Single-user insert + capped cleanup in one transaction.
  async createAndCap(input: NotificationCreateInput) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          params: input.params,
          linkUrl: input.linkUrl ?? null,
        },
      });

      // Delete anything beyond the retention cap for this user.
      await tx.$executeRaw`
        DELETE FROM "Notification"
        WHERE "id" IN (
          SELECT "id" FROM "Notification"
          WHERE "userId" = ${input.userId}
          ORDER BY "createdAt" DESC
          OFFSET ${NOTIFICATION_RETENTION_PER_USER}
        )
      `;

      return row;
    });
  },

  // Batch insert for fan-outs (announcement to all users).
  // Caller splits into chunks of 500.
  async createManyAndCap(inputs: NotificationCreateInput[]) {
    if (inputs.length === 0) return 0;
    const result = await prisma.notification.createMany({
      data: inputs.map((i) => ({
        userId: i.userId,
        type: i.type,
        params: i.params as Prisma.InputJsonValue,
        linkUrl: i.linkUrl ?? null,
      })),
    });

    // Capped cleanup is best-effort for batches: one pass per distinct userId.
    const userIds = Array.from(new Set(inputs.map((i) => i.userId)));
    for (const userId of userIds) {
      await prisma.$executeRaw`
        DELETE FROM "Notification"
        WHERE "id" IN (
          SELECT "id" FROM "Notification"
          WHERE "userId" = ${userId}
          ORDER BY "createdAt" DESC
          OFFSET ${NOTIFICATION_RETENTION_PER_USER}
        )
      `;
    }

    return result.count;
  },

  async markRead(userId: string, notificationId: string) {
    const row = await prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return row.count;
  },

  async markAllRead(userId: string) {
    const row = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return row.count;
  },
};
```

**Step 2: Re-export from barrel**

Edit `packages/db/src/repositories/index.ts` — append:

```ts
export { notificationRepo, NOTIFICATION_RETENTION_PER_USER } from "./notification";
export type { NotificationCreateInput } from "./notification";
```

**Step 3: Typecheck**

Run: `pnpm -w typecheck`
Expected: 0 errors.

**Step 4: Commit**

```bash
git add packages/db/src/repositories/notification.ts packages/db/src/repositories/index.ts
git commit -m "feat(db): notification repository with capped retention"
```

---

### Task 4: Core package — SSE event constant + channel helper

**Files:**

- Modify: `packages/core/src/index.ts`
- Modify: `packages/redis/src/keys.ts`

**Step 1: Find the SSE event constants in `@nojv/core`** (search for `SSE_SUBMISSION_VERDICT`). Add a new constant next to them:

```ts
export const SSE_NOTIFICATION = "notification";

export interface NotificationSSEEvent {
  type: typeof SSE_NOTIFICATION;
  id: string;
  notificationType: string; // NotificationType enum value (string at wire)
  params: unknown;
  linkUrl: string | null;
  createdAt: string; // ISO 8601
}
```

Also extend the `SSEEvent` union (if one exists — search `type SSEEvent =`) to include `NotificationSSEEvent`.

**Step 2: Add channel helper** to `packages/redis/src/keys.ts` under the existing `userChannel` entry:

```ts
notificationChannel: (userId: string) => `notification:${userId}`,
```

**Step 3: Typecheck**

Run: `pnpm -w typecheck`
Expected: 0 errors.

**Step 4: Commit**

```bash
git add packages/core/src/index.ts packages/redis/src/keys.ts
git commit -m "feat(core): notification SSE event + redis channel helper"
```

---

### Task 5: Write the failing test for `createNotification`

**Files:**

- Create: `tests/unit/domain/notification.test.ts`

**Step 1: Write the test file**

```ts
// tests/unit/domain/notification.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { notificationDomain } from "@nojv/domain";
import { notificationRepo } from "@nojv/db";
import { truncateTestDb, createTestUser } from "../../fixtures/seed-test-db";

describe("notificationDomain.createNotification", () => {
  beforeEach(async () => {
    await truncateTestDb();
  });

  it("writes a row and returns it", async () => {
    const user = await createTestUser();
    const row = await notificationDomain.createNotification({
      userId: user.id,
      type: "course_enrolled",
      params: { courseSlug: "algo-101", courseName: "Algorithms" },
      linkUrl: "/courses/algo-101",
    });
    expect(row.userId).toBe(user.id);
    expect(row.type).toBe("course_enrolled");
    expect(row.readAt).toBeNull();
  });

  it("caps retention at 50 per user", async () => {
    const user = await createTestUser();
    for (let i = 0; i < 55; i++) {
      await notificationDomain.createNotification({
        userId: user.id,
        type: "announcement_published",
        params: { announcementId: `a${i}`, titleEn: `t${i}`, titleZhTw: `t${i}` },
      });
    }
    const rows = await notificationRepo.listRecent(user.id, 100);
    expect(rows).toHaveLength(50);
  });

  it("publishes on the redis notification channel", async () => {
    const user = await createTestUser();
    const received: string[] = [];
    // Use a real Redis subscriber in the integration suite; this is a unit
    // test so we stub publish via the public surface. See notificationDomain
    // exposing a publish hook for tests, OR cover this case in integration.
    // (Keep this as integration if mocking gets ugly — see Task 7.)
    expect.soft(true).toBe(true);
  });
});
```

**Step 2: Run it to confirm it fails because the module does not exist yet**

Run: `pnpm --filter @nojv/web test:unit -- tests/unit/domain/notification.test.ts`
Expected: FAIL with "Cannot find module" or similar.

**Step 3: Commit the failing test**

```bash
git add tests/unit/domain/notification.test.ts
git commit -m "test: failing notification domain test"
```

---

### Task 6: Implement `notificationDomain.createNotification` + barrel

**Files:**

- Create: `packages/domain/src/notification/index.ts`
- Modify: `packages/domain/src/index.ts`

**Step 1: Write the domain module**

```ts
// packages/domain/src/notification/index.ts
import { notificationRepo, type NotificationCreateInput } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";
import { SSE_NOTIFICATION, type NotificationSSEEvent } from "@nojv/core";

export type CreateNotificationInput = NotificationCreateInput;

function toSseEvent(row: {
  id: string;
  type: string;
  params: unknown;
  linkUrl: string | null;
  createdAt: Date;
}): NotificationSSEEvent {
  return {
    type: SSE_NOTIFICATION,
    id: row.id,
    notificationType: row.type,
    params: row.params,
    linkUrl: row.linkUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createNotification(input: CreateNotificationInput) {
  const row = await notificationRepo.createAndCap(input);
  try {
    await getRedis().publish(
      keys.notificationChannel(input.userId),
      JSON.stringify(toSseEvent(row)),
    );
  } catch {
    // Best-effort; SSE delivery is eventually-consistent with the DB.
  }
  return row;
}

export async function createNotificationBatch(inputs: CreateNotificationInput[]) {
  const BATCH = 500;
  let total = 0;
  for (let i = 0; i < inputs.length; i += BATCH) {
    total += await notificationRepo.createManyAndCap(inputs.slice(i, i + BATCH));
  }
  // Per-user publish for batches — best-effort.
  const redis = getRedis();
  const byUser = new Map<string, CreateNotificationInput[]>();
  for (const input of inputs) {
    const arr = byUser.get(input.userId) ?? [];
    arr.push(input);
    byUser.set(input.userId, arr);
  }
  for (const [userId, userInputs] of byUser) {
    for (const input of userInputs) {
      try {
        await redis.publish(
          keys.notificationChannel(userId),
          JSON.stringify({
            type: SSE_NOTIFICATION,
            notificationType: input.type,
            params: input.params,
            linkUrl: input.linkUrl ?? null,
            // id + createdAt are omitted on batch publish — clients refetch
            // /api/notifications/recent when they see a batch signal without id
          }),
        );
      } catch {
        /* best-effort */
      }
    }
  }
  return total;
}

export async function listRecent(userId: string, limit: number) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  return notificationRepo.listRecent(userId, safeLimit);
}

export async function countUnread(userId: string) {
  return notificationRepo.countUnread(userId);
}

export async function markAsRead(userId: string, notificationId: string) {
  return notificationRepo.markRead(userId, notificationId);
}

export async function markAllAsRead(userId: string) {
  return notificationRepo.markAllRead(userId);
}
```

**Step 2: Export from barrel**

Append to `packages/domain/src/index.ts`:

```ts
export * as notificationDomain from "./notification";
```

**Step 3: Run tests**

Run: `pnpm --filter @nojv/web test:unit -- tests/unit/domain/notification.test.ts`
Expected: PASS on "writes a row" and "caps retention". Third test (redis publish) is a soft stub — covered in Task 7.

**Step 4: Commit**

```bash
git add packages/domain/src/notification/index.ts packages/domain/src/index.ts
git commit -m "feat(domain): notification module with createNotification + cap"
```

---

### Task 7: Integration test — notification publish reaches SSE

**Files:**

- Create: `tests/integration/notification/publish.test.ts`

**Step 1: Write the test**

```ts
// tests/integration/notification/publish.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { notificationDomain } from "@nojv/domain";
import { createSubscriber, keys } from "@nojv/redis";
import { truncateTestDb, createTestUser } from "../../fixtures/seed-test-db";

describe("notification publish", () => {
  beforeEach(async () => {
    await truncateTestDb();
  });

  it("publishes to the user's notification channel", async () => {
    const user = await createTestUser();
    const channel = keys.notificationChannel(user.id);

    const sub = createSubscriber(process.env.REDIS_URL!);
    const received: string[] = [];
    sub.on("message", (_chan, msg) => received.push(msg));
    await sub.subscribe(channel);

    await notificationDomain.createNotification({
      userId: user.id,
      type: "course_enrolled",
      params: { courseSlug: "x", courseName: "X" },
    });

    // Wait up to 1s for the message to arrive.
    const deadline = Date.now() + 1000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(received).toHaveLength(1);
    const event = JSON.parse(received[0]!);
    expect(event.type).toBe("notification");
    expect(event.notificationType).toBe("course_enrolled");

    await sub.quit();
  });
});
```

**Step 2: Run it**

Run: `pnpm --filter @nojv/web test:integration -- tests/integration/notification/publish.test.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git add tests/integration/notification/publish.test.ts
git commit -m "test: notification publish reaches redis subscriber"
```

---

### Task 8: API route — GET `/api/notifications/recent`

**Files:**

- Create: `apps/web/src/routes/api/notifications/recent/+server.ts`

**Step 1: Write the handler**

```ts
// apps/web/src/routes/api/notifications/recent/+server.ts
import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { requireAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireAuth(event);
  const limitParam = Number(event.url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitParam) ? limitParam : 20;
  const [items, unreadCount] = await Promise.all([
    notificationDomain.listRecent(actor.userId, limit),
    notificationDomain.countUnread(actor.userId),
  ]);
  return json({ items, unreadCount });
});
```

**Step 2: Manual smoke test**

Run: `pnpm dev` (in `apps/web`), log in, visit `http://localhost:5173/api/notifications/recent`
Expected: `{ items: [], unreadCount: 0 }` for a fresh user.

**Step 3: Commit**

```bash
git add apps/web/src/routes/api/notifications/recent/+server.ts
git commit -m "feat(web): GET /api/notifications/recent"
```

---

### Task 9: API routes — `unread-count`, `[id]/read`, `read-all`

**Files:**

- Create: `apps/web/src/routes/api/notifications/unread-count/+server.ts`
- Create: `apps/web/src/routes/api/notifications/[id]/read/+server.ts`
- Create: `apps/web/src/routes/api/notifications/read-all/+server.ts`

**Step 1: Write all three**

```ts
// unread-count/+server.ts
import { json } from "@sveltejs/kit";
import { requireAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireAuth(event);
  const count = await notificationDomain.countUnread(actor.userId);
  return json({ count });
});
```

```ts
// [id]/read/+server.ts
import { json } from "@sveltejs/kit";
import { requireAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = apiHandler(async (event) => {
  const actor = requireAuth(event);
  await consumeFormRateLimit(event, `notification-read:${actor.userId}`);
  const updated = await notificationDomain.markAsRead(actor.userId, event.params.id!);
  return json({ updated });
});
```

```ts
// read-all/+server.ts
import { json } from "@sveltejs/kit";
import { requireAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = apiHandler(async (event) => {
  const actor = requireAuth(event);
  await consumeFormRateLimit(event, `notification-read-all:${actor.userId}`);
  const updated = await notificationDomain.markAllAsRead(actor.userId);
  return json({ updated });
});
```

(Note: confirm the exact path / export name of `consumeFormRateLimit` by grepping — it already exists under `$lib/server/shared/rate-limiter.ts`.)

**Step 2: Typecheck + smoke test**

Run: `pnpm -w typecheck` → 0 errors.
Curl locally for each route after logging in.

**Step 3: Commit**

```bash
git add apps/web/src/routes/api/notifications/
git commit -m "feat(web): mark-read + unread-count notification routes"
```

---

### Task 10: Wire SSE stream to subscribe to notification channel

**Files:**

- Modify: `apps/web/src/routes/api/events/stream/+server.ts`

**Step 1: Add the new channel**

Find the line `const channels = [userChannel(userId)];` and change to:

```ts
const channels = [userChannel(userId), keys.notificationChannel(userId)];
```

Also import `keys` from `@nojv/redis` at the top of the file.

**Step 2: Typecheck + manual test**

Run: `pnpm -w typecheck` → 0 errors.
Manually: open `/api/events/stream` with `curl -N` after logging in, trigger a notification insert via a domain call (e.g., via a small script or via the API), confirm the SSE client receives `data: {"type":"notification",...}`.

**Step 3: Commit**

```bash
git add apps/web/src/routes/api/events/stream/+server.ts
git commit -m "feat(web): SSE stream subscribes to notification channel"
```

---

## Phase 2 — Immediate-event producers (commit group "feat: notification immediate producers")

### Task 11: Fire `course_enrolled` in `manuallyEnrollCourseMember`

**Files:**

- Modify: `packages/domain/src/course/mutations.ts` — find `manuallyEnrollCourseMember` function
- Test: `tests/integration/domain/course-enroll-notification.test.ts`

**Step 1: Write the integration test first**

```ts
// tests/integration/domain/course-enroll-notification.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { courseDomain, notificationDomain } from "@nojv/domain";
import { notificationRepo } from "@nojv/db";
import { truncateTestDb, createTestUser, createTestCourse } from "../../fixtures/seed-test-db";

describe("manuallyEnrollCourseMember emits notification", () => {
  beforeEach(async () => {
    await truncateTestDb();
  });

  it("writes course_enrolled notification for the enrolled student", async () => {
    const teacher = await createTestUser({ role: "teacher" });
    const student = await createTestUser({ role: "student" });
    const course = await createTestCourse({ ownerId: teacher.id });

    await courseDomain.manuallyEnrollCourseMember(
      /* actor */ { userId: teacher.id, platformRole: "teacher" /* fill remaining */ } as any,
      course.id,
      student.id,
      "student",
    );

    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("course_enrolled");
    const params = rows[0]!.params as { courseSlug: string; courseName: string };
    expect(params.courseSlug).toBe(course.slug);
  });
});
```

**Step 2: Run it — expect fail**

Run: `pnpm --filter @nojv/web test:integration -- tests/integration/domain/course-enroll-notification.test.ts`
Expected: FAIL (no notification created).

**Step 3: Add the producer call**

In `packages/domain/src/course/mutations.ts` inside `manuallyEnrollCourseMember`, after the enrollment mutation succeeds, call:

```ts
await notificationDomain.createNotification({
  userId: targetUserId,
  type: "course_enrolled",
  params: { courseSlug: course.slug, courseName: course.name },
  linkUrl: `/courses/${course.slug}`,
});
```

Add the import at the top: `import * as notificationDomain from "../notification";`

**Step 4: Re-run test**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/domain/src/course/mutations.ts tests/integration/domain/course-enroll-notification.test.ts
git commit -m "feat(domain): emit course_enrolled notification on manual enroll"
```

---

### Task 12: Fire `announcement_published` fan-out on publish

**Files:**

- Modify: `packages/domain/src/announcement/index.ts`
- Test: `tests/integration/domain/announcement-publish-notification.test.ts`

**Step 1: Write the test**

Assert that toggling an announcement from draft to published writes one notification per active user, with `params.titleEn` and `params.titleZhTw` from the announcement translations.

**Step 2: Implement**

In `createAnnouncement` (when `data.published === true`) and in `updateAnnouncement` / `toggleAnnouncementPublish` when the transition is `draft → published`, fetch all active users via `userRepo.listActiveIds()` (add this method if missing — simple `findMany({ where: { status: 'active' }, select: { id: true } })`) and call `notificationDomain.createNotificationBatch(...)`.

Make sure the transition detection is "was not published, now is" — do not re-fan-out on every update.

**Step 3: Commit**

```bash
git add packages/domain/src/announcement/index.ts packages/db/src/repositories/user.ts tests/integration/domain/announcement-publish-notification.test.ts
git commit -m "feat(domain): fan out notifications on announcement publish"
```

---

### Task 13: Fire `role_changed` on admin role change

**Files:**

- Modify: `packages/domain/src/admin/` — find the function that writes `User.platformRole`
- Test: `tests/integration/domain/role-change-notification.test.ts`

**Step 1: Write the test** — admin updates a user's role, expect a `role_changed` notification with `params: { newRole, oldRole }` and `linkUrl: "/account"`.

**Step 2: Implement** — after the role update succeeds, call `notificationDomain.createNotification(...)` only when `newRole !== oldRole`.

**Step 3: Commit**

```bash
git add packages/domain/src/admin/ tests/integration/domain/role-change-notification.test.ts
git commit -m "feat(domain): emit role_changed notification on role update"
```

---

## Phase 3 — Scheduled events + UI (commit group "feat: notification UI + scheduled events")

### Task 14: `assignment_due_soon` in `assessmentLifecycle` workflow

**Files:**

- Modify: `packages/temporal/src/workflows/assessment-lifecycle.ts`
- Modify: `packages/temporal/src/activities/notification.ts` (or add one if missing)
- Test: `tests/unit/temporal/assessment-lifecycle.test.ts` (add a case, mocking Temporal time)

**Step 1: Add the activity**

In `packages/temporal/src/activities/notification.ts`, add:

```ts
export async function fanoutAssignmentDueSoon(assessmentId: string) {
  const assessment = await courseAssessmentRepo.findById(assessmentId);
  if (!assessment?.closesAt) return;
  const studentsNotYetMaxed = await assessmentDomain.findStudentsBelowMaxScore(assessmentId);
  const inputs = studentsNotYetMaxed.map((s) => ({
    userId: s.userId,
    type: "assignment_due_soon" as const,
    params: {
      courseSlug: assessment.courseSlug,
      assessmentSlug: assessment.slug,
      title: assessment.title,
      dueAt: assessment.closesAt!.toISOString(),
    },
    linkUrl: `/courses/${assessment.courseSlug}/assignments/${assessment.slug}`,
  }));
  await notificationDomain.createNotificationBatch(inputs);
}
```

(`findStudentsBelowMaxScore` is a new domain query — write it alongside, using the existing scoring pipeline's "best score per (user, problem, context)" logic.)

**Step 2: Insert sleep-then-activity in the workflow**

In `assessmentLifecycleWorkflow`, branch `closesAt - 24h > now` and insert:

```ts
await sleep(closesAt.getTime() - 24 * 60 * 60 * 1000 - Date.now());
await notification.fanoutAssignmentDueSoon(input.assessmentId);
```

Use `proxyActivities<typeof notificationActivities>(LONG_ACTIVITY)` for the activity binding.

**Step 3: Add test + commit**

Standard pattern — mock time, advance, assert activity fires. Commit when green.

```bash
git commit -m "feat(temporal): assignment_due_soon reminder 24h before close"
```

---

### Task 15: `exam_starting_soon` + `contest_starting_soon` workflows

**Files:**

- Modify: `packages/temporal/src/workflows/exam-lifecycle.ts` (if exists, else the equivalent)
- Modify: `packages/temporal/src/workflows/contest-lifecycle.ts`
- Modify: `packages/temporal/src/activities/notification.ts`

Same pattern as Task 14 — sleep until `startsAt - 15min`, fan out to participants. Commit per workflow.

```bash
git commit -m "feat(temporal): exam/contest starting_soon reminders"
```

---

### Task 16: Frontend store

**Files:**

- Create: `apps/web/src/lib/stores/notifications.svelte.ts`

**Step 1: Write the Svelte 5 rune store**

```ts
// apps/web/src/lib/stores/notifications.svelte.ts
import { browser } from "$app/environment";

export type NotificationItem = {
  id: string;
  type: string;
  params: Record<string, unknown>;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

class NotificationsStore {
  items = $state<NotificationItem[]>([]);
  unreadCount = $state(0);
  isAnimating = $state(false);

  async init() {
    if (!browser) return;
    const res = await fetch("/api/notifications/recent?limit=20");
    if (!res.ok) return;
    const data = await res.json();
    this.items = data.items;
    this.unreadCount = data.unreadCount;
  }

  handleSseEvent(payload: {
    id: string;
    notificationType: string;
    params: unknown;
    linkUrl: string | null;
    createdAt: string;
  }) {
    this.items = [
      {
        id: payload.id,
        type: payload.notificationType,
        params: (payload.params ?? {}) as Record<string, unknown>,
        linkUrl: payload.linkUrl,
        readAt: null,
        createdAt: payload.createdAt,
      },
      ...this.items,
    ].slice(0, 20);
    this.unreadCount += 1;
    this.triggerShake();
  }

  private triggerShake() {
    this.isAnimating = true;
    setTimeout(() => {
      this.isAnimating = false;
    }, 500);
  }

  async markOne(id: string) {
    const idx = this.items.findIndex((n) => n.id === id);
    if (idx < 0) return;
    const original = this.items[idx]!;
    if (original.readAt) return;
    this.items[idx] = { ...original, readAt: new Date().toISOString() };
    this.unreadCount = Math.max(0, this.unreadCount - 1);
    const res = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    if (!res.ok) {
      // Rollback
      this.items[idx] = original;
      this.unreadCount += 1;
    }
  }

  async markAll() {
    const originalCount = this.unreadCount;
    const originalItems = this.items;
    const now = new Date().toISOString();
    this.items = this.items.map((i) => (i.readAt ? i : { ...i, readAt: now }));
    this.unreadCount = 0;
    const res = await fetch("/api/notifications/read-all", { method: "POST" });
    if (!res.ok) {
      this.items = originalItems;
      this.unreadCount = originalCount;
    }
  }
}

export const notifications = new NotificationsStore();
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/stores/notifications.svelte.ts
git commit -m "feat(web): notification store with optimistic mark-read"
```

---

### Task 17: Components — Bell, Dropdown, Item

**Files:**

- Create: `apps/web/src/lib/components/notification/NotificationBell.svelte`
- Create: `apps/web/src/lib/components/notification/NotificationDropdown.svelte`
- Create: `apps/web/src/lib/components/notification/NotificationItem.svelte`

**Step 1: Write `NotificationBell.svelte`** — imports the store, shows `🔔` + badge with `unreadCount` if > 0, toggles dropdown on click. Uses Bits UI `Popover` for the dropdown. Adds a `bell-shake` CSS keyframe class bound to `$derived(notifications.isAnimating)`.

**Step 2: Write `NotificationDropdown.svelte`** — renders the list (or empty-state message), header with "Mark all read" button.

**Step 3: Write `NotificationItem.svelte`** — `<script>` has a switch on `item.type` that calls the matching `m.notification_<type>(item.params as any)`. Whole row is a `<button>` or `<a href={item.linkUrl}>` that calls `notifications.markOne(item.id)` on click. Read items get `opacity-60`.

**Step 4: Mount bell in navbar**

Find the navbar component (probably `apps/web/src/lib/components/layout/Navbar.svelte` — check structure) and insert `<NotificationBell />` next to the user avatar. Call `notifications.init()` from an `$effect` in the same component.

**Step 5: Commit**

```bash
git add apps/web/src/lib/components/notification/ apps/web/src/lib/components/layout/
git commit -m "feat(web): notification bell, dropdown, item components"
```

---

### Task 18: SSE client integration

**Files:**

- Modify: wherever the existing SSE client hook lives — search for `EventSource` or `events/stream` in `apps/web/src/lib/`

**Step 1: Add a handler for the `notification` event**

When an SSE message with `event.type === "notification"` arrives, call `notifications.handleSseEvent(event)`.

**Step 2: Manual test**

Run dev server, sign in as 2 users in 2 browsers. User A enrolls user B in a course. User B's bell should shake + badge +1.

**Step 3: Commit**

```bash
git add <touched file>
git commit -m "feat(web): wire notification SSE into store"
```

---

### Task 19: Paraglide keys

**Files:**

- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`

**Step 1: Add keys to both files** — see the design doc for the complete list of notification\_\* keys. Run `pnpm --filter @nojv/web exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide` to regenerate `m` helpers.

**Step 2: Typecheck**

Run: `pnpm -w typecheck`
Expected: 0 errors; any new `m.notification_xxx` callsites resolve.

**Step 3: Commit**

```bash
git add apps/web/messages/ apps/web/src/lib/paraglide/
git commit -m "i18n: notification center strings (en, zh-TW)"
```

---

### Task 20: Bell-shake CSS keyframe

**Files:**

- Modify: the bell component or a shared CSS file (e.g. `apps/web/src/app.css`)

Add:

```css
@keyframes bell-shake {
  0%,
  100% {
    transform: rotate(0);
  }
  20%,
  60% {
    transform: rotate(-8deg);
  }
  40%,
  80% {
    transform: rotate(8deg);
  }
}

.bell-shake {
  animation: bell-shake 450ms ease-in-out;
}

@keyframes dot-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.15);
  }
}

.dot-pulse {
  animation: dot-pulse 400ms ease-in-out;
}
```

Commit:

```bash
git commit -m "feat(web): notification bell shake + dot pulse animations"
```

---

## Final Verification

Run the full local CI:

```bash
pnpm -w typecheck   # 17/17 green
pnpm lint           # 18/18 green
pnpm -w format      # clean
pnpm test:unit      # new notification.test.ts green
pnpm test:integration  # new publish + enrollment + announcement + role tests green
```

Expected: all green. If anything fails, fix root cause rather than skip.

Manual smoke:

1. Log in as student A and teacher B in two browsers.
2. Teacher B enrolls A in a course. A's bell shakes, badge +1.
3. A clicks the bell → dropdown shows "You were added to course X". Click the row → navigates to course page, badge -1.
4. Admin publishes an announcement → A's bell updates.
5. Admin changes A's platform role → A sees a `role_changed` notification.

Commit any stray fixes discovered during smoke testing.

---

## Notes for the Implementer

- The design doc is the source of truth on _why_; this plan is the source of truth on _what_ and _where_. When they conflict, re-read the design.
- Do not invent additional notification types beyond the 7 in `NotificationType`. Feature #3 (clarifications) fills in `clarification_answered`; other types belong in a later plan.
- Do not add email delivery, preference settings, or a `/notifications` page — all explicit non-goals.
- If any integration test flakes on parallel DB access, confirm `vitest.config.ts` still has `fileParallelism: false` for the integration project (round 6 fix). Do not re-enable parallelism.
- Batch publish payloads (Task 6) omit `id` + `createdAt` — the SSE client should refetch `/api/notifications/recent` when it sees a payload without `id`, rather than assume a partial state. Document this behavior in the SSE handler.
- If paraglide keys trigger "message type missing" during typecheck, run the compile command above — `svelte-kit sync` alone is insufficient.

---

## Related

- Design: `docs/plans/active/2026-04-19-notification-center-design.md`
- Companion plans (separate docs): rejudge + score override, clarification board
