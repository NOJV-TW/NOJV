import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import { notificationDomain } from "@nojv/domain";
import { createSubscriber, keys } from "@nojv/redis";

import { createTestUser, testPrisma } from "../../fixtures/factories";

// The shared integration-setup.ts `truncateAllTables()` does NOT include the
// `Notification` table in its TABLES list. Per Task 5 instructions, we do a
// local truncate here rather than modifying seed-test-db.ts.
describe("notificationDomain (real DB + Redis)", () => {
  beforeEach(async () => {
    await testPrisma.$executeRawUnsafe('TRUNCATE TABLE "Notification" CASCADE');
  });

  it("writes a notification row", async () => {
    const user = await createTestUser();

    await notificationDomain.createNotification({
      userId: user.id,
      type: "course_enrolled",
      params: { courseSlug: "x", courseName: "X" },
      linkUrl: "/courses/x",
    });

    const rows = await notificationRepo.listRecent(user.id, 10);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.userId).toBe(user.id);
    expect(row.type).toBe("course_enrolled");
    expect(row.params).toEqual({ courseSlug: "x", courseName: "X" });
    expect(row.linkUrl).toBe("/courses/x");
    expect(row.readAt).toBeNull();
  });

  it("caps retention at 50 per user", async () => {
    const user = await createTestUser();

    // Insert 55 notifications sequentially so createdAt is monotonic.
    for (let i = 0; i < 55; i++) {
      await notificationDomain.createNotification({
        userId: user.id,
        type: "announcement_published",
        params: { ordinal: i },
        linkUrl: `/n/${i}`,
      });
    }

    const rows = await notificationRepo.listRecent(user.id, 100);
    expect(rows).toHaveLength(50);

    // listRecent returns DESC by createdAt, so the oldest in the window is
    // rows[rows.length - 1]. The first 5 inserts (ordinal 0..4) must be gone;
    // the earliest surviving row should be ordinal 5 or later.
    const earliestParams = rows[rows.length - 1]!.params as { ordinal: number };
    expect(earliestParams.ordinal).toBeGreaterThanOrEqual(5);
  });

  it("publishes to the redis notification channel", async () => {
    const user = await createTestUser();

    const sub = createSubscriber(process.env.REDIS_URL ?? "redis://localhost:6379");
    const received: string[] = [];
    sub.on("message", (_channel, message) => {
      received.push(message);
    });
    await sub.subscribe(keys.notificationChannel(user.id));

    try {
      await notificationDomain.createNotification({
        userId: user.id,
        type: "course_enrolled",
        params: { courseSlug: "algos", courseName: "Algorithms" },
        linkUrl: "/courses/algos",
      });

      const deadline = Date.now() + 1000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }

      expect(received).toHaveLength(1);
      const event = JSON.parse(received[0]!) as {
        type: string;
        notificationType: string;
        params: Record<string, unknown>;
        linkUrl: string | null;
        id: string;
        createdAt: string;
      };
      expect(event.type).toBe("notification");
      expect(event.notificationType).toBe("course_enrolled");
      expect(event.params).toEqual({ courseSlug: "algos", courseName: "Algorithms" });
      expect(event.linkUrl).toBe("/courses/algos");
      expect(event.id).toBeTruthy();
      expect(Number.isNaN(Date.parse(event.createdAt))).toBe(false);
    } finally {
      await sub.quit();
    }
  });

  it("markAsRead is idempotent", async () => {
    const user = await createTestUser();

    await notificationDomain.createNotification({
      userId: user.id,
      type: "role_changed",
      params: { role: "teacher" },
      linkUrl: null,
    });
    const [created] = await notificationRepo.listRecent(user.id, 1);
    expect(created).toBeDefined();
    const notificationId = created!.id;

    const firstCount = await notificationDomain.markAsRead(user.id, notificationId);
    expect(firstCount).toBe(1);

    const [afterFirst] = await notificationRepo.listRecent(user.id, 1);
    expect(afterFirst!.readAt).toBeInstanceOf(Date);
    expect(afterFirst!.readAt).not.toBeNull();

    // Second call is a no-op — `where: readAt: null` in the repo filters it out.
    const secondCount = await notificationDomain.markAsRead(user.id, notificationId);
    expect(secondCount).toBe(0);
  });

  it("markAllAsRead updates only unread rows", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    // Seed 3 notifications for user A.
    for (let i = 0; i < 3; i++) {
      await notificationDomain.createNotification({
        userId: userA.id,
        type: "announcement_published",
        params: { ordinal: i },
        linkUrl: `/a/${i}`,
      });
    }

    // Mark the most recent (index 0, since listRecent is DESC) as read.
    const rowsA = await notificationRepo.listRecent(userA.id, 10);
    expect(rowsA).toHaveLength(3);
    await notificationDomain.markAsRead(userA.id, rowsA[0]!.id);

    // Seed 1 unread notification for user B.
    await notificationDomain.createNotification({
      userId: userB.id,
      type: "announcement_published",
      params: { ordinal: 0 },
      linkUrl: "/b/0",
    });

    // markAllAsRead for user A should flip only the 2 remaining unread rows.
    const updatedA = await notificationDomain.markAllAsRead(userA.id);
    expect(updatedA).toBe(2);

    // User B's notification is untouched.
    const rowsB = await notificationRepo.listRecent(userB.id, 10);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]!.readAt).toBeNull();
  });

  afterAll(async () => {
    // testPrisma is disconnected by the shared integration-setup afterAll.
  });
});
